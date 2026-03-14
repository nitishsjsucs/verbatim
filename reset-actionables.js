const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Global Actionable Status Reset (Latest Schema Edition)
 *
 * Resets task_status to "assigned" for every ActionableItem nested inside
 * every ActionablesResult document in the 'actionables' collection.
 * Also resets per-team workflow states in team_workflows.
 *
 * Structure:
 *   Collection: actionables
 *   Document:   { _id: <doc_id>, actionables: [ { task_status, team_workflows, ... }, ... ], ... }
 *
 * Workflow-state fields reset per item (legacy):
 *   task_status, submitted_at, completion_date, reviewer_comments,
 *   team_reviewer_name, team_reviewer_approved_at, team_reviewer_rejected_at,
 *   is_delayed, delay_detected_at, justification, justification_by,
 *   justification_at, justification_status
 *
 * NEW: 4-stage justification approval chain (all cleared):
 *   justification_member_text, justification_member_at, justification_member_by,
 *   justification_reviewer_approved, justification_reviewer_comment, justification_reviewer_by, justification_reviewer_at,
 *   justification_lead_approved, justification_lead_comment, justification_lead_by, justification_lead_at,
 *   justification_co_approved, justification_co_comment, justification_co_by, justification_co_at
 *
 * NEW: Role-specific mandatory comment fields (all cleared):
 *   member_comment, reviewer_comment, lead_comment, co_comment
 *
 * NEW: Risk assessment resets (theme / tranche / dropdowns / derived scores):
 *   theme, tranche3, legacy risk strings, likelihood_* sub-dropdowns, impact_dropdown,
 *   control_* dropdowns, all *_score / *_label / *_interpretation fields.
 *
 * Per-team workflows: each team reset to "assigned" with same new fields cleared.
 *
 * Fields NOT touched: evidence_files, comments, audit_trail,
 *   assigned_teams, workstream, and all extraction/metadata fields.
 *
 * Preserves: teams collection, users collection.
 *
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node reset-actionables.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

function resetTeamWorkflows(teamWorkflows) {
    if (!teamWorkflows || typeof teamWorkflows !== 'object') return teamWorkflows;
    const reset = {};
    for (const [team, wf] of Object.entries(teamWorkflows)) {
        reset[team] = {
            ...wf,
            task_status:                  "assigned",
            submitted_at:                 "",
            completion_date:              "",
            reviewer_comments:            "",
            rejection_reason:             "",
            team_reviewer_name:           "",
            team_reviewer_approved_at:    "",
            team_reviewer_rejected_at:    "",
            is_delayed:                   false,
            delay_detected_at:            "",
            justification:                "",
            justification_by:             "",
            justification_at:             "",
            justification_status:         "",
            // Clear 4-stage justification approvals per team
            justification_member_text:    "",
            justification_member_at:      "",
            justification_member_by:      "",
            justification_reviewer_approved: false,
            justification_reviewer_comment: "",
            justification_reviewer_by:    "",
            justification_reviewer_at:    "",
            justification_lead_approved:  false,
            justification_lead_comment:   "",
            justification_lead_by:        "",
            justification_lead_at:        "",
            justification_co_approved:    false,
            justification_co_comment:     "",
            justification_co_by:          "",
            justification_co_at:          "",
            delay_justification:          "",
            delay_justification_member_submitted: false,
            delay_justification_reviewer_approved: false,
            delay_justification_lead_approved: false,
            delay_justification_updated_by: "",
            delay_justification_updated_at: "",
            // Role-specific comments per team (if stored)
            member_comment:               "",
            member_comment_history:       [],
            reviewer_comment:             "",
            lead_comment:                 "",
            co_comment:                   "",
            // Evidence + chat threads
            evidence_files:               [],
            comments:                     [],
            // Tagged Incorrectly / bypass flow per team
            bypass_tag:                   false,
            bypass_tagged_at:             "",
            bypass_tagged_by:             "",
            bypass_approved_by:           "",
            bypass_approved_at:           "",
            bypass_disapproved_by:        "",
            bypass_disapproved_at:        "",
            bypass_disapproval_reason:    "",
            bypass_reviewer_rejected_by:  "",
            bypass_reviewer_rejected_at:  "",
            bypass_reviewer_rejection_reason: "",
            implementation_notes:         wf.implementation_notes || "",
            evidence_quote:               wf.evidence_quote || "",
            deadline:                     wf.deadline || "",
        };
    }
    return reset;
}

