// routes/review.js — Public (unauthenticated) FY-26 SSCC Joint Monitoring
// desk-review portal. Renders the desk-review document manifest (the single
// source of truth, loaded from the knowbase) into an interactive workspace:
// each item gets Met / Not Met / N·A controls, a classification, reviewer
// notes, and download links for every mapped document. Reviewer state persists
// in the browser (localStorage); Export produces a JSON record and "Freeze for
// archive" locks it read-only.
//
//   GET /review/fy26-sscc        -> the desk-review workspace (HTML)
//   GET /review/fy26-sscc.json   -> the raw manifest as served to the page
//
// Markdown policies link to /public/documents/<slug>; binaries (PDFs, reference
// sheets) link to /public/files/<repo-path>. The client engine lives in the
// static asset /review/fy26-sscc.js.
const express = require('express');
const router = express.Router();
const { refreshIfStale, getDeskReviewManifest } = require('../services/knowbase-loader');

const BRAND = '#5E3989';

const VALID_CLASSIFICATIONS = ['legacy', 'transitioning', 'new', 'na', 'unmapped'];

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Encode a repo-relative path for the /public/files route: encode each segment
// (so spaces, &, etc. survive) but keep the slashes as separators.
function encodeRepoPath(repoPath) {
    return String(repoPath || '')
        .split('/')
        .map(encodeURIComponent)
        .join('/');
}

// The site index must always reflect the latest synced knowbase, and the portal
// is reviewer-state-bearing — never let a CDN pin an old copy.
function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

// Assign each manifest item to a display group. `all-*` items are the shared
// "All SSCCs" block; everything else (disruption-*, satisfaction-*, etc.) is a
// cross-/per-SSCC item.
function groupKeyFor(item) {
    return String(item.item || '').startsWith('all-') ? 'all' : 'cross';
}

const GROUP_META = {
    all: {
        title: 'All SSCCs Monitoring Items — Desk Review',
        scope: 'Shared — one reviewer group reviews these once on behalf of every SSCC.'
    },
    cross: {
        title: 'Cross-SSCC & Per-SSCC Items',
        scope: 'Items that apply across, or vary by, individual SSCC.'
    }
};

function initialClassification(item) {
    if (item && VALID_CLASSIFICATIONS.includes(item.classification)) return item.classification;
    return 'unmapped';
}

// Render the download links for one item's documents.
function renderDocs(item) {
    const docs = Array.isArray(item.documents) ? item.documents : [];
    if (docs.length === 0) {
        return '<div class="docs empty">No document to provide — see note.</div>';
    }

    const links = docs.map((doc) => {
        const label = escapeHtml(doc.label || 'Document');

        // Markdown policy/procedure → rendered document by slug.
        if (doc.kind === 'policy' && doc.slug) {
            const href = '/public/documents/' + encodeURIComponent(doc.slug);
            const badge = doc.live
                ? '<span class="doc-badge live" title="Published on the compliance site">Live</span>'
                : '<span class="doc-badge pending" title="In the repo; not yet pushed to main — link resolves after publication">Pending push</span>';
            return `<a class="doc policy" href="${href}" target="_blank" rel="noopener">${label} ${badge}</a>`;
        }

        // Binary (PDF / reference sheet / etc.) → streamed via /public/files.
        if (doc.repo) {
            const href = '/public/files/' + encodeRepoPath(doc.repo);
            const kind = doc.kind === 'reference-sheet'
                ? '<span class="doc-badge ref">Reference sheet</span>'
                : '<span class="doc-badge file">PDF</span>';
            return `<a class="doc file" href="${href}" target="_blank" rel="noopener">${label} ${kind}</a>`;
        }

        // No resolvable target — show the label without a link.
        return `<span class="doc nolink">${label}</span>`;
    });

    return `<div class="docs">${links.join('')}</div>`;
}

function renderItem(item) {
    const id = escapeHtml(item.item || '');
    const group = groupKeyFor(item);
    const cls = initialClassification(item);
    const label = escapeHtml(item.label || item.item || 'Item');
    const note = item.note
        ? `<div class="item-note">${escapeHtml(item.note)}</div>`
        : '';

    return `<div class="item" data-id="${id}" data-group="${group}" data-status="pending" data-class="${cls}">
  <div class="item-main">
    <div class="status-group" role="group" aria-label="Compliance status">
      <button class="st" data-v="met" title="Met / Compliant">Met</button>
      <button class="st" data-v="notmet" title="Not Met / Deficient">Not Met</button>
      <button class="st" data-v="na" title="Not Applicable">N/A</button>
    </div>
    <select class="class-sel" title="Policy classification">
      <option value="legacy">Legacy P&amp;P</option>
      <option value="transitioning">Transitioning → T3C</option>
      <option value="new">New (T3C)</option>
      <option value="na">Not a policy</option>
      <option value="unmapped">Unmapped</option>
    </select>
    <div class="item-text">
      <span class="item-label">${label}</span>
      <span class="item-id">${id}</span>
    </div>
  </div>
  ${renderDocs(item)}
  ${note}
  <textarea class="notes" rows="1" placeholder="Reviewer notes…"></textarea>
</div>`;
}

