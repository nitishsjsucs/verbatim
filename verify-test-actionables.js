const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Verify Test Actionables
 * 
 * Confirms that 100 test actionables were created correctly
 * and are distributed across L2 teams only.
 */

const MONGO_URI = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const BACKEND_DB = "govinda_v2";

async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const backendDb = client.db(BACKEND_DB);
    const actionablesCol = backendDb.collection('actionables');
    const teamsCol = backendDb.collection('teams');

    // Fetch test document
    const testDoc = await actionablesCol.findOne({ _id: "DOC-TEST-001" });
    if (!testDoc) {
      console.log('✗ DOC-TEST-001 not found');
      return;
    }

    console.log('=== TEST ACTIONABLES VERIFICATION ===\n');
    console.log(`Document: ${testDoc.doc_id}`);
    console.log(`Total actionables: ${testDoc.actionables.length}`);
    console.log(`Created at: ${testDoc.extracted_at}\n`);

    // Get L0 and L1 team names
    const l0Teams = await teamsCol.find({ depth: 0 }).toArray();
    const l1Teams = await teamsCol.find({ depth: 1 }).toArray();
    const l0Names = new Set(l0Teams.map(t => t.name));
    const l1Names = new Set(l1Teams.map(t => t.name));

    // Verify each actionable
    let violations = 0;
    const distribution = {};

    for (const a of testDoc.actionables) {
      const team = a.workstream;
      distribution[team] = (distribution[team] || 0) + 1;

      // Check L0/L1 constraint
      if (l0Names.has(team) || l1Names.has(team)) {
        console.log(`✗ ${a.actionable_id}: assigned to ${team} (NOT L2)`);
        violations++;
      }

      // Check assigned_teams
      if (!a.assigned_teams || a.assigned_teams.length === 0) {
        console.log(`✗ ${a.actionable_id}: no assigned_teams`);
        violations++;
      } else if (a.assigned_teams[0] !== team) {
        console.log(`✗ ${a.actionable_id}: workstream mismatch`);
        violations++;
      }

      // Check team_workflows
      if (!a.team_workflows || !a.team_workflows[team]) {
        console.log(`✗ ${a.actionable_id}: missing team_workflows for ${team}`);
        violations++;
      }
    }

    console.log('\n=== DISTRIBUTION ACROSS L2 TEAMS ===\n');
    for (const [team, count] of Object.entries(distribution).sort()) {
      console.log(`${team.padEnd(40)} : ${count} actionables`);
    }

    console.log('\n=== VERIFICATION RESULTS ===\n');
    console.log(`✓ Total actionables: ${testDoc.actionables.length}`);
    console.log(`✓ L2 teams with actionables: ${Object.keys(distribution).length}`);
    console.log(`✓ L0/L1 constraint violations: ${violations}`);

    if (violations === 0 && testDoc.actionables.length === 100) {
      console.log('\n✅ ALL CHECKS PASSED - Ready for testing');
    } else {
      console.log('\n⚠️  ISSUES FOUND - Review above');
    }

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
