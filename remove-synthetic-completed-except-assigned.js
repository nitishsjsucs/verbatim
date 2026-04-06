// remove-synthetic-completed-except-assigned.js
// Usage:
//   node remove-synthetic-completed-except-assigned.js        # dry-run
//   node remove-synthetic-completed-except-assigned.js --apply # actually delete

const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');

async function main() {
    console.log(shouldApply ? '\n⚠️  APPLY MODE: Deleting matched documents' : '\n📋 DRY-RUN: Listing matched documents (no DB writes)');

    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const syntheticDocs = await col.find({ synthetic: true }).toArray();
        console.log(`\nFound ${syntheticDocs.length} documents with synthetic=true`);

        const toDelete = [];
        for (const doc of syntheticDocs) {
            const items = doc.actionables || [];
            if (items.length === 0) {
                // empty synthetic doc — candidate for deletion
                toDelete.push(doc._id);
                continue;
            }

            // If any item is assigned (task_status === 'assigned'), skip this document
            const hasAssigned = items.some(i => (i.task_status || '').toLowerCase() === 'assigned');
            // Delete only if ALL items are 'completed'
            const allCompleted = items.every(i => (i.task_status || '').toLowerCase() === 'completed');

            if (!hasAssigned && allCompleted) {
                toDelete.push(doc._id);
            }
        }

        console.log(`\nDocuments selected for deletion: ${toDelete.length}`);
        toDelete.forEach(id => console.log(`  - ${id}`));

        if (!shouldApply) {
            console.log('\nDry-run complete. To delete these documents, re-run with --apply.');
            return;
        }

        if (toDelete.length === 0) {
            console.log('\nNo documents matched deletion criteria.');
            return;
        }

        const deleteResult = await col.deleteMany({ _id: { $in: toDelete } });
        console.log(`\nDeleted ${deleteResult.deletedCount} documents from 'actionables'`);

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) main();

module.exports = { main };