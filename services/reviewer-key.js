// services/reviewer-key.js
// Stateless "reviewer link" key, used to raise the cost of bulk scraping on the
// human-facing site without standing up identity, email, or a database.
//
// The key for any given day is HMAC(REVIEWER_KEY_SECRET, UTC-date). A presented
// key is accepted if it matches any of the last N daily keys (default 7), so a
// link minted today keeps working for ~7 days and old keys fall out of the
// window on a rolling basis (no hard cliff). Rotating REVIEWER_KEY_SECRET in the
// environment is an instant kill-switch for every outstanding link.
//
// This is a shared bearer secret, not per-person identity: anyone the link is
// forwarded to also gets in until it ages out. That is an accepted trade for
// non-sensitive, anti-scrape gating. The middleware is structured so this key
// check can later be swapped for a per-reviewer token without re-architecture.

const crypto = require('crypto');

const SECRET = process.env.REVIEWER_KEY_SECRET || '';
// Number of overlapping daily keys accepted at once (link lifetime in days).
const WINDOW_DAYS = Math.max(1, parseInt(process.env.REVIEWER_KEY_WINDOW_DAYS || '7', 10));
const COOKIE_NAME = process.env.REVIEWER_COOKIE_NAME || 'rh_review_key';
// 32 hex chars = 128 bits of HMAC output — plenty for an unguessable link key.
const KEY_LENGTH = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a server secret is configured. When false, the reviewer tier cannot
 * be satisfied by a key (the human-auth middleware treats this as "off" mode so
 * local dev is never locked out).
 */
function isConfigured() {
    return SECRET.length > 0;
}

function utcDateString(date = new Date()) {
    return date.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

function keyForDate(dateStr) {
    return crypto
        .createHmac('sha256', SECRET)
        .update(`reviewer:${dateStr}`)
        .digest('hex')
        .slice(0, KEY_LENGTH);
}

/**
 * Today's reviewer key (or null if no secret is configured).
 */
function currentReviewerKey() {
    if (!isConfigured()) return null;
    return keyForDate(utcDateString());
}

/**
 * The set of currently-valid keys: today, today-1, ... today-(WINDOW_DAYS-1).
 */
function validKeysWindow() {
    const keys = [];
    const now = Date.now();
    for (let i = 0; i < WINDOW_DAYS; i++) {
        keys.push(keyForDate(utcDateString(new Date(now - i * DAY_MS))));
    }
    return keys;
}

function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * Validate a presented key against the rolling window using a constant-time
 * comparison.
 */
function isValidReviewerKey(presented) {
    if (!isConfigured() || !presented || typeof presented !== 'string') return false;
    for (const key of validKeysWindow()) {
        if (safeEqual(presented, key)) return true;
    }
    return false;
}

/**
 * Build a shareable reviewer link for a target path on this deployment.
 * @param {string} baseUrl - e.g. "https://compliance-api.refugehouse.org"
 * @param {string} targetPath - e.g. "/review/fy26-sscc"
 * @returns {string|null} the link, or null if no secret is configured
 */
function reviewerLinkFor(baseUrl, targetPath = '/review/fy26-sscc') {
    const key = currentReviewerKey();
    if (!key) return null;
    const sep = targetPath.includes('?') ? '&' : '?';
    return `${baseUrl}${targetPath}${sep}key=${key}`;
}

module.exports = {
    isConfigured,
    currentReviewerKey,
    isValidReviewerKey,
    reviewerLinkFor,
    COOKIE_NAME,
    WINDOW_DAYS,
    KEY_LENGTH
};
