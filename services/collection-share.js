// services/collection-share.js
// A collection share link opens one collection without the "All collections"
// escape, and — once REVIEWER_KEY_SECRET is set — only with a pass scoped to
// that collection. The pass is not the site-wide reviewer key: it does not
// raise the caller to reviewer on any other route. Document and file routes
// honor it only for members of the named collection.
const { currentShareKey, isValidShareKey, WINDOW_DAYS } = require('./reviewer-key');

const COOKIE_NAME = 'rh_collection_share';

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

module.exports = {
    COOKIE_NAME,
    WINDOW_DAYS,
    isShareView,
    cookieValue,
    readGrant,
    grantFromRequest,
    grantsCollection,
    shareCoversPath,
    shareLink
};
