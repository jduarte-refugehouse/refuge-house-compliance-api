// routes/review.js — Generic, manifest-driven desk-review portal engine.
//
// This route is a *renderer only*. It knows nothing about any specific review
// (no SSCC/"all-" logic). Everything it draws — page identity (title, badges),
// section structure (groups), items, documents, and per-item citations — is
// declared by a review manifest in the knowbase. The manifest is the single
// source of truth; to add or change a review you edit its manifest, not this
// file. New reviews are drop-in (no code change here).
//
//   GET /review                  -> index of available reviews
//   GET /review/:reviewId        -> the interactive desk-review workspace (HTML)
//   GET /review/:reviewId.json   -> the raw manifest as served to the page
//
// Manifest shape (all chrome fields optional; sensible defaults applied):
//   {
//     "reviewId": "fy26-sscc",
//     "title": "...", "eyebrow": "...", "badges": ["FY-26", ...],
//     "toolRev": "12-01-2025", "generated": "2026-06-16",
//     "intro": "free text shown in an info banner",
//     "legendNote": "override for the classification explanation paragraph",
//     "groups": [ { "key": "all", "title": "...", "scope": "..." }, ... ],
//     "items":  [ { "item": "all-0", "group": "all", "label": "...",
//                   "classification": "legacy", "note": "...",
//                   "mappingNote": "...", "citations": [ ... ],
//                   "documents": [ ... ] }, ... ]
//   }
//
// Markdown policies link to /public/documents/<slug>; binaries (PDFs, reference
// sheets) link to /public/files/<repo-path>. The client engine is the shared
// static asset /review/review.js.
const express = require('express');
const router = express.Router();
const {
    refreshIfStale,
    getReviewManifest,
    listReviews,
    getAllDocuments,
    findDocBySlugOrPath,
    pathToSlug
} = require('../services/knowbase-loader');
const { findCollection } = require('../services/collections');
const { allows, deny, wantsJson } = require('../middleware/human-auth');
const { normalizeAccess, TIER_RANK } = require('../utils/access');
const { renderHtmlPage } = require('./public-documents');

const BRAND = '#5E3989';

const VALID_CLASSIFICATIONS = ['legacy', 'transitioning', 'new', 'na', 'unmapped'];

// Chrome defaults — domain-neutral. A manifest overrides any of these.
const DEFAULT_EYEBROW = 'Refuge House, Inc. · Compliance';

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

// The portal is reviewer-state-bearing and always reflects the latest synced
// knowbase — never let a CDN pin an old copy.
function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

