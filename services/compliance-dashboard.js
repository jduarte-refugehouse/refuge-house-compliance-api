// services/compliance-dashboard.js - Timeline, overdue, and dashboard stats
const { poolPromise, sql } = require('./db');

async function getDashboard() {
    const pool = await poolPromise;

    // Document counts by status
    const statusCounts = await pool.request().query(`
        SELECT status, COUNT(*) AS count
        FROM compliance_documents
        GROUP BY status
    `);

    // Document counts by category
    const categoryCounts = await pool.request().query(`
        SELECT category, status, COUNT(*) AS count
        FROM compliance_documents
        GROUP BY category, status
        ORDER BY category, status
    `);

    // Overdue count
    const overdue = await pool.request().query(`
        SELECT COUNT(*) AS count
        FROM compliance_documents
        WHERE next_review_date < GETDATE()
          AND status NOT IN ('sunset', 'archived', 'deprecated', 'under-review')
    `);

    // Active reviews
    const activeReviews = await pool.request().query(`
        SELECT status, COUNT(*) AS count
        FROM compliance_reviews
        WHERE status IN ('pending', 'in-progress', 'revision-requested')
        GROUP BY status
    `);

    return {
        documents: {
            by_status: statusCounts.recordset,
            by_category: categoryCounts.recordset,
            overdue: overdue.recordset[0].count
        },
        active_reviews: activeReviews.recordset
    };
}

async function getTimeline({ days = 90 }) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('days', sql.Int, days)
        .query(`
            SELECT id, title, document_path, category, content_type, status,
                   next_review_date, review_frequency_days, owner_user_id,
                   DATEDIFF(DAY, GETDATE(), next_review_date) AS days_until_due
            FROM compliance_documents
            WHERE next_review_date IS NOT NULL
              AND next_review_date <= DATEADD(DAY, @days, GETDATE())
              AND status NOT IN ('sunset', 'archived', 'deprecated')
            ORDER BY next_review_date ASC
        `);
    return result.recordset;
}

async function getOverdue() {
    const pool = await poolPromise;
    const result = await pool.request()
        .query(`
            SELECT id, title, document_path, category, content_type, status,
                   next_review_date, review_frequency_days, owner_user_id,
                   DATEDIFF(DAY, next_review_date, GETDATE()) AS days_overdue
            FROM compliance_documents
            WHERE next_review_date < GETDATE()
              AND status NOT IN ('sunset', 'archived', 'deprecated', 'under-review')
            ORDER BY next_review_date ASC
        `);
    return result.recordset;
}

async function getRegulatoryDashboard() {
    const pool = await poolPromise;

    // Regulations without any mapped documents
    const unmapped = await pool.request().query(`
        SELECT rs.*
        FROM regulatory_sources rs
        LEFT JOIN document_regulatory_mappings drm ON drm.regulatory_source_id = rs.id
        WHERE drm.id IS NULL AND rs.status = 'active'
        ORDER BY rs.authority, rs.reference_code
    `);

    // Documents without any mapped regulations
    const unmappedDocs = await pool.request().query(`
        SELECT d.id, d.title, d.document_path, d.category, d.content_type
        FROM compliance_documents d
        LEFT JOIN document_regulatory_mappings drm ON drm.document_id = d.id
        WHERE drm.id IS NULL
          AND d.status NOT IN ('sunset', 'archived', 'deprecated')
          AND d.category != 'general'
        ORDER BY d.category, d.title
    `);

    // Regulation coverage summary
    const coverage = await pool.request().query(`
        SELECT rs.authority, COUNT(DISTINCT drm.document_id) AS mapped_documents
        FROM regulatory_sources rs
        LEFT JOIN document_regulatory_mappings drm ON drm.regulatory_source_id = rs.id
        WHERE rs.status = 'active'
        GROUP BY rs.authority
        ORDER BY rs.authority
    `);

    return {
        unmapped_regulations: unmapped.recordset,
        unmapped_documents: unmappedDocs.recordset,
        coverage_by_authority: coverage.recordset
    };
}

module.exports = { getDashboard, getTimeline, getOverdue, getRegulatoryDashboard };
