const { MongoClient } = require('./web/node_modules/mongodb');

const uri = process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const dbName = process.env.MONGO_DB || "govinda_v2";

async function migrate() {
    const client = new MongoClient(uri);
    await client.connect();
    console.log("Connected to MongoDB Atlas");

    const db = client.db(dbName);
    const col = db.collection("teams");

    // 1. Fix Mixed Team Projects → purple
    const r1 = await col.updateOne(
        { name: "Mixed Team Projects" },
        { $set: {
            colors: { bg: "bg-purple-500/10", text: "text-purple-400", header: "bg-purple-500" },
            summary: "System-generated classification for actionables assigned to multiple teams.",
        }}
    );
    console.log("Mixed Team Projects → purple:", r1.modifiedCount);

    // 2. Remove stale test team
    const r2 = await col.deleteOne({ name: "TEAM TEST" });
    console.log("TEAM TEST deleted:", r2.deletedCount);

    // 3. Add summaries to all seeded teams
    const summaries = {
        "Policy": "Handles regulatory policy development and compliance documentation.",
        "Technology": "Manages technology infrastructure and system compliance.",
        "Operations": "Oversees operational processes and procedural compliance.",
        "Training": "Coordinates compliance training programs and certifications.",
        "Reporting": "Manages regulatory reporting and disclosure requirements.",
        "Customer Communication": "Handles customer-facing compliance communications.",
        "Governance": "Oversees corporate governance and board compliance.",
        "Legal": "Manages legal compliance and regulatory interpretation.",
        "Other": "General compliance items not assigned to a specific team.",
    };

    for (const [name, summary] of Object.entries(summaries)) {
        const r = await col.updateOne({ name }, { $set: { summary } });
        console.log(`  ${name}: ${r.modifiedCount ? "updated" : "no change / not found"}`);
    }

    // 4. Verify
    const teams = await col.find({}, { projection: { _id: 0, name: 1, summary: 1, colors: 1, is_system: 1 } }).sort({ order: 1 }).toArray();
    console.log("\nFinal teams in DB:");
    for (const t of teams) {
        const colorKey = t.colors?.header?.replace("bg-", "").replace("-500", "") || "?";
        console.log(`  ${t.is_system ? "[SYS]" : "     "} ${t.name} (${colorKey}) — ${t.summary || "(no summary)"}`);
    }
    console.log(`\nTotal: ${teams.length} teams`);

    await client.close();
    console.log("Done.");
}

migrate().catch(err => { console.error(err); process.exit(1); });
