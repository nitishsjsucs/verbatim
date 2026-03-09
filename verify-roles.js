const { MongoClient } = require('./web/node_modules/mongodb');

async function verify() {
  const uri = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const authDb = client.db("govinda_auth");
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');

    // Check compliance officer
    const compliance = await userCol.findOne({ email: 'compliance.officer.compliance.redtech@redtech.com' });
    console.log('=== Compliance Officer ===');
    console.log(`  Email: ${compliance?.email}`);
    console.log(`  Role: ${compliance?.role}`);
    console.log(`  Team: ${compliance?.team}`);
    console.log(`  _id type: ${typeof compliance?._id} (${compliance?._id})`);

    // Check its account
    const compAccount = await accountCol.findOne({ userId: compliance?._id?.toString() });
    console.log(`  Account found: ${!!compAccount}`);
    if (compAccount) {
      console.log(`  Provider: ${compAccount.providerId}`);
    }

    // Role distribution
    const roleStats = await userCol.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    console.log('\n=== Role Distribution ===');
    for (const stat of roleStats) {
      console.log(`  ${stat._id || '(empty)'}: ${stat.count}`);
    }

    // Provider distribution
    const providerStats = await accountCol.aggregate([
      { $group: { _id: '$providerId', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]).toArray();
    
    console.log('\n=== Provider Distribution ===');
    for (const stat of providerStats) {
      console.log(`  ${stat._id}: ${stat.count}`);
    }

    // Total counts
    const userCount = await userCol.countDocuments();
    const accountCount = await accountCol.countDocuments();
    console.log(`\nTotal users: ${userCount}`);
    console.log(`Total accounts: ${accountCount}`);

  } finally {
    await client.close();
  }
}

verify().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
