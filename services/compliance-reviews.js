// services/compliance-reviews.js - Review workflow + approval chains
const { poolPromise, sql } = require('./db');
const { logAction } = require('./compliance-history');

async function list({ status, assignedTo, reviewType, documentId, dueBefore, limit = 100, offset = 0 }) {
    const pool = await poolPromise;
    const request = pool.request();
    let where = ['1=1'];

    if (status) {
        request.input('status', sql.NVarChar(30), status);
        where.push('r.status = @status');
    }
    if (assignedTo) {
        request.input('assignedTo', sql.Int, assignedTo);
        where.push('r.assigned_to = @assignedTo');
    }
    if (reviewType) {
        request.input('reviewType', sql.NVarChar(30), reviewType);
        where.push('r.review_type = @reviewType');
    }
    if (documentId) {
        request.input('documentId', sql.Int, documentId);
        where.push('r.document_id = @documentId');
    }
    if (dueBefore) {
        request.input('dueBefore', sql.Date, new Date(dueBefore));
        where.push('r.due_date <= @dueBefore');
    }

    request.input('limit', sql.Int, limit);
    request.input('offset', sql.Int, offset);

    const result = await request.query(`
        SELECT r.*, d.title AS document_title, d.document_path, d.category
        FROM compliance_reviews r
        JOIN compliance_documents d ON d.id = r.document_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.due_date ASC, r.created_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
}

async function getById(id) {
    const pool = await poolPromise;

    const review = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT r.*, d.title AS document_title, d.document_path, d.category
            FROM compliance_reviews r
            JOIN compliance_documents d ON d.id = r.document_id
            WHERE r.id = @id
        `);

    if (!review.recordset[0]) return null;

    const approvals = await pool.request()
        .input('reviewId', sql.Int, id)
        .query(`
            SELECT * FROM compliance_review_approvals
            WHERE review_id = @reviewId
            ORDER BY approval_order
        `);

    return {
        ...review.recordset[0],
        approvals: approvals.recordset
    };
}

/**
 * Get the matching approval chain template for a document's category/content_type.
 * Falls back to the default template.
 */
async function getApprovalTemplate(category, contentType) {
    const pool = await poolPromise;

    // Try exact match on both category and content_type
    let result = await pool.request()
        .input('category', sql.NVarChar(50), category)
        .input('contentType', sql.NVarChar(50), contentType || 'all')
        .query(`
            SELECT TOP 1 * FROM approval_chain_templates
            WHERE category = @category AND content_type = @contentType AND is_default = 0
        `);

    if (result.recordset[0]) return result.recordset[0];

    // Try category match with content_type = 'all'
    result = await pool.request()
        .input('category', sql.NVarChar(50), category)
        .query(`
            SELECT TOP 1 * FROM approval_chain_templates
            WHERE category = @category AND content_type = 'all' AND is_default = 0
        `);

    if (result.recordset[0]) return result.recordset[0];

    // Fall back to default
    result = await pool.request()
        .query('SELECT TOP 1 * FROM approval_chain_templates WHERE is_default = 1');

    return result.recordset[0] || null;
}

