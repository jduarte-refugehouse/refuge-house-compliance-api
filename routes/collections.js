// routes/collections.js — REDESIGNED to use the Refuge House design system.
// Data/plumbing is UNCHANGED from the original; only presentation was updated:
//   GET /collections        -> card grid of collections
//   GET /collections/:code  -> a single compiled, grouped CQI table
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

// Shared <head>. Pass a page title.
function head(title) {
    return `<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
  <link rel="stylesheet" href="/rh-compliance.css" />
</head>`;
}

// Shared sidebar. `crumbHref` = back target, `active` = which Browse item is current.
function sidebar(crumbHref, active) {
    const item = (href, icon, label) =>
        `<a class="nav-item${active === href ? ' active' : ''}" href="${href}"><i class="fas ${icon}"></i><span class="lbl">${label}</span></a>`;
    return `<aside class="side" id="side">
      <div class="side-logo"><img src="/logo.png" alt="Refuge House" /></div>
      <div class="side-scroll">
        <a class="crumb" href="${crumbHref}"><i class="fas fa-arrow-left"></i>${crumbHref === '/collections' ? 'All collections' : 'Compliance Library'}</a>
        <div class="side-group">
          <div class="side-label">Browse</div>
          ${item('/collections', 'fa-layer-group', 'All Collections')}
          ${item('/manual', 'fa-book-open', 'Policies &amp; Procedures')}
          ${item('/site-index', 'fa-sitemap', 'Full Site Index')}
          ${item('/', 'fa-comments', 'Ask the Library')}
        </div>
      </div>
    </aside>
    <div class="scrim" id="scrim" onclick="closeSide()"></div>`;
}

const FILTER_SCRIPT = `<script>
  (function () {
    var q = document.getElementById('q');
    var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
    var catRows = Array.prototype.slice.call(document.querySelectorAll('.cat-row'));
    var empty = document.getElementById('empty');
    if (q) q.addEventListener('input', function () {
      var term = (q.value || '').trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (row) {
        var match = !term || row.dataset.search.indexOf(term) !== -1;
        row.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      catRows.forEach(function (cat) {
        var any = false, n = cat.nextElementSibling;
        while (n && !n.classList.contains('cat-row')) {
          if (n.hasAttribute('data-row') && n.style.display !== 'none') { any = true; break; }
          n = n.nextElementSibling;
        }
        cat.style.display = any ? '' : 'none';
      });
      if (empty) empty.style.display = shown ? 'none' : 'block';
    });
  })();
  function openSide(){ document.getElementById('side').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
  function closeSide(){ document.getElementById('side').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
</script>`;

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
    return `<span class="recon ${ok ? 'ok' : 'pending'}"${title}><i class="fas ${ok ? 'fa-check' : 'fa-clock'}"></i>${escapeHtml(recon.status)}${recon.note ? ' \u24d8' : ''}</span>`;
}
function ownerCell(owner) {
    return owner ? `<span class="owner">${escapeHtml(owner)}</span>` : '<span class="dash">\u2014</span>';
}
function openLink(m) {
    const target = m.external ? ' target="_blank" rel="noopener"' : '';
    return `<a class="open-link" href="${escapeHtml(m.href)}"${target}>Open \u2192</a>`;
}

