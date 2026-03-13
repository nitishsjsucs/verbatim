"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { useSession } from "@/lib/auth-client"
import { getUserRole } from "@/components/auth/auth-guard"
import {
  ShieldAlert,
  BarChart3,
  Shield,
  AlertTriangle,
  TrendingUp,
  Loader2,
  Save,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Calendar,
  Clock,
} from "lucide-react"
import {
  fetchAllActionables,
  fetchRiskEngineConfig,
  fetchRiskParameterSelections,
  updateRiskParameterSelections,
} from "@/lib/api"
import type { ActionableItem } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  type RiskEngineConfig,
  type ThemeRiskRow,
  type ParameterOption,
  type TimeFilterOption,
  DEFAULT_RISK_ENGINE_CONFIG,
  TIME_FILTER_LABELS,
  getTrackerItems,
  filterByTime,
  buildThemeAnalysis,
  applyThemeWeights,
  computeParam1Weighted,
  computeParam2,
  resolveDropdownScore,
  interpretFinalScore,
} from "@/lib/risk-engine"

// ─── Color helpers ───────────────────────────────────────────────────────────

function riskBandBg(color: string) {
  if (color === "emerald") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
  if (color === "yellow") return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
  if (color === "orange") return "bg-orange-500/15 text-orange-400 border-orange-500/30"
  if (color === "red") return "bg-red-500/15 text-red-400 border-red-500/30"
  if (color === "rose") return "bg-rose-500/15 text-rose-400 border-rose-500/30"
  return "bg-muted/20 text-muted-foreground border-border/30"
}

