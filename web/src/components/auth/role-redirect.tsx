"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { useRouter, usePathname } from "next/navigation"
import { getUserRole } from "@/components/auth/auth-guard"
import { Loader2 } from "lucide-react"
import { UserRole } from "@/lib/constants"

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
    "/admin",
]

/** Pages only for team reviewers */
const REVIEWER_ONLY_PATHS = [
    "/team-review",
]

/** Pages only for team leads */
const LEAD_ONLY_PATHS = [
    "/team-lead",
]

/**
 * Wrap any page with this component to enforce:
 *  1. Must be signed in  → redirect to /sign-in
 *  2. If officer-only page + team_member role → redirect to /team-board
 *  3. If officer-only page + team_lead role → redirect to /team-lead
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
        const isTeamMember = role === UserRole.TEAM_MEMBER
        const isTeamReviewer = role === UserRole.TEAM_REVIEWER
        const isTeamLead = role === UserRole.TEAM_LEAD

        // Team member trying to access an officer-only, reviewer-only, or lead-only page → redirect
        if (isTeamMember) {
            const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            const isLeadOnly = LEAD_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            if (isOfficerOnly || isReviewerOnly || isLeadOnly) {
                router.replace("/team-board")
                return
            }
        }

        // Team reviewer trying to access an officer-only or lead-only page → redirect
        if (isTeamReviewer) {
            const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            const isLeadOnly = LEAD_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            if (isOfficerOnly || isLeadOnly) {
                router.replace("/team-review")
                return
            }
        }

        // Team lead trying to access an officer-only or reviewer-only page → redirect
        if (isTeamLead) {
            const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            if (isOfficerOnly || isReviewerOnly) {
                router.replace("/team-lead")
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

    // Team member / reviewer / lead on restricted page — show nothing while redirecting
    const role = getUserRole(session)
    if (role === UserRole.TEAM_MEMBER) {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        const isLeadOnly = LEAD_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isReviewerOnly || isLeadOnly) return null
    }
    if (role === UserRole.TEAM_REVIEWER) {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isLeadOnly = LEAD_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isLeadOnly) return null
    }
    if (role === UserRole.TEAM_LEAD) {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isReviewerOnly) return null
    }

    return <>{children}</>
}
