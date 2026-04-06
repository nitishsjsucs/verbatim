// clear-all-testing-items.js
// Backs up the entire `testing_items` collection and deletes all documents.
// Usage: node clear-all-testing-items.js

const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }

async function main() {
    const client = new MongoClient(DEFAULT_URI);
    const backupDir = path.join(__dirname, 'backups', 'testing-items-' + timestamp());

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('testing_items');

        console.log('\nBacking up `testing_items` collection...');
        const docs = await col.find({}).toArray();
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'testing-items-backup.json'), JSON.stringify(docs, null, 2), 'utf8');
        console.log(`  • Backed up ${docs.length} documents to ${backupDir}`);

        if (docs.length === 0) {
            console.log('\nNo testing items to delete. Nothing to do.');
            return;
        }

        console.log('\nDeleting all testing items...');
        const del = await col.deleteMany({});
        console.log(`  • Deleted ${del.deletedCount} documents from 'testing_items'`);

        console.log('\nDone. Backup saved at:', backupDir);
    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) main();

module.exports = { main };