// routes/health.js - Health check endpoint (mirrors Pulse's /health pattern)
const express = require('express');
const router = express.Router();
const { getAllDocuments, getCategorySummary, getManifest, estimateTokens } = require('../services/knowbase-loader');

router.get('/health', (req, res) => {
    const docs = getAllDocuments();
    const docCount = Object.keys(docs).length;

    res.json({
        status: 'ok',
        service: 'refuge-house-compliance-api',
        timestamp: new Date().toISOString(),
        knowbase: {
            documentsLoaded: docCount,
            estimatedTokens: estimateTokens(docs),
            categories: getCategorySummary(),
            manifestLoaded: !!getManifest(),
            status: docCount > 0 ? 'ready' : 'empty'
        },
        endpoints: {
            chat: 'POST /api/chat',
            generate: 'POST /api/generate/service-plan',
            evaluate: 'POST /api/evaluate/:type',
            documents: 'GET /api/documents'
        },
        anthropic: {
            configured: !!process.env.ANTHROPIC_COMPLIANCE_KEY,
            model: process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5'
        }
    });
});

module.exports = router;
