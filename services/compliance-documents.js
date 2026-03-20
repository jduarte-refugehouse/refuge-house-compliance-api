// services/compliance-documents.js - Document registry CRUD + lifecycle
const { poolPromise, sql } = require('./db');
const { logAction } = require('./compliance-history');

async function list({ category, contentType, status, servicePackages, limit = 100, offset = 0 }) {
    const pool = await poolPromise;
    const request = pool.request();
    let where = ['1=1'];

    if (category) {
        request.input('category', sql.NVarChar(50), category);
        where.push('category = @category');
    }
    if (contentType) {
        request.input('contentType', sql.NVarChar(50), contentType);
        where.push('content_type = @contentType');
    }
    if (status) {
        request.input('status', sql.NVarChar(30), status);
        where.push('status = @status');
    }
    if (servicePackages) {
        request.input('servicePackages', sql.NVarChar(500), `%${servicePackages}%`);
        where.push('service_packages LIKE @servicePackages');
    }

    request.input('limit', sql.Int, limit);
    request.input('offset', sql.Int, offset);

    const result = await request.query(`
        SELECT *
        FROM compliance_documents
        WHERE ${where.join(' AND ')}
        ORDER BY title
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    return result.recordset;
}

async function getById(id) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('id', sql.Int, id)
        .query('SELECT * FROM compliance_documents WHERE id = @id');
    return result.recordset[0] || null;
}

async function getByPath(documentPath) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('path', sql.NVarChar(500), documentPath)
        .query('SELECT * FROM compliance_documents WHERE document_path = @path');
    return result.recordset[0] || null;
}

async function create(doc, userId = null) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentPath', sql.NVarChar(500), doc.document_path)
        .input('title', sql.NVarChar(300), doc.title)
        .input('category', sql.NVarChar(50), doc.category)
        .input('contentType', sql.NVarChar(50), doc.content_type || null)
        .input('servicePackages', sql.NVarChar(500), doc.service_packages || null)
        .input('ownerUserId', sql.Int, doc.owner_user_id || null)
        .input('reviewFrequencyDays', sql.Int, doc.review_frequency_days || null)
        .input('nextReviewDate', sql.Date, doc.next_review_date ? new Date(doc.next_review_date) : null)
        .input('status', sql.NVarChar(30), doc.status || 'draft')
        .input('effectiveDate', sql.Date, doc.effective_date ? new Date(doc.effective_date) : null)
        .input('contentHash', sql.NVarChar(64), doc.content_hash || null)
        .query(`
            INSERT INTO compliance_documents
                (document_path, title, category, content_type, service_packages,
                 owner_user_id, review_frequency_days, next_review_date, status,
                 effective_date, content_hash)
            VALUES
                (@documentPath, @title, @category, @contentType, @servicePackages,
                 @ownerUserId, @reviewFrequencyDays, @nextReviewDate, @status,
                 @effectiveDate, @contentHash);
            SELECT SCOPE_IDENTITY() AS id;
        `);

    const newId = result.recordset[0].id;

    await logAction({
        documentId: newId,
        action: 'document-registered',
        performedBy: userId,
        details: { title: doc.title, category: doc.category, document_path: doc.document_path }
    });

    return newId;
}

async function update(id, updates, userId = null) {
    const pool = await poolPromise;
    const fields = [];
    const request = pool.request().input('id', sql.Int, id);

    const fieldMap = {
        title: { type: sql.NVarChar(300), col: 'title' },
        category: { type: sql.NVarChar(50), col: 'category' },
        content_type: { type: sql.NVarChar(50), col: 'content_type' },
        service_packages: { type: sql.NVarChar(500), col: 'service_packages' },
        owner_user_id: { type: sql.Int, col: 'owner_user_id' },
        review_frequency_days: { type: sql.Int, col: 'review_frequency_days' },
        next_review_date: { type: sql.Date, col: 'next_review_date' },
        last_reviewed_date: { type: sql.Date, col: 'last_reviewed_date' },
        last_reviewed_by: { type: sql.Int, col: 'last_reviewed_by' },
        status: { type: sql.NVarChar(30), col: 'status' },
        effective_date: { type: sql.Date, col: 'effective_date' },
        content_hash: { type: sql.NVarChar(64), col: 'content_hash' },
        version: { type: sql.Int, col: 'version' },
        superseded_by: { type: sql.Int, col: 'superseded_by' },
        sunset_reason: { type: sql.NVarChar(500), col: 'sunset_reason' },
        sunset_date: { type: sql.Date, col: 'sunset_date' }
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

    await request.query(`UPDATE compliance_documents SET ${fields.join(', ')} WHERE id = @id`);

    await logAction({
        documentId: id,
        action: 'document-updated',
        performedBy: userId,
        details: { updated_fields: Object.keys(updates) }
    });

    return true;
}

async function sunset(id, { reason, supersededBy = null, userId = null }) {
    const pool = await poolPromise;
    const request = pool.request()
        .input('id', sql.Int, id)
        .input('reason', sql.NVarChar(500), reason)
        .input('supersededBy', sql.Int, supersededBy)
        .input('sunsetDate', sql.Date, new Date());

    await request.query(`
        UPDATE compliance_documents
        SET status = 'sunset',
            sunset_reason = @reason,
            superseded_by = @supersededBy,
            sunset_date = @sunsetDate,
            updated_at = GETDATE()
        WHERE id = @id
    `);

    await logAction({
        documentId: id,
        action: 'sunset-initiated',
        performedBy: userId,
        details: { reason, superseded_by: supersededBy }
    });

    return true;
}

async function getDependencies(id) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT dd.*,
                   p.title AS parent_title, p.document_path AS parent_path,
                   c.title AS dependent_title, c.document_path AS dependent_path
            FROM document_dependencies dd
            JOIN compliance_documents p ON p.id = dd.parent_document_id
            JOIN compliance_documents c ON c.id = dd.dependent_document_id
            WHERE dd.parent_document_id = @id OR dd.dependent_document_id = @id
            ORDER BY dd.dependency_type
        `);
    return result.recordset;
}

async function addDependency({ parentDocumentId, dependentDocumentId, dependencyType, notes = null }) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('parentId', sql.Int, parentDocumentId)
        .input('dependentId', sql.Int, dependentDocumentId)
        .input('type', sql.NVarChar(30), dependencyType)
        .input('notes', sql.NVarChar(500), notes)
        .query(`
            INSERT INTO document_dependencies (parent_document_id, dependent_document_id, dependency_type, notes)
            VALUES (@parentId, @dependentId, @type, @notes);
            SELECT SCOPE_IDENTITY() AS id;
        `);
    return result.recordset[0].id;
}

async function removeDependency(id) {
    const pool = await poolPromise;
    await pool.request()
        .input('id', sql.Int, id)
        .query('DELETE FROM document_dependencies WHERE id = @id');
    return true;
}

async function getRegulations(documentId) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .query(`
            SELECT drm.*, rs.authority, rs.reference_code, rs.title AS regulation_title,
                   rs.description AS regulation_description, rs.status AS regulation_status
            FROM document_regulatory_mappings drm
            JOIN regulatory_sources rs ON rs.id = drm.regulatory_source_id
            WHERE drm.document_id = @documentId
            ORDER BY rs.authority, rs.reference_code
        `);
    return result.recordset;
}

module.exports = { list, getById, getByPath, create, update, sunset, getDependencies, addDependency, removeDependency, getRegulations };
