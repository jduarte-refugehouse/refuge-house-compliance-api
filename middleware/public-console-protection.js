// middleware/public-console-protection.js
// Lightweight abuse controls for public console routes only.

const WINDOW_MS = parseInt(process.env.PUBLIC_CONSOLE_RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_REQUESTS = parseInt(process.env.PUBLIC_CONSOLE_RATE_LIMIT_MAX_REQUESTS || '25', 10);
const MAX_MESSAGE_CHARS = parseInt(process.env.PUBLIC_CONSOLE_MAX_MESSAGE_CHARS || '4000', 10);

// In-memory sliding window by client IP.
const buckets = new Map();

function getClientIp(req) {
    if (req.ip) return req.ip;

    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
        return forwardedFor.split(',')[0].trim();
    }

    return req.socket?.remoteAddress || 'unknown';
}

function cleanupOldBuckets(now) {
    for (const [ip, bucket] of buckets.entries()) {
        if (now - bucket.windowStart >= WINDOW_MS) {
            buckets.delete(ip);
        }
    }
}

function publicConsoleProtection(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);

    cleanupOldBuckets(now);

    const current = buckets.get(ip);
    if (!current || now - current.windowStart >= WINDOW_MS) {
        buckets.set(ip, { windowStart: now, count: 1 });
    } else {
        current.count += 1;
        if (current.count > MAX_REQUESTS) {
            const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - current.windowStart)) / 1000));
            res.setHeader('Retry-After', retryAfterSeconds);
            return res.status(429).json({
                error: 'Too many requests from this client. Please try again shortly.'
            });
        }
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const message = req.body?.message;
        if (typeof message === 'string' && message.length > MAX_MESSAGE_CHARS) {
            return res.status(413).json({
                error: `Message too large. Max length is ${MAX_MESSAGE_CHARS} characters.`
            });
        }
    }

    return next();
}

module.exports = {
    publicConsoleProtection
};
