// routes/github-webhook.js - GitHub webhook receiver for automatic knowbase sync
// Listens for push events from the refuge-house-knowbase repo and triggers
// a document refresh. No API key required — uses GitHub's HMAC signature instead.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

/**
 * Verify the GitHub webhook signature (HMAC-SHA256).
 * Returns true if valid, false otherwise.
 */
function verifySignature(payload, signature) {
    if (!WEBHOOK_SECRET) {
        console.warn('[GITHUB-WEBHOOK] GITHUB_WEBHOOK_SECRET not set — skipping signature verification (dev mode)');
        return true;
    }

    if (!signature) {
        console.error('[GITHUB-WEBHOOK] No signature header present');
        return false;
    }

    const expected = 'sha256=' + crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    );
}

// POST /webhooks/github - Receive push events from GitHub
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const event = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];

    // The body comes as a raw Buffer from express.raw()
    const rawBody = req.body;
    const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf-8') : JSON.stringify(rawBody);

    // Verify signature
    if (!verifySignature(bodyString, signature)) {
        console.error(`[GITHUB-WEBHOOK] Invalid signature for delivery ${deliveryId}`);
        return res.status(401).json({ error: 'Invalid signature' });
    }

    // Only process push events
    if (event === 'ping') {
        console.log(`[GITHUB-WEBHOOK] Ping received (delivery: ${deliveryId})`);
        return res.json({ status: 'pong' });
    }

    if (event !== 'push') {
        console.log(`[GITHUB-WEBHOOK] Ignoring event: ${event}`);
        return res.json({ status: 'ignored', event });
    }

    // Parse the payload
    let payload;
    try {
        payload = JSON.parse(bodyString);
    } catch (err) {
        console.error('[GITHUB-WEBHOOK] Failed to parse payload:', err.message);
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    const ref = payload.ref || '';
    const repo = payload.repository?.full_name || 'unknown';

    // Only sync on pushes to the main branch
    if (ref !== 'refs/heads/main') {
        console.log(`[GITHUB-WEBHOOK] Ignoring push to ${ref} (only main triggers sync)`);
        return res.json({ status: 'ignored', reason: `push to ${ref}, not main` });
    }

    console.log(`[GITHUB-WEBHOOK] Push to main detected on ${repo} (delivery: ${deliveryId})`);
    console.log(`[GITHUB-WEBHOOK] Commits: ${payload.commits?.length || 0}, pusher: ${payload.pusher?.name || 'unknown'}`);

    // Respond immediately, then sync in the background
    res.json({
        status: 'accepted',
        message: 'Knowbase sync triggered',
        delivery: deliveryId
    });

    // Run sync in background (don't await — we already responded)
    setImmediate(async () => {
        try {
            console.log('[GITHUB-WEBHOOK] Starting knowbase sync...');
            const { syncKnowbase } = require('../services/knowbase-loader');
            await syncKnowbase();
            console.log('[GITHUB-WEBHOOK] Knowbase sync complete');

            // Also sync compliance registry
            try {
                const { syncComplianceRegistry } = require('../services/knowbase-sync');
                const syncResults = await syncComplianceRegistry();
                if (syncResults && !syncResults.skipped) {
                    console.log('[GITHUB-WEBHOOK] Compliance registry synced:', syncResults);
                    const { notifySyncResults } = require('../services/pulse-notifier');
                    await notifySyncResults(syncResults);
                }
            } catch (registryErr) {
                console.error('[GITHUB-WEBHOOK] Compliance registry sync failed:', registryErr.message);
            }
        } catch (err) {
            console.error('[GITHUB-WEBHOOK] Sync failed:', err.message);
        }
    });
});

module.exports = router;
