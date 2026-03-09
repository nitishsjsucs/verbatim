const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Full System Reset - Working Version
 * 
 * Simplified email format (underscores only)
 * Direct MongoDB insertion with proper Better Auth schema
 */

const MONGO_URI = (process.env.MONGO_URI || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda").trim();
const BACKEND_DB = (process.env.BACKEND_DB_NAME || "govinda_v2").trim();
const AUTH_DB = (process.env.AUTH_DB_NAME || "govinda_auth").trim();

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

const SPECIAL_TEAMS = [
    { name: "Compliance", summary: "Compliance and regulatory affairs team", role: "compliance_officer", email: "compliance_officer" },
    { name: "Admin", summary: "Administrative and system management team", role: "admin", email: "admin" },
];

const OPERATIONAL_TEAMS = [
    { name: "Engineering", summary: "Engineering and technical development team" },
    { name: "Operations", summary: "Operations and process management team" },
    { name: "Finance", summary: "Finance and accounting team" }
];

async function hashPassword(password) {
    const bcrypt = require('bcryptjs');
    return await bcrypt.hash(password, 10);
}

async function fullSystemReset() {
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB\n');

        const backendDb = client.db(BACKEND_DB);
        const authDb = client.db(AUTH_DB);
        const teamsCol = backendDb.collection('teams');
        const actionablesCol = backendDb.collection('actionables');
        const userCol = authDb.collection('user');
        const accountCol = authDb.collection('account');
        const sessionCol = authDb.collection('session');

        // ========================================
        // STEP 1: DELETE ALL TEAMS
        // ========================================
        console.log('🗑️  STEP 1: Deleting all existing teams...');
        const deleteTeamsResult = await teamsCol.deleteMany({ is_system: { $ne: true } });
        console.log(`   Deleted ${deleteTeamsResult.deletedCount} teams\n`);

        // ========================================
        // STEP 2: CREATE NEW TEAM HIERARCHY
        // ========================================
        console.log('🏗️  STEP 2: Creating new team hierarchy...');
        let colorIndex = 0;
        const createdTeams = { l0: [], l1: [], l2: [] };

        // Create special teams
        for (const specialData of SPECIAL_TEAMS) {
            const l0Team = {
                name: specialData.name,
                is_system: false,
                colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                summary: specialData.summary,
                created_at: new Date().toISOString(),
                order: colorIndex + 1,
                parent_name: null,
                depth: 0,
                path: [],
            };
            await teamsCol.insertOne(l0Team);
            createdTeams.l0.push(l0Team.name);
            console.log(`   ✅ L0 (standalone): ${l0Team.name}`);
            colorIndex++;
        }

        // Create operational teams with L1/L2
        for (const l0Data of OPERATIONAL_TEAMS) {
            const l0Team = {
                name: l0Data.name,
                is_system: false,
                colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                summary: l0Data.summary,
                created_at: new Date().toISOString(),
                order: colorIndex + 1,
                parent_name: null,
                depth: 0,
                path: [],
            };
            await teamsCol.insertOne(l0Team);
            createdTeams.l0.push(l0Team.name);
            console.log(`   ✅ L0: ${l0Team.name}`);
            colorIndex++;

            for (let i = 1; i <= 2; i++) {
                const l1Name = `${l0Data.name}_Division_${i}`;
                const l1Team = {
                    name: l1Name,
                    is_system: false,
                    colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                    summary: `Division ${i} under ${l0Data.name}`,
                    created_at: new Date().toISOString(),
                    order: colorIndex + 1,
                    parent_name: l0Data.name,
                    depth: 1,
                    path: [l0Data.name],
                };
                await teamsCol.insertOne(l1Team);
                createdTeams.l1.push(l1Name);
                console.log(`      ✅ L1: ${l1Name}`);
                colorIndex++;

                for (let j = 1; j <= 2; j++) {
                    const l2Name = `${l1Name}_Unit_${j}`;
                    const l2Team = {
                        name: l2Name,
                        is_system: false,
                        colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                        summary: `Operational unit ${j} under ${l1Name}`,
                        created_at: new Date().toISOString(),
                        order: colorIndex + 1,
                        parent_name: l1Name,
                        depth: 2,
                        path: [l0Data.name, l1Name],
                    };
                    await teamsCol.insertOne(l2Team);
                    createdTeams.l2.push(l2Name);
                    console.log(`         ✅ L2: ${l2Name}`);
                    colorIndex++;
                }
            }
        }

        console.log(`\n   Summary: ${createdTeams.l0.length} L0, ${createdTeams.l1.length} L1, ${createdTeams.l2.length} L2 teams created\n`);

        // ========================================
        // STEP 3: DELETE ALL USERS & AUTH DATA
        // ========================================
        console.log('🗑️  STEP 3: Deleting all existing users...');
        await userCol.deleteMany({});
        await accountCol.deleteMany({});
        await sessionCol.deleteMany({});
        console.log(`   Deleted all users\n`);

        // ========================================
        // STEP 4: CREATE NEW USERS
        // ========================================
        console.log('👥 STEP 4: Creating new users with password "Govinda123"...');
        
        const passwordHash = await hashPassword('Govinda123');
        const usersToCreate = [];

        // Special teams
        for (const specialTeam of SPECIAL_TEAMS) {
            usersToCreate.push({
                name: `${specialTeam.name} ${specialTeam.role === 'compliance_officer' ? 'Officer' : 'Admin'}`,
                email: `${specialTeam.email}@redtech.com`,
                role: specialTeam.role,
                team: specialTeam.name,
            });
        }

        // Operational L0 Chiefs
        for (const l0Name of createdTeams.l0.filter(name => !['Compliance', 'Admin'].includes(name))) {
            usersToCreate.push({
                name: `${l0Name} Chief`,
                email: `${l0Name.toLowerCase()}_chief@redtech.com`,
                role: 'chief',
                team: l0Name,
            });
        }

        // L1 Chiefs
        for (const l1Name of createdTeams.l1) {
            usersToCreate.push({
                name: `${l1Name} Chief`,
                email: `${l1Name.toLowerCase()}_chief@redtech.com`,
                role: 'chief',
                team: l1Name,
            });
        }

        // L2 Members, Reviewers, Leads
        for (const l2Name of createdTeams.l2) {
            usersToCreate.push({
                name: `${l2Name} Member`,
                email: `${l2Name.toLowerCase()}_member@redtech.com`,
                role: 'team_member',
                team: l2Name,
            });
            usersToCreate.push({
                name: `${l2Name} Reviewer`,
                email: `${l2Name.toLowerCase()}_reviewer@redtech.com`,
                role: 'team_reviewer',
                team: l2Name,
            });
            usersToCreate.push({
                name: `${l2Name} Lead`,
                email: `${l2Name.toLowerCase()}_lead@redtech.com`,
                role: 'team_lead',
                team: l2Name,
            });
        }

        let createdCount = 0;
        for (const userData of usersToCreate) {
            try {
                const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                // Insert user
                await userCol.insertOne({
                    id: userId,
                    name: userData.name,
                    email: userData.email,
                    emailVerified: false,
                    image: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    role: userData.role,
                    team: userData.team,
                });

                // Insert account (Better Auth credential)
                await accountCol.insertOne({
                    id: `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    userId: userId,
                    accountId: userData.email,
                    providerId: 'email',
                    accessToken: null,
                    refreshToken: null,
                    idToken: null,
                    accessTokenExpiresAt: null,
                    refreshTokenExpiresAt: null,
                    scope: null,
                    password: passwordHash,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                createdCount++;
                console.log(`   ✅ ${userData.role.padEnd(18)} | ${userData.team.padEnd(35)} | ${userData.email}`);
            } catch (err) {
                console.log(`   ❌ Failed to create ${userData.email}: ${err.message}`);
            }
        }

        console.log(`\n   Summary: ${createdCount}/${usersToCreate.length} users created\n`);

        // ========================================
        // STEP 5: DELETE ALL ACTIONABLES
        // ========================================
        console.log('🗑️  STEP 5: Deleting all existing actionables...');
        const deleteActionablesResult = await actionablesCol.deleteMany({});
        console.log(`   Deleted ${deleteActionablesResult.deletedCount} actionable documents\n`);

        // ========================================
        // SUMMARY & CREDENTIALS
        // ========================================
        console.log('✅ FULL SYSTEM RESET COMPLETE!\n');
        console.log('Summary:');
        console.log(`   Teams: ${createdTeams.l0.length} L0, ${createdTeams.l1.length} L1, ${createdTeams.l2.length} L2`);
        console.log(`   Users: ${createdCount} created with password "Govinda123"`);
        console.log(`   Actionables: All deleted\n`);
        
        console.log('=== WORKING CREDENTIALS (Password: Govinda123) ===\n');
        
        // Get all created users for credential list
        const allUsers = await userCol.find({}).toArray();
        const byRole = {};
        for (const u of allUsers) {
            if (!byRole[u.role]) byRole[u.role] = [];
            byRole[u.role].push(u);
        }

        for (const [role, users] of Object.entries(byRole).sort()) {
            console.log(`\n${role.toUpperCase()} (${users.length} users):`);
            for (const u of users.sort((a, b) => a.email.localeCompare(b.email))) {
                console.log(`  ${u.email}`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\n🔌 Connection closed');
    }
}

fullSystemReset();
