// routes/compliance-documents.js - Document registry + dependencies + regulatory mappings
const express = require('express');
const router = express.Router();
const docService = require('../services/compliance-documents');

// GET /api/compliance/documents
router.get('/', async (req, res) => {
    try {
        const docs = await docService.list({
            category: req.query.category,
            contentType: req.query.content_type,
            status: req.query.status,
            servicePackages: req.query.service_packages,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        });
        res.json(docs);
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] List failed:', err);
        res.status(500).json({ error: 'Failed to list documents', message: err.message });
    }
});

// GET /api/compliance/documents/:id
router.get('/:id', async (req, res) => {
    try {
        const doc = await docService.getById(parseInt(req.params.id));
        if (!doc) return res.status(404).json({ error: 'Document not found' });
        res.json(doc);
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Get failed:', err);
        res.status(500).json({ error: 'Failed to get document', message: err.message });
    }
});

// POST /api/compliance/documents
router.post('/', async (req, res) => {
    try {
        const { document_path, title, category } = req.body;
        if (!document_path || !title || !category) {
            return res.status(400).json({ error: 'Required fields: document_path, title, category' });
        }
        const id = await docService.create(req.body, req.body.user_id);
        res.status(201).json({ id });
    } catch (err) {
        if (err.message?.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Document with this path already exists' });
        }
        console.error('[COMPLIANCE-DOCS] Create failed:', err);
        res.status(500).json({ error: 'Failed to create document', message: err.message });
    }
});

// PUT /api/compliance/documents/:id
router.put('/:id', async (req, res) => {
    try {
        const updated = await docService.update(parseInt(req.params.id), req.body, req.body.user_id);
        if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
        res.json({ updated: true });
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Update failed:', err);
        res.status(500).json({ error: 'Failed to update document', message: err.message });
    }
});

// POST /api/compliance/documents/:id/sunset
router.post('/:id/sunset', async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) return res.status(400).json({ error: 'Required field: reason' });
        await docService.sunset(parseInt(req.params.id), {
            reason,
            supersededBy: req.body.superseded_by,
            userId: req.body.user_id
        });
        res.json({ sunset: true });
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Sunset failed:', err);
        res.status(500).json({ error: 'Failed to sunset document', message: err.message });
    }
});

// GET /api/compliance/documents/:id/dependencies
router.get('/:id/dependencies', async (req, res) => {
    try {
        const deps = await docService.getDependencies(parseInt(req.params.id));
        res.json(deps);
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Dependencies failed:', err);
        res.status(500).json({ error: 'Failed to get dependencies', message: err.message });
    }
});

// POST /api/compliance/documents/:id/dependencies
router.post('/:id/dependencies', async (req, res) => {
    try {
        const { dependent_document_id, dependency_type } = req.body;
        if (!dependent_document_id || !dependency_type) {
            return res.status(400).json({ error: 'Required fields: dependent_document_id, dependency_type' });
        }
        const id = await docService.addDependency({
            parentDocumentId: parseInt(req.params.id),
            dependentDocumentId: dependent_document_id,
            dependencyType: dependency_type,
            notes: req.body.notes
        });
        res.status(201).json({ id });
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Add dependency failed:', err);
        res.status(500).json({ error: 'Failed to add dependency', message: err.message });
    }
});

// DELETE /api/compliance/dependencies/:id
router.delete('/dependencies/:id', async (req, res) => {
    try {
        await docService.removeDependency(parseInt(req.params.id));
        res.json({ deleted: true });
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Remove dependency failed:', err);
        res.status(500).json({ error: 'Failed to remove dependency', message: err.message });
    }
});

// GET /api/compliance/documents/:id/regulations
router.get('/:id/regulations', async (req, res) => {
    try {
        const regs = await docService.getRegulations(parseInt(req.params.id));
        res.json(regs);
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Get regulations failed:', err);
        res.status(500).json({ error: 'Failed to get regulations', message: err.message });
    }
});

// POST /api/compliance/documents/:id/regulations
router.post('/:id/regulations', async (req, res) => {
    try {
        const { regulatory_source_id, mapping_type } = req.body;
        if (!regulatory_source_id) {
            return res.status(400).json({ error: 'Required field: regulatory_source_id' });
        }
        const regService = require('../services/regulatory-sources');
        const id = await regService.addMapping({
            documentId: parseInt(req.params.id),
            regulatorySourceId: regulatory_source_id,
            mappingType: mapping_type || 'implements',
            notes: req.body.notes
        });
        res.status(201).json({ id });
    } catch (err) {
        console.error('[COMPLIANCE-DOCS] Add regulation mapping failed:', err);
        res.status(500).json({ error: 'Failed to add mapping', message: err.message });
    }
});

module.exports = router;
