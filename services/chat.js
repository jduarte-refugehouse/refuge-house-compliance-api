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
    estimateTokens
} = require('./knowbase-loader');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

// Token budget: reserve room for response and conversation history
const MAX_CONTEXT_TOKENS = 180000; // Claude supports 200K; leave room for response + messages

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
 * Handle a chat message. Supports multi-turn conversation.
 *
 * @param {string} message - The user's question
 * @param {Array<{role: string, content: string}>} history - Previous messages in the conversation
 * @returns {Promise<object>} Response with answer, citations, and metadata
 */
async function chat(message, history = []) {
    await refreshIfStale();

    // Load all documents and build context
    const allDocs = getAllDocuments();
    const docCount = Object.keys(allDocs).length;
    const totalTokens = estimateTokens(allDocs);

    console.log(`[CHAT] Question: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
    console.log(`[CHAT] Context: ${docCount} documents, ~${totalTokens} estimated tokens`);

    if (docCount === 0) {
        throw new Error('No documents loaded. The knowbase may not have synced. Try POST /api/documents/refresh');
    }

    // Build the document context
    // If under token budget, include all docs. Otherwise, this is where we'd add
    // relevance filtering in the future.
    let documentsToInclude = allDocs;
    let contextNote = '';

    if (totalTokens > MAX_CONTEXT_TOKENS) {
        console.warn(`[CHAT] Total knowbase (${totalTokens} tokens) exceeds budget (${MAX_CONTEXT_TOKENS}). Including all docs but response quality may vary.`);
        contextNote = `Note: The full document library is very large. If you cannot find the answer in the provided context, let the user know and suggest they narrow their question.`;
    }

    const documentContext = formatDocumentsAsContext(
        documentsToInclude,
        '=== REFUGE HOUSE POLICY AND COMPLIANCE KNOWLEDGE BASE ===\n' +
        'The following documents represent the complete policy library. ' +
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
            estimatedContextTokens: totalTokens,
            model: CLAUDE_MODEL,
            responseTimeMs: elapsed,
            inputTokens: response.usage?.input_tokens || null,
            outputTokens: response.usage?.output_tokens || null,
            timestamp: new Date().toISOString()
        }
    };
}

module.exports = { chat };
