// services/compliance-history.js - Immutable audit trail for compliance actions
// Called internally by other compliance services. Every state change gets logged.
const { poolPromise, sql } = require('./db');

/**
 * Log an action to the compliance review history.
 * @param {object} entry
 * @param {number} entry.documentId
 * @param {number} [entry.reviewId]
 * @param {string} entry.action
 * @param {number} [entry.performedBy] - user ID (null for system actions)
 * @param {object} [entry.details] - arbitrary context (stored as JSON)
 * @param {string} [entry.commitSha] - knowbase git commit SHA
 */
async function logAction({ documentId, reviewId = null, action, performedBy = null, details = null, commitSha = null }) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .input('reviewId', sql.Int, reviewId)
        .input('action', sql.NVarChar(50), action)
        .input('performedBy', sql.Int, performedBy)
        .input('details', sql.NVarChar(sql.MAX), details ? JSON.stringify(details) : null)
        .input('commitSha', sql.NVarChar(40), commitSha)
        .query(`
            INSERT INTO compliance_review_history
                (document_id, review_id, action, performed_by, details, knowbase_commit_sha)
            VALUES
                (@documentId, @reviewId, @action, @performedBy, @details, @commitSha);
            SELECT SCOPE_IDENTITY() AS id;
        `);
    return result.recordset[0].id;
}

/**
 * Query audit history with filters.
 */
async function queryHistory({ documentId, reviewId, userId, action, startDate, endDate, limit = 100, offset = 0 }) {
    const pool = await poolPromise;
    const request = pool.request();

    let where = ['1=1'];

    if (documentId) {
        request.input('documentId', sql.Int, documentId);
        where.push('h.document_id = @documentId');
    }
    if (reviewId) {
        request.input('reviewId', sql.Int, reviewId);
        where.push('h.review_id = @reviewId');
    }
    if (userId) {
        request.input('userId', sql.Int, userId);
        where.push('h.performed_by = @userId');
    }
    if (action) {
        request.input('action', sql.NVarChar(50), action);
        where.push('h.action = @action');
    }
    if (startDate) {
        request.input('startDate', sql.DateTime2, new Date(startDate));
        where.push('h.created_at >= @startDate');
    }
    if (endDate) {
        request.input('endDate', sql.DateTime2, new Date(endDate));
        where.push('h.created_at <= @endDate');
    }

    request.input('limit', sql.Int, limit);
    request.input('offset', sql.Int, offset);

    const result = await request.query(`
        SELECT h.*, d.title AS document_title, d.document_path
        FROM compliance_review_history h
        JOIN compliance_documents d ON d.id = h.document_id
        WHERE ${where.join(' AND ')}
        ORDER BY h.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    return result.recordset;
}

module.exports = { logAction, queryHistory };
