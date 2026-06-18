// services/collections.js
// Compiles document "collections" (manuals / handbooks / compiled sets) from the
// knowbase collections registry (collections/collections.json) plus per-doc
// frontmatter. The registry is the single source of truth for the SET of
// collections; nothing about the collection set is hardcoded here.
//
// Two membership channels (both honored):
//   - pull:  a markdown doc self-declares membership via its `collections`
//            frontmatter (already normalized by the loader to
//            [{ code, category?, order? }]).
//   - push:  a collection's `resources[]` in the registry includes assets
//            directly (HTML guides, PDFs, links, cookbook entries, or one-off
//            markdown) that can't carry frontmatter.
//
// Non-surfaceable members (listed:false / superseded / retired / deprecated /
// archived) are dropped, the same as from the site index. Access is resolved
// per item (its own access, else the collection's audience); the route gates
// each item by the caller's tier.

const {
    getCollectionsRegistry,
    getAllDocuments,
    getDocument,
    isSurfaceable
} = require('./knowbase-loader');
const { normalizeAccess, accessForDoc } = require('../utils/access');

const DEFAULT_CATEGORY = 'General';

function pathToSlug(docPath) {
    const basename = String(docPath || '').split('/').pop().replace(/\.md$/i, '');
    return basename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function titleFromPath(docPath) {
    return String(docPath || '').split('/').pop().replace(/\.md$/i, '');
}

// The collection's audience is free-form (e.g. "staff", "foster/adoptive
// caregivers"); map it to an access tier, defaulting fail-closed to staff.
function audienceTier(collection) {
    return normalizeAccess(collection && collection.audience);
}

/**
 * Resolve a registry resource ref to a browsable href.
 *   markdown ⇒ /public/documents/<slug>
 *   pdf|html|binary ⇒ /public/files/<repo-path>
 *   link (or absolute URL) ⇒ the URL
 *   cookbook ⇒ /site-index/cookbook/<slug>
 */
function resolveRef(resource) {
    const ref = String((resource && resource.ref) || '').trim();
    const type = String((resource && resource.type) || '').trim().toLowerCase();

    if (type === 'link' || /^https?:\/\//i.test(ref)) {
        return { href: ref, external: true, kind: 'link' };
    }
    if (type === 'cookbook') {
        return { href: `/site-index/cookbook/${ref}`, external: false, kind: 'cookbook' };
    }
    if (type === 'markdown' || /\.md$/i.test(ref)) {
        return { href: `/public/documents/${pathToSlug(ref)}`, external: false, kind: 'markdown' };
    }
    // pdf | html | docx | png | any other binary streamed from the knowbase
    return { href: `/public/files/${ref}`, external: false, kind: type || 'file' };
}

/**
 * The list of collections from the registry, sorted by `order` then title, each
 * annotated with its resolved access tier and a stable URL.
 */
function listCollections() {
    const registry = getCollectionsRegistry();
    if (!registry || !Array.isArray(registry.collections)) return [];
    return registry.collections
        .map((c) => ({
            code: c.code,
            title: c.title || c.code,
            description: c.description || '',
            type: c.type || 'collection',
            audience: c.audience || null,
            access: audienceTier(c),
            order: typeof c.order === 'number' ? c.order : null,
            resourceCount: Array.isArray(c.resources) ? c.resources.length : 0,
            url: `/collections/${encodeURIComponent(c.code)}`
        }))
        .sort((a, b) => {
            const ao = a.order == null ? Infinity : a.order;
            const bo = b.order == null ? Infinity : b.order;
            if (ao !== bo) return ao - bo;
            return a.title.localeCompare(b.title);
        });
}

function findCollection(code) {
    const registry = getCollectionsRegistry();
    if (!registry || !Array.isArray(registry.collections)) return null;
    const want = String(code || '').trim().toLowerCase();
    return registry.collections.find((c) => String(c.code || '').toLowerCase() === want) || null;
}

// Pull members: docs whose frontmatter `collections` includes this code.
function pulledMembers(collection) {
    const code = String(collection.code || '').toLowerCase();
    const tier = audienceTier(collection);
    const out = [];
    for (const [docPath, doc] of Object.entries(getAllDocuments())) {
        if (!doc || !Array.isArray(doc.collections) || !doc.collections.length) continue;
        const membership = doc.collections.find((m) => String(m.code || '').toLowerCase() === code);
        if (!membership) continue;
        if (!isSurfaceable(doc)) continue; // exclusion: hidden lifecycle / unlisted
        out.push({
            title: doc.frontTitle || titleFromPath(docPath),
            category: membership.category || null,
            order: typeof membership.order === 'number' ? membership.order : null,
            date: null,
            type: 'markdown',
            href: `/public/documents/${pathToSlug(docPath)}`,
            external: false,
            access: accessForDoc(doc) || tier,
            path: docPath,
            source: 'pull'
        });
    }
    return out;
}

// Push members: assets included directly via the collection's resources[].
function pushedMembers(collection) {
    const tier = audienceTier(collection);
    const resources = Array.isArray(collection.resources) ? collection.resources : [];
    const out = [];
    for (const r of resources) {
        const resolved = resolveRef(r);
        // If a pushed resource points at a markdown doc, honor the same exclusion
        // and inherit the doc's own access when no override is given.
        let access = r.access ? normalizeAccess(r.access) : tier;
        if (resolved.kind === 'markdown') {
            const repoPath = String(r.ref || '');
            const doc = getDocument(repoPath);
            if (doc) {
                if (!isSurfaceable(doc)) continue;
                if (!r.access) access = accessForDoc(doc) || tier;
            }
        }
        out.push({
            title: r.title || resolved.href,
            category: r.category || null,
            order: typeof r.order === 'number' ? r.order : null,
            date: r.date || null,
            type: (r.type || resolved.kind || 'file').toLowerCase(),
            href: resolved.href,
            external: Boolean(resolved.external),
            access,
            path: resolved.external ? null : String(r.ref || ''),
            source: 'push'
        });
    }
    return out;
}

/**
 * Compile a single collection by code: gather pull + push members, drop
 * non-surfaceable ones, and group by free-form category. Returns null if the
 * code is not defined in the registry.
 *
 * Sorting:
 *   - review-assets collections: newest first by `date` (YYYY-MM); undated last.
 *   - everything else: `order` (asc, undefined last) then title.
 */
function compileCollection(code) {
    const collection = findCollection(code);
    if (!collection) return null;

    const isReviewAssets = String(collection.type || '').toLowerCase() === 'review-assets';
    const members = [...pulledMembers(collection), ...pushedMembers(collection)];

    // Group by free-form category; uncategorized ⇒ default group.
    const groupMap = new Map();
    for (const m of members) {
        const cat = (m.category && String(m.category).trim()) || DEFAULT_CATEGORY;
        if (!groupMap.has(cat)) groupMap.set(cat, []);
        groupMap.get(cat).push(m);
    }

    const byDateDesc = (a, b) => {
        const ad = a.date || '';
        const bd = b.date || '';
        if (ad && bd && ad !== bd) return bd.localeCompare(ad);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return a.title.localeCompare(b.title);
    };
    const byOrderThenTitle = (a, b) => {
        const ao = a.order == null ? Infinity : a.order;
        const bo = b.order == null ? Infinity : b.order;
        if (ao !== bo) return ao - bo;
        return a.title.localeCompare(b.title);
    };

    const groups = [...groupMap.entries()].map(([category, items]) => {
        items.sort(isReviewAssets ? byDateDesc : byOrderThenTitle);
        return { category, items };
    });

    // Group order: default group last, otherwise alphabetical. For review-assets,
    // order groups by their newest entry (newest first).
    groups.sort((a, b) => {
        if (a.category === DEFAULT_CATEGORY) return 1;
        if (b.category === DEFAULT_CATEGORY) return -1;
        if (isReviewAssets) {
            const an = a.items[0] && a.items[0].date || '';
            const bn = b.items[0] && b.items[0].date || '';
            if (an !== bn) return bn.localeCompare(an);
        }
        return a.category.localeCompare(b.category);
    });

    return {
        code: collection.code,
        title: collection.title || collection.code,
        description: collection.description || '',
        type: collection.type || 'collection',
        audience: collection.audience || null,
        access: audienceTier(collection),
        isReviewAssets,
        groups,
        counts: {
            members: members.length,
            groups: groups.length
        }
    };
}

module.exports = {
    listCollections,
    compileCollection,
    findCollection,
    audienceTier,
    resolveRef
};
