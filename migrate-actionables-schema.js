const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Schema Migration: Patch Legacy Actionables
 *
 * Ensures every ActionableItem in the database has all fields expected by
 * the latest schema, including:
 *   - rejection_reason (added in Phase 1)
 *   - per-team workflow fields: deadline, implementation_notes, evidence_quote,
 *     rejection_reason, is_delayed, delay_detected_at, justification*,
 *     justification_status (added in Phase 1)
 *   - audit_trail array (ensure exists)
 *   - assigned_teams array (ensure exists)
 *   - team_workflows object (ensure exists)
 *
 * This script is idempotent — safe to run multiple times.
 *
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node migrate-actionables-schema.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

// All fields expected on a per-team workflow entry
const TEAM_WORKFLOW_DEFAULTS = {
    task_status:                "assigned",
    submitted_at:               "",
    team_reviewer_name:         "",
    team_reviewer_approved_at:  "",
    team_reviewer_rejected_at:  "",
    reviewer_comments:          "",
    rejection_reason:           "",
    is_delayed:                 false,
    delay_detected_at:          "",
    justification:              "",
    justification_by:           "",
    justification_at:           "",
    justification_status:       "",
    evidence_files:             [],
    comments:                   [],
    completion_date:            "",
    deadline:                   "",
    implementation_notes:       "",
    evidence_quote:             "",
};

// Top-level fields that must exist on every actionable
const TOP_LEVEL_DEFAULTS = {
    rejection_reason:           "",
    is_delayed:                 false,
    delay_detected_at:          "",
    justification:              "",
    justification_by:           "",
    justification_at:           "",
    justification_status:       "",
    audit_trail:                [],
    assigned_teams:             [],
    team_workflows:             {},
    evidence_files:             [],
    comments:                   [],
    submitted_at:               "",
    team_reviewer_name:         "",
    team_reviewer_approved_at:  "",
    team_reviewer_rejected_at:  "",
    completion_date:            "",
    reviewer_comments:          "",
    // New structured risk scoring fields
    likelihood_business_volume:     {},
    likelihood_products_processes:  {},
    likelihood_compliance_violations: {},
    likelihood_score:               0,
    impact_dropdown:                {},
    impact_score:                   0,
    control_monitoring:             {},
    control_effectiveness:          {},
    control_score:                  0,
    inherent_risk_score:            0,
    inherent_risk_label:            "",
    residual_risk_score:            0,
    residual_risk_label:            "",
    residual_risk_interpretation:   "",
    // Spec-compliant overall score aliases
    overall_likelihood_score:       0,
    overall_impact_score:           0,
    overall_control_score:          0,
    theme:                          "",
    // 4-stage delay justification workflow
    justification_member_text:      "",
    justification_member_at:        "",
    justification_reviewer_text:    "",
    justification_reviewer_at:      "",
    justification_lead_comment:     "",
    justification_lead_approved_at: "",
    justification_compliance_comment:      "",
    justification_compliance_approved_at:  "",
};

function patchTeamWorkflows(teamWorkflows) {
    if (!teamWorkflows || typeof teamWorkflows !== 'object') return {};
    const patched = {};
    let patchCount = 0;
    for (const [team, wf] of Object.entries(teamWorkflows)) {
        const entry = { ...wf };
        for (const [key, defaultVal] of Object.entries(TEAM_WORKFLOW_DEFAULTS)) {
            if (!(key in entry)) {
                entry[key] = defaultVal;
                patchCount++;
            }
        }
        patched[team] = entry;
    }
    return { patched, patchCount };
}

