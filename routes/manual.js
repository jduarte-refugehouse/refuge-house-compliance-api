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

function docLink(label, ref, cls) {
    if (!ref) return `<span class="chip chip-missing">${escapeHtml(label)}: \u2014</span>`;
    return `<a class="chip ${cls}" href="/public/documents/${escapeHtml(ref.slug)}" target="_blank" rel="noopener">${escapeHtml(label)} \u2192</a>`;
}

function renderTopicCard(t) {
    const procChips = t.procedures.map((p, i) =>
        docLink(t.procedures.length > 1 ? `Procedure ${i + 1}` : 'Procedure', p, 'chip-proc')).join('');
    const combinedChips = t.combined.map((c) =>
        docLink('Policy & Procedure', c, 'chip-combined')).join('');
    const policyChip = t.combined.length && !t.policy ? '' : docLink('Policy', t.policy, 'chip-policy');

    const search = searchKey(t.title, t.code, t.department, t.excerpt,
        t.policy && t.policy.path, ...t.procedures.map((p) => p.path));

    const paired = t.policy && (t.procedures.length || t.combined.length);
    const statusChip = paired
        ? '<span class="status status-paired">Paired</span>'
        : (t.policy ? '<span class="status status-partial">Policy only</span>'
            : '<span class="status status-partial">Procedure only</span>');

    return `<article class="card" data-search="${escapeHtml(search)}">
      <div class="card-top">
        ${t.code ? `<span class="code">${escapeHtml(t.code)}</span>` : ''}
        ${statusChip}
        ${t.department ? `<span class="dept">${escapeHtml(t.department)}</span>` : ''}
      </div>
      <h3 class="card-title">${escapeHtml(t.title)}</h3>
      ${t.excerpt ? `<p class="excerpt">${escapeHtml(t.excerpt)}</p>` : '<p class="excerpt excerpt-empty">No purpose summary available.</p>'}
      <div class="links">${policyChip}${combinedChips}${procChips}</div>
    </article>`;
}

function renderDocCard(d) {
    const search = searchKey(d.title, d.code, d.department, d.excerpt, d.path);
    return `<article class="card" data-search="${escapeHtml(search)}">
      <div class="card-top">
        ${d.code ? `<span class="code">${escapeHtml(d.code)}</span>` : ''}
        ${d.department ? `<span class="dept">${escapeHtml(d.department)}</span>` : ''}
      </div>
      <h3 class="card-title">${escapeHtml(d.title)}</h3>
      ${d.excerpt ? `<p class="excerpt">${escapeHtml(d.excerpt)}</p>` : '<p class="excerpt excerpt-empty">No summary available.</p>'}
      <div class="links">${docLink('Open document', d, 'chip-policy')}</div>
    </article>`;
}

function renderSection(section) {
    const count = section.kind === 'paired' ? section.topics.length : section.docs.length;
    const cards = section.kind === 'paired'
        ? section.topics.map(renderTopicCard).join('')
        : section.docs.map(renderDocCard).join('');
    return `<section class="section" id="sec-${escapeHtml(section.id)}" data-section>
      <div class="section-head">
        <h2>${escapeHtml(section.title)}</h2>
        <span class="section-count">${count}</span>
      </div>
      <div class="cards">${cards}</div>
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
        <span id="filtered"></span>
      </p>
      <p id="empty">No documents match your search.</p>
      ${sectionsHtml}
    </main>
  </div>
  <script>
    (function () {
      var q = document.getElementById('q');
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');

      function applyFilter() {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var match = !term || card.dataset.search.indexOf(term) !== -1;
          card.style.display = match ? '' : 'none';
          if (match) shown++;
        });
        sections.forEach(function (sec) {
          var any = sec.querySelector('.card:not([style*="display: none"])');
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
