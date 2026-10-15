// Regression: collection rows for non-policy assets must interpolate the type
// badge. A single-quoted branch left `${escapeHtml(m.type)}` in the HTML, and
// the pill's uppercase CSS made it render as ${ESCAPEHTML(M.TYPE)}.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { headerCrumb } = require('./collections');

test('asset type pill is a template literal, not a quoted string', () => {
    const src = fs.readFileSync(path.join(__dirname, 'collections.js'), 'utf8');
    assert.equal(
        (src.match(/'<span class="type-pill">\$\{escapeHtml\(m\.type\)\}<\/span>'/g) || []).length,
        0,
        'type pill must not be left inside a single-quoted string'
    );
    assert.match(src, /`<span class="type-pill">\$\{escapeHtml\(m\.type\)\}<\/span>`/);
});

test('share view omits the All collections link', () => {
    assert.equal(headerCrumb(true), '');
    assert.match(headerCrumb(false), /All collections/);
});
