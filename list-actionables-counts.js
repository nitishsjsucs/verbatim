// list-actionables-counts.js
// Lists all documents in `actionables` collection and prints the count of actionables per doc

let MongoClient;
try { ({ MongoClient } = require('mongodb')); } catch (e) { ({ MongoClient } = require('./web/node_modules/mongodb')); }

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

async function run() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const docs = await col.find({}).project({ _id:1, doc_name:1, actionables:1 }).toArray();
        if (!docs || docs.length === 0) {
            console.log('No documents found in actionables collection.');
            return;
        }

        let totalDocsWith = 0;
        let totalActionables = 0;
        console.log('\nActionables per document:\n');
        for (const d of docs) {
            const cnt = Array.isArray(d.actionables) ? d.actionables.length : 0;
            if (cnt > 0) totalDocsWith++;
            totalActionables += cnt;
            console.log(` - ${d._id} : ${cnt}  ${d.doc_name ? '- ' + d.doc_name : ''}`);
        }

        console.log('\nSUMMARY:');
        console.log(` Documents with actionables: ${totalDocsWith}`);
        console.log(` Total actionables: ${totalActionables}\n`);

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) run();

module.exports = { run };
