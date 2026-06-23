// Unit tests for serve-time link rewriting. Run with: npm test
//
// Deterministic base URL so assertions don't depend on the environment.
process.env.PUBLIC_BASE_URL = 'https://compliance.refugehouse.org';
process.env.KNOWBASE_REPO_URL = 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';

const test = require('node:test');
const assert = require('node:assert/strict');

const { rewriteServedLinks } = require('./link-rewrite');

// The serving document and the set of markdown docs the API serves by slug.
const SERVING = 'temporary-reference/fy26-sscc-joint-monitoring/sscc-hipaa-reference-sheet.html';
const DOC_SET = new Set([
    'policies-procedures/Policy/Background Check and Eligibility Policy.md'
]);

test('rewrites a relative markdown policy link to /public/documents/<slug>', () => {
    const html = '<a href="../../policies-procedures/Policy/Background%20Check%20and%20Eligibility%20Policy.md">Background Check</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(
        out,
        /href="https:\/\/compliance\.refugehouse\.org\/public\/documents\/background-check-and-eligibility-policy"/
    );
    assert.equal(out.includes('../'), false);
    assert.equal(out.includes('file://'), false);
});

test('rewrites a relative pdf link to /public/files/<repo-path> (encoded)', () => {
    const html = '<a href="../SSCC/Grievance%20and%20Appeal.pdf">Grievance</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(
        out,
        /href="https:\/\/compliance\.refugehouse\.org\/public\/files\/temporary-reference\/SSCC\/Grievance%20and%20Appeal\.pdf"/
    );
    assert.equal(out.includes('../'), false);
});

test('leaves external links unchanged', () => {
    const html = '<a href="https://txrules.elaws.us/rule/title40_chapter749">Rule 749</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(out, /href="https:\/\/txrules\.elaws\.us\/rule\/title40_chapter749"/);
});

test('leaves in-page anchors unchanged', () => {
    const html = '<a href="#section-2">Jump</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.equal(out, html);
});

test('encodes spaces and preserves parentheses in filenames', () => {
    const html = '<a href="../../forms/foster-parent-agreements/Foster%20Parent%20Agreement%20(Master%20-%20Pulse-signable).html">Agreement</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(
        out,
        /href="https:\/\/compliance\.refugehouse\.org\/public\/files\/forms\/foster-parent-agreements\/Foster%20Parent%20Agreement%20\(Master%20-%20Pulse-signable\)\.html"/
    );
});

test('preserves a fragment on a rewritten markdown link', () => {
    const html = '<a href="../../policies-procedures/Policy/Background%20Check%20and%20Eligibility%20Policy.md#eligibility">x</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(out, /\/public\/documents\/background-check-and-eligibility-policy#eligibility"/);
});

test('rewrites src attributes too', () => {
    const html = '<img src="../SSCC/diagram.png">';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.match(out, /src="https:\/\/compliance\.refugehouse\.org\/public\/files\/temporary-reference\/SSCC\/diagram\.png"/);
});

test('leaves mailto links unchanged', () => {
    const html = '<a href="mailto:compliance@refugehouse.org">Email</a>';
    const out = rewriteServedLinks(html, SERVING, { docSet: DOC_SET });
    assert.equal(out, html);
});
