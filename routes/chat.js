// routes/chat.js - Conversational policy Q&A endpoint
// This is the primary endpoint for staff to ask questions about policies,
// procedures, and regulatory requirements.
const express = require('express');
const router = express.Router();
const { chat, chatStream } = require('../services/chat');

/**
 * POST /api/chat
 *
 * Ask a question about Refuge House policies, procedures, or regulations.
 * Supports multi-turn conversations by passing message history.
 *
 * Request body:
 * {
 *   "message": "How frequently does a child in the IDD/Autism Package need to have their CANS redone?",
 *   "history": [                    // optional: previous messages for multi-turn
 *     { "role": "user", "content": "What is the CANS assessment?" },
 *     { "role": "assistant", "content": "The CANS (Child and Adolescent Needs and Strengths) is..." }
 *   ]
 * }
 *
 * Response:
 * {
 *   "answer": "According to FC-IDD-01 Section 4.3, children in the IDD/Autism Package...",
 *   "_meta": { documentsInContext, responseTimeMs, ... }
 * }
 */
router.post('/', async (req, res) => {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({
            error: 'Missing required field: message',
            hint: 'Send a question as a string in the "message" field'
        });
    }

    // Validate history format if provided
    if (history) {
        if (!Array.isArray(history)) {
            return res.status(400).json({
                error: 'Invalid history format',
                hint: 'history must be an array of { role: "user"|"assistant", content: "..." } objects'
            });
        }
        for (const msg of history) {
            if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
                return res.status(400).json({
                    error: 'Invalid message in history',
                    hint: 'Each history message must have a "role" (user or assistant) and "content" (string)'
                });
            }
        }
    }

    try {
        const result = await chat(message.trim(), history || []);
        res.json(result);
    } catch (err) {
        console.error('[CHAT] Error:', err);
        res.status(500).json({
            error: 'Chat failed',
            message: err.message
        });
    }
});

/**
 * POST /api/chat/stream
 *
 * Streaming version of the chat endpoint using Server-Sent Events.
 * Tokens appear in real-time as Claude generates them.
 *
 * Same request body as POST /api/chat.
 * Response is text/event-stream with events: meta, text, done, error.
 */
router.post('/stream', async (req, res) => {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({
            error: 'Missing required field: message',
            hint: 'Send a question as a string in the "message" field'
        });
    }

    if (history) {
        if (!Array.isArray(history)) {
            return res.status(400).json({ error: 'Invalid history format' });
        }
        for (const msg of history) {
            if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
                return res.status(400).json({ error: 'Invalid message in history' });
            }
        }
    }

    // Set up SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no' // Disable nginx buffering on Azure
    });

    try {
        for await (const event of chatStream(message.trim(), history || [])) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    } catch (err) {
        console.error('[CHAT] Stream error:', err);
        res.write(`data: ${JSON.stringify({ type: 'error', data: err.message })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
});

module.exports = router;
