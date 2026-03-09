const { MongoClient } = require('./web/node_modules/mongodb');

async function listAll() {
  const uri = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const authDb = client.db("govinda_auth");
    const users = await authDb.collection('user').find({}, {
      projection: { _id: 0, name: 1, email: 1, role: 1, team: 1 }
    }).sort({ role: 1, team: 1 }).toArray();

    for (const u of users) {
      console.log(`${(u.team || '').padEnd(38)} | ${(u.role || '').padEnd(20)} | ${u.email}`);
    }
    console.log(`\nTotal: ${users.length} users`);
  } finally {
    await client.close();
  }
}

listAll().catch(err => { console.error(err); process.exit(1); });
