// routes/collections.js
// Registry-driven collections surface:
//   GET /collections        -> list of collections (from collections.json)
//   GET /collections/:code  -> a single compiled, grouped collection
// Public routes; each collection and each item is access-gated per caller tier
// (collection audience / item access). Hidden-lifecycle members are already
// dropped by the collections service.
const express = require('express');
const router = express.Router();
const { listCollections, compileCollection } = require('../services/collections');
const { getDocument } = require('../services/knowbase-loader');
const PM = require('../services/policy-manual');
const { allows, deny, wantsJson } = require('../middleware/human-auth');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function searchKey(...parts) {
    return parts.filter(Boolean).join(' ').toLowerCase().replace(/"/g, '');
}

function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

const PAGE_HEAD = `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <style>
    :root {
      --rh-primary:#5E3989; --rh-primary-dark:#3c2556; --rh-accent:#A90533;
      --rh-bg:#f8fafc; --rh-light-purple:#f3e9fa; --rh-surface:#ffffff;
      --rh-border:#e2e8f0; --rh-text:#1e293b; --rh-muted:#64748b;
    }
    * { box-sizing:border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--rh-bg); color:var(--rh-text); line-height:1.55; }
    a { color:inherit; text-decoration:none; }
    .rh-header { background:linear-gradient(135deg,var(--rh-primary-dark) 0%,var(--rh-primary) 55%,var(--rh-accent) 100%); color:#fff; padding:1.3rem 1.6rem 1.15rem; }
    .rh-header .eyebrow { font-size:.72rem; text-transform:uppercase; letter-spacing:.1em; opacity:.9; font-weight:600; }
    .rh-header h1 { margin:.25rem 0 .35rem; font-size:1.5rem; }
    .rh-header p { margin:0; font-size:.9rem; opacity:.95; max-width:70ch; }
    .crumb { display:inline-block; font-size:.8rem; color:#fff; background:rgba(255,255,255,.15); border:1px solid rgba(255,255,255,.35); border-radius:8px; padding:5px 10px; margin-bottom:.7rem; }
    .main { padding:1.2rem 1.6rem 3rem; max-width:1100px; }
    .toolbar { display:flex; gap:.7rem; align-items:center; flex-wrap:wrap; margin-bottom:.9rem; }
    .search { flex:1 1 280px; }
    .search input { width:100%; padding:.6rem .8rem; border:1px solid var(--rh-border); border-radius:10px; font-size:.95rem; background:#fff; }
    .summary { font-size:.82rem; color:var(--rh-muted); margin:.1rem 0 1.1rem; }
    .summary strong { color:var(--rh-text); }
    .section { margin:0 0 1.8rem; }
    .section-head { display:flex; align-items:center; gap:.6rem; margin:.2rem 0 .8rem; }
    .section-head h2 { font-size:1.12rem; color:var(--rh-primary-dark); margin:0; }
    .section-count { font-size:.72rem; font-weight:700; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:999px; padding:.05rem .55rem; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:.9rem; }
    .card { background:var(--rh-surface); border:1px solid var(--rh-border); border-radius:12px; padding:.9rem 1rem 1rem; display:flex; flex-direction:column; gap:.5rem; box-shadow:0 1px 2px rgba(15,23,42,.04); }
    .card-top { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; }
    .code { font-size:.72rem; font-weight:700; letter-spacing:.02em; color:#fff; background:var(--rh-primary); border-radius:6px; padding:.12rem .45rem; }
    .pill { font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:.08rem .5rem; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; }
    .date { font-size:.72rem; font-weight:700; color:#166534; background:#dcfce7; border:1px solid #bbf7d0; border-radius:6px; padding:.06rem .4rem; }
    .card-title { font-size:1rem; margin:.1rem 0 0; color:var(--rh-text); }
    .desc { font-size:.85rem; color:var(--rh-muted); margin:0; }
    .links { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:auto; padding-top:.3rem; }
    .chip { font-size:.78rem; font-weight:600; border-radius:8px; padding:.32rem .6rem; border:1px solid transparent; color:#fff; background:var(--rh-primary); }
    .chip:hover { background:var(--rh-primary-dark); }
    .chip-policy { color:#fff; background:var(--rh-primary); }
    .chip-policy:hover { background:var(--rh-primary-dark); }
    .chip-proc { color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; }
    .chip-proc:hover { background:#ead8f4; }
    .chip-combined { color:#fff; background:var(--rh-accent); }
    .chip-open { color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; }
    .chip-open:hover { background:#ead8f4; }
    .chip-stack { display:flex; flex-wrap:wrap; gap:.3rem; }
    /* ---- tabular layout ---- */
    .panel { background:var(--rh-surface); border:1px solid var(--rh-border); border-radius:12px; overflow:hidden; box-shadow:0 1px 2px rgba(15,23,42,.04); margin-bottom:1.3rem; }
    .table-wrap { overflow-x:auto; }
    table { width:100%; border-collapse:collapse; font-size:.88rem; }
    thead th { position:sticky; top:0; background:#faf7fd; text-align:left; font-size:.66rem; text-transform:uppercase; letter-spacing:.05em; color:var(--rh-primary-dark); font-weight:700; padding:.55rem .75rem; border-bottom:1px solid var(--rh-border); white-space:nowrap; }
    tbody td { padding:.55rem .75rem; border-bottom:1px solid #eef2f7; vertical-align:top; }
    tbody tr:last-child td { border-bottom:none; }
    tbody tr:hover { background:#fcfaff; }
    tr.paired td:first-child { box-shadow:inset 3px 0 0 #16a34a; }
    tr.partial td:first-child { box-shadow:inset 3px 0 0 #f59e0b; }
    .topic { font-weight:600; color:var(--rh-text); }
    .dash { color:#cbd5e1; font-weight:600; font-size:.8rem; }
    .tie { text-align:center; color:#16a34a; font-size:1rem; }
    .tie.none { color:#e2e8f0; }
    .owner { font-size:.8rem; color:var(--rh-muted); }
    .status { font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:.08rem .5rem; white-space:nowrap; }
    .status.paired { color:#166534; background:#dcfce7; border:1px solid #bbf7d0; }
    .status.partial { color:#9a3412; background:#ffedd5; border:1px solid #fed7aa; }
    .status.doc { color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; }
    .rev { display:flex; flex-direction:column; gap:.15rem; }
    .rchip { display:inline-block; width:fit-content; font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em; border-radius:999px; padding:.05rem .45rem; }
    .rchip.ok { color:#166534; background:#dcfce7; border:1px solid #bbf7d0; }
    .rchip.due-soon { color:#92400e; background:#fef3c7; border:1px solid #fde68a; }
    .rchip.overdue { color:#991b1b; background:#fee2e2; border:1px solid #fecaca; }
    .rchip.unknown { color:#475569; background:#f1f5f9; border:1px solid var(--rh-border); }
    .rmeta { font-size:.72rem; color:var(--rh-muted); white-space:nowrap; }
    .rmeta.muted { opacity:.8; }
    .recon { font-size:.7rem; font-weight:700; border-radius:6px; padding:.08rem .45rem; white-space:nowrap; cursor:default; }
    .recon.ok { color:#166534; background:#dcfce7; border:1px solid #bbf7d0; }
    .recon.pending { color:#9a3412; background:#ffedd5; border:1px solid #fed7aa; }
    .cat-row td { background:var(--rh-light-purple); color:var(--rh-primary-dark); font-weight:700; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; padding:.45rem .75rem; }
    .type-pill { font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:999px; padding:.06rem .5rem; white-space:nowrap; }
    .open-link { font-size:.82rem; font-weight:600; color:var(--rh-primary); }
    .open-link:hover { color:var(--rh-primary-dark); text-decoration:underline; }
    #empty { display:none; color:var(--rh-muted); font-size:.9rem; padding:1rem 0; }
  </style>
</head>`;

// ---- shared CQI cells (mirrors the /manual workspace) ----
function reviewStateLabel(state) {
    if (state === 'overdue') return 'Overdue';
    if (state === 'due-soon') return 'Due soon';
    if (state === 'ok') return 'On track';
    return '\u2014';
}
function reviewCell(review, state) {
    if (!review || !review.nextReviewDue) return '<span class="dash">\u2014</span>';
    return `<div class="rev">
      <span class="rchip ${escapeHtml(state)}">${reviewStateLabel(state)}</span>
      <span class="rmeta">due ${escapeHtml(review.nextReviewDue)}${review.cycle ? ` \u00b7 ${escapeHtml(review.cycle)}` : ''}</span>
      ${review.lastReviewed ? `<span class="rmeta muted">last ${escapeHtml(review.lastReviewed)}</span>` : ''}
    </div>`;
}
function reconCell(recon) {
    if (!recon || !recon.status) return '<span class="dash">\u2014</span>';
    const ok = String(recon.status).toLowerCase() === 'reconciled';
    const title = recon.note ? ` title="${escapeHtml(recon.note)}"` : '';
    return `<span class="recon ${ok ? 'ok' : 'pending'}"${title}>${escapeHtml(recon.status)}${recon.note ? ' \u24d8' : ''}</span>`;
}
function ownerCell(owner) {
    return owner ? `<span class="owner">${escapeHtml(owner)}</span>` : '<span class="dash">\u2014</span>';
}
function openLink(m) {
    const target = m.external ? ' target="_blank" rel="noopener"' : '';
    return `<a class="open-link" href="${escapeHtml(m.href)}"${target}>Open \u2192</a>`;
}

// Augment a compiled member with its doc kind (policy/procedure/combined) and
// CQI metadata so collection rows can pair and display the same governance data
// as the policy manual.
function enrichMember(m) {
    let kind = null;
    let code = '';
    let cqi = null;
    if (m.path) {
        kind = PM.kindForPath(m.path);
        const doc = getDocument(m.path);
        if (doc) {
            const meta = PM.parseDocMeta(doc.content);
            cqi = PM.extractCqiMeta(doc, meta);
            code = meta.number || '';
        }
    }
    return { ...m, kind, code, cqi };
}

// Pair policy/procedure/combined members within a group into one row per topic.
function pairTopics(docItems) {
    const map = new Map();
    const topicFor = (key) => {
        if (!map.has(key)) map.set(key, { code: '', title: '', policy: null, procedures: [], combined: [], cqi: null, reviewState: 'unknown' });
        return map.get(key);
    };
    for (const it of docItems) {
        // Pair on the shared code base first (policy FC-BC-01 ↔ procedure
        // FC-BC-01.1 both reduce to FC-BC-01), falling back to the title.
        const key = it.code || PM.titleKey(it.title) || it.title.toLowerCase();
        const topic = topicFor(key);
        if (it.kind === 'policy') { topic.policy = it; if (it.code && !topic.code) topic.code = it.code; }
        else if (it.kind === 'procedure') { topic.procedures.push(it); }
        else { topic.combined.push(it); if (it.code && !topic.code) topic.code = it.code; }
        if (!topic.title) topic.title = PM.stripKindSuffix(it.title) || it.title;
    }
    return [...map.values()].map((t) => {
        const lead = t.policy || t.combined[0] || t.procedures[0] || {};
        t.cqi = lead.cqi || null;
        t.reviewState = (lead.cqi && lead.cqi.reviewState) || 'unknown';
        t.code = t.code || lead.code || '';
        const leadTitle = (t.policy && t.policy.title) || (t.combined[0] && t.combined[0].title) || lead.title || t.title;
        t.title = PM.stripKindSuffix(leadTitle) || leadTitle;
        return t;
    }).sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, undefined, { numeric: true }));
}

