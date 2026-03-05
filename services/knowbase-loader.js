// services/knowbase-loader.js
// Fetches documents from the refuge-house-knowbase GitHub repo via the API.
// No git clone needed — reads files directly from GitHub into memory.
// The knowbase is the single source of truth for all policy documents.

const path = require('path');

// Parse owner/repo from the repo URL
const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
const KNOWBASE_BRANCH = process.env.KNOWBASE_BRANCH || 'main';
const REFRESH_INTERVAL_MS = parseInt(process.env.KNOWBASE_REFRESH_MINUTES || '30', 10) * 60 * 1000;

// Extract owner/repo from URL (handles both .git and non-.git URLs)
function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
    return { owner: match[1], repo: match[2] };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = parseRepoUrl(KNOWBASE_REPO_URL);

// In-memory document cache: { relativePath: { content, lastModified, sizeBytes, category } }
let _documentCache = {};
let _lastRefresh = 0;
let _manifest = null;

/**
 * Make a GitHub API request. Uses GITHUB_TOKEN if available (for private repos).
 */
async function githubFetch(apiPath) {
    const url = `https://api.github.com${apiPath}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'refuge-house-compliance-api'
    };

    const token = process.env.GITHUB_TOKEN;
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
}

/**
 * Recursively fetch the repo tree and load all .md files into memory.
 */
async function syncKnowbase() {
    console.log(`[KNOWBASE] Fetching from GitHub: ${REPO_OWNER}/${REPO_NAME} (${KNOWBASE_BRANCH})`);

    // Get the full repo tree recursively in one API call
    const tree = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${KNOWBASE_BRANCH}?recursive=1`);

    _documentCache = {};

    // Filter for .md files, skip README.md, hidden dirs, node_modules, source-pdfs
    const mdFiles = tree.tree.filter(item => {
        if (item.type !== 'blob') return false;
        if (!item.path.endsWith('.md')) return false;
        if (path.basename(item.path) === 'README.md') return false;

        const parts = item.path.split('/');
        for (const part of parts) {
            if (part.startsWith('.') || part === 'node_modules' || part === 'source-pdfs') {
                return false;
            }
        }
        return true;
    });

    console.log(`[KNOWBASE] Found ${mdFiles.length} documents, fetching content...`);

    // Fetch all file contents in parallel
    const fetchPromises = mdFiles.map(async (file) => {
        try {
            const blob = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${file.sha}`);
            const content = Buffer.from(blob.content, 'base64').toString('utf-8');

            const topDir = file.path.split('/')[0];
            const category = categorize(topDir, file.path);

            _documentCache[file.path] = {
                content,
                lastModified: new Date().toISOString(),
                sizeBytes: Buffer.byteLength(content, 'utf-8'),
                category
            };
        } catch (err) {
            console.warn(`[KNOWBASE] Failed to fetch ${file.path}: ${err.message}`);
        }
    });

    await Promise.all(fetchPromises);

    // Load manifest if it exists
    loadManifest(tree);
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
 * Load the optional document-manifest.json from the repo tree.
 */
async function loadManifest(tree) {
    const manifestFile = tree.tree.find(item => item.path === 'document-manifest.json');
    if (manifestFile) {
        try {
            const blob = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${manifestFile.sha}`);
            const content = Buffer.from(blob.content, 'base64').toString('utf-8');
            _manifest = JSON.parse(content);
        } catch (err) {
            console.warn('[KNOWBASE] Failed to parse document-manifest.json:', err.message);
            _manifest = null;
        }
    } else {
        _manifest = null;
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
