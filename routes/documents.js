// routes/documents.js - Browse and inspect loaded knowbase documents
const express = require('express');
const router = express.Router();
const { getAllDocuments, getDocument, getDocumentIndex, buildDocumentIndex, getCategorySummary, searchDocuments, estimateTokens } = require('../services/knowbase-loader');
const { listEvaluationTypes } = require('../services/context-builder');

// GET /api/documents - List all loaded documents with categories
router.get('/', (req, res) => {
    const docs = getAllDocuments();
    const listing = {};

    for (const [path, doc] of Object.entries(docs)) {
        listing[path] = {
            category: doc.category,
            lastModified: doc.lastModified,
            sizeBytes: doc.sizeBytes
        };
    }

    res.json({
        count: Object.keys(listing).length,
        categories: getCategorySummary(),
        totalEstimatedTokens: estimateTokens(docs),
        documents: listing
    });
});

// GET /api/documents/evaluation-types - List available evaluation types
router.get('/evaluation-types', (req, res) => {
    res.json(listEvaluationTypes());
});

// GET /api/documents/view?path=... - View a specific document's content
router.get('/view', (req, res) => {
    const docPath = req.query.path;
    if (!docPath) {
        return res.status(400).json({ error: 'Missing required query parameter: path' });
    }

    const doc = getDocument(docPath);
    if (!doc) {
        return res.status(404).json({ error: `Document not found: ${docPath}` });
    }

    res.json({
        path: docPath,
        lastModified: doc.lastModified,
        sizeBytes: doc.sizeBytes,
        content: doc.content
    });
});

// GET /api/documents/index - View the auto-generated document index used for retrieval
router.get('/index', (req, res) => {
    const index = getDocumentIndex();
    const docPath = req.query.path;

    if (docPath) {
        // Return index for a specific document
        if (!index[docPath]) {
            return res.status(404).json({ error: `Document not found in index: ${docPath}` });
        }
        return res.json({ path: docPath, ...index[docPath] });
    }

    // Return full index
    res.json({
        count: Object.keys(index).length,
        index
    });
});

// POST /api/documents/refresh - Fetch latest documents from GitHub and re-index any changes
router.post('/refresh', async (req, res) => {
    try {
        const { syncKnowbase } = require('../services/knowbase-loader');
        await syncKnowbase();
        const docs = getAllDocuments();
        const index = getDocumentIndex();
        res.json({
            status: 'refreshed',
            documentsLoaded: Object.keys(docs).length,
            documentsIndexed: Object.keys(index).length
        });
    } catch (err) {
        console.error('[DOCUMENTS] Refresh failed:', err);
        res.status(500).json({ error: 'Failed to refresh knowbase', message: err.message });
    }
});

// POST /api/documents/reindex - Force a full re-index of all documents (ignores cache)
// Use this after updating the indexing logic or when you suspect the index is stale.
router.post('/reindex', (req, res) => {
    try {
        const stats = buildDocumentIndex(true); // force = true
        res.json({
            status: 'reindexed',
            ...stats
        });
    } catch (err) {
        console.error('[DOCUMENTS] Reindex failed:', err);
        res.status(500).json({ error: 'Failed to reindex documents', message: err.message });
    }
});

module.exports = router;
