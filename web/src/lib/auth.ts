import { betterAuth } from "better-auth"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { admin } from "better-auth/plugins"
import { MongoClient } from "mongodb"
import { ac, complianceOfficer, teamReviewer, teamLead, teamMember, chief, adminRole, testingHead, testerRole, testingMaker, testingChecker } from "./permissions"

const client = new MongoClient(process.env.MONGODB_URI || "mongodb://localhost:27017")
const db = client.db(process.env.AUTH_DB_NAME || "govinda_auth")

export const auth = betterAuth({
    database: mongodbAdapter(db),

    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET, // min 32 chars — generate with: openssl rand -base64 32

    // Auto-detect origin from proxy headers (ngrok, Vercel, etc.)
    advanced: {
        trustedProxyHeaders: true,
    },

    emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        autoSignIn: true,
    },

    session: {
        expiresIn: 60 * 60 * 24 * 7,    // 7 days
        updateAge: 60 * 60 * 24,         // refresh daily
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60,              // 5 min cache
        },
    },

    user: {
        additionalFields: {
            team: {
                type: "string",
                required: false,
                defaultValue: "",
            },
                // forcePasswordReset removed
        },
    },

    plugins: [
        admin({
            ac,
            roles: {
                compliance_officer: complianceOfficer,
                team_reviewer: teamReviewer,
                team_lead: teamLead,
                team_member: teamMember,
                chief: chief,
                admin: adminRole,
                testing_head: testingHead,
                tester: testerRole,
                testing_maker: testingMaker,
                testing_checker: testingChecker,
            },
            defaultRole: "team_member",
        }),
    ],

    trustedOrigins: [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://govinda-is-my-god.vercel.app",
        "https://*.ngrok-free.app",
        "https://*.ngrok-free.dev",
        "https://*.ngrok.io",
        "https://*.vercel.app",
        process.env.NEXT_PUBLIC_APP_URL || "",
    ].filter(Boolean),
})

export type Auth = typeof auth
