"use client"

import * as React from "react"
import { useSession, authClient } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn } from "@/lib/utils"
import { getUserRole } from "@/components/auth/auth-guard"

function redirectForRole(role: string): string {
    if (role === "compliance_officer" || role === "admin") return "/"
    if (role === "team_reviewer") return "/team-review"
    if (role === "team_lead") return "/team-lead"
    return "/team-board"
}

export default function ResetPasswordPage() {
    const router = useRouter()
    const { data: session, isPending } = useSession()
    const [currentPassword, setCurrentPassword] = React.useState("")
    const [newPassword, setNewPassword] = React.useState("")
    const [confirmPassword, setConfirmPassword] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState("")
    const [success, setSuccess] = React.useState(false)

    // Check if user needs password reset
    const forcePasswordReset = (session?.user as { forcePasswordReset?: boolean })?.forcePasswordReset

    // If not signed in, redirect to sign-in
    React.useEffect(() => {
        if (!isPending && !session) {
            router.replace("/sign-in")
        }
    }, [isPending, session, router])

    // If signed in but doesn't need password reset, redirect to appropriate page
    React.useEffect(() => {
        if (!isPending && session && !forcePasswordReset) {
            const role = getUserRole(session)
            router.replace(redirectForRole(role))
        }
    }, [isPending, session, forcePasswordReset, router])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")

        if (newPassword !== confirmPassword) {
            setError("New passwords do not match")
            return
        }

        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters")
            return
        }

        setLoading(true)
        try {
            // Use Better Auth's change password API
            const res = await authClient.changePassword({
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            })

            if (res.error) {
                setError(res.error.message || "Failed to change password")
                return
            }

            // Clear the forcePasswordReset flag via API
            await fetch("/api/clear-password-reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            })

            setSuccess(true)

            // Redirect after a short delay
            setTimeout(() => {
                const role = getUserRole(session)
                window.location.href = redirectForRole(role)
            }, 1500)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            setLoading(false)
        }
    }

    if (isPending) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!session || !forcePasswordReset) return null

    if (success) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <div className="text-center">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-foreground mb-2">Password Changed</h2>
                    <p className="text-sm text-muted-foreground">Redirecting you to the dashboard...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background relative">
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <div className="w-full max-w-sm mx-auto">
                <div className="text-center mb-8">
                    <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <KeyRound className="h-6 w-6 text-primary" />
                    </div>
                    <h1 className="text-xl font-bold text-foreground">Change Your Password</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        You must change your password before continuing
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                            Current Password
                        </label>
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            required
                            placeholder="Enter your current password"
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                            New Password
                        </label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            required
                            minLength={8}
                            placeholder="Enter new password (min 8 characters)"
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                            Confirm New Password
                        </label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                            placeholder="Confirm new password"
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 text-sm font-medium rounded-md px-4 py-2 transition-colors",
                            "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        )}
                    >
                        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Change Password
                    </button>
                </form>

                <p className="text-center text-[10px] text-muted-foreground/40 mt-6">
                    This is a one-time password reset required for security.
                </p>
            </div>
        </div>
    )
}
