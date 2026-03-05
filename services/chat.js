// services/chat.js
// Conversational policy Q&A powered by Claude.
// Uses a two-pass retrieval approach:
//   Pass 1: Claude sees a catalog of document titles/summaries and selects which are relevant
//   Pass 2: Claude answers the question with only the selected documents in context
//
// This ensures thorough, accurate answers for compliance questions while staying
// within Claude's context window, even as the knowbase grows.
//
// Example questions from staff:
//   "How frequently does a child in the IDD/Autism Package need to have their CANS redone?"
//   "What are the requirements for family contact visits?"
//   "When does a child need a new ISP after placement?"
//   "What paperwork is needed for a T3C discharge?"
//   "Can a foster parent administer over-the-counter medications?"

const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const {
    getAllDocuments,
    refreshIfStale,
    formatDocumentsAsContext,
    estimateTokens
} = require('./knowbase-loader');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

// Token budget for the answer pass. Leave room for system prompt, messages, and response.
const MAX_CONTEXT_TOKENS = 150000;

if (!ANTHROPIC_API_KEY) {
    console.warn('[CHAT] ANTHROPIC_COMPLIANCE_KEY not set. Chat will not work.');
}

let _client = null;
function getClient() {
    if (!_client) {
        if (!ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_COMPLIANCE_KEY environment variable is not set');
        }
        _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    }
    return _client;
}

/**
 * System prompt for the policy knowledge assistant (Pass 2 — answering).
 */
const SYSTEM_PROMPT = `You are a knowledgeable policy and compliance assistant for Refuge House, a Texas-licensed Child Placing Agency (CPA) operating under T3C (Texas Child-Centered Care) contracts.

Your job is to answer questions from Refuge House staff — case managers, intake workers, supervisors, foster parents, and administrators — about policies, procedures, and regulatory requirements.

You have access to Refuge House's policy documents, procedures, regulatory references, and treatment models. These documents are provided below in your context.

RULES:
1. ONLY answer based on the documents provided. If the answer is not in the documents, say so clearly. Never fabricate policy requirements.
2. ALWAYS cite the specific document and section where you found the answer. Use the document's title and section headings.
3. When a question involves service package add-ons (IDD/Autism, Mental Health, Kinship, etc.), check both the base T3C requirements AND the package-specific documents.
4. When citing timelines or frequencies, quote the exact language from the policy.
5. If a question is ambiguous, ask for clarification (e.g., "Are you asking about a child in the basic T3C package or a specific add-on?").
6. Keep answers practical and direct. Staff need actionable information, not academic summaries.
7. If you reference a regulatory requirement (TAC 749, RCC contract, T3C Blueprint), cite the specific section number.
8. When appropriate, distinguish between what is REQUIRED (regulatory mandate) vs. RECOMMENDED (best practice per policy).

TONE:
- Professional but approachable — you're a helpful colleague, not a lawyer.
- Use plain language. Avoid jargon unless quoting a policy directly.
- When the answer involves multiple steps or requirements, use numbered lists or bullet points.`;

/**
 * Build a compact catalog of all documents (title, path, category, size).
 * This is what Claude sees in Pass 1 to decide which documents to retrieve.
 */
