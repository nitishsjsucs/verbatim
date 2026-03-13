const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Synthetic Completed Actionables Generator
 *
 * Generates 1300 completed synthetic actionables (50 per theme) for testing
 * the compliance risk engine. Each theme has a target average residual risk score.
 *
 * Themes and target averages:
 *   Low (< 13): Market Risk (6.11), Audit (6.55), NPA & Restructuring (6.57), etc.
 *   Medium (13-27): Third Party Products (13.38), Digital Banking (14.23), etc.
 *   High (>= 28): Deposit (28.95)
 *
 * Generated actionables are marked with synthetic=true for easy removal.
 * Uses ID pattern: ACT-SYN-0001, ACT-SYN-0002, etc.
 *
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node generate-synthetic-actionables.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

// Theme definitions with target average residual risk scores
const THEMES = [
    // Low category (< 13)
    { name: "Market Risk", targetAvg: 6.11 },
    { name: "Audit", targetAvg: 6.55 },
    { name: "NPA & Restructuring", targetAvg: 6.57 },
    { name: "Corporate Governance", targetAvg: 6.60 },
    { name: "Financial Accounting & Records", targetAvg: 7.07 },
    { name: "Outsourcing", targetAvg: 9.76 },
    { name: "Compliance", targetAvg: 10.35 },
    { name: "Loans & Advances", targetAvg: 10.63 },
    { name: "Priority Sector Lending (PSL)", targetAvg: 12.80 },
    { name: "Credit Risk", targetAvg: 12.93 },
    // Medium category (13-27)
    { name: "Third Party Products", targetAvg: 13.38 },
    { name: "Other Operating Regulations", targetAvg: 13.55 },
    { name: "Digital Banking", targetAvg: 14.23 },
    { name: "Treasury", targetAvg: 16.31 },
    { name: "CMS", targetAvg: 16.48 },
    { name: "Branch Banking", targetAvg: 16.50 },
    { name: "Cyber & Information Security", targetAvg: 16.92 },
    { name: "FCRM (Earlier part of the Vigilance theme)", targetAvg: 17.53 },
    { name: "Information Technology Governance / Data Governance", targetAvg: 17.87 },
    { name: "Debit Card", targetAvg: 18.16 },
    { name: "Employer Communications", targetAvg: 20.21 },
    { name: "Credit Card", targetAvg: 20.52 },
    { name: "Customer Service", targetAvg: 21.11 },
    { name: "Trade & FEMA", targetAvg: 22.39 },
    { name: "KYC / AML", targetAvg: 24.42 },
    // High category (>= 28)
    { name: "Deposit", targetAvg: 28.95 },
];

const ACTIONABLES_PER_THEME = 50;
const TOTAL_SYNTHETIC = THEMES.length * ACTIONABLES_PER_THEME;

/**
 * Generate random residual risk scores with a target average.
 * Uses a distribution that ensures the final average equals the target.
 */
function generateScoresForTheme(targetAvg, count) {
    const scores = [];
    // Generate random scores with some variance around the target
    for (let i = 0; i < count; i++) {
        // Add random variation (±30% of target)
        const variance = (Math.random() - 0.5) * targetAvg * 0.6;
        let score = Math.max(0.5, targetAvg + variance);
        scores.push(score);
    }

    // Adjust scores to ensure exact average
    const currentAvg = scores.reduce((a, b) => a + b, 0) / count;
    const adjustment = targetAvg / currentAvg;
    const adjustedScores = scores.map(s => Math.round(s * adjustment * 100) / 100);

    return adjustedScores;
}

/**
 * Generate a random date within the last N years.
 */
function randomDateInPastYears(years = 3) {
    const now = new Date();
    const pastDate = new Date(now.getTime() - Math.random() * years * 365 * 24 * 60 * 60 * 1000);
    return pastDate.toISOString();
}

/**
 * Generate synthetic actionable item.
 */
