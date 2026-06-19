// services/policy-manual.js
// Compiles the knowbase policies/procedures into the "Policies & Procedures
// Workspace" model: each policy paired with its companion procedure(s), with the
// CQI signal (owner, review due/overdue, reconciliation) lifted from frontmatter.
//
// Data source of truth is the knowbase: pairing keys come from the document body
// table (POLICY NUMBER / PROCEDURE NUMBER / RELATED POLICY); the CQI fields come
// from YAML frontmatter (review:, reconciliation:) parsed by knowbase-loader.
const { isSurfaceable } = require('./knowbase-loader');

const PP_PREFIX = 'policies-procedures/';
// "Due soon" window for the §749 annual review CQI signal.
const DUE_SOON_DAYS = 90;

function pathToSlug(docPath) {
    const basename = String(docPath || '').split('/').pop().replace(/\.md$/i, '');
    return basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function titleFromPath(docPath) {
    return String(docPath || '').split('/').pop().replace(/\.md$/i, '');
}

/**
 * Classify a knowbase path into a manual document kind.
 * @returns {'policy'|'procedure'|'combined'|null}
 */
function kindForPath(docPath) {
    const p = String(docPath || '');
    if (p.startsWith(PP_PREFIX + 'Policy/')) return 'policy';
    if (p.startsWith(PP_PREFIX + 'Procedure/')) return 'procedure';
    if (p.startsWith(PP_PREFIX + 'Policy-and-Procedure/')) return 'combined';
    if (p.startsWith(PP_PREFIX + 'Package-Specific/')) return 'combined';
    return null;
}

/** Strip a trailing "Policy"/"Procedure"/"Policy and Procedure" from a title. */
function stripKindSuffix(title) {
    return String(title || '')
        .replace(/\s+(Policy\s*(?:and|&)\s*Procedure|Policy|Procedure)\s*$/i, '')
        .trim();
}

/** A normalized topic key from a title (kind suffix removed). */
function titleKey(title) {
    return stripKindSuffix(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Strip a trailing ".N" companion suffix from a code (FC2-01.1 -> FC2-01). */
function baseCode(code) {
    return String(code || '').trim().replace(/\.\d+$/, '').toUpperCase();
}

/**
 * Parse the document's info table (the `| **KEY** | VALUE |` rows at the top).
 * @param {string} content - markdown body (frontmatter already stripped)
 * @returns {{number?:string,name?:string,relatedPolicy?:string,effectiveDate?:string,revisionDate?:string,lastUpdated?:string}}
 */
function parseDocMeta(content) {
    const meta = {};
    const re = /\|\s*\*\*([^*|]+?)\*\*\s*\|\s*([^|]*?)\s*\|/g;
    let m;
    while ((m = re.exec(String(content || ''))) !== null) {
        const key = m[1].trim().toUpperCase();
        const val = m[2].trim();
        if (!val) continue;
        if (/NUMBER$/.test(key)) { if (!meta.number) meta.number = val; }
        else if (/NAME$/.test(key)) { if (!meta.name) meta.name = val; }
        else if (key === 'RELATED POLICY') { meta.relatedPolicy = val; }
        else if (key === 'EFFECTIVE DATE') { meta.effectiveDate = val; }
        else if (key === 'REVISION DATE') { meta.revisionDate = val; }
        else if (key === 'LAST UPDATED') { meta.lastUpdated = val; }
    }
    return meta;
}

function parseDate(value) {
    if (!value) return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
}

/** Derive the review CQI state from a frontmatter review block. */
function reviewStateFrom(review) {
    const due = parseDate(review && review.nextReviewDue);
    if (!due) return 'unknown';
    const days = (due.getTime() - Date.now()) / 86400000;
    if (days < 0) return 'overdue';
    if (days <= DUE_SOON_DAYS) return 'due-soon';
    return 'ok';
}

/**
 * Extract the CQI metadata for a document from its (frontmatter-bearing) doc
 * object plus its parsed body meta. Shape matches what the manual/collections
 * cell renderers consume.
 */
function extractCqiMeta(doc, meta) {
    const fmReview = (doc && doc.review) || null;
    const review = fmReview ? {
        nextReviewDue: fmReview.nextReviewDue || null,
        lastReviewed: fmReview.lastReviewed || null,
        cycle: fmReview.cycle || null
    } : null;
    const owner = (fmReview && fmReview.owner) || null;
    const fmRecon = (doc && doc.reconciliation) || null;
    const reconciliation = fmRecon ? {
        status: fmRecon.status || null,
        note: fmRecon.note || null
    } : null;
    const reviewState = reviewStateFrom(fmReview);
    return {
        owner,
        review,
        reviewState,
        reconciliation,
        nextReviewDue: review && review.nextReviewDue,
        lastReviewed: review && review.lastReviewed,
        reconciledStatus: reconciliation && reconciliation.status
    };
}

/** Build a manual item (a single doc) from a knowbase entry. */
function toItem(docPath, doc) {
    const meta = parseDocMeta(doc.content);
    const cqi = extractCqiMeta(doc, meta);
    return {
        path: docPath,
        slug: pathToSlug(docPath),
        kind: kindForPath(docPath),
        code: meta.number || '',
        title: doc.frontTitle || meta.name || titleFromPath(docPath),
        excerpt: '',
        owner: cqi.owner,
        department: null,
        relatedPolicy: meta.relatedPolicy || '',
        review: cqi.review,
        reviewState: cqi.reviewState,
        reconciliation: cqi.reconciliation
    };
}

/** The pairing key that groups a policy with its companion procedure(s). */
function keyForItem(it) {
    if (it.kind === 'procedure' && it.relatedPolicy) {
        const m = String(it.relatedPolicy).match(/^([A-Za-z0-9-]+)/);
        if (m) return baseCode(m[1]);
    }
    if (it.code) return baseCode(it.code);
    return titleKey(it.title);
}

/** Group policy/procedure/combined items into paired topics. */
function pairTopics(items) {
    const map = new Map();
    const topicFor = (key) => {
        if (!map.has(key)) {
            map.set(key, {
                code: '', title: '', excerpt: '', department: null, owner: null,
                policy: null, procedures: [], combined: [],
                review: null, reviewState: 'unknown', reconciliation: null
            });
        }
        return map.get(key);
    };
    for (const it of items) {
        const topic = topicFor(keyForItem(it));
        if (it.kind === 'policy') { topic.policy = it; if (it.code && !topic.code) topic.code = baseCode(it.code); }
        else if (it.kind === 'procedure') { topic.procedures.push(it); }
        else { topic.combined.push(it); if (it.code && !topic.code) topic.code = baseCode(it.code); }
    }
    return [...map.values()].map((t) => {
        const lead = t.policy || t.combined[0] || t.procedures[0] || {};
        t.code = t.code || baseCode(lead.code) || '';
        t.title = stripKindSuffix(lead.title || '') || lead.title || '';
        t.owner = lead.owner || null;
        t.department = lead.department || null;
        t.review = lead.review || null;
        t.reviewState = lead.reviewState || 'unknown';
        t.reconciliation = lead.reconciliation || null;
        return t;
    }).sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, undefined, { numeric: true }));
}

/**
 * Build the full manual model.
 * @param {object} allDocs - getAllDocuments() map
 * @param {(docPath:string, doc:object)=>boolean} isVisible - access gate
 * @param {(doc:object)=>string} [accessForDocFn] - unused here; kept for signature parity
 * @returns {{sections:Array, counts:object}}
 */
function buildManual(allDocs, isVisible, accessForDocFn) {
    const visible = typeof isVisible === 'function' ? isVisible : () => true;
    const entries = Object.entries(allDocs || {})
        .filter(([p]) => p.startsWith(PP_PREFIX) && p.toLowerCase().endsWith('.md'))
        .filter(([p, doc]) => isSurfaceable(doc) && visible(p, doc));

    const items = entries.map(([p, doc]) => toItem(p, doc));

    const mainItems = items.filter((i) =>
        i.path.startsWith(PP_PREFIX + 'Policy/') ||
        i.path.startsWith(PP_PREFIX + 'Procedure/') ||
        i.path.startsWith(PP_PREFIX + 'Policy-and-Procedure/'));
    const pkgItems = items
        .filter((i) => i.path.startsWith(PP_PREFIX + 'Package-Specific/'))
        .sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, undefined, { numeric: true }));

    const topics = pairTopics(mainItems);

    const sections = [{ id: 'policies-procedures', title: 'Policies & Procedures', kind: 'paired', topics }];
    if (pkgItems.length) {
        sections.push({ id: 'package-specific', title: 'Package-Specific Snapshots', kind: 'docs', docs: pkgItems });
    }

    const counts = {
        topics: topics.length,
        paired: topics.filter((t) => t.policy && (t.procedures.length || t.combined.length)).length,
        policies: mainItems.filter((i) => i.kind === 'policy').length,
        procedures: mainItems.filter((i) => i.kind === 'procedure').length,
        reviewOverdue: items.filter((i) => i.reviewState === 'overdue').length,
        reviewDueSoon: items.filter((i) => i.reviewState === 'due-soon').length
    };

    return { sections, counts };
}

module.exports = {
    buildManual,
    kindForPath,
    parseDocMeta,
    extractCqiMeta,
    titleKey,
    stripKindSuffix,
    pathToSlug
};
