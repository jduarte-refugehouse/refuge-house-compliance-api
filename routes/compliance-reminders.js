// routes/compliance-reminders.js - Reminder configuration and check trigger
const express = require('express');
const router = express.Router();
const reminderService = require('../services/compliance-reminders');

// GET /api/compliance/reminders
router.get('/', async (req, res) => {
    try {
        const reminders = await reminderService.listAll();
        res.json(reminders);
    } catch (err) {
        console.error('[COMPLIANCE-REMINDERS] List failed:', err);
        res.status(500).json({ error: 'Failed to list reminders', message: err.message });
    }
});

// PUT /api/compliance/reminders/:documentId
router.put('/:documentId', async (req, res) => {
    try {
        const { reminders } = req.body;
        if (!Array.isArray(reminders)) {
            return res.status(400).json({ error: 'Required field: reminders (array)' });
        }
        await reminderService.upsert(parseInt(req.params.documentId), reminders);
        res.json({ updated: true });
    } catch (err) {
        console.error('[COMPLIANCE-REMINDERS] Update failed:', err);
        res.status(500).json({ error: 'Failed to update reminders', message: err.message });
    }
});

// POST /api/compliance/reminders/check - Trigger reminder check (called by timer/cron)
router.post('/check', async (req, res) => {
    try {
        const fired = await reminderService.check();
        res.json({
            checked_at: new Date().toISOString(),
            reminders_fired: fired.length,
            reminders: fired
        });
    } catch (err) {
        console.error('[COMPLIANCE-REMINDERS] Check failed:', err);
        res.status(500).json({ error: 'Failed to check reminders', message: err.message });
    }
});

module.exports = router;
