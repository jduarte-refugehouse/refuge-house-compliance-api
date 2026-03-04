// services/knowbase-loader.js
// Clones or pulls the refuge-house-knowbase repo and reads all documents into memory.
// The knowbase is the single source of truth — it can contain any number of documents
// in any directory structure. This loader discovers everything dynamically.

const fs = require('fs');
const path = require('path');
const simpleGit = require('simple-git');

const KNOWBASE_REPO = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
const KNOWBASE_DIR = path.join(__dirname, '..', 'knowbase');
const REFRESH_INTERVAL_MS = parseInt(process.env.KNOWBASE_REFRESH_MINUTES || '30', 10) * 60 * 1000;

// In-memory document cache: { relativePath: { content, lastModified, sizeBytes, category } }
let _documentCache = {};
let _lastRefresh = 0;
let _manifest = null; // Optional manifest loaded from knowbase repo

/**
 * Clone or pull the knowbase repository.
 */
async function syncKnowbase() {
    const gitDir = path.join(KNOWBASE_DIR, '.git');

    if (fs.existsSync(gitDir)) {
        console.log('[KNOWBASE] Pulling latest changes...');
        const git = simpleGit(KNOWBASE_DIR);
        await git.pull('origin', 'main');
    } else {
        console.log('[KNOWBASE] Cloning repository...');
        if (fs.existsSync(KNOWBASE_DIR)) {
            const files = fs.readdirSync(KNOWBASE_DIR);
            if (files.length > 0 && !fs.existsSync(gitDir)) {
                fs.rmSync(KNOWBASE_DIR, { recursive: true });
            }
        }
        const git = simpleGit();
        await git.clone(KNOWBASE_REPO, KNOWBASE_DIR, ['--depth', '1']);
    }

    // Reload documents and manifest
    await loadAllDocuments();
    loadManifest();
    _lastRefresh = Date.now();

    const categories = getCategorySummary();
    console.log(`[KNOWBASE] Loaded ${Object.keys(_documentCache).length} documents into cache`);
    for (const [cat, count] of Object.entries(categories)) {
        console.log(`[KNOWBASE]   ${cat}: ${count} documents`);
    }
    if (_manifest) {
        console.log(`[KNOWBASE] Document manifest loaded with ${Object.keys(_manifest).filter(k => k !== '_comment').length} evaluation types`);
    } else {
        console.log(`[KNOWBASE] No document-manifest.json found (chat will use all docs, evaluations will use all docs)`);
    }
}

/**
 * Recursively discover and read all .md files from the knowbase directory.
 * Assigns a category based on the top-level directory.
 */
async function loadAllDocuments() {
    _documentCache = {};

    function walkDir(dir, baseDir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Skip hidden dirs, node_modules, source PDFs
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'source-pdfs') {
                    continue;
                }
                walkDir(fullPath, baseDir);
            } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
                const relativePath = path.relative(baseDir, fullPath);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const stats = fs.statSync(fullPath);

                // Derive category from top-level directory
                const topDir = relativePath.split(path.sep)[0];
                const category = categorize(topDir, relativePath);

                _documentCache[relativePath] = {
                    content,
                    lastModified: stats.mtime.toISOString(),
                    sizeBytes: Buffer.byteLength(content, 'utf-8'),
                    category
                };
            }
        }
    }

    if (fs.existsSync(KNOWBASE_DIR)) {
        walkDir(KNOWBASE_DIR, KNOWBASE_DIR);
    }
}

/**
 * Derive a human-readable category from the file path.
 */
function categorize(topDir, relativePath) {
    const lower = topDir.toLowerCase();
    if (lower.includes('polic') || lower.includes('procedure')) return 'policy';
    if (lower.includes('regulat') || lower.includes('reference')) return 'regulatory';
    if (lower.includes('model') || lower.includes('framework')) return 'treatment-model';
    if (lower.includes('guide') || lower.includes('ai-dev')) return 'guide';
    if (lower.includes('template') || lower.includes('form')) return 'template';
    if (lower.includes('training')) return 'training';
    return 'general';
}

