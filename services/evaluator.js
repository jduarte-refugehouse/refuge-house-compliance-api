// services/evaluator.js
// Calls the Claude API with policy context + record data to produce compliance evaluations.
// Returns structured findings with regulatory citations.

const Anthropic = require('@anthropic-ai/sdk');
const { buildContext } = require('./context-builder');
const { refreshIfStale } = require('./knowbase-loader');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

if (!ANTHROPIC_API_KEY) {
    console.warn('[EVALUATOR] ANTHROPIC_COMPLIANCE_KEY not set. Evaluations will fail.');
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

/**
 * System prompt template for compliance evaluations.
 * Instructs Claude to act as a compliance reviewer, cite specific policies,
 * and return structured findings.
 */
const SYSTEM_PROMPT = `You are a compliance evaluation assistant for Refuge House, a Texas-licensed Child Placing Agency (CPA) operating under T3C (Texas Child-Centered Care) contracts.

Your role is to evaluate records, plans, and documentation against the policies, procedures, and regulatory requirements provided in your context.

RULES:
1. Only cite requirements that appear in the provided policy/regulatory documents. Never fabricate or assume requirements.
2. For each finding, cite the specific document, section, and requirement.
3. Categorize findings by severity:
   - CRITICAL: Immediate regulatory non-compliance that could affect licensing or child safety
   - WARNING: Gap or deficiency that should be addressed but is not an immediate violation
   - RECOMMENDATION: Best practice improvement aligned with policy intent
   - COMPLIANT: Area that meets or exceeds requirements (include these to show what's working)
4. Be specific and actionable. Don't just say "needs improvement" — say what's missing and what the policy requires.
5. Reference T3C Blueprint pages, TAC 749 sections, and RCC contract terms where applicable.

RESPONSE FORMAT:
Return a JSON object with this structure:
{
  "summary": "Brief overall assessment (2-3 sentences)",
  "overallStatus": "compliant | needs-attention | non-compliant",
  "findings": [
    {
      "severity": "CRITICAL | WARNING | RECOMMENDATION | COMPLIANT",
      "area": "Short label (e.g., 'Service Plan Timeline', 'Medical Consent')",
      "finding": "Description of what was found",
      "requirement": "What the policy/regulation requires",
      "citation": "Document name, section reference",
      "action": "Specific action needed (null if COMPLIANT)"
    }
  ],
  "documentsReferenced": ["List of policy documents used in evaluation"]
}`;

/**
 * Run a compliance evaluation.
 *
 * @param {string} evaluationType - e.g. 'treatment-plan', 'child-record', 'cqi', 'schedule'
 * @param {object} recordData - The record/plan/data to evaluate (freeform object or text)
 * @param {object} options
 * @param {string[]} options.packages - T3C package add-ons (e.g. ['mental-health'])
 * @param {string[]} options.additionalDocs - Extra knowbase doc paths to include
 * @param {string} options.focusAreas - Specific areas to focus evaluation on
 * @returns {Promise<object>} Structured compliance evaluation results
 */
async function evaluate(evaluationType, recordData, options = {}) {
    // Ensure knowbase is fresh
    await refreshIfStale();

    // Build the policy context for this evaluation type
    const contextResult = buildContext(evaluationType, {
        packages: options.packages,
        additionalDocs: options.additionalDocs
    });

    console.log(`[EVALUATOR] Running ${evaluationType} evaluation`);
    console.log(`[EVALUATOR] Context: ${contextResult.documentsUsed.length} documents, ~${contextResult.estimatedTokens} tokens`);

    if (contextResult.documentsMissing.length > 0) {
        console.warn(`[EVALUATOR] Missing documents:`, contextResult.documentsMissing);
    }

    // Format the record data for the prompt
    let recordText;
    if (typeof recordData === 'string') {
        recordText = recordData;
    } else {
        recordText = JSON.stringify(recordData, null, 2);
    }

    // Build the user prompt
    let userPrompt = `${contextResult.context}\n\n`;
    userPrompt += `=== RECORD TO EVALUATE ===\n\n`;
    userPrompt += recordText;

    if (options.focusAreas) {
        userPrompt += `\n\n=== FOCUS AREAS ===\n`;
        userPrompt += `Please pay particular attention to: ${options.focusAreas}\n`;
    }

    userPrompt += `\n\nPlease evaluate this ${evaluationType} against the compliance requirements provided above. Return your findings as JSON.`;

    // Call Claude
    const client = getClient();
    const startTime = Date.now();

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
            { role: 'user', content: userPrompt }
        ]
    });

    const elapsed = Date.now() - startTime;
    console.log(`[EVALUATOR] Claude responded in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    // Parse the response
    const responseText = response.content[0]?.text || '';
    let evaluation;

    try {
        // Extract JSON from response (Claude sometimes wraps in markdown code blocks)
        let jsonText = responseText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
        }

        evaluation = JSON.parse(jsonText);
    } catch (parseErr) {
        console.error('[EVALUATOR] Failed to parse Claude response as JSON:', parseErr.message);
        // Return raw text as a fallback
        evaluation = {
            summary: 'Evaluation completed but response could not be parsed as structured JSON.',
            overallStatus: 'unknown',
            rawResponse: responseText,
            findings: []
        };
    }

    // Add metadata
    evaluation._meta = {
        evaluationType,
        documentsUsed: contextResult.documentsUsed,
        documentsMissing: contextResult.documentsMissing,
        estimatedContextTokens: contextResult.estimatedTokens,
        model: CLAUDE_MODEL,
        responseTimeMs: elapsed,
        inputTokens: response.usage?.input_tokens || null,
        outputTokens: response.usage?.output_tokens || null,
        timestamp: new Date().toISOString()
    };

    return evaluation;
}

module.exports = { evaluate };
