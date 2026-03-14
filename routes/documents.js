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

// GET /api/documents/directory - Pre-grouped document directory for Pulse navigation
// Returns documents organized by category, with optional grouping by service package.
// Query params:
//   ?group_by=category (default) | service_package
//   ?include_index=true  — include index metadata (headings, topics, regulations) per document
router.get('/directory', (req, res) => {
    const docs = getAllDocuments();
    const index = getDocumentIndex();
    const groupBy = req.query.group_by || 'category';
    const includeIndex = req.query.include_index === 'true';

    // Category display labels
    const categoryLabels = {
        'policy': 'Policies & Procedures',
        'regulatory': 'Regulatory References',
        'treatment-model': 'Treatment Model & Frameworks',
        'guide': 'Guides & AI Development',
        'template': 'Templates & Forms',
        'training': 'Training Materials',
        'operational': 'Operational Documents',
        'cqi': 'Continuous Quality Improvement',
        'logic-model': 'Logic Models',
        'general': 'General'
    };

    // Build document entries
    function buildEntry(docPath, doc) {
        const entry = {
            path: docPath,
            title: formatTitle(docPath),
            category: doc.category,
            lastModified: doc.lastModified,
            sizeBytes: doc.sizeBytes
        };
        if (includeIndex && index[docPath]) {
            entry.summary = index[docPath].summary;
            entry.headings = index[docPath].headings;
            entry.topics = index[docPath].topics;
            entry.regulations = index[docPath].regulations;
            entry.packages = index[docPath].packages;
            entry.tokenEstimate = index[docPath].tokenEstimate;
        }
        return entry;
    }

    // Derive a readable title from the file path
    function formatTitle(docPath) {
        const basename = docPath.split('/').pop().replace(/\.md$/, '');
        return basename
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    if (groupBy === 'service_package') {
        // Group by service package (a document can appear in multiple groups)
        const directory = {};
        for (const [docPath, doc] of Object.entries(docs)) {
            const entry = buildEntry(docPath, doc);
            const packages = index[docPath]?.packages || [];

            if (packages.length === 0) {
                // No specific package — file under "General"
                if (!directory['General']) {
                    directory['General'] = { label: 'General / All Packages', documents: [] };
                }
                directory['General'].documents.push(entry);
            } else {
                for (const pkg of packages) {
                    if (!directory[pkg]) {
                        directory[pkg] = { label: pkg, documents: [] };
                    }
                    directory[pkg].documents.push(entry);
                }
            }
        }

        // Sort documents within each group alphabetically by title
        for (const group of Object.values(directory)) {
            group.documents.sort((a, b) => a.title.localeCompare(b.title));
            group.count = group.documents.length;
        }

        return res.json({
            groupedBy: 'service_package',
            totalDocuments: Object.keys(docs).length,
            groups: Object.keys(directory).length,
            directory
        });
    }

    // Default: group by category
    const directory = {};
    for (const [docPath, doc] of Object.entries(docs)) {
        const cat = doc.category;
        if (!directory[cat]) {
            directory[cat] = {
                label: categoryLabels[cat] || cat,
                documents: []
            };
        }
        directory[cat].documents.push(buildEntry(docPath, doc));
    }

    // Sort documents within each category alphabetically by title
    for (const group of Object.values(directory)) {
        group.documents.sort((a, b) => a.title.localeCompare(b.title));
        group.count = group.documents.length;
    }

    res.json({
        groupedBy: 'category',
        totalDocuments: Object.keys(docs).length,
        groups: Object.keys(directory).length,
        directory
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
