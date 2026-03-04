#!/usr/bin/env node
// scripts/sync-knowbase.js
// Manual script to sync the knowbase repo without starting the server.
// Usage: npm run sync-knowbase

require('dotenv').config();
const { syncKnowbase, getAllDocuments } = require('../services/knowbase-loader');

async function main() {
    console.log('Syncing knowbase repository...');
    await syncKnowbase();

    const docs = getAllDocuments();
    const paths = Object.keys(docs).sort();

    console.log(`\nLoaded ${paths.length} documents:\n`);
    for (const p of paths) {
        const doc = docs[p];
        const kb = (doc.sizeBytes / 1024).toFixed(1);
        console.log(`  ${p} (${kb} KB)`);
    }
}

main().catch(err => {
    console.error('Sync failed:', err);
    process.exit(1);
});
