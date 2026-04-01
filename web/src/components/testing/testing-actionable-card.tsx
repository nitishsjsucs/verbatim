"use client"

import * as React from "react"
import type { TestingItem } from "@/lib/types"
import {
    ChevronDown, ChevronRight, Send, Clock, Calendar,
    AlertTriangle, CheckCircle2, Timer, User, Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* ───── Status styles ───── */
const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
    pending_assignment:  { label: "Pending",          color: "text-gray-400",    bg: "bg-gray-400/10" },
    assigned_to_tester:  { label: "Assigned",         color: "text-blue-400",    bg: "bg-blue-400/10" },
    tester_review:       { label: "Tester Review",    color: "text-indigo-400",  bg: "bg-indigo-400/10" },
    assigned_to_maker:   { label: "With Maker",       color: "text-purple-400",  bg: "bg-purple-400/10" },
    maker_open:          { label: "Open",             color: "text-amber-400",   bg: "bg-amber-400/10" },
    checker_review:      { label: "Checker Review",   color: "text-teal-400",    bg: "bg-teal-400/10" },
    active:              { label: "Active",           color: "text-cyan-400",    bg: "bg-cyan-400/10" },
    maker_closed:        { label: "Closed",           color: "text-emerald-400", bg: "bg-emerald-400/10" },
    tester_validation:   { label: "Validation",       color: "text-orange-400",  bg: "bg-orange-400/10" },
    passed:              { label: "Passed",           color: "text-green-400",   bg: "bg-green-400/10" },
    rejected_to_maker:   { label: "Rejected",         color: "text-red-400",     bg: "bg-red-400/10" },
    delayed:             { label: "Delayed",          color: "text-rose-400",    bg: "bg-rose-400/10" },
}

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_STYLES[status] || STATUS_STYLES.pending_assignment
    return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0", s.color, s.bg)}>{s.label}</span>
}

function formatDateDMY(iso: string): string {
    if (!iso) return ""
    const parts = iso.split("T")[0].split("-")
    if (parts.length !== 3) return iso
    return `${parts[2]}-${parts[1]}-${parts[0]}`
}

function DeadlineInfo({ deadline }: { deadline: string }) {
    if (!deadline) return null
    const now = new Date()
    const dl = new Date(deadline)
    const diffMs = dl.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" />Overdue by {Math.abs(diffDays)}d</span>
    if (diffDays <= 7) return <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-0.5"><Timer className="h-3 w-3" />{diffDays}d left</span>
    return <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="h-3 w-3" />{diffDays}d left</span>
}

/* ───── Card Props ───── */
interface TestingActionableCardProps {
    item: TestingItem
    isSelected: boolean
    onSelect: () => void
    isChecked: boolean
    onCheck: () => void
    onAssign?: (itemId: string) => void
    sectionColor?: string
}