function generateActionable(id, theme, residualScore) {
    const createdDate = randomDateInPastYears(3);
    const createdTime = new Date(createdDate);
    const completedTime = new Date(createdTime.getTime() + Math.random() * 180 * 24 * 60 * 60 * 1000); // 0-180 days later
    const completedDate = completedTime.toISOString();

    // Deadline is typically before or around completion
    const deadlineTime = new Date(createdTime.getTime() + Math.random() * 200 * 24 * 60 * 60 * 1000);
    const deadline = deadlineTime.toISOString();

    return {
        id: id,
        actionable_id: id,
        title: `Synthetic Action: ${theme} - ${id}`,
        description: `This is a synthetic completed actionable for theme "${theme}". Generated for risk engine testing.`,
        theme: theme,
        workstream: "Mixed Team Projects", // Default workstream
        task_status: "completed",
        approval_status: "approved",
        published_at: createdDate,
        completion_date: completedDate,
        deadline: deadline,
        created_at: createdDate,
        updated_at: completedDate,

        // Risk assessment fields
        residual_risk_score: residualScore,
        residual_risk_label: residualScore >= 28 ? "High" : residualScore >= 13 ? "Medium" : "Low",
        residual_risk_interpretation: residualScore >= 28 ? "Weak (High)" : residualScore >= 13 ? "Improvement Needed (Medium)" : "Satisfactory (Low)",

        // Inherent risk (synthetic)
        inherent_risk_score: Math.round(residualScore * 1.3 * 100) / 100,
        inherent_risk_label: residualScore >= 28 ? "High" : residualScore >= 13 ? "Medium" : "Low",

        // Control score (synthetic, inverse relationship)
        control_score: Math.max(0.2, Math.min(1.0, 1.0 - (residualScore / 50))),

        // Likelihood and impact (synthetic)
        likelihood_score: Math.round(residualScore * 0.7 * 100) / 100,
        impact_score: Math.round(residualScore * 0.6 * 100) / 100,

        // Evidence and comments (empty for synthetic)
        evidence_files: [],
        comments: [],

        // Metadata
        synthetic: true,
        generated_at: new Date().toISOString(),

        // Status fields
        submitted_at: createdDate,
        team_reviewer_approved_at: completedDate,
        is_delayed: false,

        // Approval chain (all completed)
        justification_member_text: "Synthetic data",
        justification_member_at: createdDate,
        justification_member_by: "synthetic_system",
        justification_reviewer_approved: true,
        justification_reviewer_comment: "Approved",
        justification_reviewer_by: "synthetic_reviewer",
        justification_reviewer_at: createdDate,
        justification_lead_approved: true,
        justification_lead_comment: "Approved",
        justification_lead_by: "synthetic_lead",
        justification_lead_at: createdDate,
        justification_co_approved: true,
        justification_co_comment: "Approved",
        justification_co_by: "synthetic_co",
        justification_co_at: createdDate,

        // Comments
        member_comment: "",
        reviewer_comment: "",
        lead_comment: "",
        co_comment: "",

        // Bypass flow (not bypassed)
        bypass_tag: false,

        // Team workflows (empty for synthetic)
        team_workflows: {},

        // Tranche and other fields
        tranche3: "",
        impact: "",
        control: "",
        likelihood: "",
    };
}

async function generateSyntheticActionables() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DEFAULT_DB);
        const col = db.collection('actionables');

        console.log(`\n📊 Generating ${TOTAL_SYNTHETIC} synthetic completed actionables...`);
        console.log(`   ${THEMES.length} themes × ${ACTIONABLES_PER_THEME} actionables per theme\n`);

        let globalId = 1;
        let totalInserted = 0;
        const themeSummary = [];

        // For each theme, generate actionables
        for (const theme of THEMES) {
            const scores = generateScoresForTheme(theme.targetAvg, ACTIONABLES_PER_THEME);
            const actionables = [];

            // Generate actionables for this theme
            for (let i = 0; i < ACTIONABLES_PER_THEME; i++) {
                const id = `ACT-SYN-${String(globalId).padStart(5, '0')}`;
                const actionable = generateActionable(id, theme.name, scores[i]);
                actionables.push(actionable);
                globalId++;
            }

            // Verify average
            const actualAvg = actionables.reduce((sum, a) => sum + a.residual_risk_score, 0) / actionables.length;

            // Insert into a synthetic document
            const docId = `DOC-SYN-${theme.name.replace(/\s+/g, '-').substring(0, 20)}`;
            const result = await col.updateOne(
                { _id: docId, synthetic: true },
                {
                    $set: {
                        _id: docId,
                        doc_id: docId,
                        doc_name: `Synthetic: ${theme.name}`,
                        actionables: actionables,
                        synthetic: true,
                        generated_at: new Date().toISOString(),
                    }
                },
                { upsert: true }
            );

            totalInserted += actionables.length;
            themeSummary.push({
                theme: theme.name,
                count: actionables.length,
                targetAvg: theme.targetAvg,
                actualAvg: Math.round(actualAvg * 100) / 100,
            });

            console.log(`  ✓ ${theme.name.padEnd(50)} | Target: ${theme.targetAvg.toFixed(2)} | Actual: ${actualAvg.toFixed(2)}`);
        }

        console.log(`\n✅ Synthetic actionables generated and inserted.`);
        console.log(`   Total themes       : ${THEMES.length}`);
        console.log(`   Actionables/theme  : ${ACTIONABLES_PER_THEME}`);
        console.log(`   Total inserted     : ${totalInserted}`);

        // Verify insertion
        const verifyDocs = await col.find({ synthetic: true }).toArray();
        const verifyCount = verifyDocs.reduce((sum, doc) => sum + (doc.actionables?.length || 0), 0);
        console.log(`   Verified in DB     : ${verifyCount}`);

        console.log(`\n📈 Theme Summary:`);
        console.log(`   Theme Name                                          | Target Avg | Actual Avg`);
        console.log(`   ${'─'.repeat(90)}`);
        for (const summary of themeSummary) {
            const themeName = summary.theme.padEnd(50);
            const targetAvg = summary.targetAvg.toFixed(2).padStart(10);
            const actualAvg = summary.actualAvg.toFixed(2).padStart(10);
            console.log(`   ${themeName} | ${targetAvg} | ${actualAvg}`);
        }

        console.log(`\n✨ Synthetic dataset ready for risk engine testing!`);
        console.log(`   Use 'node reset-synthetic-actionables.js' to remove this data later.`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

if (require.main === module) {
    generateSyntheticActionables();
}

module.exports = { generateSyntheticActionables };
