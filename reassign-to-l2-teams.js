const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Reassign Actionables to L2 Teams
 * 
 * Reassigns all existing actionables exclusively to L2 teams (depth = 2).
 * For each actionable currently assigned to an L0 team:
 * - Finds all L2 descendants of that L0 team
 * - Randomly assigns the actionable to one of the L2 teams
 * - Updates workstream and assigned_teams fields
 * - Initializes team_workflows for the new L2 team
 * 
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node reassign-to-l2-teams.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

// Default team workflow state
const TEAM_WORKFLOW_FIELDS = [
    "task_status", "submitted_at", "completion_date", "reviewer_comments",
    "rejection_reason", "team_reviewer_name", "team_reviewer_approved_at",
    "team_reviewer_rejected_at", "is_delayed", "delay_detected_at",
    "justification", "justification_by", "justification_at",
    "justification_status", "implementation_notes", "evidence_quote",
    "deadline", "deadline_or_frequency"
];

function initTeamWorkflow() {
    return {
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
        implementation_notes: "",
        evidence_quote: "",
        deadline: "",
        deadline_or_frequency: "",
    };
}

async function reassignToL2Teams() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DEFAULT_DB);
        const teamsCol = db.collection('teams');
        const actionablesCol = db.collection('actionables');

        // Get all L2 teams (depth = 2)
        const l2Teams = await teamsCol.find({ depth: 2 }).toArray();
        console.log(`\nFound ${l2Teams.length} L2 teams`);

        if (l2Teams.length === 0) {
            console.error('ERROR: No L2 teams found. Run create-team-hierarchy.js first.');
            return;
        }

        // Build a map: L0 team name -> array of L2 descendant names
        const l0ToL2Map = {};
        for (const l2Team of l2Teams) {
            const rootTeam = l2Team.path && l2Team.path.length > 0 ? l2Team.path[0] : null;
            if (rootTeam) {
                if (!l0ToL2Map[rootTeam]) {
                    l0ToL2Map[rootTeam] = [];
                }
                l0ToL2Map[rootTeam].push(l2Team.name);
            }
        }

        console.log('\nL0 -> L2 mapping:');
        for (const [l0, l2s] of Object.entries(l0ToL2Map)) {
            console.log(`  ${l0} -> ${l2s.length} L2 teams`);
        }

        // Get all actionable documents
        const allDocs = await actionablesCol.find({}).toArray();
        console.log(`\nFound ${allDocs.length} actionable documents`);

        let totalItems = 0;
        let reassignedItems = 0;
        let skippedItems = 0;

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            totalItems += items.length;

            const updatedItems = items.map(item => {
                const currentTeam = item.workstream;
                
                // Check if current team has L2 descendants
                const l2Options = l0ToL2Map[currentTeam];
                
                if (!l2Options || l2Options.length === 0) {
                    // No L2 teams for this L0 team, skip
                    skippedItems++;
                    console.log(`  ⚠️  No L2 teams for: ${currentTeam} (item: ${item.title?.substring(0, 50) || 'untitled'})`);
                    return item;
                }

                // Randomly select one L2 team
                const selectedL2 = l2Options[Math.floor(Math.random() * l2Options.length)];
                
                // Update workstream and assigned_teams
                const updatedItem = {
                    ...item,
                    workstream: selectedL2,
                    assigned_teams: [selectedL2],
                    team_workflows: {
                        [selectedL2]: initTeamWorkflow()
                    }
                };

                reassignedItems++;
                return updatedItem;
            });

            // Update the document
            await actionablesCol.updateOne(
                { _id: doc._id },
                { $set: { actionables: updatedItems } }
            );

            console.log(`  ✓ Processed doc_id=${doc._id || doc.doc_id}: ${items.length} items`);
        }

        console.log(`\n✅ Reassignment complete!`);
        console.log(`   Total items: ${totalItems}`);
        console.log(`   Reassigned to L2: ${reassignedItems}`);
        console.log(`   Skipped (no L2 available): ${skippedItems}`);

        // Verify: count items per L2 team
        const verifyDocs = await actionablesCol.find({}).toArray();
        const l2Counts = {};
        for (const doc of verifyDocs) {
            for (const item of (doc.actionables || [])) {
                const team = item.workstream;
                if (l2Teams.some(t => t.name === team)) {
                    l2Counts[team] = (l2Counts[team] || 0) + 1;
                }
            }
        }

        console.log('\nItems per L2 team:');
        Object.entries(l2Counts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([team, count]) => console.log(`  ${team}: ${count}`));

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

reassignToL2Teams();
