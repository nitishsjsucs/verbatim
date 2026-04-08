// generate-cag-100-synthetic.js
// Deletes all existing actionables from DOC-CAG-Actionables,
// then generates 100 synthetic actionables with randomized Impact, Tranche, New Product, and dates.
// 
// Requirements:
// - Randomize Impact field
// - Randomize Tranche (Transfer) field
// - Randomize New Product (Yes/No)
// - If New Product = Yes, assign random future date; else leave empty
// - Assign all to "Engineering Division 1 Unit 1"
// - Generate action names aligned with team context
//
// Usage:
//   node generate-cag-100-synthetic.js                    # generate and insert 100 items
//   node generate-cag-100-synthetic.js --count 50         # generate 50 items
//   node generate-cag-100-synthetic.js --dry-run          # preview without writing

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

const DOC_ID = 'DOC-CAG-Actionables';
const TEAM_NAME = 'Engineering Division 1 Unit 1';

// Impact options: label/value pairs
const IMPACT_OPTIONS = [
    { label: 'Low', value: 1 },
    { label: 'Medium', value: 2 },
    { label: 'High', value: 3 },
];

// Tranche options: Yes, No, or empty
const TRANCHE_OPTIONS = ['Yes', 'No', ''];

// Themes for diverse action context
const THEMES = [
    'Digital Banking', 'Cyber Security', 'Compliance', 'Risk Management',
    'Operations', 'Finance', 'Customer Service', 'KYC / AML',
    'Data Governance', 'Process Automation', 'Quality Assurance',
];

function nowISO() { return new Date().toISOString(); }

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomFutureDate(maxDays = 365) {
    const now = Date.now();
    const future = now + Math.random() * maxDays * 24 * 60 * 60 * 1000;
    const date = new Date(future);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
}

function generateTeamWorkflows(teamName) {
    return {
        [teamName]: {
            task_status: 'assigned',
            submitted_at: '',
            team_reviewer_name: '',
            team_reviewer_approved_at: '',
            team_reviewer_rejected_at: '',
            reviewer_comments: '',
            rejection_reason: '',
            is_delayed: false,
            delay_detected_at: '',
            justification: '',
            justification_by: '',
            justification_at: '',
            justification_status: '',
            delay_justification: '',
            delay_justification_member_submitted: false,
            delay_justification_reviewer_approved: false,
            delay_justification_lead_approved: false,
            delay_justification_updated_by: '',
            delay_justification_updated_at: '',
            evidence_files: [],
            comments: [],
            completion_date: '',
            deadline: randomFutureDate(180),
            implementation_notes: '',
            evidence_quote: '',
        }
    };
}

function generateActionable(i, teamName) {
    const id = `ACT-CAG-SYN-${String(i).padStart(4, '0')}`;
    const created_at = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString();
    const published_at = '';
    const newProduct = Math.random() < 0.4 ? 'Yes' : 'No';
    const productLiveDate = newProduct === 'Yes' ? randomFutureDate(365) : '';
    const impact = randomChoice(IMPACT_OPTIONS);
    const tranche = randomChoice(TRANCHE_OPTIONS);
    const theme = randomChoice(THEMES);

    return {
        id: id,
        actionable_id: id,
        modality: 'Mandatory',
        actor: 'CAG',
        action: `CAG ${theme} - Synthetic actionable ${i} (${teamName})`,
        object: `Implementation requirement for ${theme} under ${teamName}`,
        implementation_notes: `Synthetic CAG actionable generated for ${theme}`,
        workstream: 'Engineering',
        needs_legal_review: false,
        validation_status: 'validated',
        approval_status: 'pending',
        is_manual: false,
        published_at: published_at,
        first_published_at: '',
        deadline: randomFutureDate(180),
        new_product: newProduct,
        product_live_date: productLiveDate,
        task_status: 'assigned',
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
        justification_member_text: '',
        justification_member_at: '',
        justification_member_by: '',
        member_comment: '',
        member_comment_history: [],
        reviewer_comment: '',
        lead_comment: '',
        co_comment: '',
        audit_trail: [],
        created_at: created_at,
        impact: '',
        tranche3: tranche,
        control: '',
        likelihood: '',
        residual_risk: '',
        inherent_risk: '',
        likelihood_business_volume: {},
        likelihood_products_processes: {},
        likelihood_compliance_violations: {},
        likelihood_score: 0,
        impact_dropdown: impact,
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
        impact_sub1: {},
        impact_sub2: {},
        impact_sub3: {},
        theme: theme,
        bypass_tag: false,
        assigned_teams: [teamName],
        team_workflows: generateTeamWorkflows(teamName),
        published_by_account_id: '',
        delegated_from_account_id: '',
        delegation_request_id: '',
    };
}

