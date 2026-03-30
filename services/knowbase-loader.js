// services/knowbase-loader.js
// Fetches documents from the refuge-house-knowbase GitHub repo via the API.
// No git clone needed — reads files directly from GitHub into memory.
// The knowbase is the single source of truth for all policy documents.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Parse owner/repo from the repo URL
const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
const KNOWBASE_BRANCH = process.env.KNOWBASE_BRANCH || 'main';
// Default: check for updates once per day (1440 minutes). Override with KNOWBASE_REFRESH_MINUTES.
const REFRESH_INTERVAL_MS = parseInt(process.env.KNOWBASE_REFRESH_MINUTES || '1440', 10) * 60 * 1000;

// Extract owner/repo from URL (handles both .git and non-.git URLs)
function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
    return { owner: match[1], repo: match[2] };
}

const { owner: REPO_OWNER, repo: REPO_NAME } = parseRepoUrl(KNOWBASE_REPO_URL);

// In-memory document cache: { relativePath: { content, lastModified, sizeBytes, category } }
let _documentCache = {};
// Document index: { relativePath: { summary, headings, topics, regulations, packages, tokenEstimate, contentHash } }
let _documentIndex = {};
// Static HTML pages cache: { pageName: { content, lastModified, sizeBytes, path } }
let _staticPages = {};
let _lastRefresh = 0;
let _manifest = null;

// Persistent index cache — survives restarts, avoids re-indexing unchanged documents
const INDEX_CACHE_DIR = process.env.INDEX_CACHE_DIR || path.join(__dirname, '..', 'data');
const INDEX_CACHE_FILE = path.join(INDEX_CACHE_DIR, 'document-index-cache.json');

/**
 * Compute a content hash for a document (used to detect changes).
 */
function contentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Load the persistent index cache from disk.
 */
function loadIndexCache() {
    try {
        if (fs.existsSync(INDEX_CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(INDEX_CACHE_FILE, 'utf-8'));
            console.log(`[KNOWBASE] Loaded index cache with ${Object.keys(data).length} entries`);
            return data;
        }
    } catch (err) {
        console.warn(`[KNOWBASE] Failed to load index cache: ${err.message}`);
    }
    return {};
}

/**
 * Save the document index to the persistent cache on disk.
 */
