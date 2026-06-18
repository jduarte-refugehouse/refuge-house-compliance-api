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
    #empty { display:none; color:var(--rh-muted); font-size:.9rem; padding:1rem 0; }
  </style>
</head>`;

function renderCollectionCard(c) {
    const search = searchKey(c.title, c.code, c.description, c.type);
    return `<article class="card" data-search="${escapeHtml(search)}">
      <div class="card-top">
        <span class="code">${escapeHtml(c.code)}</span>
        <span class="pill">${escapeHtml(c.type)}</span>
      </div>
      <h3 class="card-title">${escapeHtml(c.title)}</h3>
      ${c.description ? `<p class="desc">${escapeHtml(c.description)}</p>` : ''}
      <div class="links"><a class="chip" href="${escapeHtml(c.url)}">Open collection \u2192</a></div>
    </article>`;
}

function renderMemberCard(m, showDate) {
    const search = searchKey(m.title, m.type, m.path, m.category, m.date);
    const target = m.external ? ' target="_blank" rel="noopener"' : '';
    return `<article class="card" data-search="${escapeHtml(search)}">
      <div class="card-top">
        <span class="pill">${escapeHtml(m.type)}</span>
        ${showDate && m.date ? `<span class="date">${escapeHtml(m.date)}</span>` : ''}
      </div>
      <h3 class="card-title">${escapeHtml(m.title)}</h3>
      <div class="links"><a class="chip" href="${escapeHtml(m.href)}"${target}>Open \u2192</a></div>
    </article>`;
}

// GET /collections — list every collection the caller may see.
router.get('/', (req, res) => {
    const all = listCollections().filter((c) => allows(req, c.access));
    noStore(res);

    if (wantsJson(req)) {
        return res.json({ generatedAt: new Date().toISOString(), count: all.length, collections: all });
    }

    const cards = all.map(renderCollectionCard).join('');
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
    <div class="cards">${cards}</div>
  </main>
  <script>
    (function () {
      var q = document.getElementById('q');
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');
      q.addEventListener('input', function () {
        var term = (q.value || '').trim().toLowerCase();
        var shown = 0;
        cards.forEach(function (card) {
          var match = !term || card.dataset.search.indexOf(term) !== -1;
          card.style.display = match ? '' : 'none';
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

    const sections = groups.map((g) => `<section class="section" data-section>
      <div class="section-head"><h2>${escapeHtml(g.category)}</h2><span class="section-count">${g.items.length}</span></div>
      <div class="cards">${g.items.map((m) => renderMemberCard(m, model.isReviewAssets)).join('')}</div>
    </section>`).join('');

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
    ${sections || '<p class="summary">No items are available to you in this collection yet.</p>'}
  </main>
  <script>
    (function () {
      var q = document.getElementById('q');
      var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
      var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
      var empty = document.getElementById('empty');
      var filtered = document.getElementById('filtered');
      q.addEventListener('input', function () {
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
        filtered.textContent = term ? '· ' + shown + ' shown' : '';
      });
    })();
  </script>
</body>
</html>`);
});

module.exports = router;
