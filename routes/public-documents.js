// routes/public-documents.js - Public (unauthenticated) document endpoints
// Serves rendered HTML versions of knowbase documents for sharing, embedding,
// and linking from external apps (e.g., foster parent portal).
const express = require('express');
const { marked } = require('marked');
const router = express.Router();
const { getAllDocuments, getDocumentIndex, getKnowbaseReadme, refreshIfStale } = require('../services/knowbase-loader');
const { allows, deny } = require('../middleware/human-auth');
const { accessForDoc } = require('../utils/access');

const BRAND = {
    primary: '#5E3989',
    primaryDark: '#3c2556',
    secondary: '#7b4ba5',
    accent: '#A90533',
    bg: '#f8fafc',
    lightPurple: '#f3e9fa',
    surface: '#ffffff',
    border: '#e2e8f0',
    text: '#1e293b',
    muted: '#475569'
};

const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';

function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
}

const KNOWBASE_REPO = parseRepoUrl(KNOWBASE_REPO_URL);

// These documents are rendered live from the synced knowbase and must always
// reflect the latest push to main. Forbid CDN/Front Door caching so external
// reviewers never see a stale policy. (A short max-age would still risk serving
// outdated compliance documents during a review window.)
function noStore(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
}

/**
 * Generate a URL-safe slug from a document path.
 * "plans/Emergency Response Disaster Recovery and Business Continuity Plan.md"
 *   -> "emergency-response-disaster-recovery-and-business-continuity-plan"
 */
function pathToSlug(docPath) {
    const basename = docPath.split('/').pop().replace(/\.md$/i, '');
    return basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Find a document by its slug (matches against all loaded documents).
 * Returns { path, doc } or null.
 */
function findBySlug(slug) {
    const docs = getAllDocuments();
    for (const [docPath, doc] of Object.entries(docs)) {
        if (pathToSlug(docPath) === slug) {
            return { path: docPath, doc };
        }
    }
    return null;
}

function getDocumentFamily(docPath) {
    if (docPath === 'README.md') {
        return { label: 'About', theme: 'about' };
    }
    if (docPath.startsWith('policies-procedures/Policy/')) {
        return { label: 'Policy', theme: 'policy' };
    }
    if (docPath.startsWith('policies-procedures/Procedure/')) {
        return { label: 'Procedure', theme: 'procedure' };
    }
    if (docPath.startsWith('policies-procedures/Policy-and-Procedure/')) {
        return { label: 'Policy and Procedure', theme: 'policy' };
    }
    return { label: 'Reference Document', theme: 'default' };
}

function parseHrefParts(href) {
    const trimmed = String(href || '').trim();
    if (!trimmed) return null;

    const hashIndex = trimmed.indexOf('#');
    const queryIndex = trimmed.indexOf('?');

    const splitIndex = [hashIndex, queryIndex]
        .filter((v) => v >= 0)
        .sort((a, b) => a - b)[0];

    if (splitIndex === undefined) {
        return { base: trimmed, suffix: '' };
    }

    return {
        base: trimmed.slice(0, splitIndex),
        suffix: trimmed.slice(splitIndex)
    };
}

function extractRepoPathFromGithubHref(baseHref) {
    if (!KNOWBASE_REPO) return null;

    const owner = KNOWBASE_REPO.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repo = KNOWBASE_REPO.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
        // github blob links
        new RegExp(`^https?:\\/\\/github\\.com\\/${owner}\\/${repo}\\/blob\\/[^/]+\\/(.+)$`, 'i'),
        // github tree links
        new RegExp(`^https?:\\/\\/github\\.com\\/${owner}\\/${repo}\\/tree\\/[^/]+\\/(.+)$`, 'i'),
        // raw links
        new RegExp(`^https?:\\/\\/raw\\.githubusercontent\\.com\\/${owner}\\/${repo}\\/[^/]+\\/(.+)$`, 'i')
    ];

    for (const pattern of patterns) {
        const match = baseHref.match(pattern);
        if (match && match[1]) return match[1];
    }

    return null;
}