async function create({ documentId, reviewType, assignedTo = null, dueDate = null, requestedBy = null, commitSha = null, contentHash = null, triggeredByRegId = null, triggeredByDocId = null }) {
    const pool = await poolPromise;

    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .input('reviewType', sql.NVarChar(30), reviewType)
        .input('assignedTo', sql.Int, assignedTo)
        .input('dueDate', sql.Date, dueDate ? new Date(dueDate) : null)
        .input('requestedBy', sql.Int, requestedBy)
        .input('commitSha', sql.NVarChar(40), commitSha)
        .input('contentHash', sql.NVarChar(64), contentHash)
        .input('triggeredByRegId', sql.Int, triggeredByRegId)
        .input('triggeredByDocId', sql.Int, triggeredByDocId)
        .query(`
            INSERT INTO compliance_reviews
                (document_id, review_type, status, assigned_to, due_date, requested_by,
                 requested_at, knowbase_commit_sha, content_hash_at_review,
                 triggered_by_regulatory_source_id, triggered_by_document_id)
            VALUES
                (@documentId, @reviewType, 'pending', @assignedTo, @dueDate, @requestedBy,
                 GETDATE(), @commitSha, @contentHash,
                 @triggeredByRegId, @triggeredByDocId);
            SELECT SCOPE_IDENTITY() AS id;
        `);

    const reviewId = result.recordset[0].id;

    // Auto-populate approval chain from template
    const doc = await pool.request()
        .input('documentId', sql.Int, documentId)
        .query('SELECT category, content_type FROM compliance_documents WHERE id = @documentId');

    if (doc.recordset[0]) {
        const template = await getApprovalTemplate(doc.recordset[0].category, doc.recordset[0].content_type);
        if (template) {
            const chain = JSON.parse(template.chain_definition);
            for (const step of chain) {
                await pool.request()
                    .input('reviewId', sql.Int, reviewId)
                    .input('approverUserId', sql.Int, 0) // placeholder — Pulse resolves role to user
                    .input('approvalOrder', sql.Int, step.order)
                    .query(`
                        INSERT INTO compliance_review_approvals
                            (review_id, approver_user_id, approval_order, status)
                        VALUES
                            (@reviewId, @approverUserId, @approvalOrder, 'pending')
                    `);
            }
        }
    }

    // Update document status
    await pool.request()
        .input('documentId', sql.Int, documentId)
        .query(`UPDATE compliance_documents SET status = 'under-review', updated_at = GETDATE() WHERE id = @documentId`);

    await logAction({
        documentId,
        reviewId,
        action: 'review-initiated',
        performedBy: requestedBy,
        details: { review_type: reviewType, due_date: dueDate }
    });

    return reviewId;
}

async function updateReview(id, updates, userId = null) {
    const pool = await poolPromise;
    const fields = [];
    const request = pool.request().input('id', sql.Int, id);

    const fieldMap = {
        assigned_to: { type: sql.Int, col: 'assigned_to' },
        due_date: { type: sql.Date, col: 'due_date' },
        decision_notes: { type: sql.NVarChar(sql.MAX), col: 'decision_notes' },
        revision_summary: { type: sql.NVarChar(sql.MAX), col: 'revision_summary' },
        knowbase_commit_sha: { type: sql.NVarChar(40), col: 'knowbase_commit_sha' }
    };

    for (const [key, def] of Object.entries(fieldMap)) {
        if (updates[key] !== undefined) {
            let val = updates[key];
            if (def.type === sql.Date && val) val = new Date(val);
            request.input(key, def.type, val);
            fields.push(`${def.col} = @${key}`);
        }
    }

    if (fields.length === 0) return false;
    await request.query(`UPDATE compliance_reviews SET ${fields.join(', ')} WHERE id = @id`);

    // Log assignment if assigned_to changed
    if (updates.assigned_to) {
        const review = await pool.request().input('id', sql.Int, id)
            .query('SELECT document_id FROM compliance_reviews WHERE id = @id');
        if (review.recordset[0]) {
            await logAction({
                documentId: review.recordset[0].document_id,
                reviewId: id,
                action: 'assigned',
                performedBy: userId,
                details: { assigned_to: updates.assigned_to }
            });
        }
    }

    return true;
}

