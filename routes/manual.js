// routes/manual.js — REDESIGNED to use the Refuge House design system.
// Data/plumbing is UNCHANGED from the original; only the presentation (shell,
// /rh-compliance.css, summary chips, nav markup) was updated.
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

function ownerCell(owner, department) {
    const v = owner || department;
    return v ? `<span class="owner">${escapeHtml(v)}</span>` : '<span class="dash">\u2014</span>';
}

const TABLE_HEAD = `<thead><tr>
  <th style="width:72px">Code</th>
  <th>Topic</th>
  <th style="width:90px">Policy</th>
  <th style="width:20px"></th>
  <th style="width:138px">Procedure(s)</th>
  <th style="width:108px">Owner</th>
  <th style="width:150px">Review</th>
  <th style="width:100px">Reconciliation</th>
  <th style="width:92px">Status</th>
</tr></thead>`;

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
      <div class="section-head"><h2>${escapeHtml(section.title)}</h2><span class="count">${count}</span></div>
      <div class="panel table-wrap"><table>${TABLE_HEAD}<tbody>${rows}</tbody></table></div>
    </section>`;
}

router.get('/', async (req, res) => {
    const isVisible = (docPath, doc) => allows(req, accessForDoc(doc));
    const model = buildManual(getAllDocuments(), isVisible, accessForDoc);
    noStore(res);

    const navItems = model.sections.map((s) => {
        const count = s.kind === 'paired' ? s.topics.length : s.docs.length;
        return `<a class="nav-item" href="#sec-${escapeHtml(s.id)}" data-nav="${escapeHtml(s.id)}">
          <i class="fas fa-folder"></i><span class="lbl">${escapeHtml(s.title)}</span><span class="nav-count">${count}</span></a>`;
    }).join('');

    const sectionsHtml = model.sections.map(renderSection).join('');
    const c = model.counts;
    const summary = [
        `<span class="stat purple"><span class="ic"></span><b>${c.topics}</b> topics</span>`,
        `<span class="stat ok"><span class="ic"></span><b>${c.paired}</b> fully paired</span>`,
        `<span class="stat"><span class="ic"></span><b>${c.policies}</b> policies</span>`,
        `<span class="stat"><span class="ic"></span><b>${c.procedures}</b> procedures</span>`,
        c.reviewOverdue ? `<span class="stat danger"><span class="ic"></span><b>${c.reviewOverdue}</b> review overdue</span>` : '',
        c.reviewDueSoon ? `<span class="stat warn"><span class="ic"></span><b>${c.reviewDueSoon}</b> due soon</span>` : ''
    ].join('');

    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Policies & Procedures Workspace - Refuge House</title>
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
          <div class="side-label">Sections</div>
          <nav id="nav">${navItems}</nav>
        </div>
        <div class="side-group">
          <div class="side-label">Also</div>
          <a class="nav-item" href="/collections"><i class="fas fa-layer-group"></i><span class="lbl">All Collections</span></a>
          <a class="nav-item" href="/site-index"><i class="fas fa-sitemap"></i><span class="lbl">Full Site Index</span></a>
          <a class="nav-item" href="/review/fy26-sscc"><i class="fas fa-clipboard-check"></i><span class="lbl">FY-26 Desk Review</span></a>
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
            <h1>Policies &amp; Procedures Workspace</h1>
            <p class="sub">Every policy aligned with its companion procedure(s), cataloged from the knowbase. Search, browse, and open any document.</p>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="search"><i class="fas fa-magnifying-glass"></i><input type="search" id="q" placeholder="Search policies, procedures, owners\u2026" autocomplete="off" /></div>
          <button class="btn" onclick="window.print()"><i class="fas fa-print"></i>Print</button>
        </div>
      </div>
      <div class="body">
        <div class="summary">${summary}</div>
        <p id="empty">No documents match your search.</p>
        ${sectionsHtml}
      </div>
    </div>
  </div>
  <script>
    (function () {
      var q = document.getElementById('q');
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-row]'));
      var sections = Array.prototype.slice.call(document.querySelectorAll('[data-section]'));
      var empty = document.getElementById('empty');
      q.addEventListener('input', function () {
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
      });
      var navLinks = {};
      document.querySelectorAll('[data-nav]').forEach(function (a) { navLinks[a.dataset.nav] = a; });
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var id = e.target.id.replace('sec-', '');
          Object.values(navLinks).forEach(function (a) { a.classList.remove('active'); });
          if (navLinks[id]) navLinks[id].classList.add('active');
        });
      }, { rootMargin: '-12% 0px -78% 0px' });
      sections.forEach(function (s) { io.observe(s); });
    })();
    function openSide(){ document.getElementById('side').classList.add('open'); document.getElementById('scrim').classList.add('show'); }
    function closeSide(){ document.getElementById('side').classList.remove('open'); document.getElementById('scrim').classList.remove('show'); }
  </script>
</body>
</html>`);
});

module.exports = router;
