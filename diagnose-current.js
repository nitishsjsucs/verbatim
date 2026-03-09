const { MongoClient } = require('./web/node_modules/mongodb');

async function diagnose() {
  const uri = (process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda").trim();
  const authDbName = (process.env.AUTH_DB_NAME || "govinda_auth").trim();
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const authDb = client.db(authDbName);
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');

    // Get all users
    const users = await userCol.find({}).toArray();
    console.log(`=== Total Users: ${users.length} ===\n`);

    // Find compliance-related users
    const complianceUsers = users.filter(u => u.email && u.email.toLowerCase().includes('compliance'));
    console.log('=== Compliance-related Users ===');
    for (const u of complianceUsers) {
      console.log(`Email: ${u.email}`);
      console.log(`  Role: ${u.role}`);
      console.log(`  Team: ${u.team}`);
      console.log(`  ID: ${u.id}\n`);
    }

    // Get all accounts
    const accounts = await accountCol.find({}).toArray();
    console.log(`\n=== Total Accounts: ${accounts.length} ===\n`);

    // Find compliance accounts
    const complianceAccounts = accounts.filter(a => a.accountId && a.accountId.toLowerCase().includes('compliance'));
    console.log('=== Compliance-related Accounts ===');
    for (const a of complianceAccounts) {
      console.log(`Email: ${a.accountId}`);
      console.log(`  Provider: ${a.providerId}`);
      console.log(`  Has password: ${!!a.password}`);
      console.log(`  User ID: ${a.userId}\n`);
    }

    // Role distribution
    const roleStats = await userCol.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    console.log('=== Role Distribution ===');
    for (const stat of roleStats) {
      console.log(`${stat._id}: ${stat.count}`);
    }

  } finally {
    await client.close();
  }
}

diagnose().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
