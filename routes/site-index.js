// routes/site-index.js
// Public Site Index for quickly browsing sender-backed content in Compliance API.
// No API key required.
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

async function getIndexData(req) {
    try {
        await cookbook.refreshIfStale();
    } catch (err) {
        // Non-fatal for index view; still show what we can from knowbase loader.
        console.warn('[SITE-INDEX] cookbook refresh failed:', err.message);
    }

    // Drop non-surfaceable docs (listed:false / superseded / retired / deprecated
    // / archived) up front — they never appear in the index, but stay loaded and
    // directly searchable. `legacy` is surfaceable and still listed (grouped).
    const allDocs = Object.entries(getAllDocuments()).filter(([, doc]) => isSurfaceable(doc));
    const toEntry = ([docPath, doc]) => ({
        path: docPath,
        title: (doc && doc.frontTitle) || docPath.split('/').pop().replace(/\.md$/i, ''),
        slug: pathToSlug(docPath),
        category: doc?.category || null,
        group: (doc && doc.manualGroup) || null,
        access: accessForDoc(doc)
    });

    // Hide entries the caller cannot open, so the manual never advertises gated
    // documents to people who can't view them.
    const visible = (entry) => allows(req, entry.access);

    const policyProcedureDocs = allDocs
        .filter(([docPath]) =>
            docPath.startsWith('policies-procedures/Policy/') ||
            docPath.startsWith('policies-procedures/Procedure/') ||
            docPath.startsWith('policies-procedures/Policy-and-Procedure/') ||
            (docPath.startsWith('personnel-hr/') && docPath.toLowerCase().endsWith('.md'))
        )
        .map(toEntry)
        .filter(visible)
        .sort((a, b) => a.title.localeCompare(b.title));

    // Plans live under plans/ in the knowbase (Staff Roster, Accreditation
    // Statement, Professional Staffing Plan, etc.). They are already loaded by
    // the knowbase loader; surface them here so the index reflects them too.
    const planDocs = allDocs
        .filter(([docPath]) => docPath.startsWith('plans/') && docPath.toLowerCase().endsWith('.md'))
        .map(toEntry)
        .filter(visible)
        .sort((a, b) => a.title.localeCompare(b.title));

    // Convention-driven groups: any synced doc that declares a manualGroup in its
    // YAML frontmatter is listed here (grouped + access-gated by its own metadata),
    // unless it's already surfaced by the folder-based groups above. This lets the
    // knowbase add new doc types/folders with zero changes to this repo.
    const listedPaths = new Set([...policyProcedureDocs, ...planDocs].map((e) => e.path));
    const conventionDocs = allDocs
        .filter(([docPath, doc]) => doc && doc.manualGroup && !listedPaths.has(docPath))
        .map(toEntry)
        .filter(visible)
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
        planDocs,
        conventionDocs,
        staticResourcesAndGuides: [...staticPages, ...cookbookEntries]
    };
}

// The site index must always reflect the latest synced knowbase. Front Door /
// any CDN in front of the API would otherwise pin an old response (and a frozen
// generatedAt), so explicitly forbid caching of these dynamic index endpoints.
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

// Split policies/procedures into sub-groups by their knowbase folder so the
// manual reads like a manual rather than one long list.
function docGroupFor(docPath) {
    const p = String(docPath || '');
    if (p.startsWith('policies-procedures/Procedure/')) return 'Procedures';
    if (p.startsWith('policies-procedures/Policy-and-Procedure/')) return 'Policies & Procedures (combined)';
    if (p.startsWith('personnel-hr/')) return 'Personnel & HR';
    return 'Policies';
}

// Lowercased haystack used by the client-side search box.
function searchKey(...parts) {
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/"/g, '');
}

function renderDocItem(d) {
    return `<li class="idx-item" data-search="${escapeHtml(searchKey(d.title, d.path, d.category))}">`
        + `<a href="/public/documents/${escapeHtml(d.slug)}" target="_blank" rel="noopener">${escapeHtml(d.title)}</a>`
        + `<span class="meta">${escapeHtml(d.path)}</span></li>`;
}

function renderGroupSection(title, itemsHtml, count) {
    return `<section class="idx-group panel" data-group="${escapeHtml(title)}">
      <h2>${escapeHtml(title)} <span class="badge"><span class="idx-group-count">${count}</span></span></h2>
      <ul>${itemsHtml || '<li class="meta">No entries.</li>'}</ul>
    </section>`;
}

