// services/context-builder.js
// Assembles relevant policy/regulatory documents for structured evaluations.
//
// Two modes:
// 1. With manifest: reads document-manifest.json from the KNOWBASE REPO
//    to pick specific docs per evaluation type. You maintain this alongside your docs.
// 2. Without manifest: falls back to sending ALL documents. Works fine — just
//    uses more tokens. No code changes needed when you add new policies.

const path = require('path');
const {
    getManifest,
    getDocument,
    getAllDocuments,
    estimateTokens,
    formatDocumentsAsContext
} = require('./knowbase-loader');

/**
 * Build the policy context for a given evaluation type.
 *
 * If a document-manifest.json exists in the knowbase repo, it uses that to
 * select the relevant documents. If not, it includes all documents.
 *
 * @param {string} evaluationType - e.g. 'treatment-plan', 'child-record', 'cqi'
 * @param {object} options
 * @param {string[]} options.packages - Package add-ons to include (e.g. ['mental-health', 'idd-autism'])
 * @param {string[]} options.additionalDocs - Extra document paths to include
 * @returns {{ context: string, documentsUsed: string[], documentsMissing: string[], estimatedTokens: number }}
 */
function buildContext(evaluationType, options = {}) {
    const manifest = getManifest();

    // If no manifest, or evaluation type not in manifest, use all documents
    if (!manifest || !manifest[evaluationType]) {
        if (!manifest) {
            console.log(`[CONTEXT] No manifest found in knowbase — using all documents for ${evaluationType}`);
        } else {
            console.log(`[CONTEXT] Evaluation type "${evaluationType}" not in manifest — using all documents`);
        }
        return buildFullContext(evaluationType);
    }

    // Manifest exists and has this evaluation type — use targeted documents
    const evalConfig = manifest[evaluationType];
    const docPaths = [...(evalConfig.documents || [])];

    // Add package-specific documents if requested
    if (options.packages && evalConfig.package_specific) {
        for (const pkg of options.packages) {
            const pkgDocs = evalConfig.package_specific[pkg];
            if (pkgDocs) {
                docPaths.push(...pkgDocs);
            }
        }
    }

    // Add any additional docs explicitly requested
    if (options.additionalDocs) {
        docPaths.push(...options.additionalDocs);
    }

    // Deduplicate
    const uniquePaths = [...new Set(docPaths)];

    // Load documents
    const loadedDocs = {};
    const missing = [];

    for (const docPath of uniquePaths) {
        const doc = getDocument(docPath);
        if (doc) {
            loadedDocs[docPath] = doc;
        } else {
            missing.push(docPath);
        }
    }

    if (missing.length > 0) {
        console.warn(`[CONTEXT] Missing documents for ${evaluationType}:`, missing);
        console.warn(`[CONTEXT] These paths are listed in document-manifest.json but not found in the knowbase.`);
        console.warn(`[CONTEXT] Check for renamed/moved files and update the manifest.`);
    }

    const description = evalConfig.description || evaluationType;
    const context = formatDocumentsAsContext(
        loadedDocs,
        `=== COMPLIANCE CONTEXT FOR: ${description.toUpperCase()} ===\n\n` +
        `The following policies, procedures, and regulatory references define the compliance requirements.\n` +
        `Use ONLY these documents as the basis for your evaluation. Do not assume or fabricate requirements.`
    );

    return {
        context,
        documentsUsed: Object.keys(loadedDocs),
        documentsMissing: missing,
        estimatedTokens: estimateTokens(loadedDocs)
    };
}

/**
 * Build context using ALL documents (fallback when no manifest or unknown type).
 */
function buildFullContext(evaluationType) {
    const allDocs = getAllDocuments();
    const context = formatDocumentsAsContext(
        allDocs,
        `=== COMPLIANCE CONTEXT FOR: ${evaluationType.toUpperCase()} EVALUATION ===\n\n` +
        `The following documents represent the complete Refuge House policy library.\n` +
        `Use ONLY these documents as the basis for your evaluation. Do not assume or fabricate requirements.`
    );

    return {
        context,
        documentsUsed: Object.keys(allDocs),
        documentsMissing: [],
        estimatedTokens: estimateTokens(allDocs)
    };
}

/**
 * List all available evaluation types.
 * If a manifest exists, returns its types. Otherwise returns a generic message.
 */
function listEvaluationTypes() {
    const manifest = getManifest();

    if (!manifest) {
        return {
            _note: 'No document-manifest.json found in the knowbase repo. You can POST any evaluation type and all documents will be included.',
            _availableWithoutManifest: true
        };
    }

    const types = {};
    for (const [key, value] of Object.entries(manifest)) {
        if (key === '_comment') continue;
        types[key] = {
            description: value.description,
            documentCount: (value.documents || []).length,
            packageOptions: value.package_specific ? Object.keys(value.package_specific) : []
        };
    }
    return types;
}

module.exports = {
    buildContext,
    listEvaluationTypes
};
