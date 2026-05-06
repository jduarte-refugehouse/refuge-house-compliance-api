// routes/content-cookbook.js
// Stable contract for the cookbook content layer. Three responsibilities,
// kept separate by URL design:
//
//   GET /api/content-cookbook            → registry list (filter)
//   GET /api/content-cookbook/entry-point → package/add-on guide resolver
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

// ── Package/Add-On entry-point resolver ────────────────────────────────────
// Purpose: convenience endpoint for calling apps that only know service package
// or add-on code and need the correct guide/supplement entry point.
//
// Query params:
//   servicePackage   (e.g. MBH, STASS, TFFC, SU)
//   addOn            (e.g. KIN, PPY, YTSS)
//   includeStub      (default true) include status=stub in fallback
//   includeArchived  (default false)
//   format           metadata (default) | html-url | html
router.get('/entry-point', (req, res) => {
    const servicePackage = normalizeCode(req.query.servicePackage || req.query.packageCode);
    const addOn = normalizeCode(req.query.addOn || req.query.addOnCode);
    const includeStub = req.query.includeStub !== 'false';
    const includeArchived = req.query.includeArchived === 'true' || req.query.includeArchived === '1';
    const format = (req.query.format || 'metadata').toString().toLowerCase();

    if (!servicePackage && !addOn) {
        return res.status(400).json({
            error: 'missing required input',
            hint: 'pass servicePackage=<CODE> or addOn=<CODE>'
        });
    }

    const all = cookbook.listEntries({ status: 'all' });
    const statusRank = includeStub
        ? ['active', 'stub', 'deprecated', 'superseded', 'archived']
        : ['active', 'deprecated', 'superseded', 'archived'];
    const allowedStatuses = includeArchived
        ? new Set(statusRank)
        : new Set(statusRank.filter((s) => s !== 'archived'));

    const candidates = all
        .filter((e) => allowedStatuses.has(e.status))
        .filter((e) => {
            const ctx = e.contexts || {};
            const entryPackage = normalizeCode(ctx.packageCode);
            const entryAddOn = normalizeCode(ctx.addOnCode);
            if (servicePackage && addOn) return entryPackage === servicePackage && entryAddOn === addOn;
            if (servicePackage) return entryPackage === servicePackage && !entryAddOn;
            if (addOn) return entryAddOn === addOn;
            return false;
        })
        .sort((a, b) => scoreEntry(b, statusRank) - scoreEntry(a, statusRank));

    const entry = candidates[0];
    if (!entry) {
        return res.status(404).json({
            error: 'no matching entry point',
            context: { servicePackage, addOn }
        });
    }

    const htmlPath = `/api/content-cookbook/${entry.slug}/html`;
    if (format === 'html') {
        const html = cookbook.getHtml(entry.slug);
        if (!html) {
            return res.status(404).json({
                error: 'html not mirrored',
                slug: entry.slug
            });
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Content-Slug', entry.slug);
        res.setHeader('X-Content-Status', entry.status);
        return res.send(applyCookbookBranding(entry, html.content));
    }

    const payload = {
        context: { servicePackage, addOn },
        integrationHint: 'Use htmlEndpoint as-is to preserve interactive HTML behavior (JS/CSS) in the calling application.',
        entry: serialize(entry),
        htmlEndpoint: htmlPath
    };

    if (format === 'html-url') {
        return res.json({
            context: payload.context,
            slug: entry.slug,
            status: entry.status,
            htmlEndpoint: payload.htmlEndpoint
        });
    }

    return res.json(payload);
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

function normalizeCode(value) {
    if (value === undefined || value === null) return null;
    const str = String(value).trim();
    if (!str) return null;
    return str.toUpperCase();
}

function scoreEntry(entry, statusRank) {
    const statusScore = Math.max(0, 100 - (statusRank.indexOf(entry.status) * 20));
    const kind = String(entry.kind || '').toLowerCase();
    const type = String(entry.contentType || '').toLowerCase();
    const guideScore = (
        kind.includes('guide') ||
        kind.includes('supplement') ||
        type.includes('guide') ||
        type.includes('supplement')
    ) ? 10 : 0;
    return statusScore + guideScore + (entry.isDefault ? 2 : 0);
}

module.exports = router;
