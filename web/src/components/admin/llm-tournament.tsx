"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { runTournamentBattle } from "@/lib/api"
import {
  Trophy,
  Play,
  Square,
  Loader2,
  ChevronDown,
  ChevronRight,
  Crown,
  Swords,
  Eye,
  Timer,
  DollarSign,
  Zap,
  Target,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface BenchmarkQuestion {
  id: string
  query: string
  expected_type: string
  complexity: string
}

interface Ranking {
  model: string
  rank: number
  score: number
  reasoning: string
}

interface JudgeResult {
  rankings: Ranking[]
  winner: string
  analysis: string
  judge_model: string
  judge_reasoning_effort?: string
  judge_latency: number
  judge_cost: number
  judge_input_tokens?: number
  judge_output_tokens?: number
}

interface ModelResult {
  stage: string
  model: string
  question_id: string
  success: boolean
  error: string | null
  latency_seconds: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  output_text: string
  quality_score: number | null
}

interface BattleResult {
  stage: string
  stage_label: string
  question_id: string
  question_text: string
  models: string[]
  results: Record<string, ModelResult>
  judge: JudgeResult | null
  error: string | null
}

type BattleStatus = "pending" | "running" | "done" | "error"

const STAGES = [
  "classification",
  "expansion",
  "location",
  "reflection",
  "synthesis",
  "verification",
] as const

const STAGE_LABELS: Record<string, string> = {
  classification: "Classify",
  expansion: "Expand",
  location: "Locate",
  reflection: "Reflect",
  synthesis: "Synthesize",
  verification: "Verify",
}

// Default fallback models (used if none provided via props)
const DEFAULT_MODELS = ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano"]

function getModelShort(modelId: string): string {
  // OpenAI models: strip "gpt-" prefix
  if (modelId.startsWith("gpt-")) return modelId.replace("gpt-", "")
  // DeepInfra models: strip org prefix (e.g. "zai-org/GLM-5" → "GLM-5")
  if (modelId.includes("/")) return modelId.split("/").pop() || modelId
  return modelId
}

// ─── Component ────────────────────────────────────────────────────────────────

interface BenchmarkModel {
  id: string
  label: string
  tier?: string
  speed?: string
  reasoning?: string
  provider?: string
}

export function LLMTournament({
  questions,
  benchmarkModels,
}: {
  questions: BenchmarkQuestion[]
  benchmarkModels?: BenchmarkModel[]
}) {
  const ALL_MODELS = React.useMemo(
    () => benchmarkModels?.map(m => m.id) || DEFAULT_MODELS,
    [benchmarkModels],
  )
  const MODEL_SHORT = React.useMemo(() => {
    const map: Record<string, string> = {}
    if (benchmarkModels) {
      for (const m of benchmarkModels) map[m.id] = m.label || getModelShort(m.id)
    } else {
      for (const id of DEFAULT_MODELS) map[id] = getModelShort(id)
    }
    return map
  }, [benchmarkModels])
  const [status, setStatus] = React.useState<"idle" | "running" | "done">("idle")
  const [battles, setBattles] = React.useState<Record<string, BattleResult>>({})
  const [cellStatus, setCellStatus] = React.useState<Record<string, BattleStatus>>({})
  const [progress, setProgress] = React.useState(0)
  const [totalBattles, setTotalBattles] = React.useState(0)
  const [errorMsg, setErrorMsg] = React.useState("")
  const [startTime, setStartTime] = React.useState(0)
  const [elapsed, setElapsed] = React.useState(0)
  const [expandedBattle, setExpandedBattle] = React.useState<string | null>(null)
  const [showFinalRankings, setShowFinalRankings] = React.useState(true)
  const [judgeCost, setJudgeCost] = React.useState(0)
  const abortRef = React.useRef(false)

  // ── Stage / Model selectors ──
  const [selStages, setSelStages] = React.useState<string[]>([])
  const [selModels, setSelModels] = React.useState<string[]>([])

  const toggleStage = (s: string) => setSelStages(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])
  const toggleModel = (m: string) => setSelModels(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m])

  const activeStages = selStages.length > 0 ? STAGES.filter(s => selStages.includes(s)) : [...STAGES]
  const activeModels = selModels.length > 0 ? ALL_MODELS.filter(m => selModels.includes(m)) : [...ALL_MODELS]

  // Timer
  React.useEffect(() => {
    if (status !== "running") return
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(timer)
  }, [status, startTime])

  const total = activeStages.length * questions.length

  // ── Run tournament (merges into existing battles) ──
  const runTournament = async () => {
    setStatus("running")
    setErrorMsg("")
    setProgress(0)
    setTotalBattles(total)
    setStartTime(Date.now())
    setElapsed(0)
    abortRef.current = false

    // Merge: keep old cell status, mark targeted ones as pending
    const newCells: Record<string, BattleStatus> = { ...cellStatus }
    for (const stage of activeStages) {
      for (const q of questions) {
        newCells[`${stage}|${q.id}`] = "pending"
      }
    }
    setCellStatus({ ...newCells })

    const accumulated: Record<string, BattleResult> = { ...battles }
    let done = 0
    let runJudgeCost = 0

    for (const stage of activeStages) {
      for (const question of questions) {
        if (abortRef.current) {
          setStatus("done")
          return
        }

        const key = `${stage}|${question.id}`
        newCells[key] = "running"
        setCellStatus({ ...newCells })

        try {
          const result = await runTournamentBattle({
            stage,
            question_id: question.id,
            models: activeModels,
          }) as unknown as BattleResult

          accumulated[key] = result
          newCells[key] = result.error && !result.judge ? "error" : "done"
          if (result.judge) {
            runJudgeCost += result.judge.judge_cost || 0
          }
        } catch (e) {
          newCells[key] = "error"
          accumulated[key] = {
            stage,
            stage_label: STAGE_LABELS[stage] || stage,
            question_id: question.id,
            question_text: question.query,
            models: activeModels,
            results: {},
            judge: null,
            error: e instanceof Error ? e.message : "Request failed",
          }
        }

        done++
        setProgress(done)
        setBattles({ ...accumulated })
        setCellStatus({ ...newCells })
        setJudgeCost(prev => prev + 0) // keep cumulative
      }
    }

    setJudgeCost(prev => prev + runJudgeCost)
    setStatus("done")
  }

  const stopTournament = () => {
    abortRef.current = true
  }

  // ── Compute aggregated rankings ──
  const stageWins = React.useMemo(() => {
    // For each stage, tally judge scores across all questions
    const result: Record<string, Record<string, { totalScore: number; wins: number; battles: number; avgScore: number }>> = {}

    for (const stage of STAGES) {
      result[stage] = {}
      for (const model of ALL_MODELS) {
        result[stage][model] = { totalScore: 0, wins: 0, battles: 0, avgScore: 0 }
      }

      for (const q of questions) {
        const key = `${stage}|${q.id}`
        const battle = battles[key]
        if (!battle?.judge?.rankings) continue

        for (const r of battle.judge.rankings) {
          if (!result[stage][r.model]) {
            result[stage][r.model] = { totalScore: 0, wins: 0, battles: 0, avgScore: 0 }
          }
          result[stage][r.model].totalScore += r.score
          result[stage][r.model].battles++
          if (r.rank === 1) result[stage][r.model].wins++
        }
      }

      // Compute averages
      for (const model of ALL_MODELS) {
        const s = result[stage][model]
        if (s) s.avgScore = s.battles > 0 ? Math.round(s.totalScore / s.battles * 10) / 10 : 0
      }
    }

    return result
  }, [battles, questions, ALL_MODELS])

  // Best model per stage (by average judge score)
  const bestPerStage = React.useMemo(() => {
    const result: Record<string, { model: string; avgScore: number; wins: number }> = {}
    for (const stage of STAGES) {
      const sw = stageWins[stage]
      if (!sw) continue
      let best = { model: "", avgScore: 0, wins: 0 }
      for (const model of ALL_MODELS) {
        const s = sw[model]
        if (s && (s.avgScore > best.avgScore || (s.avgScore === best.avgScore && s.wins > best.wins))) {
          best = { model, avgScore: s.avgScore, wins: s.wins }
        }
      }
      if (best.model) result[stage] = best
    }
    return result
  }, [stageWins, ALL_MODELS])

  // Optimal combo
  const optimalCombo = React.useMemo(() => {
    const combo: Record<string, string> = {}
    for (const stage of STAGES) {
      combo[stage] = bestPerStage[stage]?.model || "gpt-5.2"
    }
    return combo
  }, [bestPerStage])

  const completedBattles = Object.values(cellStatus).filter(s => s === "done").length
  const errorBattles = Object.values(cellStatus).filter(s => s === "error").length
  const fmt = (n: number) => Math.round(n * 10) / 10
  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <Swords className="h-4 w-4 text-orange-500" />
            Tournament Mode
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeStages.length} stage{activeStages.length !== 1 ? "s" : ""} &times; {questions.length} questions = {total} battles.
            {activeModels.length < ALL_MODELS.length ? ` (${activeModels.map(m => MODEL_SHORT[m] || getModelShort(m)).join(" vs ")})` : ` Each: ${ALL_MODELS.length} models compete.`} GPT-5.2-pro judges.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "running" && (
            <span className="text-xs text-muted-foreground font-mono">
              {fmtTime(elapsed)} | {progress}/{total} | Judge: ${judgeCost.toFixed(4)}
            </span>
          )}
          {status !== "running" ? (
            <button
              onClick={runTournament}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-orange-600 text-white text-xs font-medium hover:bg-orange-700 transition-colors"
            >
              <Play className="h-3 w-3" />
              {Object.keys(battles).length > 0 ? "Run Selected" : "Start Tournament"}
            </button>
          ) : (
            <button
              onClick={stopTournament}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Stage / Model filter chips */}
      <div className="flex flex-wrap gap-3 items-start">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium uppercase">Stages:</span>
          {STAGES.map(s => (
            <button
              key={s}
              onClick={() => toggleStage(s)}
              disabled={status === "running"}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium border transition-colors",
                selStages.includes(s)
                  ? "bg-orange-500/20 border-orange-500/40 text-orange-400"
                  : selStages.length === 0
                    ? "bg-muted/50 border-border text-muted-foreground"
                    : "bg-muted/20 border-border/50 text-muted-foreground/50"
              )}
            >
              {STAGE_LABELS[s]}
            </button>
          ))}
          {selStages.length > 0 && (
            <button onClick={() => setSelStages([])} className="text-xs text-muted-foreground hover:text-foreground ml-1">clear</button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium uppercase">Models:</span>
          {ALL_MODELS.map(m => (
            <button
              key={m}
              onClick={() => toggleModel(m)}
              disabled={status === "running"}
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium border transition-colors",
                selModels.includes(m)
                  ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                  : selModels.length === 0
                    ? "bg-muted/50 border-border text-muted-foreground"
                    : "bg-muted/20 border-border/50 text-muted-foreground/50"
              )}
            >
              {MODEL_SHORT[m] || getModelShort(m)}
            </button>
          ))}
          {selModels.length > 0 && (
            <button onClick={() => setSelModels([])} className="text-xs text-muted-foreground hover:text-foreground ml-1">clear</button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(status === "running" || status === "done") && (
        <div className="space-y-1.5">
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                status === "done" ? "bg-orange-500" : "bg-orange-500/80"
              )}
              style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress}/{total} battles</span>
            <span>{completedBattles} done, {errorBattles} errors</span>
          </div>
        </div>
      )}

      {/* Progress Grid: stage × question */}
      {Object.keys(cellStatus).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Battle Grid</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left px-1 py-0.5 text-muted-foreground font-medium">Stage</th>
                  {questions.map(q => (
                    <th key={q.id} className="text-center px-1 py-0.5 text-muted-foreground font-medium" title={q.query}>
                      {q.id.replace(/^[a-z]+\d*_/, "").slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAGES.map(stage => (
                  <tr key={stage}>
                    <td className="text-left px-1 py-1 text-foreground font-medium">{STAGE_LABELS[stage]}</td>
                    {questions.map(q => {
                      const key = `${stage}|${q.id}`
                      const cs = cellStatus[key]
                      const battle = battles[key]
                      const winner = battle?.judge?.winner
                      return (
                        <td key={q.id} className="text-center px-1 py-1">
                          {cs === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin text-orange-500 mx-auto" />
                          ) : cs === "done" ? (
                            <button
                              onClick={() => setExpandedBattle(expandedBattle === key ? null : key)}
                              className="mx-auto flex items-center justify-center"
                              title={`Winner: ${winner || "?"}`}
                            >
                              <Crown className="h-3 w-3 text-amber-500" />
                              <span className="text-xs text-muted-foreground ml-0.5">
                                {MODEL_SHORT[winner || ""] || getModelShort(winner || "") || "?"}
                              </span>
                            </button>
                          ) : cs === "error" ? (
                            <span className="text-red-500 text-xs" title={battle?.error || "Error"}>&#10060;</span>
                          ) : (
                            <span className="text-muted-foreground/30">&bull;</span>
                          )}
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

      {/* Expanded battle detail */}
      {expandedBattle && battles[expandedBattle] && (
        <BattleDetail battle={battles[expandedBattle]} onClose={() => setExpandedBattle(null)} />
      )}

      {/* Final Rankings per Stage */}
      {completedBattles >= total * 0.5 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <button
            onClick={() => setShowFinalRankings(!showFinalRankings)}
            className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider w-full"
          >
            {showFinalRankings ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Trophy className="h-3.5 w-3.5 text-amber-500" />
            Tournament Results — Judge Rankings
          </button>

          {showFinalRankings && (
            <div className="mt-4 space-y-4">
              {/* Stage × Model ranking matrix */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Stage</th>
                      {ALL_MODELS.map(m => (
                        <th key={m} className="text-center px-2 py-1.5 text-muted-foreground font-medium">{MODEL_SHORT[m] || getModelShort(m)}</th>
                      ))}
                      <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map(stage => {
                      const sw = stageWins[stage]
                      const best = bestPerStage[stage]
                      const maxScore = Math.max(...ALL_MODELS.map(m => sw?.[m]?.avgScore || 0))
                      return (
                        <tr key={stage} className="border-b border-border/50">
                          <td className="px-2 py-2 font-medium text-foreground">{STAGE_LABELS[stage]}</td>
                          {ALL_MODELS.map(m => {
                            const s = sw?.[m]
                            if (!s || s.battles === 0) return <td key={m} className="text-center px-2 py-2 text-muted-foreground">&mdash;</td>
                            const isBest = s.avgScore === maxScore && maxScore > 0
                            return (
                              <td key={m} className={cn("text-center px-2 py-2", isBest && "bg-amber-500/10")}>
                                <div className={cn("text-xs font-bold", isBest ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                                  {s.avgScore}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {s.wins}/{s.battles} wins
                                </div>
                              </td>
                            )
                          })}
                          <td className="text-center px-2 py-2">
                            {best && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                <Crown className="h-3 w-3" />
                                {MODEL_SHORT[best.model] || getModelShort(best.model)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Optimal combo card */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <h4 className="text-xs font-bold text-foreground uppercase">Optimal Combination (Judge-Verified)</h4>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {STAGES.map(stage => (
                    <div key={stage} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-16">{STAGE_LABELS[stage]}:</span>
                      <span className="font-bold text-foreground">{optimalCombo[stage]}</span>
                      {bestPerStage[stage] && (
                        <span className="text-xs text-muted-foreground">
                          (avg: {bestPerStage[stage].avgScore})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-question breakdown */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase">Per-Question Winners</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-1.5 py-1 text-muted-foreground">Question</th>
                        {STAGES.map(s => (
                          <th key={s} className="text-center px-1.5 py-1 text-muted-foreground">{STAGE_LABELS[s]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {questions.map(q => (
                        <tr key={q.id} className="border-b border-border/30">
                          <td className="px-1.5 py-1 text-foreground font-medium" title={q.query}>
                            {q.id.replace(/^[a-z]+\d*_/, "").slice(0, 12)}
                          </td>
                          {STAGES.map(stage => {
                            const key = `${stage}|${q.id}`
                            const battle = battles[key]
                            const winner = battle?.judge?.winner
                            const rankings = battle?.judge?.rankings || []
                            const topRank = rankings.find(r => r.rank === 1)
                            return (
                              <td key={stage} className="text-center px-1.5 py-1">
                                {winner ? (
                                  <button
                                    onClick={() => setExpandedBattle(expandedBattle === key ? null : key)}
                                    className="hover:underline"
                                    title={topRank?.reasoning || ""}
                                  >
                                    <span className={cn(
                                      "font-semibold",
                                      winner === bestPerStage[stage]?.model
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-foreground"
                                    )}>
                                      {MODEL_SHORT[winner] || getModelShort(winner)}
                                    </span>
                                    <span className="text-muted-foreground ml-0.5">
                                      ({topRank?.score || "?"})
                                    </span>
                                  </button>
                                ) : battle?.error ? (
                                  <span className="text-red-500" title={battle.error}>err</span>
                                ) : (
                                  <span className="text-muted-foreground">&mdash;</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cost summary */}
              {status === "done" && (
                <div className="text-xs text-muted-foreground text-right">
                  Total judge cost: ${judgeCost.toFixed(4)} &bull;
                  Completed: {completedBattles}/{totalBattles} &bull;
                  Errors: {errorBattles} &bull;
                  Time: {fmtTime(elapsed)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Head-to-Head: 5.2 vs 5.2-pro */}
      <HeadToHead battles={battles} questions={questions} stageWins={stageWins} />

      {/* Idle state */}
      {status === "idle" && Object.keys(battles).length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Swords className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Tournament not started</p>
          <p className="text-xs text-muted-foreground mt-1">
            Each battle runs {ALL_MODELS.length} models + 1 judge call = ~{ALL_MODELS.length + 1} LLM calls per battle.
            Total: ~{total * (ALL_MODELS.length + 1)} LLM calls ({total} battles).
          </p>
        </div>
      )}
    </div>
  )
}


// ─── Battle Detail Component ──────────────────────────────────────────────────

function BattleDetail({ battle, onClose }: { battle: BattleResult; onClose: () => void }) {
  const [showOutputs, setShowOutputs] = React.useState(true)

  return (
    <div className="rounded-lg border border-orange-500/30 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-orange-500" />
          {battle.stage_label} &times; {battle.question_id}
        </h4>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">&times; Close</button>
      </div>

      {/* Question */}
      <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-24 overflow-y-auto">
        <strong>Q:</strong> {battle.question_text}
      </div>

      {/* Judge verdict */}
      {battle.judge && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Trophy className="h-3 w-3 text-amber-500" />
            Judge Verdict
            <span className="ml-auto text-xs font-mono text-muted-foreground">
              {battle.judge.judge_model} | {battle.judge.judge_latency}s | ${battle.judge.judge_cost?.toFixed(4)}
            </span>
          </div>

          {/* Rankings */}
          <div className="space-y-1">
            {(battle.judge.rankings || [])
              .sort((a, b) => a.rank - b.rank)
              .map(r => (
                <div key={r.model} className={cn(
                  "flex items-start gap-2 rounded p-2 text-xs",
                  r.rank === 1 ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/30"
                )}>
                  <span className={cn(
                    "font-bold text-xs min-w-[1.5rem] text-center",
                    r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-zinc-400" : "text-zinc-500"
                  )}>
                    #{r.rank}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{r.model}</span>
                      <span className={cn(
                        "text-xs font-bold px-1.5 py-0.5 rounded",
                        r.score >= 90 ? "bg-emerald-500/20 text-emerald-500" :
                        r.score >= 70 ? "bg-blue-500/20 text-blue-500" :
                        r.score >= 50 ? "bg-yellow-500/20 text-yellow-500" :
                        "bg-red-500/20 text-red-500"
                      )}>
                        {r.score}/100
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{r.reasoning}</p>
                  </div>
                </div>
              ))}
          </div>

          {/* Analysis */}
          {battle.judge.analysis && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">
              <strong>Analysis:</strong> {battle.judge.analysis}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {battle.error && !battle.judge && (
        <div className="text-xs text-red-500 bg-red-500/10 rounded p-2">
          {battle.error}
        </div>
      )}

      {/* Model outputs toggle */}
      <button
        onClick={() => setShowOutputs(!showOutputs)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showOutputs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Model Outputs
      </button>

      {showOutputs && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {Object.entries(battle.results).map(([model, result]) => (
            <div key={model} className={cn(
              "rounded border p-2 text-xs",
              result.success ? "border-border" : "border-red-500/30"
            )}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-foreground">{model}</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {result.success ? (
                    <>
                      <span className="flex items-center gap-0.5"><Timer className="h-2.5 w-2.5" />{result.latency_seconds}s</span>
                      <span className="flex items-center gap-0.5"><DollarSign className="h-2.5 w-2.5" />${result.cost_usd?.toFixed(5)}</span>
                      <span className="flex items-center gap-0.5"><Target className="h-2.5 w-2.5" />{result.input_tokens}→{result.output_tokens}tok</span>
                    </>
                  ) : (
                    <span className="text-red-500">FAILED</span>
                  )}
                </div>
              </div>
              {result.success ? (
                <pre className="text-xs text-muted-foreground bg-muted/30 rounded p-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                  {result.output_text?.slice(0, 2000) || "(empty)"}
                </pre>
              ) : (
                <div className="text-red-400 text-xs">{result.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// ─── Head-to-Head Analysis: 5.2 vs 5.2-pro ──────────────────────────────────

function HeadToHead({
  battles,
  questions,
  stageWins,
}: {
  battles: Record<string, BattleResult>
  questions: BenchmarkQuestion[]
  stageWins: Record<string, Record<string, { totalScore: number; wins: number; battles: number; avgScore: number }>>
}) {
  const [expanded, setExpanded] = React.useState(true)

  const M_A = "gpt-5.2"
  const M_B = "gpt-5.2-pro"

  // Check if we have any data for both models
  const hasData = Object.values(battles).some(b =>
    b.judge?.rankings?.some(r => r.model === M_A) && b.judge?.rankings?.some(r => r.model === M_B)
  )

  if (!hasData) return null

  // Per-stage comparison
  type StageComp = {
    stage: string
    scoreA: number
    scoreB: number
    delta: number
    winsA: number
    winsB: number
    battlesA: number
    battlesB: number
    perQuestion: Array<{
      qid: string
      scoreA: number | null
      scoreB: number | null
      delta: number | null
      winner: string | null
    }>
  }

  const stageComps: StageComp[] = []
  let totalScoreA = 0, totalScoreB = 0, totalQuestionsCompared = 0

  for (const stage of STAGES) {
    const swA = stageWins[stage]?.[M_A]
    const swB = stageWins[stage]?.[M_B]
    if (!swA && !swB) continue

    const perQuestion: StageComp["perQuestion"] = []
    for (const q of questions) {
      const key = `${stage}|${q.id}`
      const battle = battles[key]
      if (!battle?.judge?.rankings) {
        perQuestion.push({ qid: q.id, scoreA: null, scoreB: null, delta: null, winner: null })
        continue
      }
      const rA = battle.judge.rankings.find(r => r.model === M_A)
      const rB = battle.judge.rankings.find(r => r.model === M_B)
      const sA = rA?.score ?? null
      const sB = rB?.score ?? null
      const d = sA !== null && sB !== null ? sB - sA : null
      if (sA !== null && sB !== null) {
        totalScoreA += sA
        totalScoreB += sB
        totalQuestionsCompared++
      }
      perQuestion.push({
        qid: q.id,
        scoreA: sA,
        scoreB: sB,
        delta: d,
        winner: d !== null ? (d > 0 ? M_B : d < 0 ? M_A : "tie") : null,
      })
    }

    stageComps.push({
      stage,
      scoreA: swA?.avgScore || 0,
      scoreB: swB?.avgScore || 0,
      delta: (swB?.avgScore || 0) - (swA?.avgScore || 0),
      winsA: swA?.wins || 0,
      winsB: swB?.wins || 0,
      battlesA: swA?.battles || 0,
      battlesB: swB?.battles || 0,
      perQuestion,
    })
  }

  const avgA = totalQuestionsCompared > 0 ? Math.round(totalScoreA / totalQuestionsCompared * 10) / 10 : 0
  const avgB = totalQuestionsCompared > 0 ? Math.round(totalScoreB / totalQuestionsCompared * 10) / 10 : 0
  const overallDelta = Math.round((avgB - avgA) * 10) / 10

  // Count how many questions pro wins vs 5.2 wins
  let proWinsCount = 0, baseWinsCount = 0, tiesCount = 0
  for (const sc of stageComps) {
    for (const pq of sc.perQuestion) {
      if (pq.winner === M_B) proWinsCount++
      else if (pq.winner === M_A) baseWinsCount++
      else if (pq.winner === "tie") tiesCount++
    }
  }

  return (
    <div className="rounded-lg border border-blue-500/20 bg-card p-4 space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-semibold text-foreground uppercase tracking-wider w-full"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Zap className="h-3.5 w-3.5 text-blue-500" />
        Head-to-Head: {getModelShort(M_A)} vs {getModelShort(M_B)}
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Overall summary */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs font-bold text-foreground">{avgA}</div>
              <div className="text-xs text-muted-foreground">{getModelShort(M_A)} avg score</div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className={cn(
                "text-xs font-bold",
                overallDelta > 0 ? "text-emerald-500" : overallDelta < 0 ? "text-red-500" : "text-muted-foreground"
              )}>
                {overallDelta > 0 ? "+" : ""}{overallDelta}
              </div>
              <div className="text-xs text-muted-foreground">pro advantage</div>
            </div>
            <div className="rounded-lg bg-muted/30 p-3">
              <div className="text-xs font-bold text-foreground">{avgB}</div>
              <div className="text-xs text-muted-foreground">{getModelShort(M_B)} avg score</div>
            </div>
          </div>

          {/* Win/loss summary */}
          <div className="flex items-center justify-center gap-4 text-xs">
            <span className="text-blue-400 font-semibold">{getModelShort(M_B)} wins: {proWinsCount}</span>
            <span className="text-muted-foreground">Ties: {tiesCount}</span>
            <span className="text-orange-400 font-semibold">{getModelShort(M_A)} wins: {baseWinsCount}</span>
            <span className="text-muted-foreground/60">({totalQuestionsCompared} compared)</span>
          </div>

          {/* Per-stage comparison table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5 text-muted-foreground font-medium">Stage</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">{getModelShort(M_A)}</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">{getModelShort(M_B)}</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Delta</th>
                  <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Better</th>
                </tr>
              </thead>
              <tbody>
                {stageComps.map(sc => (
                  <tr key={sc.stage} className="border-b border-border/30">
                    <td className="px-2 py-2 font-medium text-foreground">{STAGE_LABELS[sc.stage]}</td>
                    <td className="text-center px-2 py-2">
                      <span className="font-bold">{sc.scoreA}</span>
                      <span className="text-xs text-muted-foreground ml-1">({sc.winsA}w)</span>
                    </td>
                    <td className="text-center px-2 py-2">
                      <span className="font-bold">{sc.scoreB}</span>
                      <span className="text-xs text-muted-foreground ml-1">({sc.winsB}w)</span>
                    </td>
                    <td className="text-center px-2 py-2">
                      <span className={cn(
                        "font-bold",
                        sc.delta > 0 ? "text-emerald-500" : sc.delta < 0 ? "text-red-500" : "text-muted-foreground"
                      )}>
                        {sc.delta > 0 ? "+" : ""}{sc.delta}
                      </span>
                    </td>
                    <td className="text-center px-2 py-2">
                      {sc.delta > 2 ? (
                        <span className="text-blue-400 font-semibold">{getModelShort(M_B)}</span>
                      ) : sc.delta < -2 ? (
                        <span className="text-orange-400 font-semibold">{getModelShort(M_A)}</span>
                      ) : (
                        <span className="text-muted-foreground">~same</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-question delta grid */}
          <div className="space-y-1">
            <h5 className="text-xs font-semibold text-muted-foreground uppercase">Per-Question Score Delta ({getModelShort(M_B)} − {getModelShort(M_A)})</h5>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-1.5 py-1 text-muted-foreground">Stage</th>
                    {questions.map(q => (
                      <th key={q.id} className="text-center px-1.5 py-1 text-muted-foreground" title={q.query}>
                        {q.id.replace(/^[a-z]+\d*_/, "").slice(0, 8)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stageComps.map(sc => (
                    <tr key={sc.stage} className="border-b border-border/20">
                      <td className="px-1.5 py-1 font-medium text-foreground">{STAGE_LABELS[sc.stage]}</td>
                      {sc.perQuestion.map(pq => (
                        <td key={pq.qid} className="text-center px-1.5 py-1">
                          {pq.delta !== null ? (
                            <span className={cn(
                              "font-semibold",
                              pq.delta > 5 ? "text-emerald-500" :
                              pq.delta > 0 ? "text-emerald-400/70" :
                              pq.delta < -5 ? "text-red-500" :
                              pq.delta < 0 ? "text-red-400/70" :
                              "text-muted-foreground"
                            )}>
                              {pq.delta > 0 ? "+" : ""}{pq.delta}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">&mdash;</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Verdict */}
          <div className={cn(
            "rounded-lg border p-3 text-xs",
            overallDelta > 3 ? "border-blue-500/30 bg-blue-500/5" :
            overallDelta < -3 ? "border-orange-500/30 bg-orange-500/5" :
            "border-border bg-muted/20"
          )}>
            <strong>Verdict:</strong>{" "}
            {overallDelta > 3 ? (
              <span>{getModelShort(M_B)} is clearly better overall by +{overallDelta} avg points. Pro wins {proWinsCount}/{totalQuestionsCompared} head-to-head comparisons.</span>
            ) : overallDelta > 0 ? (
              <span>{getModelShort(M_B)} has a marginal edge (+{overallDelta}). The difference is small — {getModelShort(M_A)} could be used for cost savings with minimal quality loss.</span>
            ) : overallDelta === 0 ? (
              <span>Both models perform identically on average. Use {getModelShort(M_A)} for cost savings.</span>
            ) : (
              <span>{getModelShort(M_A)} actually outperforms {getModelShort(M_B)} by {Math.abs(overallDelta)} avg points. No benefit to using Pro here.</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
