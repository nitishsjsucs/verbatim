// clear-testing-actionables.js
// Finds actionables assigned to testing roles and removes them (keeps others).
// Backs up affected documents before modifying.
// Usage: node clear-testing-actionables.js

const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }
function isTestingString(s) {
    if (!s) return false;
    return /test|testing|qa|quality/i.test(String(s));
}

async function main() {
    const client = new MongoClient(DEFAULT_URI);
    const backupDir = path.join(__dirname, 'backups', 'testing-clear-' + timestamp());

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const allDocs = await col.find({}).toArray();
        if (!allDocs.length) {
            console.log('No documents found in actionables collection.');
            return;
        }

        fs.mkdirSync(backupDir, { recursive: true });
        let totalRemoved = 0;
        const affected = [];

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            if (!items.length) continue;

            const keep = [];
            const remove = [];

            for (const it of items) {
                const assignedTeams = Array.isArray(it.assigned_teams) ? it.assigned_teams : [];
                const teamWorkflowKeys = it.team_workflows && typeof it.team_workflows === 'object' ? Object.keys(it.team_workflows) : [];
                const workstream = it.workstream || '';
                const actor = it.actor || '';

                const assignedTest = assignedTeams.some(t => isTestingString(t));
                const workflowTest = teamWorkflowKeys.some(k => isTestingString(k));
                const workstreamTest = isTestingString(workstream);
                const actorTest = isTestingString(actor);

                if (assignedTest || workflowTest || workstreamTest || actorTest) {
                    remove.push(it);
                } else {
                    keep.push(it);
                }
            }

            if (remove.length > 0) {
                // backup this doc's original
                const backupFile = path.join(backupDir, `${doc._id || doc.doc_id}.json`);
                fs.writeFileSync(backupFile, JSON.stringify(doc, null, 2), 'utf8');

                // update doc to keep only non-testing items
                await col.updateOne({ _id: doc._id }, { $set: { actionables: keep } });

                totalRemoved += remove.length;
                affected.push({ docId: doc._id || doc.doc_id, removed: remove.length });
                console.log(`Modified doc ${doc._id || doc.doc_id}: removed ${remove.length} testing actionables`);
            }
        }

        console.log('\nSummary:');
        console.log(`  • Documents scanned : ${allDocs.length}`);
        console.log(`  • Documents modified: ${affected.length}`);
        console.log(`  • Total actionables removed: ${totalRemoved}`);
        console.log(`  • Backups written to: ${backupDir}`);

        if (totalRemoved === 0) console.log('\nNo testing-assigned actionables found.');

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) main();

module.exports = { main };