router.get('/site-index', async (req, res) => {
    const data = await getIndexData(req);
    noStore(res);

    // Group policies/procedures by sub-type, preserving title sort within each.
    const docGroups = new Map();
    for (const d of data.policyProcedureDocs) {
        const g = docGroupFor(d.path);
        if (!docGroups.has(g)) docGroups.set(g, []);
        docGroups.get(g).push(d);
    }
    // Stable, sensible order.
    const groupOrder = ['Policies', 'Procedures', 'Policies & Procedures (combined)', 'Personnel & HR'];
    const orderedGroups = [
        ...groupOrder.filter((g) => docGroups.has(g)),
        ...[...docGroups.keys()].filter((g) => !groupOrder.includes(g))
    ];

    const docSections = orderedGroups
        .map((g) => {
            const docs = docGroups.get(g);
            return renderGroupSection(g, docs.map(renderDocItem).join(''), docs.length);
        })
        .join('');

    // Convention-driven sections: group frontmatter-declared docs by manualGroup.
    const convGroups = new Map();
    for (const d of data.conventionDocs) {
        const g = d.group || 'Other';
        if (!convGroups.has(g)) convGroups.set(g, []);
        convGroups.get(g).push(d);
    }
    const convSections = [...convGroups.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((g) => {
            const docs = convGroups.get(g);
            return renderGroupSection(g, docs.map(renderDocItem).join(''), docs.length);
        })
        .join('');

    const planRows = data.planDocs.map(renderDocItem).join('');

    const resourceRows = data.staticResourcesAndGuides
        .map((r) => {
            const metaBits = [r.type, r.contentType, r.domain].filter(Boolean).join(' · ');
            return `<li class="idx-item" data-search="${escapeHtml(searchKey(r.title, r.type, r.contentType, r.domain, r.sourcePath))}">`
                + `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>`
                + `<span class="meta">${escapeHtml(metaBits)}</span></li>`;
        })
        .join('');

    const totalItems = data.policyProcedureDocs.length + data.planDocs.length + data.conventionDocs.length + data.staticResourcesAndGuides.length;

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Policy Manual & Site Index - Refuge House Compliance</title>
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
    * { box-sizing: border-box; }
    body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; margin: 0; background: var(--rh-bg); color: var(--rh-text); line-height: 1.6; }
    .rh-header { background: linear-gradient(135deg,var(--rh-primary-dark) 0%,var(--rh-primary) 50%,var(--rh-accent) 100%); color:#fff; padding: 1.4rem 1.5rem 1.2rem; }
    .rh-header .eyebrow { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; opacity:.92; font-weight:600; }
    .rh-header h1 { margin:.3rem 0 .4rem; font-size:1.5rem; }
    .rh-header p { margin:0; font-size:.9rem; opacity:.95; }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 16px 48px; }
    .topbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin: 14px 0; }
    .btn { display:inline-block; padding:8px 12px; border:1px solid #d4b5e4; border-radius:8px; background: var(--rh-light-purple); color: var(--rh-primary); text-decoration:none; font-size:14px; }
    .btn:hover { background:#ead8f4; }
    .portal-card { display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;
      background: var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:12px; padding:14px 16px; margin-bottom:16px; }
    .portal-card .pc-title { font-weight:700; color: var(--rh-primary-dark); }
    .portal-card .pc-sub { font-size:.85rem; color: var(--rh-muted); }
    .portal-card a.go { background: var(--rh-primary); color:#fff; border:none; border-radius:8px; padding:.5rem .9rem; text-decoration:none; font-weight:600; font-size:.86rem; }
    .searchbar { position:sticky; top:0; z-index:10; background: var(--rh-bg); padding:8px 0 12px; }
    .searchbar input { width:100%; padding:.6rem .75rem; border:1px solid var(--rh-border); border-radius:10px; font-size:.95rem; }
    .counts { font-size:13px; color: var(--rh-muted); margin: 4px 0 14px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:14px; align-items:start; }
    .panel { background: var(--rh-surface); border:1px solid var(--rh-border); border-radius:10px; padding:12px 16px; margin-bottom:14px; }
    .panel h2 { font-size:1rem; margin:.2rem 0 .6rem; color: var(--rh-primary-dark); display:flex; align-items:center; gap:.5rem; }
    .badge { font-size:.7rem; font-weight:700; color: var(--rh-primary); background: var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:999px; padding:.05rem .5rem; }
    ul { margin:0; padding-left:18px; max-height: 460px; overflow:auto; }
    li { margin:0 0 8px; }
    .meta { display:block; font-size:12px; color: var(--rh-muted); }
    a { color: var(--rh-accent); }
    #idx-empty { display:none; }
    #idx-empty[hidden] { display:none; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header class="rh-header">
    <span class="eyebrow">Refuge House, Inc. · Compliance</span>
    <h1>Policy Manual &amp; Site Index</h1>
    <p>Browse and search every policy, procedure, plan, and resource published through the Compliance API.</p>
  </header>
  <main class="wrap">
    <div class="topbar">
      <a class="btn" href="/">← Compliance Library</a>
      <a class="btn" href="/site-index.json" target="_blank" rel="noopener">View JSON Index</a>
    </div>

    <div class="portal-card">
      <div>
        <div class="pc-title">FY-26 SSCC Joint Monitoring — Desk Review</div>
        <div class="pc-sub">Interactive reviewer workspace mapping each monitoring item to its policy and documents.</div>
      </div>
      <a class="go" href="/review/fy26-sscc">Open desk review →</a>
    </div>

    <div class="searchbar">
      <input type="search" id="idx-search" placeholder="Search policies, procedures, plans, resources…" autocomplete="off" />
    </div>
    <p class="counts">Generated ${escapeHtml(data.generatedAt)} · Showing <strong id="idx-visible">${totalItems}</strong> of ${totalItems} items · Policies/Procedures: ${data.policyProcedureDocs.length} · Plans: ${data.planDocs.length}${data.conventionDocs.length ? ` · Other groups: ${data.conventionDocs.length}` : ''} · Resources &amp; Guides: ${data.staticResourcesAndGuides.length}</p>
    <p class="counts" id="idx-empty">No items match your search.</p>

    <div class="grid">
      <div>
        ${docSections}
        ${convSections}
      </div>
      <div>
        ${renderGroupSection('Plans', planRows, data.planDocs.length)}
        ${renderGroupSection('Resources & Guides', resourceRows, data.staticResourcesAndGuides.length)}
      </div>
    </div>
  </main>
  <script src="/site-index.js"></script>
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
