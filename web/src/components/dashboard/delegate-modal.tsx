"use client"

import * as React from "react"
import { X, Loader2, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    fetchComplianceOfficers,
    createDelegationRequest,
    type ComplianceOfficer,
} from "@/lib/api"
import { toast } from "sonner"

interface DelegateModalProps {
    open: boolean
    onClose: () => void
    actionableId: string
    docId: string
    fromAccountId: string
    fromName: string
}

export function DelegateModal({ open, onClose, actionableId, docId, fromAccountId, fromName }: DelegateModalProps) {
    const [officers, setOfficers] = React.useState<ComplianceOfficer[]>([])
    const [loading, setLoading] = React.useState(false)
    const [submitting, setSubmitting] = React.useState(false)
    const [selectedId, setSelectedId] = React.useState("")
    const [searchQuery, setSearchQuery] = React.useState("")

    React.useEffect(() => {
        if (!open) return
        setLoading(true)
        fetchComplianceOfficers()
            .then(data => {
                // Exclude the current user from the list
                setOfficers(data.officers.filter(o => o.id !== fromAccountId))
            })
            .catch(() => toast.error("Failed to load compliance officers"))
            .finally(() => setLoading(false))
    }, [open, fromAccountId])

    React.useEffect(() => {
        if (!open) {
            setSelectedId("")
            setSearchQuery("")
        }
    }, [open])

    const filtered = officers.filter(o =>
        o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.email.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleSubmit = async () => {
        if (!selectedId) {
            toast.error("Select a compliance officer to delegate to")
            return
        }
        const target = officers.find(o => o.id === selectedId)
        if (!target) return
        setSubmitting(true)
        try {
            await createDelegationRequest({
                actionable_id: actionableId,
                doc_id: docId,
                from_account_id: fromAccountId,
                to_account_id: selectedId,
                from_name: fromName,
                to_name: target.name,
            })
            toast.success(`Delegation request sent to ${target.name}`)
            onClose()
        } catch {
            toast.error("Failed to send delegation request")
        } finally {
            setSubmitting(false)
        }
    }

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-background border border-border rounded-lg shadow-xl w-[380px] max-h-[70vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                    <div className="flex items-center gap-2">
                        <UserPlus className="h-4 w-4 text-blue-400" />
                        <h2 className="text-sm font-semibold">Delegate Actionable</h2>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                        Select a compliance officer to delegate this actionable to. They will receive a notification and can accept or reject.
                    </p>

                    <input
                        type="text"
                        placeholder="Search officers..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full bg-muted/40 text-xs rounded px-3 py-2 border border-border/40 focus:border-primary focus:outline-none"
                    />

                    {loading ? (
                        <div className="flex items-center justify-center py-6">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 text-center py-4">
                            {officers.length === 0 ? "No other compliance officers found" : "No matches"}
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {filtered.map(o => (
                                <button
                                    key={o.id}
                                    onClick={() => setSelectedId(o.id)}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors",
                                        selectedId === o.id
                                            ? "bg-primary/10 border border-primary/30"
                                            : "hover:bg-muted/50 border border-transparent"
                                    )}
                                >
                                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-foreground/70 shrink-0">
                                        {o.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">{o.name}</p>
                                        <p className="text-[10px] text-muted-foreground truncate">{o.email}</p>
                                    </div>
                                </button>
                            ))}
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
                        disabled={!selectedId || submitting}
                        className={cn(
                            "px-3 py-1.5 text-xs rounded font-medium transition-colors",
                            selectedId && !submitting
                                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                    >
                        {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send Request"}
                    </button>
                </div>
            </div>
        </div>
    )
}
