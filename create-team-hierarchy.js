const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Team Hierarchy Builder
 * 
 * Creates L1 and L2 sub-teams for each existing team programmatically:
 * - For each existing team (L0), creates 2 L1 sub-teams
 * - For each L1 sub-team, creates 2 L2 sub-teams
 * - Total: Each L0 team gets 2 L1 teams and 4 L2 teams (2 under each L1)
 * 
 * Usage:
 *   MONGO_URI=<uri> MONGO_DB=<db> node create-team-hierarchy.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const DEFAULT_DB = process.env.MONGO_DB || process.env.BACKEND_DB_NAME || "govinda_v2";

// Color palette for new teams
const COLOR_PALETTE = [
    { header: "bg-cyan-500", bg: "bg-cyan-500/10", text: "text-cyan-500" },
    { header: "bg-blue-500", bg: "bg-blue-500/10", text: "text-blue-500" },
    { header: "bg-purple-500", bg: "bg-purple-500/10", text: "text-purple-500" },
    { header: "bg-pink-500", bg: "bg-pink-500/10", text: "text-pink-500" },
    { header: "bg-red-500", bg: "bg-red-500/10", text: "text-red-500" },
    { header: "bg-orange-500", bg: "bg-orange-500/10", text: "text-orange-500" },
    { header: "bg-amber-500", bg: "bg-amber-500/10", text: "text-amber-500" },
    { header: "bg-yellow-500", bg: "bg-yellow-500/10", text: "text-yellow-500" },
    { header: "bg-lime-500", bg: "bg-lime-500/10", text: "text-lime-500" },
    { header: "bg-green-500", bg: "bg-green-500/10", text: "text-green-500" },
    { header: "bg-emerald-500", bg: "bg-emerald-500/10", text: "text-emerald-500" },
    { header: "bg-teal-500", bg: "bg-teal-500/10", text: "text-teal-500" },
];

async function createTeamHierarchy() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('Connected to MongoDB Atlas');

        const db = client.db(DEFAULT_DB);
        const teamsCol = db.collection('teams');

        // Get all existing root-level teams (depth 0, non-system)
        const rootTeams = await teamsCol.find({
            depth: { $in: [0, null] },
            is_system: { $ne: true }
        }).toArray();

        console.log(`\nFound ${rootTeams.length} root-level teams to expand`);

        let l1Created = 0;
        let l2Created = 0;
        let colorIndex = 0;

        for (const rootTeam of rootTeams) {
            console.log(`\n📁 Processing: ${rootTeam.name}`);

            // Create 2 L1 sub-teams
            for (let i = 1; i <= 2; i++) {
                const l1Name = `${rootTeam.name} - L1-${i}`;
                
                // Check if L1 already exists
                const existingL1 = await teamsCol.findOne({ name: l1Name });
                if (existingL1) {
                    console.log(`  ⏭️  L1 already exists: ${l1Name}`);
                    
                    // Still create L2 teams under this L1
                    for (let j = 1; j <= 2; j++) {
                        const l2Name = `${l1Name} - L2-${j}`;
                        const existingL2 = await teamsCol.findOne({ name: l2Name });
                        
                        if (!existingL2) {
                            const l2Colors = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
                            colorIndex++;

                            const l2Team = {
                                name: l2Name,
                                is_system: false,
                                colors: l2Colors,
                                summary: `Level 2 operational team under ${l1Name}`,
                                created_at: new Date().toISOString(),
                                order: await teamsCol.countDocuments({ is_system: { $ne: true } }) + 1,
                                parent_name: l1Name,
                                depth: 2,
                                path: [rootTeam.name, l1Name],
                            };

                            await teamsCol.insertOne(l2Team);
                            l2Created++;
                            console.log(`    ✅ Created L2: ${l2Name}`);
                        } else {
                            console.log(`    ⏭️  L2 already exists: ${l2Name}`);
                        }
                    }
                    continue;
                }

                const l1Colors = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
                colorIndex++;

                const l1Team = {
                    name: l1Name,
                    is_system: false,
                    colors: l1Colors,
                    summary: `Level 1 division under ${rootTeam.name}`,
                    created_at: new Date().toISOString(),
                    order: await teamsCol.countDocuments({ is_system: { $ne: true } }) + 1,
                    parent_name: rootTeam.name,
                    depth: 1,
                    path: [rootTeam.name],
                };

                await teamsCol.insertOne(l1Team);
                l1Created++;
                console.log(`  ✅ Created L1: ${l1Name}`);

                // Create 2 L2 sub-teams under this L1
                for (let j = 1; j <= 2; j++) {
                    const l2Name = `${l1Name} - L2-${j}`;
                    
                    const l2Colors = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
                    colorIndex++;

                    const l2Team = {
                        name: l2Name,
                        is_system: false,
                        colors: l2Colors,
                        summary: `Level 2 operational team under ${l1Name}`,
                        created_at: new Date().toISOString(),
                        order: await teamsCol.countDocuments({ is_system: { $ne: true } }) + 1,
                        parent_name: l1Name,
                        depth: 2,
                        path: [rootTeam.name, l1Name],
                    };

                    await teamsCol.insertOne(l2Team);
                    l2Created++;
                    console.log(`    ✅ Created L2: ${l2Name}`);
                }
            }
        }

        console.log(`\n✅ Team hierarchy creation complete!`);
        console.log(`   Root teams processed: ${rootTeams.length}`);
        console.log(`   L1 teams created: ${l1Created}`);
        console.log(`   L2 teams created: ${l2Created}`);
        console.log(`   Total new teams: ${l1Created + l2Created}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

createTeamHierarchy();