function saveIndexCache() {
    try {
        if (!fs.existsSync(INDEX_CACHE_DIR)) {
            fs.mkdirSync(INDEX_CACHE_DIR, { recursive: true });
        }
        fs.writeFileSync(INDEX_CACHE_FILE, JSON.stringify(_documentIndex, null, 2));
        console.log(`[KNOWBASE] Saved index cache (${Object.keys(_documentIndex).length} entries)`);
    } catch (err) {
        console.warn(`[KNOWBASE] Failed to save index cache: ${err.message}`);
    }
}

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

    // Load static HTML pages from static-pages/ directory
    _staticPages = {};
    const htmlFiles = tree.tree.filter(item => {
        if (item.type !== 'blob') return false;
        if (!item.path.endsWith('.html')) return false;
        // Only load from the static-pages/ directory
        return item.path.startsWith('static-pages/');
    });

    if (htmlFiles.length > 0) {
        console.log(`[KNOWBASE] Found ${htmlFiles.length} static HTML pages, fetching...`);
        const htmlPromises = htmlFiles.map(async (file) => {
            try {
                const blob = await githubFetch(`/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${file.sha}`);
                const content = Buffer.from(blob.content, 'base64').toString('utf-8');
                const pageName = path.basename(file.path, '.html');

                _staticPages[pageName] = {
                    content,
                    lastModified: new Date().toISOString(),
                    sizeBytes: Buffer.byteLength(content, 'utf-8'),
                    path: file.path
                };
            } catch (err) {
                console.warn(`[KNOWBASE] Failed to fetch static page ${file.path}: ${err.message}`);
            }
        });
        await Promise.all(htmlPromises);
        console.log(`[KNOWBASE] Loaded ${Object.keys(_staticPages).length} static pages: ${Object.keys(_staticPages).join(', ')}`);
    }

    // Load manifest if it exists, and build the document index
    loadManifest(tree);
    buildDocumentIndex();
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

    // Sync with compliance document registry (Phase 6)
    // Runs in background — doesn't block the sync response
    try {
        const { syncComplianceRegistry } = require('./knowbase-sync');
        syncComplianceRegistry().catch(err => {
            console.error('[KNOWBASE] Compliance registry sync failed:', err.message);
        });
    } catch (err) {
        // knowbase-sync may not be available if db isn't configured yet
        console.warn('[KNOWBASE] Compliance registry sync not available:', err.message);
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
 * Build an index entry for a single document by extracting structured metadata
 * from its markdown content. This runs during sync and powers the two-pass
 * retrieval in chat.
 */
function indexDocument(docPath, doc) {
    const content = doc.content;

    // Extract markdown headings
    const headings = [];
    const headingRegex = /^#{1,4}\s+(.+)$/gm;
    let match;
    while ((match = headingRegex.exec(content)) !== null) {
        headings.push(match[1].trim());
    }

    // Extract the first meaningful paragraph as a summary
    const paragraphs = content
        .replace(/^#{1,6}\s+.+$/gm, '') // strip headings
        .split(/\n{2,}/)
        .map(p => p.trim())
        .filter(p => p.length > 30 && !p.startsWith('|') && !p.startsWith('-'));
    const summary = paragraphs[0]
        ? paragraphs[0].replace(/\n/g, ' ').substring(0, 300)
        : '';

    // Extract regulation references — comprehensive Texas child welfare patterns
    const regulations = [];
    const regPatterns = [
        // TAC (Texas Administrative Code) — multiple formats
        /TAC\s*§?\s*\d+\.\d+/gi,
        /(?:26\s+)?TAC\s+(?:Chapter\s+)?\d+/gi,
        /Texas\s+Administrative\s+Code\s+(?:Chapter\s+)?\d+/gi,
        /§\s*\d+\.\d+/g,
        // DFPS — broad matching for compound phrases
        /DFPS\s+(?:Minimum\s+Standards?|rules?|policy|standards?|handbook|manual)\b/gi,
        /DFPS\s+\w+/gi,
        // HHSC / HHS
        /HHSC\s+(?:rules?|standards?|requirements?|policy|minimum\s+standards?)\b/gi,
        /HHSC/g,
        // Minimum Standards (standalone or with qualifiers)
        /Minimum\s+Standards?\s+(?:for\s+)?(?:RCC|CPA|GRO|Child[- ]?Placing|Residential|General)/gi,
        /Minimum\s+Standards?\s+§?\s*\d+/gi,
        // RCC — broader matching
        /RCC\s+(?:contract|section|requirement|standard|rule|minimum\s+standard)/gi,
        /RCC\s+§?\s*\d+/gi,
        // T3C — broader matching
        /T3C\s+(?:Blueprint|contract|requirement|standard|guideline|scope\s+of\s+work)/gi,
        // Texas codes
        /Texas\s+Family\s+Code\s+§?\s*[\d.]+/gi,
        /Texas\s+Health\s+(?:and|&)\s+Safety\s+Code\s+§?\s*[\d.]+/gi,
        /Texas\s+Human\s+Resources\s+Code\s+§?\s*[\d.]+/gi,
        /Texas\s+Family\s+Code/gi,
        // Federal references
        /Title\s+IV-[BE]/gi,
        /ICPC/g,
        /ICWA/g,
        /MEPA/g,
        // Common assessment/system acronyms
        /CANS/g,
        /ISP/g,
        /FSFN/g,
        /IMPACT/g,
        /CLASS/g
    ];
    for (const pattern of regPatterns) {
        let m;
        while ((m = pattern.exec(content)) !== null) {
            const ref = m[0].trim();
            if (!regulations.includes(ref)) regulations.push(ref);
        }
    }

    // Extract service package references
    const packages = [];
    const packagePatterns = [
        { pattern: /IDD|Autism|intellectual\s+disabilit/gi, name: 'IDD/Autism' },
        { pattern: /Mental\s+Health|MH\s+package/gi, name: 'Mental Health' },
        { pattern: /Kinship/gi, name: 'Kinship' },
        { pattern: /SIL|Supervised\s+Independent\s+Living/gi, name: 'SIL' },
        { pattern: /HCS|Home\s+and\s+Community/gi, name: 'HCS' },
        { pattern: /STAR\s+Health/gi, name: 'STAR Health' },
        { pattern: /T3C/gi, name: 'T3C' },
        { pattern: /FFCC|Foster\s+Family/gi, name: 'Foster Family' },
        { pattern: /PAL|Preparation\s+for\s+Adult\s+Living/gi, name: 'PAL' },
        { pattern: /FBSS|Family[- ]Based\s+Safety/gi, name: 'FBSS' },
        { pattern: /CPS/gi, name: 'CPS' }
    ];
    for (const { pattern, name } of packagePatterns) {
        if (pattern.test(content) && !packages.includes(name)) {
            packages.push(name);
        }
    }

    // Extract key topics from headings and content
    const topicPatterns = [
        /discharge|transition/gi, /intake|admission|placement/gi,
        /medication|prescription|OTC|psychotropic/gi, /assessment|evaluation|CANS/gi,
        /training|orientation/gi, /supervision|monitoring/gi,
        /incident|reporting|abuse|neglect/gi, /contact|visitation|family/gi,
        /case\s*management|case\s*plan/gi, /medical|health|dental/gi,
        /education|school/gi, /behavior|crisis|restraint/gi,
        /documentation|record|file/gi, /background\s*check|clearance/gi,
        /staffing|personnel|employee/gi, /rights|grievance|complaint/gi,
        /safety|emergency|evacuation/gi, /nutrition|meal|diet/gi,
        /transportation/gi, /clothing|allowance|personal/gi,
        /court|legal|hearing/gi, /permanency|adoption|reunification/gi,
        /ISP|service\s*plan|treatment\s*plan/gi,
        /foster\s*(?:parent|home|care)/gi, /respite/gi,
        // Regulatory/compliance-specific topics
        /licens/gi, /minimum\s*standard/gi, /compliance|audit|review/gi,
        /contract\s*(?:requirement|obligation|provision)/gi,
        /corrective\s*action/gi, /deficiency|violation|finding/gi,
        /renewal|expiration/gi, /notification|reporting\s*requirement/gi,
        /consent|authorization/gi, /confidential/gi,
        /investigation/gi, /screening/gi
    ];

    const topics = [];
    for (const pattern of topicPatterns) {
        if (pattern.test(content)) {
            // Use the first match as the topic label
            pattern.lastIndex = 0;
            const m = pattern.exec(content);
            if (m) {
                const topic = m[0].toLowerCase().trim();
                if (!topics.includes(topic)) topics.push(topic);
            }
        }
    }

    return {
        summary,
        headings: headings.slice(0, 15), // cap at 15 to keep index compact
        topics,
        regulations: regulations.slice(0, 30),
        packages,
        tokenEstimate: Math.ceil(content.length / 4),
        category: doc.category,
        contentHash: contentHash(content)
    };
}

/**
 * Build the document index for all cached documents.
 * Uses a persistent cache on disk — only re-indexes documents whose content has changed.
 * Regulatory/external docs that don't change get indexed once and cached indefinitely.
 *
 * @param {boolean} forceReindex - If true, ignore cache and re-index everything
 * @returns {{ total: number, reused: number, reindexed: number, changed: string[] }}
 */
function buildDocumentIndex(forceReindex = false) {
    const cachedIndex = forceReindex ? {} : loadIndexCache();
    const newIndex = {};
    let reused = 0;
    let reindexed = 0;
    const changed = [];

    for (const [docPath, doc] of Object.entries(_documentCache)) {
        const hash = contentHash(doc.content);
        const cached = cachedIndex[docPath];

        if (cached && cached.contentHash === hash) {
            // Content unchanged — reuse cached index entry
            newIndex[docPath] = cached;
            reused++;
        } else {
            // New or changed document — index it
            newIndex[docPath] = indexDocument(docPath, doc);
            reindexed++;
            changed.push(docPath);
        }
    }

    _documentIndex = newIndex;
    const total = Object.keys(newIndex).length;
    console.log(`[KNOWBASE] Document index: ${reused} cached, ${reindexed} re-indexed (${total} total)`);
    if (changed.length > 0) {
        console.log(`[KNOWBASE] Changed documents: ${changed.join(', ')}`);
    }

    // Persist to disk for next startup
    saveIndexCache();

    return { total, reused, reindexed, changed };
}

/**
 * Get the document index.
 */
function getDocumentIndex() {
    return _documentIndex;
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
 * Get a static HTML page by name (without .html extension).
 */
function getStaticPage(pageName) {
    return _staticPages[pageName] || null;
}

/**
 * Get all static HTML pages.
 */
function getAllStaticPages() {
    return _staticPages;
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
    buildDocumentIndex,
    getManifest,
    getDocument,
    getDocumentsByPath,
    getDocumentsByCategory,
    getAllDocuments,
    getDocumentIndex,
    getCategorySummary,
    refreshIfStale,
    formatDocumentsAsContext,
    estimateTokens,
    searchDocuments,
    getStaticPage,
    getAllStaticPages
};
