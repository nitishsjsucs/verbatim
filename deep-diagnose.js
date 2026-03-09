const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Deep diagnosis: compare account records created by Better Auth (via /api/users)
 * vs accounts created by our reset script (direct MongoDB insertion with bcrypt).
 * 
 * This will reveal the exact schema differences.
 */

async function diagnose() {
  const uri = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const authDb = client.db("govinda_auth");
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');

    // Get ALL users
    const allUsers = await userCol.find({}).toArray();
    console.log(`Total users: ${allUsers.length}\n`);

    // Get ALL accounts  
    const allAccounts = await accountCol.find({}).toArray();
    console.log(`Total accounts: ${allAccounts.length}\n`);

    // Find the user created via Better Auth API (temp.compliance...)
    const apiUser = allUsers.find(u => u.email && u.email.includes('temp.compliance'));
    const scriptUser = allUsers.find(u => u.email === 'compliance_officer@redtech.com');

    if (apiUser) {
      console.log('=== USER CREATED VIA BETTER AUTH API (working) ===');
      console.log('User document keys:', Object.keys(apiUser).sort().join(', '));
      console.log('User document:');
      const { _id: _a, ...apiUserClean } = apiUser;
      console.log(JSON.stringify(apiUserClean, null, 2));

      const apiAccount = allAccounts.find(a => a.userId === apiUser.id);
      if (apiAccount) {
        console.log('\nAccount document keys:', Object.keys(apiAccount).sort().join(', '));
        console.log('Account document:');
        const { _id: _b, ...apiAccountClean } = apiAccount;
        console.log(JSON.stringify(apiAccountClean, null, 2));
      } else {
        console.log('\nNo account found for API user!');
      }
    } else {
      console.log('No API-created user found (temp.compliance...)');
    }

    console.log('\n' + '='.repeat(60) + '\n');

    if (scriptUser) {
      console.log('=== USER CREATED VIA DIRECT MONGO INSERT (broken) ===');
      console.log('User document keys:', Object.keys(scriptUser).sort().join(', '));
      console.log('User document:');
      const { _id: _c, ...scriptUserClean } = scriptUser;
      console.log(JSON.stringify(scriptUserClean, null, 2));

      const scriptAccount = allAccounts.find(a => a.userId === scriptUser.id);
      if (scriptAccount) {
        console.log('\nAccount document keys:', Object.keys(scriptAccount).sort().join(', '));
        console.log('Account document:');
        const { _id: _d, ...scriptAccountClean } = scriptAccount;
        console.log(JSON.stringify(scriptAccountClean, null, 2));
      } else {
        console.log('\nNo account found for script user!');
      }
    } else {
      console.log('No script-created compliance user found');
    }

    // Compare password hash formats
    console.log('\n' + '='.repeat(60));
    console.log('\n=== PASSWORD HASH COMPARISON ===');
    
    if (apiUser) {
      const apiAccount = allAccounts.find(a => a.userId === apiUser.id);
      if (apiAccount) {
        console.log(`API user password (first 30 chars): ${apiAccount.password?.substring(0, 30)}`);
        console.log(`API user password length: ${apiAccount.password?.length}`);
      }
    }
    
    if (scriptUser) {
      const scriptAccount = allAccounts.find(a => a.userId === scriptUser.id);
      if (scriptAccount) {
        console.log(`Script user password (first 30 chars): ${scriptAccount.password?.substring(0, 30)}`);
        console.log(`Script user password length: ${scriptAccount.password?.length}`);
      }
    }

    // Check providerId values
    console.log('\n=== ALL DISTINCT PROVIDER IDS ===');
    const providerIds = [...new Set(allAccounts.map(a => a.providerId))];
    console.log(providerIds);

    // Check for credential vs email provider
    const credentialAccounts = allAccounts.filter(a => a.providerId === 'credential');
    const emailAccounts = allAccounts.filter(a => a.providerId === 'email');
    console.log(`\nAccounts with providerId "credential": ${credentialAccounts.length}`);
    console.log(`Accounts with providerId "email": ${emailAccounts.length}`);

    if (credentialAccounts.length > 0) {
      console.log('\nCredential accounts belong to:');
      for (const ca of credentialAccounts) {
        const u = allUsers.find(u => u.id === ca.userId);
        console.log(`  ${ca.accountId} -> user: ${u?.email || 'unknown'}`);
      }
    }

  } finally {
    await client.close();
  }
}

diagnose().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
