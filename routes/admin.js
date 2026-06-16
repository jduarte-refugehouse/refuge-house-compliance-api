// routes/admin.js - Protected administrative endpoints.
//
// Mounted under /api/admin, so every route here inherits the COMPLIANCE_API_KEY
// gate applied to /api in server.js (callers must send a valid x-api-key).
// As defense-in-depth, a dedicated ADMIN_API_KEY may be set to further restrict
// these operations beyond the general service key.
const express = require('express');
const router = express.Router();
const { syncKnowbase, getAllDocuments, getCategorySummary, getManifest } = require('../services/knowbase-loader');
const cookbook = require('../services/content-cookbook');

// Optional second factor: if ADMIN_API_KEY is set, require it in addition to the
// /api COMPLIANCE_API_KEY gate. If unset, the inherited /api gate is sufficient.
router.use((req, res, next) => {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) return next();
    if (req.headers['x-admin-key'] === adminKey) return next();
    return res.status(403).json({ error: 'Forbidden - invalid or missing x-admin-key' });
});

// POST /api/admin/sync-knowbase
// Manually re-pull the knowbase from GitHub and re-mirror the content cookbook.
// Useful when the GitHub push webhook is not wired up or a sync needs forcing.
router.post('/sync-knowbase', async (req, res) => {
    const startedAt = new Date().toISOString();
    try {
        console.log('[ADMIN] Manual knowbase sync requested');
        await syncKnowbase();

        // Mirror the cookbook too so the full public surface refreshes together.
        let cookbookSynced = false;
        try {
            await cookbook.syncCookbook();
            cookbookSynced = true;
        } catch (err) {
            console.warn('[ADMIN] Cookbook sync failed during manual re-sync:', err.message);
        }

        const docs = getAllDocuments();
        return res.json({
            status: 'ok',
            startedAt,
            completedAt: new Date().toISOString(),
            knowbase: {
                documentsLoaded: Object.keys(docs).length,
                categories: getCategorySummary(),
                manifestLoaded: !!getManifest()
            },
            cookbookSynced
        });
    } catch (err) {
        console.error('[ADMIN] Manual knowbase sync failed:', err.message);
        return res.status(500).json({
            status: 'error',
            startedAt,
            error: err.message
        });
    }
});

module.exports = router;
