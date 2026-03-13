// server.js - Refuge House Compliance API
// Knowledge assistant + compliance evaluator for Refuge House staff.
// Clones the knowbase repo (policies, procedures, regulations) and exposes:
//   - Chat endpoint for natural language policy Q&A
//   - Plan generation endpoint for creating service plans from child data
//   - Evaluation endpoints for structured compliance checks
require('dotenv').config();

process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    console.error('[FATAL] Stack:', err.stack);
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled rejection at:', promise, 'reason:', reason);
});

const path = require('path');
const express = require('express');
const { syncKnowbase } = require('./services/knowbase-loader');

const app = express();
const PORT = process.env.PORT || 3100;

// CORS - allow Pulse front-ends
const ALLOWED_ORIGINS = [
    'https://pulse.refugehouse.org',
    'https://pulse.staging.refugehouse.org',
];
if (process.env.NODE_ENV !== 'production') {
    ALLOWED_ORIGINS.push('http://localhost:5173', 'http://localhost:3000');
}
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
        res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// Middleware
app.use(express.json({ limit: '5mb' }));

// Serve test console UI
app.use(express.static(path.join(__dirname, 'public')));

// API key authentication for service-to-service calls
app.use('/api', (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const expected = process.env.COMPLIANCE_API_KEY;

    if (!expected) {
        console.warn('[AUTH] COMPLIANCE_API_KEY not set - running without authentication (dev mode)');
        return next();
    }

    if (!apiKey || apiKey !== expected) {
        return res.status(401).json({ error: 'Unauthorized - invalid or missing API key' });
    }

    next();
});

// Routes — Knowledge Assistant (Phase 1)
const healthRoutes = require('./routes/health');
const chatRoutes = require('./routes/chat');
const generateRoutes = require('./routes/generate');
const evaluateRoutes = require('./routes/evaluate');
const documentsRoutes = require('./routes/documents');

app.use('/', healthRoutes);
app.use('/api/chat', chatRoutes);             // Natural language policy Q&A
app.use('/api/generate', generateRoutes);     // Plan/document generation from child data
app.use('/api/evaluate', evaluateRoutes);     // Structured compliance evaluations
app.use('/api/documents', documentsRoutes);   // Browse loaded knowbase documents

// Routes — Compliance Workflow (Phase 2)
const complianceDocRoutes = require('./routes/compliance-documents');
const complianceRegRoutes = require('./routes/compliance-regulations');
const complianceReviewRoutes = require('./routes/compliance-reviews');
const complianceReminderRoutes = require('./routes/compliance-reminders');
const complianceDashboardRoutes = require('./routes/compliance-dashboard');

app.use('/api/compliance/documents', complianceDocRoutes);     // Document registry + dependencies + regulatory mappings
app.use('/api/compliance/regulations', complianceRegRoutes);   // Regulatory sources + change tracking
app.use('/api/compliance/reviews', complianceReviewRoutes);    // Review workflow + approval chains
app.use('/api/compliance/reminders', complianceReminderRoutes); // Reminder config + check trigger
app.use('/api/compliance', complianceDashboardRoutes);         // Dashboard, timeline, history

// Routes — Pulse Integration (Phase 7)
const complianceWebhookRoutes = require('./routes/compliance-webhooks');
app.use('/api/compliance/webhooks', complianceWebhookRoutes); // Pulse webhooks + sync triggers

// Startup
async function start() {
    // Sync knowbase repo on startup
    try {
        console.log('[STARTUP] Syncing knowbase repository...');
        await syncKnowbase();
        console.log('[STARTUP] Knowbase sync complete');
    } catch (err) {
        console.error('[STARTUP] Knowbase sync failed:', err.message);
        console.error('[STARTUP] The API will start but chat/evaluations may fail until docs are available');
    }

    app.listen(PORT, () => {
        console.log(`[STARTUP] Compliance API running on port ${PORT}`);
        console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`[STARTUP] Anthropic configured: ${process.env.ANTHROPIC_COMPLIANCE_KEY ? 'Yes' : 'No'}`);
    });
}

start();