const DETAIL_HEAD = `<thead><tr>
  <th style="width:84px">Code</th>
  <th>Topic / Item</th>
  <th style="width:140px">Policy</th>
  <th style="width:30px"></th>
  <th style="width:200px">Procedure(s)</th>
  <th style="width:140px">Owner</th>
  <th style="width:150px">Review</th>
  <th style="width:116px">Reconciliation</th>
  <th style="width:100px">Status</th>
</tr></thead>`;

function docChip(label, m, cls) {
    const target = m.external ? ' target="_blank" rel="noopener"' : '';
    return `<a class="chip ${cls}" href="${escapeHtml(m.href)}"${target}>${escapeHtml(label)} \u2192</a>`;
}

function renderTopicRow(t) {
    const policyCell = t.policy
        ? docChip('Policy', t.policy, 'chip-policy')
        : (t.combined.length ? '<span class="dash">\u2014 combined \u2014</span>' : '<span class="dash">\u2014 no policy \u2014</span>');
    const procChips = [
        ...t.combined.map((c) => docChip('Policy & Procedure', c, 'chip-combined')),
        ...t.procedures.map((p, i) => docChip(t.procedures.length > 1 ? `Procedure ${i + 1}` : 'Procedure', p, 'chip-proc'))
    ].join('');
    const procCell = procChips || '<span class="dash">\u2014 no companion procedure \u2014</span>';
    const paired = t.policy && (t.procedures.length || t.combined.length);
    const rowCls = paired ? 'paired' : 'partial';
    const tieCls = paired ? 'tie' : 'tie none';
    const statusPill = paired
        ? '<span class="status paired">Paired</span>'
        : (t.policy ? '<span class="status partial">Policy only</span>' : '<span class="status partial">Procedure only</span>');
    const cqi = t.cqi || {};
    const search = searchKey(t.title, t.code, cqi.owner, cqi.nextReviewDue, cqi.lastReviewed, cqi.reconciledStatus,
        t.policy && t.policy.path, ...t.procedures.map((p) => p.path));
    return `<tr class="${rowCls}" data-row data-search="${escapeHtml(search)}">
      <td>${t.code ? `<span class="code">${escapeHtml(t.code)}</span>` : '<span class="code muted">\u2014</span>'}</td>
      <td><div class="topic">${escapeHtml(t.title)}</div></td>
      <td>${policyCell}</td>
      <td class="${tieCls}">\u2194</td>
      <td><div class="chip-stack">${procCell}</div></td>
      <td>${ownerCell(cqi.owner)}</td>
      <td>${reviewCell(cqi.review, t.reviewState)}</td>
      <td>${reconCell(cqi.reconciliation)}</td>
      <td>${statusPill}</td>
    </tr>`;
}

