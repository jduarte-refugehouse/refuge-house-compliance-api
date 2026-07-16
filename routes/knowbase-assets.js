// routes/knowbase-assets.js — serve non-markdown knowbase assets at their
// repo-root path shape.
//
// The knowbase convention is "everything is link-addressable": markdown docs
// link forms/PDFs/JSON by relative path (e.g. an FC-WCM procedure links
// ../../forms/home-monitoring/...html and ...pdf), which the browser resolves
// against the doc page URL to the repo-root path shape (/forms/home-monitoring/...).
// This route serves exactly that shape for any asset indexed on sync, so those
// relative links work with zero link rewriting — now and for future assets.
//
// It is mounted LAST (as a fallback) and only responds for paths that are in the
// asset index, so it can never shadow existing API/doc routes: an unindexed path
// falls through to the normal 404.
//
//   GET /<repo-path>   e.g. GET /forms/home-monitoring/Home-Monitoring-...PRINT.pdf
//
// Access: assets carry no frontmatter, so they default to `staff` (restrictive,
// same posture as untagged docs) and are served only through the Azure-
// authenticated human plane. A signed-out request gets an auth challenge (302 to
// Entra for HTML, 401 for JSON) — never a 404.
const express = require('express');
const router = express.Router();
const { getAsset, fetchAssetBytes, refreshIfStale } = require('../services/knowbase-loader');
const { allows, deny } = require('../middleware/human-auth');

// Extensions this route will serve, matched at the end of the URL path.
const ASSET_ROUTE_RE = /\.(?:html|pdf|json|png|svg|jpe?g)$/i;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.pdf': 'application/pdf',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
};

router.get(ASSET_ROUTE_RE, async (req, res, next) => {
    // Normalize to a repo-relative path: strip the leading slash and decode.
    let repoPath = req.path.replace(/^\/+/, '');
    try {
        repoPath = decodeURIComponent(repoPath);
    } catch (_e) {
        return next(); // malformed encoding — not an asset we index
    }

    // Only handle indexed assets; anything else falls through to the normal 404
    // so this fallback never shadows real routes.
    await refreshIfStale();
    const entry = getAsset(repoPath);
    if (!entry) return next();

    // Assets default to staff (no frontmatter to carry a tier). Signed-out ⇒
    // auth challenge via deny(), not a 404.
    if (!allows(req, 'staff')) {
        return deny(req, res, 'staff');
    }

    try {
        const asset = await fetchAssetBytes(repoPath);
        if (!asset) return next();

        const filename = repoPath.split('/').pop().replace(/"/g, '');
        res.setHeader('Content-Type', CONTENT_TYPES[entry.ext] || 'application/octet-stream');
        // Inline so PDFs open in the browser viewer (and "Download PDF" still
        // saves naturally); HTML renders; JSON/images display.
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Content-Length', asset.buffer.length);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Bytes are immutable per SHA; a short cache spares the GitHub API while
        // keeping updates (new SHA on re-sync) quick to propagate.
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.send(asset.buffer);
    } catch (err) {
        const status = err.status || 502;
        console.error(`[KB-ASSETS] Failed to serve ${repoPath}: ${err.message}`);
        return res.status(status).json({ error: 'Failed to fetch asset', path: repoPath });
    }
});

module.exports = router;
module.exports._internal = { ASSET_ROUTE_RE, CONTENT_TYPES };
