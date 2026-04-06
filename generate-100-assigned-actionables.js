// generate-100-assigned-actionables.js
// Usage:
//   node generate-100-assigned-actionables.js         # create 100 assigned synthetic items
//   node generate-100-assigned-actionables.js --count 50 --doc-id DOC-SYN-ASSIGNED-TEST

const { MongoClient } = require('./web/node_modules/mongodb');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const COUNT = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) || 100 : 100;
const docIdIndex = args.indexOf('--doc-id');
const DOC_ID = docIdIndex !== -1 ? args[docIdIndex + 1] : `DOC-SYN-ASSIGNED-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,-5)}`;

function nowISO() { return new Date().toISOString(); }

function generateItem(i) {
    const id = `ACT-SYN-ASSIGNED-${String(i).padStart(4, '0')}`;
    const created = nowISO();
    return {
        id: id,
        actionable_id: id,
        modality: "Mandatory",
        actor: "Compliance",
        action: `Synthetic assigned actionable ${i}`,
        object: `Synthetic object ${i}`,
        implementation_notes: `Synthetic test item ${i}`,
        workstream: "Other",
        needs_legal_review: false,
        validation_status: "validated",
        validation_notes: "",
        approval_status: "pending",
        is_manual: false,
        published_at: created,
        first_published_at: created,
        deadline: "",
        new_product: "No",
        product_live_date: "",
        task_status: "assigned",
        completion_date: "",
        reviewer_comments: "",
        evidence_files: [],
        comments: [],
        submitted_at: "",
        team_reviewer_name: "",
        team_reviewer_approved_at: "",
        team_reviewer_rejected_at: "",
        rejection_reason: "",
        is_delayed: false,
        delay_detected_at: "",
        justification: "",
        justification_by: "",
        justification_at: "",
        justification_status: "",
        justification_member_text: "",
        justification_member_at: "",
        justification_member_by: "",
        member_comment: "",
        member_comment_history: [],
        reviewer_comment: "",
        lead_comment: "",
        co_comment: "",
        audit_trail: [],
        created_at: created,
        impact: "",
        tranche3: "",
        control: "",
        likelihood: "",
        residual_risk: "",
        inherent_risk: "",
        likelihood_business_volume: {},
        likelihood_products_processes: {},
        likelihood_compliance_violations: {},
        likelihood_score: 0,
        impact_dropdown: {},
        impact_score: 0,
        control_monitoring: {},
        control_effectiveness: {},
        control_score: 0,
        inherent_risk_score: 0,
        inherent_risk_label: "",
        residual_risk_score: 0,
        residual_risk_label: "",
        residual_risk_interpretation: "",
        overall_likelihood_score: 0,
        overall_impact_score: 0,
        overall_control_score: 0,
        impact_sub1: {},
        impact_sub2: {},
        impact_sub3: {},
        theme: "Synthetic Test",
        bypass_tag: false,
        assigned_teams: [],
        team_workflows: {},
        published_by_account_id: "",
        delegated_from_account_id: "",
        delegation_request_id: "",
    };
}

async function main() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log(`Inserting ${COUNT} assigned synthetic actionables into doc '${DOC_ID}'`);

        const items = [];
        for (let i = 1; i <= COUNT; i++) {
            items.push(generateItem(i));
        }

        const result = await col.updateOne(
            { _id: DOC_ID, synthetic: true },
            {
                $set: {
                    _id: DOC_ID,
                    doc_id: DOC_ID,
                    doc_name: `Synthetic Assigned Actionables (${COUNT})`,
                    actionables: items,
                    synthetic: true,
                    generated_at: nowISO(),
                }
            },
            { upsert: true }
        );

        console.log('Write result:', result.result || result);

        // Verify
        const insertedDoc = await col.findOne({ _id: DOC_ID });
        const countInDb = insertedDoc?.actionables?.length || 0;
        console.log(`Verified in DB: ${countInDb} actionables in document '${DOC_ID}'`);

        console.log('\n✅ Done. Use reset-synthetic-actionables.js to remove these later.');

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch(e){}
    }
}

if (require.main === module) main();

module.exports = { main };
