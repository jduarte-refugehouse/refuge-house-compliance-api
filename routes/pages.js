// routes/pages.js - Public static HTML pages served from the knowbase repo
// These pages are PUBLIC (no API key required) — intended for external access
// by foster parents, staff, and other stakeholders.
//
// HTML files are stored in the knowbase repo under static-pages/ and synced
// into memory on startup. Drop a new .html file into static-pages/ in the
// knowbase repo, and it becomes available at /pages/<filename>.
const express = require('express');
const router = express.Router();
const { getStaticPage, getAllStaticPages } = require('../services/knowbase-loader');

// GET /pages — List all available static pages
router.get('/', (req, res) => {
    const pages = getAllStaticPages();
    const listing = {};

    for (const [name, page] of Object.entries(pages)) {
        listing[name] = {
            url: `/pages/${name}`,
            lastModified: page.lastModified,
            sizeBytes: page.sizeBytes,
            source: page.path
        };
    }

    res.json({
        count: Object.keys(listing).length,
        pages: listing
    });
});

// GET /pages/:pageName — Serve a static HTML page
router.get('/:pageName', (req, res) => {
    const pageName = req.params.pageName.replace(/\.html$/, '');
    const page = getStaticPage(pageName);

    if (!page) {
        return res.status(404).send(`
            <!DOCTYPE html>
            <html><head><title>Page Not Found</title></head>
            <body style="font-family: system-ui, sans-serif; text-align: center; padding: 60px;">
                <h1>Page Not Found</h1>
                <p>The page <strong>${pageName}</strong> does not exist.</p>
                <p><a href="/pages">View all available pages</a></p>
            </body></html>
        `);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(page.content);
});

module.exports = router;
