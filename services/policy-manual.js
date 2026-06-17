// services/policy-manual.js
// Builds a dynamic Policies & Procedures "manual" model from the synced
// knowbase. It parses the metadata table that each policy/procedure carries
// at the top (POLICY NUMBER, PROCEDURE NUMBER, RELATED POLICY, TITLE, ...),
// pulls a short PURPOSE excerpt, and aligns each policy with its companion
// procedure(s) by document number so the workspace can render them together.
//
// Nothing here is hardcoded to specific documents: new files dropped into the
// knowbase are cataloged automatically on the next sync.

function pathToSlug(docPath) {
    const basename = String(docPath || '').split('/').pop().replace(/\.md$/i, '');
    return basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function filenameTitle(docPath) {
    return String(docPath || '').split('/').pop().replace(/\.md$/i, '');
}

// Grab the first contiguous markdown table at the top of the document — that is
// the "Policy Information / Details" (or Procedure Information) block — and
// return its rows as a key/value map.
function parseInfoTable(content) {
    const lines = String(content || '').split('\n');
    let i = 0;
    while (i < lines.length && !/^\s*\|/.test(lines[i])) i++;
    const meta = {};
    for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 2) continue;
        const key = cells[0].replace(/\*/g, '').trim().toUpperCase();
        const val = cells[1].replace(/\*/g, '').trim();
        if (!key || /^:?-+:?$/.test(key)) continue; // separator / alignment row
        if (key === 'POLICY INFORMATION' || key === 'PROCEDURE INFORMATION') continue; // header row
        if (!(key in meta)) meta[key] = val;
    }
    return meta;
}

