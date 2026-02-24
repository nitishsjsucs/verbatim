"use client"

import * as React from "react"
import { signIn, signUp } from "@/lib/auth-client"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export default function SignInPage() {
    const router = useRouter()
    const [mode, setMode] = React.useState<"signin" | "signup">("signin")
    const [email, setEmail] = React.useState("")
    const [password, setPassword] = React.useState("")
    const [name, setName] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [error, setError] = React.useState("")

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)
        try {
            if (mode === "signup") {
                const res = await signUp.email({ email, password, name })
                if (res.error) {
                    setError(res.error.message || "Sign up failed")
                    return
                }
            } else {
                const res = await signIn.email({ email, password })
                if (res.error) {
                    setError(res.error.message || "Sign in failed")
                    return
                }
            }
            router.push("/")
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <div className="w-full max-w-sm mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-xl font-bold text-foreground">Govinda v2</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        {mode === "signin" ? "Sign in to your account" : "Create a new account"}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    {mode === "signup" && (
                        <div>
                            <label className="text-[11px] font-medium text-muted-foreground block mb-1">Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                required={mode === "signup"}
                                placeholder="Your name"
                                className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                            />
                        </div>
                    )}

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
                            placeholder="Min. 8 characters"
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
                        {mode === "signin" ? "Sign In" : "Sign Up"}
                    </button>
                </form>

                <p className="text-center text-xs text-muted-foreground mt-4">
                    {mode === "signin" ? (
                        <>
                            Don&apos;t have an account?{" "}
                            <button onClick={() => { setMode("signup"); setError("") }} className="text-primary hover:underline font-medium">
                                Sign up
                            </button>
                        </>
                    ) : (
                        <>
                            Already have an account?{" "}
                            <button onClick={() => { setMode("signin"); setError("") }} className="text-primary hover:underline font-medium">
                                Sign in
                            </button>
                        </>
                    )}
                </p>
            </div>
        </div>
    )
}
