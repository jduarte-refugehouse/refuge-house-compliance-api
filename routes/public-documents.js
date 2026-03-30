// routes/public-documents.js - Public (unauthenticated) document endpoints
// Serves rendered HTML versions of knowbase documents for sharing, embedding,
// and linking from external apps (e.g., foster parent portal).
const express = require('express');
const { marked } = require('marked');
const router = express.Router();
const { getAllDocuments, getDocument, getDocumentIndex } = require('../services/knowbase-loader');

/**
 * Generate a URL-safe slug from a document path.
 * "plans/Emergency Response Disaster Recovery and Business Continuity Plan.md"
 *   -> "emergency-response-disaster-recovery-and-business-continuity-plan"
 */
function pathToSlug(docPath) {
    const basename = docPath.split('/').pop().replace(/\.md$/i, '');
    return basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Find a document by its slug (matches against all loaded documents).
 * Returns { path, doc } or null.
 */
function findBySlug(slug) {
    const docs = getAllDocuments();
    for (const [docPath, doc] of Object.entries(docs)) {
        if (pathToSlug(docPath) === slug) {
            return { path: docPath, doc };
        }
    }
    return null;
}

/**
 * Render a self-contained, branded HTML page from markdown content.
 */
function renderHtmlPage(title, markdownContent, docPath, lastModified) {
    const htmlBody = marked.parse(markdownContent);
    const year = new Date().getFullYear();
    const modifiedDate = lastModified
        ? new Date(lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Refuge House</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.7;
            color: #1a1a1a;
            background: #f8f9fa;
            margin: 0;
            padding: 0;
        }
        .header {
            background: #1b3a5c;
            color: white;
            padding: 1.5rem 2rem;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 1.3rem;
            font-weight: 600;
            letter-spacing: 0.02em;
        }
        .header .org-name {
            font-size: 0.85rem;
            opacity: 0.85;
            margin-top: 0.3rem;
        }
        .container {
            max-width: 850px;
            margin: 2rem auto;
            background: white;
            padding: 2.5rem 3rem;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .meta {
            font-size: 0.85rem;
            color: #666;
            border-bottom: 1px solid #e9ecef;
            padding-bottom: 1rem;
            margin-bottom: 2rem;
        }
        .content h1 { font-size: 1.6rem; margin-top: 2rem; color: #1b3a5c; }
        .content h2 { font-size: 1.3rem; margin-top: 1.8rem; color: #1b3a5c; border-bottom: 1px solid #e9ecef; padding-bottom: 0.3rem; }
        .content h3 { font-size: 1.1rem; margin-top: 1.5rem; color: #2c5282; }
        .content h4 { font-size: 1rem; margin-top: 1.2rem; color: #2c5282; }
        .content p { margin: 0.8rem 0; }
        .content ul, .content ol { padding-left: 1.5rem; }
        .content li { margin: 0.3rem 0; }
        .content table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        .content th, .content td { border: 1px solid #dee2e6; padding: 0.5rem 0.75rem; text-align: left; }
        .content th { background: #f1f3f5; font-weight: 600; }
        .content blockquote { border-left: 3px solid #1b3a5c; margin: 1rem 0; padding: 0.5rem 1rem; background: #f8f9fa; }
        .content code { background: #f1f3f5; padding: 0.15rem 0.4rem; border-radius: 3px; font-size: 0.9em; }
        .content pre { background: #f1f3f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
        .content pre code { background: none; padding: 0; }
        .content a { color: #2c5282; }
        .footer {
            text-align: center;
            font-size: 0.8rem;
            color: #999;
            padding: 2rem;
        }
        @media print {
            body { background: white; }
            .header { background: #1b3a5c; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .container { box-shadow: none; margin: 0; padding: 1.5rem; }
        }
        @media (max-width: 600px) {
            .container { padding: 1.5rem 1rem; margin: 1rem; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${title}</h1>
        <div class="org-name">Refuge House, Inc.</div>
    </div>
    <div class="container">
        <div class="meta">
            ${modifiedDate ? `Last updated: ${modifiedDate}` : ''}
            ${docPath ? ` &middot; Source: ${docPath}` : ''}
        </div>
        <div class="content">
            ${htmlBody}
        </div>
    </div>
    <div class="footer">
        &copy; ${year} Refuge House, Inc. &middot; This is a controlled document. Always refer to the current version.
    </div>
</body>
</html>`;
}

// GET /public/documents - List all publicly available documents with their slugs
router.get('/', (req, res) => {
    const docs = getAllDocuments();
    const index = getDocumentIndex();
    const listing = [];

    for (const [docPath, doc] of Object.entries(docs)) {
        const slug = pathToSlug(docPath);
        const entry = {
            slug,
            path: docPath,
            title: docPath.split('/').pop().replace(/\.md$/i, ''),
            category: doc.category,
            lastModified: doc.lastModified,
            url: `/public/documents/${slug}`
        };
        // Include summary if indexed
        if (index[docPath]?.summary) {
            entry.summary = index[docPath].summary;
        }
        listing.push(entry);
    }

    listing.sort((a, b) => a.title.localeCompare(b.title));

    res.json({
        count: listing.length,
        documents: listing
    });
});

// GET /public/documents/:slug - Render a document as a branded HTML page
// Query params:
//   ?format=json   — return JSON instead of HTML (for app embedding)
//   ?format=markdown — return raw markdown text
router.get('/:slug', (req, res) => {
    const { slug } = req.params;
    const format = req.query.format || 'html';

    const result = findBySlug(slug);
    if (!result) {
        if (format === 'json' || format === 'markdown') {
            return res.status(404).json({ error: `Document not found: ${slug}` });
        }
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:4rem;">
                <h2>Document Not Found</h2>
                <p>The document "${slug}" was not found.</p>
                <a href="/public/documents">View all documents</a>
            </body></html>
        `);
    }

    const { path: docPath, doc } = result;
    const title = docPath.split('/').pop().replace(/\.md$/i, '');

    if (format === 'json') {
        return res.json({
            slug,
            path: docPath,
            title,
            category: doc.category,
            lastModified: doc.lastModified,
            content: doc.content
        });
    }

    if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.send(doc.content);
    }

    // Default: render as branded HTML page
    const html = renderHtmlPage(title, doc.content, docPath, doc.lastModified);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

module.exports = router;
