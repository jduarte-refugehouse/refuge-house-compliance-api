// middleware/human-auth.js
// Authorization for the HUMAN-facing surfaces (site index, public documents,
// binary files, desk-review portal, staff views). This is a separate plane from
// the machine API: /api/* keeps its own x-api-key gate, stays stateless, and is
// never touched here so Pulse traffic is unaffected.
//
// Three caller types, resolved per request:
//   - staff:    authenticated via Azure App Service Easy Auth (Entra). Easy Auth
//               injects X-MS-CLIENT-PRINCIPAL-* headers for authenticated users
//               and strips any client-supplied copies, so their presence is
//               trustworthy. Run Easy Auth in "allow unauthenticated" mode so it
//               attaches identity when present but never redirects /api/*.
//   - reviewer: presented a valid rolling key (see services/reviewer-key.js),
//               either as ?key= (which we move into an httpOnly cookie) or via
//               that cookie on later requests.
//   - public:   everyone else.
//
// Each resource declares a required tier (from document frontmatter or a file
// access map). canAccess() decides; default-restrictive = staff.
//
// Modes (env HUMAN_AUTH_MODE = off | log | enforce):
//   off     - no gating; surfaces fully open (default when no secret is set)
//   log     - compute decisions and log would-be denials, but allow everything
//   enforce - actually deny (default when REVIEWER_KEY_SECRET is set)
// This lets the gate be rolled out safely: ship in off/log, tag documents and
// enable Easy Auth, then flip to enforce.

const { canAccess, normalizeAccess } = require('../utils/access');
const { isConfigured, isValidReviewerKey, COOKIE_NAME, WINDOW_DAYS } = require('../services/reviewer-key');

const COOKIE_MAX_AGE_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

function resolveMode() {
    const m = String(process.env.HUMAN_AUTH_MODE || '').trim().toLowerCase();
    if (['off', 'log', 'enforce'].includes(m)) return m;
    return isConfigured() ? 'enforce' : 'off';
}
const MODE = resolveMode();
let _warnedOff = false;

/**
 * Extract the Easy Auth principal, if present. Returns null for anonymous.
 */
function getStaffPrincipal(req) {
    const id = req.headers['x-ms-client-principal-id'];
    const name = req.headers['x-ms-client-principal-name'];
    if (id || name) {
        return {
            id: id || null,
            name: name || null,
            idp: req.headers['x-ms-client-principal-idp'] || null
        };
    }
    return null;
}

/**
 * attachCaller — resolves req.caller for every human-plane request and performs
 * the ?key= -> httpOnly cookie -> clean-URL handshake. Never blocks; gating is
 * done by requireTier()/allows() so listing routes can filter per item.
 */
function attachCaller(req, res, next) {
    // Machine API and webhooks own their own auth — leave them completely alone.
    if (req.path.startsWith('/api') || req.path.startsWith('/webhooks')) return next();

    if (MODE === 'off' && !_warnedOff) {
        console.warn('[HUMAN-AUTH] OFF mode (REVIEWER_KEY_SECRET not set) — human surfaces are open. Set the secret (and HUMAN_AUTH_MODE) to gate them.');
        _warnedOff = true;
    }

    const principal = getStaffPrincipal(req);
    const isStaff = Boolean(principal);

    let isReviewer = false;
    const queryKey = req.query && typeof req.query.key === 'string' ? req.query.key : null;
    const cookieKey = req.cookies ? req.cookies[COOKIE_NAME] : null;

    if (queryKey && isValidReviewerKey(queryKey)) {
        // Move the key out of the URL and into an httpOnly cookie so it stays out
        // of the address bar, browser history, and Referer headers.
        res.cookie(COOKIE_NAME, queryKey, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: COOKIE_MAX_AGE_MS,
            path: '/'
        });
        isReviewer = true;
        if (req.method === 'GET') {
            const full = new URL(req.originalUrl, `${req.protocol}://${req.get('host')}`);
            full.searchParams.delete('key');
            return res.redirect(302, full.pathname + (full.search || ''));
        }
    } else if (cookieKey && isValidReviewerKey(cookieKey)) {
        isReviewer = true;
    } else if (cookieKey) {
        // Cookie present but no longer valid (rotated/expired) — clear it.
        res.clearCookie(COOKIE_NAME, { path: '/' });
    }

    req.caller = { isStaff, isReviewer, principal, mode: MODE };
    next();
}

function wantsJson(req) {
    const f = (req.query && req.query.format) || '';
    if (f === 'json' || f === 'markdown') return true;
    const accept = String(req.headers['accept'] || '');
    return accept.includes('application/json') && !accept.includes('text/html');
}

function loginRedirect(req, res) {
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect(302, `/.auth/login/aad?post_login_redirect_uri=${target}`);
}

function reviewerRequiredPage() {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reviewer link required — Refuge House Compliance</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:640px;margin:3rem auto;padding:0 1.5rem;color:#1e293b;line-height:1.6}
  h1{color:#5E3989}
  .card{background:#f3e9fa;border:1px solid #d4b5e4;border-radius:12px;padding:1.1rem 1.25rem}
  a{color:#A90533}
  code{background:#f1f5f9;padding:.1rem .35rem;border-radius:4px}
</style></head>
<body>
  <h1>This page needs a current reviewer link</h1>
  <div class="card">
    <p>Access to this resource is limited to reviewers with a current link and to
    Refuge House staff.</p>
    <p>If you were given a reviewer link, open it again — links rotate, so an old
    one may have expired. Ask your Refuge House contact for a fresh link.</p>
    <p>Refuge House staff can <a href="/.auth/login/aad?post_login_redirect_uri=%2F">sign in</a> to view all materials.</p>
  </div>
</body></html>`;
}

/**
 * Render the appropriate denial for a required tier.
 */
function deny(req, res, requiredTier) {
    const tier = normalizeAccess(requiredTier);
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    if (tier === 'staff') {
        if (wantsJson(req)) return res.status(401).json({ error: 'Staff sign-in required', tier });
        return loginRedirect(req, res);
    }
    if (wantsJson(req)) {
        return res.status(401).json({ error: 'A current reviewer link is required to view this resource', tier });
    }
    return res.status(401).type('html').send(reviewerRequiredPage());
}

/**
 * Decide whether the current request may access a resource of requiredTier,
 * honoring the active MODE. In 'off' it always allows; in 'log' it allows but
 * logs would-be denials; in 'enforce' it returns the real decision.
 */
function allows(req, requiredTier) {
    if (MODE === 'off') return true;
    const ok = canAccess(requiredTier, req.caller);
    if (!ok && MODE === 'log') {
        const c = req.caller || {};
        console.warn(`[HUMAN-AUTH] (log) would deny ${req.method} ${req.originalUrl} — needs ${normalizeAccess(requiredTier)} (staff=${!!c.isStaff} reviewer=${!!c.isReviewer})`);
        return true;
    }
    return ok;
}

/**
 * Route-level gate for a static required tier (e.g. the desk-review portal needs
 * 'reviewer'; staff views need 'staff').
 */
function requireTier(tier) {
    return (req, res, next) => {
        if (allows(req, tier)) return next();
        return deny(req, res, tier);
    };
}

module.exports = {
    attachCaller,
    requireTier,
    allows,
    deny,
    wantsJson,
    MODE
};
