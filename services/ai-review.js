// services/ai-review.js - AI-assisted compliance review and regulatory impact analysis
// Uses the same Anthropic client pattern as evaluator.js and plan-generator.js.
const Anthropic = require('@anthropic-ai/sdk');
const { poolPromise, sql } = require('./db');
const { getDocument, refreshIfStale, formatDocumentsAsContext } = require('./knowbase-loader');
const { logAction } = require('./compliance-history');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

if (!ANTHROPIC_API_KEY) {
    console.warn('[AI-REVIEW] ANTHROPIC_COMPLIANCE_KEY not set. AI review features will fail.');
}

let _client = null;
function getClient() {
    if (!_client) {
        if (!ANTHROPIC_API_KEY) {
            throw new Error('ANTHROPIC_COMPLIANCE_KEY environment variable is not set');
        }
        _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    }
    return _client;
}

// ── AI-Assisted Document Review ────────────────────────────────────────────

const REVIEW_SYSTEM_PROMPT = `You are a compliance review analyst for Refuge House, a Texas-licensed Child Placing Agency (CPA) operating under T3C (Texas Child-Centered Care) contracts.

You are reviewing an internal document against the regulations it must comply with. Your job is to identify:
1. COMPLIANCE GAPS — requirements in the regulations that the document does not address
2. OUTDATED REFERENCES — citations to repealed, amended, or obsolete regulations
3. CONFLICTS — statements that contradict other documents or regulatory requirements
4. MISSING COVERAGE — regulatory requirements this document should address but doesn't
5. STRENGTHS — areas where the document clearly meets or exceeds requirements

RULES:
- Only flag issues that are supported by the regulation text provided. Never fabricate requirements.
- Be specific: cite the exact regulation section and the exact paragraph/section in the document.
- Categorize each finding by severity: CRITICAL, WARNING, RECOMMENDATION, or COMPLIANT.
- Focus on substance, not style. Don't flag formatting unless it causes ambiguity.

RESPONSE FORMAT:
Return a JSON object:
{
  "summary": "2-3 sentence overall assessment",
  "overallStatus": "compliant | needs-attention | non-compliant",
  "findings": [
    {
      "severity": "CRITICAL | WARNING | RECOMMENDATION | COMPLIANT",
      "area": "Short label",
      "finding": "What was found",
      "regulation": "The regulation section that applies",
      "documentSection": "The section in the document (heading or paragraph)",
      "action": "What needs to change (null if COMPLIANT)"
    }
  ],
  "regulationsCovered": ["List of regulation codes fully addressed"],
  "regulationsGapped": ["List of regulation codes not fully addressed"]
}`;

/**
 * Run an AI-assisted review of a compliance document against its mapped regulations.
 *
 * @param {number} reviewId - The compliance_reviews.id being analyzed
 * @param {object} [options]
 * @param {string} [options.focusAreas] - Specific areas to focus on
 * @returns {Promise<object>} Structured AI findings
 */
