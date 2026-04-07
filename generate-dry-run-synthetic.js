// generate-dry-run-synthetic.js
// Generates 100 synthetic actionables for dry-run testing.
// All risk/compliance fields are intentionally blank for manual testing.
// Sets is_synthetic=true on each item.
//
// Usage:
//   node generate-dry-run-synthetic.js                    # generate and insert 100 items
//   node generate-dry-run-synthetic.js --count 50         # generate 50 items
//   node generate-dry-run-synthetic.js --dry-run          # preview without writing

let MongoClient;
try { ({ MongoClient } = require('mongodb')); } catch (e) { ({ MongoClient } = require('./web/node_modules/mongodb')); }

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const COUNT = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) || 100 : 100;
const DRY_RUN = args.includes('--dry-run');

const DOC_ID = 'DOC-SYN-DRY-RUN';
const DOC_NAME = 'Synthetic Dry-Run Document';
const TEAM_NAME = 'Engineering Division 1 - Unit 1';

function generateActionable(i) {
    const id = `ACT-DRY-${String(i).padStart(4, '0')}`;
    const created_at = new Date().toISOString();

    return {
        id: id,
        actionable_id: id,
        modality: 'Mandatory',
        actor: '',
        action: `Dry-run actionable ${i} — fill all fields manually for testing`,
        object: '',
        implementation_notes: '',
        workstream: TEAM_NAME,
        needs_legal_review: false,
        validation_status: 'validated',
        approval_status: 'pending',
        is_manual: false,
        published_at: '',
        first_published_at: '',
        deadline: '',
        new_product: '',
        product_live_date: '',
        new_product_expiry: '',
        task_status: '',
        completion_date: '',
        reviewer_comments: '',
        evidence_files: [],
        comments: [],
        submitted_at: '',
        team_reviewer_name: '',
        team_reviewer_approved_at: '',
        team_reviewer_rejected_at: '',
        rejection_reason: '',
        is_delayed: false,
        delay_detected_at: '',
        justification: '',
        justification_by: '',
        justification_at: '',
        justification_status: '',
        member_comment: '',
        member_comment_history: [],
        reviewer_comment: '',
        lead_comment: '',
        co_comment: '',
        audit_trail: [],
        created_at: created_at,
        // All risk fields intentionally blank for manual testing
        impact: '',
        tranche3: '',
        control: '',
        likelihood: '',
        residual_risk: '',
        inherent_risk: '',
        theme: '',
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
        inherent_risk_label: '',
        residual_risk_score: 0,
        residual_risk_label: '',
        residual_risk_interpretation: '',
        overall_likelihood_score: 0,
        overall_impact_score: 0,
        overall_control_score: 0,
        bypass_tag: false,
        assigned_teams: [TEAM_NAME],
        team_workflows: {
            [TEAM_NAME]: {
                task_status: 'assigned',
                submitted_at: '',
                team_reviewer_name: '',
                team_reviewer_approved_at: '',
                team_reviewer_rejected_at: '',
                reviewer_comments: '',
                rejection_reason: '',
                is_delayed: false,
                delay_detected_at: '',
                evidence_files: [],
                comments: [],
                completion_date: '',
                deadline: '',
                implementation_notes: '',
                evidence_quote: '',
            }
        },
        published_by_account_id: '',
        delegated_from_account_id: '',
        delegation_request_id: '',
        // ── Synthetic flag ──
        is_synthetic: true,
        likelihood_owner_team: '',
    };
}

async function run() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log(`\n📋 Generating ${COUNT} DRY-RUN synthetic actionables...`);
        console.log(`   Team: ${TEAM_NAME}`);
        console.log(`   Doc:  ${DOC_ID}`);
        console.log(`   All fields BLANK for manual testing\n`);

        const items = [];
        for (let i = 1; i <= COUNT; i++) {
            items.push(generateActionable(i));
        }

        if (DRY_RUN) {
            console.log('🔍 DRY RUN — preview of first 3 items:\n');
            for (const it of items.slice(0, 3)) {
                console.log(JSON.stringify(it, null, 2).slice(0, 600) + '\n...\n');
            }
            console.log(`Total: ${items.length} items would be inserted`);
            console.log('   (all fields blank, is_synthetic=true)');
            return;
        }

        // Upsert the document — delete existing items, insert new ones
        const now = new Date().toISOString();
        await col.updateOne(
            { _id: DOC_ID },
            {
                $set: {
                    doc_id: DOC_ID,
                    doc_name: DOC_NAME,
                    regulation_issue_date: '',
                    circular_effective_date: '',
                    regulator: '',
                    global_theme: '',
                    global_deadline: '',
                    global_tranche3: '',
                    global_new_product: '',
                    global_live_date: '',
                    global_impact_dropdown: {},
                    global_likelihood_owner_team: '',
                    document_likelihood_breakdown: {},
                    document_likelihood_score: 0,
                    document_likelihood_owner_team: '',
                    actionables: items,
                    total_extracted: items.length,
                    total_validated: items.length,
                    total_flagged: 0,
                    nodes_processed: 0,
                    nodes_with_actionables: 0,
                    extraction_time_seconds: 0,
                    llm_calls: 0,
                    total_tokens: 0,
                    extracted_at: now,
                    by_modality: { Mandatory: items.length },
                    by_workstream: { [TEAM_NAME]: items.length },
                }
            },
            { upsert: true }
        );

        console.log(`✅ Inserted ${items.length} dry-run synthetic actionables into ${DOC_ID}`);
        console.log(`   All fields blank, is_synthetic=true`);
        console.log(`   Ready for manual testing`);
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

run();
