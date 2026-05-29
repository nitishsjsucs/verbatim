"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { intelLogin, isIntelAuthenticated, getIntelUser } from "@/lib/intel-auth";

export default function IntelLoginPage() {
    const router = useRouter();
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");

    // If already authenticated, redirect
    React.useEffect(() => {
        if (isIntelAuthenticated()) {
            router.replace("/intelligence");
        }
    }, [router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const result = await intelLogin(username, password);
            if (!result.success) {
                setError(result.error || "Login failed");
                return;
            }
            // Both admin and client go to same workspace
            window.location.href = "/intelligence";
        } catch (err) {
            setError(err instanceof Error ? err.message : "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-background relative">
            <div className="w-full max-w-sm mx-auto">
                <div className="text-center mb-8">
                    <div className="flex items-center justify-center gap-2 mb-3">
                        <Brain className="h-5 w-5 text-primary" />
                    </div>
                    <h1 className="text-sm font-bold text-foreground">Intelligence System</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Sign in to your intelligence account
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            placeholder="Enter username"
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            placeholder="Enter password"
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 text-xs font-medium rounded-md px-4 py-2 transition-colors",
                            "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
                        )}
                    >
                        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Sign In
                    </button>
                </form>

                <p className="text-center text-xs text-muted-foreground/40 mt-6">
                    Contact your administrator for account access.
                </p>
            </div>
        </div>
    );
}
