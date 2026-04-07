// clear-cag-tracker-actionables.js
// Finds documents in `actionables` collection whose `_id`, `doc_id` or `doc_name`
// contain 'cag' or 'tracker' (case-insensitive), backs them up to
// backups/<timestamp>/, then clears their `actionables` arrays.
//
// Usage:
//   node clear-cag-tracker-actionables.js        # run and clear matching docs
//   node clear-cag-tracker-actionables.js --dry-run   # preview only

let MongoClient;
try { ({ MongoClient } = require('mongodb')); } catch (e) { ({ MongoClient } = require('./web/node_modules/mongodb')); }
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

async function run() {
    const client = new MongoClient(DEFAULT_URI);
    const backupDir = path.join(__dirname, 'backups', timestamp());

    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        // Find target documents matching 'cag' or 'tracker'
        const regexCag = /cag/i;
        const regexTracker = /tracker/i;

        const cursor = col.find({
            $or: [
                { _id: { $regex: regexCag } },
                { doc_id: { $regex: regexCag } },
                { doc_name: { $regex: regexCag } },
                { _id: { $regex: regexTracker } },
                { doc_id: { $regex: regexTracker } },
                { doc_name: { $regex: regexTracker } },
            ]
        });

        const docs = await cursor.toArray();
        if (docs.length === 0) {
            console.log('No CAG/tracker documents found in `actionables` collection.');
            return;
        }

        console.log(`Found ${docs.length} matching document(s):`);
        docs.forEach(d => console.log(`  - ${d._id} (${d.doc_name || ''}) - actionables=${(d.actionables||[]).length}`));

        if (DRY_RUN) {
            console.log('\nDRY-RUN: would back up and clear the above documents.');
            return;
        }

        // Ensure backup directory
        fs.mkdirSync(backupDir, { recursive: true });

        let totalCleared = 0;
        for (const doc of docs) {
            const idSafe = String(doc._id).replace(/[\\/:]/g, '_');
            const filePath = path.join(backupDir, `${idSafe}.json`);
            fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf8');
            console.log(`  • Backed up ${doc._id} -> ${filePath}`);

            const res = await col.updateOne({ _id: doc._id }, { $set: { actionables: [] } });
            console.log(`  • Cleared actionables for ${doc._id} (matched=${res.matchedCount}, modified=${res.modifiedCount})`);
            if (res.modifiedCount > 0) totalCleared += 1;
        }

        console.log(`\nCompleted. Backups saved to: ${backupDir}`);
        console.log(`Documents cleared: ${totalCleared} / ${docs.length}`);

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) run();

module.exports = { run };
