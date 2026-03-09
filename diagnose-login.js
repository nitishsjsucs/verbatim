const { MongoClient } = require('./web/node_modules/mongodb');
const bcrypt = require('bcryptjs');

async function diagnose() {
  const uri = process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const authDbName = "govinda_auth";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const authDb = client.db(authDbName);
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');

    // Get first few users
    const users = await userCol.find({}).limit(5).toArray();
    console.log('=== Sample Users (first 5) ===');
    for (const u of users) {
      console.log(`ID: ${u.id}`);
      console.log(`  Email: ${u.email}`);
      console.log(`  Name: ${u.name}`);
      console.log(`  Role: ${u.role}`);
      console.log(`  Team: ${u.team}`);
    }

    // Get first few accounts
    const accounts = await accountCol.find({}).limit(5).toArray();
    console.log('\n=== Sample Accounts (first 5) ===');
    for (const acc of accounts) {
      console.log(`Account ID: ${acc.id}`);
      console.log(`  User ID: ${acc.userId}`);
      console.log(`  Account ID (email): ${acc.accountId}`);
      console.log(`  Provider ID: ${acc.providerId}`);
      console.log(`  Password hash: ${acc.password?.substring(0, 20)}...`);
      
      // Test bcrypt verification
      const testHash = acc.password;
      const isValid = await bcrypt.compare('Govinda123', testHash);
      console.log(`  Hash verifies "Govinda123": ${isValid}`);
    }

    // Check for mismatches
    console.log('\n=== Checking for User/Account Mismatches ===');
    const userEmails = new Set(users.map(u => u.email));
    const accountEmails = new Set(accounts.map(a => a.accountId));
    
    console.log(`Users with no matching account:`);
    for (const email of userEmails) {
      if (!accountEmails.has(email)) {
        console.log(`  - ${email}`);
      }
    }

    console.log(`\nAccounts with no matching user:`);
    for (const email of accountEmails) {
      if (!userEmails.has(email)) {
        console.log(`  - ${email}`);
      }
    }

    // Check all roles
    const roleStats = await userCol.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    console.log('\n=== Role Distribution ===');
    for (const stat of roleStats) {
      console.log(`${stat._id}: ${stat.count}`);
    }

    // Check all provider IDs
    const providerStats = await accountCol.aggregate([
      { $group: { _id: '$providerId', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    console.log('\n=== Provider ID Distribution ===');
    for (const stat of providerStats) {
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