/**
 * Load the optional document-manifest.json from the knowbase repo.
 * This file lives IN the knowbase (not in the API code) so it evolves
 * with the documents themselves.
 */
function loadManifest() {
    const manifestPath = path.join(KNOWBASE_DIR, 'document-manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const raw = fs.readFileSync(manifestPath, 'utf-8');
            _manifest = JSON.parse(raw);
        } catch (err) {
            console.warn('[KNOWBASE] Failed to parse document-manifest.json:', err.message);
            _manifest = null;
        }
    } else {
        _manifest = null;
    }
}

/**
 * Get the manifest (if it exists in the knowbase).
 */
function getManifest() {
    return _manifest;
}

/**
 * Get a single document by its relative path.
 */
function getDocument(relativePath) {
    return _documentCache[relativePath] || null;
}

/**
 * Get all documents matching a directory prefix.
 */
function getDocumentsByPath(pathPrefix) {
    const results = {};
    for (const [key, value] of Object.entries(_documentCache)) {
        if (key.startsWith(pathPrefix)) {
            results[key] = value;
        }
    }
    return results;
}

/**
 * Get all documents matching a category.
 */
function getDocumentsByCategory(category) {
    const results = {};
    for (const [key, value] of Object.entries(_documentCache)) {
        if (value.category === category) {
            results[key] = value;
        }
    }
    return results;
}

/**
 * Get all cached documents.
 */
function getAllDocuments() {
    return _documentCache;
}

/**
 * Get a count of documents per category.
 */
function getCategorySummary() {
    const summary = {};
    for (const doc of Object.values(_documentCache)) {
        summary[doc.category] = (summary[doc.category] || 0) + 1;
    }
    return summary;
}

/**
 * Refresh if stale. Called before evaluations and chat.
 */
async function refreshIfStale() {
    if (Date.now() - _lastRefresh > REFRESH_INTERVAL_MS) {
        console.log('[KNOWBASE] Cache stale, refreshing...');
        await syncKnowbase();
    }
}

/**
 * Build a formatted context string from a set of documents.
 * Used by both chat and evaluations.
 */
function formatDocumentsAsContext(documents, preamble) {
    let context = '';
    if (preamble) {
        context += preamble + '\n\n';
    }

    for (const [docPath, doc] of Object.entries(documents)) {
        const fileName = path.basename(docPath, '.md');
        context += `--- BEGIN DOCUMENT: ${fileName} ---\n`;
        context += `Source: ${docPath}\n`;
        context += `Category: ${doc.category}\n\n`;
        context += doc.content;
        context += `\n--- END DOCUMENT: ${fileName} ---\n\n`;
    }

    return context;
}

/**
 * Estimate token count for a set of documents.
 * Rough approximation: 1 token ≈ 4 characters.
 */
function estimateTokens(documents) {
    let totalChars = 0;
    for (const doc of Object.values(documents)) {
        totalChars += doc.content.length;
    }
    return Math.ceil(totalChars / 4);
}

/**
 * Search documents by keyword (simple text search).
 * Returns documents whose content or path contains any of the keywords.
 * Useful for narrowing context when the full knowbase is too large.
 */
function searchDocuments(keywords) {
    const lowerKeywords = keywords.map(k => k.toLowerCase());
    const results = {};

    for (const [key, value] of Object.entries(_documentCache)) {
        const lowerPath = key.toLowerCase();
        const lowerContent = value.content.toLowerCase();

        const matches = lowerKeywords.some(kw =>
            lowerPath.includes(kw) || lowerContent.includes(kw)
        );

        if (matches) {
            results[key] = value;
        }
    }

    return results;
}

module.exports = {
    syncKnowbase,
    getManifest,
    getDocument,
    getDocumentsByPath,
    getDocumentsByCategory,
    getAllDocuments,
    getCategorySummary,
    refreshIfStale,
    formatDocumentsAsContext,
    estimateTokens,
    searchDocuments
};