async function analyzeReview(reviewId, options = {}) {
    await refreshIfStale();

    const pool = await poolPromise;

    // Get the review + document info
    const reviewResult = await pool.request()
        .input('reviewId', sql.Int, reviewId)
        .query(`
            SELECT r.*, d.title AS doc_title, d.document_path, d.category, d.content_type
            FROM compliance_reviews r
            JOIN compliance_documents d ON d.id = r.document_id
            WHERE r.id = @reviewId
        `);

    if (!reviewResult.recordset[0]) {
        throw new Error(`Review ${reviewId} not found`);
    }

    const review = reviewResult.recordset[0];

    // Get the document content from knowbase
    const docContent = getDocument(review.document_path);
    if (!docContent) {
        throw new Error(`Document not found in knowbase: ${review.document_path}`);
    }

    // Get all mapped regulations and their knowbase content
    const regulations = await pool.request()
        .input('documentId', sql.Int, review.document_id)
        .query(`
            SELECT rs.authority, rs.reference_code, rs.title, rs.description,
                   rs.knowbase_path, drm.mapping_type, drm.notes AS mapping_notes
            FROM document_regulatory_mappings drm
            JOIN regulatory_sources rs ON rs.id = drm.regulatory_source_id
            WHERE drm.document_id = @documentId
            ORDER BY rs.authority, rs.reference_code
        `);

    // Build context: the document + all regulation texts
    let userPrompt = `=== DOCUMENT UNDER REVIEW ===\n`;
    userPrompt += `Title: ${review.doc_title}\n`;
    userPrompt += `Path: ${review.document_path}\n`;
    userPrompt += `Category: ${review.category}\n`;
    userPrompt += `Review Type: ${review.review_type}\n\n`;
    userPrompt += docContent.content;
    userPrompt += `\n\n=== APPLICABLE REGULATIONS ===\n\n`;

    for (const reg of regulations.recordset) {
        userPrompt += `--- ${reg.authority} ${reg.reference_code || ''}: ${reg.title} ---\n`;
        userPrompt += `Mapping: ${reg.mapping_type}\n`;
        if (reg.description) userPrompt += `Summary: ${reg.description}\n`;

        // If regulation text exists in knowbase, include it
        if (reg.knowbase_path) {
            const regDoc = getDocument(reg.knowbase_path);
            if (regDoc) {
                userPrompt += `\nFull regulation text:\n${regDoc.content}\n`;
            }
        }
        userPrompt += `\n`;
    }

    if (options.focusAreas) {
        userPrompt += `\n=== FOCUS AREAS ===\nPay particular attention to: ${options.focusAreas}\n`;
    }

    userPrompt += `\nPlease review this document against the regulations listed above. Return your findings as JSON.`;

    // Call Claude
    const client = getClient();
    const startTime = Date.now();

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: REVIEW_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
    });

    const elapsed = Date.now() - startTime;
    console.log(`[AI-REVIEW] Review ${reviewId} analyzed in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    // Parse response
    const responseText = response.content[0]?.text || '';
    let analysis;

    try {
        let jsonText = responseText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
        }
        analysis = JSON.parse(jsonText);
    } catch (parseErr) {
        console.error('[AI-REVIEW] Failed to parse response as JSON:', parseErr.message);
        analysis = {
            summary: 'Analysis completed but response could not be parsed as structured JSON.',
            overallStatus: 'unknown',
            rawResponse: responseText,
            findings: []
        };
    }

    // Add metadata
    analysis._meta = {
        reviewId,
        documentId: review.document_id,
        documentPath: review.document_path,
        regulationsAnalyzed: regulations.recordset.length,
        model: CLAUDE_MODEL,
        responseTimeMs: elapsed,
        inputTokens: response.usage?.input_tokens || null,
        outputTokens: response.usage?.output_tokens || null,
        timestamp: new Date().toISOString()
    };

    // Log the AI analysis action
    await logAction({
        documentId: review.document_id,
        reviewId,
        action: 'ai-analysis-completed',
        details: {
            overall_status: analysis.overallStatus,
            findings_count: analysis.findings?.length || 0,
            regulations_analyzed: regulations.recordset.length
        }
    });

    return analysis;
}

// ── Regulatory Impact Analysis ─────────────────────────────────────────────

const IMPACT_SYSTEM_PROMPT = `You are a regulatory impact analyst for Refuge House, a Texas-licensed Child Placing Agency (CPA).

A regulation has been changed or updated. Your job is to analyze the impact on each affected internal document and provide specific guidance on what needs to change.

For each document, identify:
1. Which sections are directly affected by the regulatory change
2. What specifically needs to be updated, added, or removed
3. Whether the document can be patched or needs a full rewrite of certain sections
4. Priority level for the update

RESPONSE FORMAT:
Return a JSON object:
{
  "summary": "Overall impact assessment (2-3 sentences)",
  "impactLevel": "high | medium | low",
  "affectedDocuments": [
    {
      "documentPath": "path/to/doc.md",
      "documentTitle": "Title",
      "impactLevel": "high | medium | low",
      "affectedSections": ["Section 1", "Section 3"],
      "changes": [
        {
          "type": "update | add | remove",
          "section": "Which section",
          "description": "What specifically needs to change",
          "currentText": "Brief quote of what's there now (if applicable)",
          "suggestedText": "Suggested replacement or addition"
        }
      ],
      "notes": "Any additional context"
    }
  ]
}`;

/**
 * Analyze the impact of a regulatory change on all mapped documents.
 *
 * @param {number} regulatorySourceId
 * @param {string} changeDescription - What changed in the regulation
 * @param {object} [options]
 * @param {string} [options.focusAreas]
 * @returns {Promise<object>} Structured impact analysis
 */
async function analyzeRegulatoryImpact(regulatorySourceId, changeDescription, options = {}) {
    await refreshIfStale();

    const pool = await poolPromise;

    // Get the regulation info
    const regResult = await pool.request()
        .input('id', sql.Int, regulatorySourceId)
        .query('SELECT * FROM regulatory_sources WHERE id = @id');

    if (!regResult.recordset[0]) {
        throw new Error(`Regulatory source ${regulatorySourceId} not found`);
    }

    const regulation = regResult.recordset[0];

    // Get all mapped documents
    const mappedDocs = await pool.request()
        .input('regId', sql.Int, regulatorySourceId)
        .query(`
            SELECT d.id, d.title, d.document_path, d.category, d.content_type,
                   drm.mapping_type, drm.notes AS mapping_notes
            FROM document_regulatory_mappings drm
            JOIN compliance_documents d ON d.id = drm.document_id
            WHERE drm.regulatory_source_id = @regId
              AND d.status NOT IN ('sunset', 'archived')
            ORDER BY d.category, d.title
        `);

    if (mappedDocs.recordset.length === 0) {
        return {
            summary: 'No active documents are mapped to this regulation.',
            impactLevel: 'low',
            affectedDocuments: [],
            _meta: { regulatorySourceId, regulationTitle: regulation.title }
        };
    }

    // Build context
    let userPrompt = `=== REGULATORY CHANGE ===\n`;
    userPrompt += `Authority: ${regulation.authority}\n`;
    userPrompt += `Reference: ${regulation.reference_code || 'N/A'}\n`;
    userPrompt += `Title: ${regulation.title}\n`;
    if (regulation.description) userPrompt += `Description: ${regulation.description}\n`;
    userPrompt += `\nChange Description: ${changeDescription}\n`;

    // Include regulation text from knowbase if available
    if (regulation.knowbase_path) {
        const regDoc = getDocument(regulation.knowbase_path);
        if (regDoc) {
            userPrompt += `\nFull regulation text:\n${regDoc.content}\n`;
        }
    }

    userPrompt += `\n=== AFFECTED DOCUMENTS ===\n\n`;

    for (const doc of mappedDocs.recordset) {
        const docContent = getDocument(doc.document_path);
        userPrompt += `--- ${doc.title} (${doc.document_path}) ---\n`;
        userPrompt += `Category: ${doc.category} | Type: ${doc.content_type || 'N/A'}\n`;
        userPrompt += `Mapping: ${doc.mapping_type}\n\n`;
        if (docContent) {
            userPrompt += docContent.content;
        } else {
            userPrompt += `[Document content not available in knowbase]\n`;
        }
        userPrompt += `\n\n`;
    }

    if (options.focusAreas) {
        userPrompt += `\n=== FOCUS AREAS ===\nPay particular attention to: ${options.focusAreas}\n`;
    }

    userPrompt += `\nAnalyze the impact of this regulatory change on each document. Return your analysis as JSON.`;

    // Call Claude
    const client = getClient();
    const startTime = Date.now();

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        system: IMPACT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
    });

    const elapsed = Date.now() - startTime;
    console.log(`[AI-REVIEW] Impact analysis for regulation ${regulatorySourceId} in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    // Parse response
    const responseText = response.content[0]?.text || '';
    let analysis;

    try {
        let jsonText = responseText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
        }
        analysis = JSON.parse(jsonText);
    } catch (parseErr) {
        console.error('[AI-REVIEW] Failed to parse impact analysis as JSON:', parseErr.message);
        analysis = {
            summary: 'Impact analysis completed but response could not be parsed as structured JSON.',
            impactLevel: 'unknown',
            rawResponse: responseText,
            affectedDocuments: []
        };
    }

    analysis._meta = {
        regulatorySourceId,
        regulationTitle: regulation.title,
        regulationAuthority: regulation.authority,
        documentsAnalyzed: mappedDocs.recordset.length,
        changeDescription,
        model: CLAUDE_MODEL,
        responseTimeMs: elapsed,
        inputTokens: response.usage?.input_tokens || null,
        outputTokens: response.usage?.output_tokens || null,
        timestamp: new Date().toISOString()
    };

    return analysis;
}

module.exports = { analyzeReview, analyzeRegulatoryImpact };