function buildDocumentCatalog(documents) {
    const entries = [];
    for (const [docPath, doc] of Object.entries(documents)) {
        const fileName = path.basename(docPath, '.md');
        const tokensEst = Math.ceil(doc.content.length / 4);
        // Extract first ~200 chars as a preview/summary
        const preview = doc.content
            .replace(/^#+ .+\n*/gm, '') // strip markdown headings
            .replace(/\n+/g, ' ')        // collapse newlines
            .trim()
            .substring(0, 200);
        entries.push(`- [${fileName}] (${docPath}) | Category: ${doc.category} | ~${tokensEst} tokens\n  Preview: ${preview}...`);
    }
    return entries.join('\n');
}

/**
 * Pass 1: Ask Claude to select which documents are relevant to the question.
 * Returns an array of document paths.
 */
async function selectDocuments(message, history, catalog, allDocCount) {
    const client = getClient();

    // Include recent conversation context so Claude understands follow-up questions
    let conversationContext = '';
    if (history.length > 0) {
        const recentHistory = history.slice(-6); // last 3 exchanges
        conversationContext = '\nRecent conversation:\n' +
            recentHistory.map(m => `${m.role}: ${m.content}`).join('\n') + '\n';
    }

    const selectionPrompt = `You are a document retrieval assistant for a compliance knowledge base.

A staff member has asked a question. Your job is to select which documents from the catalog below are needed to answer it thoroughly.

RULES:
- Select ALL documents that could be relevant — thoroughness is critical for compliance.
- When a question involves a specific service package (IDD/Autism, Mental Health, Kinship, etc.), include BOTH the package-specific docs AND the base T3C/general policy docs.
- When a question involves timelines, assessments, or paperwork, include the relevant policy docs AND any regulatory reference docs.
- If the question is broad or general, select more documents rather than fewer.
- If the question is a follow-up to a previous conversation, consider what context is needed.
- Respond with ONLY a JSON array of document paths. No other text.

Example response:
["policies/FC-T3C-01-case-management.md", "regulatory/TAC-749-subchapter-m.md"]`;

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: selectionPrompt,
        messages: [{
            role: 'user',
            content: `DOCUMENT CATALOG (${allDocCount} documents):\n${catalog}\n${conversationContext}\nSTAFF QUESTION: ${message}\n\nSelect the relevant document paths as a JSON array:`
        }]
    });

    const responseText = response.content[0]?.text || '[]';
    console.log(`[CHAT] Pass 1 used ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    // Parse the JSON array from Claude's response
    try {
        // Extract JSON array even if Claude added extra text
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn('[CHAT] Pass 1: Could not find JSON array in response, falling back to all docs');
            return null;
        }
        const paths = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(paths) || paths.length === 0) {
            console.warn('[CHAT] Pass 1: Empty or invalid selection, falling back to all docs');
            return null;
        }
        return paths;
    } catch (err) {
        console.warn(`[CHAT] Pass 1: Failed to parse document selection: ${err.message}`);
        return null;
    }
}

/**
 * Handle a chat message. Supports multi-turn conversation.
 * Uses two-pass retrieval when the knowbase exceeds the token budget.
 *
 * @param {string} message - The user's question
 * @param {Array<{role: string, content: string}>} history - Previous messages in the conversation
 * @returns {Promise<object>} Response with answer, citations, and metadata
 */
async function chat(message, history = []) {
    await refreshIfStale();

    const allDocs = getAllDocuments();
    const allDocCount = Object.keys(allDocs).length;
    const totalTokens = estimateTokens(allDocs);

    console.log(`[CHAT] Question: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    console.log(`[CHAT] Full knowbase: ${allDocCount} documents, ~${totalTokens} estimated tokens`);

    if (allDocCount === 0) {
        throw new Error('No documents loaded. The knowbase may not have synced. Try POST /api/documents/refresh');
    }

    let documentsToInclude;
    let retrievalMethod;

    if (totalTokens <= MAX_CONTEXT_TOKENS) {
        // Everything fits — include all docs, no need for two-pass
        documentsToInclude = allDocs;
        retrievalMethod = 'full';
        console.log(`[CHAT] All docs fit within budget, including all ${allDocCount}`);
    } else {
        // Two-pass retrieval: let Claude pick the relevant documents
        retrievalMethod = 'two-pass';
        console.log(`[CHAT] Knowbase too large (${totalTokens} tokens), using two-pass retrieval`);

        const catalog = buildDocumentCatalog(allDocs);
        const selectedPaths = await selectDocuments(message, history, catalog, allDocCount);

        if (selectedPaths) {
            // Collect selected documents, fitting within token budget
            documentsToInclude = {};
            let currentTokens = 0;

            for (const docPath of selectedPaths) {
                const doc = allDocs[docPath];
                if (!doc) {
                    console.warn(`[CHAT] Pass 1 selected unknown document: ${docPath}`);
                    continue;
                }
                const docTokens = Math.ceil(doc.content.length / 4);
                if (currentTokens + docTokens > MAX_CONTEXT_TOKENS) {
                    console.warn(`[CHAT] Token budget reached, skipping remaining selections`);
                    break;
                }
                documentsToInclude[docPath] = doc;
                currentTokens += docTokens;
            }

            const selectedCount = Object.keys(documentsToInclude).length;
            const selectedTokens = estimateTokens(documentsToInclude);
            console.log(`[CHAT] Pass 1 selected ${selectedPaths.length} docs, included ${selectedCount} (~${selectedTokens} tokens)`);
        } else {
            // Fallback: if Pass 1 failed, use keyword matching
            console.warn('[CHAT] Pass 1 failed, falling back to keyword selection');
            retrievalMethod = 'keyword-fallback';
            documentsToInclude = keywordSelect(message, history, allDocs);
        }
    }

    const docCount = Object.keys(documentsToInclude).length;

    // Build context note for the answer pass
    let contextNote = '';
    if (retrievalMethod !== 'full') {
        contextNote = `Note: ${docCount} of ${allDocCount} documents from the policy library were selected as relevant to this question. If you cannot find the answer in the provided documents, say so clearly.`;
    }

    const documentContext = formatDocumentsAsContext(
        documentsToInclude,
        '=== REFUGE HOUSE POLICY AND COMPLIANCE KNOWLEDGE BASE ===\n' +
        'The following documents are from the policy library. ' +
        'Use these as your sole source of truth when answering questions.\n' +
        (contextNote ? `\n${contextNote}\n` : '')
    );

    // Build message history for the answer pass
    const messages = [];

    if (history.length > 0) {
        let contextInjected = false;
        for (const msg of history) {
            if (!contextInjected && msg.role === 'user') {
                messages.push({
                    role: 'user',
                    content: documentContext + '\n\n' + msg.content
                });
                contextInjected = true;
            } else {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
        messages.push({ role: 'user', content: message });
    } else {
        messages.push({
            role: 'user',
            content: documentContext + '\n\nQuestion from staff member:\n' + message
        });
    }

    // Pass 2: Answer the question with selected documents
    const client = getClient();
    const startTime = Date.now();

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages
    });

    const elapsed = Date.now() - startTime;
    const answer = response.content[0]?.text || '';

    console.log(`[CHAT] Pass 2 responded in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    return {
        answer,
        _meta: {
            documentsInContext: docCount,
            totalDocumentsAvailable: allDocCount,
            estimatedContextTokens: estimateTokens(documentsToInclude),
            retrievalMethod,
            model: CLAUDE_MODEL,
            responseTimeMs: elapsed,
            inputTokens: response.usage?.input_tokens || null,
            outputTokens: response.usage?.output_tokens || null,
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Fallback keyword-based document selection if the two-pass retrieval fails.
 */
function keywordSelect(message, history, allDocs) {
    const stopWords = new Set([
        'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
        'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
        'through', 'during', 'before', 'after', 'above', 'below', 'and', 'but',
        'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each',
        'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
        'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
        'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'why',
        'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you',
        'your', 'he', 'she', 'it', 'they', 'them', 'their', 'its',
        'need', 'needs', 'want', 'tell', 'know', 'long', 'many', 'much', 'often',
        'does', 'there', 'here'
    ]);

    let searchText = message;
    for (const msg of history.slice(-4)) {
        if (msg.role === 'user') searchText += ' ' + msg.content;
    }

    const keywords = searchText.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    const scored = [];
    for (const [docPath, doc] of Object.entries(allDocs)) {
        const lowerContent = doc.content.toLowerCase();
        const lowerPath = docPath.toLowerCase();
        let score = 0;

        for (const kw of [...new Set(keywords)]) {
            const contentMatches = (lowerContent.match(new RegExp(kw, 'g')) || []).length;
            score += Math.min(contentMatches, 10);
            if (lowerPath.includes(kw)) score += 5;
        }
        if (doc.category === 'policy') score += 1;
        if (doc.category === 'regulatory') score += 1;

        if (score > 0) scored.push({ docPath, doc, score });
    }

    scored.sort((a, b) => b.score - a.score);

    const selected = {};
    let currentTokens = 0;
    for (const { docPath, doc } of scored) {
        const docTokens = Math.ceil(doc.content.length / 4);
        if (currentTokens + docTokens > MAX_CONTEXT_TOKENS) {
            if (Object.keys(selected).length === 0) selected[docPath] = doc;
            break;
        }
        selected[docPath] = doc;
        currentTokens += docTokens;
    }

    return selected;
}

module.exports = { chat };
