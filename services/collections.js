// services/collections.js
// Compiles aggregated collections (manuals / handbooks / curated sets) from the
// knowbase. The SET of collections is defined by the registry
// (collections/collections.json); membership is resolved two ways
// (knowbase CLAUDE.md §6):
//   Pull  — a markdown asset self-declares `collections:` in its frontmatter.
//   Push  — a collection lists `resources[]` directly in the registry (for
//           non-markdown assets that can't carry frontmatter).
// Nothing here is hardcoded — it all derives from the registry + frontmatter.
const {
    getCollectionsRegistry,
    getAllDocuments,
    getDocument,
    isSurfaceable
} = require('./knowbase-loader');
const { accessForDoc } = require('../utils/access');
const PM = require('./policy-manual');

const DEFAULT_CATEGORY = 'General';

/** Encode a repo-relative path for the /public/files route (per segment). */
function encodeRepoPath(p) {
    return String(p || '').split('/').map(encodeURIComponent).join('/');
}

function basenameNoExt(p) {
    return String(p || '').split('/').pop().replace(/\.[^.]+$/, '');
}

/** Map a collection audience to a default access tier. */
function audienceToAccess(audience) {
    return /public/i.test(String(audience || '')) ? 'public' : 'staff';
}

/** The access tier for a whole collection (registry override else audience). */
function collectionAccess(c) {
    return (c && c.access) || audienceToAccess(c && c.audience);
}

/** Normalize a frontmatter `collections:` value into {code, category, order}[]. */
function normalizeMembership(value) {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.map((entry) => {
        if (typeof entry === 'string') return { code: entry, category: null, order: null };
        if (entry && typeof entry === 'object') {
            return { code: entry.code, category: entry.category || null, order: entry.order ?? null };
        }
        return null;
    }).filter((e) => e && e.code);
}

/** Build the link target for a member. */
function hrefForMember({ path, ref, type }) {
    const target = ref || path;
    if (/^https?:\/\//i.test(String(target))) return { href: target, external: true };
    if (type === 'cookbook') return { href: `/site-index/cookbook/${basenameNoExt(target)}`, external: false };
    if (path) return { href: `/public/documents/${PM.pathToSlug(path)}`, external: false };
    return { href: `/public/files/${encodeRepoPath(target)}`, external: false };
}

/** Human label for a member type pill. */
const TYPE_LABEL = {
    document: 'Document', markdown: 'Document', pdf: 'PDF',
    html: 'Guide', link: 'Link', cookbook: 'Guide'
};
function typeLabel(type) {
    return TYPE_LABEL[String(type || '').toLowerCase()] || 'Document';
}

/** Resolve the flat member list for a collection code (pull + push). */
function membersFor(collection) {
    const code = String(collection.code).toUpperCase();
    const inherit = collectionAccess(collection);
    const members = [];

    // Pull: markdown docs that self-declare membership in their frontmatter.
    for (const [docPath, doc] of Object.entries(getAllDocuments())) {
        if (!isSurfaceable(doc)) continue;
        const memberships = normalizeMembership(doc.collections);
        const hit = memberships.find((m) => String(m.code).toUpperCase() === code);
        if (!hit) continue;
        const link = hrefForMember({ path: docPath, type: 'document' });
        members.push({
            path: docPath,
            title: doc.frontTitle || basenameNoExt(docPath),
            type: 'Document',
            category: hit.category || DEFAULT_CATEGORY,
            order: hit.order,
            access: doc.access || inherit,
            date: null,
            href: link.href,
            external: link.external
        });
    }

    // Push: registry resources (non-markdown assets and one-offs).
    for (const r of (collection.resources || [])) {
        const ref = r.ref;
        if (!ref) continue;
        const isMd = /\.md$/i.test(ref) && !/^https?:\/\//i.test(ref);
        if (isMd) {
            const doc = getDocument(ref);
            if (doc && !isSurfaceable(doc)) continue; // honor exclusions for md
        }
        const link = hrefForMember({ ref, path: isMd ? ref : null, type: r.type });
        members.push({
            path: isMd ? ref : null,
            title: r.title || basenameNoExt(ref),
            type: typeLabel(r.type),
            category: r.category || DEFAULT_CATEGORY,
            order: r.order ?? null,
            access: r.access || inherit,
            date: r.date || null,
            href: link.href,
            external: link.external
        });
    }

    return members;
}

/** Group members by their free-form category, sorted sensibly. */
function groupMembers(members) {
    const groups = new Map();
    for (const m of members) {
        const cat = m.category || DEFAULT_CATEGORY;
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(m);
    }
    const minOrder = (items) => items.reduce((min, m) =>
        (m.order != null && m.order < min) ? m.order : min, Infinity);
    return [...groups.entries()]
        .map(([category, items]) => ({
            category,
            _order: minOrder(items),
            items: items.sort((a, b) => {
                const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
                if (ao !== bo) return ao - bo;
                return String(a.title).localeCompare(String(b.title));
            })
        }))
        .sort((a, b) => {
            if (a._order !== b._order) return a._order - b._order;
            return a.category.localeCompare(b.category);
        })
        .map(({ category, items }) => ({ category, items }));
}

function findCollection(code) {
    const reg = getCollectionsRegistry();
    if (!reg || !Array.isArray(reg.collections)) return null;
    const want = String(code || '').toUpperCase();
    return reg.collections.find((c) => String(c.code).toUpperCase() === want) || null;
}

/**
 * List every collection in the registry (with a compiled member count).
 * @returns {Array<{code,title,description,type,url,access,resourceCount}>}
 */
function listCollections() {
    const reg = getCollectionsRegistry();
    if (!reg || !Array.isArray(reg.collections)) return [];
    return reg.collections
        .map((c) => ({
            code: c.code,
            title: c.title || c.code,
            description: c.description || '',
            type: c.type || 'collection',
            url: `/collections/${encodeURIComponent(c.code)}`,
            access: collectionAccess(c),
            order: c.order ?? null,
            resourceCount: membersFor(c).length
        }))
        .sort((a, b) => {
            const ao = a.order ?? Infinity, bo = b.order ?? Infinity;
            if (ao !== bo) return ao - bo;
            return String(a.title).localeCompare(String(b.title));
        });
}

/**
 * Compile a single collection into a grouped model.
 * @param {string} code
 * @returns {null|{code,title,type,description,access,isReviewAssets,groups}}
 */
function compileCollection(code) {
    const c = findCollection(code);
    if (!c) return null;
    const members = membersFor(c);
    return {
        code: c.code,
        title: c.title || c.code,
        type: c.type || 'collection',
        description: c.description || '',
        access: collectionAccess(c),
        // CRA = Compliance Review Assets: registry-populated, every entry dated.
        isReviewAssets: String(c.code).toUpperCase() === 'CRA',
        groups: groupMembers(members)
    };
}

module.exports = { listCollections, compileCollection };
