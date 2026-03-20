// services/compliance-reminders.js - Reminder configuration and check logic
const { poolPromise, sql } = require('./db');
const { logAction } = require('./compliance-history');

async function listByDocument(documentId) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .query('SELECT * FROM compliance_reminders WHERE document_id = @documentId ORDER BY reminder_days_before DESC');
    return result.recordset;
}

async function listAll() {
    const pool = await poolPromise;
    const result = await pool.request()
        .query(`
            SELECT cr.*, d.title AS document_title, d.document_path, d.next_review_date
            FROM compliance_reminders cr
            JOIN compliance_documents d ON d.id = cr.document_id
            WHERE cr.enabled = 1
            ORDER BY d.next_review_date ASC
        `);
    return result.recordset;
}

async function upsert(documentId, reminders) {
    const pool = await poolPromise;

    // Remove existing reminders for this document
    await pool.request()
        .input('documentId', sql.Int, documentId)
        .query('DELETE FROM compliance_reminders WHERE document_id = @documentId');

    // Insert new ones
    for (const r of reminders) {
        await pool.request()
            .input('documentId', sql.Int, documentId)
            .input('daysBefore', sql.Int, r.reminder_days_before)
            .input('notifyRole', sql.NVarChar(50), r.notify_role || 'owner')
            .input('enabled', sql.Bit, r.enabled !== false ? 1 : 0)
            .query(`
                INSERT INTO compliance_reminders (document_id, reminder_days_before, notify_role, enabled)
                VALUES (@documentId, @daysBefore, @notifyRole, @enabled)
            `);
    }

    return true;
}

/**
 * Check for reminders that should fire today. Returns a list of
 * {document, reminder} pairs that need notifications sent.
 * Stateless — safe to call from Azure Function timer or cron.
 */
async function check() {
    const pool = await poolPromise;

    const result = await pool.request()
        .query(`
            SELECT cr.id AS reminder_id, cr.reminder_days_before, cr.notify_role,
                   d.id AS document_id, d.title, d.document_path, d.next_review_date,
                   d.owner_user_id, d.category, d.status AS document_status
            FROM compliance_reminders cr
            JOIN compliance_documents d ON d.id = cr.document_id
            WHERE cr.enabled = 1
              AND d.status NOT IN ('sunset', 'archived', 'deprecated')
              AND d.next_review_date IS NOT NULL
              AND DATEDIFF(DAY, GETDATE(), d.next_review_date) <= cr.reminder_days_before
              AND (cr.last_sent_at IS NULL OR DATEDIFF(DAY, cr.last_sent_at, GETDATE()) >= 1)
        `);

    const fired = [];

    for (const row of result.recordset) {
        // Mark as sent
        await pool.request()
            .input('id', sql.Int, row.reminder_id)
            .query('UPDATE compliance_reminders SET last_sent_at = GETDATE() WHERE id = @id');

        await logAction({
            documentId: row.document_id,
            action: 'reminder-sent',
            details: {
                reminder_days_before: row.reminder_days_before,
                notify_role: row.notify_role,
                next_review_date: row.next_review_date
            }
        });

        fired.push(row);
    }

    return fired;
}

module.exports = { listByDocument, listAll, upsert, check };
