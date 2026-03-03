"use client"

/**
 * Shared status-related UI components — extracted from duplicated definitions
 * across team-board, team-lead, team-review, dashboard, chat-interface, and research-chat.
 */

import * as React from "react"
import {
    ChevronDown, ChevronRight, FileText, Paperclip,
    ExternalLink, Download, X, Trash2,
    ShieldCheck, ShieldAlert, ShieldQuestion,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { RISK_STYLES, normalizeRisk } from "@/lib/status-config"
import { getEvidenceFileUrl } from "@/lib/api"

// ─── RiskIcon ────────────────────────────────────────────────────────────────

export function RiskIcon({ modality }: { modality: string }) {
    const risk = normalizeRisk(modality)
    const cfg = RISK_STYLES[risk] || RISK_STYLES["Medium Risk"]
    return (
        <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded-full text-xs-plus font-bold shrink-0", cfg.bg, cfg.text)} title={risk}>
            !
        </span>
    )
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

export function ProgressBar({ completed, total }: { completed: number; total: number }) {
    if (total === 0) return <span className="text-2xs text-muted-foreground/40">—</span>
    const pct = (completed / total) * 100
    return (
        <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div className="bg-emerald-500 h-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-2xs font-mono text-muted-foreground shrink-0">
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

export function EvidencePopover({ files, canDownload = true }: { files: EvidenceFile[]; taskStatus?: string; canDownload?: boolean }) {
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
        return <span className="text-2xs text-muted-foreground/30 italic">empty</span>
    }

    return (
        <div className="relative" ref={popoverRef}>
            <button
                onClick={() => setOpen(!open)}
                className="text-2xs text-foreground/70 flex items-center justify-center gap-1 hover:text-primary transition-colors rounded px-1.5 py-0.5 hover:bg-primary/10"
            >
                <Paperclip className="h-2.5 w-2.5" />{files.length}
            </button>

            {open && (
                <div className="absolute z-50 top-full mt-1 right-0 w-72 bg-background border border-border rounded-lg shadow-xl p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs-plus font-semibold text-foreground/80">Evidence Files</span>
                        <button onClick={() => setOpen(false)} className="p-0.5 rounded hover:bg-muted/30 text-muted-foreground/40">
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                    {files.map((file, idx) => {
                        const fileUrl = getEvidenceFileUrl(file.url)
                        return (
                            <div key={idx} className="flex items-center gap-2.5 bg-muted/20 rounded-md px-3 py-2.5 border border-border/20">
                                <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                    <FileText className="h-3.5 w-3.5 text-primary/70" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs-plus font-medium text-foreground/90 truncate">{file.name}</p>
                                    <p className="text-3xs text-muted-foreground/40">
                                        {file.uploaded_at ? (() => { const _d = new Date(file.uploaded_at); return `${String(_d.getDate()).padStart(2, "0")} ${_d.toLocaleDateString("en-US", { month: "short" })}` })() : ""}
                                    </p>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                    {fileUrl && (
                                        <>
                                            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors" title="Open">
                                                <ExternalLink className="h-3 w-3" />
                                            </a>
                                            {canDownload && (
                                                <a href={fileUrl} download={file.name} className="p-1 rounded hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors" title="Download">
                                                    <Download className="h-3 w-3" />
                                                </a>
                                            )}
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

// ─── SectionDivider ─────────────────────────────────────────────────────────

/**
 * Sticky collapsible section header used for Active / Completed / Delayed
 * groupings in dashboard, team-board, team-review, and team-lead pages.
 *
 * @param borderClass  Full Tailwind border class (e.g. "border-b border-yellow-500/20")
 * @param textClass    Full Tailwind text-color class (e.g. "text-yellow-500")
 */
export function SectionDivider({ label, count, icon, borderClass, textClass, collapsed, onToggle }: {
    label: string
    count: number
    icon: React.ReactNode
    borderClass: string
    textClass: string
    collapsed: boolean
    onToggle: () => void
}) {
    return (
        <div
            className={cn("px-3 py-2 bg-background cursor-pointer sticky top-0 z-20", borderClass)}
            onClick={onToggle}
        >
            <span className={cn("text-xs font-semibold flex items-center gap-2", textClass)}>
                {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {icon}
                {label} ({count})
            </span>
        </div>
    )
}

// ─── CitationCard ────────────────────────────────────────────────────────────

/**
 * Visual shell for a single citation / source card.
 * Used in chat-interface, research-chat, and history/[conv_id] pages.
 * Each consumer supplies its own onClick handler.
 */
export function CitationCard({ title, subtitle, pageRange, excerpt, onClick }: {
    title: string
    subtitle?: string
    pageRange?: string
    excerpt?: string
    onClick?: () => void
}) {
    return (
        <div
            className={cn(
                "bg-background/50 border border-border/40 rounded-lg p-2.5 transition-all overflow-hidden group/card",
                onClick ? "cursor-pointer hover:border-border/80 hover:shadow-sm" : ""
            )}
            onClick={onClick}
        >
            <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="h-5 w-5 rounded bg-blue-500/10 flex items-center justify-center shrink-0">
                        <FileText className="h-3 w-3 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                        <span className="text-xs font-medium truncate text-foreground/90 block">{title}</span>
                        {subtitle && (
                            <span className="text-2xs text-muted-foreground/60 truncate block">{subtitle}</span>
                        )}
                    </div>
                </div>
                {pageRange && (
                    <span className="text-2xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">
                        {pageRange}
                    </span>
                )}
            </div>
            {excerpt && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-7 border-l-2 border-primary/10 group-hover/card:border-primary/30 transition-colors">
                    {excerpt}
                </p>
            )}
        </div>
    )
}

// ─── EmptyState ─────────────────────────────────────────────────────────────

/**
 * Centered empty-state placeholder used when a list/view has no items.
 * Consumers pass their own icon, title, and description; optional children
 * render below the text (e.g. action buttons).
 */
export function EmptyState({ icon, title, description, className, children }: {
    icon: React.ReactNode
    title: string
    description?: string
    className?: string
    children?: React.ReactNode
}) {
    return (
        <div className={cn("flex flex-col items-center justify-center text-center", className)}>
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                {icon}
            </div>
            <h3 className="font-semibold mb-2">{title}</h3>
            {description && (
                <p className="text-sm text-muted-foreground text-balance max-w-md">{description}</p>
            )}
            {children}
        </div>
    )
}

// ─── QueryBadge ─────────────────────────────────────────────────────────────

/**
 * Pill-shaped badge for query type / chat mode labels.
 * Used in chat-interface (Single-Hop, Multi-Hop, etc.), research-chat (Cross-Doc),
 * and history/[conv_id] pages.
 *
 * @param colorClass  Combined bg + text Tailwind classes (e.g. "bg-primary/10 text-primary")
 */
export function QueryBadge({ label, colorClass = "bg-primary/10 text-primary" }: {
    label: string
    colorClass?: string
}) {
    return (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium", colorClass)}>
            {label}
        </span>
    )
}

// ─── StatCell / StatDivider ──────────────────────────────────────────────────

/**
 * Single metric cell used inside the stats row on dashboard, team-board,
 * team-review, and team-lead pages.
 *
 * @param colorClass  Full Tailwind text-color class (e.g. "text-emerald-400")
 */
export function StatCell({ value, label, colorClass }: {
    value: string | number
    label: string
    colorClass: string
}) {
    return (
        <div className="text-center">
            <p className={cn("text-sm-plus font-bold", colorClass)}>{value}</p>
            <p className="text-3xs text-muted-foreground/50 uppercase tracking-wider">{label}</p>
        </div>
    )
}

/** Vertical divider between stat cell groups. */
export function StatDivider() {
    return <div className="h-8 w-px bg-border/40" />
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

// ─── EvidenceFileList ─────────────────────────────────────────────────────────

interface EvidenceFile {
    name: string
    url: string
    uploaded_at: string
    stored_name?: string
}

/**
 * Shared evidence-file list used by dashboard, team-board, team-review, team-lead.
 * Renders each file with open/download actions and an optional delete button.
 */
export function EvidenceFileList({ files, formatDate: fmtDate, onDelete, readOnly = false }: {
    files: EvidenceFile[]
    formatDate: (iso: string | undefined) => string
    onDelete?: (idx: number) => void
    readOnly?: boolean
}) {
    if (files.length === 0) return null
    return (
        <div className="space-y-1.5">
            {files.map((file, idx) => {
                const fileUrl = getEvidenceFileUrl(file.url)
                return (
                    <div key={idx} className="flex items-center gap-3 bg-background rounded-lg px-3 py-2 border border-border/30 group/file hover:border-border/60 transition-colors">
                        <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <FileText className="h-3.5 w-3.5 text-primary/70" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs-plus font-medium text-foreground/90 truncate">{file.name}</p>
                            <p className="text-3xs text-muted-foreground/40">
                                Uploaded {fmtDate(file.uploaded_at)}
                            </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            {fileUrl && (
                                <>
                                    <a
                                        href={fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                        title="Open in new tab"
                                    >
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <a
                                        href={fileUrl}
                                        download={file.name}
                                        className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-colors"
                                        title="Download"
                                    >
                                        <Download className="h-3 w-3" />
                                    </a>
                                </>
                            )}
                            {!readOnly && onDelete && (
                                <button
                                    onClick={() => onDelete(idx)}
                                    className="p-1 rounded-md hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-500 transition-colors"
                                    title="Remove file"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                    </div>
                )
            })}
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
        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium", config.color)}>
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
        <div className="flex items-center gap-2 text-xs-plus">
            <span className="w-28 text-muted-foreground truncate">{name}</span>
            <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-10 text-right font-mono text-muted-foreground">{seconds.toFixed(1)}s</span>
        </div>
    )
}
