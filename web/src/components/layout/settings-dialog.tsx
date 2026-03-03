"use client"

import * as React from "react"
import { X, Loader2, Moon, Sun, Zap, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { authClient, useSession } from "@/lib/auth-client"
import { toast } from "sonner"
import { setRetrievalMode, setOptimizationFeatures } from "@/lib/api"
import type { RetrievalMode, OptimizationFeatures } from "@/lib/types"

const FEATURE_LABELS: { key: keyof OptimizationFeatures; label: string; description: string }[] = [
    { key: "enable_locator_cache", label: "Locator Cache", description: "Cache locate results to prevent redundant LLM calls" },
    { key: "enable_embedding_prefilter", label: "Embedding Pre-Filter", description: "Narrow tree index with embeddings before LLM locate" },
    { key: "enable_query_cache", label: "Query Cache", description: "Cache answers for semantically similar queries" },
    { key: "enable_verification_skip", label: "Smart Verification Skip", description: "Skip verification for high-confidence answers" },
    { key: "enable_synthesis_prealloc", label: "Synthesis Pre-Allocation", description: "Pre-calculate output tokens to avoid truncation" },
    { key: "enable_reflection_tuning", label: "Reflection Tuning", description: "Lower thresholds to skip unnecessary reflection rounds" },
    { key: "enable_fast_synthesis", label: "Fast Synthesis", description: "Trim sections to token budget + reduce reasoning effort for faster answers" },
]

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data: session } = useSession()

    // Retrieval mode toggle
    const [retrievalMode, setRetrievalModeState] = React.useState<RetrievalMode>("legacy")
    const [features, setFeatures] = React.useState<OptimizationFeatures>({
        enable_locator_cache: true,
        enable_embedding_prefilter: true,
        enable_query_cache: true,
        enable_verification_skip: true,
        enable_synthesis_prealloc: true,
        enable_reflection_tuning: true,
        enable_fast_synthesis: true,
    })
    const [savingMode, setSavingMode] = React.useState(false)

    React.useEffect(() => {
        if (open) {
            // Load from localStorage as fast fallback
            const stored = localStorage.getItem("retrieval_mode") as RetrievalMode | null
            if (stored) setRetrievalModeState(stored)
            const storedFeatures = localStorage.getItem("optimization_features")
            if (storedFeatures) {
                try { setFeatures(JSON.parse(storedFeatures)) } catch { /* ignore */ }
            }
            // Then sync from backend (source of truth)
            import("@/lib/api").then(({ fetchConfig }) => {
                fetchConfig().then((cfg) => {
                    if (cfg.retrieval_mode) {
                        setRetrievalModeState(cfg.retrieval_mode as RetrievalMode)
                        localStorage.setItem("retrieval_mode", cfg.retrieval_mode)
                    }
                    if (cfg.optimization_features) {
                        setFeatures(cfg.optimization_features as OptimizationFeatures)
                        localStorage.setItem("optimization_features", JSON.stringify(cfg.optimization_features))
                    }
                }).catch(() => { /* backend unavailable — use cached */ })
            })
        }
    }, [open])

    const handleToggleMode = async (mode: RetrievalMode) => {
        setSavingMode(true)
        try {
            await setRetrievalMode(mode)
            setRetrievalModeState(mode)
            localStorage.setItem("retrieval_mode", mode)
            toast.success(`Switched to ${mode} retrieval`)
        } catch {
            toast.error("Failed to switch retrieval mode")
        } finally {
            setSavingMode(false)
        }
    }

    const handleToggleFeature = async (key: keyof OptimizationFeatures) => {
        const updated = { ...features, [key]: !features[key] }
        setFeatures(updated)
        localStorage.setItem("optimization_features", JSON.stringify(updated))
        try {
            await setOptimizationFeatures({ [key]: updated[key] })
        } catch {
            toast.error(`Failed to update ${key}`)
        }
    }

    // Theme (mirrors ThemeToggle localStorage approach)
    const [theme, setThemeState] = React.useState<"light" | "dark">("light")
    React.useEffect(() => {
        const stored = localStorage.getItem("theme")
        setThemeState(stored === "dark" ? "dark" : "light")
    }, [open])
    const setTheme = (t: "light" | "dark" | "system") => {
        const resolved = t === "system"
            ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
            : t
        setThemeState(resolved)
        document.documentElement.classList.toggle("dark", resolved === "dark")
        localStorage.setItem("theme", resolved)
    }

    const [name, setName] = React.useState("")
    const [savingName, setSavingName] = React.useState(false)

    const [currentPassword, setCurrentPassword] = React.useState("")
    const [newPassword, setNewPassword] = React.useState("")
    const [confirmPassword, setConfirmPassword] = React.useState("")
    const [savingPassword, setSavingPassword] = React.useState(false)

    React.useEffect(() => {
        if (session?.user?.name) setName(session.user.name)
    }, [session])

    const handleSaveName = async () => {
        if (!name.trim()) { toast.error("Name cannot be empty"); return }
        setSavingName(true)
        try {
            await authClient.updateUser({ name: name.trim() })
            toast.success("Name updated")
        } catch {
            toast.error("Failed to update name")
        } finally {
            setSavingName(false)
        }
    }

    const handleChangePassword = async () => {
        if (!currentPassword || !newPassword) { toast.error("Fill in all password fields"); return }
        if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return }
        if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return }
        if (!/[A-Z]/.test(newPassword)) { toast.error("Password must contain at least one uppercase letter"); return }
        if (!/[0-9]/.test(newPassword)) { toast.error("Password must contain at least one number"); return }
        setSavingPassword(true)
        try {
            await authClient.changePassword({
                currentPassword,
                newPassword,
            })
            toast.success("Password updated")
            setCurrentPassword("")
            setNewPassword("")
            setConfirmPassword("")
        } catch {
            toast.error("Failed to update password. Check your current password.")
        } finally {
            setSavingPassword(false)
        }
    }

    if (!open) return null

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                className="bg-background border border-border rounded-xl shadow-2xl w-[440px] max-h-[85vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
                    <h2 className="text-xs font-semibold text-foreground">Settings</h2>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {/* Retrieval Engine Toggle */}
                    <div className="space-y-3">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Retrieval Engine</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleToggleMode("legacy")}
                                disabled={savingMode}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-md border text-xs font-semibold transition-colors",
                                    retrievalMode === "legacy"
                                        ? "border-blue-500 bg-blue-500/10 text-blue-400"
                                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                                )}
                            >
                                <Shield className="h-4 w-4" /> Legacy (Stable)
                            </button>
                            <button
                                onClick={() => handleToggleMode("optimized")}
                                disabled={savingMode}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-md border text-xs font-semibold transition-colors",
                                    retrievalMode === "optimized"
                                        ? "border-amber-500 bg-amber-500/10 text-amber-400"
                                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                                )}
                            >
                                {savingMode ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                Optimized (New)
                            </button>
                        </div>
                        <p className="text-xs text-muted-foreground/60">
                            {retrievalMode === "optimized"
                                ? "Using optimized pipeline: embedding pre-filter, caching, tuned thresholds"
                                : "Using legacy pipeline: full tree index sent to LLM every query"}
                        </p>

                        {retrievalMode === "optimized" && (
                            <div className="space-y-1.5 pt-1">
                                <p className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">Sub-Features</p>
                                {FEATURE_LABELS.map(({ key, label, description }) => (
                                    <label
                                        key={key}
                                        className="flex items-center gap-2.5 py-1 cursor-pointer group"
                                        title={description}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={features[key]}
                                            onChange={() => handleToggleFeature(key)}
                                            className="h-3.5 w-3.5 accent-amber-500 rounded"
                                        />
                                        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                                            {label}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-border/30" />

                    {/* Name */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Your name"
                        />
                        <Button
                            size="sm"
                            onClick={handleSaveName}
                            disabled={savingName || name === (session?.user?.name || "")}
                            className="gap-1.5 w-full justify-center font-semibold"
                        >
                            {savingName && <Loader2 className="h-3 w-3 animate-spin" />}
                            Save Name
                        </Button>
                    </div>

                    <div className="border-t border-border/30" />

                    {/* Password */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Change Password</label>
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={e => setCurrentPassword(e.target.value)}
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Current password"
                        />
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="New password"
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Confirm new password"
                        />
                        <p className="text-xs text-muted-foreground/50">Min 8 characters, 1 uppercase, 1 number</p>
                        <Button
                            size="sm"
                            onClick={handleChangePassword}
                            disabled={savingPassword || !currentPassword || !newPassword}
                            className="gap-1.5 w-full justify-center font-semibold"
                        >
                            {savingPassword && <Loader2 className="h-3 w-3 animate-spin" />}
                            Update Password
                        </Button>
                    </div>

                    <div className="border-t border-border/30" />

                    {/* Theme */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Default Theme</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setTheme("light")}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md border text-xs font-medium transition-colors",
                                    theme === "light"
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                                )}
                            >
                                <Sun className="h-3.5 w-3.5" /> Light
                            </button>
                            <button
                                onClick={() => setTheme("dark")}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-md border text-xs font-medium transition-colors",
                                    theme === "dark"
                                        ? "border-primary bg-primary/10 text-primary"
                                        : "border-border bg-muted/20 text-muted-foreground hover:bg-muted/40"
                                )}
                            >
                                <Moon className="h-3.5 w-3.5" /> Dark
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border/40 flex justify-end shrink-0">
                    <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    )
}
