const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Global Actionable Status Reset & Standardization (Consolidated Edition)
 *
 * MAJOR CHANGES:
 * - Keep ONLY 3 documents (remove all excess)
 * - Standardize ALL actionables with complete schema
 * - Ensure every actionable has: Theme, Tranche, New Product, Impact, Live Date
 * - All actionables reset to "assigned" status with clean workflow state
 * - Apply same backfill logic to all retained documents
 *
 * Structure:
 *   Collection: actionables
 *   Document:   { _id: <doc_id>, actionables: [ { task_status, team_workflows, ... }, ... ], ... }
 *
 * STANDARDIZATION STRATEGY:
 *   - Keep only: DOC-TEST-001, DOC-SYN-Market-Risk, DOC-SYN-Audit
 *   - DELETE all other documents
 *   - For each actionable: ensure complete field schema
 *   - New Product defaults to "No" (unless set to "Yes")
 *   - Live Date required only if New Product === "Yes"
 *   - Theme defaults to "" (empty until user sets)
 *   - Tranche defaults to "" (empty until user sets)
 *   - Impact defaults to { label: null, value: null }
 *   - All workflow/approval fields reset to initial state
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

        // Define the 3 documents to KEEP
        const DOCUMENTS_TO_KEEP = ["DOC-TEST-001", "DOC-SYN-Market-Risk", "DOC-SYN-Audit"];

        // Count total items before reset
        const allDocs = await col.find({}).toArray();
        console.log(`\nFound ${allDocs.length} ActionablesResult documents.`);
        console.log(`Documents to keep: ${DOCUMENTS_TO_KEEP.join(", ")}`);

        // Separate docs to keep vs. delete
        const docsToKeep = allDocs.filter(d => DOCUMENTS_TO_KEEP.includes(d._id || d.doc_id));
        const docsToDelete = allDocs.filter(d => !DOCUMENTS_TO_KEEP.includes(d._id || d.doc_id));

        console.log(`   → Keeping: ${docsToKeep.length} documents`);
        console.log(`   → Deleting: ${docsToDelete.length} documents`);

        // DELETE excess documents (if applying)
        if (shouldApply && docsToDelete.length > 0) {
            console.log('\n🧹 Deleting excess documents...');
            const idsToDelete = docsToDelete.map(d => d._id);
            const deleteResult = await col.deleteMany({ _id: { $in: idsToDelete } });
            console.log(`   • Deleted ${deleteResult.deletedCount} documents`);
        } else if (docsToDelete.length > 0) {
            console.log(`\n⚠️  [DRY-RUN] Would delete ${docsToDelete.length} documents:`);
            docsToDelete.forEach(d => console.log(`     - ${d._id || d.doc_id}`));
        }

        // Now process ONLY the 3 documents we're keeping
        const allDocsToProcess = shouldApply ? docsToKeep : allDocs;
        let totalItems = 0;
        let totalToModify = 0;
        let sampleItems = [];

        for (const doc of allDocsToProcess) {
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
        console.log(`📊 STANDARDIZATION & BACKFILL REPORT`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   Processed documents  : ${allDocsToProcess.length}`);
        console.log(`   Total items         : ${totalItems}`);
        console.log(`   Items standardized  : ${totalToModify}`);
        console.log(`   Modification rate   : ${((totalToModify / totalItems) * 100).toFixed(1)}%`);
        console.log(`   Documents deleted   : ${docsToDelete.length}`);
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
            console.log(`\n💡 To apply these changes (delete excess docs + standardize), run:`);
            console.log(`   node reset-actionables.js --apply\n`);
        } else {
            console.log(`\n✅ CHANGES APPLIED TO DATABASE`);
            console.log(`   • Deleted ${docsToDelete.length} excess documents`);
            console.log(`   • Kept ${docsToKeep.length} documents with complete schema`);
            
            // Verify: collect all documents post-reset
            const finalDocs = await col.find({}).toArray();
            const statusCounts = {};
            const fieldCounts = { theme_missing: 0, tranche3_missing: 0, new_product_missing: 0, impact_dropdown_missing: 0 };
            let totalItemsAfter = 0;

            for (const doc of finalDocs) {
                for (const item of (doc.actionables || [])) {
                    totalItemsAfter++;
                    const s = item.task_status || '(empty)';
                    statusCounts[s] = (statusCounts[s] || 0) + 1;
                    if (!item.theme) fieldCounts.theme_missing++;
                    if (!item.tranche3 && item.tranche3 !== "") fieldCounts.tranche3_missing++;
                    if (!item.new_product) fieldCounts.new_product_missing++;
                    if (!item.impact_dropdown) fieldCounts.impact_dropdown_missing++;
                }
            }

            console.log(`\n📈 Post-standardization verification (${finalDocs.length} docs, ${totalItemsAfter} items):`);
            Object.entries(statusCounts)
                .sort((a, b) => b[1] - a[1])
                .forEach(([status, count]) => console.log(`   ${status}: ${count}`));

            console.log('\n🔍 Field standardization check:');
            console.log(`   theme present: ${totalItemsAfter - fieldCounts.theme_missing} / ${totalItemsAfter}`);
            console.log(`   tranche3 present: ${totalItemsAfter - fieldCounts.tranche3_missing} / ${totalItemsAfter}`);
            console.log(`   new_product present: ${totalItemsAfter - fieldCounts.new_product_missing} / ${totalItemsAfter}`);
            console.log(`   impact_dropdown present: ${totalItemsAfter - fieldCounts.impact_dropdown_missing} / ${totalItemsAfter}`);

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

            console.log(`\n✅ Standardization and cleanup complete.\n`);
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
