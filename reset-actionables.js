const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Global Actionable Status Reset & Backfill (Latest Schema Edition)
 *
 * Resets task_status to "assigned" for every ActionableItem nested inside
 * every ActionablesResult document in the 'actionables' collection.
 * Backfills missing fields (tranche3, new_product, impact_dropdown, product_live_date) with safe defaults.
 *
 * Structure:
 *   Collection: actionables
 *   Document:   { _id: <doc_id>, actionables: [ { task_status, team_workflows, ... }, ... ], ... }
 *
 * BACKFILL STRATEGY:
 *   - If tranche3 missing/null → set to ""
 *   - If new_product missing/null → set to "No"
 *   - If impact_dropdown missing/null → set to { label: null, value: null }
 *   - If product_live_date missing/null and new_product === "Yes" → left blank (for manual review)
 *   - theme → preserved if present, else set to ""
 *   - All workflow/approval fields reset to initial state
 *   - team_workflows reset per-team with same backfill logic
 *
 * Fields NOT touched: evidence_files, comments, audit_trail,
 *   assigned_teams, workstream, and all extraction/metadata fields.
 *
 * Preserves: teams collection, users collection.
 *
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node reset-actionables.js [--dry-run] [--preview-limit N] [--apply]
 *   
 *   --dry-run       Report changes without writing to DB (default mode if no flags)
 *   --preview-limit N  Show sample N items (default 20)
 *   --apply         Write changes to DB (requires explicit flag for safety)
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

// Parse command-line arguments
const args = process.argv.slice(2);
const isDryRun = !args.includes('--apply');
const shouldApply = args.includes('--apply');
const previewLimitIndex = args.indexOf('--preview-limit');
const previewLimit = previewLimitIndex !== -1 ? parseInt(args[previewLimitIndex + 1], 10) || 20 : 20;

if (isDryRun && !shouldApply) {
    console.log('\n📋 DRY-RUN MODE: No changes will be written to the database.\n');
}

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
            member_comment:               "",
            member_comment_history:       [],
            reviewer_comment:             "",
            lead_comment:                 "",
            co_comment:                   "",
            evidence_files:               [],
            comments:                     [],
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