function normalizeLinkedPath(href) {
    if (!href) return null;

    // Keep in-page anchors untouched
    if (href.startsWith('#')) return null;

    const parts = parseHrefParts(href);
    if (!parts) return null;

    let candidate = parts.base;

    // Convert known knowbase GitHub links back to repo-relative path if possible
    if (/^https?:\/\//i.test(candidate)) {
        const extracted = extractRepoPathFromGithubHref(candidate);
        if (!extracted) return null;
        candidate = extracted;
    }

    // Normalize prefix
    candidate = candidate.replace(/^\.\//, '').replace(/^\//, '');

    try {
        candidate = decodeURIComponent(candidate);
    } catch (_err) {
        // If decode fails, keep original candidate
    }

    return {
        path: candidate || null,
        suffix: parts.suffix || ''
    };
}

function buildDocPathToSlugLookup(allDocs) {
    const lookup = new Map();
    for (const docPath of Object.keys(allDocs || {})) {
        lookup.set(docPath, pathToSlug(docPath));
    }
    return lookup;
}

function isKnowbaseRepoRootLink(baseHref) {
    if (!KNOWBASE_REPO) return false;
    const owner = KNOWBASE_REPO.owner;
    const repo = KNOWBASE_REPO.repo;
    return new RegExp(`^https?:\\/\\/github\\.com\\/${owner}\\/${repo}\\/?$`, 'i').test(baseHref);
}

function rewriteMarkdownLinksToPublicRoutes(renderedHtml, allDocs) {
    if (!renderedHtml) return renderedHtml;

    const pathToSlug = buildDocPathToSlugLookup(allDocs);

    const routedHtml = renderedHtml.replace(/href="([^"]+)"/g, (full, href) => {
        const parts = parseHrefParts(href);
        if (!parts) return full;

        if (isKnowbaseRepoRootLink(parts.base)) {
            return `href="/public/documents/about${parts.suffix || ''}"`;
        }

        const normalized = normalizeLinkedPath(href);
        if (!normalized || !normalized.path) return full;

        const normalizedPath = normalized.path;
        const suffix = normalized.suffix || '';

        // Special-case root README to About route.
        if (normalizedPath.toLowerCase() === 'readme.md') {
            return `href="/public/documents/about${suffix}"`;
        }

        // Only rewrite markdown doc links for in-app rendering.
        if (!normalizedPath.toLowerCase().endsWith('.md')) {
            return full;
        }

        const slug = pathToSlug.get(normalizedPath);
        if (!slug) {
            // Unknown .md path; keep user in app by routing to docs index.
            return 'href="/public/documents"';
        }

        return `href="/public/documents/${slug}${suffix}"`;
    });

    // Force insecure absolute links to https where possible to avoid mixed-content warnings.
    return routedHtml.replace(/(href|src)="http:\/\/([^"]+)"/gi, (full, attr, target) => {
        const lower = String(target || '').toLowerCase();
        if (
            lower.startsWith('localhost') ||
            lower.startsWith('127.0.0.1') ||
            lower.startsWith('0.0.0.0')
        ) {
            return full;
        }
        return `${attr}="https://${target}"`;
    });
}

/**
 * Render a self-contained, branded HTML page from markdown content.
 */