function renderAssetRow(m) {
    const cqi = m.cqi || {};
    const search = searchKey(m.title, m.type, m.path, m.category, m.date, cqi.owner, cqi.reconciledStatus);
    return `<tr data-row data-search="${escapeHtml(search)}">
      <td>${m.code ? `<span class="code">${escapeHtml(m.code)}</span>` : '<span class="type-pill">${escapeHtml(m.type)}</span>'}</td>
      <td><div class="topic">${escapeHtml(m.title)}</div></td>
      <td colspan="3">${docChip('Open', m, 'chip-open')}</td>
      <td>${ownerCell(cqi.owner)}</td>
      <td>${reviewCell(cqi.review, cqi.reviewState)}</td>
      <td>${reconCell(cqi.reconciliation)}</td>
      <td><span class="status doc">${escapeHtml(m.type)}</span></td>
    </tr>`;
}

// Review-assets collections stay a simple dated list (newest first).
function renderReviewAssetsTable(groups) {
    const sections = groups.map((g) => {
        const rows = g.items.map((m) => {
            const search = searchKey(m.title, m.type, m.path, m.category, m.date);
            return `<tr data-row data-search="${escapeHtml(search)}">
              <td><span class="type-pill">${escapeHtml(m.type)}</span></td>
              <td><div class="topic">${escapeHtml(m.title)}</div></td>
              <td>${m.date ? `<span class="date">${escapeHtml(m.date)}</span>` : '<span class="dash">\u2014</span>'}</td>
              <td>${openLink(m)}</td>
            </tr>`;
        }).join('');
        return `<tr class="cat-row"><td colspan="4">${escapeHtml(g.category)}</td></tr>${rows}`;
    }).join('');
    return `<div class="panel table-wrap"><table>
      <thead><tr><th style="width:150px">Type</th><th>Item</th><th style="width:110px">Date</th><th style="width:90px">Open</th></tr></thead>
      <tbody>${sections}</tbody>
    </table></div>`;
}