function barColor(color: string) {
  if (color === "emerald") return "bg-emerald-500"
  if (color === "yellow") return "bg-yellow-500"
  if (color === "red") return "bg-red-500"
  if (color === "orange") return "bg-orange-500"
  if (color === "rose") return "bg-rose-500"
  return "bg-muted-foreground"
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export default function RiskPage() {
  // Role detection for theme weight scope restriction
  const { data: session } = useSession()
  const role = getUserRole(session)
  const isCagOfficer = role === "compliance_officer" || role === "admin"

  const [allRawItems, setAllRawItems] = React.useState<ActionableItem[]>([])
  const [config, setConfig] = React.useState<RiskEngineConfig>(DEFAULT_RISK_ENGINE_CONFIG)
  const [selections, setSelections] = React.useState<Record<string, string>>({})
  const [themeWeights, setThemeWeights] = React.useState<Record<string, number>>({}) // CAG officer only
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [timeFilter, setTimeFilter] = React.useState<TimeFilterOption>("overall")
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(
    new Set(["final", "themes", "params"])
  )

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const [actionablesData, configData, selectionsData] = await Promise.all([
        fetchAllActionables(),
        fetchRiskEngineConfig().catch(() => ({})),
        fetchRiskParameterSelections().catch(() => ({})),
      ])
      const items: ActionableItem[] = []
      if (Array.isArray(actionablesData)) {
        for (const result of actionablesData) {
          if (result.actionables) items.push(...result.actionables)
        }
      }
      setAllRawItems(items)

      // Merge fetched config with defaults
      const merged: RiskEngineConfig = { ...DEFAULT_RISK_ENGINE_CONFIG }
      if (configData && typeof configData === "object") {
        const cd = configData as Record<string, unknown>
        for (const k of Object.keys(merged) as (keyof RiskEngineConfig)[]) {
          if (k in cd && cd[k] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (merged as any)[k] = cd[k]
          }
        }
      }
      setConfig(merged)

      // Selections
      const sel: Record<string, string> = {}
      if (selectionsData && typeof selectionsData === "object") {
        for (const [k, v] of Object.entries(selectionsData)) {
          if (typeof v === "string") sel[k] = v
        }
      }
      setSelections(sel)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { loadData() }, [loadData])

  // ─── Derived data: Tracker only → time filtered ────────────────────────

  // Step 1: Only tracker items (published)
  const trackerItems = React.useMemo(() => getTrackerItems(allRawItems), [allRawItems])

  // Step 2: Apply time filter
  const filteredItems = React.useMemo(() => filterByTime(trackerItems, timeFilter), [trackerItems, timeFilter])

  // Separate completed & active from filtered tracker data
  const completedItems = React.useMemo(() => filteredItems.filter(i => i.task_status === "completed"), [filteredItems])
  const activeItems = React.useMemo(() => filteredItems.filter(i => i.task_status !== "completed"), [filteredItems])

  // Theme analysis from completed items only (per spec: avg uses completed only)
  const themeRows = React.useMemo(() => buildThemeAnalysis(completedItems, config.theme_thresholds), [completedItems, config.theme_thresholds])
  
  // Apply per-theme weights (CAG officer only feature)
  // If isCagOfficer, weights from themeWeights state are applied; otherwise defaults to 1
  const weightedThemeRows = React.useMemo(() => {
    if (isCagOfficer && Object.keys(themeWeights).length > 0) {
      return applyThemeWeights(themeRows, themeWeights)
    }
    return themeRows
  }, [themeRows, themeWeights, isCagOfficer])

  const highThemes = React.useMemo(() => weightedThemeRows.filter(r => r.riskLevel.toLowerCase().includes("high") || r.riskLevel.toLowerCase().includes("weak")), [weightedThemeRows])
  const medThemes = React.useMemo(() => weightedThemeRows.filter(r => r.riskLevel.toLowerCase().includes("medium") || r.riskLevel.toLowerCase().includes("improvement")), [weightedThemeRows])
  const lowThemes = React.useMemo(() => weightedThemeRows.filter(r => !r.riskLevel.toLowerCase().includes("high") && !r.riskLevel.toLowerCase().includes("weak") && !r.riskLevel.toLowerCase().includes("medium") && !r.riskLevel.toLowerCase().includes("improvement")), [weightedThemeRows])

  // Bar chart max for scaling
  const chartMax = React.useMemo(() => {
    const allAvgs = weightedThemeRows.map(r => r.avgResidual)
    return allAvgs.length > 0 ? Math.max(...allAvgs, 1) : 1
  }, [weightedThemeRows])

  // ─── Parameters ──────────────────────────────────────────────────────────

  const param1 = React.useMemo(() => computeParam1Weighted(weightedThemeRows, config.explicit_compliance_weights), [weightedThemeRows, config.explicit_compliance_weights])
  const param2 = React.useMemo(() => computeParam2(activeItems.length, filteredItems.length, config.param2_options), [activeItems.length, filteredItems.length, config.param2_options])

  const p3Score = resolveDropdownScore(selections.param3_selection, config.param3_options)
  const p4Score = resolveDropdownScore(selections.param4_selection, config.param4_options)
  const p5Score = resolveDropdownScore(selections.param5_selection, config.param5_options)
  const p6Score = resolveDropdownScore(selections.param6_selection, config.param6_options)
  const p7Score = resolveDropdownScore(selections.param7_selection, config.param7_options)

  // Total Parameter Score = P2 + P3 + P4 + P5 + P6 (spec says sum of 2-6)
  const totalParamScore = param2.score + p3Score + p4Score + p5Score + p6Score

  // Bank Level Risk = P1 + Total Parameter Score
  const bankLevelScore = param1.score + totalParamScore

  const finalInterp = interpretFinalScore(bankLevelScore, config.final_interpretation)

  // ─── Save selections ────────────────────────────────────────────────────

  const handleSaveSelections = async () => {
    setSaving(true)
    try {
      await updateRiskParameterSelections(selections)
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  const setSelection = (key: string, value: string) => {
    setSelections(prev => ({ ...prev, [key]: value }))
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <RoleRedirect>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <div className="h-11 border-b border-border flex items-center justify-between px-5 shrink-0 bg-background">
            <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Compliance Risk Dashboard
            </h1>
            <div className="flex items-center gap-2">
              {/* Time Filter */}
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-muted-foreground/50" />
                <select
                  value={timeFilter}
                  onChange={e => setTimeFilter(e.target.value as TimeFilterOption)}
                  className="text-[10px] bg-muted/30 border border-border/40 rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {(Object.keys(TIME_FILTER_LABELS) as TimeFilterOption[]).map(k => (
                    <option key={k} value={k}>{TIME_FILTER_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={loadData}
                disabled={loading}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 text-muted-foreground transition-colors"
              >
                <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                Refresh
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading risk data...
              </div>
            ) : (
              <>
                {/* ════════════════════════════════════════════════════════════
                    FINAL BANK-LEVEL RISK SCORE BANNER
                   ════════════════════════════════════════════════════════════ */}
                <div className={cn(
                  "rounded-xl border-2 p-6 text-center",
                  riskBandBg(finalInterp.color)
                )}>
                  <p className="text-[10px] uppercase tracking-widest font-semibold opacity-70 mb-1">
                    Bank-Wide Compliance Risk Score
                  </p>
                  <p className="text-4xl font-bold font-mono mb-1">
                    {bankLevelScore.toFixed(2)}
                  </p>
                  <p className="text-sm font-semibold">
                    {finalInterp.label}
                  </p>
                  <p className="text-[10px] text-inherit/60 mt-1 opacity-50">
                    <Clock className="inline h-3 w-3 mr-0.5 -mt-0.5" />
                    {TIME_FILTER_LABELS[timeFilter]} · {filteredItems.length} tracker entries
                  </p>
                </div>

                {/* Summary stat row */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <StatCard icon={<BarChart3 className="h-3.5 w-3.5" />} iconClass="text-blue-400" label="Tracker Total" value={filteredItems.length} />
                  <StatCard icon={<Shield className="h-3.5 w-3.5" />} iconClass="text-emerald-400" label="Completed" value={completedItems.length} />
                  <StatCard icon={<AlertTriangle className="h-3.5 w-3.5" />} iconClass="text-amber-400" label="Active" value={activeItems.length} />
                  <StatCard icon={<TrendingUp className="h-3.5 w-3.5" />} iconClass="text-purple-400" label="Themes" value={themeRows.length} />
                  <StatCard icon={<Shield className="h-3.5 w-3.5" />} iconClass="text-pink-400" label="P1 Score" value={param1.score} decimal />
                  <StatCard icon={<ShieldAlert className="h-3.5 w-3.5" />} iconClass="text-cyan-400" label="Bank Score" value={bankLevelScore} decimal />
                </div>

                {/* ════════════════════════════════════════════════════════════
                    THEME LEVEL RISK ANALYSIS + CHARTS
                   ════════════════════════════════════════════════════════════ */}
                <SectionHeader
                  title="Theme-Level Risk Analysis"
                  subtitle={`${themeRows.length} theme(s) from ${completedItems.length} completed tracker entries · ${TIME_FILTER_LABELS[timeFilter]}`}
                  expanded={expandedSections.has("themes")}
                  onToggle={() => toggleSection("themes")}
                />

                {expandedSections.has("themes") && (
                  <div className="space-y-5">
                    {/* Risk Distribution Summary */}
                    <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                      <p className="text-xs font-semibold text-foreground/70 mb-3">Theme Risk Distribution</p>
                      <div className="flex items-center gap-6">
                        <div className="flex-1">
                          <div className="flex h-8 rounded-lg overflow-hidden border border-border/20">
                            {highThemes.length > 0 && themeRows.length > 0 && (
                              <div
                                className="bg-red-500/80 flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ width: `${(highThemes.length / themeRows.length) * 100}%` }}
                              >
                                {highThemes.length}
                              </div>
                            )}
                            {medThemes.length > 0 && themeRows.length > 0 && (
                              <div
                                className="bg-yellow-500/80 flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ width: `${(medThemes.length / themeRows.length) * 100}%` }}
                              >
                                {medThemes.length}
                              </div>
                            )}
                            {lowThemes.length > 0 && themeRows.length > 0 && (
                              <div
                                className="bg-emerald-500/80 flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ width: `${(lowThemes.length / themeRows.length) * 100}%` }}
                              >
                                {lowThemes.length}
                              </div>
                            )}
                            {themeRows.length === 0 && (
                              <div className="flex-1 bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">
                                No themes
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                            <span className="text-red-400">High ({highThemes.length})</span>
                            <span className="text-yellow-400">Medium ({medThemes.length})</span>
                            <span className="text-emerald-400">Low ({lowThemes.length})</span>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <MiniStat label="High" count={highThemes.length} color="text-red-400" />
                          <MiniStat label="Medium" count={medThemes.length} color="text-yellow-400" />
                          <MiniStat label="Low" count={lowThemes.length} color="text-emerald-400" />
                        </div>
                      </div>
                    </div>

                    {/* ═══════════════════════════════════════════════════════════
                        GROUPED RISK GRAPHS (All Three Together)
                       ═══════════════════════════════════════════════════════════ */}
                    <div className="rounded-lg border border-border/30 bg-muted/5 p-4">
                      <p className="text-xs font-semibold text-foreground/70 mb-3">Risk Level Comparison (Avg Residual Score by Theme)</p>
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* High Risk Graph */}
                        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                          <p className="text-[10px] font-semibold text-red-400 mb-2 uppercase tracking-wider">High Risk Themes</p>
                          {highThemes.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground/40">No high-risk themes</p>
                          ) : (
                            <div className="space-y-1.5">
                              {[...highThemes].sort((a, b) => a.avgResidual - b.avgResidual).map(row => (
                                <div key={row.theme} className="flex items-center gap-2">
                                  <span className="text-[10px] text-foreground/60 w-20 truncate shrink-0" title={row.theme}>{row.theme}</span>
                                  <div className="flex-1 h-3 bg-muted/20 rounded-sm overflow-hidden">
                                    <div
                                      className="h-full bg-red-500 rounded-sm transition-all"
                                      style={{ width: `${Math.min((row.avgResidual / chartMax) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-muted-foreground/50 w-8 text-right shrink-0">{row.avgResidual.toFixed(1)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Medium Risk Graph */}
                        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                          <p className="text-[10px] font-semibold text-yellow-400 mb-2 uppercase tracking-wider">Medium Risk Themes</p>
                          {medThemes.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground/40">No medium-risk themes</p>
                          ) : (
                            <div className="space-y-1.5">
                              {[...medThemes].sort((a, b) => a.avgResidual - b.avgResidual).map(row => (
                                <div key={row.theme} className="flex items-center gap-2">
                                  <span className="text-[10px] text-foreground/60 w-20 truncate shrink-0" title={row.theme}>{row.theme}</span>
                                  <div className="flex-1 h-3 bg-muted/20 rounded-sm overflow-hidden">
                                    <div
                                      className="h-full bg-yellow-500 rounded-sm transition-all"
                                      style={{ width: `${Math.min((row.avgResidual / chartMax) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-muted-foreground/50 w-8 text-right shrink-0">{row.avgResidual.toFixed(1)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Low Risk Graph */}
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                          <p className="text-[10px] font-semibold text-emerald-400 mb-2 uppercase tracking-wider">Low Risk Themes</p>
                          {lowThemes.length === 0 ? (
                            <p className="text-[10px] text-muted-foreground/40">No low-risk themes</p>
                          ) : (
                            <div className="space-y-1.5">
                              {[...lowThemes].sort((a, b) => a.avgResidual - b.avgResidual).map(row => (
                                <div key={row.theme} className="flex items-center gap-2">
                                  <span className="text-[10px] text-foreground/60 w-20 truncate shrink-0" title={row.theme}>{row.theme}</span>
                                  <div className="flex-1 h-3 bg-muted/20 rounded-sm overflow-hidden">
                                    <div
                                      className="h-full bg-emerald-500 rounded-sm transition-all"
                                      style={{ width: `${Math.min((row.avgResidual / chartMax) * 100, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-muted-foreground/50 w-8 text-right shrink-0">{row.avgResidual.toFixed(1)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* High / Medium / Low Risk Themes — tables only (charts now above) */}
                    <ThemeSection title="High Risk Themes" subtitle="(Weak)" rows={highThemes} chartMax={chartMax} color="red" emptyMsg="No high-risk themes" />
                    <ThemeSection title="Medium Risk Themes" subtitle="(Improvement Needed)" rows={medThemes} chartMax={chartMax} color="yellow" emptyMsg="No medium-risk themes" />
                    <ThemeSection title="Low Risk Themes" subtitle="(Satisfactory)" rows={lowThemes} chartMax={chartMax} color="emerald" emptyMsg="No low-risk themes" />
                  </div>
                )}

                {/* ════════════════════════════════════════════════════════════
                    7-PARAMETER RISK TABLE
                   ════════════════════════════════════════════════════════════ */}
                <SectionHeader
                  title="Bank-Wide Risk Parameters"
                  subtitle="7 compliance parameters determining overall institutional risk"
                  expanded={expandedSections.has("params")}
                  onToggle={() => toggleSection("params")}
                />

                {expandedSections.has("params") && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border/30 bg-muted/5 overflow-hidden">
                      {/* Table header */}
                      <div className="grid grid-cols-[40px_1fr_100px_100px_140px_70px] gap-0 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider bg-muted/10 border-b border-border/20">
                        <div className="py-2 px-2 text-center">#</div>
                        <div className="py-2 px-3">Parameter</div>
                        <div className="py-2 px-2 text-center">Form</div>
                        <div className="py-2 px-2 text-center">Value</div>
                        <div className="py-2 px-2 text-center">Risk Level</div>
                        <div className="py-2 px-2 text-center">Score</div>
                      </div>

                      {/* P1: Explicit Compliance (auto-calculated) */}
                      <ParamRow serial={1} name="Explicit Compliance Against Regulations" form="Calculated" value={param1.value.toFixed(2)} riskLevel="Auto" score={param1.score} auto />

                      {/* P2: Pending Implementation (auto-calculated) */}
                      <ParamRow serial={2} name="Pending Implementation of Regulatory Circulars" form="Percentage" value={`${param2.percentage.toFixed(1)}%`} riskLevel={param2.matchedLabel} score={param2.score} auto />

                      {/* P3–P7: Manual dropdowns */}
                      <ParamDropdownRow serial={3} name="Complaints as % of Total Customers" form="Percentage" options={config.param3_options} selection={selections.param3_selection} onSelect={(v) => setSelection("param3_selection", v)} />
                      <ParamDropdownRow serial={4} name="Observations: New Products/Processes" form="Number" options={config.param4_options} selection={selections.param4_selection} onSelect={(v) => setSelection("param4_selection", v)} />
                      <ParamDropdownRow serial={5} name="Open Compliance Testing Observations" form="Number" options={config.param5_options} selection={selections.param5_selection} onSelect={(v) => setSelection("param5_selection", v)} />
                      <ParamDropdownRow serial={6} name="Repeat RMP / RAR Observations" form="Number" options={config.param6_options} selection={selections.param6_selection} onSelect={(v) => setSelection("param6_selection", v)} />
                      <ParamDropdownRow serial={7} name="Material Compliance Violations" form="Number" options={config.param7_options} selection={selections.param7_selection} onSelect={(v) => setSelection("param7_selection", v)} />

                      {/* Totals row */}
                      <div className="grid grid-cols-[40px_1fr_100px_100px_140px_70px] gap-0 border-t-2 border-border/30 bg-muted/15">
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-3 text-xs font-bold text-foreground">
                          Total Parameter Score (P2–P6)
                        </div>
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-2 text-center">
                          <span className="text-sm font-bold font-mono text-foreground">{totalParamScore.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Bank Level row */}
                      <div className="grid grid-cols-[40px_1fr_100px_100px_140px_70px] gap-0 border-t border-border/20 bg-muted/10">
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-3 text-xs font-bold text-foreground">
                          Bank-Level Risk Score (P1 + Total)
                        </div>
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-2" />
                        <div className="py-2.5 px-2 text-center">
                          <span className={cn("text-xs font-semibold px-2 py-0.5 rounded border", riskBandBg(finalInterp.color))}>
                            {finalInterp.label}
                          </span>
                        </div>
                        <div className="py-2.5 px-2 text-center">
                          <span className="text-sm font-bold font-mono text-foreground">{bankLevelScore.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Save button */}
                    <div className="flex justify-end">
                      <button
                        onClick={handleSaveSelections}
                        disabled={saving}
                        className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save Parameter Selections
                      </button>
                    </div>
                  </div>
                )}

              </>
            )}
          </div>
        </main>
      </div>
    </RoleRedirect>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon, iconClass, label, value, decimal }: { icon: React.ReactNode; iconClass: string; label: string; value: number; decimal?: boolean }) {
  return (
    <div className="rounded-lg border border-border/30 p-3 bg-muted/5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={iconClass}>{icon}</span>
        <span className="text-[10px] font-medium text-muted-foreground/60">{label}</span>
      </div>
      <p className="text-lg font-bold font-mono text-foreground">{decimal ? value.toFixed(2) : value}</p>
    </div>
  )
}

function MiniStat({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="text-center">
      <p className={cn("text-xl font-bold font-mono", color)}>{count}</p>
      <p className="text-[9px] text-muted-foreground/60 uppercase">{label}</p>
    </div>
  )
}

function SectionHeader({ title, subtitle, expanded, onToggle }: {
  title: string; subtitle: string; expanded: boolean; onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 py-2 text-left group"
    >
      {expanded
        ? <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
        : <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
      }
      <div>
        <p className="text-sm font-semibold text-foreground group-hover:text-foreground/80 transition-colors">{title}</p>
        <p className="text-[10px] text-muted-foreground/50">{subtitle}</p>
      </div>
    </button>
  )
}

// ─── Theme section with table + bar chart ────────────────────────────────────

function ThemeSection({ title, subtitle, rows, chartMax, color, emptyMsg }: {
  title: string; subtitle: string; rows: ThemeRiskRow[]; chartMax: number; color: string; emptyMsg: string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/20 p-3 bg-muted/5">
        <p className="text-xs font-semibold text-foreground/60">{title} <span className="text-muted-foreground/40 font-normal">{subtitle}</span></p>
        <p className="text-[10px] text-muted-foreground/40 mt-1">{emptyMsg}</p>
      </div>
    )
  }

  const sorted = [...rows].sort((a, b) => a.avgResidual - b.avgResidual)

  return (
    <div className="rounded-lg border border-border/30 bg-muted/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/20">
        <p className="text-xs font-semibold text-foreground/80">{title} <span className="text-muted-foreground/50 font-normal">{subtitle}</span> — {rows.length} theme(s)</p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-border/10">
              <th className="py-1.5 px-3 text-left w-10">#</th>
              <th className="py-1.5 px-3 text-left">Theme</th>
              <th className="py-1.5 px-3 text-center">Avg Residual</th>
              <th className="py-1.5 px-3 text-center">Highest</th>
              <th className="py-1.5 px-3 text-center">Completed</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr key={row.theme} className="border-b border-border/5 hover:bg-muted/10 transition-colors">
                <td className="py-1.5 px-3 text-muted-foreground/40 font-mono">{idx + 1}</td>
                <td className="py-1.5 px-3 text-foreground/80">{row.theme}</td>
                <td className="py-1.5 px-3 text-center font-mono font-medium">{row.avgResidual.toFixed(2)}</td>
                <td className="py-1.5 px-3 text-center font-mono text-muted-foreground/60">{row.highestResidual.toFixed(2)}</td>
                <td className="py-1.5 px-3 text-center font-mono text-muted-foreground/60">{row.completedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bar chart */}
      <div className="px-4 py-3 border-t border-border/10">
        <p className="text-[10px] text-muted-foreground/50 mb-2 uppercase tracking-wider font-semibold">Avg Residual Score by Theme</p>
        <div className="space-y-1.5">
          {sorted.map(row => (
            <div key={row.theme} className="flex items-center gap-2">
              <span className="text-[10px] text-foreground/60 w-28 truncate shrink-0" title={row.theme}>{row.theme}</span>
              <div className="flex-1 h-4 bg-muted/20 rounded-sm overflow-hidden">
                <div
                  className={cn("h-full rounded-sm transition-all", barColor(color))}
                  style={{ width: `${Math.min((row.avgResidual / chartMax) * 100, 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/50 w-10 text-right shrink-0">{row.avgResidual.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Parameter table rows ────────────────────────────────────────────────────

function ParamRow({ serial, name, form, value, riskLevel, score, auto }: {
  serial: number; name: string; form: string; value: string; riskLevel: string; score: number; auto?: boolean
}) {
  return (
    <div className="grid grid-cols-[40px_1fr_100px_100px_140px_70px] gap-0 border-b border-border/10 hover:bg-muted/10 transition-colors">
      <div className="py-2 px-2 text-center text-xs text-muted-foreground/50 font-mono">{serial}</div>
      <div className="py-2 px-3 text-xs text-foreground/80">
        {name}
        {auto && <span className="ml-1 text-[9px] text-primary/60 bg-primary/10 px-1 rounded">Auto</span>}
      </div>
      <div className="py-2 px-2 text-center text-[10px] text-muted-foreground/50">{form}</div>
      <div className="py-2 px-2 text-center text-xs font-mono text-foreground/80">{value}</div>
      <div className="py-2 px-2 text-center text-[10px] text-muted-foreground/60">{riskLevel}</div>
      <div className="py-2 px-2 text-center text-xs font-mono font-semibold text-foreground">{score.toFixed(2)}</div>
    </div>
  )
}

function ParamDropdownRow({ serial, name, form, options, selection, onSelect }: {
  serial: number; name: string; form: string; options: ParameterOption[]; selection?: string; onSelect: (v: string) => void
}) {
  const matched = options.find(o => o.label === selection)
  const score = matched?.score ?? 0
  const riskLevel = matched ? getRatingFromScore(matched.score) : "—"

  return (
    <div className="grid grid-cols-[40px_1fr_100px_100px_140px_70px] gap-0 border-b border-border/10 hover:bg-muted/10 transition-colors">
      <div className="py-2 px-2 text-center text-xs text-muted-foreground/50 font-mono">{serial}</div>
      <div className="py-2 px-3 text-xs text-foreground/80">{name}</div>
      <div className="py-2 px-2 text-center text-[10px] text-muted-foreground/50">{form}</div>
      <div className="py-2 px-2 flex items-center justify-center">
        <select
          value={selection || ""}
          onChange={e => onSelect(e.target.value)}
          className="text-[10px] bg-background border border-border/30 rounded px-1.5 py-1 text-foreground/80 max-w-[90px] focus:outline-none focus:ring-1 focus:ring-primary/50"
        >
          <option value="">Select…</option>
          {options.map(o => (
            <option key={o.label} value={o.label}>{o.label}</option>
          ))}
        </select>
      </div>
      <div className="py-2 px-2 text-center text-[10px] text-muted-foreground/60">{riskLevel}</div>
      <div className="py-2 px-2 text-center text-xs font-mono font-semibold text-foreground">{score.toFixed(2)}</div>
    </div>
  )
}

function getRatingFromScore(score: number): string {
  if (score >= 3) return "High Severe"
  if (score >= 2) return "High Medium"
  if (score >= 1.5) return "High Low"
  if (score >= 1) return "Medium"
  return "Low"
}
