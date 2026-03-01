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

const MODELS = ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano"]

const MODEL_SHORT: Record<string, string> = {
  "gpt-5.2": "5.2",
  "gpt-5.2-pro": "5.2-pro",
  "gpt-5-mini": "5-mini",
  "gpt-5-nano": "5-nano",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LLMTournament({
  questions,
}: {
  questions: BenchmarkQuestion[]
}) {
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

  // Timer
  React.useEffect(() => {
    if (status !== "running") return
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(timer)
  }, [status, startTime])

  const total = STAGES.length * questions.length

  // ── Run tournament ──
  const runTournament = async () => {
    setStatus("running")
    setErrorMsg("")
    setBattles({})
    setProgress(0)
    setTotalBattles(total)
    setStartTime(Date.now())
    setElapsed(0)
    setJudgeCost(0)
    abortRef.current = false

    const newCells: Record<string, BattleStatus> = {}
    for (const stage of STAGES) {
      for (const q of questions) {
        newCells[`${stage}|${q.id}`] = "pending"
      }
    }
    setCellStatus({ ...newCells })

    const accumulated: Record<string, BattleResult> = {}
    let done = 0
    let totalJudgeCost = 0

    for (const stage of STAGES) {
      for (const question of questions) {
        if (abortRef.current) {
          setStatus("idle")
          return
        }

        const key = `${stage}|${question.id}`
        newCells[key] = "running"
        setCellStatus({ ...newCells })

        try {
          const result = await runTournamentBattle({
            stage,
            question_id: question.id,
            models: MODELS,
          }) as unknown as BattleResult

          accumulated[key] = result
          newCells[key] = result.error && !result.judge ? "error" : "done"
          if (result.judge) {
            totalJudgeCost += result.judge.judge_cost || 0
          }
        } catch (e) {
          newCells[key] = "error"
          accumulated[key] = {
            stage,
            stage_label: STAGE_LABELS[stage] || stage,
            question_id: question.id,
            question_text: question.query,
            models: MODELS,
            results: {},
            judge: null,
            error: e instanceof Error ? e.message : "Request failed",
          }
        }

        done++
        setProgress(done)
        setBattles({ ...accumulated })
        setCellStatus({ ...newCells })
        setJudgeCost(totalJudgeCost)
      }
    }

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
      for (const model of MODELS) {
        result[stage][model] = { totalScore: 0, wins: 0, battles: 0, avgScore: 0 }
      }

      for (const q of questions) {
        const key = `${stage}|${q.id}`
        const battle = battles[key]
        if (!battle?.judge?.rankings) continue

        for (const r of battle.judge.rankings) {
          if (!result[stage][r.model]) continue
          result[stage][r.model].totalScore += r.score
          result[stage][r.model].battles++
          if (r.rank === 1) result[stage][r.model].wins++
        }
      }

      // Compute averages
      for (const model of MODELS) {
        const s = result[stage][model]
        s.avgScore = s.battles > 0 ? Math.round(s.totalScore / s.battles * 10) / 10 : 0
      }
    }

    return result
  }, [battles, questions])

  // Best model per stage (by average judge score)
  const bestPerStage = React.useMemo(() => {
    const result: Record<string, { model: string; avgScore: number; wins: number }> = {}
    for (const stage of STAGES) {
      const sw = stageWins[stage]
      if (!sw) continue
      let best = { model: "", avgScore: 0, wins: 0 }
      for (const model of MODELS) {
        const s = sw[model]
        if (s.avgScore > best.avgScore || (s.avgScore === best.avgScore && s.wins > best.wins)) {
          best = { model, avgScore: s.avgScore, wins: s.wins }
        }
      }
      if (best.model) result[stage] = best
    }
    return result
  }, [stageWins])

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
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Swords className="h-4 w-4 text-orange-500" />
            Tournament Mode
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {STAGES.length} stages &times; {questions.length} questions = {total} battles.
            Each battle: 4 models compete, GPT-5.2-pro (high reasoning) judges.
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
              {status === "done" ? "Re-run Tournament" : "Start Tournament"}
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
          <div className="flex justify-between text-[10px] text-muted-foreground">
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
            <table className="w-full text-[10px]">
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
                              <span className="text-[8px] text-muted-foreground ml-0.5">
                                {MODEL_SHORT[winner || ""] || "?"}
                              </span>
                            </button>
                          ) : cs === "error" ? (
                            <span className="text-red-500 text-[10px]" title={battle?.error || "Error"}>&#10060;</span>
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
                      {MODELS.map(m => (
                        <th key={m} className="text-center px-2 py-1.5 text-muted-foreground font-medium">{MODEL_SHORT[m]}</th>
                      ))}
                      <th className="text-center px-2 py-1.5 text-muted-foreground font-medium">Winner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STAGES.map(stage => {
                      const sw = stageWins[stage]
                      const best = bestPerStage[stage]
                      const maxScore = Math.max(...MODELS.map(m => sw?.[m]?.avgScore || 0))
                      return (
                        <tr key={stage} className="border-b border-border/50">
                          <td className="px-2 py-2 font-medium text-foreground">{STAGE_LABELS[stage]}</td>
                          {MODELS.map(m => {
                            const s = sw?.[m]
                            if (!s || s.battles === 0) return <td key={m} className="text-center px-2 py-2 text-muted-foreground">&mdash;</td>
                            const isBest = s.avgScore === maxScore && maxScore > 0
                            return (
                              <td key={m} className={cn("text-center px-2 py-2", isBest && "bg-amber-500/10")}>
                                <div className={cn("text-sm font-bold", isBest ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
                                  {s.avgScore}
                                </div>
                                <div className="text-[9px] text-muted-foreground">
                                  {s.wins}/{s.battles} wins
                                </div>
                              </td>
                            )
                          })}
                          <td className="text-center px-2 py-2">
                            {best && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                <Crown className="h-3 w-3" />
                                {MODEL_SHORT[best.model]}
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
                        <span className="text-[9px] text-muted-foreground">
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
                  <table className="w-full text-[10px]">
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
                                      {MODEL_SHORT[winner]}
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
                <div className="text-[10px] text-muted-foreground text-right">
                  Total judge cost: ${judgeCost.toFixed(4)} &bull;
                  Completed: {completedBattles}/{total} &bull;
                  Errors: {errorBattles} &bull;
                  Time: {fmtTime(elapsed)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Idle state */}
      {status === "idle" && Object.keys(battles).length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <Swords className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Tournament not started</p>
          <p className="text-xs text-muted-foreground mt-1">
            Each battle runs 4 models + 1 judge call = ~5 LLM calls per battle.
            Total: ~{total * 5} LLM calls ({total} battles).
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
            <span className="ml-auto text-[9px] font-mono text-muted-foreground">
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
                    "font-bold text-sm min-w-[1.5rem] text-center",
                    r.rank === 1 ? "text-amber-500" : r.rank === 2 ? "text-zinc-400" : "text-zinc-500"
                  )}>
                    #{r.rank}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">{r.model}</span>
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded",
                        r.score >= 90 ? "bg-emerald-500/20 text-emerald-500" :
                        r.score >= 70 ? "bg-blue-500/20 text-blue-500" :
                        r.score >= 50 ? "bg-yellow-500/20 text-yellow-500" :
                        "bg-red-500/20 text-red-500"
                      )}>
                        {r.score}/100
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">{r.reasoning}</p>
                  </div>
                </div>
              ))}
          </div>

          {/* Analysis */}
          {battle.judge.analysis && (
            <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 leading-relaxed">
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
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        {showOutputs ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Model Outputs
      </button>

      {showOutputs && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {Object.entries(battle.results).map(([model, result]) => (
            <div key={model} className={cn(
              "rounded border p-2 text-[10px]",
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
                <pre className="text-[9px] text-muted-foreground bg-muted/30 rounded p-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                  {result.output_text?.slice(0, 2000) || "(empty)"}
                </pre>
              ) : (
                <div className="text-red-400 text-[9px]">{result.error}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
