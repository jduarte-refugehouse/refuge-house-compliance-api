// utils/access.js
// Single place that decides a document's access tier from its frontmatter.
// The knowbase contract (knowbase CLAUDE.md §9): access ∈ { public | reviewer | staff };
// absent ⇒ staff. Nothing is public unless it explicitly declares access: public.
//
// `doc` here is a knowbase-loader document object, which (after the loader's
// frontmatter parse) carries `doc.access` lifted from its YAML frontmatter.

const ACCESS_TIERS = ['public', 'reviewer', 'staff'];

/**
 * Normalize an access value to a known tier, defaulting to the most restrictive
 * sensible default ('staff') for anything missing or unrecognized.
 * @param {string} [value]
 * @returns {'public'|'reviewer'|'staff'}
 */
function normalizeAccess(value) {
    const v = String(value || '').trim().toLowerCase();
    return ACCESS_TIERS.includes(v) ? v : 'staff';
}

/**
 * The access tier required to view a document.
 * @param {{access?: string}|null|undefined} doc - knowbase document object
 * @returns {'public'|'reviewer'|'staff'}
 */
function accessForDoc(doc) {
    return normalizeAccess(doc && doc.access);
}

module.exports = { ACCESS_TIERS, normalizeAccess, accessForDoc };
