// routes/public-files.js - Public (unauthenticated) binary file streaming.
//
// Streams binary documents (PDF, PNG, DOCX) straight from the knowbase repo via
// the GitHub API, so binaries live only in the knowbase repo — never copied to a
// CDN or committed into this API. The knowbase loader keeps only markdown/HTML in
// memory; binaries are fetched on demand here.
//
//   GET /public/files/<repo-relative-path>           -> inline (viewable)
//   GET /public/files/<repo-relative-path>?download=1 -> attachment (download)
//
// Security: path-traversal is rejected, and access is restricted to an allowlist
// of top-level directories and file extensions.
const express = require('express');
const router = express.Router();
const { allows, deny } = require('../middleware/human-auth');
const { accessForFilePath } = require('../utils/access');
const { rewriteServedLinks } = require('../utils/link-rewrite');

const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
const KNOWBASE_BRANCH = process.env.KNOWBASE_BRANCH || 'main';

function parseRepoUrl(url) {
    const match = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
}
const KNOWBASE_REPO = parseRepoUrl(KNOWBASE_REPO_URL);

// Only these top-level directories and extensions may be served. Top-level dir
// allowlisting (plus traversal rejection) keeps this scoped to shareable
// reference material and away from anything else in the repo.
// `governance/` is allowlisted for serving but is staff-only (see the hard
// staff gate in the handler and accessForFilePath); the rest are reviewer-tier.
const ALLOWED_DIRS = ['regulatory-references/', 'plans/', 'temporary-reference/', 'forms/', 'generated-pdf/', 'policies-procedures/', 'personnel-hr/', 'governance/'];

// Directories that require a genuine authenticated staff (Entra) principal and
// must NEVER be exposed publicly — even when HUMAN_AUTH_MODE is off/log. If the
// staff-auth path isn't wired (no principal), these simply stay unserved.
const STAFF_ONLY_DIRS = ['governance/'];
const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.html'];

const CONTENT_TYPES = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.html': 'text/html; charset=utf-8'
};

/**
 * Validate and normalize a requested repo-relative path.
 * Pure function (no I/O) so it can be unit-tested in isolation.
 *
 * @returns {{ ok: true, path: string, ext: string }} on success
 * @returns {{ ok: false, status: number, error: string }} on rejection
 */