async function migrate() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        const allDocs = await col.find({}).toArray();
        console.log(`\nFound ${allDocs.length} ActionablesResult documents.\n`);

        let totalItems = 0;
        let totalPatched = 0;
        let totalFieldsAdded = 0;
        let totalTwPatched = 0;

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            totalItems += items.length;
            let docChanged = false;

            const updatedItems = items.map(item => {
                let itemChanged = false;
                let fieldsAdded = 0;
                const patched = { ...item };

                // 1. Ensure all top-level fields exist
                for (const [key, defaultVal] of Object.entries(TOP_LEVEL_DEFAULTS)) {
                    if (!(key in patched)) {
                        if (Array.isArray(defaultVal)) {
                            patched[key] = [];
                        } else if (typeof defaultVal === 'boolean') {
                            patched[key] = defaultVal;
                        } else if (typeof defaultVal === 'object' && defaultVal !== null) {
                            patched[key] = {};
                        } else {
                            patched[key] = defaultVal;
                        }
                        itemChanged = true;
                        fieldsAdded++;
                    }
                }

                // 2. Ensure team_workflows entries have all required keys
                if (patched.team_workflows && typeof patched.team_workflows === 'object' && Object.keys(patched.team_workflows).length > 0) {
                    const { patched: patchedTw, patchCount } = patchTeamWorkflows(patched.team_workflows);
                    if (patchCount > 0) {
                        patched.team_workflows = patchedTw;
                        itemChanged = true;
                        totalTwPatched += patchCount;
                    }
                }

                // 3. Ensure assigned_teams is consistent with team_workflows
                if (patched.team_workflows && Object.keys(patched.team_workflows).length > 0) {
                    const twTeams = Object.keys(patched.team_workflows);
                    const assignedTeams = patched.assigned_teams || [];
                    const missingFromAssigned = twTeams.filter(t => !assignedTeams.includes(t));
                    if (missingFromAssigned.length > 0) {
                        patched.assigned_teams = [...new Set([...assignedTeams, ...twTeams])];
                        itemChanged = true;
                        fieldsAdded++;
                    }
                }

                // 4. Normalize workstream — ensure it's a string, not an object
                if (patched.workstream && typeof patched.workstream === 'object' && patched.workstream.value) {
                    patched.workstream = patched.workstream.value;
                    itemChanged = true;
                    fieldsAdded++;
                }

                // 5. Copy legacy impact_sub1 → impact_dropdown if impact_dropdown is empty
                if ((!patched.impact_dropdown || !patched.impact_dropdown.label) && patched.impact_sub1 && patched.impact_sub1.label) {
                    patched.impact_dropdown = { ...patched.impact_sub1 };
                    itemChanged = true;
                    fieldsAdded++;
                }

                if (itemChanged) {
                    totalPatched++;
                    totalFieldsAdded += fieldsAdded;
                    docChanged = true;
                }

                return patched;
            });

            if (docChanged) {
                await col.updateOne(
                    { _id: doc._id },
                    { $set: { actionables: updatedItems } }
                );
                console.log(`  ✓ doc_id=${doc.doc_id || doc._id}  items patched: ${items.length}`);
            } else {
                console.log(`  – doc_id=${doc.doc_id || doc._id}  already up to date`);
            }
        }

        console.log(`\n✅ Migration complete.`);
        console.log(`   Documents processed     : ${allDocs.length}`);
        console.log(`   Total items scanned     : ${totalItems}`);
        console.log(`   Items patched           : ${totalPatched}`);
        console.log(`   Top-level fields added  : ${totalFieldsAdded}`);
        console.log(`   Team workflow fields added: ${totalTwPatched}`);

        // Verify: check for any items still missing rejection_reason
        const verifyDocs = await col.find({}).toArray();
        let missingRejectionReason = 0;
        let missingAuditTrail = 0;
        for (const doc of verifyDocs) {
            for (const item of (doc.actionables || [])) {
                if (!('rejection_reason' in item)) missingRejectionReason++;
                if (!('audit_trail' in item)) missingAuditTrail++;
            }
        }
        console.log(`\nVerification:`);
        console.log(`   Items missing rejection_reason: ${missingRejectionReason}`);
        console.log(`   Items missing audit_trail     : ${missingAuditTrail}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

migrate().catch(err => { console.error(err); process.exit(1); });