function renderGroup(key, items) {
    const meta = GROUP_META[key] || { title: key, scope: '' };
    const rows = items.map(renderItem).join('');
    return `<section class="group" data-group="${escapeHtml(key)}">
  <button class="group-head" aria-expanded="true">
    <span class="group-title">${escapeHtml(meta.title)}</span>
    <span class="group-meta">
      <span class="g-scope">${escapeHtml(meta.scope)}</span>
      <span class="g-count" data-count="${escapeHtml(key)}"></span>
      <span class="caret">▾</span>
    </span>
  </button>
  <div class="group-body">${rows}</div>
</section>`;
}

function renderPage(manifest) {
    const items = Array.isArray(manifest.items) ? manifest.items : [];

    // Preserve manifest order within two groups.
    const grouped = { all: [], cross: [] };
    items.forEach((it) => { grouped[groupKeyFor(it)].push(it); });
    const groupKeys = ['all', 'cross'].filter((k) => grouped[k].length > 0);
    const groupsHtml = groupKeys.map((k) => renderGroup(k, grouped[k])).join('');

    const needsPush = Array.isArray(manifest.needsPush) ? manifest.needsPush : [];
    const pushBanner = needsPush.length > 0
        ? `<div class="push-banner">
        <strong>${needsPush.length} policy link${needsPush.length === 1 ? '' : 's'} pending publication.</strong>
        These markdown policies exist in the knowbase but have not been pushed to <code>main</code> yet, so their
        <em>Pending push</em> links will not resolve until they are published.
      </div>`
        : '';

    const generated = escapeHtml(manifest.generated || '');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FY-26 SSCC Joint Monitoring — Desk Review</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
:root{
  --rh-primary:${BRAND}; --rh-primary-dark:#3c2556; --rh-accent:#A90533;
  --rh-bg:#f8fafc; --rh-surface:#ffffff; --rh-border:#e2e8f0;
  --rh-text:#1e293b; --rh-muted:#475569;
  --rh-warn-bg:#fff7ed; --rh-warn-border:#fb923c;
  --rh-alert-bg:#fef2f2; --rh-alert-border:#fca5a5;
  --rh-info-bg:#eff6ff; --rh-info-border:#93c5fd;
  --rh-success-bg:#f0fdf4; --rh-success-border:#86efac;
  --legacy:#475569; --legacy-bg:#eef2f6;
  --trans:#9a3412; --trans-bg:#ffedd5;
  --new:#166534; --new-bg:#dcfce7;
  --na:#64748b; --na-bg:#f1f5f9;
  --unmapped:#7c3aed; --unmapped-bg:#f3e8ff;
}
*{box-sizing:border-box}
body{margin:0;background:var(--rh-bg);color:var(--rh-text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}
a{color:var(--rh-accent)}
.rh-header{background:linear-gradient(135deg,var(--rh-primary-dark) 0%,var(--rh-primary) 50%,var(--rh-accent) 100%);
  color:#fff;padding:1.5rem 1.5rem 1.25rem}
.rh-header .eyebrow{display:inline-block;font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;opacity:.92;font-weight:600}
.rh-header h1{margin:.3rem 0 .55rem;font-size:1.5rem;line-height:1.25}
.header-meta{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center}
.badge{display:inline-block;font-size:.68rem;font-weight:700;padding:.22rem .55rem;border-radius:999px;text-transform:uppercase;letter-spacing:.04em}
.badge-package{background:rgba(255,255,255,.22);color:#fff;border:1px solid rgba(255,255,255,.4)}
.badge-temp{background:rgba(167,139,250,.32);color:#fff;border:1px solid rgba(167,139,250,.6)}
.header-links{margin-top:.6rem}
.header-links a{color:#fff;font-size:.82rem;text-decoration:underline;margin-right:1rem;opacity:.95}
.glance{background:#f0ebfa;border-bottom:1.5px solid #ddd6fe;display:flex;flex-wrap:wrap;gap:.6rem;padding:.7rem 1.5rem}
.tile{background:#fff;border:1px solid #ddd6fe;border-radius:8px;padding:.45rem .7rem;min-width:84px}
.tile .lab{font-size:.62rem;text-transform:uppercase;color:#7c3aed;font-weight:600;letter-spacing:.03em}
.tile .val{font-size:1rem;font-weight:700;color:var(--rh-primary-dark)}
.wrap{max-width:1080px;margin:0 auto;padding:1.1rem 1.5rem 3rem}
.mig{background:var(--rh-info-bg);border:1.5px solid var(--rh-info-border);border-radius:12px;padding:1rem 1.15rem;margin-bottom:1.1rem}
.mig h2{margin:0 0 .45rem;font-size:1.02rem;color:var(--rh-primary-dark)}
.mig p{margin:.35rem 0;font-size:.92rem}
.key{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.7rem}
.chip{font-size:.72rem;font-weight:700;padding:.25rem .6rem;border-radius:999px;border:1px solid}
.chip.legacy{background:var(--legacy-bg);color:var(--legacy);border-color:#cbd5e1}
.chip.transitioning{background:var(--trans-bg);color:var(--trans);border-color:#fdba74}
.chip.new{background:var(--new-bg);color:var(--new);border-color:#86efac}
.chip.na{background:var(--na-bg);color:var(--na);border-color:#cbd5e1}
.chip.unmapped{background:var(--unmapped-bg);color:var(--unmapped);border-color:#d8b4fe}
.push-banner{background:var(--rh-warn-bg);border:1.5px solid var(--rh-warn-border);border-radius:10px;
  padding:.7rem 1rem;margin-bottom:1rem;font-size:.88rem;color:#9a3412}
.push-banner code{background:rgba(154,52,18,.1);padding:0 .25rem;border-radius:4px}
.toolbar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;background:var(--rh-surface);
  border:1px solid var(--rh-border);border-radius:12px;padding:.7rem .9rem;margin-bottom:1rem;
  box-shadow:0 2px 6px rgba(0,0,0,.05);position:sticky;top:0;z-index:30}
.toolbar input[type=text]{padding:.4rem .55rem;border:1px solid var(--rh-border);border-radius:8px;font-size:.88rem}
.toolbar label{font-size:.72rem;color:var(--rh-muted);font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.progress{flex:1;min-width:160px;height:10px;background:#ece9f4;border-radius:999px;overflow:hidden}
.progress > i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--rh-primary),var(--rh-accent));transition:width .3s}
.pct{font-weight:700;color:var(--rh-primary-dark);font-size:.9rem;min-width:42px;text-align:right}
.btn{background:var(--rh-primary);color:#fff;border:none;border-radius:8px;padding:.45rem .8rem;font-size:.84rem;font-weight:600;cursor:pointer}
.btn.ghost{background:#fff;color:var(--rh-primary);border:1px solid var(--rh-primary)}
.btn.warn{background:var(--rh-accent)}
select.filter{padding:.4rem .5rem;border:1px solid var(--rh-border);border-radius:8px;font-size:.85rem}
.group{background:var(--rh-surface);border:1px solid var(--rh-border);border-radius:12px;margin-bottom:.9rem;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.group-head{width:100%;display:flex;justify-content:space-between;align-items:center;gap:1rem;
  background:linear-gradient(90deg,#5E3989,#6d4699);color:#fff;border:none;cursor:pointer;
  padding:.7rem .95rem;text-align:left;font-size:.95rem;font-weight:700}
.group-meta{display:flex;align-items:center;gap:.6rem;font-weight:500}
.g-scope{font-size:.7rem;background:rgba(255,255,255,.2);padding:.15rem .5rem;border-radius:999px}
.g-count{font-size:.78rem;opacity:.95}
.caret{transition:transform .2s}
.group.collapsed .caret{transform:rotate(-90deg)}
.group.collapsed .group-body{display:none}
.group-body{padding:.35rem .6rem .6rem}
.item{border-bottom:1px solid #f1f5f9;padding:.55rem .35rem}
.item:last-child{border-bottom:none}
.item-main{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
.status-group{display:flex;border:1px solid var(--rh-border);border-radius:8px;overflow:hidden;flex:0 0 auto}
.st{background:#fff;border:none;border-right:1px solid var(--rh-border);padding:.3rem .55rem;font-size:.76rem;font-weight:600;cursor:pointer;color:var(--rh-muted)}
.st:last-child{border-right:none}
.st.active[data-v=met]{background:var(--new-bg);color:var(--new)}
.st.active[data-v=notmet]{background:var(--rh-alert-bg);color:#b91c1c}
.st.active[data-v=na]{background:var(--na-bg);color:var(--na)}
.item-text{flex:1;min-width:200px;font-size:.9rem;cursor:pointer}
.item-label{font-weight:600}
.item-id{display:inline-block;margin-left:.5rem;font-size:.68rem;color:var(--rh-muted);font-variant:all-small-caps;letter-spacing:.04em}
.class-sel{font-size:.72rem;border:1px solid var(--rh-border);border-radius:8px;padding:.25rem .35rem;font-weight:600}
.item[data-class=legacy] .class-sel{color:var(--legacy);background:var(--legacy-bg)}
.item[data-class=transitioning] .class-sel{color:var(--trans);background:var(--trans-bg)}
.item[data-class=new] .class-sel{color:var(--new);background:var(--new-bg)}
.item[data-class=na] .class-sel{color:var(--na);background:var(--na-bg)}
.item[data-class=unmapped] .class-sel{color:var(--unmapped);background:var(--unmapped-bg)}
.docs{display:flex;flex-wrap:wrap;gap:.4rem;margin:.45rem 0 0 0}
.docs.empty{font-size:.8rem;color:var(--rh-muted);font-style:italic}
.doc{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;text-decoration:none;
  background:#fff;border:1px solid var(--rh-primary);color:var(--rh-primary);border-radius:8px;padding:.28rem .55rem}
.doc:hover{background:var(--unmapped-bg)}
.doc.nolink{border-style:dashed;color:var(--rh-muted);border-color:var(--rh-border)}
.doc-badge{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:.08rem .35rem;border-radius:999px;border:1px solid}
.doc-badge.live{background:var(--new-bg);color:var(--new);border-color:#86efac}
.doc-badge.pending{background:var(--rh-warn-bg);color:#9a3412;border-color:#fdba74}
.doc-badge.file{background:#eef2ff;color:#3730a3;border-color:#c7d2fe}
.doc-badge.ref{background:var(--unmapped-bg);color:var(--unmapped);border-color:#d8b4fe}
.item-note{margin-top:.4rem;font-size:.8rem;color:var(--rh-muted);font-style:italic}
.notes{width:100%;margin-top:.4rem;border:1px solid var(--rh-border);border-radius:8px;padding:.35rem .5rem;font-size:.82rem;font-family:inherit;resize:vertical;display:none}
.item.has-notes .notes,.item.show-notes .notes{display:block}
.item.dim{display:none}
body.archived .toolbar .btn:not(.export):not(.print){display:none}
.arch-banner{display:none;background:var(--rh-success-bg);border:1.5px solid var(--rh-success-border);
  border-radius:10px;padding:.7rem 1rem;margin-bottom:1rem;font-weight:600;color:#166534}
body.archived .arch-banner{display:block}
body.archived .st,body.archived .class-sel,body.archived .notes{pointer-events:none;opacity:.92}
footer.note{max-width:1080px;margin:0 auto;padding:0 1.5rem 2.5rem;color:var(--rh-muted);font-size:.82rem}
@media print{
  .toolbar,.header-links{display:none!important}
  .group-body{display:block!important}
  .notes{display:block!important}
  body{background:#fff}
}
</style>
</head>
<body>
<header class="rh-header">
  <span class="eyebrow">Refuge House, Inc. · Compliance</span>
  <h1>FY-26 SSCC Joint Monitoring Tool — Desk Review</h1>
  <div class="header-meta">
    <span class="badge badge-package">FY-26</span>
    <span class="badge badge-package">Desk Review</span>
    <span class="badge badge-temp">Temporary · Archivable</span>
    <span style="font-size:.78rem;opacity:.9;margin-left:.3rem">Manifest generated ${generated} · Tool rev. 12-01-2025</span>
  </div>
  <div class="header-links">
    <a href="/site-index">← Policy manual / site index</a>
    <a href="/review/fy26-sscc.json" target="_blank" rel="noopener">View manifest JSON</a>
  </div>
</header>

<div class="glance">
  <div class="tile"><div class="lab">Total items</div><div class="val">${items.length}</div></div>
  <div class="tile"><div class="lab">Groups</div><div class="val">${groupKeys.length}</div></div>
  <div class="tile"><div class="lab">Reviewed</div><div class="val" id="t-reviewed">0</div></div>
  <div class="tile"><div class="lab">Transitioning</div><div class="val" id="t-trans">0</div></div>
  <div class="tile"><div class="lab">Legacy</div><div class="val" id="t-legacy">0</div></div>
  <div class="tile"><div class="lab">Unmapped</div><div class="val" id="t-unmapped">0</div></div>
</div>

<div class="wrap">
  <div class="arch-banner" id="archBanner"></div>

  <div class="mig">
    <h2>Transitioning vs. Legacy Policies &amp; Procedures</h2>
    <p>Refuge House is migrating its policies and procedures into the <strong>T3C</strong> framework. As that work proceeds, individual P&amp;Ps move through states — so this review distinguishes what a reviewer is looking at. Set the classification per item as you map it:</p>
    <div class="key">
      <span class="chip legacy">Legacy P&amp;P</span>
      <span class="chip transitioning">Transitioning → T3C</span>
      <span class="chip new">New (T3C)</span>
      <span class="chip na">Not a policy</span>
      <span class="chip unmapped">Unmapped</span>
    </div>
    <p style="font-size:.84rem;margin-top:.6rem"><strong>Legacy</strong> = the pre-T3C document currently in force. <strong>Transitioning</strong> = actively being rewritten/migrated into T3C. <strong>New (T3C)</strong> = the published T3C version. <strong>Not a policy</strong> = an operational check (e.g., staff ratios, abeyance-list reviews). <strong>Unmapped</strong> = classification still to be assigned in the mapping pass.</p>
  </div>

  ${pushBanner}

  <div class="toolbar">
    <label for="rev">Reviewer</label>
    <input type="text" id="rev" placeholder="Name / group">
    <div class="progress"><i id="bar"></i></div>
    <span class="pct" id="pct">0%</span>
    <select class="filter" id="filter" title="Filter items">
      <option value="all">All items</option>
      <option value="pending">Pending only</option>
      <option value="met">Met</option>
      <option value="notmet">Not Met</option>
      <option value="na">N/A</option>
    </select>
    <button class="btn ghost export" id="exportBtn">Export</button>
    <button class="btn ghost print" id="printBtn" onclick="window.print()">Print</button>
    <button class="btn warn" id="archiveBtn">Freeze for archive</button>
  </div>

  ${groupsHtml}
</div>

<footer class="note">
  <p><strong>Scope:</strong> the <strong>Desk Review</strong> portion of the FY-26 SSCC Joint Monitoring Tool — the administrative items one reviewer group works once on behalf of all SSCCs, plus each SSCC's own desk-review items.</p>
  <p><strong>Source of truth:</strong> this page is generated from <code>desk-review-document-manifest.json</code> in the knowbase. Edit the manifest and re-sync to change what appears here. Reviewer marks, notes, and classifications are saved in your browser; use <em>Export</em> to capture a JSON record and <em>Freeze for archive</em> to lock it read-only.</p>
  <p>Markdown policies open at <code>/public/documents/&lt;slug&gt;</code>; PDFs and reference sheets stream from <code>/public/files/&lt;path&gt;</code>.</p>
</footer>

<script src="/review/fy26-sscc.js"></script>
</body>
</html>`;
}

function renderUnavailable(res) {
    res.status(503).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Desk review unavailable</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:640px;margin:3rem auto;padding:0 1.5rem;color:#1e293b;line-height:1.6}
h1{color:${BRAND}} code{background:#f1f5f9;padding:.1rem .35rem;border-radius:4px}</style></head>
<body>
<h1>Desk review not loaded yet</h1>
<p>The FY-26 SSCC desk-review manifest hasn't been loaded from the knowbase. This usually means the
knowbase sync hasn't completed, or <code>desk-review-document-manifest.json</code> isn't present on the
tracked branch.</p>
<p>Force a re-sync with <code>POST /api/admin/sync-knowbase</code> (behind the API key), then reload.</p>
<p><a href="/site-index">← Back to the site index</a></p>
</body></html>`);
}

// GET /review/fy26-sscc.json — the manifest as served to the page.
router.get('/fy26-sscc.json', async (req, res) => {
    try {
        await refreshIfStale();
    } catch (err) {
        console.warn('[REVIEW] knowbase refresh failed:', err.message);
    }
    const manifest = getDeskReviewManifest();
    noStore(res);
    if (!manifest) {
        return res.status(503).json({ error: 'Desk-review manifest not loaded' });
    }
    res.json(manifest);
});

// GET /review/fy26-sscc — the interactive desk-review workspace.
router.get('/fy26-sscc', async (req, res) => {
    try {
        await refreshIfStale();
    } catch (err) {
        console.warn('[REVIEW] knowbase refresh failed:', err.message);
    }
    const manifest = getDeskReviewManifest();
    noStore(res);
    if (!manifest || !Array.isArray(manifest.items)) {
        return renderUnavailable(res);
    }
    res.type('html').send(renderPage(manifest));
});

module.exports = router;
module.exports._internal = { encodeRepoPath, groupKeyFor, initialClassification, renderDocs, renderPage };
