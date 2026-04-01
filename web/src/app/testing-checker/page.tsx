"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Sidebar } from "@/components/layout/sidebar"
import { useTestingItems } from "@/lib/use-testing-items"
import type { TestingItem } from "@/lib/types"
import { toast } from "sonner"
import {
    Eye, Search, ChevronDown, ChevronRight, Clock,
    CheckCircle2, Calendar, RefreshCw, Loader2, MessageSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
    checker_review: { label: "Needs Your Review", color: "text-teal-400", bg: "bg-teal-400/10" },
    active: { label: "Active (Confirmed)", color: "text-cyan-400", bg: "bg-cyan-400/10" },
    passed: { label: "Passed", color: "text-green-400", bg: "bg-green-400/10" },
    rejected_to_maker: { label: "Rejected to Maker", color: "text-red-400", bg: "bg-red-400/10" },
    maker_open: { label: "Open (Maker)", color: "text-amber-400", bg: "bg-amber-400/10" },
    maker_closed: { label: "Closed", color: "text-emerald-400", bg: "bg-emerald-400/10" },
    tester_validation: { label: "Tester Validating", color: "text-orange-400", bg: "bg-orange-400/10" },
}

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_STYLES[status] || { label: status, color: "text-gray-400", bg: "bg-gray-400/10" }
    return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", s.color, s.bg)}>{s.label}</span>
}

function formatDate(iso: string) {
    if (!iso) return "—"
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
    catch { return iso }
}

