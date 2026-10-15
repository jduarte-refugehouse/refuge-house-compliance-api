// services/collection-share.js
// A collection share link opens one collection without the "All collections"
// escape, and — once REVIEWER_KEY_SECRET is set — only with a pass scoped to
// that collection. The pass is not the site-wide reviewer key: it does not
// raise the caller to reviewer on any other route. Document and file routes
// honor it only for members of the named collection.
const { currentShareKey, currentDocumentShareKey, isValidShareKey, isValidDocumentShareKey, WINDOW_DAYS } = require('./reviewer-key');

const COOKIE_NAME = 'rh_collection_share';
const DOCUMENT_COOKIE_NAME = 'rh_document_share';

function isShareView(query) {
    return String((query && query.view) || '').trim().toLowerCase() === 'share';
}

function cookieValue(code, pass) {
    return `${code}.${pass}`;
}

function readGrant(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const dot = raw.indexOf('.');
    if (dot < 1) return null;
    const code = raw.slice(0, dot);
    const pass = raw.slice(dot + 1);
    if (!code || !pass || !isValidShareKey(code, pass)) return null;
    return { code, pass };
}

function grantFromRequest(req) {
    const cookies = req && req.cookies;
    return readGrant(cookies && cookies[COOKIE_NAME]);
}

function grantsCollection(req, code) {
    const grant = grantFromRequest(req);
    if (!grant) return false;
    return grant.code.toLowerCase() === String(code || '').trim().toLowerCase();
}

function shareCoversPath(req, repoPath) {
    const grant = grantFromRequest(req);
    if (!grant || !repoPath) return false;
    const { collectionContainsPath } = require('./collections');
    return collectionContainsPath(grant.code, repoPath);
}

function shareLink(baseUrl, code) {
    const path = `/collections/${encodeURIComponent(code)}?view=share`;
    const pass = currentShareKey(code);
    if (!pass) return `${baseUrl}${path}`;
    return `${baseUrl}${path}&pass=${pass}`;
}

function readDocumentGrant(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const dot = raw.indexOf('.');
    if (dot < 1) return null;
    const slug = raw.slice(0, dot);
    const pass = raw.slice(dot + 1);
    if (!slug || !pass || !isValidDocumentShareKey(slug, pass)) return null;
    return { slug, pass };
}

function documentGrantFromRequest(req) {
    const cookies = req && req.cookies;
    return readDocumentGrant(cookies && cookies[DOCUMENT_COOKIE_NAME]);
}

function grantsDocument(req, slug) {
    const grant = documentGrantFromRequest(req);
    if (!grant) return false;
    return grant.slug.toLowerCase() === String(slug || '').trim().toLowerCase();
}

function documentShareLink(baseUrl, slug) {
    const path = `/public/documents/${encodeURIComponent(slug)}`;
    const pass = currentDocumentShareKey(slug);
    if (!pass) return `${baseUrl}${path}`;
    return `${baseUrl}${path}?pass=${pass}`;
}

module.exports = {
    COOKIE_NAME,
    DOCUMENT_COOKIE_NAME,
    WINDOW_DAYS,
    isShareView,
    cookieValue,
    readGrant,
    grantFromRequest,
    grantsCollection,
    shareCoversPath,
    shareLink,
    readDocumentGrant,
    documentGrantFromRequest,
    grantsDocument,
    documentShareLink
};
