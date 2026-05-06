// routes/public-documents.js - Public (unauthenticated) document endpoints
// Serves rendered HTML versions of knowbase documents for sharing, embedding,
// and linking from external apps (e.g., foster parent portal).
const express = require('express');
const { marked } = require('marked');
const router = express.Router();
const { getAllDocuments, getDocumentIndex, getKnowbaseReadme, refreshIfStale } = require('../services/knowbase-loader');

const BRAND = {
    primary: '#1b3a5c',
    primaryDark: '#17314d',
    accent: '#2c5282',
    bg: '#f5f7fa',
    surface: '#ffffff',
    border: '#e2e8f0',
    text: '#1f2937',
    muted: '#6b7280'
};

const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';

function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
}

const KNOWBASE_REPO = parseRepoUrl(KNOWBASE_REPO_URL);

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

    return renderedHtml.replace(/href="([^"]+)"/g, (full, href) => {
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
    <link rel="icon" type="image/svg+xml" href="/favicon.svg">
    <style>
        :root {
            --rh-primary: ${BRAND.primary};
            --rh-primary-dark: ${BRAND.primaryDark};
            --rh-accent: ${BRAND.accent};
            --rh-bg: ${BRAND.bg};
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
            margin-top: 0.28rem;
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
        .content th { background: #edf2f7; font-weight: 620; }
        .content blockquote { border-left: 3px solid var(--rh-accent); margin: 1rem 0; padding: 0.5rem 1rem; background: #f8fafc; }
        .content code { background: #eef2f7; padding: 0.12rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
        .content pre { background: #eef2f7; padding: 0.9rem; border-radius: 4px; overflow-x: auto; }
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
    </style>
</head>
<body>
    <div class="header">
        <div class="header-inner">
            <span class="eyebrow">${family.label}</span>
            <h1>${title}</h1>
            <div class="org-name">Refuge House, Inc. Compliance Library</div>
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
</body>
</html>`;
}

// GET /public/documents - List all publicly available documents with their slugs
router.get('/', (req, res) => {
    const docs = getAllDocuments();
    const index = getDocumentIndex();
    const listing = [];

    for (const [docPath, doc] of Object.entries(docs)) {
        const slug = pathToSlug(docPath);
        const family = getDocumentFamily(docPath);
        const entry = {
            slug,
            path: docPath,
            title: docPath.split('/').pop().replace(/\.md$/i, ''),
            category: doc.category,
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
//   ?format=json   — return JSON instead of HTML (for app embedding)
//   ?format=markdown — return raw markdown text
router.get('/:slug', (req, res) => {
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

    if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return res.send(doc.content);
    }

    // Default: render as branded HTML page
    const html = renderHtmlPage(title, doc.content, docPath, doc.lastModified, getAllDocuments());
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

module.exports = router;
