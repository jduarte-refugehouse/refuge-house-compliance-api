// routes/chat.js - Conversational policy Q&A endpoint
// This is the primary endpoint for staff to ask questions about policies,
// procedures, and regulatory requirements.
const express = require('express');
const router = express.Router();
const { chat } = require('../services/chat');

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

module.exports = router;
