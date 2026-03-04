// routes/evaluate.js - Compliance evaluation endpoints
// Each endpoint accepts record data and returns structured compliance findings.
const express = require('express');
const router = express.Router();
const { evaluate } = require('../services/evaluator');

/**
 * POST /api/evaluate/:type
 *
 * Generic evaluation endpoint. The :type parameter maps to an evaluation type
 * defined in config/document-manifest.json.
 *
 * Request body:
 * {
 *   "record": { ... } or "record": "free text description",
 *   "packages": ["mental-health"],        // optional: T3C package add-ons
 *   "additionalDocs": ["path/to/doc.md"], // optional: extra knowbase docs
 *   "focusAreas": "medication management" // optional: specific areas to focus on
 * }
 *
 * Response: Structured compliance evaluation with findings and citations.
 *
 * Example calls from Pulse:
 *
 *   POST /api/evaluate/treatment-plan
 *   { "record": { childName: "...", isp: { ... } }, "packages": ["mental-health"] }
 *
 *   POST /api/evaluate/child-record
 *   { "record": { childName: "...", admissionDate: "...", ... } }
 *
 *   POST /api/evaluate/cqi
 *   { "record": { quarter: "Q1-2026", metrics: { ... } } }
 *
 *   POST /api/evaluate/schedule
 *   { "record": { childName: "...", weeklySchedule: { ... } }, "packages": ["idd-autism"] }
 */
router.post('/:type', async (req, res) => {
    const evaluationType = req.params.type;
    const { record, packages, additionalDocs, focusAreas } = req.body;

    if (!record) {
        return res.status(400).json({
            error: 'Missing required field: record',
            hint: 'Provide the record data to evaluate in the "record" field (object or string)'
        });
    }

    try {
        const result = await evaluate(evaluationType, record, {
            packages,
            additionalDocs,
            focusAreas
        });

        res.json(result);
    } catch (err) {
        console.error(`[EVALUATE] ${evaluationType} evaluation failed:`, err);

        if (err.message.includes('Unknown evaluation type')) {
            return res.status(400).json({ error: err.message });
        }

        res.status(500).json({
            error: 'Evaluation failed',
            message: err.message
        });
    }
});

module.exports = router;
