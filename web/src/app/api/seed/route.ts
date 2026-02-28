import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { MongoClient } from "mongodb"
import crypto from "crypto"

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

// Generate a secure random password
function generateSecurePassword(length: number = 16): string {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
    const randomBytes = crypto.randomBytes(length)
    let password = ""
    for (let i = 0; i < length; i++) {
        password += charset[randomBytes[i] % charset.length]
    }
    // Ensure at least one of each type
    const lower = "abcdefghijklmnopqrstuvwxyz"
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    const digits = "0123456789"
    const special = "!@#$%^&*"
    password = password.slice(0, -4) +
        lower[crypto.randomInt(lower.length)] +
        upper[crypto.randomInt(upper.length)] +
        digits[crypto.randomInt(digits.length)] +
        special[crypto.randomInt(special.length)]
    return password
}

// All teams in the system
const TEAMS = [
    "Policy",
    "Technology",
    "Operations",
    "Training",
    "Reporting",
    "Customer Communication",
    "Governance",
    "Legal",
]

// Generate Team Reviewer users dynamically
function generateTeamReviewers(): { users: SeedUser[]; credentials: { team: string; username: string; email: string; password: string }[] } {
    const users: SeedUser[] = []
    const credentials: { team: string; username: string; email: string; password: string }[] = []

    for (const team of TEAMS) {
        const teamSlug = team.toLowerCase().replace(/\s+/g, "_")
        const password = generateSecurePassword()
        const email = `${teamSlug}.reviewer@regtech.com`
        const name = `${team} Reviewer`

        users.push({
            name,
            email,
            password,
            role: "team_reviewer",
            team,
            forcePasswordReset: true,
        })

        credentials.push({
            team,
            username: `${teamSlug}_reviewer`,
            email,
            password,
        })
    }

    return { users, credentials }
}

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

        // Generate Team Reviewer users and credentials
        const { users: teamReviewerUsers, credentials: reviewerCredentials } = generateTeamReviewers()
        const allUsers = [...SEED_USERS, ...teamReviewerUsers]

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
            teamReviewerCredentials: reviewerCredentials,
        })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Seed failed" },
            { status: 500 }
        )
    }
}