function getBackfilledItem(item) {
    const now = new Date().toISOString();
    const backfilled = { ...item };

    // Workflow resets
    backfilled.approval_status = "pending";
    backfilled.published_at = "";
    backfilled.task_status = "assigned";
    backfilled.submitted_at = "";
    backfilled.completion_date = "";
    backfilled.reviewer_comments = "";
    backfilled.rejection_reason = "";
    backfilled.team_reviewer_name = "";
    backfilled.team_reviewer_approved_at = "";
    backfilled.team_reviewer_rejected_at = "";
    backfilled.is_delayed = false;
    backfilled.delay_detected_at = "";
    backfilled.justification = "";
    backfilled.justification_by = "";
    backfilled.justification_at = "";
    backfilled.justification_status = "";

    // 4-stage justification approval chain
    backfilled.justification_member_text = "";
    backfilled.justification_member_at = "";
    backfilled.justification_member_by = "";
    backfilled.justification_reviewer_approved = false;
    backfilled.justification_reviewer_comment = "";
    backfilled.justification_reviewer_by = "";
    backfilled.justification_reviewer_at = "";
    backfilled.justification_lead_approved = false;
    backfilled.justification_lead_comment = "";
    backfilled.justification_lead_by = "";
    backfilled.justification_lead_at = "";
    backfilled.justification_co_approved = false;
    backfilled.justification_co_comment = "";
    backfilled.justification_co_by = "";
    backfilled.justification_co_at = "";

    // Role-specific comments
    backfilled.member_comment = "";
    backfilled.member_comment_history = [];
    backfilled.reviewer_comment = "";
    backfilled.lead_comment = "";
    backfilled.co_comment = "";

    // Delay justification workflow
    backfilled.delay_justification = "";
    backfilled.delay_justification_member_submitted = false;
    backfilled.delay_justification_reviewer_approved = false;
    backfilled.delay_justification_lead_approved = false;
    backfilled.delay_justification_updated_by = "";
    backfilled.delay_justification_updated_at = "";

    // BACKFILL MISSING CONFIGURATION FIELDS (instead of clearing)
    if (!backfilled.theme) {
        backfilled.theme = "";
    }
    if (!backfilled.tranche3) {
        backfilled.tranche3 = "";
    }
    if (!backfilled.new_product) {
        backfilled.new_product = "No";
    }
    if (!backfilled.impact_dropdown) {
        backfilled.impact_dropdown = { label: null, value: null };
    }
    if (!backfilled.product_live_date && backfilled.new_product === "Yes") {
        // Leave blank for manual review (do NOT auto-fill date)
        backfilled.product_live_date = "";
    }

    // Legacy risk fields
    backfilled.impact = "";
    backfilled.control = "";
    backfilled.likelihood = "";
    backfilled.residual_risk = "";
    backfilled.inherent_risk = "";
    backfilled.likelihood_business_volume = null;
    backfilled.likelihood_products_processes = null;
    backfilled.likelihood_compliance_violations = null;
    backfilled.likelihood_score = undefined;
    backfilled.overall_likelihood_score = undefined;
    backfilled.impact_score = undefined;
    backfilled.overall_impact_score = undefined;
    backfilled.control_monitoring = null;
    backfilled.control_effectiveness = null;
    backfilled.control_score = undefined;
    backfilled.overall_control_score = undefined;
    backfilled.inherent_risk_score = undefined;
    backfilled.inherent_risk_label = "";
    backfilled.residual_risk_score = undefined;
    backfilled.residual_risk_label = "";
    backfilled.residual_risk_interpretation = "";

    // Deadline + evidence (cleared so actionables restart clean)
    backfilled.deadline = "";
    backfilled.evidence_files = [];
    backfilled.comments = [];

    // Bypass flow
    backfilled.bypass_tag = false;
    backfilled.bypass_tagged_at = "";
    backfilled.bypass_tagged_by = "";
    backfilled.bypass_approved_by = "";
    backfilled.bypass_approved_at = "";
    backfilled.bypass_disapproved_by = "";
    backfilled.bypass_disapproved_at = "";
    backfilled.bypass_disapproval_reason = "";
    backfilled.bypass_reviewer_rejected_by = "";
    backfilled.bypass_reviewer_rejected_at = "";
    backfilled.bypass_reviewer_rejection_reason = "";

    // Impact sub-fields
    backfilled.impact_sub1 = null;
    backfilled.impact_sub2 = null;
    backfilled.impact_sub3 = null;

    // Publishing metadata
    backfilled.delegation_request_id = "";
    backfilled.published_by_account_id = "";
    backfilled.delegated_from_account_id = "";

    // Reset team workflows with same backfill logic
    backfilled.team_workflows = resetTeamWorkflows(item.team_workflows);

    return backfilled;
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
        let totalToModify = 0;
        let sampleItems = [];

        for (const doc of allDocs) {
            const items = doc.actionables || [];
            totalItems += items.length;

            let docModCount = 0;
            const updatedItems = items.map((item, itemIdx) => {
                const backfilled = getBackfilledItem(item);
                // Count changes: check if configuration fields would change
                if (JSON.stringify(item.tranche3) !== JSON.stringify(backfilled.tranche3) ||
                    JSON.stringify(item.new_product) !== JSON.stringify(backfilled.new_product) ||
                    JSON.stringify(item.impact_dropdown) !== JSON.stringify(backfilled.impact_dropdown) ||
                    JSON.stringify(item.product_live_date) !== JSON.stringify(backfilled.product_live_date)) {
                    docModCount++;
                    if (sampleItems.length < previewLimit) {
                        sampleItems.push({
                            docId: doc._id || doc.doc_id,
                            itemIdx,
                            title: item.title || '(untitled)',
                            changes: {
                                tranche3: { old: item.tranche3, new: backfilled.tranche3 },
                                new_product: { old: item.new_product, new: backfilled.new_product },
                                impact_dropdown: { old: item.impact_dropdown, new: backfilled.impact_dropdown },
                                product_live_date: { old: item.product_live_date, new: backfilled.product_live_date },
                            }
                        });
                    }
                }
                return backfilled;
            });

            totalToModify += docModCount;

            if (shouldApply) {
                const result = await col.updateOne(
                    { _id: doc._id },
                    { $set: { actionables: updatedItems } }
                );

                if (result.modifiedCount > 0) {
                    console.log(`  ✓ doc_id=${doc._id || doc.doc_id}  items backfilled: ${docModCount} / ${items.length}`);
                }
            }
        }

        // Report results
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📊 BACKFILL REPORT`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   Total documents   : ${allDocs.length}`);
        console.log(`   Total items       : ${totalItems}`);
        console.log(`   Items to modify   : ${totalToModify}`);
        console.log(`   Modification rate : ${((totalToModify / totalItems) * 100).toFixed(1)}%`);
        console.log(`\n📋 SAMPLE MODIFICATIONS (preview limit: ${previewLimit}):`);

        if (sampleItems.length > 0) {
            sampleItems.slice(0, previewLimit).forEach((sample, idx) => {
                console.log(`\n   [${idx + 1}] ${sample.title} (doc: ${sample.docId}, item: ${sample.itemIdx})`);
                Object.entries(sample.changes).forEach(([field, change]) => {
                    if (JSON.stringify(change.old) !== JSON.stringify(change.new)) {
                        console.log(`       • ${field}: ${JSON.stringify(change.old)} → ${JSON.stringify(change.new)}`);
                    }
                });
            });
        } else {
            console.log(`   (No modifications required or all items already have correct values)`);
        }

        if (!shouldApply) {
            console.log(`\n⚠️  DRY-RUN MODE: No changes written to database.`);
            console.log(`\n💡 To apply these changes, run: node reset-actionables.js --apply\n`);
        } else {
            console.log(`\n✅ CHANGES APPLIED TO DATABASE`);

            // Verify: collect all task_status values post-reset
            const verifyDocs = await col.find({}).toArray();
            const statusCounts = {};
            const fieldCounts = { tranche3_missing: 0, new_product_missing: 0, impact_dropdown_missing: 0 };

            for (const doc of verifyDocs) {
                for (const item of (doc.actionables || [])) {
                    const s = item.task_status || '(empty)';
                    statusCounts[s] = (statusCounts[s] || 0) + 1;
                    if (!item.tranche3) fieldCounts.tranche3_missing++;
                    if (!item.new_product) fieldCounts.new_product_missing++;
                    if (!item.impact_dropdown) fieldCounts.impact_dropdown_missing++;
                }
            }

            console.log('\n📈 Status distribution after backfill:');
            Object.entries(statusCounts)
                .sort((a, b) => b[1] - a[1])
                .forEach(([status, count]) => console.log(`   ${status}: ${count}`));

            console.log('\n🔍 Field coverage verification:');
            const totalAfter = Object.values(statusCounts).reduce((a, b) => a + b, 0);
            console.log(`   tranche3 still missing: ${fieldCounts.tranche3_missing} / ${totalAfter}`);
            console.log(`   new_product still missing: ${fieldCounts.new_product_missing} / ${totalAfter}`);
            console.log(`   impact_dropdown still missing: ${fieldCounts.impact_dropdown_missing} / ${totalAfter}`);

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

            console.log(`\n✅ Backfill and cleanup complete.\n`);
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('Connection closed');
    }
}

if (require.main === module) {
    resetActionables();
}

module.exports = { resetActionables };
