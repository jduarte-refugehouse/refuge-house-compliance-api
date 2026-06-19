// routes/manual.js
// Policies & Procedures workspace: a dynamic, browsable manual that catalogs
// the knowbase, aligns each policy with its companion procedure(s), and shows
// purpose excerpts. Public route (access tiers still hide gated docs per caller).
const express = require('express');
const router = express.Router();
const { getAllDocuments } = require('../services/knowbase-loader');
const { buildManual } = require('../services/policy-manual');
const { allows } = require('../middleware/human-auth');
const { accessForDoc } = require('../utils/access');

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

function docChip(label, ref, cls) {
    return `<a class="chip ${cls}" href="/public/documents/${escapeHtml(ref.slug)}" target="_blank" rel="noopener">${escapeHtml(label)} \u2192</a>`;
}

function reviewStateLabel(state) {
    if (state === 'overdue') return 'Overdue';
    if (state === 'due-soon') return 'Due soon';
    if (state === 'ok') return 'On track';
    return '\u2014';
}

// Review cycle cell: an at-a-glance state chip + next-due (with cycle) and the
// last-reviewed date. The single most useful CQI signal on the page.
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

function ownerCell(owner, department) {
    const v = owner || department;
    return v ? `<span class="owner">${escapeHtml(v)}</span>` : '<span class="dash">\u2014</span>';
}

const TABLE_HEAD = `<thead><tr>
  <th style="width:84px">Code</th>
  <th>Topic</th>
  <th style="width:140px">Policy</th>
  <th style="width:30px"></th>
  <th style="width:210px">Procedure(s)</th>
  <th style="width:140px">Owner</th>
  <th style="width:152px">Review</th>
  <th style="width:118px">Reconciliation</th>
  <th style="width:104px">Status</th>
</tr></thead>`;

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

    const search = searchKey(t.title, t.code, t.department, t.owner, t.excerpt,
        t.review && t.review.nextReviewDue, t.review && t.review.lastReviewed,
        t.reconciliation && t.reconciliation.status,
        t.policy && t.policy.path, ...t.procedures.map((p) => p.path));

    return `<tr class="${rowCls}" data-row data-search="${escapeHtml(search)}">
      <td>${t.code ? `<span class="code">${escapeHtml(t.code)}</span>` : '<span class="code muted">\u2014</span>'}</td>
      <td><div class="topic">${escapeHtml(t.title)}</div>${t.excerpt ? `<div class="excerpt">${escapeHtml(t.excerpt)}</div>` : ''}</td>
      <td>${policyCell}</td>
      <td class="${tieCls}">\u2194</td>
      <td><div class="chip-stack">${procCell}</div></td>
      <td>${ownerCell(t.owner, t.department)}</td>
      <td>${reviewCell(t.review, t.reviewState)}</td>
      <td>${reconCell(t.reconciliation)}</td>
      <td>${statusPill}</td>
    </tr>`;
}

function renderDocRow(d) {
    const search = searchKey(d.title, d.code, d.department, d.owner, d.excerpt,
        d.review && d.review.nextReviewDue, d.reconciliation && d.reconciliation.status, d.path);
    return `<tr data-row data-search="${escapeHtml(search)}">
      <td>${d.code ? `<span class="code">${escapeHtml(d.code)}</span>` : '<span class="code muted">\u2014</span>'}</td>
      <td><div class="topic">${escapeHtml(d.title)}</div>${d.excerpt ? `<div class="excerpt">${escapeHtml(d.excerpt)}</div>` : ''}</td>
      <td colspan="3">${docChip('Open document', d, 'chip-policy')}</td>
      <td>${ownerCell(d.owner, d.department)}</td>
      <td>${reviewCell(d.review, d.reviewState)}</td>
      <td>${reconCell(d.reconciliation)}</td>
      <td><span class="status doc">Document</span></td>
    </tr>`;
}

function renderSection(section) {
    const isPaired = section.kind === 'paired';
    const count = isPaired ? section.topics.length : section.docs.length;
    const rows = isPaired
        ? section.topics.map(renderTopicRow).join('')
        : section.docs.map(renderDocRow).join('');
    return `<section class="section" id="sec-${escapeHtml(section.id)}" data-section>
      <div class="section-head">
        <h2>${escapeHtml(section.title)}</h2>
        <span class="section-count">${count}</span>
      </div>
      <div class="panel table-wrap">
        <table>${TABLE_HEAD}<tbody>${rows}</tbody></table>
      </div>
    </section>`;
}

