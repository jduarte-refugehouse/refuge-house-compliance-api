// services/content-cookbook.js
// Recipient-side mirror, registry, and resolver for the cookbook content layer.
//
// Three responsibilities, kept separate by design:
//   1. Render store  — HTML bodies served by slug
//   2. Registry      — index.json + per-entry metadata
//   3. Resolver      — deterministic mapping from (context) -> entry
//
// The sender repo (knowbase) is the source of truth. We mirror cookbook/index.json
// and the HTML files under cookbook/ into memory. Reads are cached with a short
// TTL; the cache can be busted on sync or deploy.

const path = require('path');
const crypto = require('crypto');

const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
const KNOWBASE_BRANCH = process.env.KNOWBASE_BRANCH || 'main';
const COOKBOOK_DIR = (process.env.COOKBOOK_DIR || 'cookbook').replace(/\/+$/, '');
const REGISTRY_FILE = `${COOKBOOK_DIR}/index.json`;
const CACHE_TTL_MS = parseInt(process.env.COOKBOOK_CACHE_TTL_MS || '60000', 10);

// Required schema fields on every registry entry.
const REQUIRED_FIELDS = [
    'id', 'slug', 'title', 'kind', 'contentType', 'domain', 'status', 'path'
];
const VALID_STATUSES = ['active', 'stub', 'deprecated', 'superseded', 'archived'];
const VALID_STATUS_SET = new Set(VALID_STATUSES);

function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
    return { owner: match[1], repo: match[2] };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = parseRepoUrl(KNOWBASE_REPO_URL);

// In-memory state
let _registry = {};            // slug -> validated, enriched entry
let _html = {};                // slug -> { content, sizeBytes, mirroredAt }
let _validationReport = {
    validatedAt: null,
    total: 0,
    valid: 0,
    invalid: [],
    warnings: []
};
let _lastSyncAt = 0;
let _lastSourceRef = null;
let _inFlightSync = null;

async function githubFetch(apiPath) {
    const url = `https://api.github.com${apiPath}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'refuge-house-compliance-api'
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers['Authorization'] = `token ${token}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
}

function checksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

function validateEntry(entry) {
    const issues = [];
    if (!entry || typeof entry !== 'object') {
        return ['entry is not an object'];
    }
    for (const field of REQUIRED_FIELDS) {
        const v = entry[field];
        if (v === undefined || v === null || v === '') {
            issues.push(`missing required field: ${field}`);
        }
    }
    if (entry.status && !VALID_STATUS_SET.has(entry.status)) {
        issues.push(`invalid status "${entry.status}" (allowed: ${VALID_STATUSES.join(', ')})`);
    }
    if (entry.contexts && (typeof entry.contexts !== 'object' || Array.isArray(entry.contexts))) {
        issues.push('contexts must be an object');
    }
    if (typeof entry.path === 'string' && entry.path.includes('..')) {
        issues.push('path contains ".." traversal');
    }
    return issues;
}

/**
 * Mirror the cookbook registry + HTML content from the knowbase repo into memory.
 * Drift / coupling problems are captured in the validation report rather than
 * silently dropped; serious malformations cause the entry to be rejected.
 */
