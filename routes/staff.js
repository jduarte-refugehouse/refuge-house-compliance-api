// routes/staff.js — Staff-only (Entra) view that surfaces the current reviewer
// link(s) to copy and hand to an external reviewer. Mounted behind
// requireTier('staff'), so only an Easy Auth-authenticated Refuge House user can
// see it. No key is ever shown to anonymous or reviewer-tier callers.
const express = require('express');
const router = express.Router();
const { currentReviewerKey, reviewerLinkFor, isConfigured, WINDOW_DAYS } = require('../services/reviewer-key');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Targets a staff member typically shares with a reviewer.
const LINK_TARGETS = [
    { path: '/review/fy26-sscc', label: 'FY-26 SSCC Joint Monitoring — Desk Review' },
    { path: '/site-index', label: 'Policy Manual & Site Index' }
];

function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

router.get('/', (req, res) => {
    noStore(res);

    const principal = req.caller && req.caller.principal;
    const who = principal && (principal.name || principal.id);
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    let body;
    if (!isConfigured()) {
        body = `<div class="card warn">
      <h2>Reviewer links are not configured</h2>
      <p>Set <code>REVIEWER_KEY_SECRET</code> in this app's environment to enable
      rolling reviewer links. Until then, the human-facing surfaces run in open
      mode (no gating).</p>
    </div>`;
    } else {
        const key = currentReviewerKey();
        const rows = LINK_TARGETS.map((t) => {
            const link = reviewerLinkFor(baseUrl, t.path);
            const id = 'lnk-' + t.path.replace(/[^a-z0-9]+/gi, '-');
            return `<div class="link-row">
        <div class="link-label">${escapeHtml(t.label)}</div>
        <div class="link-box">
          <input id="${id}" type="text" readonly value="${escapeHtml(link)}" />
          <button type="button" class="copy" data-target="${id}">Copy</button>
        </div>
      </div>`;
        }).join('');

        body = `<div class="card">
      <h2>Current reviewer link</h2>
      <p class="lede">Share one of these links with an external reviewer. The link
      works for any reviewer for up to <strong>${WINDOW_DAYS} days</strong>, then
      stops working as the key rotates — send a fresh link if a reviewer needs
      more time.</p>
      ${rows}
      <p class="key-note">Today's key: <code>${escapeHtml(key)}</code></p>
      <p class="caveat">Anyone with the link can view reviewer-tier materials, so
      only send it to people who should have access. To revoke every outstanding
      link immediately, rotate <code>REVIEWER_KEY_SECRET</code>.</p>
    </div>`;
    }

    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reviewer links — Refuge House Compliance (Staff)</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  :root{--rh-primary:#5E3989;--rh-primary-dark:#3c2556;--rh-accent:#A90533;--rh-bg:#f8fafc;--rh-light-purple:#f3e9fa;--rh-border:#e2e8f0;--rh-text:#1e293b;--rh-muted:#475569}
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:var(--rh-bg);color:var(--rh-text);line-height:1.6}
  .rh-header{background:linear-gradient(135deg,var(--rh-primary-dark),var(--rh-primary) 55%,var(--rh-accent));color:#fff;padding:1.3rem 1.5rem}
  .rh-header .eyebrow{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;opacity:.92;font-weight:600}
  .rh-header h1{margin:.3rem 0 0;font-size:1.4rem}
  .who{font-size:.8rem;opacity:.92;margin-top:.35rem}
  .wrap{max-width:760px;margin:1.4rem auto;padding:0 1.25rem 3rem}
  .card{background:#fff;border:1px solid var(--rh-border);border-radius:12px;padding:1.2rem 1.4rem;box-shadow:0 2px 6px rgba(15,23,42,.05)}
  .card.warn{background:#fff7ed;border-color:#fb923c}
  h2{color:var(--rh-primary-dark);margin:.1rem 0 .6rem;font-size:1.1rem}
  .lede{color:var(--rh-muted)}
  .link-row{margin:1rem 0}
  .link-label{font-weight:600;font-size:.9rem;margin-bottom:.3rem}
  .link-box{display:flex;gap:.5rem}
  .link-box input{flex:1;padding:.5rem .6rem;border:1px solid var(--rh-border);border-radius:8px;font-size:.85rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .copy{background:var(--rh-primary);color:#fff;border:none;border-radius:8px;padding:.5rem .9rem;font-weight:600;cursor:pointer}
  .copy:hover{background:var(--rh-primary-dark)}
  .copy.copied{background:#166534}
  .key-note{font-size:.82rem;color:var(--rh-muted);margin-top:1rem}
  .caveat{font-size:.82rem;color:var(--rh-muted);background:var(--rh-light-purple);border:1px solid #d4b5e4;border-radius:8px;padding:.6rem .8rem;margin-top:1rem}
  code{background:#f1f5f9;padding:.08rem .35rem;border-radius:4px;font-size:.86em}
</style></head>
<body>
  <header class="rh-header">
    <span class="eyebrow">Refuge House, Inc. · Compliance · Staff</span>
    <h1>Reviewer links</h1>
    ${who ? `<div class="who">Signed in as ${escapeHtml(who)}</div>` : ''}
  </header>
  <main class="wrap">
    ${body}
  </main>
  <script>
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.copy');
      if (!btn) return;
      var input = document.getElementById(btn.getAttribute('data-target'));
      if (!input) return;
      input.select();
      navigator.clipboard.writeText(input.value).then(function () {
        var prev = btn.textContent;
        btn.textContent = 'Copied'; btn.classList.add('copied');
        setTimeout(function () { btn.textContent = prev; btn.classList.remove('copied'); }, 1500);
      });
    });
  </script>
</body></html>`);
});

module.exports = router;
