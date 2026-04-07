// move-assigned-to-cag.js
// Moves actionables from a source document into the CAG actionable document
// and marks them as unpublished (clears `published_at` fields).
// Usage:
//   node move-assigned-to-cag.js --source DOC-SYN-ASSIGNED-2026-04-07 --target DOC-CAG-Actionables
//   node move-assigned-to-cag.js --source <id> --target <id> --dry-run

let MongoClient;
try { ({ MongoClient } = require('mongodb')); } catch (e) { ({ MongoClient } = require('./web/node_modules/mongodb')); }

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const srcIndex = args.indexOf('--source');
const SOURCE_DOC = srcIndex !== -1 ? args[srcIndex + 1] : 'DOC-SYN-ASSIGNED-2026-04-07';
const tgtIndex = args.indexOf('--target');
const TARGET_DOC = tgtIndex !== -1 ? args[tgtIndex + 1] : 'DOC-CAG-Actionables';
const DRY_RUN = args.includes('--dry-run');
const NO_CLEAR = args.includes('--no-clear-source');

function nowISO() { return new Date().toISOString(); }

async function run() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log(`Reading source doc '${SOURCE_DOC}'...`);
        const src = await col.findOne({ _id: SOURCE_DOC });
        if (!src) {
            console.error(`Source document not found: ${SOURCE_DOC}`);
            process.exitCode = 2; return;
        }

        const items = Array.isArray(src.actionables) ? src.actionables : [];
        console.log(`Found ${items.length} actionables in '${SOURCE_DOC}'.`);

        const modified = items.map(it => {
            const copy = { ...it };
            // Mark as unpublished
            copy.published_at = "";
            copy.first_published_at = "";
            // Keep as assigned
            copy.task_status = 'assigned';
            // Set approval to pending
            copy.approval_status = 'pending';
            // Move actor to CAG
            copy.actor = 'CAG';
            // Ensure assigned_teams contains CAG
            try {
                if (!Array.isArray(copy.assigned_teams) || copy.assigned_teams.length === 0) copy.assigned_teams = ['CAG'];
            } catch (e) { copy.assigned_teams = ['CAG']; }
            return copy;
        });

        if (DRY_RUN) {
            console.log('\nDRY-RUN: The following would be performed:');
            console.log(`  • Upsert target document: _id=${TARGET_DOC}, actionables=${modified.length}`);
            console.log(`  • Clear source document actionables: ${!NO_CLEAR}`);
            if (modified.length > 0) console.log('\nSample modified item:', JSON.stringify(modified[0], null, 2));
            return;
        }

        console.log(`\nUpserting into target document '${TARGET_DOC}'...`);
        const upsertResult = await col.updateOne(
            { _id: TARGET_DOC },
            { $set: {
                _id: TARGET_DOC,
                doc_id: TARGET_DOC,
                doc_name: 'CAG → Actionable section',
                actionables: modified,
                synthetic: false,
                generated_at: nowISO(),
            } },
            { upsert: true }
        );

        console.log('Upsert result:', { matchedCount: upsertResult.matchedCount, modifiedCount: upsertResult.modifiedCount, upsertedCount: upsertResult.upsertedCount });

        if (!NO_CLEAR) {
            console.log(`Clearing actionables array in source document '${SOURCE_DOC}'...`);
            const clearRes = await col.updateOne({ _id: SOURCE_DOC }, { $set: { actionables: [] } });
            console.log('Source clear result:', { matchedCount: clearRes.matchedCount, modifiedCount: clearRes.modifiedCount });
        } else {
            console.log('Skipping clearing of source document ( --no-clear-source )');
        }

        const verify = await col.findOne({ _id: TARGET_DOC });
        const countInTarget = verify?.actionables?.length || 0;
        console.log(`\nVerified target doc '${TARGET_DOC}': ${countInTarget} actionables.`);

        console.log('\n✅ Move complete.');

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) run();

module.exports = { run };
