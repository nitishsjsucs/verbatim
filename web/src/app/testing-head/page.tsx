"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Sidebar } from "@/components/layout/sidebar"
import { useTestingItems } from "@/lib/use-testing-items"
import { fetchTestingWindows, createTestingWindow } from "@/lib/testing-api"
import type { TestingItem } from "@/lib/types"
import { toast } from "sonner"
import {
    Eye, Search, Send, Plus, Calendar, ChevronDown, ChevronRight, Clock,
    AlertTriangle, CheckCircle2, Users, Filter, RefreshCw, Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SECTION_META: Record<string, { label: string; color: string; bg: string; description: string }> = {
    tranche3: { label: "Tranche 3 Testing", color: "text-red-400", bg: "bg-red-400/10", description: "Highest priority — Tranche 3 actionables" },
    product: { label: "Product Testing", color: "text-amber-400", bg: "bg-amber-400/10", description: "New product actionables" },
    theme: { label: "Theme Testing", color: "text-blue-400", bg: "bg-blue-400/10", description: "Theme-based actionables" },
    adhoc: { label: "Ad Hoc Testing", color: "text-purple-400", bg: "bg-purple-400/10", description: "Manual/window-based testing" },
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
    pending_assignment: { label: "Pending", color: "text-gray-400", bg: "bg-gray-400/10" },
    assigned_to_tester: { label: "Assigned", color: "text-blue-400", bg: "bg-blue-400/10" },
    tester_review: { label: "Tester Review", color: "text-indigo-400", bg: "bg-indigo-400/10" },
    assigned_to_maker: { label: "With Maker", color: "text-purple-400", bg: "bg-purple-400/10" },
    maker_open: { label: "Open", color: "text-amber-400", bg: "bg-amber-400/10" },
    checker_review: { label: "Checker Review", color: "text-teal-400", bg: "bg-teal-400/10" },
    active: { label: "Active", color: "text-cyan-400", bg: "bg-cyan-400/10" },
    maker_closed: { label: "Closed", color: "text-emerald-400", bg: "bg-emerald-400/10" },
    tester_validation: { label: "Validation", color: "text-orange-400", bg: "bg-orange-400/10" },
    passed: { label: "Passed", color: "text-green-400", bg: "bg-green-400/10" },
    rejected_to_maker: { label: "Rejected", color: "text-red-400", bg: "bg-red-400/10" },
}

function StatusBadge({ status }: { status: string }) {
    const s = STATUS_STYLES[status] || STATUS_STYLES.pending_assignment
    return <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", s.color, s.bg)}>{s.label}</span>
}

function formatDate(iso: string) {
    if (!iso) return "—"
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
    catch { return iso }
}

export default function TestingHeadPage() {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userName = session?.user?.name || session?.user?.email || ""
    const userId = (session?.user as Record<string, unknown>)?.id as string || ""

    const { items, loading, load, handleAssign, handlePullActionables } = useTestingItems()

    const [searchQuery, setSearchQuery] = React.useState("")
    const [sectionFilter, setSectionFilter] = React.useState<string>("all")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [collapsedSections, setCollapsedSections] = React.useState<Set<string>>(new Set())
    const [pulling, setPulling] = React.useState(false)
    const [expandedItem, setExpandedItem] = React.useState<string | null>(null)

    // Assignment form state
    const [assigningItem, setAssigningItem] = React.useState<string | null>(null)
    const [assignTesterName, setAssignTesterName] = React.useState("")
    const [assignTesterId, setAssignTesterId] = React.useState("")
    const [assignDeadline, setAssignDeadline] = React.useState("")

    const toggleSection = (s: string) => setCollapsedSections(prev => {
        const next = new Set(prev)
        if (next.has(s)) next.delete(s); else next.add(s)
        return next
    })

    // Group items by testing_section
    const grouped = React.useMemo(() => {
        const groups: Record<string, TestingItem[]> = { tranche3: [], product: [], theme: [], adhoc: [] }
        for (const item of items) {
            const sec = item.testing_section || "theme"
            if (!groups[sec]) groups[sec] = []
            // Filter
            if (sectionFilter !== "all" && sec !== sectionFilter) continue
            if (statusFilter !== "all" && item.status !== statusFilter) continue
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${item.source_actionable_text} ${item.source_theme} ${item.source_workstream} ${item.id}`.toLowerCase()
                if (!s.includes(q)) continue
            }
            groups[sec].push(item)
        }
        return groups
    }, [items, sectionFilter, statusFilter, searchQuery])

    // Stats
    const stats = React.useMemo(() => {
        const total = items.length
        const pending = items.filter(i => i.status === "pending_assignment").length
        const active = items.filter(i => !["pending_assignment", "passed"].includes(i.status)).length
        const passed = items.filter(i => i.status === "passed").length
        return { total, pending, active, passed }
    }, [items])

    const handlePull = async () => {
        setPulling(true)
        try { await handlePullActionables() }
        finally { setPulling(false) }
    }

    const handleDoAssign = async (itemId: string) => {
        if (!assignTesterName.trim() || !assignDeadline) {
            toast.error("Tester name and deadline are required")
            return
        }
        await handleAssign(itemId, assignTesterId || assignTesterName, assignTesterName, assignDeadline, userName)
        setAssigningItem(null)
        setAssignTesterName("")
        setAssignTesterId("")
        setAssignDeadline("")
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
                            Testing Head
                        </h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs">
                            <span className="px-2 py-0.5 rounded bg-gray-400/10 text-gray-400 font-mono">{stats.pending} pending</span>
                            <span className="px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-mono">{stats.active} active</span>
                            <span className="px-2 py-0.5 rounded bg-green-400/10 text-green-400 font-mono">{stats.passed} passed</span>
                            <span className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{stats.total} total</span>
                        </div>
                    </div>
                </div>

                {/* Filters */}
                <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 max-w-xs">
                        <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                        <input
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Search testing items..."
                            className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                        />
                    </div>
                    <select
                        value={sectionFilter}
                        onChange={e => setSectionFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Sections</option>
                        <option value="tranche3">Tranche 3</option>
                        <option value="product">Product</option>
                        <option value="theme">Theme</option>
                        <option value="adhoc">Ad Hoc</option>
                    </select>
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                    >
                        <option value="all">All Status</option>
                        {Object.entries(STATUS_STYLES).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                        ))}
                    </select>
                    {(sectionFilter !== "all" || statusFilter !== "all" || searchQuery) && (
                        <button
                            onClick={() => { setSectionFilter("all"); setStatusFilter("all"); setSearchQuery("") }}
                            className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40"
                        >
                            Clear Filters
                        </button>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs text-teal-400 border-teal-400/30 hover:bg-teal-400/10"
                            onClick={handlePull}
                            disabled={pulling}
                        >
                            {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                            Pull Actionables
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={load}
                            disabled={loading}
                        >
                            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            Refresh
                        </Button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {loading && items.length === 0 ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        (["tranche3", "product", "theme", "adhoc"] as string[]).map(sec => {
                            const meta = SECTION_META[sec]
                            const sectionItems = grouped[sec] || []
                            if (sectionFilter !== "all" && sec !== sectionFilter) return null
                            const isCollapsed = collapsedSections.has(sec)
                            return (
                                <div key={sec} className="border border-border/30 rounded-lg overflow-hidden">
                                    <button
                                        onClick={() => toggleSection(sec)}
                                        className={cn(
                                            "w-full px-4 py-2.5 flex items-center justify-between text-left",
                                            meta.bg, "hover:opacity-90 transition-opacity"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                            <span className={cn("text-xs font-semibold uppercase tracking-wider", meta.color)}>{meta.label}</span>
                                            <span className="text-[10px] text-muted-foreground">({sectionItems.length})</span>
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">{meta.description}</span>
                                    </button>
                                    {!isCollapsed && (
                                        <div className="divide-y divide-border/20">
                                            {sectionItems.length === 0 ? (
                                                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                                                    No items in this section
                                                </div>
                                            ) : sectionItems.map(item => (
                                                <div key={item.id} className="px-4 py-2.5 hover:bg-muted/10 transition-colors">
                                                    <div className="flex items-center gap-3">
                                                        <span className="text-[10px] font-mono text-muted-foreground w-24 shrink-0">{item.id}</span>
                                                        <StatusBadge status={item.status} />
                                                        <span className="text-xs flex-1 truncate">{item.source_actionable_text || "—"}</span>
                                                        <span className="text-[10px] text-muted-foreground shrink-0">{item.source_workstream}</span>
                                                        {item.testing_deadline && (
                                                            <span className="text-[10px] text-muted-foreground flex items-center gap-1 shrink-0">
                                                                <Clock className="h-3 w-3" />{formatDate(item.testing_deadline)}
                                                            </span>
                                                        )}
                                                        {item.assigned_tester_name && (
                                                            <span className="text-[10px] text-blue-400 shrink-0">→ {item.assigned_tester_name}</span>
                                                        )}
                                                        {item.status === "pending_assignment" && (
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="h-6 text-[10px] gap-1 text-teal-400 border-teal-400/30 hover:bg-teal-400/10"
                                                                onClick={(e) => { e.stopPropagation(); setAssigningItem(item.id) }}
                                                            >
                                                                <Send className="h-3 w-3" />Assign
                                                            </Button>
                                                        )}
                                                        <button
                                                            onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                                                            className="text-muted-foreground hover:text-foreground"
                                                        >
                                                            {expandedItem === item.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                                        </button>
                                                    </div>
                                                    {/* Assignment form inline */}
                                                    {assigningItem === item.id && (
                                                        <div className="mt-2 p-3 bg-muted/20 rounded-md border border-border/30 flex items-end gap-3">
                                                            <div className="flex-1">
                                                                <label className="text-[10px] text-muted-foreground mb-1 block">Tester Name</label>
                                                                <input
                                                                    value={assignTesterName}
                                                                    onChange={e => setAssignTesterName(e.target.value)}
                                                                    placeholder="Enter tester name"
                                                                    className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                                                />
                                                            </div>
                                                            <div className="w-44">
                                                                <label className="text-[10px] text-muted-foreground mb-1 block">Testing Deadline</label>
                                                                <input
                                                                    type="datetime-local"
                                                                    value={assignDeadline}
                                                                    onChange={e => setAssignDeadline(e.target.value)}
                                                                    className="w-full bg-background text-xs rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                                                />
                                                            </div>
                                                            <Button
                                                                size="sm"
                                                                className="h-7 text-xs gap-1"
                                                                onClick={() => handleDoAssign(item.id)}
                                                            >
                                                                <Send className="h-3 w-3" />Assign
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 text-xs"
                                                                onClick={() => setAssigningItem(null)}
                                                            >
                                                                Cancel
                                                            </Button>
                                                        </div>
                                                    )}
                                                    {/* Expanded details */}
                                                    {expandedItem === item.id && (
                                                        <div className="mt-2 p-3 bg-muted/10 rounded-md border border-border/20 text-xs space-y-2">
                                                            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                                                <div><span className="text-muted-foreground">Source Doc:</span> <span className="ml-1">{item.source_doc_name}</span></div>
                                                                <div><span className="text-muted-foreground">Theme:</span> <span className="ml-1">{item.source_theme || "—"}</span></div>
                                                                <div><span className="text-muted-foreground">Tranche 3:</span> <span className="ml-1">{item.source_tranche3 || "—"}</span></div>
                                                                <div><span className="text-muted-foreground">New Product:</span> <span className="ml-1">{item.source_new_product || "—"}</span></div>
                                                                <div><span className="text-muted-foreground">Team:</span> <span className="ml-1">{item.source_workstream || "—"}</span></div>
                                                                <div><span className="text-muted-foreground">Maker:</span> <span className="ml-1">{item.assigned_maker_name || "Not assigned"}</span></div>
                                                                <div><span className="text-muted-foreground">Maker Decision:</span> <span className="ml-1">{item.maker_decision ? item.maker_decision.toUpperCase() : "—"}</span></div>
                                                                <div><span className="text-muted-foreground">Rework Count:</span> <span className="ml-1">{item.rework_count || 0}</span></div>
                                                            </div>
                                                            {item.testing_deadline && (
                                                                <div className="flex items-center gap-1 text-muted-foreground">
                                                                    <Calendar className="h-3 w-3" />Testing Deadline: {formatDate(item.testing_deadline)}
                                                                </div>
                                                            )}
                                                            {item.maker_deadline && (
                                                                <div className="flex items-center gap-1 text-muted-foreground">
                                                                    <Calendar className="h-3 w-3" />Maker Deadline: {formatDate(item.maker_deadline)}
                                                                    {item.maker_deadline_confirmed && <CheckCircle2 className="h-3 w-3 text-green-400 ml-1" />}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </main>
        </div>
        </RoleRedirect>
    )
}
