const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || 'govinda_v2';

(async () => {
  const client = new MongoClient(DEFAULT_URI);
  try {
    await client.connect();
    const db = client.db(DEFAULT_DB);
    const doc = await db.collection('actionables').findOne({_id: 'DOC-TEST-001'});
    const total = doc && Array.isArray(doc.actionables) ? doc.actionables.length : 0;
    const active = doc && Array.isArray(doc.actionables) ? doc.actionables.filter(i => i.task_status === 'active').length : 0;
    console.log(`DOC-TEST-001: ${total} items, ${active} active`);
  } catch (err) {
    console.error('Error counting actionables:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
