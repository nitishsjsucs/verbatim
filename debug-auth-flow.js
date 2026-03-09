const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

/**
 * This script performs a step-by-step diagnosis of the Better Auth sign-in flow:
 * 1. Connects to MongoDB and retrieves the user and account records
 * 2. Verifies the password hash locally using bcrypt
 * 3. Makes an actual sign-in request to the Next.js API
 * 4. Captures and logs all responses
 */

async function debugAuthFlow() {
  const email = 'compliance_officer@redtech.com';
  const password = 'Govinda123';
  const mongoUri = process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
  const authDbName = "govinda_auth";
  
  console.log('\n========== AUTH FLOW DEBUG ==========\n');
  
  // Step 1: Check MongoDB
  console.log('STEP 1: Checking MongoDB for user and account records...\n');
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    const authDb = client.db(authDbName);
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');
    
    // Find user
    const user = await userCol.findOne({ email });
    if (!user) {
      console.error(`❌ User not found with email: ${email}`);
      return;
    }
    
    console.log(`✅ User found:`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Team: ${user.team}`);
    console.log(`   Email verified: ${user.emailVerified}`);
    
    // Find account
    const account = await accountCol.findOne({ accountId: email });
    if (!account) {
      console.error(`\n❌ Account not found with accountId: ${email}`);
      return;
    }
    
    console.log(`\n✅ Account found:`);
    console.log(`   ID: ${account.id}`);
    console.log(`   User ID: ${account.userId}`);
    console.log(`   Account ID (email): ${account.accountId}`);
    console.log(`   Provider ID: ${account.providerId}`);
    console.log(`   Password hash exists: ${!!account.password}`);
    
    // Step 2: Verify password hash locally
    console.log(`\nSTEP 2: Verifying password hash locally...\n`);
    
    if (!account.password) {
      console.error(`❌ No password hash found in account record`);
      return;
    }
    
    const isHashValid = await bcrypt.compare(password, account.password);
    console.log(`✅ Password hash verification: ${isHashValid ? 'VALID' : 'INVALID'}`);
    
    if (!isHashValid) {
      console.error(`\n❌ Password does not match the stored hash!`);
      console.log(`   This means the hash was created with a different password.`);
      return;
    }
    
    // Step 3: Check user/account relationship
    console.log(`\nSTEP 3: Verifying user/account relationship...\n`);
    
    if (user.id !== account.userId) {
      console.error(`❌ User ID mismatch!`);
      console.log(`   User.id: ${user.id}`);
      console.log(`   Account.userId: ${account.userId}`);
      return;
    }
    
    console.log(`✅ User ID matches account.userId`);
    
    // Step 4: Make sign-in request
    console.log(`\nSTEP 4: Making sign-in request to Next.js API...\n`);
    
    const fetch = require('node-fetch');
    const signInUrl = 'http://localhost:3000/api/auth/sign-in/email';
    
    console.log(`POST ${signInUrl}`);
    console.log(`Body: { email: "${email}", password: "***" }`);
    
    const signInResponse = await fetch(signInUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    
    const signInBody = await signInResponse.text();
    
    console.log(`\nResponse Status: ${signInResponse.status}`);
    console.log(`Response Headers:`);
    for (const [key, value] of signInResponse.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    
    console.log(`\nResponse Body:`);
    try {
      const parsed = JSON.parse(signInBody);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(signInBody);
    }
    
    // Step 5: Analysis
    console.log(`\nSTEP 5: Analysis...\n`);
    
    if (signInResponse.status === 200) {
      console.log(`✅ Sign-in SUCCESSFUL!`);
    } else if (signInResponse.status === 401) {
      console.error(`❌ Sign-in FAILED with 401 (Unauthorized)`);
      console.log(`\nPossible causes:`);
      console.log(`1. Better Auth is not finding the user/account in the database`);
      console.log(`2. Better Auth is using a different database connection`);
      console.log(`3. The password hash format is incompatible with Better Auth's verification`);
      console.log(`4. The account provider ID is not set to 'email'`);
      console.log(`\nAccount provider ID: ${account.providerId}`);
      console.log(`Expected: 'email'`);
    } else {
      console.error(`❌ Sign-in FAILED with ${signInResponse.status}`);
    }
    
  } finally {
    await client.close();
  }
}

debugAuthFlow().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
