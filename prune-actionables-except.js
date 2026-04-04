const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

// Usage:
//   node prune-actionables-except.js [--keep DOC1,DOC2] [--apply]
// Default: dry-run (no --apply). If no --keep provided, script will try to
// auto-detect documents with exactly 100 actionables, or fallback to DOC-TEST-001.

async function main() {
    const args = process.argv.slice(2);
    const shouldApply = args.includes('--apply');
    const keepIndex = args.indexOf('--keep');

    let keepList = [];
    if (keepIndex !== -1 && args[keepIndex + 1]) {
        keepList = args[keepIndex + 1].split(',').map(s => s.trim()).filter(Boolean);
    }

    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const allDocs = await col.find({}).toArray();
        console.log(`Found ${allDocs.length} documents in 'actionables' collection`);

        // Auto-detect keepList if none provided
        if (keepList.length === 0) {
            // Prefer docs that have exactly 100 actionables
            const hundredDocs = allDocs.filter(d => Array.isArray(d.actionables) && d.actionables.length === 100);
            if (hundredDocs.length > 0) {
                keepList = hundredDocs.map(d => d._id || d.doc_id).filter(Boolean);
                console.log('Auto-detected documents with 100 items to keep:', keepList);
            } else {
                // Fallback to DOC-TEST-001 if present
                const hasTest = allDocs.find(d => (d._id === 'DOC-TEST-001' || d.doc_id === 'DOC-TEST-001'));
                if (hasTest) {
                    keepList = ['DOC-TEST-001'];
                    console.log('No 100-item doc found; falling back to keeping DOC-TEST-001');
                } else {
                    console.log('No keep list provided and no auto-detect match found. Aborting.');
                    return;
                }
            }
        } else {
            console.log('Keeping user-specified documents:', keepList);
        }

        // Normalize keys for comparison
        const keepSet = new Set(keepList);
        const docsToDelete = allDocs.filter(d => {
            const id = d._id || d.doc_id;
            return !keepSet.has(id);
        });

        if (docsToDelete.length === 0) {
            console.log('No documents to delete. Nothing to do.');
            return;
        }

        console.log(`\nDocuments that would be deleted (${docsToDelete.length}):`);
        docsToDelete.forEach(d => console.log(`  - ${d._id || d.doc_id} (items: ${(d.actionables||[]).length})`));

        if (!shouldApply) {
            console.log('\nDRY-RUN mode: run with --apply to perform deletion.');
            return;
        }

        // Proceed with deletion
        const idsToDelete = docsToDelete.map(d => d._id || d.doc_id);
        const deleteResult = await col.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`\nDeleted ${deleteResult.deletedCount} documents from 'actionables'`);

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    } finally {
        await client.close();
    }
}

if (require.main === module) main();

module.exports = { main };
