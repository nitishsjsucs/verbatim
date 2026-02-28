"use client"

import * as React from "react"
import { signIn, useSession } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { cn } from "@/lib/utils"
import { getUserRole } from "@/components/auth/auth-guard"

function redirectForRole(role: string): string {
    if (role === "admin") return "/admin"
    if (role === "compliance_officer") return "/dashboard"
    if (role === "team_reviewer") return "/team-review"
    if (role === "team_lead") return "/team-lead"
    return "/team-board"
}

export default function SignInPage() {
    const router = useRouter()
    const { data: session, isPending } = useSession()
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState("")

    // If already signed in, redirect immediately based on role
    React.useEffect(() => {
        if (!isPending && session) {
            const role = getUserRole(session)
            router.replace(redirectForRole(role))
        }
    }, [isPending, session, router])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)
        try {
            const res = await signIn.email({ email, password })
            if (res.error) {
                setError(res.error.message || "Sign in failed")
                return
            }
            // After sign-in, redirect based on role from response session
            setTimeout(async () => {
                // Fetch fresh session to determine role
                try {
                    const { getSession } = await import("@/lib/auth-client")
                    const sess = await getSession()
                    const sessionRole = sess?.data?.user?.role
                    if (sessionRole === "admin") {
                        window.location.href = "/admin"
                    } else {
                        window.location.href = "/dashboard"
                    }
                } catch {
                    window.location.href = "/dashboard"
                }
            }, 300)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            setLoading(false)
        }
    }

    // Show nothing while checking session (prevents flash)
    if (isPending) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // Already signed in — show nothing while redirecting
    if (session) return null

    return (
        <div className="flex items-center justify-center min-h-screen bg-background relative">
            {/* Theme toggle — top right */}
            <div className="absolute top-4 right-4">
                <ThemeToggle />
            </div>
            <div className="w-full max-w-sm mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-xl font-bold text-foreground">RegTECH Pre-Pilot</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Sign in to your account
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            placeholder="you@example.com"
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    <div>
                        <label className="text-[11px] font-medium text-muted-foreground block mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={8}
                            placeholder="Enter your password"
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
                        Sign In
                    </button>
                </form>

                <p className="text-center text-[10px] text-muted-foreground/40 mt-6">
                    Contact your administrator if you need an account.
                </p>
            </div>
        </div>
    )
}
