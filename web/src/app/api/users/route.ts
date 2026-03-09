import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { MongoClient } from "mongodb"

/**
 * User Management API
 *
 * GET  /api/users          — List all users
 * POST /api/users          — Create a new user (auto-generates email + default password)
 * PUT  /api/users          — Update user (role, team, name, start_date)
 * DELETE /api/users?email=  — Delete a user
 */

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://localhost:27017"
const AUTH_DB = process.env.AUTH_DB_NAME || "govinda_auth"
const DEFAULT_PASSWORD = "RedTech@2026"

// ─── Email generation ────────────────────────────────────────────────────────

/**
 * Generate a structured email from user name, team, and role.
 * Format: {firstname}.{lastname}.{team}.redtech@redtech.com
 * All lowercase, spaces replaced with underscores.
 */
function generateEmail(name: string, team: string): string {
    const namePart = name.trim().toLowerCase().replace(/\s+/g, ".")
    const teamPart = team.trim().toLowerCase().replace(/\s+/g, "_")
    return `${namePart}.${teamPart}.redtech@redtech.com`
}

// ─── GET: List all users ─────────────────────────────────────────────────────

export async function GET() {
    const client = new MongoClient(MONGO_URI)
    try {
        await client.connect()
        const db = client.db(AUTH_DB)
        const users = await db.collection("user").find(
            {},
            {
                projection: {
                    _id: 0,
                    id: 1,
                    name: 1,
                    email: 1,
                    role: 1,
                    team: 1,
                    start_date: 1,
                    createdAt: 1,
                },
            }
        ).toArray()
        return NextResponse.json({ users })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to fetch users" },
            { status: 500 }
        )
    } finally {
        await client.close()
    }
}

// ─── POST: Create a new user ─────────────────────────────────────────────────

export async function POST(req: Request) {
    const client = new MongoClient(MONGO_URI)
    try {
        const body = await req.json()
        const { name, role, team, start_date } = body as {
            name: string
            role: string
            team: string
            start_date?: string
        }

        if (!name?.trim()) {
            return NextResponse.json({ error: "Name is required" }, { status: 400 })
        }
        if (!role?.trim()) {
            return NextResponse.json({ error: "Role is required" }, { status: 400 })
        }
        if (!team?.trim() && !["admin", "compliance_officer"].includes(role)) {
            return NextResponse.json({ error: "Team is required" }, { status: 400 })
        }

        const email = generateEmail(name, team || "admin")

        await client.connect()
        const db = client.db(AUTH_DB)
        const userCol = db.collection("user")

        // Check for duplicates
        const existing = await userCol.findOne({ email })
        if (existing) {
            return NextResponse.json(
                { error: `User with email ${email} already exists` },
                { status: 409 }
            )
        }

        // Create user via Better Auth (handles password hashing)
        await auth.api.signUpEmail({
            body: {
                email,
                password: DEFAULT_PASSWORD,
                name: name.trim(),
            },
        })

        // Set role, team, start_date directly in MongoDB
        await userCol.updateOne(
            { email },
            {
                $set: {
                    role,
                    team: team || "",
                    start_date: start_date || new Date().toISOString().split("T")[0],
                },
            }
        )

        const created = await userCol.findOne(
            { email },
            { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, team: 1, start_date: 1 } }
        )

        return NextResponse.json({
            user: created,
            generated_email: email,
            default_password: DEFAULT_PASSWORD,
        })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to create user" },
            { status: 500 }
        )
    } finally {
        await client.close()
    }
}

// ─── PUT: Update a user ──────────────────────────────────────────────────────

export async function PUT(req: Request) {
    const client = new MongoClient(MONGO_URI)
    try {
        const body = await req.json()
        const { email, name, role, team, start_date } = body as {
            email: string
            name?: string
            role?: string
            team?: string
            start_date?: string
        }

        if (!email?.trim()) {
            return NextResponse.json({ error: "Email is required to identify user" }, { status: 400 })
        }

        await client.connect()
        const db = client.db(AUTH_DB)
        const userCol = db.collection("user")

        const existing = await userCol.findOne({ email })
        if (!existing) {
            return NextResponse.json({ error: "User not found" }, { status: 404 })
        }

        const updates: Record<string, unknown> = {}
        if (name !== undefined) updates.name = name.trim()
        if (role !== undefined) updates.role = role
        if (team !== undefined) updates.team = team
        if (start_date !== undefined) updates.start_date = start_date

        // If role changes, auto-update email
        const effectiveName = name?.trim() || existing.name
        const effectiveTeam = team !== undefined ? team : existing.team
        let newEmail = email

        if (role !== undefined || team !== undefined || name !== undefined) {
            newEmail = generateEmail(effectiveName, effectiveTeam || "admin")
            if (newEmail !== email) {
                // Check new email doesn't conflict
                const conflict = await userCol.findOne({ email: newEmail })
                if (conflict) {
                    return NextResponse.json(
                        { error: `Email ${newEmail} is already taken by another user` },
                        { status: 409 }
                    )
                }
                updates.email = newEmail
            }
        }

        if (Object.keys(updates).length > 0) {
            await userCol.updateOne({ email }, { $set: updates })
        }

        const updated = await userCol.findOne(
            { email: newEmail },
            { projection: { _id: 0, id: 1, name: 1, email: 1, role: 1, team: 1, start_date: 1 } }
        )

        return NextResponse.json({ user: updated })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to update user" },
            { status: 500 }
        )
    } finally {
        await client.close()
    }
}

// ─── DELETE: Delete a user ───────────────────────────────────────────────────

export async function DELETE(req: Request) {
    const { searchParams } = new URL(req.url)
    const email = searchParams.get("email")

    if (!email) {
        return NextResponse.json({ error: "Email query param is required" }, { status: 400 })
    }

    const client = new MongoClient(MONGO_URI)
    try {
        await client.connect()
        const db = client.db(AUTH_DB)
        const userCol = db.collection("user")

        const existing = await userCol.findOne({ email })
        if (!existing) {
            return NextResponse.json({ error: "User not found" }, { status: 404 })
        }

        // Don't allow deleting the main admin
        if (existing.role === "admin" && email === "admin@govinda.com") {
            return NextResponse.json({ error: "Cannot delete the primary admin account" }, { status: 403 })
        }

        await userCol.deleteOne({ email })

        // Also delete from session and account collections
        if (existing.id) {
            await db.collection("session").deleteMany({ userId: existing.id })
            await db.collection("account").deleteMany({ userId: existing.id })
        }

        return NextResponse.json({ deleted: email })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to delete user" },
            { status: 500 }
        )
    } finally {
        await client.close()
    }
}
