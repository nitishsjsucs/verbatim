import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { MongoClient } from "mongodb"

/**
 * POST /api/seed
 *
 * Creates pre-defined accounts for the compliance officer and team members.
 * This should be called ONCE after initial deployment.
 *
 * Protected by a seed secret to prevent abuse.
 * Set SEED_SECRET env var, then call:
 *   curl -X POST https://your-app.vercel.app/api/seed \
 *     -H "Content-Type: application/json" \
 *     -d '{"secret":"your-seed-secret"}'
 */

const SEED_SECRET = process.env.SEED_SECRET || "govinda-seed-2024"

interface SeedUser {
    name: string
    email: string
    password: string
    role: string
    team: string
    forcePasswordReset?: boolean
}

// Dynamic team user seeding logic
const ADMIN_USER: SeedUser = {
    name: "Admin",
    email: "admin@govinda.com",
    password: "Govinda@2026",
    role: "admin",
    team: ""
};

<<<<<<< HEAD
const COMPLIANCE_OFFICER_USER: SeedUser = {
    name: "Compliance Officer",
    email: "compliance@govinda.com",
    password: "Govinda@2026",
    role: "compliance_officer",
    team: ""
};
=======
// Team Lead users — oversight role, one per team
const TEAM_LEAD_USERS: SeedUser[] = [
    {
        name: "Policy Lead",
        email: "policy.lead@regtech.com",
        password: "PolicyLead2024!",
        role: "team_lead",
        team: "Policy",
    },
    {
        name: "Technology Lead",
        email: "technology.lead@regtech.com",
        password: "TechLead2024!",
        role: "team_lead",
        team: "Technology",
    },
    {
        name: "Operations Lead",
        email: "operations.lead@regtech.com",
        password: "OpsLead2024!",
        role: "team_lead",
        team: "Operations",
    },
    {
        name: "Training Lead",
        email: "training.lead@regtech.com",
        password: "TrainLead2024!",
        role: "team_lead",
        team: "Training",
    },
    {
        name: "Reporting Lead",
        email: "reporting.lead@regtech.com",
        password: "ReportLead2024!",
        role: "team_lead",
        team: "Reporting",
    },
    {
        name: "Customer Communication Lead",
        email: "customer_communication.lead@regtech.com",
        password: "CustCommLead2024!",
        role: "team_lead",
        team: "Customer Communication",
    },
    {
        name: "Governance Lead",
        email: "governance.lead@regtech.com",
        password: "GovLead2024!",
        role: "team_lead",
        team: "Governance",
    },
    {
        name: "Legal Lead",
        email: "legal.lead@regtech.com",
        password: "LegalLead2024!",
        role: "team_lead",
        team: "Legal",
    },
]

const SEED_USERS: SeedUser[] = [
    // ── Compliance Officer ──
    {
        name: "Nitish (Compliance Officer)",
        email: "compliance@regtech.com",
        password: "Compliance2024!",
        role: "compliance_officer",
        team: "",
    },
>>>>>>> 5860cc5ef9a87de0fb9e6727d22dd9bb4f22edb5

// List of teams (from previous hardcoded teams)
const TEAMS = [
    "Policy",
    "Technology",
    "Operations",
    "Training",
    "Reporting",
    "Customer Communication",
    "Governance",
    "Legal"
];


const TEAM_USERS: SeedUser[] = [];
for (const team of TEAMS) {
    TEAM_USERS.push(
        {
            name: `${team} Lead`,
            email: `${team.toLowerCase().replace(/\s+/g, '_')}.lead@govinda.com`,
            password: "Govinda@2026",
            role: "team_lead",
            team
        },
        {
            name: `${team} Reviewer`,
            email: `${team.toLowerCase().replace(/\s+/g, '_')}.reviewer@govinda.com`,
            password: "Govinda@2026",
            role: "team_reviewer",
            team
        },
        {
            name: `${team} Member`,
            email: `${team.toLowerCase().replace(/\s+/g, '_')}.member@govinda.com`,
            password: "Govinda@2026",
            role: "team_member",
            team
        }
    );
}

const SEED_USERS: SeedUser[] = [ADMIN_USER, COMPLIANCE_OFFICER_USER, ...TEAM_USERS];

export async function POST(req: Request) {
    try {
        const body = await req.json()
        if (body.secret !== SEED_SECRET) {
            return NextResponse.json({ error: "Invalid seed secret" }, { status: 403 })
        }

        // Connect to MongoDB directly to set role + team after user creation
        const mongoClient = new MongoClient(process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017")
        const db = mongoClient.db(process.env.MONGO_DB_NAME || process.env.AUTH_DB_NAME || "govinda_auth")
        const userCollection = db.collection("user")

        const results: { email: string; status: string; error?: string }[] = []

<<<<<<< HEAD
        // Only seed admin, compliance officer, and one lead/executor/checker per team
        const allUsers = SEED_USERS;
=======
        // Combine all users: compliance officer, team members, team reviewers, and team leads
        const allUsers = [...SEED_USERS, ...TEAM_REVIEWER_USERS, ...TEAM_LEAD_USERS]
>>>>>>> 5860cc5ef9a87de0fb9e6727d22dd9bb4f22edb5

        for (const user of allUsers) {
            try {
                // Check if user already exists
                const existing = await userCollection.findOne({ email: user.email })
                if (existing) {
                    // Update role and team only (no forcePasswordReset)
                    await userCollection.updateOne(
                        { email: user.email },
                        { $set: { role: user.role, team: user.team } }
                    )
                    results.push({ email: user.email, status: "already_exists (role/team updated)" })
                    continue
                }

                // Create user via Better Auth's internal API
                await auth.api.signUpEmail({
                    body: {
                        email: user.email,
                        password: user.password,
                        name: user.name,
                    },
                })

                // Set role and team only (no forcePasswordReset) directly in MongoDB
                await userCollection.updateOne(
                    { email: user.email },
                    { $set: { role: user.role, team: user.team } }
                )

                results.push({ email: user.email, status: "created" })
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                if (msg.includes("already") || msg.includes("exists") || msg.includes("duplicate")) {
                    // Still try to update role/team/forcePasswordReset
                    try {
                        await userCollection.updateOne(
                            { email: user.email },
                            { $set: { role: user.role, team: user.team, forcePasswordReset: user.forcePasswordReset || false } }
                        )
                    } catch { /* ignore */ }
                    results.push({ email: user.email, status: "already_exists" })
                } else {
                    results.push({ email: user.email, status: "error", error: msg })
                }
            }
        }

        await mongoClient.close()

        return NextResponse.json({
            message: "Seed completed",
            results,
        })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Seed failed" },
            { status: 500 }
        )
    }
}
