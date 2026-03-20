// services/pulse-notifier.js - Push notifications to Pulse via webhook
// When compliance events occur (reminders fire, regulatory changes, reviews created),
// this service POSTs to Pulse so it can send emails, show UI alerts, etc.
//
// Pulse webhook URL is configured via PULSE_WEBHOOK_URL env var.
// If not set, notifications are logged but not sent (dev mode).

const PULSE_WEBHOOK_URL = process.env.PULSE_WEBHOOK_URL;
const PULSE_WEBHOOK_SECRET = process.env.PULSE_WEBHOOK_SECRET;

if (!PULSE_WEBHOOK_URL) {
    console.warn('[PULSE-NOTIFIER] PULSE_WEBHOOK_URL not set. Notifications will be logged only (dev mode).');
}

/**
 * Send a notification to Pulse.
 *
 * @param {string} eventType - e.g. 'reminder-due', 'regulatory-change', 'review-created', 'review-completed', 'content-changed', 'document-removed'
 * @param {object} payload - Event-specific data
 * @returns {Promise<{ sent: boolean, status?: number, error?: string }>}
 */
async function notify(eventType, payload) {
    const notification = {
        event: eventType,
        source: 'compliance-api',
        timestamp: new Date().toISOString(),
        data: payload
    };

    console.log(`[PULSE-NOTIFIER] Event: ${eventType}`, JSON.stringify(payload).substring(0, 200));

    if (!PULSE_WEBHOOK_URL) {
        return { sent: false, reason: 'PULSE_WEBHOOK_URL not configured' };
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'refuge-house-compliance-api'
        };

        if (PULSE_WEBHOOK_SECRET) {
            headers['X-Webhook-Secret'] = PULSE_WEBHOOK_SECRET;
        }

        const res = await fetch(PULSE_WEBHOOK_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(notification),
            signal: AbortSignal.timeout(10000) // 10s timeout
        });

        if (!res.ok) {
            const body = await res.text();
            console.error(`[PULSE-NOTIFIER] Pulse returned ${res.status}: ${body}`);
            return { sent: false, status: res.status, error: body };
        }

        return { sent: true, status: res.status };
    } catch (err) {
        console.error(`[PULSE-NOTIFIER] Failed to notify Pulse:`, err.message);
        return { sent: false, error: err.message };
    }
}

/**
 * Send reminder notifications to Pulse.
 * Called by the reminder check endpoint after reminders fire.
 */
async function notifyReminders(firedReminders) {
    const results = [];
    for (const reminder of firedReminders) {
        const result = await notify('reminder-due', {
            document_id: reminder.document_id,
            document_title: reminder.title,
            document_path: reminder.document_path,
            next_review_date: reminder.next_review_date,
            reminder_days_before: reminder.reminder_days_before,
            notify_role: reminder.notify_role,
            owner_user_id: reminder.owner_user_id,
            category: reminder.category
        });
        results.push(result);
    }
    return results;
}

/**
 * Notify Pulse about a regulatory change and the reviews it triggered.
 */
async function notifyRegulatoryChange(regulation, affectedDocuments) {
    return notify('regulatory-change', {
        regulatory_source_id: regulation.id,
        authority: regulation.authority,
        reference_code: regulation.reference_code,
        title: regulation.title,
        affected_documents: affectedDocuments.map(d => ({
            document_id: d.document_id,
            title: d.title,
            document_path: d.document_path
        }))
    });
}

/**
 * Notify Pulse about a review lifecycle event.
 */
async function notifyReviewEvent(eventType, review) {
    return notify(eventType, {
        review_id: review.id || review.review_id,
        document_id: review.document_id,
        document_title: review.document_title || review.title,
        document_path: review.document_path,
        review_type: review.review_type,
        status: review.status,
        assigned_to: review.assigned_to,
        due_date: review.due_date
    });
}

/**
 * Notify Pulse about knowbase sync results (new, changed, removed docs).
 */
async function notifySyncResults(syncResults) {
    if (syncResults.new_documents.length === 0 &&
        syncResults.changed_documents.length === 0 &&
        syncResults.removed_documents.length === 0) {
        return { sent: false, reason: 'no changes to report' };
    }

    return notify('knowbase-sync', {
        new_documents: syncResults.new_documents,
        changed_documents: syncResults.changed_documents,
        removed_documents: syncResults.removed_documents,
        unchanged: syncResults.unchanged
    });
}

module.exports = { notify, notifyReminders, notifyRegulatoryChange, notifyReviewEvent, notifySyncResults };
