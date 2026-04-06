// remove-all-actionables.js
// Usage:
//   node remove-all-actionables.js         # dry-run (no writes)
//   node remove-all-actionables.js --apply # actually delete

const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const shouldApply = args.includes('--apply');
const isDryRun = !shouldApply;

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
}

async function backupCollection(db, name, backupDir) {
    try {
        const docs = await db.collection(name).find({}).toArray();
        fs.writeFileSync(path.join(backupDir, `${name}.json`), JSON.stringify(docs, null, 2), 'utf8');
        return docs.length;
    } catch (err) {
        console.error(`Failed to backup ${name}:`, err);
        return 0;
    }
}

async function main() {
    console.log(isDryRun ? '\n📋 DRY-RUN: No changes will be written to the database.\n' : '\n⚠️  APPLY MODE: This will delete documents from the database.');
    const client = new MongoClient(DEFAULT_URI);

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);

        const collectionsToManage = ['actionables', 'delegation_requests', 'notifications'];
        const backupDir = path.join(__dirname, 'backups', timestamp());
        fs.mkdirSync(backupDir, { recursive: true });

        console.log('Backing up collections to:', backupDir);
        const counts = {};
        for (const coll of collectionsToManage) {
            const n = await backupCollection(db, coll, backupDir);
            counts[coll] = n;
            console.log(`  • ${coll}: ${n} documents backed up`);
        }

        console.log('');
        if (isDryRun) {
            console.log('DRY-RUN summary:');
            for (const coll of collectionsToManage) {
                console.log(`  • Would delete ${counts[coll]} documents from '${coll}'`);
            }
            console.log('\nTo actually perform deletion, re-run with --apply:');
            console.log('  node remove-all-actionables.js --apply\n');
        } else {
            for (const coll of collectionsToManage) {
                const res = await db.collection(coll).deleteMany({});
                console.log(`Deleted ${res.deletedCount} documents from '${coll}'`);
            }
            console.log('\n✅ Deletion complete. Backups are stored in:', backupDir);
        }

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch(e){}
    }
}

if (require.main === module) main();

module.exports = { main };
