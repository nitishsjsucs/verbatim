const { MongoClient } = require('./web/node_modules/mongodb');

/**
 * Full System Reset Script (Corrected)
 * 
 * Performs complete reset of teams, users, and actionables:
 * 1. Deletes all teams (except system teams)
 * 2. Creates new team hierarchy:
 *    - 1 Compliance team (L0, no sub-teams)
 *    - 1 Admin team (L0, no sub-teams)
 *    - 3 L0 teams with full L1/L2 hierarchy (each: 2 L1, 4 L2)
 * 3. Deletes all users
 * 4. Creates new users with role structure and password "Govinda123"
 * 5. Deletes all actionables
 * 
 * Final structure:
 * - 5 L0 teams (Compliance, Admin, + 3 operational)
 * - 6 L1 teams (2 under each of 3 operational L0 teams)
 * - 12 L2 teams (2 under each L1 team)
 * - 45 users total
 * 
 * Usage:
 *   node full-system-reset-corrected.js
 */

const DEFAULT_URI = process.env.MONGO_URI
    || process.env.MONGODB_URI
    || "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const BACKEND_DB = process.env.BACKEND_DB_NAME || "govinda_v2";
const AUTH_DB = process.env.AUTH_DB_NAME || "govinda_auth";

// Color palette for teams
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

// Special teams (no sub-teams)
const SPECIAL_TEAMS = [
    {
        name: "Compliance",
        summary: "Compliance and regulatory affairs team",
        hasSubTeams: false,
        role: "compliance_officer",
        userTitle: "Compliance Officer",
        emailHandle: "compliance.officer",
    },
    {
        name: "Admin",
        summary: "Administrative and system management team",
        hasSubTeams: false,
        role: "admin",
        userTitle: "Admin",
        emailHandle: "admin",
    },
];

// Operational teams (with L1/L2 hierarchy)
const OPERATIONAL_TEAMS = [
    { name: "Engineering", summary: "Engineering and technical development team" },
    { name: "Operations", summary: "Operations and process management team" },
    { name: "Finance", summary: "Finance and accounting team" }
];