// Doc-centric collections: pair policy/procedure rows + show CQI columns.
function renderDocCollectionTable(groups) {
    const body = groups.map((g) => {
        const items = g.items.map(enrichMember);
        const docItems = items.filter((m) => m.kind === 'policy' || m.kind === 'procedure' || m.kind === 'combined');
        const assetItems = items.filter((m) => !(m.kind === 'policy' || m.kind === 'procedure' || m.kind === 'combined'));
        const topicRows = pairTopics(docItems).map(renderTopicRow).join('');
        const assetRows = assetItems.map(renderAssetRow).join('');
        return `<tr class="cat-row"><td colspan="9">${escapeHtml(g.category)}</td></tr>${topicRows}${assetRows}`;
    }).join('');
    return `<div class="panel table-wrap"><table>${DETAIL_HEAD}<tbody>${body}</tbody></table></div>`;
}

// GET /collections — list every collection the caller may see.
router.get('/', (req, res) => {
    const all = listCollections().filter((c) => allows(req, c.access));
    noStore(res);

    if (wantsJson(req)) {
        return res.json({ generatedAt: new Date().toISOString(), count: all.length, collections: all });
    }

    const rows = all.map((c) => {
        const search = searchKey(c.title, c.code, c.description, c.type);
        return `<tr data-row data-search="${escapeHtml(search)}">
          <td><span class="code">${escapeHtml(c.code)}</span></td>
          <td><div class="topic">${escapeHtml(c.title)}</div>${c.description ? `<div class="excerpt">${escapeHtml(c.description)}</div>` : ''}</td>
          <td><span class="type-pill">${escapeHtml(c.type)}</span></td>
          <td>${c.resourceCount ? `<span class="owner">${c.resourceCount} resource${c.resourceCount === 1 ? '' : 's'}</span>` : '<span class="dash">\u2014</span>'}</td>
          <td><a class="open-link" href="${escapeHtml(c.url)}">Open \u2192</a></td>
        </tr>`;
    }).join('');
    res.type('html').send(`<!doctype html>
<html lang="en">
${PAGE_HEAD.replace('<head>', '<head>\n  <title>Collections - Refuge House Compliance</title>')}
<body>
  <header class="rh-header">
    <a class="crumb" href="/">\u2190 Compliance Library</a>
    <span class="eyebrow">Refuge House, Inc. · Compliance</span>
    <h1>Collections</h1>
    <p>Compiled manuals, handbooks, and curated sets. Each collection is assembled automatically from the knowbase registry and document metadata.</p>
  </header>
  <main class="main">
    <div class="toolbar"><div class="search"><input type="search" id="q" placeholder="Search collections\u2026" autocomplete="off" /></div></div>
    <p class="summary"><strong>${all.length}</strong> collection${all.length === 1 ? '' : 's'} available <span id="filtered"></span></p>
    <p id="empty">No collections match your search.</p>
    <div class="panel table-wrap"><table>
      <thead><tr><th style="width:96px">Code</th><th>Collection</th><th style="width:130px">Type</th><th style="width:120px">Contents</th><th style="width:90px">Open</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </main>
  <script>
    (function () {
      var q = document.getElementById('q');
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');
      q.addEventListener('input', function () {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        rows.forEach(function (row) {
          var match = !term || row.dataset.search.indexOf(term) !== -1;
          row.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        empty.style.display = shown ? 'none' : 'block';
        filtered.textContent = term ? '· ' + shown + ' shown' : '';
      });
    })();
  </script>
</body>
</html>`);
});

