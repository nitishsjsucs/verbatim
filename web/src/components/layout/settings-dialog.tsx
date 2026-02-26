"use client"

import * as React from "react"
import { X, Loader2, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { authClient, useSession } from "@/lib/auth-client"
import { toast } from "sonner"

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { data: session } = useSession()

    // Theme (mirrors ThemeToggle localStorage approach)
    const [theme, setThemeState] = React.useState<"light" | "dark">("dark")
    React.useEffect(() => {
        const stored = localStorage.getItem("theme")
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
        setThemeState(stored ? (stored as "light" | "dark") : prefersDark ? "dark" : "light")
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
                    <h2 className="text-sm font-semibold text-foreground">Settings</h2>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {/* Name */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Display Name</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Your name"
                        />
                        <Button
                            size="sm"
                            onClick={handleSaveName}
                            disabled={savingName || name === (session?.user?.name || "")}
                            className="gap-1.5 w-full justify-center bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400 text-white"
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
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Current password"
                        />
                        <input
                            type="password"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="New password"
                        />
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                            placeholder="Confirm new password"
                        />
                        <p className="text-[10px] text-muted-foreground/50">Min 8 characters, 1 uppercase, 1 number</p>
                        <Button
                            size="sm"
                            onClick={handleChangePassword}
                            disabled={savingPassword || !currentPassword || !newPassword}
                            className="gap-1.5 w-full justify-center"
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
