"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { Loader2, ShieldAlert } from "lucide-react"
import { UserRole as UserRoleConstants, type UserRoleValue } from "@/lib/constants"

type UserRole = UserRoleValue

interface AuthGuardProps {
    children: React.ReactNode
    fallback?: React.ReactNode
    /** If set, only users with one of these roles can access. Others get redirected. */
    allowedRoles?: UserRole[]
}

/** Get the role from session user object */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getUserRole(session: any): UserRole {
    const role = session?.user?.role
    if (role === UserRoleConstants.COMPLIANCE_OFFICER || role === UserRoleConstants.ADMIN) return role as UserRole
    if (role === UserRoleConstants.CHIEF) return UserRoleConstants.CHIEF
    if (role === UserRoleConstants.TEAM_REVIEWER) return UserRoleConstants.TEAM_REVIEWER
    if (role === UserRoleConstants.TEAM_LEAD) return UserRoleConstants.TEAM_LEAD
    return UserRoleConstants.TEAM_MEMBER
}

/** Get the team from session user object */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getUserTeam(session: any): string {
    return session?.user?.team || ""
}

/** Check if user needs to reset password */
// eslint-disable-next-line @typescript-eslint/no-explicit-any

export function AuthGuard({ children, fallback, allowedRoles }: AuthGuardProps) {
    const { data: session, isPending } = useSession()
    const router = useRouter()

    React.useEffect(() => {
        if (!isPending && !session) {
            router.replace("/sign-in")
        }
    }, [isPending, session, router])

    // Force password reset redirect
    React.useEffect(() => {
        // Removed forcePasswordReset redirect logic
    }, [isPending, session, router])

    // Role-based redirect
    React.useEffect(() => {
        if (!isPending && session && allowedRoles) {
            const role = getUserRole(session)
            if (!allowedRoles.includes(role)) {
                // Team members get sent to their board
                if (role === UserRoleConstants.TEAM_MEMBER) {
                    router.replace("/team-board")
                } else if (role === UserRoleConstants.TEAM_REVIEWER) {
                    router.replace("/team-review")
                } else if (role === UserRoleConstants.TEAM_LEAD) {
                    router.replace("/team-lead")
                } else if (role === UserRoleConstants.CHIEF) {
                    router.replace("/chief")
                } else {
                    router.replace("/")
                }
            }
        }
    }, [isPending, session, allowedRoles, router])

    if (isPending) {
        return fallback ?? (
            <div className="flex items-center justify-center h-screen bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!session) return null

    // Block if role not allowed
    if (allowedRoles) {
        const role = getUserRole(session)
        if (!allowedRoles.includes(role)) {
            return (
                <div className="flex items-center justify-center h-screen bg-background">
                    <div className="text-center">
                        <ShieldAlert className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">Redirecting...</p>
                    </div>
                </div>
            )
        }
    }

    return <>{children}</>
}
