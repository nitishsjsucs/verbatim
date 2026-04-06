// clear-all-actionables.js
// Backs up the `actionables` collection then clears all actionables arrays
// Usage: node clear-all-actionables.js

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
    const backupDir = path.join(__dirname, 'backups', timestamp());

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log('\nBacking up `actionables` collection...');
        const docs = await col.find({}).toArray();
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'actionables-before-clear.json'), JSON.stringify(docs, null, 2), 'utf8');
        console.log(`  • Backed up ${docs.length} documents to ${backupDir}`);

        console.log('\nClearing all actionables arrays from every document...');
        const res = await col.updateMany({}, { $set: { actionables: [] } });
        console.log(`  • Matched ${res.matchedCount}, Modified ${res.modifiedCount}`);

        // Verify any remaining actionables
        const remainingDocs = await col.find({ 'actionables.0': { $exists: true } }).toArray();
        const remainingCount = remainingDocs.reduce((s, d) => s + (d.actionables?.length || 0), 0);
        console.log(`\nRemaining actionables across all documents: ${remainingCount}`);
        if (remainingCount === 0) console.log('  • All actionables cleared.');
        else console.log('  • Some actionables still exist in documents listed above.');

        console.log('\nDone. Backup saved at:', backupDir);
    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch(e){}
    }
}

if (require.main === module) main();

module.exports = { main };