// Filenames are often slugs ("RH-Staff-Roster") or carry underscores. Turn
// them into readable titles. Files that already contain spaces (e.g. package
// snapshots that start with a code) keep their hyphens so codes stay intact.
function humanizeName(value) {
    let s = String(value || '');
    const hasSpace = /\s/.test(s);
    s = s.replace(/_+/g, ' ');
    if (!hasSpace) s = s.replace(/-+/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
}

// Drop a trailing "Policy" / "Procedure" so a topic reads as a subject.
function stripKindSuffix(title) {
    return String(title || '').replace(/\s+(policy and procedure|policy|procedures?|policies)\s*$/i, '').trim();
}

function stripMarkdown(text) {
    return String(text || '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> label
        .replace(/[*_`#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(text, max = 240) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '') + '\u2026';
}

// Pull the first paragraph under a PURPOSE / OVERVIEW heading as the excerpt,
// falling back to the first real paragraph of prose.
const EXCERPT_JUNK = /^(companion to|last updated|version|status|effective date|review date|revision date|department|approved by|policy number|procedure number|policy title|procedure title|related policy)\b/i;

function extractExcerpt(content) {
    let lines = String(content || '').split('\n');
    // Drop a YAML frontmatter block if present.
    if (lines[0] && lines[0].trim() === '---') {
        const end = lines.indexOf('---', 1);
        if (end !== -1) lines = lines.slice(end + 1);
    }

    let start = lines.findIndex((l) => /^#{1,4}\s+.*\bpurpose\b/i.test(l));
    if (start === -1) start = lines.findIndex((l) => /^#{1,4}\s+.*\boverview\b/i.test(l));

    const collect = (from) => {
        const buf = [];
        for (let j = from; j < lines.length; j++) {
            const l = lines[j];
            if (/^#{1,6}\s+/.test(l)) break;
            if (/^\s*\|/.test(l)) continue;
            if (l.trim() === '') { if (buf.length) break; else continue; }
            buf.push(l.trim());
        }
        return buf.join(' ');
    };

    let text = start !== -1 ? collect(start + 1) : '';
    if (!text) {
        for (const l of lines) {
            const s = l.trim();
            if (!s) continue;
            if (/^#{1,6}\s/.test(l) || /^\s*\|/.test(l)) continue;
            if (/^[-*_]{2,}$/.test(s) || s === '---') continue; // dividers / frontmatter fences
            if (EXCERPT_JUNK.test(s)) continue;
            text = s;
            break;
        }
    }
    return truncate(stripMarkdown(text));
}

function kindForPath(docPath) {
    const p = String(docPath || '');
    if (p.startsWith('policies-procedures/Policy/')) return 'policy';
    if (p.startsWith('policies-procedures/Procedure/')) return 'procedure';
    if (p.startsWith('policies-procedures/Policy-and-Procedure/')) return 'combined';
    if (p.startsWith('policies-procedures/Package-Specific/')) return 'package';
    if (p.startsWith('personnel-hr/')) return 'personnel';
    if (p.startsWith('plans/')) return 'plan';
    return null;
}

function normalizeCode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// "FC-04 Crisis Management Policy" -> "FC-04"; "FC-OC-01.1" -> "FC-OC-01".
function leadingCode(value) {
    const m = String(value || '').match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)/i);
    return m ? normalizeCode(m[1]) : '';
}
function policyBaseOfProcedureNumber(num) {
    return normalizeCode(String(num || '').replace(/\.\d+$/, ''));
}

function titleKey(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/\b(policy and procedure|policy|procedure|procedures)\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function docRef(docPath, doc, meta, accessFor) {
    return {
        path: docPath,
        slug: pathToSlug(docPath),
        title: meta.title || humanizeName(filenameTitle(docPath)),
        number: meta.number || '',
        department: meta.department || '',
        excerpt: extractExcerpt(doc.content),
        access: accessFor ? accessFor(doc) : (doc.access || 'public')
    };
}

function parseDocMeta(content) {
    const t = parseInfoTable(content);
    const number = t['POLICY NUMBER'] || t['PROCEDURE NUMBER'] || '';
    const title = t['POLICY TITLE'] || t['PROCEDURE TITLE'] || '';
    return {
        // Some source docs append notes to the number ("FC-BC-01 (PROPOSED ...)").
        // Keep just the clean leading code for badges and pairing.
        number: leadingCode(number) || normalizeCode(number),
        title: title.trim(),
        related: t['RELATED POLICY'] || '',
        department: (t['DEPARTMENT'] || '').trim(),
        effective: t['EFFECTIVE DATE'] || '',
        review: t['REVIEW DATE'] || t['REVISION DATE'] || ''
    };
}

/**
 * Build the manual model.
 * @param {Object} allDocs  map of repoPath -> { content, access, category }
 * @param {Function} isVisible  (docPath, doc) => boolean  (access gating)
 * @param {Function} accessFor  (doc) => tier string  (optional, for labels)
 */
function buildManual(allDocs, isVisible = () => true, accessFor = null) {
    const entries = Object.entries(allDocs || {})
        .filter(([docPath]) => kindForPath(docPath))
        .filter(([docPath, doc]) => isVisible(docPath, doc));

    // ---- Foster Care: pair policies <-> procedures by code into topics. ----
    const topics = new Map();
    const topicFor = (key) => {
        if (!topics.has(key)) {
            topics.set(key, {
                key, code: '', title: '', department: '', excerpt: '',
                policy: null, procedures: [], combined: []
            });
        }
        return topics.get(key);
    };

    const fosterKinds = new Set(['policy', 'procedure', 'combined']);
    for (const [docPath, doc] of entries) {
        const kind = kindForPath(docPath);
        if (!fosterKinds.has(kind)) continue;
        const meta = parseDocMeta(doc.content);
        const ref = docRef(docPath, doc, meta, accessFor);

        let code = '';
        if (kind === 'policy' || kind === 'combined') code = meta.number;
        if (kind === 'procedure') code = leadingCode(meta.related) || policyBaseOfProcedureNumber(meta.number);

        const tkey = titleKey(meta.title || filenameTitle(docPath));
        const key = code || tkey;
        const topic = topicFor(key);
        if (code && !topic.code) topic.code = code;
        if (tkey && !topic.titleKey) topic.titleKey = tkey;

        if (kind === 'policy') topic.policy = ref;
        else if (kind === 'procedure') topic.procedures.push(ref);
        else topic.combined.push(ref);
    }

    // Secondary pairing pass: some procedures cite a policy number that does not
    // match the policy doc's own number. Merge an unpaired topic into another
    // that shares the same normalized title so the subject stays on one card.
    const byTitle = new Map();
    for (const t of topics.values()) {
        if (t.policy && t.titleKey && !byTitle.has(t.titleKey)) byTitle.set(t.titleKey, t);
    }
    for (const [key, t] of [...topics.entries()]) {
        if (t.policy || !t.titleKey) continue; // only fold procedure-only topics
        const target = byTitle.get(t.titleKey);
        if (target && target !== t) {
            target.procedures.push(...t.procedures);
            target.combined.push(...t.combined);
            topics.delete(key);
        }
    }

    // Derive each topic's display fields (prefer the policy's, then combined,
    // then the first procedure).
    const fosterTopics = [...topics.values()].map((t) => {
        const lead = t.policy || t.combined[0] || t.procedures[0] || {};
        const rawTitle = (t.policy && t.policy.title)
            || (t.combined[0] && t.combined[0].title)
            || lead.title || 'Untitled';
        t.title = stripKindSuffix(rawTitle) || rawTitle;
        t.department = lead.department || (t.procedures[0] && t.procedures[0].department) || '';
        t.excerpt = (t.policy && t.policy.excerpt)
            || (t.combined[0] && t.combined[0].excerpt)
            || (t.procedures[0] && t.procedures[0].excerpt) || '';
        t.procedures.sort((a, b) => a.title.localeCompare(b.title));
        return t;
    }).sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, undefined, { numeric: true }));

    // ---- Standalone document sections (each doc is its own card). ----
    const standaloneSection = (kind) => entries
        .filter(([docPath]) => kindForPath(docPath) === kind)
        .map(([docPath, doc]) => {
            const meta = parseDocMeta(doc.content);
            const ref = docRef(docPath, doc, meta, accessFor);
            return { ...ref, code: ref.number };
        })
        .sort((a, b) => a.title.localeCompare(b.title));

    const sections = [
        { id: 'foster-care', title: 'Foster Care Policies & Procedures', kind: 'paired', topics: fosterTopics },
        { id: 'personnel-hr', title: 'Personnel & HR', kind: 'docs', docs: standaloneSection('personnel') },
        { id: 'package-specific', title: 'Package-Specific Services', kind: 'docs', docs: standaloneSection('package') },
        { id: 'plans', title: 'Plans', kind: 'docs', docs: standaloneSection('plan') }
    ].filter((s) => (s.topics && s.topics.length) || (s.docs && s.docs.length));

    const pairedCount = fosterTopics.filter((t) => t.policy && (t.procedures.length || t.combined.length)).length;
    const counts = {
        topics: fosterTopics.length,
        paired: pairedCount,
        policies: fosterTopics.filter((t) => t.policy).length,
        procedures: fosterTopics.reduce((n, t) => n + t.procedures.length + t.combined.length, 0),
        personnel: (sections.find((s) => s.id === 'personnel-hr')?.docs || []).length,
        plans: (sections.find((s) => s.id === 'plans')?.docs || []).length
    };

    return { generatedAt: new Date().toISOString(), sections, counts };
}

module.exports = {
    buildManual,
    // exported for unit-level reuse / testing
    parseInfoTable,
    parseDocMeta,
    extractExcerpt,
    pathToSlug
};
