"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Sidebar } from "@/components/layout/sidebar"
import { useTestingItems } from "@/lib/use-testing-items"
import { fetchTestingMakers, type TesterUser } from "@/lib/testing-api"
import type { TestingItem } from "@/lib/types"
import { toast } from "sonner"
import {
    ClipboardList, Search, Send, ChevronDown, ChevronRight, Clock,
    CheckCircle2, XCircle, Calendar, RefreshCw, Loader2, MessageSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
    assigned_to_tester: { label: "Assigned to You", color: "text-blue-400", bg: "bg-blue-400/10" },
    tester_review: { label: "Your Review", color: "text-indigo-400", bg: "bg-indigo-400/10" },
    assigned_to_maker: { label: "With Maker", color: "text-purple-400", bg: "bg-purple-400/10" },
    maker_open: { label: "Open (Maker)", color: "text-amber-400", bg: "bg-amber-400/10" },
    checker_review: { label: "Checker Review", color: "text-teal-400", bg: "bg-teal-400/10" },
    active: { label: "Active", color: "text-cyan-400", bg: "bg-cyan-400/10" },
    maker_closed: { label: "Closed (Maker)", color: "text-emerald-400", bg: "bg-emerald-400/10" },
    tester_validation: { label: "Your Validation", color: "text-orange-400", bg: "bg-orange-400/10" },
    passed: { label: "Passed", color: "text-green-400", bg: "bg-green-400/10" },
    rejected_to_maker: { label: "Rejected (Rework)", color: "text-red-400", bg: "bg-red-400/10" },
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

export default function TesterPage() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userName = session?.user?.name || session?.user?.email || ""
    const userId = (session?.user as Record<string, unknown>)?.id as string || ""

    const {
        items, loading, load,
        handleForwardToMaker, handleTesterVerdict, handleAddComment,
    } = useTestingItems()

    const [searchQuery, setSearchQuery] = React.useState("")
    const [tab, setTab] = React.useState<"pending" | "validation" | "all">("pending")
    const [expandedItem, setExpandedItem] = React.useState<string | null>(null)

    // Forward to maker form
    const [forwardingItem, setForwardingItem] = React.useState<string | null>(null)
    const [forwardMakerName, setForwardMakerName] = React.useState("")
    const [forwardMakerId, setForwardMakerId] = React.useState("")
    const [makers, setMakers] = React.useState<TesterUser[]>([])

    React.useEffect(() => {
        fetchTestingMakers().then(r => setMakers(r.makers)).catch(() => {})
    }, [])

    // Verdict form
    const [verdictItem, setVerdictItem] = React.useState<string | null>(null)
    const [verdictReason, setVerdictReason] = React.useState("")

    // Comment form
    const [commentItem, setCommentItem] = React.useState<string | null>(null)
    const [commentText, setCommentText] = React.useState("")

    // Filter items assigned to this tester
    const myItems = React.useMemo(() => {
        return items.filter(i => {
            // Show items assigned to this tester (by name match or ID)
            if (i.assigned_tester_name !== userName && i.assigned_tester_id !== userId) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${i.source_actionable_text} ${i.source_theme} ${i.source_workstream} ${i.id}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            return true
        })
    }, [items, userName, userId, searchQuery])

    const pendingItems = React.useMemo(() =>
        myItems.filter(i => i.status === "assigned_to_tester" || i.status === "tester_review"), [myItems])
    const validationItems = React.useMemo(() =>
        myItems.filter(i => i.status === "tester_validation" || i.status === "maker_closed"), [myItems])
    const allItems = myItems

    const displayItems = tab === "pending" ? pendingItems : tab === "validation" ? validationItems : allItems

    // Stats
    const stats = React.useMemo(() => ({
        total: myItems.length,
        pending: pendingItems.length,
        validation: validationItems.length,
        passed: myItems.filter(i => i.status === "passed").length,
    }), [myItems, pendingItems, validationItems])

    const handleDoForward = async (itemId: string) => {
        if (!forwardMakerName.trim()) { toast.error("Maker name is required"); return }
        await handleForwardToMaker(itemId, forwardMakerId || forwardMakerName, forwardMakerName, userName)
        setForwardingItem(null)
        setForwardMakerName("")
        setForwardMakerId("")
    }

    const handleDoVerdict = async (itemId: string, verdict: "pass" | "reject") => {
        if (verdict === "reject" && !verdictReason.trim()) { toast.error("Reason is required for rejection"); return }
        await handleTesterVerdict(itemId, verdict, userName, verdictReason)
        setVerdictItem(null)
        setVerdictReason("")
    }

    const handleDoComment = async (itemId: string) => {
        if (!commentText.trim()) return
        await handleAddComment(itemId, userName, "tester", commentText)
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
                            <ClipboardList className="h-4 w-4 text-teal-500" />
                            My Testing Items
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 font-mono">{stats.pending} pending</span>
                        <span className="px-2 py-0.5 rounded bg-orange-400/10 text-orange-400 font-mono">{stats.validation} validation</span>
                        <span className="px-2 py-0.5 rounded bg-green-400/10 text-green-400 font-mono">{stats.passed} passed</span>
                        <span className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{stats.total} total</span>
                    </div>
                </div>

                {/* Tabs + Filters */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5">
                        {(["pending", "validation", "all"] as const).map(t => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    "px-3 py-1 text-xs rounded transition-colors",
                                    tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t === "pending" ? "Pending Review" : t === "validation" ? "Validation" : "All Items"}
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
                    {loading && myItems.length === 0 ? (
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
                                {item.testing_deadline && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                                        <Clock className="h-3 w-3" />{formatDate(item.testing_deadline)}
                                    </span>
                                )}
                                {/* Action buttons based on status */}
                                {(item.status === "assigned_to_tester" || item.status === "tester_review") && (
                                    <Button
                                        variant="outline" size="sm"
                                        className="h-6 text-[10px] gap-1 text-purple-400 border-purple-400/30 hover:bg-purple-400/10"
                                        onClick={() => setForwardingItem(item.id)}
                                    >
                                        <Send className="h-3 w-3" />Forward to Maker
                                    </Button>
                                )}
                                {(item.status === "tester_validation" || item.status === "maker_closed") && (
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="outline" size="sm"
                                            className="h-6 text-[10px] gap-1 text-green-400 border-green-400/30 hover:bg-green-400/10"
                                            onClick={() => handleDoVerdict(item.id, "pass")}
                                        >
                                            <CheckCircle2 className="h-3 w-3" />Pass
                                        </Button>
                                        <Button
                                            variant="outline" size="sm"
                                            className="h-6 text-[10px] gap-1 text-red-400 border-red-400/30 hover:bg-red-400/10"
                                            onClick={() => setVerdictItem(item.id)}
                                        >
                                            <XCircle className="h-3 w-3" />Reject
                                        </Button>
                                    </div>
                                )}
                                <button
                                    onClick={() => setCommentItem(commentItem === item.id ? null : item.id)}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                </button>
                                <button
                                    onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                                    className="text-muted-foreground hover:text-foreground"
                                >
                                    {expandedItem === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                            </div>

                            {/* Forward to maker form */}
                            {forwardingItem === item.id && (
                                <div className="px-4 py-2.5 bg-muted/20 border-t border-border/20 flex items-end gap-3">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-muted-foreground mb-1 block">Select Maker</label>
                                        {makers.length > 0 ? (
                                            <select
                                                value={forwardMakerId}
                                                onChange={e => {
                                                    const selected = makers.find(m => m.id === e.target.value)
                                                    setForwardMakerId(e.target.value)
                                                    setForwardMakerName(selected?.name || "")
                                                }}
                                                className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                            >
                                                <option value="">-- Select a maker --</option>
                                                {makers.map(m => (
                                                    <option key={m.id} value={m.id}>{m.name}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <input
                                                value={forwardMakerName}
                                                onChange={e => setForwardMakerName(e.target.value)}
                                                placeholder="Enter maker name"
                                                className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                            />
                                        )}
                                    </div>
                                    <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleDoForward(item.id)}>
                                        <Send className="h-3 w-3" />Forward
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setForwardingItem(null); setForwardMakerName(""); setForwardMakerId("") }}>Cancel</Button>
                                </div>
                            )}

                            {/* Reject reason form */}
                            {verdictItem === item.id && (
                                <div className="px-4 py-2.5 bg-red-400/5 border-t border-border/20 flex items-end gap-3">
                                    <div className="flex-1">
                                        <label className="text-[10px] text-muted-foreground mb-1 block">Rejection Reason</label>
                                        <input
                                            value={verdictReason}
                                            onChange={e => setVerdictReason(e.target.value)}
                                            placeholder="Enter reason for rejection..."
                                            className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                        />
                                    </div>
                                    <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={() => handleDoVerdict(item.id, "reject")}>
                                        <XCircle className="h-3 w-3" />Reject
                                    </Button>
                                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setVerdictItem(null); setVerdictReason("") }}>Cancel</Button>
                                </div>
                            )}

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
                                        <div><span className="text-muted-foreground">Maker:</span> <span className="ml-1">{item.assigned_maker_name || "Not assigned"}</span></div>
                                        <div><span className="text-muted-foreground">Maker Decision:</span> <span className="ml-1">{item.maker_decision ? item.maker_decision.toUpperCase() : "—"}</span></div>
                                        <div><span className="text-muted-foreground">Rework Count:</span> <span className="ml-1">{item.rework_count || 0}</span></div>
                                    </div>
                                    {item.maker_deadline && (
                                        <div className="flex items-center gap-1 text-muted-foreground">
                                            <Calendar className="h-3 w-3" />Maker Deadline: {formatDate(item.maker_deadline)}
                                            {item.maker_deadline_confirmed && <CheckCircle2 className="h-3 w-3 text-green-400 ml-1" />}
                                        </div>
                                    )}
                                    {item.tester_pass_reject_reason && (
                                        <div className="text-red-400">Last rejection: {item.tester_pass_reject_reason}</div>
                                    )}
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
