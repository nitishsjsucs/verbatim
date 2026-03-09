const { MongoClient } = require('./web/node_modules/mongodb');
const fetch = require('node-fetch');

/**
 * Full System Reset — Uses Better Auth's signUpEmail API
 * 
 * ROOT CAUSE OF LOGIN FAILURES:
 * - Direct MongoDB insertion creates user docs with custom `id` field,
 *   but Better Auth expects `_id` (MongoDB ObjectId) as the user identifier.
 * - Direct insertion uses providerId: "email", but Better Auth uses "credential".
 * - Direct insertion uses bcrypt hashes, but Better Auth uses its own hasher.
 * 
 * FIX: Create users through Better Auth's own signUpEmail, then patch role/team.
 */

const MONGO_URI = "mongodb+srv://nitishsancs_db_user:<ROTATED_CREDENTIAL_REMOVED>@govinda.mdyhulj.mongodb.net/?appName=govinda";
const BACKEND_DB = "govinda_v2";
const AUTH_DB = "govinda_auth";
const API_BASE = "http://localhost:3000";
const DEFAULT_PASSWORD = "RedTech@2026";

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
    { name: "Compliance", summary: "Compliance and regulatory affairs team", role: "compliance_officer" },
    { name: "Admin", summary: "Administrative and system management team", role: "admin" },
];

const OPERATIONAL_TEAMS = [
    { name: "Engineering", summary: "Engineering and technical development team" },
    { name: "Operations", summary: "Operations and process management team" },
    { name: "Finance", summary: "Finance and accounting team" }
];

