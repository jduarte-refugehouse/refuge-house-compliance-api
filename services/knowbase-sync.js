// services/knowbase-sync.js - Sync knowbase documents into compliance_documents registry
// Runs after syncKnowbase() to detect new, changed, and removed documents.
// This bridges the knowbase (source of truth for content) with the compliance
// workflow (source of truth for review state, regulatory mappings, approvals).
const crypto = require('crypto');
const { poolPromise, sql } = require('./db');
const { getAllDocuments } = require('./knowbase-loader');
const { logAction } = require('./compliance-history');

/**
 * Compute a full SHA-256 hash (matching compliance_documents.content_hash).
 */
function computeHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Derive a human-readable title from a document path.
 * e.g. "policies/medication-management.md" → "Medication Management"
 */
function titleFromPath(docPath) {
    const basename = docPath.split('/').pop().replace(/\.md$/i, '');
    return basename
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Derive category from the knowbase document's category field.
 * Maps knowbase categories to compliance_documents categories.
 */
function mapCategory(knowbaseCategory) {
    const map = {
        'policy': 'policy',
        'regulatory': 'regulatory',
        'treatment-model': 'treatment-model',
        'guide': 'guide',
        'template': 'template',
        'training': 'training',
        'general': 'operational'
    };
    return map[knowbaseCategory] || 'operational';
}

/**
 * Default review frequency in days based on category.
 */
function defaultFrequency(category) {
    const frequencies = {
        'policy': 365,
        'regulatory': null,    // reviewed when authority updates
        'treatment-model': 365,
        'guide': 180,
        'template': 365,
        'training': 365,
        'operational': 180,
        'cqi': 90
    };
    return frequencies[category] || 365;
}

/**
 * Run the compliance sync after a knowbase refresh.
 * Compares knowbase documents against the compliance_documents registry:
 * - New docs → auto-register with status 'draft'
 * - Changed docs (hash mismatch) → log change, create review if configured
 * - Removed docs → flag for sunset review
 *
 * @param {object} [options]
 * @param {boolean} [options.autoRegister=true] - Register new docs automatically
 * @param {boolean} [options.autoReviewOnChange=true] - Create reviews when content changes
 * @param {boolean} [options.autoSunsetOnRemove=true] - Flag removed docs for sunset
 * @returns {Promise<object>} Sync results
 */
async function syncComplianceRegistry(options = {}) {
    const {
        autoRegister = true,
        autoReviewOnChange = true,
        autoSunsetOnRemove = true
    } = options;

    let pool;
    try {
        pool = await poolPromise;
    } catch (err) {
        console.warn('[KNOWBASE-SYNC] Database not available, skipping compliance sync:', err.message);
        return { skipped: true, reason: 'database not available' };
    }

    const knowbaseDocs = getAllDocuments();
    const knowbasePaths = new Set(Object.keys(knowbaseDocs));

    // Get all registered compliance documents
    const registered = await pool.request().query(
        `SELECT id, document_path, content_hash, status, title, category
         FROM compliance_documents
         WHERE status NOT IN ('sunset', 'archived')`
    );

    const registeredByPath = {};
    for (const row of registered.recordset) {
        registeredByPath[row.document_path] = row;
    }
    const registeredPaths = new Set(Object.keys(registeredByPath));

    const results = {
        new_documents: [],
        changed_documents: [],
        removed_documents: [],
        unchanged: 0,
        errors: []
    };

    // ── Detect NEW documents ────────────────────────────────────────────
    if (autoRegister) {
        for (const docPath of knowbasePaths) {
            if (registeredPaths.has(docPath)) continue;

            const doc = knowbaseDocs[docPath];
            const category = mapCategory(doc.category);
            const hash = computeHash(doc.content);
            const freq = defaultFrequency(category);

            try {
                const result = await pool.request()
                    .input('documentPath', sql.NVarChar(500), docPath)
                    .input('title', sql.NVarChar(300), titleFromPath(docPath))
                    .input('category', sql.NVarChar(50), category)
                    .input('status', sql.NVarChar(30), 'draft')
                    .input('contentHash', sql.NVarChar(64), hash)
                    .input('reviewFrequencyDays', sql.Int, freq)
                    .query(`
                        INSERT INTO compliance_documents
                            (document_path, title, category, status, content_hash, review_frequency_days)
                        VALUES
                            (@documentPath, @title, @category, @status, @contentHash, @reviewFrequencyDays);
                        SELECT SCOPE_IDENTITY() AS id;
                    `);

                const newId = result.recordset[0].id;

                await logAction({
                    documentId: newId,
                    action: 'auto-registered',
                    details: { document_path: docPath, category, content_hash: hash }
                });

                results.new_documents.push({ id: newId, path: docPath, category });
                console.log(`[KNOWBASE-SYNC] Auto-registered: ${docPath} (${category})`);
            } catch (err) {
                // Skip duplicate key errors (race condition protection)
                if (!err.message?.includes('UNIQUE')) {
                    console.error(`[KNOWBASE-SYNC] Failed to register ${docPath}:`, err.message);
                    results.errors.push({ path: docPath, action: 'register', error: err.message });
                }
            }
        }
    }

    // ── Detect CHANGED documents ────────────────────────────────────────
    for (const docPath of knowbasePaths) {
        if (!registeredPaths.has(docPath)) continue;

        const doc = knowbaseDocs[docPath];
        const registered = registeredByPath[docPath];
        const currentHash = computeHash(doc.content);

        if (registered.content_hash && registered.content_hash !== currentHash) {
            // Content changed
            const oldHash = registered.content_hash;

            // Update the hash in the registry
            await pool.request()
                .input('id', sql.Int, registered.id)
                .input('hash', sql.NVarChar(64), currentHash)
                .query(`UPDATE compliance_documents SET content_hash = @hash, updated_at = GETDATE() WHERE id = @id`);

            await logAction({
                documentId: registered.id,
                action: 'content-changed-detected',
                details: { old_hash: oldHash, new_hash: currentHash, document_path: docPath }
            });

            results.changed_documents.push({
                id: registered.id,
                path: docPath,
                old_hash: oldHash,
                new_hash: currentHash
            });

            // Auto-create a review for the change
            if (autoReviewOnChange && registered.status !== 'under-review') {
                try {
                    const reviewResult = await pool.request()
                        .input('documentId', sql.Int, registered.id)
                        .input('reviewType', sql.NVarChar(30), 'content-change-detected')
                        .input('contentHash', sql.NVarChar(64), currentHash)
                        .query(`
                            INSERT INTO compliance_reviews
                                (document_id, review_type, status, content_hash_at_review, requested_at)
                            VALUES
                                (@documentId, @reviewType, 'pending', @contentHash, GETDATE());
                            SELECT SCOPE_IDENTITY() AS id;
                        `);

                    await pool.request()
                        .input('id', sql.Int, registered.id)
                        .query(`UPDATE compliance_documents SET status = 'under-review', updated_at = GETDATE() WHERE id = @id`);

                    console.log(`[KNOWBASE-SYNC] Content change detected, review created: ${docPath}`);
                } catch (err) {
                    console.error(`[KNOWBASE-SYNC] Failed to create change review for ${docPath}:`, err.message);
                    results.errors.push({ path: docPath, action: 'create-review', error: err.message });
                }
            } else {
                console.log(`[KNOWBASE-SYNC] Content change detected (no auto-review): ${docPath}`);
            }
        } else {
            results.unchanged++;
        }
    }

    // ── Detect REMOVED documents ────────────────────────────────────────
    if (autoSunsetOnRemove) {
        for (const docPath of registeredPaths) {
            if (knowbasePaths.has(docPath)) continue;

            const registered = registeredByPath[docPath];

            // Don't re-flag docs already in sunset/review
            if (['under-review', 'sunset', 'archived', 'deprecated'].includes(registered.status)) {
                continue;
            }

            try {
                // Create a sunset-review
                const reviewResult = await pool.request()
                    .input('documentId', sql.Int, registered.id)
                    .input('reviewType', sql.NVarChar(30), 'relevance-review')
                    .query(`
                        INSERT INTO compliance_reviews
                            (document_id, review_type, status, requested_at)
                        VALUES
                            (@documentId, @reviewType, 'pending', GETDATE());
                        SELECT SCOPE_IDENTITY() AS id;
                    `);

                await pool.request()
                    .input('id', sql.Int, registered.id)
                    .query(`UPDATE compliance_documents SET status = 'under-review', updated_at = GETDATE() WHERE id = @id`);

                await logAction({
                    documentId: registered.id,
                    action: 'removed-from-knowbase',
                    reviewId: reviewResult.recordset[0].id,
                    details: { document_path: docPath, reason: 'Document no longer present in knowbase repository' }
                });

                results.removed_documents.push({ id: registered.id, path: docPath });
                console.log(`[KNOWBASE-SYNC] Document removed from knowbase, flagged for review: ${docPath}`);
            } catch (err) {
                console.error(`[KNOWBASE-SYNC] Failed to flag removed doc ${docPath}:`, err.message);
                results.errors.push({ path: docPath, action: 'flag-removed', error: err.message });
            }
        }
    }

    console.log(`[KNOWBASE-SYNC] Sync complete: ${results.new_documents.length} new, ${results.changed_documents.length} changed, ${results.removed_documents.length} removed, ${results.unchanged} unchanged`);

    // Notify Pulse about sync results
    try {
        const { notifySyncResults } = require('./pulse-notifier');
        await notifySyncResults(results);
    } catch (err) {
        console.warn('[KNOWBASE-SYNC] Failed to notify Pulse:', err.message);
    }

    return results;
}

module.exports = { syncComplianceRegistry };
