// routes/generate.js - Plan and document generation endpoints
// Generates compliant service plans, schedules, and other documents
// from a child's data catalog combined with policy requirements.
const express = require('express');
const router = express.Router();
const { generateServicePlan } = require('../services/plan-generator');

/**
 * POST /api/generate/service-plan
 *
 * Generate an initial plan of service (or updated plan) based on a child's
 * data catalog (signals, assessments, demographics) and policy requirements.
 *
 * Request body:
 * {
 *   "childData": {
 *     "name": "...",
 *     "age": 14,
 *     "dateOfBirth": "2012-03-15",
 *     "admissionDate": "2026-02-01",
 *     "placementType": "Foster Family Home",
 *     "servicePackage": "Short Term Assessment Services",
 *     "packageAddOns": ["mental-health"],
 *     "signals": [
 *       { "signal": "CANS Score", "value": "42", "date": "2026-02-05" },
 *       { "signal": "Diagnosis", "value": "PTSD, ADHD", "date": "2026-02-03" },
 *       ...
 *     ],
 *     "assessments": { ... },
 *     "background": "Brief narrative or structured data about the child's history"
 *   },
 *   "planType": "initial-service-plan",     // optional, default: initial-service-plan
 *   "focusAreas": "trauma-informed care",   // optional
 *   "additionalInstructions": "..."         // optional
 * }
 *
 * Response: Structured service plan with activities, timelines, responsibilities,
 * and policy citations.
 */
router.post('/service-plan', async (req, res) => {
    const { childData, planType, focusAreas, additionalInstructions } = req.body;

    if (!childData) {
        return res.status(400).json({
            error: 'Missing required field: childData',
            hint: 'Provide the child\'s data catalog (demographics, signals, assessments) in the "childData" field'
        });
    }

    try {
        const result = await generateServicePlan(childData, {
            planType,
            focusAreas,
            additionalInstructions
        });

        res.json(result);
    } catch (err) {
        console.error('[GENERATE] Service plan generation failed:', err);
        res.status(500).json({
            error: 'Plan generation failed',
            message: err.message
        });
    }
});

module.exports = router;