export function TestingActionableCard({
    item, isSelected, onSelect, isChecked, onCheck, onAssign, sectionColor = "text-teal-400",
}: TestingActionableCardProps) {
    const [expanded, setExpanded] = React.useState(false)

    return (
        <div
            className={cn(
                "border rounded-lg overflow-hidden transition-all",
                isSelected ? "border-primary/30 ring-1 ring-primary/10" : "border-border/30",
                item.status === "passed" && "border-green-500/20 opacity-70",
                item.status === "delayed" && "border-rose-500/20",
            )}
        >
            {/* Header row: Checkbox → Expand → Status → Text → Deadline → Tester → Assign */}
            <div className="flex items-center gap-1.5 px-3 py-2 hover:bg-muted/20 transition-colors">
                {/* Multi-select checkbox */}
                <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={onCheck}
                    onClick={e => e.stopPropagation()}
                    className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0 cursor-pointer"
                />

                <button onClick={() => { setExpanded(!expanded); onSelect() }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}

                    <StatusBadge status={item.status} />

                    {/* Actionable text */}
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground/90 leading-relaxed truncate">
                            {item.source_actionable_text || "—"}
                        </p>
                    </div>
                </button>

                {/* Right-side info */}
                <div className="flex items-center gap-1.5 shrink-0">
                    {/* Workstream tag */}
                    {item.source_workstream && (
                        <span className="text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/30">{item.source_workstream}</span>
                    )}

                    {/* Deadline countdown */}
                    {item.testing_deadline && <DeadlineInfo deadline={item.testing_deadline} />}

                    {/* Assigned tester */}
                    {item.assigned_tester_name && (
                        <span className="text-[10px] text-blue-400 flex items-center gap-0.5 shrink-0">
                            <User className="h-3 w-3" />{item.assigned_tester_name}
                        </span>
                    )}

                    {/* Assign button (only when pending) */}
                    {item.status === "pending_assignment" && onAssign && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onAssign(item.id) }}
                            className={cn("p-1 rounded hover:bg-teal-400/10 text-muted-foreground/40 hover:text-teal-400 transition-colors")}
                            title="Assign tester"
                        >
                            <Send className="h-3.5 w-3.5" />
                        </button>
                    )}

                    {/* Passed badge */}
                    {item.status === "passed" && (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium text-green-400 bg-green-400/10">
                            Passed
                        </span>
                    )}
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="px-3 pb-3 space-y-2.5 border-t border-border/20 pt-2.5">
                    {/* Source info */}
                    <div className="flex items-start gap-3">
                        <div className="flex-1">
                            <p className="text-xs font-medium text-muted-foreground/60 mb-0.5">Actionable Text</p>
                            <p className="text-xs text-foreground/80">{item.source_actionable_text || "—"}</p>
                        </div>
                        <div className="shrink-0 text-right">
                            <p className="text-[10px] font-mono text-muted-foreground/50">{item.id}</p>
                        </div>
                    </div>

                    {/* Detail grid */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                        <div>
                            <span className="text-muted-foreground/60">Source Doc: </span>
                            <span className="text-foreground/80">{item.source_doc_name || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground/60">Theme: </span>
                            <span className="text-foreground/80">{item.source_theme || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground/60">Tranche 3: </span>
                            <span className="text-foreground/80">{item.source_tranche3 || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground/60">New Product: </span>
                            <span className={cn("text-foreground/80", item.source_new_product === "Yes" && "text-cyan-400 font-medium")}>{item.source_new_product || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground/60">Team: </span>
                            <span className="text-foreground/80">{item.source_workstream || "—"}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground/60">Section: </span>
                            <span className="text-foreground/80 capitalize">{item.testing_section || "—"}</span>
                        </div>
                    </div>

                    {/* Assignment info */}
                    {(item.assigned_tester_name || item.assigned_maker_name) && (
                        <div className="rounded-md border border-border/20 p-2 bg-muted/5">
                            <p className="text-[10px] font-semibold text-foreground/60 uppercase tracking-wider mb-1.5">Assignment</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                {item.assigned_tester_name && (
                                    <div>
                                        <span className="text-muted-foreground/60">Tester: </span>
                                        <span className="text-blue-400">{item.assigned_tester_name}</span>
                                    </div>
                                )}
                                {item.assigned_maker_name && (
                                    <div>
                                        <span className="text-muted-foreground/60">Maker: </span>
                                        <span className="text-purple-400">{item.assigned_maker_name}</span>
                                    </div>
                                )}
                                {item.maker_decision && (
                                    <div>
                                        <span className="text-muted-foreground/60">Maker Decision: </span>
                                        <span className="text-foreground/80 uppercase font-medium">{item.maker_decision}</span>
                                    </div>
                                )}
                                {item.rework_count > 0 && (
                                    <div>
                                        <span className="text-muted-foreground/60">Rework Count: </span>
                                        <span className="text-rose-400 font-medium">{item.rework_count}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Deadlines */}
                    <div className="space-y-1">
                        {item.testing_deadline && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Testing Deadline: <span className="text-foreground/80 font-mono">{formatDateDMY(item.testing_deadline)}</span>
                                <DeadlineInfo deadline={item.testing_deadline} />
                            </div>
                        )}
                        {item.computed_deadline && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Product Deadline (live+6mo): <span className="text-foreground/80 font-mono">{formatDateDMY(item.computed_deadline)}</span>
                            </div>
                        )}
                        {item.maker_deadline && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Maker Deadline: <span className="text-foreground/80 font-mono">{formatDateDMY(item.maker_deadline)}</span>
                                {item.maker_deadline_confirmed && <CheckCircle2 className="h-3 w-3 text-green-400 ml-1" />}
                            </div>
                        )}
                        {item.source_product_live_date && item.testing_section === "product" && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />Product Live Date: <span className="text-foreground/80 font-mono">{formatDateDMY(item.source_product_live_date)}</span>
                            </div>
                        )}
                    </div>

                    {/* Delay warning */}
                    {item.is_testing_delayed && (
                        <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-400/5 rounded px-2 py-1.5 border border-rose-400/20">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span className="font-semibold">This item is DELAYED</span>
                            {item.delay_detected_at && <span className="text-[10px] text-rose-400/60 ml-auto">since {formatDateDMY(item.delay_detected_at)}</span>}
                        </div>
                    )}

                    {/* Cycle year for tranche3 */}
                    {item.testing_section === "tranche3" && item.testing_cycle_year > 0 && (
                        <div className="text-[10px] text-muted-foreground/50">
                            Testing Cycle Year: <span className="font-mono">{item.testing_cycle_year}</span>
                        </div>
                    )}

                    {/* Timestamps footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/10 text-[10px] text-muted-foreground/40">
                        <span>Created: {formatDateDMY(item.created_at)}</span>
                        {item.passed_at && <span>Passed: {formatDateDMY(item.passed_at)}</span>}
                    </div>
                </div>
            )}
        </div>
    )
}