async function createUserViaAPI(name, role, team) {
    const res = await fetch(`${API_BASE}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, team })
    });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

async function fullSystemReset() {
    const client = new MongoClient(MONGO_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB\n');

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
        console.log('STEP 1: Deleting all existing teams...');
        const deleteTeamsResult = await teamsCol.deleteMany({ is_system: { $ne: true } });
        console.log(`   Deleted ${deleteTeamsResult.deletedCount} teams\n`);

        // ========================================
        // STEP 2: CREATE NEW TEAM HIERARCHY
        // ========================================
        console.log('STEP 2: Creating new team hierarchy...');
        let colorIndex = 0;
        const createdTeams = { l0: [], l1: [], l2: [] };

        for (const specialData of SPECIAL_TEAMS) {
            await teamsCol.insertOne({
                name: specialData.name,
                is_system: false,
                colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                summary: specialData.summary,
                created_at: new Date().toISOString(),
                order: colorIndex + 1,
                parent_name: null,
                depth: 0,
                path: [],
            });
            createdTeams.l0.push(specialData.name);
            console.log(`   L0 (standalone): ${specialData.name}`);
            colorIndex++;
        }

        for (const l0Data of OPERATIONAL_TEAMS) {
            await teamsCol.insertOne({
                name: l0Data.name,
                is_system: false,
                colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                summary: l0Data.summary,
                created_at: new Date().toISOString(),
                order: colorIndex + 1,
                parent_name: null,
                depth: 0,
                path: [],
            });
            createdTeams.l0.push(l0Data.name);
            console.log(`   L0: ${l0Data.name}`);
            colorIndex++;

            for (let i = 1; i <= 2; i++) {
                const l1Name = `${l0Data.name} Division ${i}`;
                await teamsCol.insertOne({
                    name: l1Name,
                    is_system: false,
                    colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                    summary: `Division ${i} under ${l0Data.name}`,
                    created_at: new Date().toISOString(),
                    order: colorIndex + 1,
                    parent_name: l0Data.name,
                    depth: 1,
                    path: [l0Data.name],
                });
                createdTeams.l1.push(l1Name);
                console.log(`      L1: ${l1Name}`);
                colorIndex++;

                for (let j = 1; j <= 2; j++) {
                    const l2Name = `${l1Name} Unit ${j}`;
                    await teamsCol.insertOne({
                        name: l2Name,
                        is_system: false,
                        colors: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
                        summary: `Operational unit ${j} under ${l1Name}`,
                        created_at: new Date().toISOString(),
                        order: colorIndex + 1,
                        parent_name: l1Name,
                        depth: 2,
                        path: [l0Data.name, l1Name],
                    });
                    createdTeams.l2.push(l2Name);
                    console.log(`         L2: ${l2Name}`);
                    colorIndex++;
                }
            }
        }

        console.log(`\n   Summary: ${createdTeams.l0.length} L0, ${createdTeams.l1.length} L1, ${createdTeams.l2.length} L2 teams\n`);

        // ========================================
        // STEP 3: DELETE ALL USERS & AUTH DATA
        // ========================================
        console.log('STEP 3: Deleting all existing users, accounts, sessions...');
        await userCol.deleteMany({});
        await accountCol.deleteMany({});
        await sessionCol.deleteMany({});
        console.log('   All auth data cleared\n');

        // ========================================
        // STEP 4: CREATE USERS VIA BETTER AUTH API
        // ========================================
        console.log('STEP 4: Creating users via Better Auth API...');
        console.log(`   Default password for all users: ${DEFAULT_PASSWORD}\n`);

        const usersToCreate = [];

        // Special teams (Compliance, Admin)
        for (const st of SPECIAL_TEAMS) {
            usersToCreate.push({ name: `${st.name} Officer`, role: st.role, team: st.name });
        }

        // Operational L0 Chiefs
        for (const opTeam of OPERATIONAL_TEAMS) {
            usersToCreate.push({ name: `${opTeam.name} Chief`, role: 'chief', team: opTeam.name });
        }

        // L1 Chiefs
        for (const l1Name of createdTeams.l1) {
            usersToCreate.push({ name: `${l1Name} Chief`, role: 'chief', team: l1Name });
        }

        // L2 Members, Reviewers, Leads
        for (const l2Name of createdTeams.l2) {
            usersToCreate.push({ name: `${l2Name} Member`, role: 'team_member', team: l2Name });
            usersToCreate.push({ name: `${l2Name} Reviewer`, role: 'team_reviewer', team: l2Name });
            usersToCreate.push({ name: `${l2Name} Lead`, role: 'team_lead', team: l2Name });
        }

        const createdUsers = [];
        let successCount = 0;
        let failCount = 0;

        for (const userData of usersToCreate) {
            try {
                const result = await createUserViaAPI(userData.name, userData.role, userData.team);
                successCount++;
                createdUsers.push({
                    team: userData.team,
                    role: userData.role,
                    email: result.generated_email,
                    password: DEFAULT_PASSWORD,
                });
                console.log(`   OK ${userData.role.padEnd(20)} | ${userData.team.padEnd(35)} | ${result.generated_email}`);
            } catch (err) {
                failCount++;
                console.log(`   FAIL ${userData.role.padEnd(18)} | ${userData.team.padEnd(35)} | ${err.message}`);
            }
        }

        console.log(`\n   Created: ${successCount}, Failed: ${failCount}\n`);

        // ========================================
        // STEP 5: DELETE ALL ACTIONABLES
        // ========================================
        console.log('STEP 5: Deleting all actionables...');
        const deleteActionablesResult = await actionablesCol.deleteMany({});
        console.log(`   Deleted ${deleteActionablesResult.deletedCount} actionables\n`);

        // ========================================
        // SUMMARY
        // ========================================
        console.log('=' .repeat(60));
        console.log('FULL SYSTEM RESET COMPLETE');
        console.log('=' .repeat(60));
        console.log(`\nTeams: ${createdTeams.l0.length} L0, ${createdTeams.l1.length} L1, ${createdTeams.l2.length} L2`);
        console.log(`Users: ${successCount} created via Better Auth API`);
        console.log(`Password: ${DEFAULT_PASSWORD} (for all users)\n`);

        console.log('CREDENTIAL TABLE:');
        console.log('-'.repeat(100));
        console.log(`${'Team'.padEnd(35)} | ${'Role'.padEnd(20)} | Email`);
        console.log('-'.repeat(100));
        for (const u of createdUsers) {
            console.log(`${u.team.padEnd(35)} | ${u.role.padEnd(20)} | ${u.email}`);
        }
        console.log('-'.repeat(100));

    } catch (error) {
        console.error('ERROR:', error);
        throw error;
    } finally {
        await client.close();
        console.log('\nConnection closed');
    }
}

fullSystemReset();
