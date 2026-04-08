// generate-100-cag-actionables.js
// 1) Backs up the current `actionables` collection
// 2) Clears all actionables from all documents
// 3) Inserts a single CAG document with COUNT assigned actionables
// Usage:
//   node generate-100-cag-actionables.js        # default 100 items
//   node generate-100-cag-actionables.js --count 50 --doc-id DOC-CAG-Actionables

const { MongoClient } = require('./web/node_modules/mongodb');
const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const countIndex = args.indexOf('--count');
const COUNT = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) || 100 : 100;
const docIdIndex = args.indexOf('--doc-id');
const DOC_ID = docIdIndex !== -1 ? args[docIdIndex + 1] : 'DOC-CAG-Actionables';

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad(n, width=3) { return String(n).padStart(width, '0'); }

// Themes reused from existing generator (subset is fine)
const THEMES = [
    "Market Risk","Audit","NPA & Restructuring","Corporate Governance","Financial Accounting & Records",
    "Outsourcing","Compliance","Loans & Advances","Priority Sector Lending (PSL)","Credit Risk",
    "Third Party Products","Other Operating Regulations","Digital Banking","Treasury","CMS",
    "Branch Banking","Cyber & Information Security","FCRM","Information Technology Governance / Data Governance",
    "Debit Card","Employer Communications","Credit Card","Customer Service","Trade & FEMA","KYC / AML","Deposit"
];

function randomDatePastYears(years = 2) {
    const now = Date.now();
    const past = now - Math.random() * years * 365 * 24 * 60 * 60 * 1000;
    return new Date(past).toISOString();
}

function randomFutureDateFrom(iso, maxDays = 120) {
    const start = new Date(iso).getTime();
    const future = start + Math.floor(Math.random() * maxDays) * 24 * 60 * 60 * 1000;
    return new Date(future).toISOString();
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
            deadline: '',
            implementation_notes: '',
            evidence_quote: '',
        }
    };
}

function generateActionable(i, teamName) {
    const id = `ACT-CAG-${pad(i,4)}`;
    const created_at = randomDatePastYears(2);
    const published_at = created_at;
    const task_status = 'assigned';

    // tranche3 random among Yes/No/blank
    const trancheOptions = ['Yes', 'No', ''];
    const tranche3 = randomChoice(trancheOptions);

    // new_product: 30% Yes, 70% No
    const newProduct = Math.random() < 0.3 ? 'Yes' : 'No';
    const product_live_date = newProduct === 'Yes' ? randomFutureDateFrom(created_at, 365).slice(0,10) : '';

    const theme = randomChoice(THEMES);

    const deadline = randomFutureDateFrom(created_at, 180);

    return {
        id: id,
        actionable_id: id,
        modality: 'Mandatory',
        actor: 'CAG',
        action: `CAG actionable ${i} - ${theme}`,
        object: `Implementation item for ${theme}`,
        implementation_notes: `Auto-generated CAG actionable for ${theme}`,
        workstream: 'Engineering',
        needs_legal_review: false,
        validation_status: 'validated',
        approval_status: 'pending',
        is_manual: false,
        published_at: published_at,
        first_published_at: published_at,
        deadline: deadline,
        new_product: newProduct,
        product_live_date: product_live_date,
        task_status: task_status,
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
        tranche3: tranche3,
        control: '',
        likelihood: '',
        residual_risk: '',
        inherent_risk: '',
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

async function main() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);
    const backupDir = path.join(__dirname, 'backups', timestamp());

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log('\nBacking up current `actionables` collection...');
        const allDocs = await col.find({}).toArray();
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(path.join(backupDir, 'actionables-before-cag.json'), JSON.stringify(allDocs, null, 2), 'utf8');
        console.log(`  • Backed up ${allDocs.length} documents to ${backupDir}`);

        console.log('\nClearing all actionables from all documents (actionables -> [])...');
        const clearResult = await col.updateMany({}, { $set: { actionables: [] } });
        console.log(`  • Matched ${clearResult.matchedCount}, Modified ${clearResult.modifiedCount}`);

        console.log(`\nCreating CAG document '${DOC_ID}' with ${COUNT} assigned actionables...`);
        const teamName = 'Engineering Division 1 Unit 1';
        const items = [];
        for (let i = 1; i <= COUNT; i++) {
            items.push(generateActionable(i, teamName));
        }

        const upsertResult = await col.updateOne(
            { _id: DOC_ID },
            { $set: { _id: DOC_ID, doc_id: DOC_ID, doc_name: 'CAG → Actionable section', actionables: items, synthetic: false, generated_at: timestamp() } },
            { upsert: true }
        );

        console.log('  • Upsert result:', upsertResult.result || upsertResult);

        const verify = await col.findOne({ _id: DOC_ID });
        console.log(`\nVerified in DB: ${verify?.actionables?.length || 0} actionables in '${DOC_ID}'`);

        console.log('\n✅ Done. All other documents have empty actionables; CAG doc populated.');
        console.log(`Backup located at: ${backupDir}`);

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (e) {}
    }
}

if (require.main === module) main();

module.exports = { main };