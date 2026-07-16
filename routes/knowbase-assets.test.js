// Unit tests for the knowbase asset fallback route. Pure/no-network: covers the
// extension matcher, content-type map, and the loader's asset-index API surface.
// Run with: npm test

const test = require('node:test');
const assert = require('node:assert/strict');

const { _internal } = require('./knowbase-assets');
const loader = require('../services/knowbase-loader');

test('asset route regex matches servable extensions', () => {
    const re = _internal.ASSET_ROUTE_RE;
    const yes = [
        '/forms/home-monitoring/Home-Monitoring-Unified-Quarterly-Visit-PRINT.html',
        '/forms/home-monitoring/Home-Monitoring-Unified-Quarterly-Visit-PRINT.pdf',
        '/forms/home-monitoring/home-monitoring-items.json',
        '/img/logo.png',
        '/img/logo.svg',
        '/img/photo.jpg',
        '/img/photo.jpeg'
    ];
    for (const p of yes) assert.ok(re.test(p), `should match ${p}`);
});

test('asset route regex ignores non-asset paths', () => {
    const re = _internal.ASSET_ROUTE_RE;
    const no = ['/manual', '/collections/CRA', '/public/documents/x', '/site-index', '/notes.md', '/report.docx'];
    for (const p of no) assert.equal(re.test(p), false, `should NOT match ${p}`);
});

test('content-type map covers every matched extension', () => {
    const { CONTENT_TYPES } = _internal;
    assert.equal(CONTENT_TYPES['.pdf'], 'application/pdf');
    assert.match(CONTENT_TYPES['.json'], /application\/json/);
    assert.match(CONTENT_TYPES['.html'], /text\/html/);
    assert.equal(CONTENT_TYPES['.svg'], 'image/svg+xml');
    assert.equal(CONTENT_TYPES['.png'], 'image/png');
    assert.equal(CONTENT_TYPES['.jpg'], 'image/jpeg');
    assert.equal(CONTENT_TYPES['.jpeg'], 'image/jpeg');
});

test('loader exposes the asset-index API and returns null for unknown paths', () => {
    assert.equal(typeof loader.getAsset, 'function');
    assert.equal(typeof loader.getAssetIndex, 'function');
    assert.equal(typeof loader.fetchAssetBytes, 'function');
    assert.deepEqual(loader.getAssetIndex(), {});
    assert.equal(loader.getAsset('forms/does-not-exist.pdf'), null);
});
