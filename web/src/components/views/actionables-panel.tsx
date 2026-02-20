"use client"

import * as React from "react"
import {
    Shield, ShieldAlert, ShieldCheck, ShieldQuestion, AlertTriangle,
    ChevronDown, ChevronRight, Loader2, Play, BarChart3, Clock,
    User, Zap, FileText, Filter, Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { fetchActionables, extractActionablesStreaming, ExtractionProgressEvent } from "@/lib/api"
import {
    ActionableItem, ActionablesResult, ActionableModality, ActionableWorkstream,
} from "@/lib/types"

// --- Color/icon config ---

const MODALITY_CONFIG: Record<ActionableModality, { color: string; bg: string; icon: React.ReactNode }> = {
    Mandatory: { color: "text-red-400", bg: "bg-red-400/10", icon: <Shield className="h-3 w-3" /> },
    Prohibited: { color: "text-orange-400", bg: "bg-orange-400/10", icon: <ShieldAlert className="h-3 w-3" /> },
    Permitted: { color: "text-green-400", bg: "bg-green-400/10", icon: <ShieldCheck className="h-3 w-3" /> },
    Recommended: { color: "text-blue-400", bg: "bg-blue-400/10", icon: <ShieldQuestion className="h-3 w-3" /> },
}

const WORKSTREAM_COLORS: Record<string, string> = {
    Policy: "bg-purple-400/15 text-purple-400",
    Technology: "bg-cyan-400/15 text-cyan-400",
    Operations: "bg-amber-400/15 text-amber-400",
    Training: "bg-pink-400/15 text-pink-400",
    Reporting: "bg-emerald-400/15 text-emerald-400",
    "Customer Communication": "bg-sky-400/15 text-sky-400",
    Governance: "bg-indigo-400/15 text-indigo-400",
    Legal: "bg-rose-400/15 text-rose-400",
    Other: "bg-muted text-muted-foreground",
}

// --- Sub-components ---

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
    return (
        <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-lg font-semibold font-mono mt-0.5">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
        </div>
    )
}

function ModalityBar({ modality, count, total }: { modality: string; count: number; total: number }) {
    const pct = total > 0 ? (count / total) * 100 : 0
    const cfg = MODALITY_CONFIG[modality as ActionableModality] || MODALITY_CONFIG.Mandatory
    return (
        <div className="flex items-center gap-2 text-xs">
            <span className={cn("w-24 flex items-center gap-1.5", cfg.color)}>
                {cfg.icon}
                {modality}
            </span>
            <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full", cfg.bg.replace("/10", "/40"))} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-8 text-right font-mono text-muted-foreground">{count}</span>
        </div>
    )
}

