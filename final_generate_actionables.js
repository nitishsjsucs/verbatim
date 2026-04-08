// final_generate_actionables.js
//
// PURPOSE:
//   1. Deletes ALL actionables from every document in the collection.
//   2. Inserts COUNT fresh actionables into DOC-CAG-Actionables ONLY.
//   3. All actionables have:
//       - published_at: ""  → appear in CAG Role Application section (NOT the tracker)
//       - assigned_teams: []  → no team assigned by default
//       - team_workflows: {}
//
// Usage:
//   node final_generate_actionables.js              # default: 100 items
//   node final_generate_actionables.js --count 50   # custom count
//   node final_generate_actionables.js --dry-run    # preview, no DB writes

let MongoClient;
try { ({ MongoClient } = require('mongodb')); } catch (e) { ({ MongoClient } = require('./web/node_modules/mongodb')); }

const fs = require('fs');
const path = require('path');

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || 'mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda';
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || 'govinda_v2';

const args = process.argv.slice(2);
const countIdx = args.indexOf('--count');
const COUNT = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) || 100 : 100;
const DRY_RUN = args.includes('--dry-run');

const DOC_ID = 'DOC-CAG-Actionables';
const DOC_NAME = 'CAG → Actionable section';

// ─── Lookup tables ─────────────────────────────────────────────────────────── 

const THEMES = [
    'Market Risk', 'Audit', 'NPA & Restructuring', 'Corporate Governance',
    'Financial Accounting & Records', 'Outsourcing', 'Compliance',
    'Loans & Advances', 'Priority Sector Lending (PSL)', 'Credit Risk',
    'Third Party Products', 'Other Operating Regulations', 'Digital Banking',
    'Treasury', 'CMS', 'Branch Banking', 'Cyber & Information Security',
    'FCRM', 'Information Technology Governance / Data Governance',
    'Debit Card', 'Employer Communications', 'Credit Card',
    'Customer Service', 'Trade & FEMA', 'KYC / AML', 'Deposit',
];

const MODALITIES = ['Mandatory', 'Advisory', 'Discretionary'];

const ACTIONS = [
    'Implement policy for', 'Review and update procedures for', 'Conduct audit of',
    'Submit report on', 'Establish controls for', 'Train staff on',
    'Obtain approval for', 'Document evidence of compliance with',
    'Monitor and report on', 'Assess risk associated with',
];

const OBJECTS = [
    'customer data management', 'regulatory reporting framework',
    'anti-money laundering procedures', 'credit risk assessment models',
    'digital banking security protocols', 'outsourced service provider contracts',
    'branch operations manual', 'treasury management guidelines',
    'cyber incident response plan', 'KYC verification workflows',
];

// ─── Helpers ───────────────────────────────────────────────────────────────── 

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pad(n, w = 4) { return String(n).padStart(w, '0'); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); }
function nowISO() { return new Date().toISOString(); }

function randomPastDate(maxDaysBack = 365) {
    const ms = Date.now() - Math.floor(Math.random() * maxDaysBack) * 86400000;
    return new Date(ms).toISOString();
}

function randomFutureDate(maxDaysAhead = 180) {
    const ms = Date.now() + Math.floor(Math.random() * maxDaysAhead) * 86400000;
    return new Date(ms).toISOString().split('T')[0];
}

// ─── Item generator ────────────────────────────────────────────────────────── 

