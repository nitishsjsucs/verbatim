"use client"

import * as React from "react"
import { useSession } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { Sidebar } from "@/components/layout/sidebar"
import { useTestingItems } from "@/lib/use-testing-items"
import { fetchAvailableThemes, setTestingDeadline } from "@/lib/testing-api"
import { TestingActionableCard } from "@/components/testing/testing-actionable-card"
import { AssignTesterModal } from "@/components/testing/assign-tester-modal"
import { toast } from "sonner"
import {
    Eye, Search, Plus, Filter, RefreshCw, Loader2, Send, UserPlus, Calendar,
    CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/* ───── Section metadata ───── */
const SECTION_META: Record<string, { label: string; color: string; bg: string; description: string }> = {
    tranche3: { label: "Tranche 3 Testing", color: "text-red-400", bg: "bg-red-400/10", description: "Highest priority — Tranche 3 actionables (yearly cycle)" },
    product:  { label: "Product Testing",   color: "text-amber-400", bg: "bg-amber-400/10", description: "New product actionables — deadline = live date + 6 months" },
    theme:    { label: "Theme Testing",     color: "text-blue-400", bg: "bg-blue-400/10", description: "Theme-based actionables — select a theme and set deadline first" },
    adhoc:    { label: "Ad Hoc Testing",    color: "text-purple-400", bg: "bg-purple-400/10", description: "Manual testing — select a theme and set deadline first" },
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "pending_assignment", label: "Pending" },
    { value: "assigned_to_tester", label: "Assigned" },
    { value: "tester_review", label: "Tester Review" },
    { value: "assigned_to_maker", label: "With Maker" },
    { value: "maker_open", label: "Open" },
    { value: "checker_review", label: "Checker Review" },
    { value: "active", label: "Active" },
    { value: "maker_closed", label: "Closed" },
    { value: "tester_validation", label: "Validation" },
    { value: "passed", label: "Passed" },
    { value: "rejected_to_maker", label: "Rejected" },
    { value: "delayed", label: "Delayed" },
]

/* ───── Main Component ───── */
interface TestingSectionPageProps {
    section: "tranche3" | "product" | "theme" | "adhoc"
}