function ActionableCard({ item, onSourceClick }: {
    item: ActionableItem
    onSourceClick?: (nodeId: string, pageNumber: number) => void
}) {
    const [expanded, setExpanded] = React.useState(false)
    const cfg = MODALITY_CONFIG[item.modality] || MODALITY_CONFIG.Mandatory

    // Parse page number from source_location
    const handleSourceClick = () => {
        if (!onSourceClick) return
        const match = item.source_location.match(/p\.?\s*(\d+)/)
        if (match) {
            onSourceClick(item.source_node_id, parseInt(match[1], 10))
        }
    }

    return (
        <div className={cn(
            "border rounded-lg overflow-hidden transition-colors",
            item.needs_legal_review ? "border-amber-500/30" : "border-border/30",
            item.validation_status === "flagged" ? "border-red-500/30" : "",
        )}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
            >
                {expanded ? <ChevronDown className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 mt-1 shrink-0 text-muted-foreground" />}

                {/* Modality badge */}
                <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0", cfg.color, cfg.bg)}>
                    {cfg.icon}
                    {item.modality}
                </span>

                {/* Action summary */}
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground/90 leading-relaxed">
                        <span className="font-medium">{item.actor}</span>
                        {" "}
                        <span>{item.action}</span>
                        {item.object && <span className="text-muted-foreground"> — {item.object}</span>}
                    </p>
                </div>

                {/* Flags */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {item.needs_legal_review && (
                        <span className="text-amber-400" title="Needs legal review">
                            <AlertTriangle className="h-3 w-3" />
                        </span>
                    )}
                    <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-medium", WORKSTREAM_COLORS[item.workstream] || WORKSTREAM_COLORS.Other)}>
                        {item.workstream}
                    </span>
                </div>
            </button>

            {/* Expanded details */}
            {expanded && (
                <div className="px-3 pb-3 space-y-2.5 border-t border-border/20 pt-2">
                    {/* Evidence quote */}
                    {item.evidence_quote && (
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Evidence</p>
                            <p className="text-xs text-muted-foreground/80 italic border-l-2 border-primary/20 pl-2">
                                &ldquo;{item.evidence_quote}&rdquo;
                            </p>
                        </div>
                    )}

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        {item.trigger_or_condition && (
                            <div className="col-span-2">
                                <span className="text-muted-foreground/60 text-[10px]">Condition: </span>
                                <span className="text-muted-foreground/90">{item.trigger_or_condition}</span>
                            </div>
                        )}
                        {item.thresholds && (
                            <div>
                                <span className="text-muted-foreground/60 text-[10px]">Threshold: </span>
                                <span className="text-muted-foreground/90 font-mono">{item.thresholds}</span>
                            </div>
                        )}
                        {item.deadline_or_frequency && (
                            <div>
                                <span className="text-muted-foreground/60 text-[10px]">Deadline/Freq: </span>
                                <span className="text-muted-foreground/90">{item.deadline_or_frequency}</span>
                            </div>
                        )}
                        {item.effective_date && (
                            <div>
                                <span className="text-muted-foreground/60 text-[10px]">Effective: </span>
                                <span className="text-muted-foreground/90">{item.effective_date}</span>
                            </div>
                        )}
                        {item.reporting_or_notification_to && (
                            <div>
                                <span className="text-muted-foreground/60 text-[10px]">Report to: </span>
                                <span className="text-muted-foreground/90">{item.reporting_or_notification_to}</span>
                            </div>
                        )}
                    </div>

                    {/* Implementation notes */}
                    {item.implementation_notes && (
                        <div>
                            <p className="text-[10px] font-medium text-muted-foreground mb-0.5">Implementation</p>
                            <p className="text-xs text-muted-foreground/80">{item.implementation_notes}</p>
                        </div>
                    )}

                    {/* Source + validation */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/10">
                        <button
                            onClick={handleSourceClick}
                            className="text-[10px] text-primary hover:underline flex items-center gap-1"
                        >
                            <FileText className="h-3 w-3" />
                            {item.source_location}
                        </button>
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded",
                                item.validation_status === "validated" ? "bg-green-400/10 text-green-400" :
                                item.validation_status === "flagged" ? "bg-red-400/10 text-red-400" :
                                item.validation_status === "added_by_validator" ? "bg-blue-400/10 text-blue-400" :
                                "bg-muted text-muted-foreground",
                            )}>
                                {item.validation_status}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground/50">{item.id}</span>
                        </div>
                    </div>

                    {/* Validation notes */}
                    {item.validation_notes && (
                        <p className="text-[10px] text-muted-foreground/60 italic">{item.validation_notes}</p>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Main component ---

interface ActionablesPanelProps {
    docId: string
    className?: string
    onSourceClick?: (nodeId: string, pageNumber: number) => void
}

// --- Progress state ---
interface ExtractionProgress {
    stage: "prefilter" | "extracting" | "validating" | "done"
    candidateCount: number
    totalNodes: number
    totalBatches: number
    currentBatch: number
    currentSections: string[]
    cumulativeActionables: number
    lastBatchActionables: number
}

const INITIAL_PROGRESS: ExtractionProgress = {
    stage: "prefilter",
    candidateCount: 0,
    totalNodes: 0,
    totalBatches: 0,
    currentBatch: 0,
    currentSections: [],
    cumulativeActionables: 0,
    lastBatchActionables: 0,
}

export function ActionablesPanel({ docId, className, onSourceClick }: ActionablesPanelProps) {
    const [result, setResult] = React.useState<ActionablesResult | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [extracting, setExtracting] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)
    const [progress, setProgress] = React.useState<ExtractionProgress>(INITIAL_PROGRESS)

    // Filters
    const [modalityFilter, setModalityFilter] = React.useState<ActionableModality | "all">("all")
    const [workstreamFilter, setWorkstreamFilter] = React.useState<ActionableWorkstream | "all">("all")
    const [searchQuery, setSearchQuery] = React.useState("")

    React.useEffect(() => {
        loadActionables()
    }, [docId])

    async function loadActionables() {
        try {
            setLoading(true)
            setError(null)
            const data = await fetchActionables(docId)
            setResult(data)
        } catch {
            setError("Could not load actionables")
        } finally {
            setLoading(false)
        }
    }

    async function handleExtract(force: boolean = false) {
        try {
            setExtracting(true)
            setError(null)
            setProgress(INITIAL_PROGRESS)

            const data = await extractActionablesStreaming(docId, force, (event: ExtractionProgressEvent) => {
                switch (event.event) {
                    case "start":
                        setProgress(p => ({ ...p, stage: "prefilter", totalNodes: event.total_nodes ?? 0 }))
                        break
                    case "prefilter_done":
                        setProgress(p => ({
                            ...p,
                            candidateCount: event.candidate_count ?? 0,
                            totalNodes: event.total_nodes ?? p.totalNodes,
                        }))
                        break
                    case "batches_planned":
                        setProgress(p => ({
                            ...p,
                            stage: "extracting",
                            totalBatches: event.total_batches ?? 0,
                            candidateCount: event.candidate_count ?? p.candidateCount,
                        }))
                        break
                    case "batch_start":
                        setProgress(p => ({
                            ...p,
                            currentBatch: event.batch ?? p.currentBatch,
                            currentSections: event.sections ?? [],
                        }))
                        break
                    case "batch_done":
                        setProgress(p => ({
                            ...p,
                            currentBatch: event.batch ?? p.currentBatch,
                            lastBatchActionables: event.batch_actionables ?? 0,
                            cumulativeActionables: event.cumulative_actionables ?? p.cumulativeActionables,
                        }))
                        break
                    case "validation_start":
                        setProgress(p => ({
                            ...p,
                            stage: "validating",
                            cumulativeActionables: event.total_actionables ?? p.cumulativeActionables,
                        }))
                        break
                    case "validation_done":
                        setProgress(p => ({ ...p, stage: "done" }))
                        break
                }
            })

            setResult(data)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Extraction failed")
        } finally {
            setExtracting(false)
        }
    }

    // Filter actionables
    const filtered = React.useMemo(() => {
        if (!result?.actionables) return []
        return result.actionables.filter(a => {
            if (modalityFilter !== "all" && a.modality !== modalityFilter) return false
            if (workstreamFilter !== "all" && a.workstream !== workstreamFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const searchable = `${a.actor} ${a.action} ${a.object} ${a.evidence_quote} ${a.implementation_notes}`.toLowerCase()
                if (!searchable.includes(q)) return false
            }
            return true
        })
    }, [result, modalityFilter, workstreamFilter, searchQuery])

    if (loading) {
        return (
            <div className={cn("flex items-center justify-center h-full", className)}>
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        )
    }

    // While extracting — ALWAYS show the progress view (even if we have prior results)
    if (extracting) {
        const batchPct = progress.totalBatches > 0
            ? Math.round((progress.currentBatch / progress.totalBatches) * 100)
            : 0

        const stageLabel =
            progress.stage === "prefilter" ? "Scanning document for deontic language..." :
            progress.stage === "extracting" ? `Extracting batch ${progress.currentBatch} of ${progress.totalBatches}` :
            progress.stage === "validating" ? "Validating & deduplicating actionables..." :
            "Finishing up..."

        return (
            <div className={cn("flex flex-col items-center justify-center h-full text-center p-6", className)}>
                <div className="w-full max-w-md space-y-6">
                    {/* Spinner + stage label */}
                    <div className="flex items-center justify-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span className="text-sm font-medium">{stageLabel}</span>
                    </div>

                    {/* Batch progress bar (only during extraction) */}
                    {progress.stage === "extracting" && progress.totalBatches > 0 && (
                        <div className="space-y-2">
                            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-primary/60 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${batchPct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>{batchPct}%</span>
                                <span>Batch {progress.currentBatch}/{progress.totalBatches}</span>
                            </div>
                        </div>
                    )}

                    {/* Validation progress (indeterminate) */}
                    {progress.stage === "validating" && (
                        <div className="space-y-2">
                            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden">
                                <div className="h-full bg-primary/40 rounded-full animate-pulse w-full" />
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Verifying {progress.cumulativeActionables} actionables against source text...
                            </p>
                        </div>
                    )}

                    {/* Stats cards */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-muted/30 rounded-lg p-3 text-left">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Nodes scanned</p>
                            <p className="text-lg font-semibold font-mono mt-0.5">
                                {progress.candidateCount > 0 ? progress.candidateCount : "..."}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60">of {progress.totalNodes || "?"} total</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-3 text-left">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Found so far</p>
                            <p className="text-lg font-semibold font-mono mt-0.5 text-primary">
                                {progress.cumulativeActionables}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60">actionables</p>
                        </div>
                        <div className="bg-muted/30 rounded-lg p-3 text-left">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Last batch</p>
                            <p className="text-lg font-semibold font-mono mt-0.5">
                                +{progress.lastBatchActionables}
                            </p>
                            <p className="text-[10px] text-muted-foreground/60">new items</p>
                        </div>
                    </div>

                    {/* Current sections being processed */}
                    {progress.currentSections.length > 0 && (
                        <div className="text-left">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                                Processing sections
                            </p>
                            <div className="space-y-0.5">
                                {progress.currentSections.map((s, i) => (
                                    <p key={i} className="text-xs text-muted-foreground/70 truncate flex items-center gap-1.5">
                                        <FileText className="h-3 w-3 shrink-0" />
                                        {s}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {error && <p className="text-xs text-red-400">{error}</p>}
                </div>
            </div>
        )
    }

    // Not yet extracted — show extract button
    if (!result || result.status === "not_extracted" || !result.actionables || result.actionables.length === 0) {
        return (
            <div className={cn("flex flex-col items-center justify-center h-full text-center p-6", className)}>
                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
                    <Shield className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-base font-medium mb-2">Extract Compliance Actionables</h3>
                <p className="text-sm text-muted-foreground/70 max-w-md mb-6">
                    Scan this document for all obligations, prohibitions, permissions, and recommendations.
                    Each actionable is extracted with its actor, conditions, deadlines, and evidence quote.
                </p>
                {error && <p className="text-xs text-red-400 mb-4">{error}</p>}
                <Button
                    onClick={() => handleExtract(false)}
                    className="gap-2"
                >
                    <Play className="h-4 w-4" />
                    Extract Actionables
                </Button>
            </div>
        )
    }

    // Show results
    const modalities = Object.entries(result.by_modality || {})
    const workstreams = Object.keys(result.by_workstream || {})

    return (
        <div className={cn("flex flex-col h-full", className)}>
            {/* Summary header */}
            <div className="shrink-0 border-b border-border/40 p-4 space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-4 gap-3">
                    <StatCard label="Total" value={result.total_extracted} />
                    <StatCard label="Validated" value={result.total_validated} />
                    <StatCard label="Flagged" value={result.total_flagged} />
                    <StatCard
                        label="Time"
                        value={`${result.extraction_time_seconds.toFixed(0)}s`}
                        sub={`${result.llm_calls} LLM calls`}
                    />
                </div>

                {/* Modality distribution */}
                {modalities.length > 0 && (
                    <div className="space-y-1.5">
                        {modalities.map(([mod, count]) => (
                            <ModalityBar key={mod} modality={mod} count={count} total={result.total_extracted} />
                        ))}
                    </div>
                )}

                {/* Filters */}
                <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search actionables..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-7 pr-3 py-1.5 border border-transparent focus:border-border focus:outline-none"
                        />
                    </div>
                    <select
                        value={modalityFilter}
                        onChange={e => setModalityFilter(e.target.value as ActionableModality | "all")}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All modalities</option>
                        <option value="Mandatory">Mandatory</option>
                        <option value="Prohibited">Prohibited</option>
                        <option value="Permitted">Permitted</option>
                        <option value="Recommended">Recommended</option>
                    </select>
                    <select
                        value={workstreamFilter}
                        onChange={e => setWorkstreamFilter(e.target.value as ActionableWorkstream | "all")}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All workstreams</option>
                        {workstreams.map(ws => (
                            <option key={ws} value={ws}>{ws}</option>
                        ))}
                    </select>
                </div>

                {/* Showing count + re-extract */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60">
                    <span>
                        Showing {filtered.length} of {result.total_extracted}
                        {result.extracted_at && ` · Extracted ${new Date(result.extracted_at).toLocaleDateString()}`}
                    </span>
                    <button
                        onClick={() => handleExtract(true)}
                        disabled={extracting}
                        className="hover:text-muted-foreground transition-colors flex items-center gap-1"
                    >
                        {extracting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Re-extract
                    </button>
                </div>
            </div>

            {/* Actionable list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {filtered.map(item => (
                    <ActionableCard
                        key={item.id}
                        item={item}
                        onSourceClick={onSourceClick}
                    />
                ))}
                {filtered.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground/60 py-12">
                        No actionables match the current filters
                    </div>
                )}
            </div>
        </div>
    )
}
