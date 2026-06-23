// utils/link-rewrite.js — serve-time rewriting of repo-relative links.
//
// Documents we serve (HTML reference sheets under temporary-reference/, and any
// markdown rendered to HTML) carry repo-relative links such as:
//   ../../policies-procedures/Policy/Background%20Check%20and%20Eligibility%20Policy.md
//   ../SSCC/Grievance%20and%20Appeal.pdf
// When served — or rendered to PDF and downloaded — a relative `../..` path
// resolves against a filesystem/document base and produces a `file://` URL or a
// 404. The link *targets* are valid knowbase files; only the link *form* is
// wrong for serving.
//
// This module rewrites every relative href/src to an absolute compliance URL at
// serve/render time. It does NOT touch the source documents in the knowbase.
//
//   markdown doc the API serves by slug -> {BASE}/public/documents/<slug>
//   any other repo file (pdf/html/img)  -> {BASE}/public/files/<repo-path>
//
// The slug is computed with the same function the API uses for
// /public/documents/:slug (re-exported from the knowbase loader) so links match.

const posix = require('path').posix;
const { getAllDocuments, pathToSlug } = require('../services/knowbase-loader');

// Canonical, public base URL for the compliance site. Centralized here so the
// host isn't hardcoded across the rewrite paths.
const PUBLIC_BASE_URL = String(
    process.env.PUBLIC_BASE_URL || 'https://compliance.refugehouse.org'
).replace(/\/+$/, '');

const KNOWBASE_REPO_URL =
    process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';

function parseRepoUrl(url) {
    const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    return m ? { owner: m[1], repo: m[2] } : null;
}
const KNOWBASE_REPO = parseRepoUrl(KNOWBASE_REPO_URL);

function publicDocumentsBase() { return `${PUBLIC_BASE_URL}/public/documents`; }
function publicFilesBase() { return `${PUBLIC_BASE_URL}/public/files`; }

// Split a trailing "#fragment" or "?query" off a link so it can be preserved.
function splitSuffix(value) {
    const hash = value.indexOf('#');
    const query = value.indexOf('?');
    const idx = [hash, query].filter((v) => v >= 0).sort((a, b) => a - b)[0];
    if (idx === undefined) return { base: value, suffix: '' };
    return { base: value.slice(0, idx), suffix: value.slice(idx) };
}

