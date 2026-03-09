const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Seed 100 Test Actionables
 * 
 * Creates 100 actionables named "Actionable 1" through "Actionable 100"
 * distributed across all available L2 teams.
 * 
 * CONSTRAINT: Only L2 teams are assigned. L0 and L1 teams are excluded.
 * 
 * Structure:
 *   - Single document in 'actionables' collection with doc_id = "DOC-TEST-001"
 *   - 100 actionable items inside
 *   - Each assigned to one L2 team (round-robin distribution)
 *   - Minimal placeholder data to match schema
 * 
 * Usage:
 *   node seed-test-actionables.js
 */

const MONGO_URI = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const BACKEND_DB = "govinda_v2";
const AUTH_DB = "govinda_auth";

async function run() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB\n');

    const backendDb = client.db(BACKEND_DB);
    const authDb = client.db(AUTH_DB);

    // ========================================
    // STEP 1: Fetch all L2 teams from database
    // ========================================
    console.log('STEP 1: Fetching L2 teams...');
    const teamsCol = backendDb.collection('teams');
    const l2Teams = await teamsCol.find({ depth: 2 }).sort({ order: 1 }).toArray();
    
    console.log(`Found ${l2Teams.length} L2 teams:`);
    for (const t of l2Teams) {
      console.log(`  - ${t.name}`);
    }

    if (l2Teams.length === 0) {
      console.error('ERROR: No L2 teams found. Run reset-via-api.js first.');
      return;
    }

    // ========================================
    // STEP 2: Create 100 test actionables
    // ========================================
    console.log(`\nSTEP 2: Creating 100 test actionables...`);
    const actionables = [];
    const now = new Date().toISOString();

    const regulationIssueDate = "2026-02-01";
    const circularEffectiveDate = "2026-04-01";
    const regulatorName = "RBI";

    for (let i = 1; i <= 100; i++) {
      // Round-robin assign to L2 teams
      const l2Team = l2Teams[(i - 1) % l2Teams.length];

      const actionable = {
        id: `TEST-${String(i).padStart(3, '0')}`,
        actionable_id: `ACT-TEST-${String(i).padStart(4, '0')}`,
        modality: "Mandatory",
        action: `Actionable ${i}`,
        implementation_notes: `Test actionable ${i} for system testing`,
        evidence_quote: `Evidence for actionable ${i}`,
        source_location: "Test Document",
        source_node_id: `test-node-${i}`,
        workstream: l2Team.name,
        regulation_issue_date: regulationIssueDate,
        circular_effective_date: circularEffectiveDate,
        regulator: regulatorName,
        approval_status: "pending",
        is_manual: true,
        created_at: now,
        
        // Task lifecycle (all empty/default for pending actionables)
        task_status: "",
        submitted_at: "",
        completion_date: "",
        reviewer_comments: "",
        rejection_reason: "",
        team_reviewer_name: "",
        team_reviewer_approved_at: "",
        team_reviewer_rejected_at: "",
        
        // Delay fields
        is_delayed: false,
        delay_detected_at: "",
        justification: "",
        justification_by: "",
        justification_at: "",
        justification_status: "",
        
        // Multi-team assignment (only L2 team)
        assigned_teams: [l2Team.name],
        team_workflows: {
          [l2Team.name]: {
            task_status: "assigned",
            submitted_at: "",
            completion_date: "",
            reviewer_comments: "",
            rejection_reason: "",
            team_reviewer_name: "",
            team_reviewer_approved_at: "",
            team_reviewer_rejected_at: "",
            is_delayed: false,
            delay_detected_at: "",
            justification: "",
            justification_by: "",
            justification_at: "",
            justification_status: "",
            implementation_notes: `Test actionable ${i} for system testing`,
            evidence_quote: `Evidence for actionable ${i}`,
            deadline: "",
          }
        },
        
        // Risk assessment (placeholder)
        impact: "Medium",
        likelihood: "Medium",
        control: "Medium",
        residual_risk: "Medium",
        inherent_risk: "Medium",
        
        // Evidence & comments
        evidence_files: [],
        comments: [],
        
        // Audit trail
        audit_trail: [
          {
            event: "created",
            actor: "system",
            role: "admin",
            timestamp: now,
            details: "Test actionable created for system testing"
          }
        ],
      };

      actionables.push(actionable);
    }

    // ========================================
    // STEP 3: Insert into actionables collection
    // ========================================
    console.log(`\nSTEP 3: Inserting into actionables collection...`);
    const actionablesCol = backendDb.collection('actionables');

    // Check if test doc already exists
    const existing = await actionablesCol.findOne({ _id: "DOC-TEST-001" });
    if (existing) {
      console.log('  Replacing existing DOC-TEST-001...');
      await actionablesCol.deleteOne({ _id: "DOC-TEST-001" });
    }

    const testDoc = {
      _id: "DOC-TEST-001",
      doc_id: "DOC-TEST-001",
      doc_name: "Test Document for System Testing",
      regulation_issue_date: regulationIssueDate,
      circular_effective_date: circularEffectiveDate,
      regulator: regulatorName,
      actionables: actionables,
      total_extracted: 100,
      total_validated: 0,
      total_flagged: 0,
      nodes_processed: 1,
      nodes_with_actionables: 1,
      extraction_time_seconds: 0,
      llm_calls: 0,
      total_tokens: 0,
      extracted_at: now,
      by_modality: { "Mandatory": 100 },
      by_workstream: {},
    };

    // Compute by_workstream
    for (const a of actionables) {
      const ws = a.workstream;
      testDoc.by_workstream[ws] = (testDoc.by_workstream[ws] || 0) + 1;
    }

    await actionablesCol.insertOne(testDoc);
    console.log('  ✓ Inserted DOC-TEST-001 with 100 actionables');

    // ========================================
    // STEP 4: Verify distribution
    // ========================================
    console.log(`\nSTEP 4: Verifying distribution across L2 teams...`);
    const distribution = {};
    for (const a of actionables) {
      const team = a.workstream;
      distribution[team] = (distribution[team] || 0) + 1;
    }

    console.log('\nDistribution by L2 team:');
    let totalAssigned = 0;
    for (const [team, count] of Object.entries(distribution).sort()) {
      console.log(`  ${team.padEnd(40)} : ${count} actionables`);
      totalAssigned += count;
    }

    // ========================================
    // STEP 5: Verify no L0/L1 teams assigned
    // ========================================
    console.log(`\nSTEP 5: Verifying L0/L1 constraint...`);
    const l0Teams = await teamsCol.find({ depth: 0 }).toArray();
    const l1Teams = await teamsCol.find({ depth: 1 }).toArray();
    const l0Names = new Set(l0Teams.map(t => t.name));
    const l1Names = new Set(l1Teams.map(t => t.name));

    let violationCount = 0;
    for (const a of actionables) {
      if (l0Names.has(a.workstream) || l1Names.has(a.workstream)) {
        console.log(`  ✗ VIOLATION: ${a.actionable_id} assigned to ${a.workstream} (not L2)`);
        violationCount++;
      }
    }

    if (violationCount === 0) {
      console.log('  ✓ All 100 actionables correctly assigned to L2 teams only');
    } else {
      console.log(`  ✗ Found ${violationCount} violations`);
    }

    // ========================================
    // SUMMARY
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('TEST ACTIONABLES SEEDING COMPLETE');
    console.log('='.repeat(60));
    console.log(`\n✓ Created: 100 actionables`);
    console.log(`✓ Document: DOC-TEST-001`);
    console.log(`✓ Distribution: ${Object.keys(distribution).length} L2 teams`);
    console.log(`✓ L0/L1 constraint: PASSED (0 violations)`);
    console.log(`✓ Total assigned: ${totalAssigned} / 100`);
    console.log(`\nActionables are ready for testing.`);
    console.log(`To delete all test actionables, run: node reset-test-actionables.js`);

  } catch (error) {
    console.error('ERROR:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nConnection closed');
  }
}

run();