// GET /collections/:code — a single compiled, grouped collection.
router.get('/:code', (req, res) => {
    const model = compileCollection(req.params.code);
    noStore(res);

    if (!model) {
        if (wantsJson(req)) return res.status(404).json({ error: 'Collection not found', code: req.params.code });
        return res.status(404).type('html').send('<!doctype html><h1>Collection not found</h1><p><a href="/collections">All collections</a></p>');
    }

    // Gate the whole collection by its audience tier.
    if (!allows(req, model.access)) return deny(req, res, model.access);

    // Filter each group's items by the caller's tier; drop now-empty groups.
    const groups = model.groups
        .map((g) => ({ category: g.category, items: g.items.filter((m) => allows(req, m.access)) }))
        .filter((g) => g.items.length);
    const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);

    if (wantsJson(req)) {
        return res.json({
            generatedAt: new Date().toISOString(),
            code: model.code,
            title: model.title,
            type: model.type,
            counts: { members: visibleCount, groups: groups.length },
            groups
        });
    }

    const body = model.isReviewAssets
        ? renderReviewAssetsTable(groups)
        : renderDocCollectionTable(groups);

    res.type('html').send(`<!doctype html>
<html lang="en">
${PAGE_HEAD.replace('<head>', `<head>\n  <title>${escapeHtml(model.title)} - Refuge House Compliance</title>`)}
<body>
  <header class="rh-header">
    <a class="crumb" href="/collections">\u2190 All collections</a>
    <span class="eyebrow">Refuge House, Inc. · Compliance · ${escapeHtml(model.type)}</span>
    <h1>${escapeHtml(model.title)}</h1>
    ${model.description ? `<p>${escapeHtml(model.description)}</p>` : ''}
  </header>
  <main class="main">
    <div class="toolbar"><div class="search"><input type="search" id="q" placeholder="Search this collection\u2026" autocomplete="off" /></div></div>
    <p class="summary"><strong>${visibleCount}</strong> item${visibleCount === 1 ? '' : 's'} in <strong>${groups.length}</strong> group${groups.length === 1 ? '' : 's'} <span id="filtered"></span></p>
    <p id="empty">No items match your search.</p>
    ${visibleCount ? body : '<p class="summary">No items are available to you in this collection yet.</p>'}
  </main>
  <script>
    (function () {
      var q = document.getElementById('q');
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
      var catRows = Array.prototype.slice.call(document.querySelectorAll('.cat-row'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');
      q.addEventListener('input', function () {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        rows.forEach(function (row) {
          var match = !term || row.dataset.search.indexOf(term) !== -1;
          row.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        // Hide a category header when all its rows below it are hidden.
        catRows.forEach(function (cat) {
          var any = false;
          var n = cat.nextElementSibling;
          while (n && !n.classList.contains('cat-row')) {
            if (n.hasAttribute('data-row') && n.style.display !== 'none') { any = true; break; }
            n = n.nextElementSibling;
          }
          cat.style.display = any ? '' : 'none';
        });
        empty.style.display = shown ? 'none' : 'block';
        filtered.textContent = term ? '· ' + shown + ' shown' : '';
      });
    })();
  </script>
</body>
</html>`);
});

module.exports = router;
