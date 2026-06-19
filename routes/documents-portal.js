// routes/documents-portal.js
// Link-addressable, Azure-gated document portal (CLAUDE.md §9–§10).
//
// Serves ANY loaded knowbase markdown asset by slug OR repo path — including
// `listed: false` assets and anything under temporary-reference/ — gated by the
// asset's own frontmatter `access` tier (default-restrictive = staff). Per §9,
// `listed: false` governs listings / nav / default retrieval, NOT direct
// addressing: these assets stay retrievable HERE by anyone the tier permits.
//
// Gating mirrors the rest of the human plane (middleware/human-auth):
//   public           -> served to anyone (also at the canonical /public/... URL)
//   staff (or absent) -> requires an Azure (Entra/Easy Auth) staff principal
//   reviewer          -> staff principal OR a valid rolling reviewer key
// Staff/reviewer assets are never served unauthenticated (in enforce mode).
//
//   GET /documents                         -> JSON document API (canonical urls)
//   GET /documents/<slug>                  -> rendered HTML (?format=json|markdown)
//   GET /documents/<repo/path.md>          -> same asset, addressed by exact path
//   GET /documents/<slug>?download=1        -> raw markdown as an attachment
const express = require('express');
const router = express.Router();
const {
    getAllDocuments,
    getDocumentIndex,
    findDocBySlugOrPath,
    pathToSlug
} = require('../services/knowbase-loader');
const { allows, deny, wantsJson } = require('../middleware/human-auth');
const { accessForDoc } = require('../utils/access');
const { renderHtmlPage, getDocumentFamily } = require('./public-documents');

// These render live from the synced knowbase; never let a CDN cache a gated doc.
function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

function titleFor(docPath, doc) {
    return (doc && doc.frontTitle) || docPath.split('/').pop().replace(/\.md$/i, '');
}

// Canonical, link-generation-friendly descriptor for an asset.
function descriptorFor(docPath, doc) {
    const slug = pathToSlug(docPath);
    const access = accessForDoc(doc);
    return {
        slug,
        path: docPath,
        title: titleFor(docPath, doc),
        access,
        listed: doc.listed !== false,
        status: doc.status || null,
        family: getDocumentFamily(docPath).label,
        category: doc.category,
        lastModified: doc.lastModified,
        // Canonical authenticated address for link generation.
        url: `/documents/${slug}`,
        // Public mirror only exists for public-tier assets.
        publicUrl: access === 'public' ? `/public/documents/${slug}` : null
    };
}

// GET /documents — document API: every asset the caller may access, each with a
// canonical URL for link generation. Includes listed:false assets (direct
// retrieval is allowed), but a caller only sees items their tier permits, so the
// index can't be used to enumerate gated content.
router.get('/', (req, res) => {
    noStore(res);
    const docs = getAllDocuments();
    const index = getDocumentIndex();
    const out = [];
    for (const [docPath, doc] of Object.entries(docs)) {
        if (!allows(req, accessForDoc(doc))) continue;
        const d = descriptorFor(docPath, doc);
        if (index[docPath] && index[docPath].summary) d.summary = index[docPath].summary;
        out.push(d);
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    res.json({ count: out.length, documents: out });
});

// GET /documents/<slug-or-path> — resolve + serve, gated by the asset's access.
router.get(/^\/(.+)/, (req, res) => {
    noStore(res);
    const id = req.params[0];
    const format = req.query.format || 'html';

    const result = findDocBySlugOrPath(id);
    if (!result) {
        if (format === 'json' || format === 'markdown' || wantsJson(req)) {
            return res.status(404).json({ error: `Document not found: ${id}` });
        }
        return res.status(404).type('html').send(
            '<!doctype html><body style="font-family:sans-serif;text-align:center;padding:4rem;">'
            + '<h2>Document Not Found</h2><p><a href="/documents">Document index</a></p></body>'
        );
    }

    const { path: docPath, doc } = result;

    // Enforce the asset's own tier (default-restrictive = staff). listed:false
    // is intentionally NOT checked here — direct addressing is always allowed
    // for callers the tier permits.
    const tier = accessForDoc(doc);
    if (!allows(req, tier)) return deny(req, res, tier);

    if (format === 'json') {
        const d = descriptorFor(docPath, doc);
        d.content = doc.content;
        return res.json(d);
    }

    const wantsDownload = req.query.download === '1' || req.query.download === 'true';
    if (format === 'markdown' || wantsDownload) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        if (wantsDownload) {
            const fname = pathToSlug(docPath).replace(/[^a-z0-9._-]+/gi, '-') + '.md';
            res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        }
        return res.send(doc.content);
    }

    const title = titleFor(docPath, doc);
    const html = renderHtmlPage(title, doc.content, docPath, doc.lastModified, getAllDocuments());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

module.exports = router;
module.exports._internal = { descriptorFor };