router.get('/', async (req, res) => {
    const isVisible = (docPath, doc) => allows(req, accessForDoc(doc));
    const model = buildManual(getAllDocuments(), isVisible, accessForDoc);
    noStore(res);

    const navItems = model.sections.map((s) => {
        const count = s.kind === 'paired' ? s.topics.length : s.docs.length;
        return `<a class="nav-item" href="#sec-${escapeHtml(s.id)}" data-nav="${escapeHtml(s.id)}">
          <span>${escapeHtml(s.title)}</span><span class="nav-count">${count}</span></a>`;
    }).join('');

    const sectionsHtml = model.sections.map(renderSection).join('');
    const c = model.counts;

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Policies &amp; Procedures Workspace - Refuge House</title>
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
    .rh-header p { margin:0; font-size:.9rem; opacity:.95; max-width:60ch; }
    .layout { display:grid; grid-template-columns:248px 1fr; gap:0; align-items:start; }
    .sidebar { position:sticky; top:0; align-self:start; height:100vh; overflow:auto; border-right:1px solid var(--rh-border); background:var(--rh-surface); padding:1rem .9rem 2rem; }
    .sidebar .crumb { display:inline-block; font-size:.8rem; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:8px; padding:6px 10px; margin-bottom:1rem; }
    .sidebar h4 { font-size:.7rem; text-transform:uppercase; letter-spacing:.08em; color:var(--rh-muted); margin:1.1rem .3rem .4rem; }
    .nav-item { display:flex; justify-content:space-between; align-items:center; gap:.5rem; padding:.5rem .6rem; border-radius:8px; font-size:.9rem; color:var(--rh-text); }
    .nav-item:hover, .nav-item.active { background:var(--rh-light-purple); color:var(--rh-primary-dark); }
    .nav-count { font-size:.72rem; font-weight:700; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:999px; padding:.02rem .45rem; }
    .nav-item.active .nav-count { background:#fff; }
    .main { padding:1.2rem 1.6rem 3rem; min-width:0; }
    .toolbar { display:flex; gap:.7rem; align-items:center; flex-wrap:wrap; margin-bottom:.6rem; }
    .search { flex:1 1 280px; }
    .search input { width:100%; padding:.6rem .8rem; border:1px solid var(--rh-border); border-radius:10px; font-size:.95rem; background:#fff; }
    .btn { font-size:.85rem; padding:.55rem .8rem; border:1px solid #d4b5e4; border-radius:9px; background:var(--rh-light-purple); color:var(--rh-primary); }
    .btn:hover { background:#ead8f4; }
    .summary { font-size:.82rem; color:var(--rh-muted); margin:.1rem 0 1.1rem; }
    .summary strong { color:var(--rh-text); }
    .section { margin:0 0 1.8rem; scroll-margin-top:.6rem; }
    .section-head { display:flex; align-items:center; gap:.6rem; margin:.2rem 0 .8rem; }
    .section-head h2 { font-size:1.12rem; color:var(--rh-primary-dark); margin:0; }
    .section-count { font-size:.72rem; font-weight:700; color:var(--rh-primary); background:var(--rh-light-purple); border:1px solid #d4b5e4; border-radius:999px; padding:.05rem .55rem; }
    .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:.9rem; }
    .card { background:var(--rh-surface); border:1px solid var(--rh-border); border-radius:12px; padding:.9rem 1rem 1rem; display:flex; flex-direction:column; gap:.5rem; box-shadow:0 1px 2px rgba(15,23,42,.04); }
    .card-top { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; }
    .code { font-size:.72rem; font-weight:700; letter-spacing:.02em; color:#fff; background:var(--rh-primary); border-radius:6px; padding:.12rem .45rem; }
    .dept { font-size:.72rem; color:var(--rh-muted); }
    .status { font-size:.66rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:.08rem .5rem; }
    .status-paired { color:#166534; background:#dcfce7; border:1px solid #bbf7d0; }
    .status-partial { color:#9a3412; background:#ffedd5; border:1px solid #fed7aa; }
    .card-title { font-size:1rem; margin:.1rem 0 0; color:var(--rh-text); }
    .excerpt { font-size:.85rem; color:var(--rh-muted); margin:0; }
    .excerpt-empty { font-style:italic; opacity:.8; }
    .links { display:flex; flex-wrap:wrap; gap:.4rem; margin-top:auto; padding-top:.3rem; }
    .chip { font-size:.78rem; font-weight:600; border-radius:8px; padding:.32rem .6rem; border:1px solid transparent; }
    .chip-policy { color:#fff; background:var(--rh-primary); }
    .chip-policy:hover { background:var(--rh-primary-dark); }
    .chip-proc { color:var(--rh-primary); background:var(--rh-light-purple); border-color:#d4b5e4; }
    .chip-proc:hover { background:#ead8f4; }
    .chip-combined { color:#fff; background:var(--rh-accent); }
    .chip-missing { color:#94a3b8; background:#f1f5f9; border-color:var(--rh-border); }
    .chip-stack { display:flex; flex-wrap:wrap; gap:.3rem; }
    /* ---- tabular layout ---- */
    .table-wrap { overflow-x:auto; padding:0; }
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
    #empty { display:none; color:var(--rh-muted); font-size:.9rem; padding:1rem 0; }
    @media (max-width: 820px) {
      .layout { grid-template-columns:1fr; }
      .sidebar { position:static; height:auto; border-right:none; border-bottom:1px solid var(--rh-border); }
    }
  </style>
</head>
<body>
  <header class="rh-header">
    <span class="eyebrow">Refuge House, Inc. · Compliance</span>
    <h1>Policies &amp; Procedures Workspace</h1>
    <p>Every policy aligned with its companion procedure(s), cataloged automatically from the knowbase. Search, browse, and open any document.</p>
  </header>
  <div class="layout">
    <aside class="sidebar">
      <a class="crumb" href="/">\u2190 Compliance Library</a>
      <h4>Sections</h4>
      <nav id="nav">${navItems}</nav>
      <h4>Also</h4>
      <a class="nav-item" href="/site-index"><span>Full Site Index</span></a>
      <a class="nav-item" href="/review/fy26-sscc"><span>FY-26 Desk Review</span></a>
    </aside>
    <main class="main">
      <div class="toolbar">
        <div class="search"><input type="search" id="q" placeholder="Search policies, procedures, departments\u2026" autocomplete="off" /></div>
        <button class="btn" onclick="window.print()">Print manual</button>
      </div>
      <p class="summary">
        <strong>${c.topics}</strong> topics ·
        <strong>${c.paired}</strong> fully paired ·
        <strong>${c.policies}</strong> policies ·
        <strong>${c.procedures}</strong> procedures ·
        <strong>${c.personnel}</strong> personnel/HR ·
        <strong>${c.plans}</strong> plans
        ${c.reviewOverdue ? ` · <strong style="color:#991b1b">${c.reviewOverdue}</strong> review overdue` : ''}
        ${c.reviewDueSoon ? ` · <strong style="color:#92400e">${c.reviewDueSoon}</strong> due soon` : ''}
        <span id="filtered"></span>
      </p>
      <p id="empty">No documents match your search.</p>
      ${sectionsHtml}
    </main>
  </div>
  <script>
    (function () {
      var q = document.getElementById('q');
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
      var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');

      function applyFilter() {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        rows.forEach(function (row) {
          var match = !term || row.dataset.search.indexOf(term) !== -1;
          row.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        sections.forEach(function (sec) {
          var any = sec.querySelector('[data-row]:not([style*="display: none"])');
          sec.style.display = any ? '' : 'none';
        });
        empty.style.display = shown ? 'none' : 'block';
        filtered.textContent = term ? ' · ' + shown + ' shown' : '';
      }
      q.addEventListener('input', applyFilter);

      // Highlight the section currently in view in the sidebar.
      var navLinks = {};
      document.querySelectorAll('[data-nav]').forEach(function (a) { navLinks[a.dataset.nav] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var id = e.target.id.replace('sec-', '');
          Object.values(navLinks).forEach(function (a) { a.classList.remove('active'); });
          if (navLinks[id]) navLinks[id].classList.add('active');
        });
      }, { rootMargin: '-10% 0px -80% 0px' });
      sections.forEach(function (s) { io.observe(s); });
    })();
  </script>
</body>
</html>`);
});

module.exports = router;
