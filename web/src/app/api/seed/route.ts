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

// Team Reviewer users with hardcoded passwords
const TEAM_REVIEWER_USERS: SeedUser[] = [
    {
        name: "Policy Reviewer",
        email: "policy.reviewer@regtech.com",
        password: "PolicyReview2024!",
        role: "team_reviewer",
        team: "Policy",
        forcePasswordReset: true,
    },
    {
        name: "Technology Reviewer",
        email: "technology.reviewer@regtech.com",
        password: "TechReview2024!",
        role: "team_reviewer",
        team: "Technology",
        forcePasswordReset: true,
    },
    {
        name: "Operations Reviewer",
        email: "operations.reviewer@regtech.com",
        password: "OpsReview2024!",
        role: "team_reviewer",
        team: "Operations",
        forcePasswordReset: true,
    },
    {
        name: "Training Reviewer",
        email: "training.reviewer@regtech.com",
        password: "TrainReview2024!",
        role: "team_reviewer",
        team: "Training",
        forcePasswordReset: true,
    },
    {
        name: "Reporting Reviewer",
        email: "reporting.reviewer@regtech.com",
        password: "ReportReview2024!",
        role: "team_reviewer",
        team: "Reporting",
        forcePasswordReset: true,
    },
    {
        name: "Customer Communication Reviewer",
        email: "customer_communication.reviewer@regtech.com",
        password: "CustCommReview2024!",
        role: "team_reviewer",
        team: "Customer Communication",
        forcePasswordReset: true,
    },
    {
        name: "Governance Reviewer",
        email: "governance.reviewer@regtech.com",
        password: "GovReview2024!",
        role: "team_reviewer",
        team: "Governance",
        forcePasswordReset: true,
    },
    {
        name: "Legal Reviewer",
        email: "legal.reviewer@regtech.com",
        password: "LegalReview2024!",
        role: "team_reviewer",
        team: "Legal",
        forcePasswordReset: true,
    },
]

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

    // ── Policy Team ──
    {
        name: "Arun Kumar",
        email: "arun@regtech.com",
        password: "Policy2024!",
        role: "team_member",
        team: "Policy",
    },
    {
        name: "Priya Sharma",
        email: "priya@regtech.com",
        password: "Policy2024!",
        role: "team_member",
        team: "Policy",
    },

    // ── Technology Team ──
    {
        name: "Rahul Patel",
        email: "rahul@regtech.com",
        password: "Technology2024!",
        role: "team_member",
        team: "Technology",
    },
    {
        name: "Sneha Gupta",
        email: "sneha@regtech.com",
        password: "Technology2024!",
        role: "team_member",
        team: "Technology",
    },

    // ── Operations Team ──
    {
        name: "Vikram Singh",
        email: "vikram@regtech.com",
        password: "Operations2024!",
        role: "team_member",
        team: "Operations",
    },
    {
        name: "Meera Joshi",
        email: "meera@regtech.com",
        password: "Operations2024!",
        role: "team_member",
        team: "Operations",
    },

    // ── Training Team ──
    {
        name: "Anita Desai",
        email: "anita@regtech.com",
        password: "Training2024!",
        role: "team_member",
        team: "Training",
    },

    // ── Reporting Team ──
    {
        name: "Suresh Nair",
        email: "suresh@regtech.com",
        password: "Reporting2024!",
        role: "team_member",
        team: "Reporting",
    },

    // ── Customer Communication Team ──
    {
        name: "Kavita Menon",
        email: "kavita@regtech.com",
        password: "CustComm2024!",
        role: "team_member",
        team: "Customer Communication",
    },

    // ── Governance Team ──
    {
        name: "Rajesh Iyer",
        email: "rajesh@regtech.com",
        password: "Governance2024!",
        role: "team_member",
        team: "Governance",
    },

    // ── Legal Team ──
    {
        name: "Deepa Reddy",
        email: "deepa@regtech.com",
        password: "Legal2024!",
        role: "team_member",
        team: "Legal",
    },
]

export async function POST(req: Request) {
    try {
        const body = await req.json()
        if (body.secret !== SEED_SECRET) {
            return NextResponse.json({ error: "Invalid seed secret" }, { status: 403 })
        }

        // Connect to MongoDB directly to set role + team after user creation
        const mongoClient = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017")
        const db = mongoClient.db(process.env.AUTH_DB_NAME || "govinda_auth")
        const userCollection = db.collection("user")

        const results: { email: string; status: string; error?: string }[] = []

        // Combine all users: compliance officer, team members, team reviewers, and team leads
        const allUsers = [...SEED_USERS, ...TEAM_REVIEWER_USERS, ...TEAM_LEAD_USERS]

        for (const user of allUsers) {
            try {
                // Check if user already exists
                const existing = await userCollection.findOne({ email: user.email })
                if (existing) {
                    // Update role, team, and forcePasswordReset if they differ
                    await userCollection.updateOne(
                        { email: user.email },
                        { $set: { role: user.role, team: user.team, forcePasswordReset: user.forcePasswordReset || false } }
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

                // Set role, team, and forcePasswordReset directly in MongoDB
                await userCollection.updateOne(
                    { email: user.email },
                    { $set: { role: user.role, team: user.team, forcePasswordReset: user.forcePasswordReset || false } }
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
