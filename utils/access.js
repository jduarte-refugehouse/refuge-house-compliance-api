// utils/access.js
// Per-resource access tiers for the human-facing surfaces.
//
// Three tiers, least to most restrictive:
//   public   - served to anyone
//   reviewer - staff (Entra) OR a valid rolling reviewer key
//   staff    - staff (Entra) only
//
// Markdown documents carry their tier in YAML frontmatter (`access:`) in the
// knowbase, so permissions travel with the document on publish. Anything WITHOUT
// an explicit, valid tier defaults to `staff` (fail-closed) — the most
// restrictive option, so a newly added/untagged doc is never exposed by accident.

const ACCESS_TIERS = ['public', 'reviewer', 'staff'];
// Default for any asset missing (or carrying an invalid) access value.
const DEFAULT_DOC_ACCESS = 'staff';
const TIER_RANK = { public: 0, reviewer: 1, staff: 2 };

function normalizeAccess(value) {
    if (typeof value !== 'string') return DEFAULT_DOC_ACCESS;
    const v = value.trim().toLowerCase();
    return ACCESS_TIERS.includes(v) ? v : DEFAULT_DOC_ACCESS;
}

/**
 * Access tier for a knowbase markdown document (read from parsed frontmatter and
 * stored on the cached doc as `access`).
 */
function accessForDoc(doc) {
    return normalizeAccess(doc && doc.access);
}

// Binary files (PDF/PNG/DOCX/etc.) streamed via /public/files have no frontmatter
// to carry a tier. They are already restricted to a curated allowlist of
// shareable directories (see routes/public-files.js), so we open those
// directories to the reviewer tier here and treat anything else as staff-only.
// Most-specific prefixes should come first; first match wins.
const FILE_ACCESS_PREFIXES = [
    ['regulatory-references/', 'reviewer'],
    ['plans/', 'reviewer'],
    ['temporary-reference/', 'reviewer'],
    ['forms/', 'reviewer'],
    ['generated-pdf/', 'reviewer'],
    ['policies-procedures/', 'reviewer'],
    ['personnel-hr/', 'reviewer']
];

function accessForFilePath(repoPath) {
    const p = String(repoPath || '');
    for (const [prefix, tier] of FILE_ACCESS_PREFIXES) {
        if (p.startsWith(prefix)) return tier;
    }
    return DEFAULT_DOC_ACCESS;
}

/**
 * Decide whether a caller may access a resource of the given required tier.
 * @param {string} requiredTier - 'public' | 'reviewer' | 'staff'
 * @param {{isStaff?: boolean, isReviewer?: boolean}} caller
 */
function canAccess(requiredTier, caller) {
    const tier = normalizeAccess(requiredTier);
    if (tier === 'public') return true;
    if (!caller) return false;
    if (caller.isStaff) return true; // staff (Entra) can see everything
    if (tier === 'reviewer') return Boolean(caller.isReviewer);
    return false; // staff tier, caller is not staff
}

module.exports = {
    ACCESS_TIERS,
    DEFAULT_DOC_ACCESS,
    TIER_RANK,
    FILE_ACCESS_PREFIXES,
    normalizeAccess,
    accessForDoc,
    accessForFilePath,
    canAccess
};
