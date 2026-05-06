// routes/content-cookbook.js
// Stable contract for the cookbook content layer. Three responsibilities,
// kept separate by URL design:
//
//   GET /api/content-cookbook            → registry list (filter)
//   GET /api/content-cookbook/resolve    → deterministic resolver
//   GET /api/content-cookbook/_status    → drift/integrity diagnostics
//   GET /api/content-cookbook/:slug      → single registry entry (metadata)
//   GET /api/content-cookbook/:slug/html → mirrored HTML body
//
// Resolution precedence and required schema fields are documented in the
// content-cookbook service.
const express = require('express');
const router = express.Router();
const cookbook = require('../services/content-cookbook');
const { applyCookbookBranding } = require('../utils/cookbook-branding');

// Refresh in-memory cache if stale, but never let a refresh failure 500 a read.
router.use(async (req, res, next) => {
    try {
        await cookbook.refreshIfStale();
    } catch (err) {
        console.warn('[COOKBOOK] refreshIfStale error (serving stale):', err.message);
    }
    next();
});

// ── Registry list ───────────────────────────────────────────────────────
// Filters: status (default `active`, comma-separated, or `all`), kind,
// contentType, domain, packageCode, addOnCode.
router.get('/', (req, res) => {
    const { status, kind, contentType, domain, packageCode, addOnCode } = req.query;
    const filter = {
        status: status || 'active',
        kind: kind || undefined,
        contentType: contentType || undefined,
        domain: domain || undefined,
        packageCode: packageCode || undefined,
        addOnCode: addOnCode || undefined
    };
    const entries = cookbook.listEntries(filter);
    const status_ = cookbook.getStatus();
    res.json({
        count: entries.length,
        filter,
        meta: {
            sourceRepo: status_.sourceRepo,
            sourceRef: status_.sourceRef,
            lastSyncAt: status_.lastSyncAt
        },
        entries: entries.map(serialize)
    });
});

// ── Deterministic resolver ──────────────────────────────────────────────
// Inputs: slug, contentType, packageCode, addOnCode, domain.
// Returns the chosen entry plus `resolutionMode` so the resolution decision
// is auditable from the response itself.
router.get('/resolve', (req, res) => {
    const ctx = {
        slug: req.query.slug || undefined,
        contentType: req.query.contentType || undefined,
        packageCode: req.query.packageCode || undefined,
        addOnCode: req.query.addOnCode || undefined,
        domain: req.query.domain || undefined
    };
    const result = cookbook.resolve(ctx);
    if (!result) {
        return res.status(404).json({
            error: 'no matching content',
            context: ctx
        });
    }
    res.json({
        resolutionMode: result.resolutionMode,
        context: ctx,
        entry: serialize(result.entry)
    });
});

// ── Diagnostics ─────────────────────────────────────────────────────────
// Drift and integrity report, plus mirror provenance.
router.get('/_status', (req, res) => {
    res.json(cookbook.getStatus());
});

// ── Single entry ────────────────────────────────────────────────────────
// Archived entries: keep accessible by direct slug URL (use `?status=archived`
// to access; default behavior is to return 404 to keep them out of the UX).
router.get('/:slug', (req, res) => {
    const includeArchived = req.query.status === 'archived'
        || req.query.includeArchived === 'true'
        || req.query.includeArchived === '1';

    const entry = cookbook.getEntry(req.params.slug);
    if (!entry) {
        return res.status(404).json({ error: 'not found', slug: req.params.slug });
    }
    if (entry.status === 'archived' && !includeArchived) {
        return res.status(404).json({
            error: 'archived',
            slug: req.params.slug,
            hint: 'pass ?status=archived to retrieve'
        });
    }
    res.json(serialize(entry));
});

// ── HTML render ─────────────────────────────────────────────────────────
// Archived entries remain reachable here (compliance continuity).
router.get('/:slug/html', (req, res) => {
    const entry = cookbook.getEntry(req.params.slug);
    if (!entry) {
        return res.status(404).type('text/html')
            .send('<!doctype html><h1>Not found</h1>');
    }
    const html = cookbook.getHtml(req.params.slug);
    if (!html) {
        return res.status(404).type('text/html')
            .send('<!doctype html><h1>Content not mirrored</h1>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Content-Slug', entry.slug);
    res.setHeader('X-Content-Status', entry.status);
    if (entry.checksum) res.setHeader('X-Content-Checksum', entry.checksum);
    if (entry.sourceRef) res.setHeader('X-Source-Ref', entry.sourceRef);
    res.send(applyCookbookBranding(entry, html.content));
});

function serialize(e) {
    return {
        id: e.id,
        slug: e.slug,
        title: e.title,
        summary: e.summary,
        kind: e.kind,
        contentType: e.contentType,
        domain: e.domain,
        contexts: e.contexts || {},
        status: e.status,
        path: e.path,
        sourceRepo: e.sourceRepo,
        sourcePath: e.sourcePath,
        sourceRef: e.sourceRef,
        sourceUrl: e.sourceUrl,
        mirroredAt: e.mirroredAt,
        syncMode: e.syncMode,
        checksum: e.checksum,
        isDefault: !!e.isDefault,
        supersededBy: e.supersededBy
    };
}

module.exports = router;
