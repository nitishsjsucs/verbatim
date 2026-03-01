"use client"

import * as React from "react"
import {
  Play,
  Loader2,
  Trophy,
  TrendingDown,
  TrendingUp,
  Zap,
  DollarSign,
  Timer,
  CheckCircle2,
  XCircle,
  BarChart3,
  FlaskConical,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { runLLMBenchmark } from "@/lib/api"

// ─── Types ───────────────────────────────────────────────────────────────────

interface BenchmarkModel {
  id: string
  label: string
  tier: string
  speed: string
  reasoning: string
}

interface BenchmarkQuestion {
  id: string
  query: string
  expected_type: string
  complexity: string
}

interface Pricing {
  [model: string]: { input: number; output: number }
}

interface IndividualResult {
  stage: string
  stage_label: string
  model: string
  question_id: string
  question_text: string
  success: boolean
  quality_score: number | null
  latency_seconds: number | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
  error?: string
  output_text?: string
}

interface AggEntry {
  quality: number | null
  latency: number | null
  cost: number | null
  count: number
  success: number
}

type RunStatus = "idle" | "running" | "done" | "error"
type CellStatus = "pending" | "running" | "success" | "failed" | "skipped"

const STAGES = ["classification", "expansion", "location", "reflection", "synthesis", "verification"]
const STAGE_LABELS: Record<string, string> = {
  classification: "Classify",
  expansion: "Expand",
  location: "Locate",
  reflection: "Reflect",
  synthesis: "Synthesize",
  verification: "Verify",
}

const BASELINE_MAP: Record<string, string> = {
  classification: "gpt-5.2",
  expansion: "gpt-5.2",
  location: "gpt-5.2",
  reflection: "gpt-5.2",
  synthesis: "gpt-5.2-pro",
  verification: "gpt-5.2-pro",
}

const MODEL_COLORS: Record<string, string> = {
  "gpt-5.2": "bg-blue-500",
  "gpt-5.2-pro": "bg-purple-500",
  "gpt-5-mini": "bg-emerald-500",
  "gpt-5-nano": "bg-amber-500",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, d = 1): string {
  if (n === null || n === undefined) return "—"
  return n.toFixed(d)
}
function fmtCost(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`
  return `$${n.toFixed(4)}`
}
function fmtMs(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—"
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`
  return `${s.toFixed(1)}s`
}

// ─── Combo Optimizer ─────────────────────────────────────────────────────────

function computeCombos(
  aggTable: Map<string, AggEntry>,
  models: string[],
  wQ = 0.5,
  wC = 0.3,
  wL = 0.2,
) {
  const allQ: number[] = []
  const allC: number[] = []
  const allL: number[] = []
  aggTable.forEach(a => {
    if (a.quality !== null) allQ.push(a.quality)
    if (a.cost !== null) allC.push(a.cost)
    if (a.latency !== null) allL.push(a.latency)
  })
  const [qMin, qMax] = allQ.length ? [Math.min(...allQ), Math.max(...allQ)] : [0, 1]
  const [cMin, cMax] = allC.length ? [Math.min(...allC), Math.max(...allC)] : [0, 1]
  const [lMin, lMax] = allL.length ? [Math.min(...allL), Math.max(...allL)] : [0, 1]

  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 1 : (v - lo) / (hi - lo))

  // Generate all combos
  const combos: Array<{
    assignment: Record<string, string>
    avgQuality: number
    totalCost: number
    totalLatency: number
    score: number
  }> = []

  function generate(idx: number, current: Record<string, string>) {
    if (idx === STAGES.length) {
      let totQ = 0, totC = 0, totL = 0
      let valid = true
      for (const stage of STAGES) {
        const a = aggTable.get(`${stage}|${current[stage]}`)
        if (!a || a.quality === null) { valid = false; break }
        totQ += a.quality
        totC += (a.cost || 0)
        totL += (a.latency || 0)
      }
      if (!valid) return

      const avgQ = totQ / STAGES.length
      const nq = norm(avgQ, qMin, qMax)
      const nc = cMax > cMin ? 1 - norm(totC, cMin * STAGES.length, cMax * STAGES.length) : 1
      const nl = lMax > lMin ? 1 - norm(totL, lMin * STAGES.length, lMax * STAGES.length) : 1
      const score = wQ * nq + wC * nc + wL * nl

      combos.push({
        assignment: { ...current },
        avgQuality: Math.round(avgQ * 10) / 10,
        totalCost: Math.round(totC * 1000000) / 1000000,
        totalLatency: Math.round(totL * 100) / 100,
        score: Math.round(score * 10000) / 10000,
      })
      return
    }
    for (const model of models) {
      current[STAGES[idx]] = model
      generate(idx + 1, current)
    }
  }

  generate(0, {})
  combos.sort((a, b) => b.score - a.score)
  return combos
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function LLMExperiment({
  benchmarkModels,
  questions,
  pricing,
}: {
  benchmarkModels: BenchmarkModel[]
  questions: BenchmarkQuestion[]
  pricing: Pricing
}) {
  const models = benchmarkModels.map(m => m.id)
  const [status, setStatus] = React.useState<RunStatus>("idle")
  const [progress, setProgress] = React.useState(0)
  const [totalCalls, setTotalCalls] = React.useState(0)
  const [cellStatus, setCellStatus] = React.useState<Record<string, CellStatus>>({})
  const [allResults, setAllResults] = React.useState<IndividualResult[]>([])
  const [errorMsg, setErrorMsg] = React.useState("")
  const [startTime, setStartTime] = React.useState<number>(0)
  const [elapsed, setElapsed] = React.useState(0)
  const [showDetails, setShowDetails] = React.useState(false)
  const [showCombos, setShowCombos] = React.useState(false)
  const abortRef = React.useRef(false)

  // Timer
  React.useEffect(() => {
    if (status !== "running") return
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(timer)
  }, [status, startTime])

  const total = models.length * questions.length

  // ── Run experiment ──
  const runExperiment = async () => {
    setStatus("running")
    setErrorMsg("")
    setAllResults([])
    setProgress(0)
    setTotalCalls(total)
    setStartTime(Date.now())
    setElapsed(0)
    abortRef.current = false

    const newCells: Record<string, CellStatus> = {}
    for (const m of models) {
      for (const q of questions) {
        newCells[`${m}|${q.id}`] = "pending"
      }
    }
    setCellStatus({ ...newCells })

    const accumulated: IndividualResult[] = []
    let done = 0

    for (const model of models) {
      for (const question of questions) {
        if (abortRef.current) {
          setStatus("idle")
          return
        }

        const key = `${model}|${question.id}`
        newCells[key] = "running"
        setCellStatus({ ...newCells })

        try {
          const result = await runLLMBenchmark({
            stages: STAGES,
            models: [model],
            question_ids: [question.id],
          })

          const results = (result.results || []) as IndividualResult[]
          accumulated.push(...results)
          setAllResults([...accumulated])

          const allOk = results.every(r => r.success)
          newCells[key] = allOk ? "success" : "failed"
        } catch (e) {
          newCells[key] = "failed"
          console.error(`Failed: ${key}`, e)
        }

        done++
        setProgress(done)
        setCellStatus({ ...newCells })
      }
    }

    setStatus("done")
  }

  const stopExperiment = () => {
    abortRef.current = true
  }

  // ── Aggregate results ──
  const aggTable = React.useMemo(() => {
    const groups = new Map<string, IndividualResult[]>()
    for (const r of allResults) {
      const key = `${r.stage}|${r.model}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(r)
    }

    const table = new Map<string, AggEntry>()
    groups.forEach((items, key) => {
      const success = items.filter(i => i.success)
      if (!success.length) {
        table.set(key, { quality: null, latency: null, cost: null, count: items.length, success: 0 })
        return
      }
      const qualities = success.filter(s => s.quality_score !== null).map(s => s.quality_score!)
      const latencies = success.map(s => s.latency_seconds || 0)
      const costs = success.map(s => s.cost_usd || 0)
      table.set(key, {
        quality: qualities.length ? Math.round((qualities.reduce((a, b) => a + b, 0) / qualities.length) * 10) / 10 : null,
        latency: Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 1000) / 1000,
        cost: Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 1000000) / 1000000,
        count: items.length,
        success: success.length,
      })
    })
    return table
  }, [allResults])

  // ── Baseline stats ──
  const baseline = React.useMemo(() => {
    let totQ = 0, totC = 0, totL = 0
    for (const stage of STAGES) {
      const model = BASELINE_MAP[stage]
      const a = aggTable.get(`${stage}|${model}`)
      totQ += a?.quality || 0
      totC += a?.cost || 0
      totL += a?.latency || 0
    }
    return {
      avgQuality: STAGES.length ? Math.round((totQ / STAGES.length) * 10) / 10 : 0,
      totalCost: totC,
      totalLatency: totL,
    }
  }, [aggTable])

  // ── Combos ──
  const combos = React.useMemo(() => {
    if (allResults.length < 24) return [] // need at least 1 full model tested
    return computeCombos(aggTable, models)
  }, [aggTable, models, allResults.length])

  const bestOverall = combos[0]
  const cheapest = combos.length ? combos.reduce((a, b) => a.totalCost < b.totalCost ? a : b) : null
  const fastest = combos.length ? combos.reduce((a, b) => a.totalLatency < b.totalLatency ? a : b) : null
  const bestQuality = combos.length ? combos.reduce((a, b) => a.avgQuality > b.avgQuality ? a : b) : null

  const pctDiff = (val: number, base: number) => base ? ((base - val) / base * 100) : 0

  // ── Render ──
  return (
    <div className="space-y-4">
      {/* ── Header & Controls ── */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FlaskConical className="h-3.5 w-3.5" /> Model Optimization Experiment
          </h3>
          <div className="flex items-center gap-2">
            {status === "running" && (
              <button
                onClick={stopExperiment}
                className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
              >
                <XCircle className="h-3 w-3" /> Stop
              </button>
            )}
            <button
              onClick={runExperiment}
              disabled={status === "running"}
              className={cn(
                "flex items-center gap-1.5 h-8 px-4 rounded-md text-[13px] font-medium transition-colors",
                status === "running"
                  ? "bg-muted text-muted-foreground cursor-wait"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {status === "running" ? "Running…" : "Run Experiment"}
            </button>
          </div>
        </div>

        {/* Info line */}
        <p className="text-[11px] text-muted-foreground mb-3">
          Tests {models.length} models × {questions.length} questions × {STAGES.length} stages = <strong>{models.length * questions.length * STAGES.length}</strong> LLM calls.
          Each HTTP request runs 1 model × 1 question (6 stages). Total: <strong>{total}</strong> requests.
        </p>

        {/* Model chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {benchmarkModels.map(m => (
            <div key={m.id} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border border-border bg-card">
              <div className={cn("w-2 h-2 rounded-full", MODEL_COLORS[m.id] || "bg-gray-400")} />
              {m.label}
              <span className="text-[9px] text-muted-foreground">
                ${pricing[m.id]?.input ?? "?"}/{pricing[m.id]?.output ?? "?"}
              </span>
            </div>
          ))}
        </div>

        {errorMsg && (
          <div className="mb-3 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2 text-xs flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 flex-shrink-0" /> {errorMsg}
          </div>
        )}

        {/* Progress bar */}
        {(status === "running" || status === "done") && (
          <div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
              <span>{progress}/{totalCalls} requests complete</span>
              <span>{Math.floor(elapsed / 1000)}s elapsed</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  status === "done" ? "bg-emerald-500" : "bg-primary"
                )}
                style={{ width: `${totalCalls ? (progress / totalCalls * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Progress Grid (Model × Question) ── */}
      {(status === "running" || status === "done") && (
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Progress Grid
            </h3>
          </div>
          <div className="overflow-x-auto p-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1 text-[10px] font-medium text-muted-foreground">Model</th>
                  {questions.map(q => (
                    <th key={q.id} className="text-center px-1 py-1 text-[9px] font-medium text-muted-foreground" title={q.query}>
                      {q.id.replace(/^(kyc|alm|combined)\d+_/, "").slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map(model => (
                  <tr key={model}>
                    <td className="px-2 py-1 font-mono text-[11px] text-foreground whitespace-nowrap">{model}</td>
                    {questions.map(q => {
                      const cs = cellStatus[`${model}|${q.id}`] || "pending"
                      return (
                        <td key={q.id} className="px-1 py-1 text-center">
                          {cs === "pending" && <div className="w-5 h-5 rounded bg-muted mx-auto" />}
                          {cs === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto" />}
                          {cs === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />}
                          {cs === "failed" && <XCircle className="h-4 w-4 text-red-500 mx-auto" />}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Results Matrix (Stage × Model) ── */}
      {aggTable.size > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Stage × Model Comparison
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Stage</th>
                  {models.map(m => (
                    <th key={m} className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">
                      <div className="flex items-center justify-center gap-1">
                        <div className={cn("w-2 h-2 rounded-full", MODEL_COLORS[m] || "bg-gray-400")} />
                        {m}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAGES.map(stage => {
                  // Find best quality for this stage
                  let bestQ = -1
                  let bestM = ""
                  for (const m of models) {
                    const a = aggTable.get(`${stage}|${m}`)
                    if (a && a.quality !== null && a.quality > bestQ) { bestQ = a.quality; bestM = m }
                  }

                  return (
                    <tr key={stage} className="border-b border-border/30 hover:bg-muted/20">
                      <td className="px-3 py-2 text-foreground font-medium">
                        {STAGE_LABELS[stage] || stage}
                        <span className="ml-1 text-[9px] text-muted-foreground">
                          (baseline: {BASELINE_MAP[stage]})
                        </span>
                      </td>
                      {models.map(m => {
                        const a = aggTable.get(`${stage}|${m}`)
                        const isBest = m === bestM && bestQ > 0
                        const isBaseline = BASELINE_MAP[stage] === m
                        if (!a) return <td key={m} className="px-3 py-2 text-center text-muted-foreground">—</td>
                        return (
                          <td key={m} className={cn("px-3 py-2 text-center", isBest && "bg-amber-500/5")}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={cn(
                                "text-sm font-bold",
                                a.quality !== null && a.quality >= 80 ? "text-emerald-600 dark:text-emerald-400"
                                : a.quality !== null && a.quality >= 50 ? "text-amber-600 dark:text-amber-400"
                                : a.quality === null ? "text-muted-foreground" : "text-red-600 dark:text-red-400"
                              )}>
                                {a.quality !== null ? fmt(a.quality, 0) : "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{fmtMs(a.latency)}</span>
                              <span className="text-[9px] text-muted-foreground">{fmtCost(a.cost)}</span>
                              <div className="flex items-center gap-0.5">
                                {isBest && <Trophy className="h-3 w-3 text-amber-500" />}
                                {isBaseline && <span className="text-[8px] bg-blue-500/10 text-blue-500 rounded px-1">BASE</span>}
                              </div>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recommendations ── */}
      {combos.length > 0 && (
        <div className="space-y-4">
          {/* Baseline */}
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <h3 className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" /> Current Baseline
            </h3>
            <div className="grid grid-cols-3 gap-4 mb-3">
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{fmt(baseline.avgQuality)}</p>
                <p className="text-[10px] text-muted-foreground">Avg Quality</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{fmtCost(baseline.totalCost)}</p>
                <p className="text-[10px] text-muted-foreground">Cost/Question</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-foreground">{fmtMs(baseline.totalLatency)}</p>
                <p className="text-[10px] text-muted-foreground">Latency/Question</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {STAGES.map(s => (
                <span key={s} className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full px-2 py-0.5">
                  {STAGE_LABELS[s]}: <strong>{BASELINE_MAP[s]}</strong>
                </span>
              ))}
            </div>
          </div>

          {/* Recommendation cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: "overall", label: "Best Overall", icon: <Trophy className="h-4 w-4 text-amber-500" />, combo: bestOverall, borderClass: "border-amber-500/20 bg-amber-500/5" },
              { key: "cheapest", label: "Cheapest", icon: <DollarSign className="h-4 w-4 text-emerald-500" />, combo: cheapest, borderClass: "border-emerald-500/20 bg-emerald-500/5" },
              { key: "fastest", label: "Fastest", icon: <Zap className="h-4 w-4 text-blue-500" />, combo: fastest, borderClass: "border-blue-500/20 bg-blue-500/5" },
              { key: "quality", label: "Highest Quality", icon: <TrendingUp className="h-4 w-4 text-purple-500" />, combo: bestQuality, borderClass: "border-purple-500/20 bg-purple-500/5" },
            ].map(({ key, label, icon, combo, borderClass }) => {
              if (!combo) return null
              const costSave = pctDiff(combo.totalCost, baseline.totalCost)
              const latSave = pctDiff(combo.totalLatency, baseline.totalLatency)
              const qDiff = combo.avgQuality - baseline.avgQuality

              return (
                <div key={key} className={cn("rounded-lg border p-4", borderClass)}>
                  <div className="flex items-center gap-1.5 mb-3">
                    {icon}
                    <h4 className="text-xs font-semibold text-foreground uppercase">{label}</h4>
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground">score: {combo.score}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">{fmt(combo.avgQuality)}</p>
                      <p className={cn("text-[10px] font-semibold", qDiff >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {qDiff >= 0 ? "+" : ""}{fmt(qDiff)}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">{fmtCost(combo.totalCost)}</p>
                      <p className={cn("text-[10px] font-semibold", costSave >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {costSave >= 0 ? "-" : "+"}{Math.abs(costSave).toFixed(0)}%
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">{fmtMs(combo.totalLatency)}</p>
                      <p className={cn("text-[10px] font-semibold", latSave >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {latSave >= 0 ? "-" : "+"}{Math.abs(latSave).toFixed(0)}%
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {STAGES.map(s => {
                      const model = combo.assignment[s]
                      const changed = model !== BASELINE_MAP[s]
                      return (
                        <span key={s} className={cn(
                          "text-[9px] rounded-full px-2 py-0.5 border",
                          changed ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 font-semibold" : "bg-muted border-border text-muted-foreground"
                        )}>
                          {STAGE_LABELS[s]}: {model}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top combos table */}
          <div className="rounded-lg border border-border bg-card">
            <button
              onClick={() => setShowCombos(!showCombos)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
            >
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" /> Top 15 Model Combos (out of {combos.length})
              </h3>
              {showCombos ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showCombos && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/30">
                    <tr className="border-b border-border">
                      <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">#</th>
                      <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">Score</th>
                      <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">Quality</th>
                      <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">Cost/Q</th>
                      <th className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">Latency</th>
                      {STAGES.map(s => (
                        <th key={s} className="text-center px-2 py-1.5 text-[10px] font-medium text-muted-foreground">{STAGE_LABELS[s]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {combos.slice(0, 15).map((c, i) => (
                      <tr key={i} className={cn("border-b border-border/30 hover:bg-muted/20", i === 0 && "bg-amber-500/5")}>
                        <td className="text-center px-2 py-1.5 font-bold text-muted-foreground">{i + 1}</td>
                        <td className="text-center px-2 py-1.5 font-mono font-bold">{c.score}</td>
                        <td className="text-center px-2 py-1.5">{fmt(c.avgQuality)}</td>
                        <td className="text-center px-2 py-1.5 font-mono">{fmtCost(c.totalCost)}</td>
                        <td className="text-center px-2 py-1.5">{fmtMs(c.totalLatency)}</td>
                        {STAGES.map(s => (
                          <td key={s} className={cn(
                            "text-center px-2 py-1.5 font-mono",
                            c.assignment[s] !== BASELINE_MAP[s] ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"
                          )}>
                            {c.assignment[s].replace("gpt-", "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Individual Results (collapsible) ── */}
      {allResults.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/20 transition-colors"
          >
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Individual Results ({allResults.length})
            </h3>
            {showDetails ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showDetails && (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto border-t border-border">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1 text-[10px] font-medium text-muted-foreground">Stage</th>
                    <th className="text-left px-2 py-1 text-[10px] font-medium text-muted-foreground">Model</th>
                    <th className="text-left px-2 py-1 text-[10px] font-medium text-muted-foreground">Question</th>
                    <th className="text-right px-2 py-1 text-[10px] font-medium text-muted-foreground">Quality</th>
                    <th className="text-right px-2 py-1 text-[10px] font-medium text-muted-foreground">Latency</th>
                    <th className="text-right px-2 py-1 text-[10px] font-medium text-muted-foreground">Cost</th>
                    <th className="text-center px-2 py-1 text-[10px] font-medium text-muted-foreground">OK</th>
                  </tr>
                </thead>
                <tbody>
                  {allResults.map((r, i) => (
                    <tr key={i} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="px-2 py-1 text-foreground">{STAGE_LABELS[r.stage] || r.stage}</td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">{r.model}</td>
                      <td className="px-2 py-1 text-muted-foreground truncate max-w-[120px]">{r.question_id}</td>
                      <td className={cn("px-2 py-1 text-right font-semibold",
                        r.quality_score !== null && r.quality_score >= 80 ? "text-emerald-600" : r.quality_score !== null && r.quality_score >= 50 ? "text-amber-600" : "text-red-600"
                      )}>
                        {r.quality_score !== null ? fmt(r.quality_score, 0) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-muted-foreground">{fmtMs(r.latency_seconds)}</td>
                      <td className="px-2 py-1 text-right font-mono text-muted-foreground">{fmtCost(r.cost_usd)}</td>
                      <td className="px-2 py-1 text-center">
                        {r.success ? <CheckCircle2 className="h-3 w-3 text-emerald-500 inline" /> : <XCircle className="h-3 w-3 text-red-500 inline" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {status === "idle" && allResults.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <FlaskConical className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No experiment results yet</p>
          <p className="text-xs text-muted-foreground mt-1">Click &quot;Run Experiment&quot; to test all models across all pipeline stages</p>
        </div>
      )}
    </div>
  )
}
