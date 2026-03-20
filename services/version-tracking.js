// services/version-tracking.js - Document version history + GitHub diff via API
// Queries approved reviews (each one is an "approved version") and can fetch
// diffs between the current knowbase content and the last approved commit.
const { poolPromise, sql } = require('./db');

// Reuse knowbase-loader's GitHub access
const KNOWBASE_REPO_URL = process.env.KNOWBASE_REPO_URL || 'https://github.com/jduarte-refugehouse/refuge-house-knowbase.git';
function parseRepoUrl(url) {
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
    return { owner: match[1], repo: match[2] };
}
const { owner: REPO_OWNER, repo: REPO_NAME } = parseRepoUrl(KNOWBASE_REPO_URL);

async function githubFetch(apiPath) {
    const url = `https://api.github.com${apiPath}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'refuge-house-compliance-api'
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers['Authorization'] = `token ${token}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res.json();
}

/**
 * Get the version history for a document — each approved review is a version.
 * Returns them newest-first with commit SHAs, content hashes, approver info, and notes.
 */
async function getVersionHistory(documentId) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .query(`
            SELECT r.id AS review_id, r.review_type, r.status,
                   r.knowbase_commit_sha, r.content_hash_at_review,
                   r.completed_at, r.completed_by, r.decision_notes,
                   r.revision_summary,
                   d.title, d.document_path, d.version AS current_version
            FROM compliance_reviews r
            JOIN compliance_documents d ON d.id = r.document_id
            WHERE r.document_id = @documentId
              AND r.status = 'approved'
            ORDER BY r.completed_at DESC
        `);
    return result.recordset;
}

/**
 * Get the latest approved commit SHA for a document.
 */
async function getLastApprovedSha(documentId) {
    const pool = await poolPromise;
    const result = await pool.request()
        .input('documentId', sql.Int, documentId)
        .query(`
            SELECT TOP 1 knowbase_commit_sha
            FROM compliance_reviews
            WHERE document_id = @documentId
              AND status = 'approved'
              AND knowbase_commit_sha IS NOT NULL
            ORDER BY completed_at DESC
        `);
    return result.recordset[0]?.knowbase_commit_sha || null;
}

/**
 * Get the diff between the current knowbase HEAD and a specific commit for a file.
 * Uses the GitHub compare API.
 *
 * @param {string} documentPath - path in the knowbase repo (e.g. policies/medication.md)
 * @param {string} baseSha - commit SHA to compare from (last approved)
 * @returns {{ status, additions, deletions, patch, commits }} or null if file unchanged
 */
async function getDiff(documentPath, baseSha) {
    const branch = process.env.KNOWBASE_BRANCH || 'main';

    // Compare the base SHA to the current branch HEAD
    const comparison = await githubFetch(
        `/repos/${REPO_OWNER}/${REPO_NAME}/compare/${baseSha}...${branch}`
    );

    // Find this file in the comparison
    const fileChange = comparison.files?.find(f => f.filename === documentPath);

    if (!fileChange) {
        return { status: 'unchanged', additions: 0, deletions: 0, patch: null, commits: [] };
    }

    // Summarize commits between base and head
    const commits = (comparison.commits || []).map(c => ({
        sha: c.sha.substring(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name || c.commit.author?.email,
        date: c.commit.author?.date
    }));

    return {
        status: fileChange.status, // added, modified, removed, renamed
        additions: fileChange.additions,
        deletions: fileChange.deletions,
        changes: fileChange.changes,
        patch: fileChange.patch || null,
        commits
    };
}

/**
 * Full diff report for a document: version history + current diff if applicable.
 */
async function getDiffReport(documentId) {
    const pool = await poolPromise;

    // Get document info
    const doc = await pool.request()
        .input('id', sql.Int, documentId)
        .query('SELECT * FROM compliance_documents WHERE id = @id');

    if (!doc.recordset[0]) return null;

    const document = doc.recordset[0];
    const lastSha = await getLastApprovedSha(documentId);

    let diff = null;
    if (lastSha) {
        try {
            diff = await getDiff(document.document_path, lastSha);
        } catch (err) {
            diff = { error: err.message };
        }
    }

    return {
        document_id: documentId,
        document_path: document.document_path,
        title: document.title,
        current_version: document.version,
        current_content_hash: document.content_hash,
        last_approved_commit: lastSha,
        diff
    };
}

module.exports = { getVersionHistory, getLastApprovedSha, getDiff, getDiffReport };
