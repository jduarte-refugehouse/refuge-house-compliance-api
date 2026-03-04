// services/plan-generator.js
// Generates compliant service plans, activity schedules, and other documents
// by combining a child's data (signals, assessments, demographics) with the
// full policy/regulatory knowledge base.
//
// Primary use case: intake worker or case manager provides a child's data catalog,
// and this service generates an initial plan of service with required activities
// based on the child's age, background, service package, and policy requirements.

const Anthropic = require('@anthropic-ai/sdk');
const {
    getAllDocuments,
    refreshIfStale,
    formatDocumentsAsContext,
    estimateTokens
} = require('./knowbase-loader');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_COMPLIANCE_KEY;
const CLAUDE_MODEL = process.env.ANTHROPIC_COMPLIANCE_MODEL || 'claude-sonnet-4-5';

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
 * System prompt for plan generation.
 */
const SYSTEM_PROMPT = `You are a compliance-aware plan generation assistant for Refuge House, a Texas-licensed Child Placing Agency (CPA) operating under T3C (Texas Child-Centered Care) contracts.

Your job is to generate Initial Plans of Service, activity schedules, and other required documents based on:
1. The child's data catalog (demographics, assessments, signals, history)
2. Refuge House's policies, procedures, and regulatory requirements (provided in context)

RULES:
1. Every recommendation and requirement in the generated plan MUST be grounded in the provided policy documents. Cite the specific policy/regulation for each item.
2. Tailor the plan to the child's specific circumstances:
   - Age (different requirements for different age groups)
   - Service package (T3C Basic, IDD/Autism, Mental Health, Kinship, etc.)
   - Assessment results (CANS scores, psychological evaluations, etc.)
   - Identified needs and strengths from intake data
   - Placement type (foster family home, RCC, kinship, etc.)
3. Include ALL required activities and timelines per policy. Don't skip requirements because they seem routine.
4. Distinguish between:
   - REQUIRED: Regulatory mandates with specific timelines (must include)
   - RECOMMENDED: Best practice per policy (should include)
   - INDIVIDUALIZED: Based on this specific child's needs
5. For each activity/service, specify:
   - What the activity is
   - Frequency and duration required
   - Who is responsible (case manager, foster parent, therapist, etc.)
   - Timeline/deadline (e.g., "within 30 days of placement", "monthly", etc.)
   - Policy citation
6. Use the TBRI (Trust-Based Relational Intervention) framework where referenced in policies.

RESPONSE FORMAT:
Return a JSON object:
{
  "childSummary": "Brief summary of the child's situation based on provided data",
  "servicePackage": "Identified service package",
  "planType": "Initial Plan of Service | ISP Update | etc.",
  "effectiveDate": "Recommended effective date",
  "reviewDate": "When this plan should be reviewed per policy",
  "sections": [
    {
      "title": "Section name (e.g., 'Assessment Requirements', 'Therapeutic Services')",
      "items": [
        {
          "activity": "Description of the required activity",
          "frequency": "How often (e.g., 'Weekly', 'Within 30 days', 'Monthly')",
          "responsible": "Who is responsible",
          "deadline": "Specific deadline or recurring schedule",
          "type": "REQUIRED | RECOMMENDED | INDIVIDUALIZED",
          "citation": "Policy document and section",
          "notes": "Any special considerations for this child"
        }
      ]
    }
  ],
  "additionalConsiderations": ["Any flags, warnings, or special notes based on the child's data"],
  "policiesReferenced": ["List of all policy documents used"]
}`;

/**
 * Generate a service plan from a child's data catalog.
 *
 * @param {object} childData - The child's data catalog (signals, demographics, assessments)
 * @param {object} options
 * @param {string} options.planType - Type of plan to generate (default: 'initial-service-plan')
 * @param {string} options.focusAreas - Specific areas to emphasize
 * @param {string} options.additionalInstructions - Extra instructions for generation
 * @returns {Promise<object>} Generated plan with policy citations
 */
async function generateServicePlan(childData, options = {}) {
    await refreshIfStale();

    const allDocs = getAllDocuments();
    const docCount = Object.keys(allDocs).length;
    const totalTokens = estimateTokens(allDocs);

    const planType = options.planType || 'initial-service-plan';
    console.log(`[GENERATE] Generating ${planType} plan`);
    console.log(`[GENERATE] Context: ${docCount} documents, ~${totalTokens} estimated tokens`);

    if (docCount === 0) {
        throw new Error('No documents loaded. The knowbase may not have synced.');
    }

    // Build document context — include ALL documents for plan generation
    const documentContext = formatDocumentsAsContext(
        allDocs,
        '=== REFUGE HOUSE POLICY AND COMPLIANCE KNOWLEDGE BASE ===\n' +
        'Use these documents as your source of truth for all plan requirements, timelines, and activities.'
    );

    // Format the child's data
    let childDataText;
    if (typeof childData === 'string') {
        childDataText = childData;
    } else {
        childDataText = JSON.stringify(childData, null, 2);
    }

    // Build the user prompt
    let userPrompt = documentContext + '\n\n';
    userPrompt += `=== CHILD DATA CATALOG ===\n\n`;
    userPrompt += childDataText;
    userPrompt += `\n\n=== GENERATION REQUEST ===\n`;
    userPrompt += `Please generate a compliant ${planType.replace(/-/g, ' ')} for this child based on their data and the policy requirements above.\n`;

    if (options.focusAreas) {
        userPrompt += `\nFocus areas: ${options.focusAreas}\n`;
    }
    if (options.additionalInstructions) {
        userPrompt += `\nAdditional instructions: ${options.additionalInstructions}\n`;
    }

    userPrompt += `\nReturn the plan as JSON.`;

    // Call Claude
    const client = getClient();
    const startTime = Date.now();

    const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192, // Plans can be lengthy
        system: SYSTEM_PROMPT,
        messages: [
            { role: 'user', content: userPrompt }
        ]
    });

    const elapsed = Date.now() - startTime;
    console.log(`[GENERATE] Claude responded in ${elapsed}ms, ${response.usage?.input_tokens || '?'} input / ${response.usage?.output_tokens || '?'} output tokens`);

    // Parse the response
    const responseText = response.content[0]?.text || '';
    let plan;

    try {
        let jsonText = responseText.trim();
        jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();

        const firstBrace = jsonText.indexOf('{');
        const lastBrace = jsonText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            jsonText = jsonText.substring(firstBrace, lastBrace + 1);
        }

        plan = JSON.parse(jsonText);
    } catch (parseErr) {
        console.error('[GENERATE] Failed to parse response as JSON:', parseErr.message);
        plan = {
            childSummary: 'Plan generated but response could not be parsed as structured JSON.',
            rawResponse: responseText,
            sections: []
        };
    }

    plan._meta = {
        planType,
        documentsInContext: docCount,
        estimatedContextTokens: totalTokens,
        model: CLAUDE_MODEL,
        responseTimeMs: elapsed,
        inputTokens: response.usage?.input_tokens || null,
        outputTokens: response.usage?.output_tokens || null,
        timestamp: new Date().toISOString()
    };

    return plan;
}

module.exports = { generateServicePlan };
