// routes/site-index.js — REDESIGNED to use the Refuge House design system.
// Data/plumbing (getIndexData, /site-index.json, grouping) is UNCHANGED from the
// original; only the /site-index HTML presentation was updated.
const express = require('express');
const router = express.Router();
const { getAllDocuments, getAllStaticPages } = require('../services/knowbase-loader');
const cookbook = require('../services/content-cookbook');
const { applyCookbookBranding } = require('../utils/cookbook-branding');
const { allows } = require('../middleware/human-auth');
const { accessForDoc } = require('../utils/access');
const { isSurfaceable } = require('../services/knowbase-loader');

function pathToSlug(docPath) {
    const basename = String(docPath || '').split('/').pop().replace(/\.md$/i, '');
    return basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function getIndexData(req) {
    try { await cookbook.refreshIfStale(); }
    catch (err) { console.warn('[SITE-INDEX] cookbook refresh failed:', err.message); }

    const allDocs = Object.entries(getAllDocuments()).filter(([, doc]) => isSurfaceable(doc));
    const toEntry = ([docPath, doc]) => ({
        path: docPath,
        title: (doc && doc.frontTitle) || docPath.split('/').pop().replace(/\.md$/i, ''),
        slug: pathToSlug(docPath),
        category: doc?.category || null,
        group: (doc && doc.manualGroup) || null,
        access: accessForDoc(doc)
    });
    const visible = (entry) => allows(req, entry.access);

    const policyProcedureDocs = allDocs
        .filter(([docPath]) =>
            docPath.startsWith('policies-procedures/Policy/') ||
            docPath.startsWith('policies-procedures/Procedure/') ||
            docPath.startsWith('policies-procedures/Policy-and-Procedure/') ||
            (docPath.startsWith('personnel-hr/') && docPath.toLowerCase().endsWith('.md'))
        )
        .map(toEntry).filter(visible).sort((a, b) => a.title.localeCompare(b.title));

    const planDocs = allDocs
        .filter(([docPath]) => docPath.startsWith('plans/') && docPath.toLowerCase().endsWith('.md'))
        .map(toEntry).filter(visible).sort((a, b) => a.title.localeCompare(b.title));

    const listedPaths = new Set([...policyProcedureDocs, ...planDocs].map((e) => e.path));
    const conventionDocs = allDocs
        .filter(([docPath, doc]) => doc && doc.manualGroup && !listedPaths.has(docPath))
        .map(toEntry).filter(visible).sort((a, b) => a.title.localeCompare(b.title));

    const staticPages = Object.entries(getAllStaticPages())
        .map(([name, page]) => ({
            type: 'static-page', slug: name,
            title: name.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
            sourcePath: page.path, url: `/pages/${name}`
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    const cookbookEntries = cookbook.listEntries({ status: 'active' })
        .map((entry) => ({
            type: 'cookbook-entry', slug: entry.slug, title: entry.title,
            contentType: entry.contentType || null, domain: entry.domain || null,
            sourcePath: entry.path || null, url: `/site-index/cookbook/${entry.slug}`
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    return {
        generatedAt: new Date().toISOString(),
        policyProcedureDocs, planDocs, conventionDocs,
        staticResourcesAndGuides: [...staticPages, ...cookbookEntries]
    };
}

function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

router.get('/site-index.json', async (req, res) => {
    const data = await getIndexData(req);
    noStore(res);
    res.json({
        generatedAt: data.generatedAt,
        counts: {
            policyProcedure: data.policyProcedureDocs.length,
            plans: data.planDocs.length,
            conventionDocs: data.conventionDocs.length,
            staticResourcesAndGuides: data.staticResourcesAndGuides.length
        },
        policyProcedureDocs: data.policyProcedureDocs,
        planDocs: data.planDocs,
        conventionDocs: data.conventionDocs,
        staticResourcesAndGuides: data.staticResourcesAndGuides
    });
});

function docGroupFor(docPath) {
    const p = String(docPath || '');
    if (p.startsWith('policies-procedures/Procedure/')) return 'Procedures';
    if (p.startsWith('policies-procedures/Policy-and-Procedure/')) return 'Policies & Procedures (combined)';
    if (p.startsWith('personnel-hr/')) return 'Personnel & HR';
    return 'Policies';
}

function searchKey(...parts) {
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/"/g, '');
}

const GROUP_ICON = {
    'Policies': 'fa-file-shield',
    'Procedures': 'fa-list-check',
    'Policies & Procedures (combined)': 'fa-layer-group',
    'Personnel & HR': 'fa-user-group',
    'Plans': 'fa-clipboard-list',
    'Resources & Guides': 'fa-book-bookmark'
};
function iconFor(title) { return GROUP_ICON[title] || 'fa-folder'; }
function groupId(title) { return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function renderDocItem(d) {
    return `<li class="idx-item" data-row data-search="${escapeHtml(searchKey(d.title, d.path, d.category))}">`
        + `<a class="idx-link" href="/public/documents/${escapeHtml(d.slug)}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square ic"></i>${escapeHtml(d.title)}</a>`
        + `<span class="meta">${escapeHtml(d.path)}</span></li>`;
}

function renderResourceItem(r) {
    const metaBits = [r.type, r.contentType, r.domain].filter(Boolean).join(' \u00b7 ');
    return `<li class="idx-item" data-row data-search="${escapeHtml(searchKey(r.title, r.type, r.contentType, r.domain, r.sourcePath))}">`
        + `<a class="idx-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square ic"></i>${escapeHtml(r.title)}</a>`
        + `${metaBits ? `<span class="meta">${escapeHtml(metaBits)}</span>` : ''}</li>`;
}

function panel(title, itemsHtml, count) {
    return `<section class="idx-panel" id="grp-${groupId(title)}" data-group>
      <div class="idx-panel-head"><i class="fas ${iconFor(title)}"></i><h2>${escapeHtml(title)}</h2><span class="count">${count}</span></div>
      <ul class="idx-list">${itemsHtml || '<li class="idx-item"><span class="meta">No entries.</span></li>'}</ul>
    </section>`;
}

router.get('/site-index', async (req, res) => {
    const data = await getIndexData(req);
    noStore(res);

    // Group policies/procedures by sub-type.
    const docGroups = new Map();
    for (const d of data.policyProcedureDocs) {
        const g = docGroupFor(d.path);
        if (!docGroups.has(g)) docGroups.set(g, []);
        docGroups.get(g).push(d);
    }
    const groupOrder = ['Policies', 'Procedures', 'Policies & Procedures (combined)', 'Personnel & HR'];
    const orderedGroups = [
        ...groupOrder.filter((g) => docGroups.has(g)),
        ...[...docGroups.keys()].filter((g) => !groupOrder.includes(g))
    ];

    // Convention-driven sections grouped by manualGroup.
    const convGroups = new Map();
    for (const d of data.conventionDocs) {
        const g = d.group || 'Other';
        if (!convGroups.has(g)) convGroups.set(g, []);
        convGroups.get(g).push(d);
    }
    const convOrdered = [...convGroups.keys()].sort((a, b) => a.localeCompare(b));

    // Build the left column (doc + convention sections) and right column (plans + resources).
    const leftPanels = [
        ...orderedGroups.map((g) => ({ title: g, items: docGroups.get(g) })),
        ...convOrdered.map((g) => ({ title: g, items: convGroups.get(g) }))
    ];
    const leftHtml = leftPanels.map((p) => panel(p.title, p.items.map(renderDocItem).join(''), p.items.length)).join('');
    const rightHtml = [
        panel('Plans', data.planDocs.map(renderDocItem).join(''), data.planDocs.length),
        panel('Resources & Guides', data.staticResourcesAndGuides.map(renderResourceItem).join(''), data.staticResourcesAndGuides.length)
    ].join('');

    // Jump-to nav covers every panel (both columns).
    const navTargets = [...leftPanels.map((p) => ({ title: p.title, count: p.items.length })),
        { title: 'Plans', count: data.planDocs.length },
        { title: 'Resources & Guides', count: data.staticResourcesAndGuides.length }];
    const navItems = navTargets.map((t) =>
        `<a class="nav-item" href="#grp-${groupId(t.title)}"><i class="fas ${iconFor(t.title)}"></i><span class="lbl">${escapeHtml(t.title)}</span><span class="nav-count">${t.count}</span></a>`
    ).join('');

    const pp = data.policyProcedureDocs.length + data.conventionDocs.length;
    const summary = [
        `<span class="stat purple"><span class="ic"></span><b>${pp + data.planDocs.length + data.staticResourcesAndGuides.length}</b> items</span>`,
        `<span class="stat"><span class="ic"></span><b>${pp}</b> policies & procedures</span>`,
        `<span class="stat"><span class="ic"></span><b>${data.planDocs.length}</b> plans</span>`,
        `<span class="stat"><span class="ic"></span><b>${data.staticResourcesAndGuides.length}</b> resources & guides</span>`
    ].join('');

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Policy Manual & Site Index - Refuge House Compliance</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <link rel="stylesheet" href="/rh-compliance.css" />
</head>
<body>
  <div class="app">
    <aside class="side" id="side">
      <div class="side-logo"><img src="/logo.png" alt="Refuge House" /></div>
      <div class="side-scroll">
        <a class="crumb" href="/"><i class="fas fa-arrow-left"></i>Compliance Library</a>
        <div class="side-group">
          <div class="side-label">Jump to</div>
          <nav>${navItems}</nav>
        </div>
        <div class="side-group">
          <div class="side-label">Browse</div>
          <a class="nav-item" href="/collections"><i class="fas fa-layer-group"></i><span class="lbl">All Collections</span></a>
          <a class="nav-item" href="/manual"><i class="fas fa-book-open"></i><span class="lbl">Policies &amp; Procedures</span></a>
          <a class="nav-item" href="/"><i class="fas fa-comments"></i><span class="lbl">Ask the Library</span></a>
        </div>
      </div>
    </aside>
    <div class="scrim" id="scrim" onclick="closeSide()"></div>
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:flex-start;gap:14px;min-width:0">
          <button class="menu-btn" onclick="openSide()" aria-label="Menu"><i class="fas fa-bars"></i></button>
          <div style="min-width:0">
            <div class="eyebrow">Refuge House &middot; Compliance</div>
            <h1>Policy Manual &amp; Site Index</h1>
            <p class="sub">Browse and search every policy, procedure, plan and resource published through the Compliance API.</p>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="search"><i class="fas fa-magnifying-glass"></i><input type="search" id="q" placeholder="Search everything\u2026" autocomplete="off" /></div>
          <a class="btn" href="/site-index.json" target="_blank" rel="noopener"><i class="fas fa-code"></i>JSON</a>
        </div>
      </div>
      <div class="body">
        <div class="cta-banner">
          <div>
            <div class="cta-title"><i class="fas fa-clipboard-check"></i>FY-26 SSCC Joint Monitoring &mdash; Desk Review</div>
            <div class="cta-sub">Interactive reviewer workspace mapping each monitoring item to its policy and supporting documents.</div>
          </div>
          <a class="cta-go" href="/review/fy26-sscc">Open desk review <i class="fas fa-arrow-right"></i></a>
        </div>
        <div class="summary">${summary}</div>
        <p id="empty">No items match your search.</p>
        <div class="idx-grid"><div>${leftHtml}</div><div>${rightHtml}</div></div>
      </div>
    </div>
  </div>
  <script>
    (function () {
      var q = document.getElementById('q');
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
      var panels = Array.prototype.slice.call(document.querySelectorAll('[data-group]'));
      var empty = document.getElementById('empty');
      q.addEventListener('input', function () {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        rows.forEach(function (row) {
          var match = !term || row.dataset.search.indexOf(term) !== -1;
          row.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        panels.forEach(function (p) {
          var any = p.querySelector('[data-row]:not([style*="display: none"])');
          p.style.display = any ? '' : 'none';
        });
        empty.style.display = shown ? 'none' : 'block';
      });
    })();
    function openSide(){ document.getElementById('side').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
    function closeSide(){ document.getElementById('side').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
  </script>
</body>
</html>`);
});

router.get('/site-index/cookbook/:slug', async (req, res) => {
    try { await cookbook.refreshIfStale(); }
    catch (err) { console.warn('[SITE-INDEX] cookbook refresh failed:', err.message); }

    const entry = cookbook.getEntry(req.params.slug);
    if (!entry) return res.status(404).type('html').send('<!doctype html><h1>Cookbook entry not found</h1>');
    const html = cookbook.getHtml(req.params.slug);
    if (!html) return res.status(404).type('html').send('<!doctype html><h1>Cookbook HTML not mirrored</h1>');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Content-Slug', entry.slug);
    res.setHeader('X-Content-Status', entry.status);
    res.send(applyCookbookBranding(entry, html.content));
});

module.exports = router;