function enrichMember(m) {
    let kind = null, code = '', cqi = null;
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

function pairTopics(docItems) {
    const map = new Map();
    const topicFor = (key) => {
        if (!map.has(key)) map.set(key, { code: '', title: '', policy: null, procedures: [], combined: [], cqi: null, reviewState: 'unknown' });
        return map.get(key);
    };
    for (const it of docItems) {
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
  <th style="width:72px">Code</th>
  <th>Topic / Item</th>
  <th style="width:90px">Policy</th>
  <th style="width:20px"></th>
  <th style="width:138px">Procedure(s)</th>
  <th style="width:108px">Owner</th>
  <th style="width:150px">Review</th>
  <th style="width:100px">Reconciliation</th>
  <th style="width:92px">Status</th>
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
    const procCell = procChips || '<span class="dash">\u2014 no companion \u2014</span>';
    const paired = t.policy && (t.procedures.length || t.combined.length);
    const rowCls = paired ? 'paired' : 'partial';
    const tieCls = paired ? 'tie' : 'tie none';
    const statusPill = paired
        ? '<span class="status paired">Paired</span>'
        : (t.policy ? '<span class="status partial">Policy</span>' : '<span class="status partial">Procedure</span>');
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
      <td>${m.code ? `<span class="code">${escapeHtml(m.code)}</span>` : `<span class="type-pill">${escapeHtml(m.type)}</span>`}</td>
      <td><div class="topic">${escapeHtml(m.title)}</div></td>
      <td colspan="3">${docChip('Open', m, 'chip-open')}</td>
      <td>${ownerCell(cqi.owner)}</td>
      <td>${reviewCell(cqi.review, cqi.reviewState)}</td>
      <td>${reconCell(cqi.reconciliation)}</td>
      <td><span class="status doc">${escapeHtml(m.type)}</span></td>
    </tr>`;
}

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
        return `<tr class="cat-row"><td colspan="4"><i class="fas fa-folder-open"></i>${escapeHtml(g.category)}</td></tr>${rows}`;
    }).join('');
    return `<div class="panel table-wrap"><table>
      <thead><tr><th style="width:150px">Type</th><th>Item</th><th style="width:110px">Date</th><th style="width:90px">Open</th></tr></thead>
      <tbody>${sections}</tbody>
    </table></div>`;
}

function renderDocCollectionTable(groups) {
    const body = groups.map((g) => {
        const items = g.items.map(enrichMember);
        const docItems = items.filter((m) => m.kind === 'policy' || m.kind === 'procedure' || m.kind === 'combined');
        const assetItems = items.filter((m) => !(m.kind === 'policy' || m.kind === 'procedure' || m.kind === 'combined'));
        const topicRows = pairTopics(docItems).map(renderTopicRow).join('');
        const assetRows = assetItems.map(renderAssetRow).join('');
        return `<tr class="cat-row"><td colspan="9"><i class="fas fa-folder-open"></i>${escapeHtml(g.category)}</td></tr>${topicRows}${assetRows}`;
    }).join('');
    return `<div class="panel table-wrap"><table>${DETAIL_HEAD}<tbody>${body}</tbody></table></div>`;
}

// Map a collection type to a Font Awesome icon for the card grid.
function iconForType(type) {
    const t = String(type || '').toLowerCase();
    if (t.includes('handbook')) return 'fa-book';
    if (t.includes('manual')) return 'fa-book-open';
    if (t.includes('review')) return 'fa-clipboard-check';
    if (t.includes('curated') || t.includes('set')) return 'fa-box';
    return 'fa-layer-group';
}

// GET /collections — card grid of every collection the caller may see.
router.get('/', (req, res) => {
    const all = listCollections().filter((c) => allows(req, c.access));
    noStore(res);

    if (wantsJson(req)) {
        return res.json({ generatedAt: new Date().toISOString(), count: all.length, collections: all });
    }

    const cards = all.map((c) => {
        const search = searchKey(c.title, c.code, c.description, c.type);
        return `<a class="coll-card" href="${escapeHtml(c.url)}" data-row data-search="${escapeHtml(search)}">
          <div class="coll-top"><span class="code">${escapeHtml(c.code)}</span><span class="type-pill">${escapeHtml(c.type)}</span></div>
          <h3>${escapeHtml(c.title)}</h3>
          ${c.description ? `<p class="coll-desc">${escapeHtml(c.description)}</p>` : '<p class="coll-desc"></p>'}
          <div class="coll-foot">
            <span class="coll-count"><i class="fas ${iconForType(c.type)}"></i>${c.resourceCount ? `${c.resourceCount} resource${c.resourceCount === 1 ? '' : 's'}` : 'Open'}</span>
            <span class="coll-open">Open <i class="fas fa-arrow-right"></i></span>
          </div>
        </a>`;
    }).join('');

    const summary = `<span class="stat purple"><span class="ic"></span><b>${all.length}</b> collection${all.length === 1 ? '' : 's'}</span>`;

    res.type('html').send(`<!doctype html>
<html lang="en">
${head('Collections - Refuge House Compliance')}
<body>
  <div class="app">
    ${sidebar('/', '/collections')}
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:flex-start;gap:14px;min-width:0">
          <button class="menu-btn" onclick="openSide()" aria-label="Menu"><i class="fas fa-bars"></i></button>
          <div style="min-width:0">
            <div class="eyebrow">Refuge House &middot; Compliance</div>
            <h1>Collections</h1>
            <p class="sub">Compiled manuals, handbooks, and curated sets &mdash; each assembled automatically from the knowbase registry.</p>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="search"><i class="fas fa-magnifying-glass"></i><input type="search" id="q" placeholder="Search collections\u2026" autocomplete="off" /></div>
        </div>
      </div>
      <div class="body">
        <div class="summary">${summary}</div>
        <p id="empty">No collections match your search.</p>
        <div class="coll-grid">${cards}</div>
      </div>
    </div>
  </div>
  ${FILTER_SCRIPT}
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
    if (!allows(req, model.access)) return deny(req, res, model.access);

    const groups = model.groups
        .map((g) => ({ category: g.category, items: g.items.filter((m) => allows(req, m.access)) }))
        .filter((g) => g.items.length);
    const visibleCount = groups.reduce((n, g) => n + g.items.length, 0);

    if (wantsJson(req)) {
        return res.json({
            generatedAt: new Date().toISOString(),
            code: model.code, title: model.title, type: model.type,
            counts: { members: visibleCount, groups: groups.length },
            groups
        });
    }

    const tableBody = model.isReviewAssets ? renderReviewAssetsTable(groups) : renderDocCollectionTable(groups);
    const summary = [
        `<span class="stat purple"><span class="ic"></span><b>${visibleCount}</b> item${visibleCount === 1 ? '' : 's'}</span>`,
        `<span class="stat"><span class="ic"></span><b>${groups.length}</b> group${groups.length === 1 ? '' : 's'}</span>`
    ].join('');

    res.type('html').send(`<!doctype html>
<html lang="en">
${head(`${model.title} - Refuge House Compliance`)}
<body>
  <div class="app">
    ${sidebar('/collections', null)}
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:flex-start;gap:14px;min-width:0">
          <button class="menu-btn" onclick="openSide()" aria-label="Menu"><i class="fas fa-bars"></i></button>
          <div style="min-width:0">
            <div class="eyebrow">Refuge House &middot; Compliance &middot; ${escapeHtml(model.type)}</div>
            <h1>${escapeHtml(model.title)}</h1>
            ${model.description ? `<p class="sub">${escapeHtml(model.description)}</p>` : ''}
          </div>
        </div>
        <div class="topbar-actions">
          <div class="search"><i class="fas fa-magnifying-glass"></i><input type="search" id="q" placeholder="Search this collection\u2026" autocomplete="off" /></div>
        </div>
      </div>
      <div class="body">
        <div class="summary">${summary}</div>
        <p id="empty">No items match your search.</p>
        ${visibleCount ? tableBody : '<p class="note">No items are available to you in this collection yet.</p>'}
      </div>
    </div>
  </div>
  ${FILTER_SCRIPT}
</body>
</html>`);
});

module.exports = router;
