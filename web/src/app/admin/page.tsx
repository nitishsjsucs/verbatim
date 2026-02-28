"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import {
  fetchAdminOverview,
  fetchAdminBenchmarks,
  fetchAdminMemoryDetailed,
  fetchAdminQueries,
  fetchAdminQueryFull,
  adminLogin,
} from "@/lib/api"
import {
  Shield,
  Activity,
  Database,
  FileText,
  MessageSquare,
  Cpu,
  HardDrive,
  BarChart3,
  Brain,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Eye,
  Lock,
  Zap,
  TrendingUp,
  TrendingDown,
  Server,
  Layers,
  Hash,
  Star,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { RoleRedirect } from "@/components/auth/role-redirect"

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "overview" | "queries" | "benchmarks" | "memory" | "storage"

interface AdminData {
  documents?: { total: number; list: Array<{ doc_id: string; doc_name: string; total_pages: number; node_count: number }> }
  queries?: {
    total: number
    recent: Array<Record<string, unknown>>
    timings: Array<{ time: number; timestamp: string; query_type: string; doc_id: string }>
    feedback: { total_with_feedback: number; avg_rating: number | null; rating_count: number }
  }
  conversations?: { total: number; total_messages: number }
  benchmarks?: { legacy: BenchmarkAgg; optimized: BenchmarkAgg }
  memory?: Record<string, unknown>
  config?: {
    retrieval_mode: string
    model: string
    model_pro: string
    optimization_features: Record<string, boolean>
  }
  storage?: {
    collections: Record<string, { docs: number; size_bytes: number; size_mb: number }>
    total_bytes: number
    total_mb: number
    limit_mb: number
    usage_percent: number
  }
  actionables?: { total_docs: number; total_items: number; by_status: Record<string, number> }
  cache?: Record<string, unknown>
  timestamp?: string
}

interface BenchmarkAgg {
  mode: string
  count: number
  avg_time: number
  avg_tokens: number
  avg_llm_calls: number
  avg_cache_hits: number
  avg_skips: number
  min_time: number
  max_time: number
  min_tokens: number
  max_tokens: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 1): string {
  if (n === undefined || n === null) return "—"
  return n.toFixed(decimals)
}

function fmtMs(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return "—"
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  return `${seconds.toFixed(2)}s`
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
}

function timeAgo(iso: string): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Admin Login Gate ────────────────────────────────────────────────────────

function AdminLoginGate({ children }: { children: React.ReactNode }) {
  const [authenticated, setAuthenticated] = React.useState(false)
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  // Check if already authenticated via sessionStorage
  React.useEffect(() => {
    const token = sessionStorage.getItem("admin_token")
    if (token) setAuthenticated(true)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const result = await adminLogin(username, password)
      if (result.authenticated) {
        sessionStorage.setItem("admin_token", result.token)
        setAuthenticated(true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  if (authenticated) return <>{children}</>

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-6">
            <Shield className="h-5 w-5 text-red-500" />
            <h2 className="text-base font-semibold text-foreground">Admin Access</h2>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {error && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <XCircle className="h-3 w-3" /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-9 rounded-md bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  icon,
  iconClass,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  iconClass?: string
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("flex-shrink-0", iconClass)}>{icon}</span>
        <span className="text-xs font-medium text-muted-foreground truncate">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Toggle Badge ────────────────────────────────────────────────────────────

function ToggleBadge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        on
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-zinc-500/10 text-zinc-500"
      )}
    >
      {on ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
  )
}

// ─── Mini Bar Chart (horizontal) ─────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ─── Tab Button ──────────────────────────────────────────────────────────────

function TabBtn({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 h-8 rounded-md text-[13px] font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function AdminDashboardContent() {
  const [tab, setTab] = React.useState<Tab>("overview")
  const [data, setData] = React.useState<AdminData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [refreshing, setRefreshing] = React.useState(false)

  // Queries tab state
  const [queryPage, setQueryPage] = React.useState(0)
  const [queryData, setQueryData] = React.useState<{ total: number; records: Record<string, unknown>[] } | null>(null)
  const [querySearch, setQuerySearch] = React.useState("")
  const [expandedQuery, setExpandedQuery] = React.useState<string | null>(null)
  const [queryDetail, setQueryDetail] = React.useState<Record<string, unknown> | null>(null)

  // Benchmarks tab state
  const [benchData, setBenchData] = React.useState<Record<string, unknown> | null>(null)

  // Memory tab state
  const [memoryData, setMemoryData] = React.useState<Record<string, unknown> | null>(null)

  const loadOverview = React.useCallback(async () => {
    try {
      const result = await fetchAdminOverview()
      setData(result as AdminData)
      setError("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => { loadOverview() }, [loadOverview])

  const refresh = () => {
    setRefreshing(true)
    loadOverview()
  }

  // Load data when switching tabs
  React.useEffect(() => {
    if (tab === "queries" && !queryData) {
      fetchAdminQueries({ skip: 0, limit: 50 })
        .then(d => setQueryData(d))
        .catch(() => {})
    }
    if (tab === "benchmarks" && !benchData) {
      fetchAdminBenchmarks(200)
        .then(d => setBenchData(d))
        .catch(() => {})
    }
    if (tab === "memory" && !memoryData) {
      fetchAdminMemoryDetailed()
        .then(d => setMemoryData(d))
        .catch(() => {})
    }
  }, [tab, queryData, benchData, memoryData])

  const loadQueryPage = (page: number) => {
    setQueryPage(page)
    fetchAdminQueries({ skip: page * 50, limit: 50 })
      .then(d => setQueryData(d))
      .catch(() => {})
  }

  const viewQueryDetail = async (recordId: string) => {
    if (expandedQuery === recordId) {
      setExpandedQuery(null)
      setQueryDetail(null)
      return
    }
    setExpandedQuery(recordId)
    try {
      const detail = await fetchAdminQueryFull(recordId)
      setQueryDetail(detail)
    } catch {
      setQueryDetail(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertTriangle className="h-8 w-8 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={refresh} className="mt-3 text-xs text-primary hover:underline">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-6 h-12">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-red-500" />
            <h1 className="text-[15px] font-semibold text-foreground">Admin Dashboard</h1>
            {data?.config?.retrieval_mode && (
              <span className={cn(
                "ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                data.config.retrieval_mode === "optimized"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}>
                {data.config.retrieval_mode}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data?.timestamp && (
              <span className="text-[10px] text-muted-foreground">Updated {timeAgo(data.timestamp)}</span>
            )}
            <button
              onClick={refresh}
              disabled={refreshing}
              className="flex items-center gap-1 h-7 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pb-2">
          <TabBtn active={tab === "overview"} icon={<Activity className="h-3.5 w-3.5" />} label="Overview" onClick={() => setTab("overview")} />
          <TabBtn active={tab === "queries"} icon={<Search className="h-3.5 w-3.5" />} label="Query Log" onClick={() => setTab("queries")} />
          <TabBtn active={tab === "benchmarks"} icon={<BarChart3 className="h-3.5 w-3.5" />} label="Benchmarks" onClick={() => setTab("benchmarks")} />
          <TabBtn active={tab === "memory"} icon={<Brain className="h-3.5 w-3.5" />} label="Memory System" onClick={() => setTab("memory")} />
          <TabBtn active={tab === "storage"} icon={<HardDrive className="h-3.5 w-3.5" />} label="Storage" onClick={() => setTab("storage")} />
        </div>
      </div>

      {/* ── Content ── */}
      <div className="p-6 space-y-6">
        {tab === "overview" && data && <OverviewTab data={data} />}
        {tab === "queries" && (
          <QueriesTab
            data={queryData}
            page={queryPage}
            onPageChange={loadQueryPage}
            search={querySearch}
            onSearchChange={setQuerySearch}
            expandedQuery={expandedQuery}
            queryDetail={queryDetail}
            onViewDetail={viewQueryDetail}
          />
        )}
        {tab === "benchmarks" && <BenchmarksTab data={benchData} overview={data} />}
        {tab === "memory" && <MemoryTab data={memoryData} overview={data} />}
        {tab === "storage" && data && <StorageTab data={data} />}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewTab({ data }: { data: AdminData }) {
  return (
    <>
      {/* Row 1: Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <StatCard icon={<FileText className="h-4 w-4" />} iconClass="text-purple-500" label="Documents" value={data.documents?.total ?? 0} sub={`${data.documents?.list?.reduce((s, d) => s + d.total_pages, 0) ?? 0} total pages`} />
        <StatCard icon={<Search className="h-4 w-4" />} iconClass="text-blue-500" label="Total Queries" value={data.queries?.total ?? 0} sub={data.queries?.feedback ? `${data.queries.feedback.rating_count} rated` : undefined} />
        <StatCard icon={<MessageSquare className="h-4 w-4" />} iconClass="text-teal-500" label="Conversations" value={data.conversations?.total ?? 0} sub={`${data.conversations?.total_messages ?? 0} messages`} />
        <StatCard icon={<Layers className="h-4 w-4" />} iconClass="text-amber-500" label="Actionables" value={data.actionables?.total_items ?? 0} sub={`${data.actionables?.by_status?.approved ?? 0} approved`} />
        <StatCard icon={<Star className="h-4 w-4" />} iconClass="text-yellow-500" label="Avg Rating" value={data.queries?.feedback?.avg_rating ? fmt(data.queries.feedback.avg_rating, 1) : "—"} sub={`${data.queries?.feedback?.total_with_feedback ?? 0} with feedback`} />
        <StatCard icon={<HardDrive className="h-4 w-4" />} iconClass="text-pink-500" label="Storage" value={`${data.storage?.total_mb ?? 0}MB`} sub={`${data.storage?.usage_percent ?? 0}% of ${data.storage?.limit_mb ?? 512}MB`} />
      </div>

      {/* Row 2: Config & Features */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System Config */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" /> System Configuration
          </h3>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">LLM Model</span>
              <span className="font-mono text-foreground text-xs">{data.config?.model || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pro Model</span>
              <span className="font-mono text-foreground text-xs">{data.config?.model_pro || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Retrieval Mode</span>
              <span className={cn(
                "font-semibold text-xs",
                data.config?.retrieval_mode === "optimized" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
              )}>
                {data.config?.retrieval_mode?.toUpperCase() || "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Feature Toggles */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Feature Toggles
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {data.config?.optimization_features && Object.entries(data.config.optimization_features).map(([key, val]) => (
              <ToggleBadge key={key} on={val} label={key.replace(/^enable_/, "").replace(/_/g, " ")} />
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Documents table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Ingested Documents
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Pages</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Nodes</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Doc ID</th>
              </tr>
            </thead>
            <tbody>
              {data.documents?.list?.map((doc) => (
                <tr key={doc.doc_id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium text-foreground truncate max-w-[300px]">{doc.doc_name}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{doc.total_pages}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{doc.node_count}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground truncate max-w-[200px]">{doc.doc_id}</td>
                </tr>
              )) ?? (
                <tr><td colSpan={4} className="px-4 py-3 text-center text-muted-foreground">No documents</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 4: Recent Queries */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Recent Queries (last 50)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Query</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Time</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Tokens</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">LLM Calls</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">When</th>
              </tr>
            </thead>
            <tbody>
              {data.queries?.recent?.slice(0, 20).map((q, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 text-foreground truncate max-w-[300px]" title={String(q.query_text || "")}>
                    {String(q.query_text || "").slice(0, 80)}{String(q.query_text || "").length > 80 ? "..." : ""}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">{String(q.query_type || "—")}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{fmtMs(q.total_time_seconds as number)}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{String(q.total_tokens ?? "—")}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{String(q.llm_calls ?? "—")}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{timeAgo(String(q.timestamp || ""))}</td>
                </tr>
              )) ?? (
                <tr><td colSpan={6} className="px-4 py-3 text-center text-muted-foreground">No queries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row 5: Actionable Status Breakdown */}
      {data.actionables && data.actionables.total_items > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Actionable Items by Status
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(data.actionables.by_status).map(([status, count]) => (
              <div key={status} className="text-center">
                <p className="text-2xl font-semibold text-foreground">{count}</p>
                <p className="text-xs text-muted-foreground capitalize">{status}</p>
                <MiniBar value={count} max={data.actionables!.total_items} color={
                  status === "approved" ? "bg-emerald-500" : status === "rejected" ? "bg-red-500" : "bg-amber-500"
                } />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 6: Quick Benchmark Summary */}
      {data.benchmarks && (data.benchmarks.legacy?.count > 0 || data.benchmarks.optimized?.count > 0) && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Benchmark Summary
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <BenchmarkColumn label="Legacy" data={data.benchmarks.legacy} />
            <BenchmarkColumn label="Optimized" data={data.benchmarks.optimized} />
          </div>
        </div>
      )}
    </>
  )
}

function BenchmarkColumn({ label, data }: { label: string; data: BenchmarkAgg | undefined }) {
  if (!data || data.count === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-sm font-semibold text-foreground mb-2">{label} <span className="text-xs font-normal text-muted-foreground">({data.count} queries)</span></p>
      <div className="space-y-1.5 text-[13px]">
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Time</span><span className="font-mono text-xs">{fmtMs(data.avg_time)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Tokens</span><span className="font-mono text-xs">{data.avg_tokens}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg LLM Calls</span><span className="font-mono text-xs">{fmt(data.avg_llm_calls)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Cache Hits</span><span className="font-mono text-xs">{fmt(data.avg_cache_hits)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Min / Max Time</span><span className="font-mono text-xs">{fmtMs(data.min_time)} / {fmtMs(data.max_time)}</span></div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERIES TAB
// ═══════════════════════════════════════════════════════════════════════════════

function QueriesTab({
  data,
  page,
  onPageChange,
  search,
  onSearchChange,
  expandedQuery,
  queryDetail,
  onViewDetail,
}: {
  data: { total: number; records: Record<string, unknown>[] } | null
  page: number
  onPageChange: (p: number) => void
  search: string
  onSearchChange: (s: string) => void
  expandedQuery: string | null
  queryDetail: Record<string, unknown> | null
  onViewDetail: (id: string) => void
}) {
  if (!data) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  }

  const filtered = search
    ? data.records.filter(r => String(r.query_text || "").toLowerCase().includes(search.toLowerCase()))
    : data.records

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">{data.total} total queries</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Filter queries..."
              className="h-8 pl-7 pr-3 w-60 rounded-md border border-input bg-background text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 px-2 py-2"></th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Query</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Doc</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Time</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Tokens</th>
              <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">LLM</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q) => {
              const rid = String(q.record_id || "")
              const isExpanded = expandedQuery === rid
              return (
                <React.Fragment key={rid}>
                  <tr
                    className={cn(
                      "border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors",
                      isExpanded && "bg-muted/40"
                    )}
                    onClick={() => onViewDetail(rid)}
                  >
                    <td className="px-2 py-2 text-muted-foreground">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </td>
                    <td className="px-3 py-2 text-foreground truncate max-w-[300px]" title={String(q.query_text || "")}>
                      {String(q.query_text || "").slice(0, 60)}{String(q.query_text || "").length > 60 ? "..." : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground truncate max-w-[100px]">{String(q.doc_id || "—").slice(0, 12)}</td>
                    <td className="px-3 py-2"><span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{String(q.query_type || "—")}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{fmtMs(q.total_time_seconds as number)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{String(q.total_tokens ?? "—")}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{String(q.llm_calls ?? "—")}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        String(q.verification_status) === "verified" ? "bg-emerald-500/10 text-emerald-600" :
                        String(q.verification_status) === "unverified" ? "bg-amber-500/10 text-amber-600" :
                        "bg-zinc-500/10 text-zinc-500"
                      )}>
                        {String(q.verification_status || "—")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(String(q.timestamp || ""))}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="bg-muted/20 px-6 py-4">
                        {queryDetail ? (
                          <QueryDetailPanel detail={queryDetail} />
                        ) : (
                          <div className="flex items-center gap-2 text-muted-foreground text-xs">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading details...
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-muted-foreground text-sm">No queries found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Showing {page * 50 + 1}–{Math.min((page + 1) * 50, data.total)} of {data.total}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            ← Prev
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={(page + 1) * 50 >= data.total}
            className="h-7 px-2 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      </div>
    </>
  )
}

function QueryDetailPanel({ detail }: { detail: Record<string, unknown> }) {
  const answerText: string = String(detail.answer_text || detail.answer || "—")
  const verificationStatus: string = String(detail.verification_status || "—")
  const verificationNotes: string = detail.verification_notes ? String(detail.verification_notes) : ""
  const feedbackObj = (detail.feedback && typeof detail.feedback === "object") ? detail.feedback as Record<string, unknown> : null
  const feedbackRating: string = feedbackObj ? String(feedbackObj.rating ?? "—") : ""
  const feedbackText: string = feedbackObj?.text ? String(feedbackObj.text) : ""
  const citationsList = Array.isArray(detail.citations) ? (detail.citations as Array<Record<string, string>>) : []
  const stageTimings = (detail.stage_timings && typeof detail.stage_timings === "object") ? detail.stage_timings as Record<string, number> : null

  return (
    <div className="space-y-3">
      {/* Answer */}
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Answer</p>
        <p className="text-[13px] text-foreground whitespace-pre-wrap max-h-[200px] overflow-auto">{answerText}</p>
      </div>

      {/* Stage Timings */}
      {stageTimings && Object.keys(stageTimings).length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Stage Timings</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stageTimings).map(([stage, time]) => (
              <span key={stage} className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono">
                {stage}: {fmtMs(time)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Citations */}
      {citationsList.length > 0 ? (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Citations ({citationsList.length})</p>
          <div className="flex flex-wrap gap-1">
            {citationsList.map((c, i) => (
              <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px]">
                [{String(c.citation_id)}] {String(c.title || "").slice(0, 40)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Verification */}
      <div className="flex items-center gap-4 text-[12px]">
        <span className="text-muted-foreground">Verification: <span className="font-medium text-foreground">{verificationStatus}</span></span>
        {verificationNotes ? <span className="text-muted-foreground italic">{verificationNotes.slice(0, 120)}</span> : null}
      </div>

      {/* Routing Log */}
      {(detail.routing_log && typeof detail.routing_log === "object") ? (
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Routing</p>
          <div className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded p-2 max-h-[150px] overflow-auto">
            <pre className="whitespace-pre-wrap">{JSON.stringify(detail.routing_log, null, 2)}</pre>
          </div>
        </div>
      ) : null}

      {/* Feedback */}
      {feedbackObj ? (
        <div className="flex items-center gap-2 text-[12px]">
          <Star className="h-3.5 w-3.5 text-yellow-500" />
          <span className="text-muted-foreground">
            Rating: <span className="font-medium text-foreground">{feedbackRating}</span>
          </span>
          {feedbackText ? (
            <span className="text-muted-foreground ml-2">&ldquo;{feedbackText}&rdquo;</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARKS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function BenchmarksTab({ data, overview }: { data: Record<string, unknown> | null; overview: AdminData | null }) {
  if (!data) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const legacy = data.legacy as BenchmarkAgg | undefined
  const optimized = data.optimized as BenchmarkAgg | undefined
  const records = (data.records as Array<Record<string, unknown>>) || []

  const hasComparison = legacy && optimized && legacy.count > 0 && optimized.count > 0
  const timeDelta = hasComparison ? ((legacy!.avg_time - optimized!.avg_time) / legacy!.avg_time * 100) : 0
  const tokenDelta = hasComparison ? ((legacy!.avg_tokens - optimized!.avg_tokens) / legacy!.avg_tokens * 100) : 0

  return (
    <>
      {/* Comparison Cards */}
      {hasComparison && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            iconClass={timeDelta > 0 ? "text-emerald-500" : "text-red-500"}
            label="Time Saved"
            value={`${fmt(Math.abs(timeDelta))}%`}
            sub={`${fmtMs(legacy!.avg_time)} → ${fmtMs(optimized!.avg_time)}`}
          />
          <StatCard
            icon={<TrendingDown className="h-4 w-4" />}
            iconClass={tokenDelta > 0 ? "text-emerald-500" : "text-red-500"}
            label="Token Saved"
            value={`${fmt(Math.abs(tokenDelta))}%`}
            sub={`${legacy!.avg_tokens} → ${optimized!.avg_tokens}`}
          />
          <StatCard
            icon={<Cpu className="h-4 w-4" />}
            iconClass="text-blue-500"
            label="Avg LLM Calls"
            value={`${fmt(legacy!.avg_llm_calls)} → ${fmt(optimized!.avg_llm_calls)}`}
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            iconClass="text-amber-500"
            label="Cache Hits"
            value={fmt(optimized!.avg_cache_hits)}
            sub={`${fmt(optimized!.avg_skips)} stages skipped`}
          />
        </div>
      )}

      {/* Side-by-side tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BenchmarkDetailCard label="Legacy" data={legacy} color="text-amber-600 dark:text-amber-400" />
        <BenchmarkDetailCard label="Optimized" data={optimized} color="text-emerald-600 dark:text-emerald-400" />
      </div>

      {/* Raw benchmark records */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Raw Benchmark Records ({records.length})
          </h3>
        </div>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Mode</th>
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Query</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Time</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">In Tokens</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Out Tokens</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">LLM</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Cache</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Skips</th>
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">When</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-muted/20">
                  <td className="px-3 py-1.5">
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      r.retrieval_mode === "optimized" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                    )}>{String(r.retrieval_mode || "—")}</span>
                  </td>
                  <td className="px-3 py-1.5 text-foreground truncate max-w-[200px]">{String(r.query_text || "").slice(0, 50)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{fmtMs(r.total_time as number)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{String(r.total_input_tokens ?? "—")}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{String(r.total_output_tokens ?? "—")}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{String(r.total_llm_calls ?? "—")}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{String(r.cache_hits ?? 0)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{String(r.stages_skipped ?? 0)}</td>
                  <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{timeAgo(String(r.timestamp || ""))}</td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">No benchmark records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function BenchmarkDetailCard({ label, data, color }: { label: string; data: BenchmarkAgg | undefined; color: string }) {
  if (!data || data.count === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-center">
        <p className={cn("text-sm font-semibold", color)}>{label}</p>
        <p className="text-xs text-muted-foreground mt-1">No data</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className={cn("text-sm font-semibold mb-3", color)}>{label} <span className="text-xs font-normal text-muted-foreground">({data.count} queries)</span></p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Time</span><span className="font-mono text-xs font-medium">{fmtMs(data.avg_time)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Tokens</span><span className="font-mono text-xs font-medium">{data.avg_tokens}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg LLM Calls</span><span className="font-mono text-xs font-medium">{fmt(data.avg_llm_calls)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Cache Hits</span><span className="font-mono text-xs font-medium">{fmt(data.avg_cache_hits)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Min Time</span><span className="font-mono text-xs">{fmtMs(data.min_time)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Max Time</span><span className="font-mono text-xs">{fmtMs(data.max_time)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Min Tokens</span><span className="font-mono text-xs">{data.min_tokens}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Max Tokens</span><span className="font-mono text-xs">{data.max_tokens}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Avg Skips</span><span className="font-mono text-xs">{fmt(data.avg_skips)}</span></div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY TAB
// ═══════════════════════════════════════════════════════════════════════════════

function MemoryTab({ data, overview }: { data: Record<string, unknown> | null; overview: AdminData | null }) {
  if (!data) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>

  const initialized = data.initialized as boolean
  const subsystems = (data.subsystems || {}) as Record<string, Record<string, unknown>>
  const toggles = (data.toggles || {}) as Record<string, boolean>
  const collStats = (data.collection_stats || {}) as Record<string, { label: string; docs: number; size_bytes: number; size_mb: number }>
  const perDoc = (data.per_doc || (overview?.memory as Record<string, unknown>)?.per_doc || {}) as Record<string, Record<string, unknown>>

  return (
    <>
      {/* Initialization Status */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" /> Memory System Status
          </h3>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            initialized ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"
          )}>
            {initialized ? "INITIALIZED" : "NOT INITIALIZED"}
          </span>
        </div>

        {/* Subsystem toggles */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Object.entries(toggles).map(([key, val]) => (
            <ToggleBadge key={key} on={val} label={key.replace(/_/g, " ")} />
          ))}
        </div>

        {/* Subsystem stats */}
        {Object.keys(subsystems).length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(subsystems).map(([name, stats]) => (
              <SubsystemCard key={name} name={name} stats={stats} />
            ))}
          </div>
        )}
      </div>

      {/* Memory Collection Storage */}
      {Object.keys(collStats).length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" /> Memory Collections
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Collection</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Label</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Documents</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Size</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(collStats).map(([name, stats]) => (
                  <tr key={name} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{name}</td>
                    <td className="px-4 py-2 text-muted-foreground">{stats.label}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{stats.docs}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmtBytes(stats.size_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Document Memory Status */}
      {Object.keys(perDoc).length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Per-Document Memory Status
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {Object.entries(perDoc).map(([docId, stats]) => (
              <div key={docId} className="rounded border border-border/50 p-3">
                <p className="text-xs font-mono font-medium text-foreground mb-2 truncate">{docId}</p>
                {stats.error ? (
                  <p className="text-xs text-red-500">{String(stats.error)}</p>
                ) : (
                  <div className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded p-2 max-h-[120px] overflow-auto">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(stats, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function SubsystemCard({ name, stats }: { name: string; stats: Record<string, unknown> }) {
  const friendlyNames: Record<string, string> = {
    raptor: "RAPTOR Index",
    user_memory: "User Memory",
    query_intelligence: "Query Intelligence",
    retrieval_feedback: "Retrieval Feedback",
    r2r_fallback: "R2R Fallback",
  }
  const iconColor: Record<string, string> = {
    raptor: "text-purple-500",
    user_memory: "text-blue-500",
    query_intelligence: "text-teal-500",
    retrieval_feedback: "text-amber-500",
    r2r_fallback: "text-pink-500",
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card p-3">
      <p className={cn("text-xs font-semibold mb-2", iconColor[name] || "text-foreground")}>
        {friendlyNames[name] || name}
      </p>
      <div className="space-y-1">
        {Object.entries(stats).map(([key, val]) => (
          <div key={key} className="flex justify-between text-[11px]">
            <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
            <span className="font-mono text-foreground">{typeof val === "number" ? fmt(val, 2) : String(val)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE TAB
// ═══════════════════════════════════════════════════════════════════════════════

function StorageTab({ data }: { data: AdminData }) {
  const storage = data.storage
  if (!storage) return <p className="text-muted-foreground text-sm">No storage data.</p>

  const collections = storage.collections || {}
  const sorted = Object.entries(collections).sort((a, b) => b[1].size_bytes - a[1].size_bytes)

  return (
    <>
      {/* Usage Bar */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <HardDrive className="h-3.5 w-3.5" /> Total Storage Usage
          </h3>
          <span className="text-sm font-semibold text-foreground">{storage.total_mb}MB / {storage.limit_mb}MB</span>
        </div>
        <div className="w-full h-4 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              storage.usage_percent > 80 ? "bg-red-500" : storage.usage_percent > 50 ? "bg-amber-500" : "bg-emerald-500"
            )}
            style={{ width: `${Math.min(storage.usage_percent, 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">{storage.usage_percent}% used ({fmtBytes(storage.total_bytes)})</p>
      </div>

      {/* Collection breakdown */}
      <div className="rounded-lg border border-border bg-card">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5" /> Collection Breakdown
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Collection</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Documents</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Size</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-48">Usage</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(([name, stats]) => (
                <tr key={name} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs text-foreground">{name}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{stats.docs}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{stats.size_mb}MB</td>
                  <td className="px-4 py-2">
                    <MiniBar value={stats.size_bytes} max={storage.total_bytes || 1} color="bg-primary/60" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cache stats */}
      {data.cache && Object.keys(data.cache).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> Query Cache
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13px]">
            {Object.entries(data.cache).map(([key, val]) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground">{key.replace(/_/g, " ")}</p>
                <p className="font-mono font-medium text-foreground">{String(val)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminPage() {
  return (
    <RoleRedirect>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <AdminLoginGate>
          <AdminDashboardContent />
        </AdminLoginGate>
      </div>
    </RoleRedirect>
  )
}
