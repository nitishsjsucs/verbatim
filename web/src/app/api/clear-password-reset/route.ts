import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { MongoClient } from "mongodb"
import { headers } from "next/headers"

/**
 * POST /api/clear-password-reset
 *
 * Clears the forcePasswordReset flag for the currently authenticated user.
 * Called after a user successfully changes their password.
 */
export async function POST() {
    try {
        // Get current session
        const session = await auth.api.getSession({
            headers: await headers(),
        })

        if (!session?.user?.email) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
        }

        // Connect to MongoDB and clear the flag
        const mongoClient = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017")
        const db = mongoClient.db(process.env.AUTH_DB_NAME || "govinda_auth")
        const userCollection = db.collection("user")

        await userCollection.updateOne(
            { email: session.user.email },
            { $set: { forcePasswordReset: false } }
        )

        await mongoClient.close()

        return NextResponse.json({ success: true })
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Failed to clear password reset flag" },
            { status: 500 }
        )
    }
}
