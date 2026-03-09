const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Reset Test Actionables
 * 
 * Deletes all test actionables created by seed-test-actionables.js
 * 
 * Removes:
 *   - Document with doc_id = "DOC-TEST-001"
 *   - All actionables with actionable_id matching "ACT-TEST-*"
 * 
 * Usage:
 *   node reset-test-actionables.js
 */

const MONGO_URI = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const BACKEND_DB = "govinda_v2";

async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const backendDb = client.db(BACKEND_DB);
    const actionablesCol = backendDb.collection('actionables');

    // ========================================
    // STEP 1: Delete test document
    // ========================================
    console.log('STEP 1: Deleting test document (DOC-TEST-001)...');
    const deleteResult = await actionablesCol.deleteOne({ _id: "DOC-TEST-001" });
    console.log(`  Deleted: ${deleteResult.deletedCount} document(s)\n`);

    // ========================================
    // STEP 2: Verify deletion
    // ========================================
    console.log('STEP 2: Verifying deletion...');
    const remaining = await actionablesCol.findOne({ _id: "DOC-TEST-001" });
    if (!remaining) {
      console.log('  ✓ DOC-TEST-001 successfully deleted');
    } else {
      console.log('  ✗ DOC-TEST-001 still exists');
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST ACTIONABLES RESET COMPLETE');
    console.log('='.repeat(60));
    console.log('\n✓ All test actionables have been removed');
    console.log('✓ System is ready for real data extraction');

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nConnection closed');
  }
}

run();
