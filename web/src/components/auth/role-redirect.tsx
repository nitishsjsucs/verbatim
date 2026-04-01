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

/** Pages only for testing cycle roles */
const TESTING_ONLY_PATHS = [
    "/testing-head",
    "/testing-tester",
    "/testing-maker",
    "/testing-checker",
]

/** All control-cycle restricted paths (officer + reviewer + lead + member boards) */
const CONTROL_CYCLE_PATHS = [
    ...OFFICER_ONLY_PATHS,
    ...REVIEWER_ONLY_PATHS,
    ...LEAD_ONLY_PATHS,
    "/team-board",
    "/chief",
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
        const isTeamMember = role === "team_member"
        const isTeamReviewer = role === "team_reviewer"
        const isTeamLead = role === "team_lead"

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

        // Testing roles trying to access control cycle pages → redirect to their home
        const isTestingRole = ["testing_head", "tester", "testing_maker", "testing_checker"].includes(role)
        if (isTestingRole) {
            const isControlPage = CONTROL_CYCLE_PATHS.some(p =>
                pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
            )
            if (isControlPage) {
                const homeMap: Record<string, string> = {
                    testing_head: "/testing-head",
                    tester: "/testing-tester",
                    testing_maker: "/testing-maker",
                    testing_checker: "/testing-checker",
                }
                router.replace(homeMap[role] || "/testing-head")
                return
            }
        }

        // Control cycle roles trying to access testing-only pages → redirect back
        if (!isTestingRole && role !== "compliance_officer" && role !== "admin") {
            const isTestingPage = TESTING_ONLY_PATHS.some(p =>
                pathname === p || pathname.startsWith(p + "/")
            )
            if (isTestingPage) {
                const homeMap: Record<string, string> = {
                    team_member: "/team-board",
                    team_reviewer: "/team-review",
                    team_lead: "/team-lead",
                    chief: "/chief",
                }
                router.replace(homeMap[role] || "/")
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
    if (role === "team_member") {
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
    if (role === "team_reviewer") {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isLeadOnly = LEAD_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isLeadOnly) return null
    }
    if (role === "team_lead") {
        const isOfficerOnly = OFFICER_ONLY_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        const isReviewerOnly = REVIEWER_ONLY_PATHS.some(p =>
            pathname === p || pathname.startsWith(p + "/")
        )
        if (isOfficerOnly || isReviewerOnly) return null
    }
    // Testing roles on control cycle pages → show nothing while redirecting
    const isTestingRole = ["testing_head", "tester", "testing_maker", "testing_checker"].includes(role)
    if (isTestingRole) {
        const isControlPage = CONTROL_CYCLE_PATHS.some(p =>
            pathname === p || (p !== "/" && pathname.startsWith(p + "/"))
        )
        if (isControlPage) return null
    }

    return <>{children}</>
}
