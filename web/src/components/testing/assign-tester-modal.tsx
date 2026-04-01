"use client"

import * as React from "react"
import { X, Loader2, UserPlus, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchTesters, type TesterUser } from "@/lib/testing-api"
import { toast } from "sonner"

interface AssignTesterModalProps {
    open: boolean
    onClose: () => void
    /** Item IDs to assign (supports single + bulk) */
    itemIds: string[]
    /** Callback when assignment is confirmed */
    onAssign: (testerId: string, testerName: string, deadline: string) => Promise<void>
    /** Whether to show deadline input (false for theme/adhoc where batch deadline is set separately) */
    showDeadline?: boolean
    /** Pre-filled deadline for batch operations */
    batchDeadline?: string
}

export function AssignTesterModal({
    open, onClose, itemIds, onAssign, showDeadline = true, batchDeadline = "",
}: AssignTesterModalProps) {
    const [testers, setTesters] = React.useState<TesterUser[]>([])
    const [loading, setLoading] = React.useState(false)
    const [submitting, setSubmitting] = React.useState(false)
    const [selectedId, setSelectedId] = React.useState("")
    const [searchQuery, setSearchQuery] = React.useState("")
    const [deadline, setDeadline] = React.useState(batchDeadline)
    const [assigned, setAssigned] = React.useState(false)

    React.useEffect(() => {
        if (!open) return
        setLoading(true)
        fetchTesters()
            .then(data => setTesters(data.testers || []))
            .catch(() => toast.error("Failed to load testers"))
            .finally(() => setLoading(false))
    }, [open])

    React.useEffect(() => {
        if (!open) {
            setSelectedId("")
            setSearchQuery("")
            setDeadline(batchDeadline)
            setAssigned(false)
        }
    }, [open, batchDeadline])

    const filtered = testers.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.email.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleSubmit = async () => {
        if (!selectedId) {
            toast.error("Select a tester to assign")
            return
        }
        if (showDeadline && !deadline) {
            toast.error("Set a testing deadline")
            return
        }
        const target = testers.find(t => t.id === selectedId)
        if (!target) return
        setSubmitting(true)
        try {
            await onAssign(target.id, target.name, deadline || batchDeadline)
            setAssigned(true)
            toast.success(`Assigned ${itemIds.length} item${itemIds.length > 1 ? "s" : ""} to ${target.name}`)
            setTimeout(() => onClose(), 1200)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Assignment failed")
            setAssigned(false)
        } finally {
            setSubmitting(false)
        }
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-background border border-border rounded-lg shadow-xl w-[400px] max-h-[75vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                    <div className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4 text-teal-400" />
                        <h2 className="text-sm font-semibold">Assign Tester</h2>
                        <span className="text-[10px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">
                            {itemIds.length} item{itemIds.length > 1 ? "s" : ""}
                        </span>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                        Select a tester from the list to assign the selected actionable{itemIds.length > 1 ? "s" : ""}.
                    </p>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search testers..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full bg-muted/40 text-xs rounded pl-8 pr-3 py-2 border border-border/40 focus:border-primary focus:outline-none"
                        />
                    </div>

                    {/* Tester list */}
                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 text-center py-4">
                            {testers.length === 0 ? "No testers found" : "No matches"}
                        </p>
                    ) : (
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                            {filtered.map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setSelectedId(t.id)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors",
                                        selectedId === t.id
                                            ? "bg-teal-400/10 border border-teal-400/30"
                                            : "hover:bg-muted/50 border border-transparent"
                                    )}
                                >
                                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground/70 shrink-0">
                                        {t.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-medium text-foreground truncate">{t.name}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{t.email}</p>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground/50 capitalize shrink-0">{t.role.replace("_", " ")}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Deadline input */}
                    {showDeadline && (
                        <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Testing Deadline</label>
                            <input
                                type="datetime-local"
                                value={deadline}
                                onChange={e => setDeadline(e.target.value)}
                                className="w-full bg-muted/40 text-xs rounded px-3 py-2 border border-border/40 focus:border-primary focus:outline-none"
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-border/40 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 text-xs rounded border border-border/40 hover:bg-muted transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!selectedId || submitting || assigned || (showDeadline && !deadline)}
                        className={cn(
                            "px-3 py-1.5 text-xs rounded font-medium transition-colors",
                            assigned
                                ? "bg-emerald-500/20 text-emerald-400 cursor-not-allowed"
                                : selectedId && !submitting && (!showDeadline || deadline)
                                ? "bg-teal-500 text-white hover:bg-teal-500/90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        {assigned ? "✓ Assigned" : submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : `Assign${itemIds.length > 1 ? ` (${itemIds.length})` : ""}`}
                    </button>
                </div>
            </div>
        </div>
    )
}
