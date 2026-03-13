// routes/compliance-reviews.js - Review workflow + approval chain actions
const express = require('express');
const router = express.Router();
const reviewService = require('../services/compliance-reviews');

// GET /api/compliance/reviews
router.get('/', async (req, res) => {
    try {
        const reviews = await reviewService.list({
            status: req.query.status,
            assignedTo: req.query.assigned_to ? parseInt(req.query.assigned_to) : null,
            reviewType: req.query.review_type,
            documentId: req.query.document_id ? parseInt(req.query.document_id) : null,
            dueBefore: req.query.due_before,
            limit: parseInt(req.query.limit) || 100,
            offset: parseInt(req.query.offset) || 0
        });
        res.json(reviews);
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] List failed:', err);
        res.status(500).json({ error: 'Failed to list reviews', message: err.message });
    }
});

// GET /api/compliance/reviews/:id
router.get('/:id', async (req, res) => {
    try {
        const review = await reviewService.getById(parseInt(req.params.id));
        if (!review) return res.status(404).json({ error: 'Review not found' });
        res.json(review);
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Get failed:', err);
        res.status(500).json({ error: 'Failed to get review', message: err.message });
    }
});

// POST /api/compliance/reviews
router.post('/', async (req, res) => {
    try {
        const { document_id, review_type } = req.body;
        if (!document_id || !review_type) {
            return res.status(400).json({ error: 'Required fields: document_id, review_type' });
        }
        const id = await reviewService.create({
            documentId: document_id,
            reviewType: review_type,
            assignedTo: req.body.assigned_to,
            dueDate: req.body.due_date,
            requestedBy: req.body.user_id,
            commitSha: req.body.knowbase_commit_sha,
            contentHash: req.body.content_hash,
            triggeredByRegId: req.body.triggered_by_regulatory_source_id,
            triggeredByDocId: req.body.triggered_by_document_id
        });
        res.status(201).json({ id });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Create failed:', err);
        res.status(500).json({ error: 'Failed to create review', message: err.message });
    }
});

// PUT /api/compliance/reviews/:id
router.put('/:id', async (req, res) => {
    try {
        const updated = await reviewService.updateReview(parseInt(req.params.id), req.body, req.body.user_id);
        if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
        res.json({ updated: true });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Update failed:', err);
        res.status(500).json({ error: 'Failed to update review', message: err.message });
    }
});

// POST /api/compliance/reviews/:id/approve
router.post('/:id/approve', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ error: 'Required field: user_id' });
        const result = await reviewService.approve(parseInt(req.params.id), {
            userId: user_id,
            comments: req.body.comments
        });
        res.json({ approved: true, all_steps_complete: result.allApproved });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Approve failed:', err);
        res.status(500).json({ error: 'Failed to approve review', message: err.message });
    }
});

// POST /api/compliance/reviews/:id/request-revision
router.post('/:id/request-revision', async (req, res) => {
    try {
        const { user_id, comments } = req.body;
        if (!user_id || !comments) {
            return res.status(400).json({ error: 'Required fields: user_id, comments' });
        }
        await reviewService.requestRevision(parseInt(req.params.id), { userId: user_id, comments });
        res.json({ revision_requested: true });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Request revision failed:', err);
        res.status(500).json({ error: 'Failed to request revision', message: err.message });
    }
});

// POST /api/compliance/reviews/:id/reject
router.post('/:id/reject', async (req, res) => {
    try {
        const { user_id, comments } = req.body;
        if (!user_id || !comments) {
            return res.status(400).json({ error: 'Required fields: user_id, comments' });
        }
        await reviewService.reject(parseInt(req.params.id), { userId: user_id, comments });
        res.json({ rejected: true });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Reject failed:', err);
        res.status(500).json({ error: 'Failed to reject review', message: err.message });
    }
});

// POST /api/compliance/reviews/:id/recommend-sunset
router.post('/:id/recommend-sunset', async (req, res) => {
    try {
        const { user_id, comments } = req.body;
        if (!user_id || !comments) {
            return res.status(400).json({ error: 'Required fields: user_id, comments' });
        }
        await reviewService.recommendSunset(parseInt(req.params.id), { userId: user_id, comments });
        res.json({ sunset_recommended: true });
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] Recommend sunset failed:', err);
        res.status(500).json({ error: 'Failed to recommend sunset', message: err.message });
    }
});

// POST /api/compliance/reviews/:id/ai-analysis — AI-assisted review against mapped regulations
router.post('/:id/ai-analysis', async (req, res) => {
    try {
        const { analyzeReview } = require('../services/ai-review');
        const analysis = await analyzeReview(parseInt(req.params.id), {
            focusAreas: req.body.focus_areas
        });
        res.json(analysis);
    } catch (err) {
        console.error('[COMPLIANCE-REVIEWS] AI analysis failed:', err);
        res.status(500).json({ error: 'Failed to run AI analysis', message: err.message });
    }
});

module.exports = router;
