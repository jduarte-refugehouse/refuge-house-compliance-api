// routes/site-index.js
// Public Site Index for quickly browsing sender-backed content in Compliance API.
// No API key required.
const express = require('express');
const router = express.Router();
const { getAllDocuments, getAllStaticPages } = require('../services/knowbase-loader');
const cookbook = require('../services/content-cookbook');
const { applyCookbookBranding } = require('../utils/cookbook-branding');

function pathToSlug(docPath) {
    const basename = String(docPath || '').split('/').pop().replace(/\.md$/i, '');
    return basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getIndexData() {
    try {
        await cookbook.refreshIfStale();
    } catch (err) {
        // Non-fatal for index view; still show what we can from knowbase loader.
        console.warn('[SITE-INDEX] cookbook refresh failed:', err.message);
    }

    const allDocs = Object.entries(getAllDocuments());
    const policyProcedureDocs = allDocs
        .filter(([docPath]) =>
            docPath.startsWith('policies-procedures/Policy/') ||
            docPath.startsWith('policies-procedures/Procedure/') ||
            docPath.startsWith('policies-procedures/Policy-and-Procedure/')
        )
        .map(([docPath, doc]) => ({
            path: docPath,
            title: docPath.split('/').pop().replace(/\.md$/i, ''),
            slug: pathToSlug(docPath),
            category: doc?.category || null
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    const staticPages = Object.entries(getAllStaticPages())
        .map(([name, page]) => ({
            type: 'static-page',
            slug: name,
            title: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
            sourcePath: page.path,
            url: `/pages/${name}`
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    const cookbookEntries = cookbook
        .listEntries({ status: 'active' })
        .map((entry) => ({
            type: 'cookbook-entry',
            slug: entry.slug,
            title: entry.title,
            contentType: entry.contentType || null,
            domain: entry.domain || null,
            sourcePath: entry.path || null,
            url: `/site-index/cookbook/${entry.slug}`
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    return {
        generatedAt: new Date().toISOString(),
        policyProcedureDocs,
        staticResourcesAndGuides: [...staticPages, ...cookbookEntries]
    };
}

router.get('/site-index.json', async (req, res) => {
    const data = await getIndexData();
    res.json({
        generatedAt: data.generatedAt,
        counts: {
            policyProcedure: data.policyProcedureDocs.length,
            staticResourcesAndGuides: data.staticResourcesAndGuides.length
        },
        policyProcedureDocs: data.policyProcedureDocs,
        staticResourcesAndGuides: data.staticResourcesAndGuides
    });
});

router.get('/site-index', async (req, res) => {
    const data = await getIndexData();

    const policyRows = data.policyProcedureDocs
        .map((d) => `<li><a href="/public/documents/${escapeHtml(d.slug)}" target="_blank" rel="noopener">${escapeHtml(d.title)}</a><span class="meta">${escapeHtml(d.path)}</span></li>`)
        .join('');

    const resourceRows = data.staticResourcesAndGuides
        .map((r) => `<li><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a><span class="meta">${escapeHtml(r.type)}${r.contentType ? ` · ${escapeHtml(r.contentType)}` : ''}${r.domain ? ` · ${escapeHtml(r.domain)}` : ''}</span></li>`)
        .join('');

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Site Index - Refuge House Compliance API</title>
  <link rel="icon" type="image/png" href="/favicon.png" />
  <style>
    :root {
      --rh-primary: #5E3989;
      --rh-primary-dark: #3c2556;
      --rh-accent: #A90533;
      --rh-bg: #f8fafc;
      --rh-light-purple: #f3e9fa;
      --rh-surface: #ffffff;
      --rh-border: #e2e8f0;
      --rh-text: #1e293b;
      --rh-muted: #475569;
    }
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; margin: 0; background: var(--rh-bg); color: var(--rh-text); }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 40px; }
    h1 { margin: 0 0 6px; }
    .subtitle { color: var(--rh-muted); margin: 0 0 18px; }
    .topbar { display: flex; gap: 10px; align-items: center; margin-bottom: 16px; }
    .btn { display:inline-block; padding: 8px 12px; border:1px solid #d4b5e4; border-radius: 8px; background: var(--rh-light-purple); color: var(--rh-primary); text-decoration:none; font-size: 14px; }
    .btn:hover { background: #ead8f4; }
    .panel { background: var(--rh-surface); border: 1px solid var(--rh-border); border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
    .counts { font-size: 13px; color: var(--rh-muted); margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    ul { margin: 0; padding-left: 18px; max-height: 520px; overflow: auto; }
    li { margin: 0 0 8px; }
    .meta { display: block; font-size: 12px; color: var(--rh-muted); }
    a { color: var(--rh-accent); }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="wrap">
    <h1>Site Index</h1>
    <p class="subtitle">Public index of key content available through the Compliance API.</p>
    <div class="topbar">
      <a class="btn" href="/">← Back to Compliance Library</a>
      <a class="btn" href="/site-index.json" target="_blank" rel="noopener">View JSON Index</a>
    </div>

    <section class="panel counts">
      Generated: ${escapeHtml(data.generatedAt)} · Policies/Procedures: ${data.policyProcedureDocs.length} · Static Resources & Guides: ${data.staticResourcesAndGuides.length}
    </section>

    <section class="grid">
      <section class="panel">
        <h2>Policies and Procedures</h2>
        <ul>${policyRows || '<li>No entries found.</li>'}</ul>
      </section>

      <section class="panel">
        <h2>Static Resources and Guides</h2>
        <ul>${resourceRows || '<li>No entries found.</li>'}</ul>
      </section>
    </section>
  </main>
</body>
</html>`);
});

// Public HTML rendering for cookbook entries from mirrored registry.
router.get('/site-index/cookbook/:slug', async (req, res) => {
    try {
        await cookbook.refreshIfStale();
    } catch (err) {
        console.warn('[SITE-INDEX] cookbook refresh failed:', err.message);
    }

    const entry = cookbook.getEntry(req.params.slug);
    if (!entry) {
        return res.status(404).type('html').send('<!doctype html><h1>Cookbook entry not found</h1>');
    }
    const html = cookbook.getHtml(req.params.slug);
    if (!html) {
        return res.status(404).type('html').send('<!doctype html><h1>Cookbook HTML not mirrored</h1>');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Content-Slug', entry.slug);
    res.setHeader('X-Content-Status', entry.status);
    res.send(applyCookbookBranding(entry, html.content));
});

module.exports = router;
