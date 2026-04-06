// remove-specific-roles.js
// Finds and removes role references for specific role names across all actionables
// - Removes matching entries from `assigned_teams`
// - Removes matching keys from `team_workflows`
// - Clears `workstream` or `actor` fields if they match
// Backs up modified documents before writing changes

const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const ROLES_TO_REMOVE = [
    'testerhead',
    'tester',
    'test maker',
    'test checker'
];

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ROLE_REGEXES = ROLES_TO_REMOVE.map(r => new RegExp('\\b' + escapeRegExp(r) + '\\b', 'i'));
function matchesRole(value) {
    if (!value && value !== 0) return false;
    const s = String(value);
    return ROLE_REGEXES.some(rx => rx.test(s));
}

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }

async function main() {
    const client = new MongoClient(DEFAULT_URI);
    const backupDir = path.join(__dirname, 'backups', 'roles-remove-' + timestamp());
    fs.mkdirSync(backupDir, { recursive: true });

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const docs = await col.find({}).toArray();
        console.log(`Found ${docs.length} documents in 'actionables'`);

        let docsModified = 0;
        let totalRoleRefsRemoved = 0;
        const modifiedDocs = [];

        for (const doc of docs) {
            const items = Array.isArray(doc.actionables) ? doc.actionables : [];
            let docChanged = false;
            const newItems = [];

            for (const item of items) {
                let changed = false;
                const newItem = { ...item };

                // assigned_teams may be array
                if (Array.isArray(newItem.assigned_teams) && newItem.assigned_teams.length > 0) {
                    const before = newItem.assigned_teams.slice();
                    newItem.assigned_teams = newItem.assigned_teams.filter(t => !matchesRole(t));
                    const removed = before.length - newItem.assigned_teams.length;
                    if (removed > 0) { changed = true; totalRoleRefsRemoved += removed; }
                }

                // team_workflows: remove keys that match
                if (newItem.team_workflows && typeof newItem.team_workflows === 'object') {
                    const keys = Object.keys(newItem.team_workflows);
                    for (const k of keys) {
                        if (matchesRole(k)) {
                            delete newItem.team_workflows[k];
                            changed = true;
                            totalRoleRefsRemoved += 1;
                        }
                    }
                }

                // workstream exact or containing role
                if (newItem.workstream && matchesRole(newItem.workstream)) {
                    newItem.workstream = '';
                    changed = true; totalRoleRefsRemoved += 1;
                }

                // actor
                if (newItem.actor && matchesRole(newItem.actor)) {
                    newItem.actor = '';
                    changed = true; totalRoleRefsRemoved += 1;
                }

                // team_reviewer_name is a person name — skip

                if (changed) {
                    docChanged = true;
                }

                newItems.push(newItem);
            }

            if (docChanged) {
                // backup original doc
                const fname = path.join(backupDir, `${doc._id || doc.doc_id}.json`);
                fs.writeFileSync(fname, JSON.stringify(doc, null, 2), 'utf8');

                // update doc
                await col.updateOne({ _id: doc._id }, { $set: { actionables: newItems } });
                docsModified += 1;
                modifiedDocs.push({ docId: doc._id || doc.doc_id });
                console.log(`Modified doc ${doc._id || doc.doc_id}`);
            }
        }

        console.log('\nSummary:');
        console.log(`  • Documents scanned : ${docs.length}`);
        console.log(`  • Documents modified: ${docsModified}`);
        console.log(`  • Total role references removed: ${totalRoleRefsRemoved}`);
        console.log(`  • Backups written to: ${backupDir}`);

        if (docsModified === 0) console.log('  • No matching role references found.');

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch(e){}
    }
}

if (require.main === module) main();

module.exports = { main };