function slugifyGroup(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function prettifyId(reviewId) {
    return String(reviewId || 'review')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function initialClassification(item) {
    if (item && VALID_CLASSIFICATIONS.includes(item.classification)) return item.classification;
    return 'unmapped';
}

// --- Group assembly -------------------------------------------------------
// Preferred: the manifest declares an explicit, ordered `groups[]` and each item
// names its `group`. The renderer places items into those groups verbatim — no
// inference. Items whose group isn't declared collect into a trailing "Other".
//
// Legacy fallback (manifest without groups[]): infer groups the old way so an
// un-migrated manifest still renders — `all-*` items form an "All" block; items
// with an `sscc` field group by SSCC; everything else falls to "Other".
function legacyGroupKey(item) {
    if (String(item.item || '').startsWith('all-')) return 'all';
    if (item.sscc) return slugifyGroup(item.sscc);
    return 'other';
}
function legacyGroupMeta(key, sampleItem) {
    if (key === 'all') {
        return {
            title: 'All SSCCs Monitoring Items — Desk Review',
            scope: 'Shared — one reviewer group reviews these once on behalf of every SSCC.'
        };
    }
    if (key === 'other') {
        return { title: 'Other Items', scope: 'Items not tied to a specific section.' };
    }
    const name = (sampleItem && sampleItem.sscc) || key;
    return { title: `${name} Monitoring Items`, scope: `Desk-review items specific to ${name}.` };
}

function assembleGroups(manifest) {
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const declared = Array.isArray(manifest.groups) ? manifest.groups.filter((g) => g && g.key != null) : null;

    if (declared && declared.length) {
        const order = declared.map((g) => String(g.key));
        const map = new Map(
            declared.map((g) => [String(g.key), {
                key: String(g.key),
                title: g.title || prettifyId(g.key),
                scope: g.scope || '',
                items: []
            }])
        );
        const other = { key: 'other', title: 'Other Items', scope: 'Items not assigned to a section.', items: [] };
        for (const it of items) {
            const gk = it.group != null ? String(it.group) : legacyGroupKey(it);
            if (map.has(gk)) map.get(gk).items.push(it);
            else other.items.push(it);
        }
        const groups = order.map((k) => map.get(k)).filter((g) => g.items.length);
        if (other.items.length) groups.push(other);
        return groups;
    }

    // Legacy inference — first-appearance order.
    const groups = [];
    const byKey = new Map();
    for (const it of items) {
        const key = legacyGroupKey(it);
        if (!byKey.has(key)) {
            const g = { key, ...legacyGroupMeta(key, it), items: [] };
            byKey.set(key, g);
            groups.push(g);
        }
        byKey.get(key).items.push(it);
    }
    return groups;
}

// Small inline SVG icons (no external font dependency on the live site).
const ICON_FILE = '<svg class="doc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const ICON_DOWNLOAD = '<svg class="dl-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>';
const ICON_LINK = '<svg class="doc-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';

// Render the asset buttons for one item's documents. Each is a distinct pill
// with a "view" half (icon + label + type badge) and a "download" half that
// fetches the file as an attachment. Returns chip HTML only (no wrapper).
function renderDocChips(item) {
    const docs = Array.isArray(item.documents) ? item.documents : [];

    return docs.map((doc) => {
        const label = escapeHtml(doc.label || 'Document');

        // kind:"link" (or any doc with only a url) → render the url as-is, a
        // view-only chip (a hyperlink has nothing to "download").
        if ((doc.kind === 'link' || !doc.slug && !doc.repo) && doc.url) {
            return `<span class="doc doc-link">`
                + `<a class="doc-view" href="${escapeHtml(doc.url)}" target="_blank" rel="noopener">${ICON_LINK}<span class="doc-label">${label}</span> <span class="doc-badge link">link</span></a>`
                + `</span>`;
        }

        let viewHref;
        let downloadHref;
        let badge;
        let kindClass;

        // Markdown policy/procedure → view as rendered HTML by slug; download the
        // canonical PDF (cookbook-generated, in the knowbase) when available,
        // else fall back to the markdown download.
        if (doc.kind === 'policy' && doc.slug) {
            // A slug may carry a #fragment (deep link to a section). Keep the
            // fragment unencoded so the anchor resolves in the browser.
            const hashAt = doc.slug.indexOf('#');
            const slugPart = hashAt >= 0 ? doc.slug.slice(0, hashAt) : doc.slug;
            const frag = hashAt >= 0 ? doc.slug.slice(hashAt) : '';
            const base = '/public/documents/' + encodeURIComponent(slugPart);
            viewHref = base + frag;
            downloadHref = doc.pdf
                ? '/public/files/' + encodeRepoPath(doc.pdf) + '?download=1'
                : base + '?download=1';
            kindClass = 'doc-policy';
            badge = doc.live
                ? '<span class="doc-badge live" title="Published on the compliance site">live</span>'
                : '<span class="doc-badge pending" title="In the repo; not yet pushed to main — link resolves after publication">pending</span>';
        } else if (doc.repo) {
            // Binary (PDF / reference sheet / etc.) → streamed via /public/files.
            const base = '/public/files/' + encodeRepoPath(doc.repo);
            viewHref = base;
            downloadHref = base + '?download=1';
            kindClass = 'doc-file';
            badge = doc.kind === 'reference-sheet'
                ? '<span class="doc-badge ref">ref sheet</span>'
                : '<span class="doc-badge file">PDF</span>';
        } else {
            // No resolvable target — show the label without a link or download.
            return `<span class="doc nolink">${ICON_FILE}<span class="doc-label">${label}</span></span>`;
        }

        return `<span class="doc ${kindClass}">`
            + `<a class="doc-view" href="${viewHref}" target="_blank" rel="noopener">${ICON_FILE}<span class="doc-label">${label}</span> ${badge}</a>`
            + `<a class="doc-dl" href="${downloadHref}" download title="Download ${label}" aria-label="Download ${label}">${ICON_DOWNLOAD}</a>`
            + `</span>`;
    }).join('');
}

// Per-item citations (e.g. each SSCC's specific regulatory citation for a shared
// requirement). Shape: [{ sscc?, text, ref? }]. Rendered read-only.
function renderCitations(item) {
    const cites = Array.isArray(item.citations) ? item.citations : [];
    if (!cites.length) return '';
    const rows = cites.map((c) => {
        const who = c.sscc ? `<span class="cite-who">${escapeHtml(c.sscc)}</span>` : '';
        const text = escapeHtml(c.text || '');
        const body = c.ref
            ? `<a href="${escapeHtml(c.ref)}" target="_blank" rel="noopener">${text}</a>`
            : text;
        return `<li class="cite">${who}<span class="cite-text">${body}</span></li>`;
    }).join('');
    return `<details class="cites"><summary>Citations <span class="cite-n">${cites.length}</span></summary><ul>${rows}</ul></details>`;
}

// Resolve an item against the manifest's `requirements` library. Per-SSCC items
// carry a `ref` (requirement key) instead of their own documents, so the shared
// material is defined once and inherited at render time — edit the requirement,
// re-sync, and every referencing section updates. An item may still override the
// label/classification, or inline its own documents.
function resolveItem(item, requirements) {
    const req = (item && item.ref && requirements) ? requirements[item.ref] : null;
    const documents = (Array.isArray(item.documents) && item.documents.length)
        ? item.documents
        : (req && Array.isArray(req.documents) ? req.documents : []);
    const label = item.label || (req && req.label) || item.item || 'Item';
    const classification = item.classification || (req && req.classification) || null;
    const note = item.mappingNote || item.note || (req && (req.mappingNote || req.note)) || '';
    return { documents, label, classification, note };
}

function renderItem(item, groupKey, requirements) {
    const resolved = resolveItem(item, requirements);
    const id = escapeHtml(item.item || '');
    const cls = VALID_CLASSIFICATIONS.includes(resolved.classification) ? resolved.classification : 'unmapped';
    const label = escapeHtml(resolved.label);

    // Read-only mapping summary: the curated mapping note if present, else the
    // manifest's instructional note. Distinct from the reviewer's own notes.
    const mapText = resolved.note;
    const mapLine = mapText ? `<div class="map-note">${escapeHtml(mapText)}</div>` : '';
    const citations = renderCitations(item);

    const chips = renderDocChips({ documents: resolved.documents });
    const assetsCol = `<div class="item-assets">
      <span class="docs-label">Assets</span>
      <div class="docs">${chips || '<span class="docs-empty">None — N/A</span>'}</div>
    </div>`;

    return `<div class="item" data-id="${id}" data-group="${escapeHtml(groupKey)}" data-status="pending" data-class="${cls}">
  <div class="item-row">
    <div class="status-group" role="group" aria-label="Compliance status">
      <button class="st" data-v="met" title="Met / Compliant">Met</button>
      <button class="st" data-v="notmet" title="Not Met / Deficient">Not Met</button>
      <button class="st" data-v="na" title="Not Applicable">N/A</button>
    </div>
    <div class="item-body">
      <div class="item-head">
        <span class="item-label">${label}</span>
        <select class="class-sel" title="Policy classification" aria-label="Policy classification">
          <option value="legacy">Legacy P&amp;P</option>
          <option value="transitioning">Transitioning → T3C</option>
          <option value="new">New (T3C)</option>
          <option value="na">Not a policy</option>
          <option value="unmapped">Unmapped</option>
        </select>
        <span class="item-id">${id}</span>
      </div>
      ${mapLine}
      ${citations}
      <button type="button" class="note-toggle" title="Add reviewer note">+ note</button>
      <textarea class="notes" rows="2" placeholder="Your review note…"></textarea>
    </div>
    ${assetsCol}
  </div>
</div>`;
}

function renderGroup(group, requirements) {
    const rows = group.items.map((it) => renderItem(it, group.key, requirements)).join('');
    return `<section class="group" data-group="${escapeHtml(group.key)}">
  <button class="group-head" aria-expanded="true">
    <span class="group-title">${escapeHtml(group.title)}</span>
    <span class="group-meta">
      <span class="g-scope">${escapeHtml(group.scope || '')}</span>
      <span class="g-count" data-count="${escapeHtml(group.key)}"></span>
      <span class="caret">▾</span>
    </span>
  </button>
  <div class="group-body">${rows}</div>
</section>`;
}

function renderBadges(manifest) {
    const badges = Array.isArray(manifest.badges) ? manifest.badges : [];
    return badges
        .map((b, i) => `<span class="badge ${i === badges.length - 1 ? 'badge-temp' : 'badge-package'}">${escapeHtml(b)}</span>`)
        .join('');
}

function renderPage(manifest, reviewId) {
    const items = Array.isArray(manifest.items) ? manifest.items : [];
    const requirements = (manifest.requirements && typeof manifest.requirements === 'object') ? manifest.requirements : {};
    const groups = assembleGroups(manifest);
    const groupsHtml = groups.map((g) => renderGroup(g, requirements)).join('');

    const title = manifest.title || prettifyId(reviewId);
    const eyebrow = manifest.eyebrow || DEFAULT_EYEBROW;
    const generated = escapeHtml(manifest.generated || '');
    const toolRev = manifest.toolRev ? ` · Tool rev. ${escapeHtml(manifest.toolRev)}` : '';
    const introBanner = manifest.intro
        ? `<div class="intro">${escapeHtml(manifest.intro)}</div>`
        : '';
    const legendNote = manifest.legendNote
        || 'Refuge House is migrating its policies into the <strong>T3C</strong> framework, so each item is tagged by state. <strong>Legacy</strong> = the pre-T3C document currently in force. <strong>Transitioning</strong> = actively being rewritten into T3C. <strong>New (T3C)</strong> = the published T3C version. <strong>Not a policy</strong> = an operational check. <strong>Unmapped</strong> = classification still to be assigned. Change any item\'s tag with its dropdown.';

    const needsPush = Array.isArray(manifest.needsPush) ? manifest.needsPush : [];
    const pushBanner = needsPush.length > 0
        ? `<div class="push-banner">
        <strong>${needsPush.length} policy link${needsPush.length === 1 ? '' : 's'} pending publication.</strong>
        These markdown policies exist in the knowbase but have not been pushed to <code>main</code> yet, so their
        <em>Pending push</em> links will not resolve until they are published.
      </div>`
        : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
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
.intro{background:var(--rh-info-bg);border:1.5px solid var(--rh-info-border);border-radius:12px;padding:.85rem 1.1rem;margin-bottom:1rem;font-size:.9rem}
.legend{background:var(--rh-surface);border:1px solid var(--rh-border);border-radius:10px;padding:.55rem .85rem;margin-bottom:1rem}
.legend summary{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;cursor:pointer;list-style:none}
.legend summary::-webkit-details-marker{display:none}
.legend-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--rh-muted);font-weight:700}
.legend-more{font-size:.76rem;color:var(--rh-accent);margin-left:auto;text-decoration:underline}
.legend p{margin:.6rem 0 0;font-size:.84rem;color:var(--rh-muted)}
.chip{font-size:.7rem;font-weight:700;padding:.18rem .55rem;border-radius:999px;border:1px solid}
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
.item{border-bottom:1px solid #eef1f5;padding:.6rem .4rem}
.item:last-child{border-bottom:none}
.item-row{display:flex;gap:1rem;align-items:flex-start}
.item-assets{flex:0 0 300px;display:flex;flex-direction:column;gap:.35rem;border-left:1px solid #eef1f5;padding-left:.9rem}
@media (max-width:820px){
  .item-row{flex-wrap:wrap}
  .item-assets{flex:1 1 100%;border-left:none;border-top:1px solid #eef1f5;padding-left:0;padding-top:.5rem;margin-top:.2rem}
}
.status-group{display:flex;border:1px solid var(--rh-border);border-radius:8px;overflow:hidden;flex:0 0 auto}
.st{background:#fff;border:none;border-right:1px solid var(--rh-border);padding:.32rem .5rem;font-size:.73rem;font-weight:600;cursor:pointer;color:var(--rh-muted)}
.st:last-child{border-right:none}
.st.active[data-v=met]{background:var(--new-bg);color:var(--new)}
.st.active[data-v=notmet]{background:var(--rh-alert-bg);color:#b91c1c}
.st.active[data-v=na]{background:var(--na-bg);color:var(--na)}
.item-body{flex:1;min-width:0}
.item-head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.item-label{font-weight:600;font-size:.92rem}
.item-id{font-size:.62rem;color:#94a3b8;font-variant:all-small-caps;letter-spacing:.04em;margin-left:auto}
.class-sel{font-size:.7rem;border:1px solid var(--rh-border);border-radius:999px;padding:.14rem .5rem;font-weight:700;cursor:pointer}
.item[data-class=legacy] .class-sel{color:var(--legacy);background:var(--legacy-bg);border-color:#cbd5e1}
.item[data-class=transitioning] .class-sel{color:var(--trans);background:var(--trans-bg);border-color:#fdba74}
.item[data-class=new] .class-sel{color:var(--new);background:var(--new-bg);border-color:#86efac}
.item[data-class=na] .class-sel{color:var(--na);background:var(--na-bg);border-color:#cbd5e1}
.item[data-class=unmapped] .class-sel{color:var(--unmapped);background:var(--unmapped-bg);border-color:#d8b4fe}
.map-note{font-size:.82rem;color:var(--rh-muted);margin-top:.22rem;line-height:1.45}
.cites{margin-top:.35rem;font-size:.8rem}
.cites > summary{cursor:pointer;color:var(--rh-primary);font-weight:600;list-style:none}
.cites > summary::-webkit-details-marker{display:none}
.cites > summary::before{content:"▸ ";font-size:.7rem}
.cites[open] > summary::before{content:"▾ "}
.cite-n{display:inline-block;background:var(--unmapped-bg);color:var(--unmapped);font-size:.62rem;font-weight:700;padding:.02rem .35rem;border-radius:999px;margin-left:.25rem}
.cites ul{margin:.35rem 0 .2rem;padding-left:0;list-style:none}
.cite{display:flex;gap:.5rem;align-items:baseline;padding:.18rem 0;border-top:1px dashed #eef1f5}
.cite:first-child{border-top:none}
.cite-who{flex:0 0 auto;font-weight:700;font-size:.7rem;color:var(--rh-primary-dark);background:#f0ebfa;border:1px solid #ddd6fe;border-radius:999px;padding:.04rem .45rem}
.cite-text{color:var(--rh-muted)}
.docs{display:flex;flex-direction:column;gap:.4rem;align-items:stretch}
.docs-label{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--rh-muted);font-weight:700}
.docs-empty{font-size:.78rem;color:#94a3b8;font-style:italic}
.item-assets .doc{max-width:100%}
.doc{display:inline-flex;align-items:stretch;border:1px solid #c9a8e0;border-radius:8px;overflow:hidden;background:var(--rh-light-purple);box-shadow:0 1px 1px rgba(94,57,137,.08)}
.doc-view{display:inline-flex;align-items:center;gap:.4rem;padding:.32rem .55rem;font-size:.78rem;font-weight:600;text-decoration:none;color:var(--rh-primary-dark)}
.doc-view:hover{background:#e7d6f4}
.doc-ico{width:14px;height:14px;flex:0 0 auto;opacity:.7}
.doc-label{white-space:normal;overflow-wrap:anywhere;line-height:1.3}
.doc-dl{display:inline-flex;align-items:center;padding:.32rem .48rem;border-left:1px solid #c9a8e0;color:var(--rh-primary);text-decoration:none;background:rgba(255,255,255,.55)}
.doc-dl:hover{background:#e7d6f4}
.dl-ico{width:15px;height:15px}
.doc.nolink{display:inline-flex;align-items:center;gap:.35rem;padding:.32rem .55rem;background:#fff;border-style:dashed;border-color:var(--rh-border);color:var(--rh-muted);font-size:.78rem}
.doc.nolink .doc-ico{opacity:.5}
.doc-badge{font-size:.6rem;font-weight:700;letter-spacing:.02em;padding:.04rem .32rem;border-radius:999px}
.doc-badge.live{background:var(--new-bg);color:var(--new)}
.doc-badge.pending{background:var(--rh-warn-bg);color:#9a3412}
.doc-badge.file{background:#eef2ff;color:#3730a3}
.doc-badge.ref{background:var(--unmapped-bg);color:var(--unmapped)}
.doc-badge.link{background:#e0e7ff;color:#3730a3}
.doc-link .doc-view{padding-right:.55rem}
.note-toggle{display:inline-block;background:none;border:none;color:var(--rh-muted);font-size:.74rem;cursor:pointer;padding:.2rem 0;margin-top:.3rem;font-weight:600;white-space:nowrap}
.note-toggle:hover{color:var(--rh-primary)}
.notes{width:100%;margin-top:.4rem;border:1px solid var(--rh-border);border-radius:8px;padding:.4rem .55rem;font-size:.82rem;font-family:inherit;resize:vertical;display:none}
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
  .cites[open] ul,.cites ul{display:block!important}
  body{background:#fff}
}
</style>
</head>
<body data-review-id="${escapeHtml(reviewId)}">
<header class="rh-header">
  <span class="eyebrow">${escapeHtml(eyebrow)}</span>
  <h1>${escapeHtml(title)}</h1>
  <div class="header-meta">
    ${renderBadges(manifest)}
    <span style="font-size:.78rem;opacity:.9;margin-left:.3rem">${generated ? 'Manifest generated ' + generated : ''}${toolRev}</span>
  </div>
  <div class="header-links">
    <a href="/site-index">← Policy manual / site index</a>
    <a href="/review/${escapeHtml(reviewId)}.json" target="_blank" rel="noopener">View manifest JSON</a>
  </div>
</header>

<div class="glance">
  <div class="tile"><div class="lab">Total items</div><div class="val">${items.length}</div></div>
  <div class="tile"><div class="lab">Sections</div><div class="val">${groups.length}</div></div>
  <div class="tile"><div class="lab">Reviewed</div><div class="val" id="t-reviewed">0</div></div>
  <div class="tile"><div class="lab">Transitioning</div><div class="val" id="t-trans">0</div></div>
  <div class="tile"><div class="lab">Legacy</div><div class="val" id="t-legacy">0</div></div>
  <div class="tile"><div class="lab">Unmapped</div><div class="val" id="t-unmapped">0</div></div>
</div>

<div class="wrap">
  <div class="arch-banner" id="archBanner"></div>

  ${introBanner}

  <details class="legend">
    <summary>
      <span class="legend-label">Classification</span>
      <span class="chip legacy">Legacy</span>
      <span class="chip transitioning">Transitioning → T3C</span>
      <span class="chip new">New (T3C)</span>
      <span class="chip na">Not a policy</span>
      <span class="chip unmapped">Unmapped</span>
      <span class="legend-more">what these mean</span>
    </summary>
    <p>${legendNote}</p>
  </details>

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
  <p><strong>Source of truth:</strong> this page is generated from its review manifest (<code>${escapeHtml(manifest._sourcePath || reviewId)}</code>) in the knowbase. Edit the manifest and re-sync to change what appears here. Reviewer marks, notes, and classifications are saved in your browser; use <em>Export</em> to capture a JSON record and <em>Freeze for archive</em> to lock it read-only.</p>
  <p>Markdown policies open at <code>/public/documents/&lt;slug&gt;</code>; PDFs and reference sheets stream from <code>/public/files/&lt;path&gt;</code>.</p>
</footer>

<script src="/review/review.js"></script>
</body>
</html>`;
}

function renderUnavailable(res, reviewId) {
    res.status(404).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Review not found</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:640px;margin:3rem auto;padding:0 1.5rem;color:#1e293b;line-height:1.6}
h1{color:${BRAND}} code{background:#f1f5f9;padding:.1rem .35rem;border-radius:4px}</style></head>
<body>
<h1>Review not found</h1>
<p>No review manifest is loaded for <code>${escapeHtml(reviewId || '')}</code>. A review is published by adding a
<code>*-document-manifest.json</code> file to the knowbase (its <code>reviewId</code> becomes the URL).</p>
<p>If you just added one, force a re-sync with <code>POST /api/admin/sync-knowbase</code> (behind the API key), then reload.</p>
<p><a href="/review">← Available reviews</a> · <a href="/site-index">Site index</a></p>
</body></html>`);
}

function renderIndex(res) {
    const reviews = listReviews();
    noStore(res);
    const cards = reviews.length
        ? reviews.map((r) => `<li><a href="/review/${escapeHtml(r.reviewId)}">${escapeHtml(r.title)}</a> <span class="meta">${r.itemCount} items · ${escapeHtml(r.reviewId)}</span></li>`).join('')
        : '<li class="empty">No reviews are currently loaded from the knowbase.</li>';
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desk Reviews</title><link rel="icon" type="image/png" href="/favicon.png">
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:720px;margin:0 auto;padding:0 1.5rem 3rem;color:#1e293b;line-height:1.6}
h1{color:${BRAND}} ul{list-style:none;padding:0} li{padding:.7rem .9rem;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:.6rem}
li a{font-weight:700;color:#A90533;text-decoration:none;font-size:1.02rem} .meta{color:#64748b;font-size:.8rem;margin-left:.4rem}
.empty{color:#64748b} header{background:linear-gradient(135deg,#3c2556,#5E3989 55%,#A90533);color:#fff;padding:1.4rem 1.5rem;margin:0 -1.5rem 1.4rem}
header h1{margin:.2rem 0;color:#fff} header .eyebrow{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;opacity:.9}</style></head>
<body><header><div class="eyebrow">Refuge House, Inc. · Compliance</div><h1>Desk Reviews</h1></header>
<ul>${cards}</ul>
<p><a href="/site-index">← Site index</a></p>
</body></html>`);
}

// Normalize a :reviewId param (strip a trailing .json defensively).
function cleanId(raw) {
    return String(raw || '').replace(/\.json$/i, '').trim();
}

// GET /review — index of available reviews.
router.get('/', async (req, res) => {
    try { await refreshIfStale(); } catch (err) { console.warn('[REVIEW] refresh failed:', err.message); }
    renderIndex(res);
});

// GET /review/:reviewId.json — the manifest as served to the page.
router.get('/:reviewId([a-zA-Z0-9_-]+).json', async (req, res) => {
    try { await refreshIfStale(); } catch (err) { console.warn('[REVIEW] refresh failed:', err.message); }
    const reviewId = cleanId(req.params.reviewId);
    const manifest = getReviewManifest(reviewId);
    noStore(res);
    if (!manifest) {
        return res.status(404).json({ error: `No review manifest for '${reviewId}'` });
    }
    res.json(manifest);
});

// GET /review/:reviewId — the interactive desk-review workspace.
router.get('/:reviewId([a-zA-Z0-9_-]+)', async (req, res) => {
    try { await refreshIfStale(); } catch (err) { console.warn('[REVIEW] refresh failed:', err.message); }
    const reviewId = cleanId(req.params.reviewId);
    const manifest = getReviewManifest(reviewId);
    noStore(res);
    if (!manifest || !Array.isArray(manifest.items)) {
        return renderUnavailable(res, reviewId);
    }
    res.type('html').send(renderPage(manifest, reviewId));
});

// GET /review/:collection/:slug — a knowbase asset served inside an
// authenticated collection / review context. Resolves ANY loaded markdown asset
// by slug or repo path (including listed:false curated artifacts like the SSCC
// variance matrix) and gates by the MORE restrictive of the asset's own access
// and the collection's audience. The /review mount already requires reviewer
// tier; a staff-tier asset is further enforced here, so a reviewer (non-staff)
// is correctly denied a staff asset.
router.get('/:collection/:slug(.*)', async (req, res) => {
    try { await refreshIfStale(); } catch (err) { console.warn('[REVIEW] refresh failed:', err.message); }
    noStore(res);

    const code = String(req.params.collection || '').trim();
    const collection = findCollection(code);
    if (!collection) {
        if (wantsJson(req)) return res.status(404).json({ error: `Unknown collection '${code}'` });
        return res.status(404).type('html').send(
            '<!doctype html><body style="font-family:sans-serif;text-align:center;padding:4rem;">'
            + '<h2>Collection not found</h2><p><a href="/collections">All collections</a></p></body>'
        );
    }

    const result = findDocBySlugOrPath(req.params.slug);
    if (!result) {
        if (wantsJson(req)) return res.status(404).json({ error: `Document not found: ${req.params.slug}` });
        return res.status(404).type('html').send(
            '<!doctype html><body style="font-family:sans-serif;text-align:center;padding:4rem;">'
            + `<h2>Document not found</h2><p><a href="/collections/${encodeURIComponent(code)}">Back to ${escapeHtml(collection.title || code)}</a></p></body>`
        );
    }

    const { path: docPath, doc } = result;

    // Gate by the MORE restrictive of the asset's own access and the
    // collection's audience (CLAUDE.md: gate by item access else audience).
    const itemTier = normalizeAccess(doc.access);
    const audienceTier = normalizeAccess(collection.audience);
    const requiredTier = TIER_RANK[itemTier] >= TIER_RANK[audienceTier] ? itemTier : audienceTier;
    if (!allows(req, requiredTier)) return deny(req, res, requiredTier);

    const slug = pathToSlug(docPath);
    const title = doc.frontTitle || docPath.split('/').pop().replace(/\.md$/i, '');

    if (req.query.format === 'json') {
        return res.json({
            collection: code,
            slug,
            path: docPath,
            title,
            access: requiredTier,
            url: `/review/${encodeURIComponent(code)}/${slug}`,
            content: doc.content
        });
    }
    if (req.query.format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.send(doc.content);
    }

    const html = renderHtmlPage(title, doc.content, docPath, doc.lastModified, getAllDocuments());
    res.type('html').send(html);
});

module.exports = router;
module.exports._internal = { encodeRepoPath, assembleGroups, resolveItem, initialClassification, renderDocChips, renderCitations, renderPage };
