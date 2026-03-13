// routes/compliance-regulations.js - Regulatory sources + mappings + change tracking
const express = require('express');
const router = express.Router();
const regService = require('../services/regulatory-sources');

// GET /api/compliance/regulations
router.get('/', async (req, res) => {
    try {
        const regs = await regService.list({
            authority: req.query.authority,
            status: req.query.status,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        });
        res.json(regs);
    } catch (err) {
        console.error('[COMPLIANCE-REGS] List failed:', err);
        res.status(500).json({ error: 'Failed to list regulations', message: err.message });
    }
});

// GET /api/compliance/regulations/:id
router.get('/:id', async (req, res) => {
    try {
        const reg = await regService.getById(parseInt(req.params.id));
        if (!reg) return res.status(404).json({ error: 'Regulation not found' });
        res.json(reg);
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Get failed:', err);
        res.status(500).json({ error: 'Failed to get regulation', message: err.message });
    }
});

// POST /api/compliance/regulations
router.post('/', async (req, res) => {
    try {
        const { authority, title } = req.body;
        if (!authority || !title) {
            return res.status(400).json({ error: 'Required fields: authority, title' });
        }
        const id = await regService.create(req.body);
        res.status(201).json({ id });
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Create failed:', err);
        res.status(500).json({ error: 'Failed to create regulation', message: err.message });
    }
});

// PUT /api/compliance/regulations/:id
router.put('/:id', async (req, res) => {
    try {
        const updated = await regService.update(parseInt(req.params.id), req.body);
        if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
        res.json({ updated: true });
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Update failed:', err);
        res.status(500).json({ error: 'Failed to update regulation', message: err.message });
    }
});

// GET /api/compliance/regulations/:id/documents
router.get('/:id/documents', async (req, res) => {
    try {
        const docs = await regService.getDocuments(parseInt(req.params.id));
        res.json(docs);
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Get documents failed:', err);
        res.status(500).json({ error: 'Failed to get documents', message: err.message });
    }
});

// POST /api/compliance/regulations/:id/change - Record a regulatory change, triggers reviews on mapped docs
router.post('/:id/change', async (req, res) => {
    try {
        const { change_description } = req.body;
        if (!change_description) {
            return res.status(400).json({ error: 'Required field: change_description' });
        }
        const result = await regService.recordChange(parseInt(req.params.id), {
            changeDescription: change_description,
            userId: req.body.user_id
        });
        res.json({
            regulatory_change_recorded: true,
            reviews_created: result.affectedDocumentIds.length,
            affected_documents: result.affectedDocuments
        });
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Record change failed:', err);
        res.status(500).json({ error: 'Failed to record regulatory change', message: err.message });
    }
});

// DELETE /api/compliance/document-regulations/:id - Remove a mapping
router.delete('/document-regulations/:id', async (req, res) => {
    try {
        await regService.removeMapping(parseInt(req.params.id));
        res.json({ deleted: true });
    } catch (err) {
        console.error('[COMPLIANCE-REGS] Remove mapping failed:', err);
        res.status(500).json({ error: 'Failed to remove mapping', message: err.message });
    }
});

module.exports = router;