async function run() {
    const client = new MongoClient(DEFAULT_URI);
    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log(`\n📋 Generating ${COUNT} synthetic CAG actionables...`);
        console.log(`   Team: ${TEAM_NAME}`);
        console.log(`   Doc:  ${DOC_ID}\n`);

        // Generate items
        const items = [];
        const stats = { newProductYes: 0, newProductNo: 0, trancheYes: 0, trancheNo: 0, trancheEmpty: 0, impactLow: 0, impactMed: 0, impactHigh: 0 };
        for (let i = 1; i <= COUNT; i++) {
            const item = generateActionable(i, TEAM_NAME);
            items.push(item);
            // Track stats
            if (item.new_product === 'Yes') stats.newProductYes++;
            else stats.newProductNo++;
            if (item.tranche3 === 'Yes') stats.trancheYes++;
            else if (item.tranche3 === 'No') stats.trancheNo++;
            else stats.trancheEmpty++;
            if (item.impact_dropdown.value === 1) stats.impactLow++;
            else if (item.impact_dropdown.value === 2) stats.impactMed++;
            else stats.impactHigh++;
        }

        if (DRY_RUN) {
            console.log('⚠️  DRY-RUN mode enabled — no DB changes will be made.\n');
            console.log('STATISTICS:');
            console.log(`  New Product:     Yes=${stats.newProductYes}, No=${stats.newProductNo}`);
            console.log(`  Tranche:         Yes=${stats.trancheYes}, No=${stats.trancheNo}, Empty=${stats.trancheEmpty}`);
            console.log(`  Impact:          Low=${stats.impactLow}, Medium=${stats.impactMed}, High=${stats.impactHigh}`);
            console.log('\nSample item (first):');
            console.log(JSON.stringify(items[0], null, 2));
            return;
        }

        // Delete existing actionables
        console.log(`Deleting existing actionables from '${DOC_ID}'...`);
        const deleteRes = await col.updateOne(
            { _id: DOC_ID },
            { $set: { actionables: [] } }
        );
        console.log(`  • Matched: ${deleteRes.matchedCount}, Modified: ${deleteRes.modifiedCount}\n`);

        // Insert new actionables
        console.log(`Upserting ${COUNT} new synthetic actionables into '${DOC_ID}'...`);
        const upsertRes = await col.updateOne(
            { _id: DOC_ID },
            {
                $set: {
                    _id: DOC_ID,
                    doc_id: DOC_ID,
                    doc_name: 'CAG → Actionable section',
                    actionables: items,
                    synthetic: false,
                    generated_at: nowISO(),
                }
            },
            { upsert: true }
        );
        console.log(`  • Matched: ${upsertRes.matchedCount}, Modified: ${upsertRes.modifiedCount}, Upserted: ${upsertRes.upsertedCount}\n`);

        // Verify
        const verify = await col.findOne({ _id: DOC_ID });
        const countInDb = verify?.actionables?.length || 0;
        console.log(`Verified in DB: ${countInDb} actionables in '${DOC_ID}'`);

        console.log('\nSTATISTICS:');
        console.log(`  New Product:     Yes=${stats.newProductYes}, No=${stats.newProductNo}`);
        console.log(`  Tranche:         Yes=${stats.trancheYes}, No=${stats.trancheNo}, Empty=${stats.trancheEmpty}`);
        console.log(`  Impact:          Low=${stats.impactLow}, Medium=${stats.impactMed}, High=${stats.impactHigh}`);

        console.log('\n✅ Generation complete.\n');

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) run();

module.exports = { run };