async function syncCookbook() {
    if (_inFlightSync) return _inFlightSync;
    _inFlightSync = (async () => {
        console.log(`[COOKBOOK] Mirroring ${REPO_OWNER}/${REPO_NAME}@${KNOWBASE_BRANCH}/${COOKBOOK_DIR}`);

        let headSha = null;
        try {
            const branch = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/branches/${KNOWBASE_BRANCH}`);
            headSha = branch?.commit?.sha || null;
        } catch (err) {
            console.warn(`[COOKBOOK] Could not resolve branch HEAD sha: ${err.message}`);
        }

        let tree;
        try {
            tree = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${KNOWBASE_BRANCH}?recursive=1`);
        } catch (err) {
            console.error(`[COOKBOOK] Failed to fetch repo tree: ${err.message}`);
            return { success: false, error: err.message };
        }

        const validation = {
            validatedAt: new Date().toISOString(),
            total: 0,
            valid: 0,
            invalid: [],
            warnings: []
        };

        const registryItem = tree.tree.find(i => i.path === REGISTRY_FILE && i.type === 'blob');
        if (!registryItem) {
            const msg = `registry file ${REGISTRY_FILE} not found`;
            console.warn(`[COOKBOOK] ${msg}`);
            _registry = {};
            _html = {};
            _validationReport = { ...validation, warnings: [msg] };
            _lastSyncAt = Date.now();
            _lastSourceRef = headSha;
            return { success: true, total: 0, warnings: [msg] };
        }

        let entries;
        try {
            const blob = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${registryItem.sha}`);
            const text = Buffer.from(blob.content, 'base64').toString('utf-8');
            const parsed = JSON.parse(text);
            entries = Array.isArray(parsed) ? parsed
                : Array.isArray(parsed?.entries) ? parsed.entries
                    : [];
        } catch (err) {
            console.error(`[COOKBOOK] Failed to load/parse ${REGISTRY_FILE}: ${err.message}`);
            return { success: false, error: `registry: ${err.message}` };
        }

        validation.total = entries.length;

        // Path index for quick HTML lookup
        const pathIndex = {};
        for (const item of tree.tree) {
            if (item.type === 'blob') pathIndex[item.path] = item;
        }

        const mirroredAt = new Date().toISOString();
        const newRegistry = {};
        const newHtml = {};
        const seenSlugs = new Set();

        await Promise.all(entries.map(async (raw) => {
            const slug = raw?.slug || raw?.id || '<unknown>';
            const issues = validateEntry(raw);

            if (seenSlugs.has(raw?.slug)) {
                issues.push(`duplicate slug "${raw.slug}"`);
            }
            if (raw?.slug) seenSlugs.add(raw.slug);

            if (issues.length > 0) {
                validation.invalid.push({ slug, issues });
                console.warn(`[COOKBOOK] Rejecting "${slug}": ${issues.join('; ')}`);
                return;
            }

            // Mirror HTML if this entry points to one
            let htmlContent = null;
            let computedChecksum = null;
            const isHtml = raw.contentType === 'html' || (typeof raw.path === 'string' && raw.path.endsWith('.html'));

            if (isHtml) {
                const treeItem = pathIndex[raw.path];
                if (!treeItem) {
                    validation.warnings.push({ slug, warning: `html file not found: ${raw.path}` });
                } else {
                    try {
                        const blob = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${treeItem.sha}`);
                        htmlContent = Buffer.from(blob.content, 'base64').toString('utf-8');
                        computedChecksum = checksum(htmlContent);
                    } catch (err) {
                        validation.warnings.push({ slug, warning: `failed to mirror html (${raw.path}): ${err.message}` });
                    }
                }
            }

            // Drift / coupling checks (non-blocking)
            if (raw.checksum && computedChecksum && raw.checksum !== computedChecksum) {
                validation.warnings.push({
                    slug,
                    warning: `checksum mismatch (registry=${raw.checksum.slice(0, 12)}…, file=${computedChecksum.slice(0, 12)}…)`
                });
            }
            if (!raw.sourceRef && !headSha) {
                validation.warnings.push({ slug, warning: 'no sourceRef recorded and branch HEAD unavailable' });
            }
            if (!raw.contexts) {
                validation.warnings.push({ slug, warning: 'entry has no contexts (resolution will only match domain/contentType)' });
            }

            const enriched = {
                id: raw.id,
                slug: raw.slug,
                title: raw.title,
                summary: raw.summary || null,
                kind: raw.kind,
                contentType: raw.contentType,
                domain: raw.domain,
                contexts: raw.contexts || {},
                status: raw.status,
                path: raw.path,
                sourceRepo: raw.sourceRepo || `${REPO_OWNER}/${REPO_NAME}`,
                sourcePath: raw.sourcePath || raw.path,
                sourceRef: raw.sourceRef || headSha,
                sourceUrl: raw.sourceUrl || (raw.path
                    ? `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${KNOWBASE_BRANCH}/${raw.path}`
                    : null),
                mirroredAt,
                syncMode: raw.syncMode || 'mirror',
                checksum: raw.checksum || computedChecksum || null,
                isDefault: !!raw.isDefault,
                supersededBy: raw.supersededBy || null
            };

            newRegistry[enriched.slug] = enriched;
            if (htmlContent != null) {
                newHtml[enriched.slug] = {
                    content: htmlContent,
                    sizeBytes: Buffer.byteLength(htmlContent, 'utf-8'),
                    mirroredAt
                };
            }
            validation.valid += 1;
        }));

        _registry = newRegistry;
        _html = newHtml;
        _validationReport = validation;
        _lastSyncAt = Date.now();
        _lastSourceRef = headSha;

        console.log(`[COOKBOOK] Sync complete: ${validation.valid}/${validation.total} valid, ${validation.invalid.length} invalid, ${validation.warnings.length} warnings`);
        return {
            success: true,
            total: validation.total,
            valid: validation.valid,
            invalid: validation.invalid.length,
            warnings: validation.warnings.length
        };
    })().finally(() => { _inFlightSync = null; });

    return _inFlightSync;
}

