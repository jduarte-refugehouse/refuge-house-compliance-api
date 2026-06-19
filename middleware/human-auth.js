// middleware/human-auth.js
// Human-facing access gating for the policy manual / collections / site index.
//
// The gate is fully BUILT but currently left OPEN. The knowbase contract
// (knowbase CLAUDE.md §9) is the end state we're building toward:
//   public   ⇒ the only unauthenticated content
//   reviewer ⇒ shareable with designated external reviewers
//   staff    ⇒ Azure-authenticated staff only (default for everything else)
//
// Posture is driven entirely by env, so the gate can be turned ON later with
// NO code change:
//
//   COMPLIANCE_AUTH_MODE = unset (default) | 'open' | 'preview'
//        -> GATE OPEN: every viewer is treated as staff and sees all content.
//           This is the current "built but open for now" posture.
//   COMPLIANCE_AUTH_MODE = 'enforce'
//        -> GATE ON: anonymous viewers see ONLY access:public content; staff /
//           reviewer content requires an authenticated principal.
//
// In every mode, a real Azure App Service Easy Auth principal (the
// `x-ms-client-principal` header the platform injects once you enable auth) is
// honored — so turning the gate on is just: enable Easy Auth + set 'enforce'.
//
//   COMPLIANCE_REVIEWER_KEY (optional) -> if set, a request carrying it
//        (?reviewerKey=... or x-reviewer-key header) is granted reviewer
//        clearance. Off unless the env var is set.

// The only value that ENABLES the gate. Anything else (including unset) leaves
// it open. Enumerated explicitly so a typo can't silently re-open a gate that
// was meant to be enforced — only this exact value gates.
const ENFORCING_MODES = new Set(['enforce', 'enforced', 'on', 'closed']);

// Clearance → the set of tiers a viewer may see. staff is the broadest.
const CLEARANCE = {
    anonymous: new Set(['public']),
    reviewer: new Set(['public', 'reviewer']),
    staff: new Set(['public', 'reviewer', 'staff'])
};

function authMode() {
    return String(process.env.COMPLIANCE_AUTH_MODE || '').trim().toLowerCase();
}

/**
 * Decode an Azure Easy Auth principal header, if present. Returns null when
 * there is no (valid) principal — i.e. platform auth isn't enabled yet.
 */
function easyAuthPrincipal(req) {
    const raw = req.headers['x-ms-client-principal'];
    if (!raw) return null;
    try {
        const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        const claims = Array.isArray(json.claims) ? json.claims : [];
        const roles = claims
            .filter((c) => /(^|\/)roles?$/i.test(c.typ || '') || c.typ === 'roles')
            .map((c) => String(c.val || '').toLowerCase());
        return { authenticated: true, roles };
    } catch (_) {
        return null;
    }
}

function hasReviewerKey(req) {
    const expected = process.env.COMPLIANCE_REVIEWER_KEY;
    if (!expected) return false;
    const supplied = req.query.reviewerKey || req.headers['x-reviewer-key'];
    return Boolean(supplied) && supplied === expected;
}

/**
 * Determine the viewer's clearance level for this request.
 * @returns {'staff'|'reviewer'|'anonymous'}
 */
function clearanceFor(req) {
    const principal = easyAuthPrincipal(req);
    if (principal && principal.authenticated) {
        // A signed-in staff member; a 'reviewer'-only role maps to reviewer.
        if (principal.roles.includes('reviewer') && !principal.roles.includes('staff')) {
            return 'reviewer';
        }
        return 'staff';
    }
    if (hasReviewerKey(req)) return 'reviewer';
    // No authenticated principal. The gate is open for now: only the explicit
    // enforcing mode drops anonymous viewers to public-only; otherwise everyone
    // is treated as staff and sees all content.
    if (ENFORCING_MODES.has(authMode())) return 'anonymous';
    return 'staff';
}

/**
 * Whether the current request may view content at the given access tier.
 * @param {object} req - express request
 * @param {string} access - required tier: 'public' | 'reviewer' | 'staff'
 * @returns {boolean}
 */
function allows(req, access) {
    const tier = String(access || 'staff').toLowerCase();
    if (tier === 'public') return true; // public is visible to everyone
    return CLEARANCE[clearanceFor(req)].has(tier);
}

/**
 * Whether the client wants a JSON response rather than HTML.
 */
function wantsJson(req) {
    if (String(req.query.format || '').toLowerCase() === 'json') return true;
    if (typeof req.path === 'string' && req.path.endsWith('.json')) return true;
    const accept = String(req.headers.accept || '');
    return accept.includes('application/json') && !accept.includes('text/html');
}

/**
 * Send an access-denied response (JSON or a small styled HTML page).
 */
function deny(req, res, access) {
    res.status(403);
    if (wantsJson(req)) {
        return res.json({ error: 'Forbidden', requiredAccess: access || 'staff' });
    }
    return res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sign-in required - Refuge House Compliance</title>
<link rel="stylesheet" href="/rh-compliance.css" /></head>
<body><div class="app"><div class="main"><div class="body">
  <div class="cta-banner">
    <div>
      <div class="cta-title">Staff sign-in required</div>
      <div class="cta-sub">This material is restricted to ${access === 'reviewer' ? 'designated reviewers' : 'Refuge House staff'}. Sign in to continue.</div>
    </div>
    <a class="cta-go" href="/">Back to the Library</a>
  </div>
</div></div></div></body></html>`);
}

module.exports = { allows, deny, wantsJson, clearanceFor };