function resolveSafeRepoPath(rawPath) {
    let candidate = String(rawPath || '');

    // Defensive decode (Express usually decodes path params already; decoding an
    // already-decoded value is harmless for our allowlisted inputs).
    try {
        candidate = decodeURIComponent(candidate);
    } catch (_err) {
        return { ok: false, status: 400, error: 'Malformed path encoding' };
    }

    // Null bytes / control characters
    if (/[\x00-\x1f]/.test(candidate)) {
        return { ok: false, status: 400, error: 'Invalid path' };
    }

    // Backslashes are not valid repo separators and can be used to dodge checks.
    if (candidate.includes('\\')) {
        return { ok: false, status: 400, error: 'Invalid path separator' };
    }

    // Normalize leading ./ and /
    candidate = candidate.replace(/^\.?\//, '').replace(/^\/+/, '');

    if (!candidate) {
        return { ok: false, status: 400, error: 'No file specified' };
    }

    // Reject traversal and empty segments (e.g. a//b).
    const segments = candidate.split('/');
    for (const seg of segments) {
        if (seg === '' || seg === '.' || seg === '..') {
            return { ok: false, status: 400, error: 'Path traversal is not allowed' };
        }
    }

    // Must live under an allowlisted top-level directory.
    if (!ALLOWED_DIRS.some((dir) => candidate.startsWith(dir))) {
        return {
            ok: false,
            status: 403,
            error: `Path must be under one of: ${ALLOWED_DIRS.join(', ')}`
        };
    }

    // Must have an allowlisted extension.
    const lower = candidate.toLowerCase();
    const ext = ALLOWED_EXTENSIONS.find((e) => lower.endsWith(e));
    if (!ext) {
        return {
            ok: false,
            status: 403,
            error: `Only these file types are served: ${ALLOWED_EXTENSIONS.join(', ')}`
        };
    }

    return { ok: true, path: candidate, ext };
}

/**
 * Fetch raw file bytes from the knowbase repo via the GitHub contents API.
 * The `Accept: application/vnd.github.raw` header makes GitHub return the raw
 * bytes directly (works for binaries and large files), so we don't have to
 * base64-decode blob JSON.
 */
async function fetchKnowbaseRaw(repoPath) {
    if (!KNOWBASE_REPO) {
        throw Object.assign(new Error('Knowbase repo URL is not configured'), { status: 500 });
    }

    const encoded = repoPath.split('/').map(encodeURIComponent).join('/');
    const url = `https://api.github.com/repos/${KNOWBASE_REPO.owner}/${KNOWBASE_REPO.repo}/contents/${encoded}?ref=${encodeURIComponent(KNOWBASE_BRANCH)}`;

    const headers = {
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'refuge-house-compliance-api'
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers['Authorization'] = `token ${token}`;

    const res = await fetch(url, { headers });

    if (res.status === 404) {
        throw Object.assign(new Error('File not found in knowbase'), { status: 404 });
    }
    if (res.status === 403) {
        // Rate limit (unauthenticated) or access denied.
        throw Object.assign(
            new Error('GitHub denied the request (rate limit or missing GITHUB_TOKEN for a private repo)'),
            { status: 502 }
        );
    }
    if (!res.ok) {
        throw Object.assign(new Error(`GitHub API ${res.status}`), { status: 502 });
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// GET /public/files/<repo-relative-path>
router.get(/^\/(.+)/, async (req, res) => {
    const rawPath = req.params[0];
    const resolved = resolveSafeRepoPath(rawPath);
    if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.error });
    }

    // Binaries carry no frontmatter, so their tier comes from the file access map
    // (default-restrictive = staff; curated shareable dirs opened to reviewer).
    const tier = accessForFilePath(resolved.path);

    // Staff-only directories (e.g. governance/ board records) are fail-closed:
    // they require a real staff (Entra) principal regardless of HUMAN_AUTH_MODE,
    // so they are never exposed publicly while the gate is in off/log mode, and
    // stay unserved entirely if staff auth isn't wired (no principal present).
    if (STAFF_ONLY_DIRS.some((dir) => resolved.path.startsWith(dir))) {
        if (!req.caller || !req.caller.isStaff) {
            return deny(req, res, 'staff');
        }
    }

    if (!allows(req, tier)) {
        return deny(req, res, tier);
    }

    try {
        let buffer = await fetchKnowbaseRaw(resolved.path);
        const filename = resolved.path.split('/').pop().replace(/"/g, '');
        const disposition = req.query.download ? 'attachment' : 'inline';

        // Served HTML (e.g. SSCC reference sheets) carries repo-relative links
        // (../../policies-procedures/...md, ../SSCC/...pdf). Rewrite them to
        // absolute /public/... URLs at serve time so they click through instead
        // of resolving to file:// or 404. Binaries pass through untouched.
        if (resolved.ext === '.html') {
            const rewritten = rewriteServedLinks(buffer.toString('utf8'), resolved.path);
            buffer = Buffer.from(rewritten, 'utf8');
        }

        res.setHeader('Content-Type', CONTENT_TYPES[resolved.ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        // Binaries change rarely; allow brief caching to spare the GitHub API,
        // but keep it short so updates propagate quickly.
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.send(buffer);
    } catch (err) {
        const status = err.status || 500;
        if (status >= 500) {
            console.error(`[PUBLIC-FILES] Failed to serve ${resolved.path}: ${err.message}`);
        }
        return res.status(status).json({ error: err.message });
    }
});

module.exports = router;
module.exports.resolveSafeRepoPath = resolveSafeRepoPath;
module.exports._internal = { ALLOWED_DIRS, ALLOWED_EXTENSIONS };
