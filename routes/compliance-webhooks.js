// routes/compliance-webhooks.js - Pulse integration endpoints
// Endpoints that Pulse calls to trigger compliance actions, plus endpoints
// that return data formatted for Pulse's UI components.
const express = require('express');
const router = express.Router();

// POST /api/compliance/webhooks/reminder-check — Trigger reminder check + notify Pulse
// Called by Azure Function timer or Pulse's scheduled job.
router.post('/reminder-check', async (req, res) => {
    try {
        const { check } = require('../services/compliance-reminders');
        const { notifyReminders } = require('../services/pulse-notifier');

        const fired = await check();
        let notificationResults = [];

        if (fired.length > 0) {
            notificationResults = await notifyReminders(fired);
        }

        res.json({
            checked_at: new Date().toISOString(),
            reminders_fired: fired.length,
            notifications_sent: notificationResults.filter(r => r.sent).length,
            reminders: fired
        });
    } catch (err) {
        console.error('[WEBHOOKS] Reminder check failed:', err);
        res.status(500).json({ error: 'Failed to check reminders', message: err.message });
    }
});

// POST /api/compliance/webhooks/sync — Trigger knowbase sync + compliance registry sync + notify Pulse
// Called by Pulse or GitHub webhook when knowbase repo is updated.
router.post('/sync', async (req, res) => {
    try {
        const { syncKnowbase, getAllDocuments, getDocumentIndex } = require('../services/knowbase-loader');

        await syncKnowbase();

        // The compliance sync runs automatically inside syncKnowbase now,
        // but we can also get the results for the response
        const { syncComplianceRegistry } = require('../services/knowbase-sync');
        const syncResults = await syncComplianceRegistry();

        // Notify Pulse of any changes
        if (syncResults && !syncResults.skipped) {
            const { notifySyncResults } = require('../services/pulse-notifier');
            await notifySyncResults(syncResults);
        }

        const docs = getAllDocuments();
        const index = getDocumentIndex();

        res.json({
            status: 'synced',
            knowbase: {
                documents_loaded: Object.keys(docs).length,
                documents_indexed: Object.keys(index).length
            },
            compliance_sync: syncResults || { skipped: true }
        });
    } catch (err) {
        console.error('[WEBHOOKS] Sync failed:', err);
        res.status(500).json({ error: 'Failed to sync', message: err.message });
    }
});

// GET /api/compliance/webhooks/status — Integration status for Pulse health monitoring
router.get('/status', async (req, res) => {
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
        service: 'compliance-api',
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbStatus,
        pulse_webhook: process.env.PULSE_WEBHOOK_URL ? 'configured' : 'not configured',
        endpoints: {
            reminder_check: 'POST /api/compliance/webhooks/reminder-check',
            sync: 'POST /api/compliance/webhooks/sync',
            status: 'GET /api/compliance/webhooks/status',
            documents: 'GET /api/compliance/documents',
            reviews: 'GET /api/compliance/reviews',
            timeline: 'GET /api/compliance/timeline',
            dashboard: 'GET /api/compliance/dashboard',
            overdue: 'GET /api/compliance/timeline/overdue',
            history: 'GET /api/compliance/history',
            ai_review: 'POST /api/compliance/reviews/:id/ai-analysis',
            impact_analysis: 'POST /api/compliance/regulations/impact-analysis'
        }
    });
});

// POST /api/compliance/webhooks/notify — Generic notification endpoint (for testing)
// Sends a test notification to Pulse to verify webhook connectivity.
router.post('/notify', async (req, res) => {
    try {
        const { notify } = require('../services/pulse-notifier');
        const result = await notify(req.body.event || 'test', req.body.data || { test: true });
        res.json(result);
    } catch (err) {
        console.error('[WEBHOOKS] Test notification failed:', err);
        res.status(500).json({ error: 'Failed to send notification', message: err.message });
    }
});

module.exports = router;
