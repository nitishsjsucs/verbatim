const { MongoClient } = require('./web/node_modules/mongodb');

const uri = process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";

async function checkUsers() {
    const client = new MongoClient(uri);
    await client.connect();

    // Check both possible auth DBs
    for (const dbName of ["govinda_auth", "govinda_v2"]) {
        const db = client.db(dbName);
        const cols = (await db.listCollections().toArray()).map(c => c.name);
        if (cols.includes("user")) {
            const users = await db.collection("user").find({}, { projection: { _id: 0, name: 1, email: 1, role: 1, team: 1 } }).toArray();
            console.log(`\n=== ${dbName}.user (${users.length} users) ===`);
            for (const u of users) {
                console.log(`  ${u.role || "?"} | ${u.team || "-"} | ${u.name} | ${u.email}`);
            }
        } else {
            console.log(`\n=== ${dbName}: no 'user' collection ===`);
        }
    }

    await client.close();
}

checkUsers().catch(err => { console.error(err); process.exit(1); });
