"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { useRouter, usePathname } from "next/navigation"
import { getUserRole } from "@/components/auth/auth-guard"
import { Loader2 } from "lucide-react"

/**
 * Pages that ONLY compliance officers / admins can access.
 * Team members visiting these get redirected to /team-board.
 */
const OFFICER_ONLY_PATHS = [
    "/",
    "/documents",
    "/research",
    "/history",
    "/actionables",
    "/dashboard",
]

/** Pages only for team reviewers */
const REVIEWER_ONLY_PATHS = [
    "/team-review",
]

/**
 * Wrap any page with this component to enforce:
 *  1. Must be signed in  → redirect to /sign-in
 *  2. If officer-only page + team_member role → redirect to /team-board
 */
export function RoleRedirect({ children }: { children: React.ReactNode }) {
    const { data: session, isPending } = useSession()
    const router = useRouter()
    const pathname = usePathname()

    React.useEffect(() => {
        if (isPending) return

        // Not signed in → go to sign-in
        if (!session) {
            router.replace("/sign-in")
            return
        }

        const role = getUserRole(session)
        const isTeamMember = role === "team_member"
        const isTeamReviewer = role === "team_reviewer"

        // Team member trying to access an officer-only or reviewer-only page → redirect
        if (isTeamMember) {
            const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            if (isOfficerOnly || isReviewerOnly) {
                router.replace("/team-board")
                return
            }
        }

        // Team reviewer trying to access an officer-only page → redirect
        if (isTeamReviewer) {
            const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            if (isOfficerOnly) {
                router.replace("/team-review")
                return
            }
        }
    }, [isPending, session, pathname, router])

    // Show loading while checking
    if (isPending) {
        return (
            <div className="flex items-center justify-center h-screen bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Not signed in — show nothing while redirecting
    if (!session) return null

    // Team member / reviewer on restricted page — show nothing while redirecting
    const role = getUserRole(session)
    if (role === "team_member") {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isReviewerOnly) return null
    }
    if (role === "team_reviewer") {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        if (isOfficerOnly) return null
    }

    return <>{children}</>
}