function generateActionable(i) {
    const id = `ACT-CAG-${pad(i)}`;
    const created_at = randomPastDate(365);
    const theme = randomChoice(THEMES);
    const newProduct = Math.random() < 0.3 ? 'Yes' : 'No';

    return {
        id,
        actionable_id: id,
        modality: randomChoice(MODALITIES),
        actor: 'CAG',
        action: `${randomChoice(ACTIONS)} ${theme.toLowerCase()}`,
        object: randomChoice(OBJECTS),
        trigger_or_condition: '',
        thresholds: '',
        deadline_or_frequency: '',
        effective_date: '',
        reporting_or_notification_to: '',
        evidence_quote: '',
        source_location: '',
        source_node_id: '',
        implementation_notes: `Auto-generated actionable for theme: ${theme}`,
        workstream: 'Other',
        needs_legal_review: false,
        validation_status: 'validated',
        approval_status: 'pending',
        is_manual: false,

        // ── Key fields: blank published_at keeps item in CAG section (NOT tracker) ──
        published_at: '',
        first_published_at: '',

        // ── No team assigned by default ──────────────────────────────────────────
        assigned_teams: [],
        team_workflows: {},

        created_at,
        deadline: randomFutureDate(180),
        new_product: newProduct,
        product_live_date: newProduct === 'Yes' ? randomFutureDate(365) : '',
        task_status: 'unassigned',
        completion_date: '',
        submitted_at: '',
        reviewer_comments: '',
        evidence_files: [],
        comments: [],
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

        // ── Risk fields ───────────────────────────────────────────────────────────
        theme,
        tranche3: randomChoice(['Yes', 'No', '']),
        impact: '',
        impact_dropdown: {},
        impact_score: 0,
        overall_impact_score: 0,
        control: '',
        likelihood: '',
        residual_risk: '',
        inherent_risk: '',
        likelihood_business_volume: {},
        likelihood_products_processes: {},
        likelihood_compliance_violations: {},
        likelihood_score: 0,
        overall_likelihood_score: 0,
        control_monitoring: {},
        control_effectiveness: {},
        control_score: 0,
        overall_control_score: 0,
        inherent_risk_score: 0,
        inherent_risk_label: '',
        residual_risk_score: 0,
        residual_risk_label: '',
        residual_risk_interpretation: '',
        impact_sub1: {},
        impact_sub2: {},
        impact_sub3: {},
        bypass_tag: false,

        // ── Circular metadata (populated on ingestion) ────────────────────────────
        circular_id: '',
        circular_title: '',
        regulation_issue_date: '',
        circular_effective_date: '',
        regulator: '',

        published_by_account_id: '',
        delegated_from_account_id: '',
        delegation_request_id: '',
    };
}

// ─── Main ──────────────────────────────────────────────────────────────────── 

async function main() {
    const items = Array.from({ length: COUNT }, (_, i) => generateActionable(i + 1));

    if (DRY_RUN) {
        console.log(`\n⚠️  DRY-RUN — no DB writes.\n`);
        console.log(`Would generate ${COUNT} actionables into '${DOC_ID}'`);
        console.log(`Sample (first item):\n${JSON.stringify(items[0], null, 2)}`);
        return;
    }

    const client = new MongoClient(DEFAULT_URI);
    const backupDir = path.join(__dirname, 'backups', timestamp());

    try {
        await client.connect();
        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        // 1. Backup
        console.log('\nBacking up current `actionables` collection...');
        const allDocs = await col.find({}).toArray();
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(
            path.join(backupDir, 'actionables-before-generate.json'),
            JSON.stringify(allDocs, null, 2),
            'utf8'
        );
        console.log(`  • Backed up ${allDocs.length} documents → ${backupDir}`);

        // 2. Delete ALL actionables from every document
        console.log('\nClearing actionables from ALL documents...');
        const clearResult = await col.updateMany({}, { $set: { actionables: [] } });
        console.log(`  • Cleared ${clearResult.modifiedCount} / ${clearResult.matchedCount} documents`);

        // 3. Upsert fresh actionables into CAG document only
        console.log(`\nInserting ${COUNT} actionables into '${DOC_ID}'...`);
        const upsertResult = await col.updateOne(
            { _id: DOC_ID },
            {
                $set: {
                    _id: DOC_ID,
                    doc_id: DOC_ID,
                    doc_name: DOC_NAME,
                    actionables: items,
                    synthetic: false,
                    generated_at: nowISO(),
                }
            },
            { upsert: true }
        );
        console.log(`  • Matched: ${upsertResult.matchedCount}, Modified: ${upsertResult.modifiedCount}, Upserted: ${upsertResult.upsertedCount}`);

        // 4. Verify
        const verify = await col.findOne({ _id: DOC_ID });
        console.log(`\n✅ Done. ${verify?.actionables?.length ?? 0} actionables in '${DOC_ID}'`);
        console.log(`   published_at: '' → all in CAG Application section (not tracker)`);
        console.log(`   assigned_teams: [] → all unassigned`);
        console.log(`   Backup: ${backupDir}`);

    } catch (err) {
        console.error('Error:', err);
        process.exitCode = 1;
    } finally {
        try { await client.close(); } catch (_) {}
    }
}

if (require.main === module) main();
module.exports = { main };