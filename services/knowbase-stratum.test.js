// Unit tests for the knowledge-stratum (practice-wisdom) integration:
// stratum derivation, surfaceability gating, and context-envelope labeling.
// Pure/no-network. Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    deriveStratum,
    isSurfaceable,
    formatDocumentsAsContext
} = require('./knowbase-loader');

test('deriveStratum: knowledge-catalogs path → knowledge', () => {
    assert.equal(deriveStratum('knowledge-catalogs/documentation-craft/isp-writing-guide.md', null), 'knowledge');
});

test('deriveStratum: explicit practice-wisdom authority → knowledge (any path)', () => {
    assert.equal(deriveStratum('somewhere/else.md', 'practice-wisdom'), 'knowledge');
});

test('deriveStratum: cookbook/playbook path → playbook', () => {
    assert.equal(deriveStratum('cookbook/forms/x.md', null), 'playbook');
    assert.equal(deriveStratum('some/playbook/thing.md', null), 'playbook');
});

test('deriveStratum: everything else → policy', () => {
    assert.equal(deriveStratum('policies-procedures/Policy/FC3-01.md', null), 'policy');
    assert.equal(deriveStratum('regulatory-references/tac-749.md', null), 'policy');
});

test('isSurfaceable: policy doc surfaces by default', () => {
    assert.equal(isSurfaceable({ stratum: 'policy', listed: true, status: null }), true);
    assert.equal(isSurfaceable({ stratum: 'policy', listed: true, status: 'active' }), true);
});

test('isSurfaceable: listed:false and hidden statuses never surface', () => {
    assert.equal(isSurfaceable({ stratum: 'policy', listed: false }), false);
    assert.equal(isSurfaceable({ stratum: 'policy', listed: true, status: 'superseded' }), false);
});

test('isSurfaceable: knowledge entry surfaces ONLY when practice-wisdom AND active', () => {
    const base = { stratum: 'knowledge', listed: true, authority: 'practice-wisdom' };
    assert.equal(isSurfaceable({ ...base, status: 'active' }), true, 'active practice-wisdom surfaces');
    assert.equal(isSurfaceable({ ...base, status: 'reviewed' }), false, 'reviewed is excluded');
    assert.equal(isSurfaceable({ ...base, status: 'draft' }), false, 'draft is excluded');
    assert.equal(isSurfaceable({ ...base, status: null }), false, 'missing status is excluded');
    assert.equal(
        isSurfaceable({ stratum: 'knowledge', listed: true, authority: null, status: 'active' }),
        false,
        'active but not practice-wisdom is excluded'
    );
});

test('formatDocumentsAsContext: knowledge doc carries stratum, citation slug, contributors', () => {
    const docs = {
        'knowledge-catalogs/documentation-craft/isp-writing-guide.md': {
            content: 'Body text.',
            category: 'knowledge',
            stratum: 'knowledge',
            topic: 'isp-writing-guide',
            contributors: ['Program Director', 'Jane Doe, Case Manager']
        }
    };
    const out = formatDocumentsAsContext(docs);
    assert.match(out, /Stratum: knowledge/);
    assert.match(out, /\[knowledge: isp-writing-guide\]/);
    assert.match(out, /NON-BINDING/);
    assert.match(out, /Contributors: Program Director; Jane Doe, Case Manager/);
});

test('formatDocumentsAsContext: policy doc is labeled policy stratum, no knowledge lines', () => {
    const docs = {
        'policies-procedures/Policy/FC3-01.md': {
            content: 'Policy body.',
            category: 'policy',
            stratum: 'policy'
        }
    };
    const out = formatDocumentsAsContext(docs);
    assert.match(out, /Stratum: policy/);
    assert.doesNotMatch(out, /\[knowledge:/);
    assert.doesNotMatch(out, /Contributors:/);
});
