process.env.REVIEWER_KEY_SECRET = 'test-share-secret';
process.env.REVIEWER_KEY_WINDOW_DAYS = '7';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    currentReviewerKey,
    currentShareKey,
    currentDocumentShareKey,
    isValidReviewerKey,
    isValidShareKey,
    isValidDocumentShareKey
} = require('./reviewer-key');
const { isShareView, readGrant, cookieValue, shareLink, readDocumentGrant, documentShareLink } = require('./collection-share');

test('a collection pass is not a site-wide reviewer key', () => {
    const pass = currentShareKey('GEN-PP');
    assert.equal(typeof pass, 'string');
    assert.notEqual(pass, currentReviewerKey());
    assert.equal(isValidShareKey('GEN-PP', pass), true);
    assert.equal(isValidShareKey('gen-pp', pass), true);
    assert.equal(isValidShareKey('FC-HB', pass), false);
    assert.equal(isValidReviewerKey(pass), false);
    assert.equal(isValidShareKey('GEN-PP', currentReviewerKey()), false);
});

test('share view is requested only by view=share', () => {
    assert.equal(isShareView({ view: 'share' }), true);
    assert.equal(isShareView({ view: 'Share' }), true);
    assert.equal(isShareView({}), false);
    assert.equal(isShareView({ view: 'full' }), false);
});

test('share cookie grants only its own collection', () => {
    const pass = currentShareKey('GEN-PP');
    const grant = readGrant(cookieValue('GEN-PP', pass));
    assert.equal(grant.code, 'GEN-PP');
    assert.equal(readGrant(cookieValue('FC-HB', pass)), null);
    assert.equal(readGrant('not-a-grant'), null);
});

test('share link hides the collection index and carries a pass', () => {
    const link = shareLink('https://compliance.refugehouse.org', 'GEN-PP');
    assert.match(link, /^https:\/\/compliance\.refugehouse\.org\/collections\/GEN-PP\?view=share&pass=[0-9a-f]+$/);
});

test('a document pass opens only that document', () => {
    const slug = 'disaster-and-emergency-response-preparedness-plan-derpp';
    const pass = currentDocumentShareKey(slug);
    assert.equal(isValidDocumentShareKey(slug, pass), true);
    assert.equal(isValidDocumentShareKey(slug.toUpperCase(), pass), true);
    assert.equal(isValidDocumentShareKey(slug + '-policy', pass), false);
    assert.equal(isValidShareKey('GEN-PP', pass), false);
    assert.equal(isValidReviewerKey(pass), false);
    assert.equal(readDocumentGrant(`${slug}.${pass}`).slug, slug);
    assert.equal(readDocumentGrant(`other-doc.${pass}`), null);
    const link = documentShareLink('https://compliance.refugehouse.org', slug);
    assert.match(link, new RegExp(`^https://compliance\\.refugehouse\\.org/public/documents/${slug}\\?pass=[0-9a-f]+$`));
});