// Re-encode a clean repo path for use in a URL: encode each segment (spaces ->
// %20) while leaving the slashes. encodeURIComponent preserves () so filenames
// like "Foster Parent Agreement (Master).html" round-trip correctly.
function encodeRepoPath(repoPath) {
    return repoPath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Resolve a repo-relative href against the serving document's own directory and
 * normalize `.`/`..` to a clean repo-relative target path.
 *   serving: temporary-reference/fy26-sscc-joint-monitoring/x-reference-sheet.html
 *   href:    ../../policies-procedures/Policy/Background Check and Eligibility Policy.md
 *   ->       policies-procedures/Policy/Background Check and Eligibility Policy.md
 */
function resolveRepoTarget(servingDocPath, relHref) {
    const dir = posix.dirname(String(servingDocPath || '').replace(/^\/+/, ''));
    const joined = posix.join(dir === '.' ? '' : dir, relHref);
    let normalized = posix.normalize(joined);
    // Drop any leading traversal that escaped the repo root, plus leading ./ or /.
    normalized = normalized.replace(/^(\.\.\/)+/, '').replace(/^\.?\//, '').replace(/^\/+/, '');
    return normalized;
}

/**
 * Map a clean repo-relative target path to an absolute public URL. Markdown docs
 * the API serves by slug go to /public/documents/<slug>; everything else
 * (PDF/HTML/binary/image) goes to /public/files/<repo-path>.
 */
function targetToPublicUrl(repoPath, docSet) {
    if (!repoPath) return null;
    const lower = repoPath.toLowerCase();
    if (lower === 'readme.md') return `${publicDocumentsBase()}/about`;
    if (lower.endsWith('.md') && docSet.has(repoPath)) {
        return `${publicDocumentsBase()}/${pathToSlug(repoPath)}`;
    }
    return `${publicFilesBase()}/${encodeRepoPath(repoPath)}`;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function isKnowbaseRepoRootLink(href) {
    if (!KNOWBASE_REPO) return false;
    const re = new RegExp(`^https?:\\/\\/github\\.com\\/${escapeRe(KNOWBASE_REPO.owner)}\\/${escapeRe(KNOWBASE_REPO.repo)}\\/?$`, 'i');
    return re.test(href);
}

function extractRepoPathFromGithubHref(href) {
    if (!KNOWBASE_REPO) return null;
    const owner = escapeRe(KNOWBASE_REPO.owner);
    const repo = escapeRe(KNOWBASE_REPO.repo);
    const patterns = [
        new RegExp(`^https?:\\/\\/github\\.com\\/${owner}\\/${repo}\\/blob\\/[^/]+\\/(.+)$`, 'i'),
        new RegExp(`^https?:\\/\\/github\\.com\\/${owner}\\/${repo}\\/tree\\/[^/]+\\/(.+)$`, 'i'),
        new RegExp(`^https?:\\/\\/raw\\.githubusercontent\\.com\\/${owner}\\/${repo}\\/[^/]+\\/(.+)$`, 'i')
    ];
    for (const p of patterns) {
        const m = href.match(p);
        if (m && m[1]) return m[1];
    }
    return null;
}

// Decide the rewritten value for a single href/src, or null to leave it as-is.
function rewriteValue(value, servingDocPath, docSet) {
    const v = String(value).trim();
    if (!v) return null;
    if (v.startsWith('#')) return null;                          // in-page anchor
    if (/^(mailto:|tel:|data:|javascript:)/i.test(v)) return null;
    if (/^\/\//.test(v)) return null;                           // protocol-relative

    const { base, suffix } = splitSuffix(v);
    if (!base) return null;                                      // pure suffix (e.g. "?x")

    // Absolute http(s): only fold known knowbase GitHub links back into the app;
    // leave true external links (e.g. txrules.elaws.us) untouched.
    if (/^https?:\/\//i.test(base)) {
        if (isKnowbaseRepoRootLink(base)) return `${publicDocumentsBase()}/about${suffix}`;
        const repoPath = extractRepoPathFromGithubHref(base);
        if (repoPath) {
            let decoded;
            try { decoded = decodeURIComponent(repoPath); } catch (_e) { decoded = repoPath; }
            const url = targetToPublicUrl(decoded.replace(/^\/+/, ''), docSet);
            return url ? url + suffix : null;
        }
        return null;
    }

    if (base.startsWith('/')) return null;                      // already site-absolute

    let decoded;
    try { decoded = decodeURIComponent(base); } catch (_e) { decoded = base; }
    const repoPath = resolveRepoTarget(servingDocPath, decoded);
    if (!repoPath) return null;
    const url = targetToPublicUrl(repoPath, docSet);
    return url ? url + suffix : null;
}

/**
 * Rewrite every relative href/src in a served HTML string to an absolute public
 * URL, resolved against the serving document's own repo path.
 *
 * @param {string} html             - HTML to rewrite (rendered markdown or a served .html file)
 * @param {string} servingDocPath   - the serving document's repo-relative path
 * @param {{docSet?: Set<string>}} [opts] - optional injected doc-path set (tests)
 * @returns {string}
 */
function rewriteServedLinks(html, servingDocPath, opts = {}) {
    if (!html) return html;
    const docSet = opts.docSet || new Set(Object.keys(getAllDocuments() || {}));

    let out = html.replace(/\b(href|src)\s*=\s*(["'])([\s\S]*?)\2/gi, (full, attr, quote, value) => {
        const rewritten = rewriteValue(value, servingDocPath, docSet);
        return rewritten == null ? full : `${attr}=${quote}${rewritten}${quote}`;
    });

    // Upgrade insecure external links to https to avoid mixed-content warnings
    // (leave local hosts alone).
    out = out.replace(/\b(href|src)\s*=\s*(["'])http:\/\/([^"']+)\2/gi, (full, attr, quote, target) => {
        const lower = String(target).toLowerCase();
        if (lower.startsWith('localhost') || lower.startsWith('127.0.0.1') || lower.startsWith('0.0.0.0')) {
            return full;
        }
        return `${attr}=${quote}https://${target}${quote}`;
    });

    return out;
}

module.exports = {
    rewriteServedLinks,
    resolveRepoTarget,
    targetToPublicUrl,
    PUBLIC_BASE_URL
};
