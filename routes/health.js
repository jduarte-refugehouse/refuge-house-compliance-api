// routes/health.js - Health check endpoint (mirrors Pulse's /health pattern)
const express = require('express');
const router = express.Router();
const { getAllDocuments, getCategorySummary, getManifest, estimateTokens } = require('../services/knowbase-loader');

router.get('/health', async (req, res) => {
    const docs = getAllDocuments();
    const docCount = Object.keys(docs).length;

    // Check database connectivity
    let dbStatus = 'not configured';
    try {
        if (process.env.COMPLIANCE_DB_PASSWORD || process.env.COMPLIANCE_DB_SERVER) {
            const { poolPromise } = require('../services/db');
            const pool = await poolPromise;
            await pool.request().query('SELECT 1');
            dbStatus = 'connected';
        }
    } catch (err) {
        dbStatus = `error: ${err.message}`;
    }

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
        database: {
            status: dbStatus,
            name: process.env.COMPLIANCE_DB_NAME || 'RadiusCompliance'
        },
        endpoints: {
            chat: 'POST /api/chat',
            generate: 'POST /api/generate/service-plan',
            evaluate: 'POST /api/evaluate/:type',
            documents: 'GET /api/documents',
            compliance_documents: 'GET /api/compliance/documents',
            compliance_regulations: 'GET /api/compliance/regulations',
            compliance_reviews: 'GET /api/compliance/reviews',
            compliance_dashboard: 'GET /api/compliance/dashboard',
            compliance_timeline: 'GET /api/compliance/timeline'
        },
        anthropic: {
            configured: !!process.env.ANTHROPIC_COMPLIANCE_KEY,
            model: process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5'
        }
    });
});

module.exports = router;