export default function TestingCheckerPage() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userName = session?.user?.name || session?.user?.email || ""

    const {
        items, loading, load,
        handleCheckerConfirm, handleAddComment,
    } = useTestingItems()

    const [searchQuery, setSearchQuery] = React.useState("")
    const [tab, setTab] = React.useState<"pending" | "confirmed" | "all">("pending")
    const [expandedItem, setExpandedItem] = React.useState<string | null>(null)
    const [commentItem, setCommentItem] = React.useState<string | null>(null)
    const [commentText, setCommentText] = React.useState("")

    // Checker sees items in "checker_review" status (needs their confirmation)
    // and items they've already confirmed ("active" and beyond)
    const relevantItems = React.useMemo(() => {
        return items.filter(i => {
            // Show items that are in checker_review or items already confirmed by this checker
            if (i.status === "checker_review") return true
            if (i.maker_deadline_confirmed && i.maker_deadline_confirmed_by === userName) return true
            return false
        }).filter(i => {
            if (!searchQuery) return true
            const q = searchQuery.toLowerCase()
            const s = `${i.source_actionable_text} ${i.source_theme} ${i.source_workstream} ${i.id} ${i.assigned_maker_name}`.toLowerCase()
            return s.includes(q)
        })
    }, [items, userName, searchQuery])

    const pendingItems = React.useMemo(() =>
        relevantItems.filter(i => i.status === "checker_review"), [relevantItems])
    const confirmedItems = React.useMemo(() =>
        relevantItems.filter(i => i.status !== "checker_review"), [relevantItems])

    const displayItems = tab === "pending" ? pendingItems : tab === "confirmed" ? confirmedItems : relevantItems

    const stats = React.useMemo(() => ({
        total: relevantItems.length,
        pending: pendingItems.length,
        confirmed: confirmedItems.length,
    }), [relevantItems, pendingItems, confirmedItems])

    const handleDoComment = async (itemId: string) => {
        if (!commentText.trim()) return
        await handleAddComment(itemId, userName, "testing_checker", commentText)
        setCommentItem(null)
        setCommentText("")
    }

    return (
        <RoleRedirect>
        <div className="flex h-screen bg-background">
            <Sidebar />
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Header */}
                <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
                    <div className="flex items-center gap-3">
                        <h1 className="flex items-center gap-2 text-sm font-semibold">
                            <Eye className="h-4 w-4 text-teal-500" />
                            Testing Checker
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-teal-400/10 text-teal-400 font-mono">{stats.pending} pending</span>
                        <span className="px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-mono">{stats.confirmed} confirmed</span>
                        <span className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{stats.total} total</span>
                    </div>
                </div>

                {/* Tabs + Filters */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5">
                        {(["pending", "confirmed", "all"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    "px-3 py-1 text-xs rounded transition-colors",
                                    tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t === "pending" ? "Needs Confirmation" : t === "confirmed" ? "Confirmed" : "All"}
                            </button>
                        ))}
                    </div>
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs ml-auto" onClick={load} disabled={loading}>
                        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Refresh
                    </Button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-2">
                    {loading && relevantItems.length === 0 ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : displayItems.length === 0 ? (
                        <div className="text-center py-12 text-xs text-muted-foreground">
                            No items in this tab
                        </div>
                    ) : displayItems.map(item => (
                        <div key={item.id} className="border border-border/30 rounded-lg overflow-hidden hover:border-border/50 transition-colors">
                            <div className="px-4 py-2.5 flex items-center gap-3">
                                <span className="text-[10px] font-mono text-muted-foreground w-24 shrink-0">{item.id}</span>
                                <StatusBadge status={item.status} />
                                <span className="text-xs flex-1 truncate">{item.source_actionable_text || "—"}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{item.source_workstream}</span>

                                {/* Show maker deadline prominently */}
                                {item.maker_deadline && (
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <Calendar className="h-3 w-3 text-amber-400" />
                                        <span className="text-[10px] font-semibold text-amber-400">
                                            Maker Deadline: {formatDate(item.maker_deadline)}
                                        </span>
                                        {item.maker_deadline_confirmed && (
                                            <CheckCircle2 className="h-3 w-3 text-green-400" />
                                        )}
                                    </div>
                                )}

                                {/* Testing deadline for context */}
                                {item.testing_deadline && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                                        <Clock className="h-3 w-3" />Test DL: {formatDate(item.testing_deadline)}
                                    </span>
                                )}

                                {/* Maker info */}
                                <span className="text-[10px] text-purple-400 shrink-0">
                                    Maker: {item.assigned_maker_name || "—"}
                                </span>

                                {/* Confirm button — only for checker_review items */}
                                {item.status === "checker_review" && (
                                    <Button
                                        variant="outline" size="sm"
                                        className="h-6 text-[10px] gap-1 text-green-400 border-green-400/30 hover:bg-green-400/10"
                                        onClick={() => handleCheckerConfirm(item.id, userName)}
                                    >
                                        <CheckCircle2 className="h-3 w-3" />Confirm Deadline
                                    </Button>
                                )}

                                <button onClick={() => setCommentItem(commentItem === item.id ? null : item.id)} className="text-muted-foreground hover:text-foreground">
                                    <MessageSquare className="h-3.5 w-3.5" />
                                </button>
                                <button onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)} className="text-muted-foreground hover:text-foreground">
                                    {expandedItem === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                            </div>

                            {/* Comment form */}
                            {commentItem === item.id && (
                                <div className="px-4 py-2.5 bg-muted/10 border-t border-border/20">
                                    {(item.testing_comments || []).length > 0 && (
                                        <div className="mb-2 space-y-1 max-h-32 overflow-y-auto">
                                            {(item.testing_comments || []).map((c: any, idx: number) => (
                                                <div key={idx} className="text-[10px] text-muted-foreground">
                                                    <span className="font-semibold text-foreground">{c.author}</span>
                                                    <span className="ml-1 text-muted-foreground/60">({c.role})</span>
                                                    <span className="ml-2">{c.text}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <input
                                            value={commentText}
                                            onChange={e => setCommentText(e.target.value)}
                                            placeholder="Add a comment..."
                                            className="flex-1 bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                            onKeyDown={e => { if (e.key === "Enter") handleDoComment(item.id) }}
                                        />
                                        <Button size="sm" className="h-7 text-xs" onClick={() => handleDoComment(item.id)}>Send</Button>
                                    </div>
                                </div>
                            )}

                            {/* Expanded details */}
                            {expandedItem === item.id && (
                                <div className="px-4 py-2.5 bg-muted/10 border-t border-border/20 text-xs space-y-1">
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                        <div><span className="text-muted-foreground">Source Doc:</span> <span className="ml-1">{item.source_doc_name}</span></div>
                                        <div><span className="text-muted-foreground">Section:</span> <span className="ml-1 capitalize">{item.testing_section}</span></div>
                                        <div><span className="text-muted-foreground">Theme:</span> <span className="ml-1">{item.source_theme || "—"}</span></div>
                                        <div><span className="text-muted-foreground">Tester:</span> <span className="ml-1">{item.assigned_tester_name || "—"}</span></div>
                                        <div><span className="text-muted-foreground">Maker Decision:</span> <span className="ml-1">{item.maker_decision ? item.maker_decision.toUpperCase() : "—"}</span></div>
                                        <div><span className="text-muted-foreground">Rework Count:</span> <span className="ml-1">{item.rework_count || 0}</span></div>
                                        {item.maker_deadline_confirmed && (
                                            <>
                                                <div><span className="text-muted-foreground">Confirmed By:</span> <span className="ml-1">{item.maker_deadline_confirmed_by}</span></div>
                                                <div><span className="text-muted-foreground">Confirmed At:</span> <span className="ml-1">{formatDate(item.maker_deadline_confirmed_at)}</span></div>
                                            </>
                                        )}
                                    </div>
                                    {/* Deadline comparison */}
                                    <div className="mt-2 p-2 bg-muted/20 rounded border border-border/20">
                                        <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Deadline Comparison</p>
                                        <div className="flex items-center gap-6">
                                            <div>
                                                <span className="text-muted-foreground">Testing Deadline:</span>
                                                <span className="ml-1 font-semibold">{formatDate(item.testing_deadline)}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Maker Deadline:</span>
                                                <span className="ml-1 font-semibold text-amber-400">{formatDate(item.maker_deadline)}</span>
                                            </div>
                                            {item.maker_deadline && item.testing_deadline && (
                                                <div>
                                                    {new Date(item.maker_deadline) <= new Date(item.testing_deadline) ? (
                                                        <span className="text-green-400 font-semibold">✓ Within testing deadline</span>
                                                    ) : (
                                                        <span className="text-red-400 font-semibold">⚠ Exceeds testing deadline</span>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