async function refreshIfStale() {
    if (!_lastSyncAt || Date.now() - _lastSyncAt > CACHE_TTL_MS) {
        try {
            await syncCookbook();
        } catch (err) {
            console.warn(`[COOKBOOK] refreshIfStale failed (serving stale): ${err.message}`);
        }
    }
}

function invalidateCache() {
    _lastSyncAt = 0;
}

function listEntries(filter = {}) {
    const { status = 'active', kind, contentType, domain, packageCode, addOnCode, slug } = filter;
    const wantStatuses = status === 'all'
        ? null
        : new Set(Array.isArray(status) ? status : String(status).split(',').map(s => s.trim()));

    return Object.values(_registry).filter(e => {
        if (wantStatuses && !wantStatuses.has(e.status)) return false;
        if (kind && e.kind !== kind) return false;
        if (contentType && e.contentType !== contentType) return false;
        if (domain && e.domain !== domain) return false;
        if (slug && e.slug !== slug) return false;
        const ctx = e.contexts || {};
        if (packageCode && ctx.packageCode !== packageCode) return false;
        if (addOnCode && ctx.addOnCode !== addOnCode) return false;
        return true;
    });
}

function getEntry(slug) {
    return _registry[slug] || null;
}

function getHtml(slug) {
    return _html[slug] || null;
}

/**
 * Deterministic resolver. Returns { entry, resolutionMode, candidates } | null.
 *
 * Precedence (first hit wins, never varies silently):
 *   1. exact slug match (any status)
 *   2. contentType + packageCode + addOnCode + status=active
 *   3. contentType + packageCode + status=active (no addOnCode)
 *   4. contentType + domain + status=active
 *   5. fallback default entry (entry.isDefault === true) for the contentType
 */
function resolve(ctx = {}) {
    const { slug, contentType, packageCode, addOnCode, domain } = ctx;
    const active = listEntries({ status: 'active' });

    if (slug) {
        const e = _registry[slug];
        if (e) return { entry: e, resolutionMode: 'slug-exact' };
    }

    if (contentType && packageCode && addOnCode) {
        const m = active.find(e =>
            e.contentType === contentType &&
            e.contexts?.packageCode === packageCode &&
            e.contexts?.addOnCode === addOnCode
        );
        if (m) return { entry: m, resolutionMode: 'contentType+package+addOn' };
    }

    if (contentType && packageCode) {
        const m = active.find(e =>
            e.contentType === contentType &&
            e.contexts?.packageCode === packageCode &&
            !e.contexts?.addOnCode
        );
        if (m) return { entry: m, resolutionMode: 'contentType+package' };
    }

    if (contentType && domain) {
        const m = active.find(e =>
            e.contentType === contentType &&
            e.domain === domain
        );
        if (m) return { entry: m, resolutionMode: 'contentType+domain' };
    }

    const fallback = active.find(e =>
        e.isDefault &&
        (!contentType || e.contentType === contentType)
    );
    if (fallback) return { entry: fallback, resolutionMode: 'default' };

    return null;
}

function getValidationReport() {
    return _validationReport;
}

function getStatus() {
    return {
        lastSyncAt: _lastSyncAt ? new Date(_lastSyncAt).toISOString() : null,
        sourceRef: _lastSourceRef,
        sourceRepo: `${REPO_OWNER}/${REPO_NAME}`,
        sourceBranch: KNOWBASE_BRANCH,
        cookbookDir: COOKBOOK_DIR,
        cacheTtlMs: CACHE_TTL_MS,
        entryCount: Object.keys(_registry).length,
        htmlCount: Object.keys(_html).length,
        validation: _validationReport
    };
}

module.exports = {
    syncCookbook,
    refreshIfStale,
    invalidateCache,
    listEntries,
    getEntry,
    getHtml,
    resolve,
    getValidationReport,
    getStatus,
    REQUIRED_FIELDS,
    VALID_STATUSES
};