export function TestingSectionPage({ section }: TestingSectionPageProps) {
    const { data: session } = useSession()
    const role = getUserRole(session)
    const userName = session?.user?.name || session?.user?.email || ""

    const { items, loading, load, handleAssign, handlePullActionables } = useTestingItems({ section })

    const [searchQuery, setSearchQuery] = React.useState("")
    const [statusFilter, setStatusFilter] = React.useState<string>("all")
    const [pulling, setPulling] = React.useState(false)
    const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null)

    // Bulk selection
    const [checkedItems, setCheckedItems] = React.useState<Set<string>>(new Set())
    const toggleChecked = (id: string) => setCheckedItems(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
    })

    // Assign tester modal
    const [assignModalOpen, setAssignModalOpen] = React.useState(false)
    const [assignItemIds, setAssignItemIds] = React.useState<string[]>([])

    // Guided workflow state for theme/adhoc
    const needsGuidedWorkflow = section === "theme" || section === "adhoc"
    const [themes, setThemes] = React.useState<string[]>([])
    const [selectedTheme, setSelectedTheme] = React.useState<string>("")
    const [batchDeadline, setBatchDeadline] = React.useState<string>("")
    const [loadingThemes, setLoadingThemes] = React.useState(false)
    const [workflowConfigured, setWorkflowConfigured] = React.useState(false)

    // Load available themes for theme/adhoc sections
    React.useEffect(() => {
        if (needsGuidedWorkflow) {
            setLoadingThemes(true)
            fetchAvailableThemes()
                .then(r => setThemes(r.themes || []))
                .catch(() => toast.error("Failed to load themes"))
                .finally(() => setLoadingThemes(false))
        }
    }, [needsGuidedWorkflow])

    const meta = SECTION_META[section]

    // Filter items
    const filteredItems = React.useMemo(() => {
        return items.filter(item => {
            if (statusFilter !== "all" && item.status !== statusFilter) return false
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                const s = `${item.source_actionable_text} ${item.source_theme} ${item.source_workstream} ${item.id}`.toLowerCase()
                if (!s.includes(q)) return false
            }
            if (needsGuidedWorkflow && selectedTheme && item.source_theme !== selectedTheme) return false
            return true
        })
    }, [items, statusFilter, searchQuery, needsGuidedWorkflow, selectedTheme])

    // Stats
    const stats = React.useMemo(() => {
        const total = items.length
        const pending = items.filter(i => i.status === "pending_assignment").length
        const active = items.filter(i => !["pending_assignment", "passed", "delayed"].includes(i.status)).length
        const passed = items.filter(i => i.status === "passed").length
        const delayed = items.filter(i => i.is_testing_delayed).length
        return { total, pending, active, passed, delayed }
    }, [items])

    // Select all visible
    const allVisibleIds = filteredItems.map(i => i.id)
    const allChecked = allVisibleIds.length > 0 && allVisibleIds.every(id => checkedItems.has(id))
    const toggleSelectAll = () => {
        if (allChecked) setCheckedItems(new Set())
        else setCheckedItems(new Set(allVisibleIds))
    }

    // Pull actionables
    const handlePull = async () => {
        setPulling(true)
        try {
            await handlePullActionables({
                section,
                theme: needsGuidedWorkflow ? selectedTheme : undefined,
            })
        } finally { setPulling(false) }
    }

    // Open assign modal for single item
    const handleOpenAssignSingle = (itemId: string) => {
        setAssignItemIds([itemId])
        setAssignModalOpen(true)
    }

    // Open assign modal for bulk
    const handleOpenAssignBulk = () => {
        const ids = Array.from(checkedItems)
        if (ids.length === 0) { toast.error("Select items first"); return }
        setAssignItemIds(ids)
        setAssignModalOpen(true)
    }

    // Handle assignment from modal
    const handleModalAssign = async (testerId: string, testerName: string, deadline: string) => {
        for (const itemId of assignItemIds) {
            await handleAssign(
                itemId, testerId, testerName,
                needsGuidedWorkflow ? batchDeadline || deadline : deadline,
                userName,
            )
        }
        setCheckedItems(new Set())
    }

    // Confirm guided workflow configuration
    const handleConfirmWorkflow = async () => {
        if (!selectedTheme) { toast.error("Select a theme first"); return }
        if (!batchDeadline) { toast.error("Set a deadline first"); return }
        setWorkflowConfigured(true)
        // Pull actionables for this theme
        setPulling(true)
        try {
            await handlePullActionables({ section, theme: selectedTheme })
        } finally { setPulling(false) }
    }

    // Whether to show actionables (guided workflow gates this)
    const showActionables = !needsGuidedWorkflow || workflowConfigured

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
                            <span className={meta.color}>{meta.label}</span>
                        </h1>
                        <span className="text-[10px] text-muted-foreground hidden lg:inline">{meta.description}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="px-2 py-0.5 rounded bg-gray-400/10 text-gray-400 font-mono">{stats.pending} pending</span>
                        <span className="px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-400 font-mono">{stats.active} active</span>
                        <span className="px-2 py-0.5 rounded bg-green-400/10 text-green-400 font-mono">{stats.passed} passed</span>
                        {stats.delayed > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-400/10 text-rose-400 font-mono">{stats.delayed} delayed</span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-purple-400/10 text-purple-400 font-mono">{stats.total} total</span>
                    </div>
                </div>

                {/* ─── Guided Workflow Setup (theme / adhoc only) ─── */}
                {needsGuidedWorkflow && !workflowConfigured && (
                    <div className="shrink-0 border-b border-border/40 px-5 py-4">
                        <div className="max-w-lg space-y-3">
                            <p className="text-xs font-semibold text-foreground/80">
                                Step 1: Select a theme, then set a common deadline for all actionables in this batch.
                            </p>
                            <div>
                                <label className="text-[10px] text-muted-foreground mb-1 block font-medium">Theme</label>
                                {loadingThemes ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                    <select
                                        value={selectedTheme}
                                        onChange={e => setSelectedTheme(e.target.value)}
                                        className="w-full bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                                    >
                                        <option value="">Select Theme...</option>
                                        {themes.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                )}
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground mb-1 block font-medium">
                                    Common Deadline <span className="text-muted-foreground/50">(applies to all items in this batch)</span>
                                </label>
                                <input
                                    type="datetime-local"
                                    value={batchDeadline}
                                    onChange={e => setBatchDeadline(e.target.value)}
                                    className="w-full bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                                />
                            </div>
                            <Button
                                size="sm"
                                className={cn("h-8 gap-1.5 text-xs", meta.color)}
                                onClick={handleConfirmWorkflow}
                                disabled={!selectedTheme || !batchDeadline}
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Confirm & Load Actionables
                            </Button>
                        </div>
                    </div>
                )}

                {/* ─── Filters + Toolbar (shown after workflow configured or for tranche3/product) ─── */}
                {showActionables && (
                    <div className="shrink-0 border-b border-border/40 px-5 py-2 flex items-center gap-2 flex-wrap">
                        {/* Search */}
                        <div className="relative flex-1 max-w-xs">
                            <Search className="absolute left-2.5 top-[7px] h-3.5 w-3.5 text-muted-foreground" />
                            <input
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search testing items..."
                                className="w-full bg-muted/30 text-xs rounded-md pl-8 pr-3 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                            />
                        </div>

                        {/* Theme display (for guided workflow sections, read-only after config) */}
                        {needsGuidedWorkflow && selectedTheme && (
                            <span className={cn("text-[10px] px-2 py-1 rounded font-medium", meta.color, meta.bg)}>
                                {selectedTheme}
                            </span>
                        )}

                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none text-foreground"
                        >
                            <option value="all">All Status</option>
                            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>

                        {(statusFilter !== "all" || searchQuery) && (
                            <button
                                onClick={() => { setStatusFilter("all"); setSearchQuery("") }}
                                className="px-2.5 py-1.5 text-xs rounded-md bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/40"
                            >
                                Clear
                            </button>
                        )}

                        {/* Bulk actions */}
                        {checkedItems.size > 0 && (
                            <div className="flex items-center gap-1.5 ml-2">
                                <span className="text-[10px] text-muted-foreground font-mono">{checkedItems.size} selected</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-[10px] text-teal-400 border-teal-400/30 hover:bg-teal-400/10"
                                    onClick={handleOpenAssignBulk}
                                >
                                    <UserPlus className="h-3 w-3" />Assign Selected
                                </Button>
                            </div>
                        )}

                        <div className="ml-auto flex items-center gap-2">
                            {/* Change theme/deadline (guided workflow only) */}
                            {needsGuidedWorkflow && workflowConfigured && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 gap-1.5 text-xs text-muted-foreground"
                                    onClick={() => { setWorkflowConfigured(false); setCheckedItems(new Set()) }}
                                >
                                    Change Theme
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn("h-7 gap-1.5 text-xs", meta.color)}
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
                )}

                {/* ─── Content ─── */}
                <div className="flex-1 overflow-y-auto p-5">
                    {!showActionables ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-2">
                            <Filter className="h-6 w-6 text-muted-foreground/50" />
                            <p className="text-xs text-muted-foreground">Configure theme and deadline above to view actionables</p>
                        </div>
                    ) : loading && items.length === 0 ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 gap-2">
                            <CheckCircle2 className="h-6 w-6 text-muted-foreground/50" />
                            <p className="text-xs text-muted-foreground">
                                No items found{statusFilter !== "all" ? " for this filter" : ""}. Click "Pull Actionables" to fetch completed items.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {/* Select all bar */}
                            <div className="flex items-center gap-2 px-1">
                                <input
                                    type="checkbox"
                                    checked={allChecked}
                                    onChange={toggleSelectAll}
                                    className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                                />
                                <span className="text-[10px] text-muted-foreground">
                                    {allChecked ? "Deselect all" : "Select all"} ({filteredItems.length})
                                </span>
                            </div>

                            {/* Item cards */}
                            {filteredItems.map(item => (
                                <TestingActionableCard
                                    key={item.id}
                                    item={item}
                                    isSelected={selectedItemId === item.id}
                                    onSelect={() => setSelectedItemId(item.id)}
                                    isChecked={checkedItems.has(item.id)}
                                    onCheck={() => toggleChecked(item.id)}
                                    onAssign={handleOpenAssignSingle}
                                    sectionColor={meta.color}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>
        </div>

        {/* Assign Tester Modal (dropdown-based, like CAG delegate) */}
        <AssignTesterModal
            open={assignModalOpen}
            onClose={() => { setAssignModalOpen(false); setAssignItemIds([]) }}
            itemIds={assignItemIds}
            onAssign={handleModalAssign}
            showDeadline={!needsGuidedWorkflow}
            batchDeadline={batchDeadline}
        />
        </RoleRedirect>
    )
}
