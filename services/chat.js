// services/chat.js
// Conversational policy Q&A powered by Claude.
// Loads ALL knowbase documents into context so staff can ask any question
// about policies, procedures, regulations, and requirements.
//
// Example questions from staff:
//   "How frequently does a child in the IDD/Autism Package need to have their CANS redone?"
//   "What are the requirements for family contact visits?"
//   "When does a child need a new ISP after placement?"
//   "What paperwork is needed for a T3C discharge?"
//   "Can a foster parent administer over-the-counter medications?"

const Anthropic = require('@anthropic-ai/sdk');
const {
    getAllDocuments,
    refreshIfStale,
    formatDocumentsAsContext,
    estimateTokens,
    searchDocuments
} = require('./knowbase-loader');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

// Token budget: reserve room for response and conversation history
// Claude supports 200K context; leave room for system prompt, response, and messages
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
 * System prompt for the policy knowledge assistant.
 */
const SYSTEM_PROMPT = `You are a knowledgeable policy and compliance assistant for Refuge House, a Texas-licensed Child Placing Agency (CPA) operating under T3C (Texas Child-Centered Care) contracts.

Your job is to answer questions from Refuge House staff — case managers, intake workers, supervisors, foster parents, and administrators — about policies, procedures, and regulatory requirements.

You have access to Refuge House's complete library of policy documents, procedures, regulatory references, and treatment models. These documents are provided below in your context.

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
 * Extract keywords from a message for document searching.
 * Strips common words and returns meaningful terms.
 */
function extractKeywords(message) {
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

    const words = message.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    // Deduplicate
    return [...new Set(words)];
}

/**
 * Select documents relevant to the user's question that fit within the token budget.
 * Uses keyword matching and then fills remaining space with high-priority categories.
 */
function selectRelevantDocuments(message, history = []) {
    // Combine current message + recent history for keyword extraction
    let searchText = message;
    for (const msg of history.slice(-4)) {
        if (msg.role === 'user') {
            searchText += ' ' + msg.content;
        }
    }

    const keywords = extractKeywords(searchText);
    console.log(`[CHAT] Search keywords: ${keywords.join(', ')}`);

    // Score each document by keyword relevance
    const allDocs = getAllDocuments();
    const scored = [];

    for (const [docPath, doc] of Object.entries(allDocs)) {
        const lowerContent = doc.content.toLowerCase();
        const lowerPath = docPath.toLowerCase();
        let score = 0;

        for (const kw of keywords) {
            // Count occurrences in content (capped to avoid huge docs dominating)
            const contentMatches = (lowerContent.match(new RegExp(kw, 'g')) || []).length;
            score += Math.min(contentMatches, 10);

            // Bonus for path/filename match
            if (lowerPath.includes(kw)) {
                score += 5;
            }
        }

        // Small bonus for policy/regulatory docs (more likely to be relevant)
        if (doc.category === 'policy') score += 1;
        if (doc.category === 'regulatory') score += 1;

        if (score > 0) {
            scored.push({ docPath, doc, score });
        }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Fill up to the token budget
    const selected = {};
    let currentTokens = 0;

    for (const { docPath, doc } of scored) {
        const docTokens = Math.ceil(doc.content.length / 4);
        if (currentTokens + docTokens > MAX_CONTEXT_TOKENS) {
            // If we haven't included anything yet, include at least one doc (truncated if needed)
            if (Object.keys(selected).length === 0) {
                selected[docPath] = doc;
            }
            break;
        }
        selected[docPath] = doc;
        currentTokens += docTokens;
    }

    // If keyword search found very few results, add some docs from key categories
    if (Object.keys(selected).length < 3 && currentTokens < MAX_CONTEXT_TOKENS * 0.5) {
        const priorityCategories = ['policy', 'regulatory'];
        for (const cat of priorityCategories) {
            for (const [docPath, doc] of Object.entries(allDocs)) {
                if (selected[docPath]) continue;
                if (doc.category !== cat) continue;
                const docTokens = Math.ceil(doc.content.length / 4);
                if (currentTokens + docTokens > MAX_CONTEXT_TOKENS) break;
                selected[docPath] = doc;
                currentTokens += docTokens;
            }
        }
    }

    return selected;
}

/**
 * Handle a chat message. Supports multi-turn conversation.
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

    // Select documents that fit within the token budget.
    // If the full knowbase fits, use it all. Otherwise, search for relevant docs.
    let documentsToInclude;
    let contextNote = '';

    if (totalTokens <= MAX_CONTEXT_TOKENS) {
        // Everything fits — include all docs
        documentsToInclude = allDocs;
        console.log(`[CHAT] All docs fit within budget, including all ${allDocCount}`);
    } else {
        // Knowbase too large — filter by relevance
        documentsToInclude = selectRelevantDocuments(message, history);
        const selectedCount = Object.keys(documentsToInclude).length;
        const selectedTokens = estimateTokens(documentsToInclude);
        console.log(`[CHAT] Filtered to ${selectedCount} relevant documents (~${selectedTokens} tokens)`);
        contextNote = `Note: Only the most relevant documents from the policy library are included below (${selectedCount} of ${allDocCount} total). If the answer is not found here, let the user know and suggest they rephrase their question with more specific terms.`;
    }

    const docCount = Object.keys(documentsToInclude).length;

    const documentContext = formatDocumentsAsContext(
        documentsToInclude,
        '=== REFUGE HOUSE POLICY AND COMPLIANCE KNOWLEDGE BASE ===\n' +
        'The following documents are from the policy library. ' +
        'Use these as your sole source of truth when answering questions.\n' +
        (contextNote ? `\n${contextNote}\n` : '')
    );

    // Build message history
    // The document context goes in the first user message so it's always available
    const messages = [];

    if (history.length > 0) {
        // For multi-turn: the first message in history should already contain context
        // We inject context into the first user message
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
        // Add the new message
        messages.push({ role: 'user', content: message });
    } else {
        // First message in conversation — include full context
        messages.push({
            role: 'user',
            content: documentContext + '\n\nQuestion from staff member:\n' + message
        });
    }

    // Call Claude
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

    console.log(`[CHAT] Responded in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    return {
        answer,
        _meta: {
            documentsInContext: docCount,
            totalDocumentsAvailable: allDocCount,
            estimatedContextTokens: estimateTokens(documentsToInclude),
            model: CLAUDE_MODEL,
            responseTimeMs: elapsed,
            inputTokens: response.usage?.input_tokens || null,
            outputTokens: response.usage?.output_tokens || null,
            timestamp: new Date().toISOString()
        }
    };
}

module.exports = { chat };
