// routes/compliance-dashboard.js - Timeline, overdue, dashboard stats, regulatory coverage
const express = require('express');
const router = express.Router();
const dashboardService = require('../services/compliance-dashboard');
const historyService = require('../services/compliance-history');

// GET /api/compliance/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const dashboard = await dashboardService.getDashboard();
        res.json(dashboard);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] Failed:', err);
        res.status(500).json({ error: 'Failed to get dashboard', message: err.message });
    }
});

// GET /api/compliance/dashboard/regulatory
router.get('/dashboard/regulatory', async (req, res) => {
    try {
        const regulatory = await dashboardService.getRegulatoryDashboard();
        res.json(regulatory);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] Regulatory dashboard failed:', err);
        res.status(500).json({ error: 'Failed to get regulatory dashboard', message: err.message });
    }
});

// GET /api/compliance/timeline
router.get('/timeline', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 90;
        const timeline = await dashboardService.getTimeline({ days });
        res.json(timeline);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] Timeline failed:', err);
        res.status(500).json({ error: 'Failed to get timeline', message: err.message });
    }
});

// GET /api/compliance/timeline/overdue
router.get('/timeline/overdue', async (req, res) => {
    try {
        const overdue = await dashboardService.getOverdue();
        res.json(overdue);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] Overdue failed:', err);
        res.status(500).json({ error: 'Failed to get overdue', message: err.message });
    }
});

// GET /api/compliance/history
router.get('/history', async (req, res) => {
    try {
        const history = await historyService.queryHistory({
            documentId: req.query.document_id ? parseInt(req.query.document_id) : null,
            reviewId: req.query.review_id ? parseInt(req.query.review_id) : null,
            userId: req.query.user_id ? parseInt(req.query.user_id) : null,
            action: req.query.action,
            startDate: req.query.start_date,
            endDate: req.query.end_date,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        });
        res.json(history);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] History failed:', err);
        res.status(500).json({ error: 'Failed to get history', message: err.message });
    }
});

// GET /api/compliance/history/:documentId
router.get('/history/:documentId', async (req, res) => {
    try {
        const history = await historyService.queryHistory({
            documentId: parseInt(req.params.documentId),
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        });
        res.json(history);
    } catch (err) {
        console.error('[COMPLIANCE-DASHBOARD] Document history failed:', err);
        res.status(500).json({ error: 'Failed to get document history', message: err.message });
    }
});

module.exports = router;