function renderHtmlPage(title, markdownContent, docPath, lastModified, allDocs) {
    const renderedHtml = marked.parse(markdownContent);
    const htmlBody = rewriteMarkdownLinksToPublicRoutes(renderedHtml, allDocs || {});
    const year = new Date().getFullYear();
    const modifiedDate = lastModified
        ? new Date(lastModified).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '';
    const family = getDocumentFamily(docPath);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Refuge House</title>
    <link rel="icon" type="image/png" href="/favicon.png">
    <style>
        :root {
            --rh-primary: ${BRAND.primary};
            --rh-primary-dark: ${BRAND.primaryDark};
            --rh-secondary: ${BRAND.secondary};
            --rh-accent: ${BRAND.accent};
            --rh-bg: ${BRAND.bg};
            --rh-light-purple: ${BRAND.lightPurple};
            --rh-surface: ${BRAND.surface};
            --rh-border: ${BRAND.border};
            --rh-text: ${BRAND.text};
            --rh-muted: ${BRAND.muted};
        }
        *, *::before, *::after { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.7;
            color: var(--rh-text);
            background: var(--rh-bg);
            margin: 0;
            padding: 0;
        }
        .header {
            background: linear-gradient(135deg, var(--rh-primary), var(--rh-primary-dark));
            color: white;
            padding: 1.15rem 1.5rem;
            border-bottom: 4px solid rgba(255,255,255,0.12);
        }
        .header-inner {
            max-width: 980px;
            margin: 0 auto;
        }
        .eyebrow {
            display: inline-block;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            font-weight: 600;
            border: 1px solid rgba(255,255,255,0.35);
            border-radius: 999px;
            padding: 0.2rem 0.55rem;
            margin-bottom: 0.5rem;
        }
        .header h1 {
            margin: 0;
            font-size: 1.2rem;
            font-weight: 650;
            letter-spacing: 0.01em;
        }
        .header .org-name {
            font-size: 0.84rem;
            opacity: 0.9;
            margin-top: 0.35rem;
        }
        .container {
            max-width: 900px;
            margin: 1.4rem auto;
            background: var(--rh-surface);
            padding: 2rem 2.2rem;
            border-radius: 10px;
            border: 1px solid var(--rh-border);
            box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
        }
        .meta {
            font-size: 0.84rem;
            color: var(--rh-muted);
            border-bottom: 1px solid var(--rh-border);
            padding-bottom: 0.9rem;
            margin-bottom: 1.4rem;
        }
        .content h1 { font-size: 1.5rem; margin-top: 1.65rem; color: var(--rh-primary); }
        .content h2 { font-size: 1.22rem; margin-top: 1.45rem; color: var(--rh-primary); border-bottom: 1px solid var(--rh-border); padding-bottom: 0.28rem; }
        .content h3 { font-size: 1.06rem; margin-top: 1.25rem; color: var(--rh-accent); }
        .content h4 { font-size: 0.98rem; margin-top: 1rem; color: var(--rh-accent); }
        .content p { margin: 0.78rem 0; }
        .content ul, .content ol { padding-left: 1.4rem; }
        .content li { margin: 0.27rem 0; }
        .content table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
        .content th, .content td { border: 1px solid var(--rh-border); padding: 0.5rem 0.72rem; text-align: left; }
        .content th { background: var(--rh-light-purple); font-weight: 620; }
        .content blockquote { border-left: 3px solid var(--rh-accent); margin: 1rem 0; padding: 0.5rem 1rem; background: #faf5ff; }
        .content code { background: #f5f0fa; padding: 0.12rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
        .content pre { background: #f5f0fa; padding: 0.9rem; border-radius: 4px; overflow-x: auto; }
        .content pre code { background: none; padding: 0; }
        .content a { color: var(--rh-accent); }
        .footer {
            text-align: center;
            font-size: 0.79rem;
            color: #97a0ad;
            padding: 1.6rem;
        }
        @media print {
            body { background: white; }
            .header { background: var(--rh-primary); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .container { box-shadow: none; margin: 0; border: none; padding: 1rem 0; }
        }
        @media (max-width: 700px) {
            .container { padding: 1.2rem 1rem; margin: 0.7rem; }
        }
        /* Section pager (progressive enhancement — injected by the script below) */
        .doc-pager { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin: 0 0 1.3rem; padding: 0.55rem 0.7rem; background: var(--rh-light-purple); border: 1px solid #d4b5e4; border-radius: 10px; }
        .doc-pager.bottom { margin: 1.5rem 0 0; }
        .doc-pager button { background: var(--rh-primary); color: #fff; border: none; border-radius: 8px; padding: 0.4rem 0.8rem; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
        .doc-pager button:hover { background: var(--rh-primary-dark); }
        .doc-pager button:disabled { opacity: 0.4; cursor: default; }
        .doc-pager select { flex: 1 1 200px; min-width: 160px; max-width: 460px; padding: 0.4rem 0.5rem; border: 1px solid var(--rh-border); border-radius: 8px; font-size: 0.85rem; background: #fff; color: var(--rh-text); }
        .doc-pager .pos { font-size: 0.82rem; color: var(--rh-muted); font-weight: 600; white-space: nowrap; }
        .doc-page { scroll-margin-top: 1rem; }
        .doc-page[hidden] { display: none; }
        @media print {
            .doc-pager { display: none !important; }
            .doc-page, .doc-page[hidden] { display: block !important; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-inner">
            <span class="eyebrow">${family.label}</span>
            <h1>${title}</h1>
            <div class="org-name">Refuge House, Inc.</div>
        </div>
    </div>
    <div class="container">
        <div class="meta">
            ${modifiedDate ? `Last updated: ${modifiedDate}` : ''}
            ${docPath ? ` &middot; Source: ${docPath}` : ''}
        </div>
        <div class="content">
            ${htmlBody}
        </div>
    </div>
    <div class="footer">
        &copy; ${year} Refuge House, Inc. &middot; This is a controlled document. Always refer to the current version.
    </div>
    <script>
    /* Lightweight section pager: splits a long document into pages by heading
       (H1 if there are several, otherwise H2), gives Prev/Next + a jump-to
       dropdown, assigns slug ids to headings (which also makes deep links like
       #drug-testing-and-substance-abuse-policy resolve), routes in-page anchor
       links through the pager, and reveals every section when printing.
       Progressive enhancement: with JS off, the full document still renders. */
    (function () {
        var content = document.querySelector('.content');
        if (!content) return;

        var children = Array.prototype.slice.call(content.children);
        var h1 = children.filter(function (n) { return n.tagName === 'H1'; }).length;
        var h2 = children.filter(function (n) { return n.tagName === 'H2'; }).length;
        var splitTag = h1 > 1 ? 'H1' : (h2 >= 2 ? 'H2' : null);
        if (!splitTag) return; // short or flat document — leave as one page

        function slugify(t) {
            return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }
        var usedIds = {};
        function ensureId(el) {
            if (el.id) { usedIds[el.id] = true; return; }
            var base = slugify(el.textContent) || 'section';
            var id = base, n = 2;
            while (usedIds[id]) { id = base + '-' + n; n++; }
            usedIds[id] = true; el.id = id;
        }

        var pages = [];
        var current = null;
        children.forEach(function (node) {
            if (/^H[1-6]$/.test(node.tagName)) ensureId(node);
            if (node.tagName === splitTag || !current) {
                current = document.createElement('section');
                current.className = 'doc-page';
                current.dataset.title = /^H[1-6]$/.test(node.tagName) ? node.textContent : 'Introduction';
                pages.push(current);
            }
            current.appendChild(node);
        });
        if (pages.length < 2) {
            pages.forEach(function (p) { while (p.firstChild) content.appendChild(p.firstChild); });
            return;
        }
        pages.forEach(function (p) { content.appendChild(p); });

        var idx = 0;
        var bars = [];
        function sync() {
            bars.forEach(function (bar) {
                bar.prev.disabled = idx === 0;
                bar.next.disabled = idx === pages.length - 1;
                bar.sel.value = idx;
                bar.pos.textContent = (idx + 1) + ' / ' + pages.length;
            });
        }
        function show(i, toTop) {
            if (i < 0 || i >= pages.length) return;
            idx = i;
            pages.forEach(function (p, k) { p.hidden = k !== idx; });
            sync();
            if (toTop) window.scrollTo(0, 0);
        }
        function pageIndexOf(id) {
            var el = id ? document.getElementById(id) : null;
            if (!el) return -1;
            for (var i = 0; i < pages.length; i++) { if (pages[i].contains(el)) return i; }
            return -1;
        }
        function jumpToId(id, push) {
            var i = pageIndexOf(id);
            if (i < 0) return false;
            show(i, false);
            var el = document.getElementById(id);
            if (el && el.scrollIntoView) el.scrollIntoView();
            if (push && history.replaceState) history.replaceState(null, '', '#' + id);
            return true;
        }

        function buildPager(position) {
            var bar = document.createElement('div');
            bar.className = 'doc-pager' + (position === 'bottom' ? ' bottom' : '');
            var prev = document.createElement('button'); prev.type = 'button'; prev.textContent = '\u2190 Prev'; prev.setAttribute('aria-label', 'Previous section');
            var next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next \u2192'; next.setAttribute('aria-label', 'Next section');
            var sel = document.createElement('select'); sel.setAttribute('aria-label', 'Jump to section');
            pages.forEach(function (p, i) {
                var o = document.createElement('option');
                o.value = i; o.textContent = (i + 1) + '. ' + (p.dataset.title || ('Section ' + (i + 1)));
                sel.appendChild(o);
            });
            var pos = document.createElement('span'); pos.className = 'pos';
            prev.addEventListener('click', function () { show(idx - 1, true); });
            next.addEventListener('click', function () { show(idx + 1, true); });
            sel.addEventListener('change', function () { show(parseInt(sel.value, 10), true); });
            bar.appendChild(prev); bar.appendChild(sel); bar.appendChild(next); bar.appendChild(pos);
            bars.push({ prev: prev, next: next, sel: sel, pos: pos });
            return bar;
        }

        content.parentNode.insertBefore(buildPager('top'), content);
        content.parentNode.insertBefore(buildPager('bottom'), content.nextSibling);

        content.addEventListener('click', function (e) {
            var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
            if (!a) return;
            var id = decodeURIComponent(a.getAttribute('href').slice(1));
            if (id && pageIndexOf(id) >= 0) { e.preventDefault(); jumpToId(id, true); }
        });
        window.addEventListener('hashchange', function () {
            jumpToId(decodeURIComponent((location.hash || '').replace(/^#/, '')), false);
        });

        var restore = [];
        window.addEventListener('beforeprint', function () {
            restore = pages.map(function (p) { return p.hidden; });
            pages.forEach(function (p) { p.hidden = false; });
        });
        window.addEventListener('afterprint', function () {
            pages.forEach(function (p, k) { p.hidden = restore[k]; });
        });

        var hashId = decodeURIComponent((location.hash || '').replace(/^#/, ''));
        if (!(hashId && jumpToId(hashId, false))) show(0, false);
    })();
    </script>
</body>
</html>`;
}

// GET /public/documents - List all publicly available documents with their slugs
router.get('/', (req, res) => {
    noStore(res);
    const docs = getAllDocuments();
    const index = getDocumentIndex();
    const listing = [];

    for (const [docPath, doc] of Object.entries(docs)) {
        // Only list documents the caller is allowed to open, so the index can't be
        // used to enumerate gated content.
        const tier = accessForDoc(doc);
        if (!allows(req, tier)) continue;

        const slug = pathToSlug(docPath);
        const family = getDocumentFamily(docPath);
        const entry = {
            slug,
            path: docPath,
            title: docPath.split('/').pop().replace(/\.md$/i, ''),
            category: doc.category,
            access: tier,
            family: family.label,
            lastModified: doc.lastModified,
            url: `/public/documents/${slug}`
        };
        // Include summary if indexed
        if (index[docPath]?.summary) {
            entry.summary = index[docPath].summary;
        }
        listing.push(entry);
    }

    listing.sort((a, b) => a.title.localeCompare(b.title));

    res.json({
        count: listing.length,
        documents: listing
    });
});

// GET /public/documents/about - Render knowbase root README as branded About page
router.get('/about', async (req, res) => {
    noStore(res);
    await refreshIfStale();
    const readme = getKnowbaseReadme();
    if (!readme) {
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:4rem;">
                <h2>About Page Not Available</h2>
                <p>Knowbase README has not been loaded yet.</p>
                <a href="/public/documents">View all documents</a>
            </body></html>
        `);
    }

    const title = 'Refuge House Knowledge Base';
    const format = req.query.format || 'html';

    if (format === 'json') {
        return res.json({
            slug: 'about',
            path: readme.path,
            title,
            family: 'About',
            lastModified: readme.lastModified,
            content: readme.content
        });
    }

    if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.send(readme.content);
    }

    const html = renderHtmlPage(title, readme.content, readme.path, readme.lastModified, getAllDocuments());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
});

// GET /public/documents/:slug - Render a document as a branded HTML page
// Query params:
//   ?format=json     — return JSON instead of HTML (for app embedding)
//   ?format=markdown — return raw markdown text (inline)
//   ?download=1      — download the raw markdown as a .md attachment
//   (branded policy PDFs are served as static files via /public/files)
router.get('/:slug', (req, res) => {
    noStore(res);
    const { slug } = req.params;
    const format = req.query.format || 'html';

    const result = findBySlug(slug);
    if (!result) {
        if (format === 'json' || format === 'markdown') {
            return res.status(404).json({ error: `Document not found: ${slug}` });
        }
        return res.status(404).send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:4rem;">
                <h2>Document Not Found</h2>
                <p>The document "${slug}" was not found.</p>
                <a href="/public/documents">View all documents</a>
            </body></html>
        `);
    }

    const { path: docPath, doc } = result;

    // Enforce the document's own access tier (default-restrictive = staff).
    const tier = accessForDoc(doc);
    if (!allows(req, tier)) {
        return deny(req, res, tier);
    }

    const title = docPath.split('/').pop().replace(/\.md$/i, '');

    if (format === 'json') {
        return res.json({
            slug,
            path: docPath,
            title,
            category: doc.category,
            family: getDocumentFamily(docPath).label,
            lastModified: doc.lastModified,
            content: doc.content
        });
    }

    // Raw markdown — inline, or a .md attachment with ?download=1. Branded
    // policy PDFs are pre-generated by the cookbook (ReportLab V6) and served
    // as static files via /public/files; the desk-review portal links there.
    const wantsDownload = req.query.download === '1' || req.query.download === 'true';
    if (format === 'markdown' || wantsDownload) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        if (wantsDownload) {
            const fname = String(slug).replace(/[^a-z0-9._-]+/gi, '-') + '.md';
            res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        }
        return res.send(doc.content);
    }

    // Default: render as branded HTML page
    const html = renderHtmlPage(title, doc.content, docPath, doc.lastModified, getAllDocuments());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

module.exports = router;