async function approve(reviewId, { userId, comments = null }) {
    const pool = await poolPromise;

    // Find the current pending approval step
    const pendingStep = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query(`
            SELECT TOP 1 * FROM compliance_review_approvals
            WHERE review_id = @reviewId AND status = 'pending'
            ORDER BY approval_order ASC
        `);

    if (pendingStep.recordset[0]) {
        // Mark this step approved
        await pool.request()
            .input('stepId', sql.Int, pendingStep.recordset[0].id)
            .input('userId', sql.Int, userId)
            .input('comments', sql.NVarChar(sql.MAX), comments)
            .query(`
                UPDATE compliance_review_approvals
                SET status = 'approved', approver_user_id = @userId, comments = @comments, acted_at = GETDATE()
                WHERE id = @stepId
            `);
    }

    // Check if all steps are now approved
    const remaining = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query(`
            SELECT COUNT(*) AS cnt FROM compliance_review_approvals
            WHERE review_id = @reviewId AND status = 'pending'
        `);

    const allApproved = remaining.recordset[0].cnt === 0;

    if (allApproved) {
        // Mark review as approved
        await pool.request()
            .input('reviewId', sql.Int, reviewId)
            .input('userId', sql.Int, userId)
            .input('comments', sql.NVarChar(sql.MAX), comments)
            .query(`
                UPDATE compliance_reviews
                SET status = 'approved', completed_at = GETDATE(), completed_by = @userId, decision_notes = @comments
                WHERE id = @reviewId
            `);

        // Update document: mark current, set last reviewed, recalculate next review
        const review = await pool.request()
            .input('reviewId', sql.Int, reviewId)
            .query('SELECT document_id FROM compliance_reviews WHERE id = @reviewId');

        if (review.recordset[0]) {
            await pool.request()
                .input('docId', sql.Int, review.recordset[0].document_id)
                .input('userId', sql.Int, userId)
                .query(`
                    UPDATE compliance_documents
                    SET status = 'current',
                        last_reviewed_date = GETDATE(),
                        last_reviewed_by = @userId,
                        next_review_date = DATEADD(DAY, ISNULL(review_frequency_days, 365), GETDATE()),
                        updated_at = GETDATE()
                    WHERE id = @docId
                `);

            await logAction({
                documentId: review.recordset[0].document_id,
                reviewId,
                action: 'approved',
                performedBy: userId,
                details: { comments, final_approval: true }
            });
        }
    } else {
        // Log intermediate approval
        const review = await pool.request()
            .input('reviewId', sql.Int, reviewId)
            .query('SELECT document_id FROM compliance_reviews WHERE id = @reviewId');

        if (review.recordset[0]) {
            await logAction({
                documentId: review.recordset[0].document_id,
                reviewId,
                action: 'approved',
                performedBy: userId,
                details: { comments, final_approval: false, step: pendingStep.recordset[0]?.approval_order }
            });
        }
    }

    return { allApproved };
}

async function requestRevision(reviewId, { userId, comments }) {
    const pool = await poolPromise;

    await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .input('comments', sql.NVarChar(sql.MAX), comments)
        .query(`
            UPDATE compliance_reviews
            SET status = 'revision-requested', decision_notes = @comments
            WHERE id = @reviewId
        `);

    // Mark current approval step as revision-requested
    await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .input('userId', sql.Int, userId)
        .input('comments', sql.NVarChar(sql.MAX), comments)
        .query(`
            UPDATE TOP (1) compliance_review_approvals
            SET status = 'revision-requested', approver_user_id = @userId, comments = @comments, acted_at = GETDATE()
            WHERE review_id = @reviewId AND status = 'pending'
        `);

    // Update document status
    const review = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query('SELECT document_id FROM compliance_reviews WHERE id = @reviewId');

    if (review.recordset[0]) {
        await pool.request()
            .input('docId', sql.Int, review.recordset[0].document_id)
            .query(`UPDATE compliance_documents SET status = 'revision-pending', updated_at = GETDATE() WHERE id = @docId`);

        await logAction({
            documentId: review.recordset[0].document_id,
            reviewId,
            action: 'revision-requested',
            performedBy: userId,
            details: { comments }
        });
    }

    return true;
}

async function reject(reviewId, { userId, comments }) {
    const pool = await poolPromise;

    await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .input('userId', sql.Int, userId)
        .input('comments', sql.NVarChar(sql.MAX), comments)
        .query(`
            UPDATE compliance_reviews
            SET status = 'rejected', completed_at = GETDATE(), completed_by = @userId, decision_notes = @comments
            WHERE id = @reviewId
        `);

    const review = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query('SELECT document_id FROM compliance_reviews WHERE id = @reviewId');

    if (review.recordset[0]) {
        await logAction({
            documentId: review.recordset[0].document_id,
            reviewId,
            action: 'rejected',
            performedBy: userId,
            details: { comments }
        });
    }

    return true;
}

async function recommendSunset(reviewId, { userId, comments }) {
    const pool = await poolPromise;

    await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .input('userId', sql.Int, userId)
        .input('comments', sql.NVarChar(sql.MAX), comments)
        .query(`
            UPDATE compliance_reviews
            SET status = 'recommend-sunset', completed_at = GETDATE(), completed_by = @userId, decision_notes = @comments
            WHERE id = @reviewId
        `);

    const review = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query('SELECT document_id FROM compliance_reviews WHERE id = @reviewId');

    if (review.recordset[0]) {
        await logAction({
            documentId: review.recordset[0].document_id,
            reviewId,
            action: 'recommend-sunset',
            performedBy: userId,
            details: { comments }
        });
    }

    return true;
}

module.exports = { list, getById, getApprovalTemplate, create, updateReview, approve, requestRevision, reject, recommendSunset };
