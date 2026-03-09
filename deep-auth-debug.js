/**
 * DEEP AUTH DEBUG SCRIPT
 * 
 * This script performs comprehensive debugging of the Better Auth sign-in flow:
 * 1. Connects to MongoDB and checks user/account records
 * 2. Verifies password hash locally
 * 3. Inspects the actual Better Auth database adapter behavior
 * 4. Makes a sign-in request and captures detailed response
 * 5. Checks for common configuration issues
 */

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');

const email = 'compliance_officer@redtech.com';
const password = 'Govinda123';
const mongoUri = process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const authDbName = "govinda_auth";
const nextJsUrl = 'http://localhost:3000';

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║         DEEP BETTER AUTH DEBUG - SIGN-IN FLOW              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const client = new MongoClient(mongoUri);

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 1: MongoDB Connection & Data Inspection
    // ═══════════════════════════════════════════════════════════════════════
    console.log('PHASE 1: MongoDB Connection & Data Inspection');
    console.log('─'.repeat(60));

    await client.connect();
    console.log('✅ Connected to MongoDB Atlas\n');

    const authDb = client.db(authDbName);
    const userCol = authDb.collection('user');
    const accountCol = authDb.collection('account');
    const sessionCol = authDb.collection('session');

    // Check user
    const user = await userCol.findOne({ email });
    if (!user) {
      console.error(`❌ CRITICAL: User not found with email: ${email}`);
      console.log('\nAvailable users in database:');
      const allUsers = await userCol.find({}).limit(5).toArray();
      allUsers.forEach(u => console.log(`  - ${u.email} (role: ${u.role})`));
      return;
    }

    console.log('✅ User record found:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Team: ${user.team}`);
    console.log(`   Email Verified: ${user.emailVerified}`);
    console.log(`   Created At: ${user.createdAt}`);

    // Check account
    const account = await accountCol.findOne({ accountId: email });
    if (!account) {
      console.error(`\n❌ CRITICAL: Account not found with accountId: ${email}`);
      console.log('\nAvailable accounts in database:');
      const allAccounts = await accountCol.find({}).limit(5).toArray();
      allAccounts.forEach(a => console.log(`  - ${a.accountId} (provider: ${a.providerId})`));
      return;
    }

    console.log('\n✅ Account record found:');
    console.log(`   ID: ${account.id}`);
    console.log(`   User ID: ${account.userId}`);
    console.log(`   Account ID (email): ${account.accountId}`);
    console.log(`   Provider ID: ${account.providerId}`);
    console.log(`   Password Hash Length: ${account.password ? account.password.length : 'MISSING'}`);
    console.log(`   Password Hash Prefix: ${account.password ? account.password.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`   Created At: ${account.createdAt}`);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 2: Password Hash Verification
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\nPHASE 2: Password Hash Verification');
    console.log('─'.repeat(60));

    if (!account.password) {
      console.error('❌ CRITICAL: No password hash found in account record');
      return;
    }

    const isHashValid = await bcrypt.compare(password, account.password);
    console.log(`Password "${password}" vs stored hash:`);
    console.log(`   bcrypt.compare() result: ${isHashValid ? '✅ VALID' : '❌ INVALID'}`);

    if (!isHashValid) {
      console.error('\n❌ CRITICAL: Password does not match the stored hash!');
      console.log('This means either:');
      console.log('  1. The account was created with a different password');
      console.log('  2. The hash is corrupted');
      console.log('  3. The password in the database is not bcrypt format');
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 3: Data Consistency Checks
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\nPHASE 3: Data Consistency Checks');
    console.log('─'.repeat(60));

    if (user.id !== account.userId) {
      console.error('❌ CRITICAL: User ID mismatch!');
      console.log(`   User.id: ${user.id}`);
      console.log(`   Account.userId: ${account.userId}`);
      return;
    }
    console.log('✅ User ID matches account.userId');

    if (account.providerId !== 'email') {
      console.error(`❌ WARNING: Provider ID is "${account.providerId}", expected "email"`);
      console.log('   Better Auth may not recognize this as an email/password account');
    } else {
      console.log('✅ Provider ID is "email"');
    }

    // Check for existing sessions
    const existingSessions = await sessionCol.find({ userId: user.id }).toArray();
    console.log(`✅ Existing sessions for this user: ${existingSessions.length}`);

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 4: Sign-In Request
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\nPHASE 4: Making Sign-In Request to Next.js');
    console.log('─'.repeat(60));

    const signInUrl = `${nextJsUrl}/api/auth/sign-in/email`;
    console.log(`POST ${signInUrl}`);
    console.log(`Body: { email: "${email}", password: "***" }\n`);

    const signInResponse = await fetch(signInUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    const signInBody = await signInResponse.text();

    console.log(`Response Status: ${signInResponse.status}`);
    console.log(`Response Headers:`);
    Array.from(signInResponse.headers.entries()).forEach(([key, value]) => {
      if (key.toLowerCase() !== 'set-cookie') {
        console.log(`  ${key}: ${value}`);
      }
    });

    console.log(`\nResponse Body:`);
    try {
      const parsed = JSON.parse(signInBody);
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log(signInBody);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 5: Analysis & Diagnosis
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\nPHASE 5: Analysis & Diagnosis');
    console.log('─'.repeat(60));

    if (signInResponse.status === 200) {
      console.log('✅✅✅ SIGN-IN SUCCESSFUL! ✅✅✅');
    } else if (signInResponse.status === 401) {
      console.error('❌ SIGN-IN FAILED with 401 (Unauthorized)');
      console.log('\nDiagnosis:');
      console.log('Better Auth rejected the credentials despite:');
      console.log(`  ✅ User exists in database`);
      console.log(`  ✅ Account exists in database`);
      console.log(`  ✅ Password hash is valid (bcrypt.compare = true)`);
      console.log(`  ✅ User/Account IDs match`);
      console.log(`  ✅ Provider ID is "email"`);
      console.log('\nLikely causes:');
      console.log('1. Better Auth is connecting to a DIFFERENT MongoDB database');
      console.log('   → Check MONGODB_URI and AUTH_DB_NAME in .env.local');
      console.log('   → Verify they match the values used in this script');
      console.log('2. Better Auth is using a different MongoDB adapter configuration');
      console.log('   → Check web/src/lib/auth.ts for mongodbAdapter setup');
      console.log('3. There is a mismatch between how the account was created and how Better Auth queries it');
      console.log('   → Check if account.accountId is being queried correctly');
      console.log('4. The BETTER_AUTH_SECRET is not set or is incorrect');
      console.log('   → This could affect session creation even if sign-in succeeds');
    } else {
      console.error(`❌ SIGN-IN FAILED with ${signInResponse.status}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: Database Configuration Summary
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n\nPHASE 6: Configuration Summary');
    console.log('─'.repeat(60));

    console.log('Environment Variables (from this script):');
    console.log(`  MONGO_URI: ${mongoUri.substring(0, 50)}...`);
    console.log(`  AUTH_DB_NAME: ${authDbName}`);
    console.log(`\nExpected in .env.local:`);
    console.log(`  MONGODB_URI: ${mongoUri.substring(0, 50)}...`);
    console.log(`  AUTH_DB_NAME: ${authDbName}`);
    console.log(`  BETTER_AUTH_SECRET: (should be set)`);
    console.log(`  BETTER_AUTH_URL: http://localhost:3000`);

  } catch (error) {
    console.error('\n❌ Error during debug:', error.message);
    console.error(error.stack);
  } finally {
    await client.close();
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