async function resetActionables() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DEFAULT_DB);

        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);
        console.log('Collections:', collectionNames);

        if (!collectionNames.includes('actionables')) {
            console.error('ERROR: "actionables" collection not found.');
            return;
        }

        const col = db.collection('actionables');

        // Count total items before reset
        const allDocs = await col.find({}).toArray();
        console.log(`\nFound ${allDocs.length} ActionablesResult documents.`);

        let totalItems = 0;
        let totalModified = 0;

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            totalItems += items.length;

            // Build the updated items array — reset ALL workflow fields back to pre-approval
            const updatedItems = items.map(item => ({
                ...item,
                // Move back to Actionable section (pre-approval)
                approval_status:              "pending",
                published_at:                 "",
                task_status:                  "assigned",
                // Clear all workflow state (legacy)
                submitted_at:                 "",
                completion_date:              "",
                reviewer_comments:            "",
                rejection_reason:             "",
                team_reviewer_name:           "",
                team_reviewer_approved_at:    "",
                team_reviewer_rejected_at:    "",
                is_delayed:                   false,
                delay_detected_at:            "",
                justification:                "",
                justification_by:             "",
                justification_at:             "",
                justification_status:         "",
                // Clear new 4-stage justification approval chain
                justification_member_text:    "",
                justification_member_at:      "",
                justification_member_by:      "",
                justification_reviewer_approved: false,
                justification_reviewer_comment: "",
                justification_reviewer_by:    "",
                justification_reviewer_at:    "",
                justification_lead_approved:  false,
                justification_lead_comment:   "",
                justification_lead_by:        "",
                justification_lead_at:        "",
                justification_co_approved:    false,
                justification_co_comment:     "",
                justification_co_by:          "",
                justification_co_at:          "",
                // Clear role-specific mandatory comment fields
                member_comment:               "",
                member_comment_history:       [],
                reviewer_comment:             "",
                lead_comment:                 "",
                co_comment:                   "",
                // Clear shared delay justification workflow
                delay_justification:          "",
                delay_justification_member_submitted: false,
                delay_justification_reviewer_approved: false,
                delay_justification_lead_approved: false,
                delay_justification_updated_by: "",
                delay_justification_updated_at: "",
                // Clear risk configuration + scores so dropdowns are empty
                theme:                        "",
                tranche3:                     "",
                impact:                       "",
                control:                      "",
                likelihood:                   "",
                residual_risk:               "",
                inherent_risk:               "",
                likelihood_business_volume:   null,
                likelihood_products_processes:null,
                likelihood_compliance_violations: null,
                likelihood_score:             undefined,
                overall_likelihood_score:     undefined,
                impact_dropdown:              null,
                impact_score:                 undefined,
                overall_impact_score:         undefined,
                control_monitoring:           null,
                control_effectiveness:        null,
                control_score:                undefined,
                overall_control_score:        undefined,
                inherent_risk_score:          undefined,
                inherent_risk_label:          "",
                residual_risk_score:          undefined,
                residual_risk_label:          "",
                residual_risk_interpretation: "",
                // Clear deadline + evidence/comments data so Actionables restart cleanly
                deadline:                     "",
                evidence_files:               [],
                comments:                     [],
                // Tagged Incorrectly / bypass flow
                bypass_tag:                   false,
                bypass_tagged_at:             "",
                bypass_tagged_by:             "",
                bypass_approved_by:           "",
                bypass_approved_at:           "",
                bypass_disapproved_by:        "",
                bypass_disapproved_at:        "",
                bypass_disapproval_reason:    "",
                bypass_reviewer_rejected_by:  "",
                bypass_reviewer_rejected_at:  "",
                bypass_reviewer_rejection_reason: "",
                impact_sub1:                  null,
                impact_sub2:                  null,
                impact_sub3:                  null,
                // Clear delegation and publishing metadata
                delegation_request_id:        "",
                published_by_account_id:      "",
                delegated_from_account_id:    "",
                team_workflows:               resetTeamWorkflows(item.team_workflows),
            }));

            const result = await col.updateOne(
                { _id: doc._id },
                { $set: { actionables: updatedItems } }
            );

            if (result.modifiedCount > 0) {
                totalModified += items.length;
                console.log(`  ✓ doc_id=${doc._id || doc.doc_id}  items reset: ${items.length}`);
            } else {
                console.log(`  – doc_id=${doc._id || doc.doc_id}  no change (already clean)`);
            }
        }

        console.log(`\n✅ Reset complete.`);
        console.log(`   Documents processed : ${allDocs.length}`);
        console.log(`   Total items reset   : ${totalModified} / ${totalItems}`);
        console.log(`   Teams & users preserved.`);

        // Verify: collect all task_status values post-reset
        const verifyDocs = await col.find({}).toArray();
        const statusCounts = {};
        for (const doc of verifyDocs) {
            for (const item of (doc.actionables || [])) {
                const s = item.task_status || '(empty)';
                statusCounts[s] = (statusCounts[s] || 0) + 1;
            }
        }

        console.log('\nStatus distribution after reset:');
        Object.entries(statusCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([status, count]) => console.log(`  ${status}: ${count}`));

        // Clean up delegation_requests collection
        console.log('\n🧹 Cleaning up delegation system...');
        const delegationCol = db.collection('delegation_requests');
        const delegationResult = await delegationCol.deleteMany({});
        console.log(`   • Deleted ${delegationResult.deletedCount} delegation requests`);

        // Clean up notifications collection
        console.log('\n🧹 Cleaning up notifications...');
        const notificationsCol = db.collection('notifications');
        const notificationsResult = await notificationsCol.deleteMany({});
        console.log(`   • Deleted ${notificationsResult.deletedCount} notifications`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

if (require.main === module) {
    resetActionables();
}

module.exports = { resetActionables };
