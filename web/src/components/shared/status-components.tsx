"use client"

/**
 * Shared status-related UI components — extracted from duplicated definitions
 * across team-board, team-lead, team-review, dashboard, chat-interface, and research-chat.
 */

import * as React from "react"
import {
    ChevronDown, ChevronRight, FileText, Paperclip,
    ExternalLink, Download, X,
    ShieldCheck, ShieldAlert, ShieldQuestion,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { RISK_STYLES, normalizeRisk } from "@/lib/status-config"

// ─── RiskIcon ────────────────────────────────────────────────────────────────

export function RiskIcon({ modality }: { modality: string }) {
    const risk = normalizeRisk(modality)
    const cfg = RISK_STYLES[risk] || RISK_STYLES["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-bold shrink-0", cfg.bg, cfg.text)} title={risk}>
            !
        </span>
    )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
    if (total === 0) return <span className="text-[10px] text-muted-foreground/40">—</span>
    const pct = (completed / total) * 100
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {completed}/{total}
            </span>
        </div>
    )
}

// ─── EvidencePopover ─────────────────────────────────────────────────────────

interface EvidenceFile {
    name: string
    url: string
    uploaded_at: string
}

export function EvidencePopover({ files }: { files: EvidenceFile[]; taskStatus?: string }) {
    const [open, setOpen] = React.useState(false)
    const popoverRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!open) return
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [open])

    if (files.length === 0) {
        return <span className="text-[10px] text-muted-foreground/30 italic">empty</span>
    }

    const apiBase = process.env.NEXT_PUBLIC_API_URL || "/api/backend"

    return (
        <div className="relative" ref={popoverRef}>
            <button
                onClick={() => setOpen(!open)}
                className="text-[10px] text-foreground/70 flex items-center justify-center gap-1 hover:text-primary transition-colors rounded px-1.5 py-0.5 hover:bg-primary/10"
            >
                <Paperclip className="h-2.5 w-2.5" />{files.length}
            </button>

            {open && (
                <div className="absolute z-50 top-full mt-1 right-0 w-72 bg-background border border-border rounded-lg shadow-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-foreground/80">Evidence Files</span>
                        <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-muted/30 text-muted-foreground/40">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    {files.map((file, idx) => {
                        const fileUrl = file.url?.startsWith("/") ? `${apiBase}${file.url}` : file.url
                        return (
                            <div key={idx} className="flex items-center gap-2.5 bg-muted/20 rounded-md px-3 py-2.5 border border-border/20">
                                <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                    <FileText className="h-3.5 w-3.5 text-primary/70" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-medium text-foreground/90 truncate">{file.name}</p>
                                    <p className="text-[9px] text-muted-foreground/40">
                                        {file.uploaded_at ? (() => { const _d = new Date(file.uploaded_at); return `${String(_d.getDate()).padStart(2, "0")} ${_d.toLocaleDateString("en-US", { month: "short" })}` })() : ""}
                                    </p>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                    {fileUrl && (
                                        <>
                                            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors" title="Open">
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                            <a href={fileUrl} download={file.name} className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors" title="Download">
                                                <Download className="h-3 w-3" />
                                            </a>
                                        </>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

// ─── CollapsibleSection ──────────────────────────────────────────────────────

export function CollapsibleSection({ title, icon, children, defaultOpen = false, badge }: {
    title: string
    icon: React.ReactNode
    children: React.ReactNode
    defaultOpen?: boolean
    badge?: React.ReactNode
}) {
    const [open, setOpen] = React.useState(defaultOpen)
    return (
        <div className="border border-border/30 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {icon}
                <span>{title}</span>
                {badge && <span className="ml-auto">{badge}</span>}
            </button>
            {open && <div className="px-3 pb-3 pt-1">{children}</div>}
        </div>
    )
}

// ─── VerificationBadge ───────────────────────────────────────────────────────

export function VerificationBadge({ status }: { status: string }) {
    const config = {
        verified: { icon: ShieldCheck, color: "text-green-400 bg-green-400/10", label: "Verified" },
        partially_verified: { icon: ShieldQuestion, color: "text-amber-400 bg-amber-400/10", label: "Partially Verified" },
        unverified: { icon: ShieldAlert, color: "text-red-400 bg-red-400/10", label: "Unverified" },
    }[status] || { icon: ShieldQuestion, color: "text-muted-foreground bg-muted", label: status || "Unknown" }

    const Icon = config.icon
    return (
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium", config.color)}>
            <Icon className="h-3 w-3" />
            {config.label}
        </span>
    )
}

// ─── ConfidenceIndicator ─────────────────────────────────────────────────────

export function ConfidenceIndicator({ confidence }: { confidence: string }) {
    const color = confidence === "high" ? "bg-green-400" : confidence === "medium" ? "bg-amber-400" : "bg-red-400"
    return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />
}

// ─── StageTimingBar ──────────────────────────────────────────────────────────

export function StageTimingBar({ name, seconds, maxSeconds }: { name: string; seconds: number; maxSeconds: number }) {
    const pct = maxSeconds > 0 ? Math.min((seconds / maxSeconds) * 100, 100) : 0
    return (
        <div className="flex items-center gap-2 text-[11px]">
            <span className="w-28 text-muted-foreground truncate">{name}</span>
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-muted-foreground">{seconds.toFixed(1)}s</span>
        </div>
    )
}