async function fullSystemReset() {
    const uri = DEFAULT_URI;
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log('✅ Connected to MongoDB Atlas\n');

        const backendDb = client.db(BACKEND_DB);
        const authDb = client.db(AUTH_DB);
        const teamsCol = backendDb.collection('teams');
        const actionablesCol = backendDb.collection('actionables');
        const userCol = authDb.collection('user');
        const sessionCol = authDb.collection('session');
        const accountCol = authDb.collection('account');

        // ========================================
        // STEP 1: DELETE ALL TEAMS (except system)
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

        // Create special teams (Compliance, Admin) - no sub-teams
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

        // Create operational teams with L1/L2 hierarchy
        for (const l0Data of OPERATIONAL_TEAMS) {
            // Create L0 team
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

            // Create 2 L1 teams under this L0
            for (let i = 1; i <= 2; i++) {
                const l1Name = `${l0Data.name} - Division ${i}`;
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

                // Create 2 L2 teams under this L1
                for (let j = 1; j <= 2; j++) {
                    const l2Name = `${l1Name} - Unit ${j}`;
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
        // STEP 3: DELETE ALL USERS
        // ========================================
        console.log('🗑️  STEP 3: Deleting all existing users...');
        const deleteUsersResult = await userCol.deleteMany({});
        await sessionCol.deleteMany({});
        await accountCol.deleteMany({});
        console.log(`   Deleted ${deleteUsersResult.deletedCount} users\n`);

        // ========================================
        // STEP 4: CREATE NEW USERS
        // ========================================
        console.log('👥 STEP 4: Creating new users with password "Govinda123"...');
        
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash('Govinda123', 10);
        
        const usersToCreate = [];

        // Special teams (Compliance, Admin) with their predefined roles
        for (const specialTeam of SPECIAL_TEAMS) {
            const role = specialTeam.role || 'chief';
            const title = specialTeam.userTitle || (role === 'chief' ? 'Chief' : role.replace(/_/g, ' '));
            const emailHandle = specialTeam.emailHandle
                || `${specialTeam.name.toLowerCase().replace(/\s+/g, '.')}.${role.replace(/_/g, '.')}`;
            usersToCreate.push({
                name: `${specialTeam.name} ${title}`.trim(),
                email: `${emailHandle}@redtech.com`,
                role,
                team: specialTeam.name,
            });
        }

        // Operational L0 Chiefs (1 per operational L0)
        for (const l0Name of createdTeams.l0.filter(name => !['Compliance', 'Admin'].includes(name))) {
            usersToCreate.push({
                name: `${l0Name} Chief`,
                email: `${l0Name.toLowerCase().replace(/\s+/g, '.')}.chief@redtech.com`,
                role: 'chief',
                team: l0Name,
            });
        }

        // L1 Chiefs (1 per L1)
        for (const l1Name of createdTeams.l1) {
            usersToCreate.push({
                name: `${l1Name} Chief`,
                email: `${l1Name.toLowerCase().replace(/\s+/g, '.')}.chief@redtech.com`,
                role: 'chief',
                team: l1Name,
            });
        }

        // L2 Members, Reviewers, Leads (3 per L2)
        for (const l2Name of createdTeams.l2) {
            usersToCreate.push({
                name: `${l2Name} Member`,
                email: `${l2Name.toLowerCase().replace(/\s+/g, '.')}.member@redtech.com`,
                role: 'team_member',
                team: l2Name,
            });
            usersToCreate.push({
                name: `${l2Name} Reviewer`,
                email: `${l2Name.toLowerCase().replace(/\s+/g, '.')}.reviewer@redtech.com`,
                role: 'team_reviewer',
                team: l2Name,
            });
            usersToCreate.push({
                name: `${l2Name} Lead`,
                email: `${l2Name.toLowerCase().replace(/\s+/g, '.')}.lead@redtech.com`,
                role: 'team_lead',
                team: l2Name,
            });
        }

        // Create users directly in MongoDB with hashed passwords
        let createdCount = 0;
        for (const userData of usersToCreate) {
            try {
                const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const userDoc = {
                    id: userId,
                    name: userData.name,
                    email: userData.email,
                    emailVerified: false,
                    image: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    role: userData.role,
                    team: userData.team,
                };

                await userCol.insertOne(userDoc);

                // Create account entry for email/password auth
                await accountCol.insertOne({
                    id: `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    userId: userId,
                    accountId: userData.email,
                    providerId: 'credential',
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
                console.log(`   ✅ ${userData.role.padEnd(15)} | ${userData.team.padEnd(40)} | ${userData.name}`);
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
        // SUMMARY
        // ========================================
        console.log('✅ FULL SYSTEM RESET COMPLETE!\n');
        console.log('Summary:');
        console.log(`   Teams: ${createdTeams.l0.length} L0 (2 standalone + 3 with hierarchy), ${createdTeams.l1.length} L1, ${createdTeams.l2.length} L2`);
        console.log(`   Users: ${createdCount} created with password "Govinda123"`);
        console.log(`   Actionables: All deleted (will be recreated via document processing)`);
        console.log('\nTeam Structure:');
        console.log(`   Standalone L0: Compliance (1 Compliance Officer), Admin (1 Admin role)`);
        console.log(`   Operational L0: Engineering, Operations, Finance (1 Chief each)`);
        console.log(`   L1 Teams: 6 (2 under each operational L0)`);
        console.log(`   L2 Teams: 12 (2 under each L1)`);
        console.log('\nRole Distribution:');
        console.log(`   Compliance Officer: 1 (Compliance L0)`);
        console.log(`   Admin: 1 (Admin L0)`);
        console.log(`   Chief: ${3 + createdTeams.l1.length} (3 operational L0 + ${createdTeams.l1.length} L1)`);
        console.log(`   Member: ${createdTeams.l2.length} (L2)`);
        console.log(`   Reviewer: ${createdTeams.l2.length} (L2)`);
        console.log(`   Lead: ${createdTeams.l2.length} (L2)`);

    } catch (error) {
        console.error('❌ Error:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\n🔌 Connection closed');
    }
}

fullSystemReset();
