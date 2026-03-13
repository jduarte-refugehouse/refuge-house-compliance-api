// services/regulatory-sources.js - Regulatory source registry + mappings
const { poolPromise, sql } = require('./db');
const { logAction } = require('./compliance-history');

async function list({ authority, status, limit = 100, offset = 0 }) {
    const pool = await poolPromise;
    const request = pool.request();
    let where = ['1=1'];

    if (authority) {
        request.input('authority', sql.NVarChar(100), authority);
        where.push('authority = @authority');
    }
    if (status) {
        request.input('status', sql.NVarChar(30), status);
        where.push('status = @status');
    }

    request.input('limit', sql.Int, limit);
    request.input('offset', sql.Int, offset);

    const result = await request.query(`
        SELECT *
        FROM regulatory_sources
        WHERE ${where.join(' AND ')}
        ORDER BY authority, reference_code
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
}

async function getById(id) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('id', sql.Int, id)
        .query('SELECT * FROM regulatory_sources WHERE id = @id');
    return result.recordset[0] || null;
}

async function create(reg) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('authority', sql.NVarChar(100), reg.authority)
        .input('referenceCode', sql.NVarChar(100), reg.reference_code || null)
        .input('title', sql.NVarChar(300), reg.title)
        .input('description', sql.NVarChar(sql.MAX), reg.description || null)
        .input('sourceUrl', sql.NVarChar(500), reg.source_url || null)
        .input('effectiveDate', sql.Date, reg.effective_date ? new Date(reg.effective_date) : null)
        .input('lastUpdated', sql.Date, reg.last_updated ? new Date(reg.last_updated) : null)
        .input('status', sql.NVarChar(30), reg.status || 'active')
        .input('knowbasePath', sql.NVarChar(500), reg.knowbase_path || null)
        .query(`
            INSERT INTO regulatory_sources
                (authority, reference_code, title, description, source_url,
                 effective_date, last_updated, status, knowbase_path)
            VALUES
                (@authority, @referenceCode, @title, @description, @sourceUrl,
                 @effectiveDate, @lastUpdated, @status, @knowbasePath);
            SELECT SCOPE_IDENTITY() AS id;
        `);
    return result.recordset[0].id;
}

async function update(id, updates) {
    const pool = await poolPromise;
    const fields = [];
    const request = pool.request().input('id', sql.Int, id);

    const fieldMap = {
        authority: { type: sql.NVarChar(100), col: 'authority' },
        reference_code: { type: sql.NVarChar(100), col: 'reference_code' },
        title: { type: sql.NVarChar(300), col: 'title' },
        description: { type: sql.NVarChar(sql.MAX), col: 'description' },
        source_url: { type: sql.NVarChar(500), col: 'source_url' },
        effective_date: { type: sql.Date, col: 'effective_date' },
        last_updated: { type: sql.Date, col: 'last_updated' },
        status: { type: sql.NVarChar(30), col: 'status' },
        knowbase_path: { type: sql.NVarChar(500), col: 'knowbase_path' }
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
    fields.push('updated_at = GETDATE()');

    await request.query(`UPDATE regulatory_sources SET ${fields.join(', ')} WHERE id = @id`);
    return true;
}

async function getDocuments(regulatorySourceId) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('regId', sql.Int, regulatorySourceId)
        .query(`
            SELECT drm.*, d.title AS document_title, d.document_path, d.category,
                   d.content_type, d.status AS document_status
            FROM document_regulatory_mappings drm
            JOIN compliance_documents d ON d.id = drm.document_id
            WHERE drm.regulatory_source_id = @regId
            ORDER BY d.category, d.title
        `);
    return result.recordset;
}

async function addMapping({ documentId, regulatorySourceId, mappingType = 'implements', notes = null }) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .input('regId', sql.Int, regulatorySourceId)
        .input('mappingType', sql.NVarChar(30), mappingType)
        .input('notes', sql.NVarChar(500), notes)
        .query(`
            INSERT INTO document_regulatory_mappings (document_id, regulatory_source_id, mapping_type, notes)
            VALUES (@documentId, @regId, @mappingType, @notes);
            SELECT SCOPE_IDENTITY() AS id;
        `);
    return result.recordset[0].id;
}

async function removeMapping(id) {
    const pool = await poolPromise;
    await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM document_regulatory_mappings WHERE id = @id');
    return true;
}

/**
 * Record a regulatory change — triggers reviews on all mapped documents.
 * Returns the list of affected document IDs.
 */
async function recordChange(regulatorySourceId, { changeDescription, userId = null }) {
    const pool = await poolPromise;

    // Update the regulation's last_updated
    await pool.request()
        .input('id', sql.Int, regulatorySourceId)
        .input('status', sql.NVarChar(30), 'amended')
        .query(`UPDATE regulatory_sources SET last_updated = GETDATE(), status = @status, updated_at = GETDATE() WHERE id = @id`);

    // Find all mapped documents
    const mapped = await pool.request()
        .input('regId', sql.Int, regulatorySourceId)
        .query(`
            SELECT drm.document_id, d.title, d.document_path
            FROM document_regulatory_mappings drm
            JOIN compliance_documents d ON d.id = drm.document_id
            WHERE drm.regulatory_source_id = @regId AND d.status NOT IN ('sunset', 'archived')
        `);

    const affectedDocIds = [];

    // Create a review for each affected document
    for (const doc of mapped.recordset) {
        const reviewResult = await pool.request()
            .input('documentId', sql.Int, doc.document_id)
            .input('reviewType', sql.NVarChar(30), 'regulatory-change')
            .input('triggeredByRegId', sql.Int, regulatorySourceId)
            .input('requestedBy', sql.Int, userId)
            .query(`
                INSERT INTO compliance_reviews
                    (document_id, review_type, status, triggered_by_regulatory_source_id, requested_by, requested_at)
                VALUES
                    (@documentId, @reviewType, 'pending', @triggeredByRegId, @requestedBy, GETDATE());
                SELECT SCOPE_IDENTITY() AS id;
            `);

        await logAction({
            documentId: doc.document_id,
            reviewId: reviewResult.recordset[0].id,
            action: 'regulatory-change-detected',
            performedBy: userId,
            details: { regulatory_source_id: regulatorySourceId, change_description: changeDescription }
        });

        affectedDocIds.push(doc.document_id);
    }

    // Notify Pulse about the regulatory change
    try {
        const { notifyRegulatoryChange } = require('./pulse-notifier');
        const regulation = await getById(regulatorySourceId);
        await notifyRegulatoryChange(regulation, mapped.recordset);
    } catch (err) {
        console.warn('[REGULATORY] Failed to notify Pulse:', err.message);
    }

    return { affectedDocumentIds: affectedDocIds, affectedDocuments: mapped.recordset };
}

module.exports = { list, getById, create, update, getDocuments, addMapping, removeMapping, recordChange };
