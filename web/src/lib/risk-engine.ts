/**
 * Risk Engine — types, default configs, and pure calculation helpers.
 *
 * All thresholds are stored in the DB (via /risk-engine-config endpoint)
 * and can be edited from the Admin panel. The defaults below are used
 * only when the backend has no saved config yet.
 */

import type { ActionableItem } from "./types"

// ─── Theme Risk Classification ───────────────────────────────────────────────

export interface ThemeRiskThreshold {
    label: string          // "Low (Satisfactory)" | "Medium (Improvement Needed)" | "High (Weak)"
    min: number            // inclusive
    max: number            // exclusive (except for last band)
    color: string          // tailwind token: "emerald" | "yellow" | "red"
}

export const DEFAULT_THEME_THRESHOLDS: ThemeRiskThreshold[] = [
    { label: "Low (Satisfactory)",          min: 1,  max: 13,  color: "emerald" },
    { label: "Medium (Improvement Needed)", min: 13, max: 28,  color: "yellow" },
    { label: "High (Weak)",                 min: 28, max: 81,  color: "red" },
]

// ─── Parameter 1 weights ─────────────────────────────────────────────────────

export interface ExplicitComplianceWeights {
    low: number
    medium: number
    high: number
}

export const DEFAULT_EXPLICIT_COMPLIANCE_WEIGHTS: ExplicitComplianceWeights = {
    low: 1,
    medium: 1,
    high: 2,
}

// ─── Parameter scoring options (for manual dropdowns) ────────────────────────

export interface ParameterOption {
    label: string
    score: number
}

// Parameter 2: Pending Implementation of Regulatory Circulars
export const DEFAULT_PARAM2_OPTIONS: ParameterOption[] = [
    { label: "More than 30% overdue",  score: 3 },
    { label: "25% – 30%",              score: 2 },
    { label: "20% – 25%",              score: 1.5 },
    { label: "Up to 20%",              score: 1 },
    { label: "Nil overdue",            score: 0 },
]

// Parameter 3: Complaints as Percentage of Total Customers
export const DEFAULT_PARAM3_OPTIONS: ParameterOption[] = [
    { label: "Above 7.6%",     score: 3 },
    { label: "5.1% – 7.5%",    score: 2 },
    { label: "2.6% – 5.0%",    score: 1.5 },
    { label: "Up to 2.5%",     score: 1 },
    { label: "Nil",            score: 0 },
]

// Parameter 4: Observations Related to New Products or Processes
export const DEFAULT_PARAM4_OPTIONS: ParameterOption[] = [
    { label: "More than 3",  score: 3 },
    { label: "3",            score: 2 },
    { label: "2",            score: 1.5 },
    { label: "1",            score: 1 },
    { label: "0",            score: 0 },
]

// Parameter 5: Open Compliance Testing Observations
export const DEFAULT_PARAM5_OPTIONS: ParameterOption[] = [
    { label: "91 or more",  score: 3 },
    { label: "51 – 90",     score: 2 },
    { label: "15 – 50",     score: 1.5 },
    { label: "6 – 14",      score: 1 },
    { label: "0 – 5",       score: 0 },
]

// Parameter 6: Repeat RMP / RAR Observations
export const DEFAULT_PARAM6_OPTIONS: ParameterOption[] = [
    { label: "More than 2",    score: 3 },
    { label: "2",              score: 2 },
    { label: "1",              score: 1.5 },
    { label: "0",              score: 1 },
    { label: "Not Applicable", score: 0 },
]

// Parameter 7: Material Compliance Violations
export const DEFAULT_PARAM7_OPTIONS: ParameterOption[] = [
    { label: "More than 3",  score: 3 },
    { label: "3",            score: 2 },
    { label: "2",            score: 1.5 },
    { label: "1",            score: 1 },
    { label: "0",            score: 0 },
]

// ─── Final Bank-Level Interpretation ─────────────────────────────────────────

export interface FinalInterpretationBand {
    label: string
    min: number   // inclusive
    max: number   // exclusive (except last)
    color: string // tailwind token
}

export const DEFAULT_FINAL_INTERPRETATION: FinalInterpretationBand[] = [
    { label: "Satisfactory",        min: 0,  max: 13, color: "emerald" },
    { label: "Improvement Needed",  min: 13, max: 28, color: "yellow" },
    { label: "High Low",            min: 28, max: 41, color: "orange" },
    { label: "High Medium",         min: 41, max: 56, color: "red" },
    { label: "High Severe",         min: 56, max: Infinity, color: "rose" },
]

// ─── Full engine config (persisted to DB) ────────────────────────────────────

export interface RiskEngineConfig {
    theme_thresholds: ThemeRiskThreshold[]
    explicit_compliance_weights: ExplicitComplianceWeights
    param2_options: ParameterOption[]
    param3_options: ParameterOption[]
    param4_options: ParameterOption[]
    param5_options: ParameterOption[]
    param6_options: ParameterOption[]
    param7_options: ParameterOption[]
    final_interpretation: FinalInterpretationBand[]
    likelihood_owner_team: string  // Bank-level default: which team owns document likelihood
}

export const DEFAULT_RISK_ENGINE_CONFIG: RiskEngineConfig = {
    theme_thresholds: DEFAULT_THEME_THRESHOLDS,
    explicit_compliance_weights: DEFAULT_EXPLICIT_COMPLIANCE_WEIGHTS,
    param2_options: DEFAULT_PARAM2_OPTIONS,
    param3_options: DEFAULT_PARAM3_OPTIONS,
    param4_options: DEFAULT_PARAM4_OPTIONS,
    param5_options: DEFAULT_PARAM5_OPTIONS,
    param6_options: DEFAULT_PARAM6_OPTIONS,
    param7_options: DEFAULT_PARAM7_OPTIONS,
    final_interpretation: DEFAULT_FINAL_INTERPRETATION,
    likelihood_owner_team: "",
}

// ─── Saved parameter selections (persisted per-assessment) ───────────────────

export interface RiskParameterSelections {
    _id?: string
    // Parameter 3–7 are manual dropdown selections (label strings)
    param3_selection?: string
    param4_selection?: string
    param5_selection?: string
    param6_selection?: string
    param7_selection?: string
    updated_at?: string
    updated_by?: string
}

// ─── Computed types ──────────────────────────────────────────────────────────

export interface ThemeWeight {
    theme: string
    weight: number  // default: 1
}

export interface ThemeRiskRow {
    theme: string
    avgResidual: number
    highestResidual: number
    completedCount: number
    riskLevel: string  // label from threshold
    color: string
    weight?: number  // optional: theme-specific weight (CAG officer only)
}

export interface ParameterRow {
    serial: number
    name: string
    form: "Percentage" | "Number" | "Calculated"
    value: string | number
    riskLevel: string
    score: number
}

// ─── Pure calculation functions ──────────────────────────────────────────────

/** Compute residual risk score for a single actionable (client-side recomputation).
 *  If documentLikelihoodScore is provided, it overrides the per-actionable likelihood. */
export function computeResidualScore(item: ActionableItem, documentLikelihoodScore?: number): number | null {
    const safeScore = (d: { score?: number } | null | undefined) =>
        d && typeof d.score === "number" ? d.score : 0

    // Use document-level likelihood override when provided
    let likScore: number;
    if (documentLikelihoodScore != null && documentLikelihoodScore > 0) {
        likScore = documentLikelihoodScore
    } else {
        likScore = Math.max(
            safeScore(item.likelihood_business_volume),
            safeScore(item.likelihood_products_processes),
            safeScore(item.likelihood_compliance_violations),
        )
    }
    const impScore = safeScore(item.impact_dropdown) ** 2
    const monS = safeScore(item.control_monitoring)
    const effS = safeScore(item.control_effectiveness)
    const ctrlScore = monS || effS ? Math.max(monS, effS) : 0
    const inherent = likScore * impScore
    const allFilled = !!(
        item.likelihood_business_volume?.label &&
        item.likelihood_products_processes?.label &&
        item.likelihood_compliance_violations?.label &&
        item.impact_dropdown?.label &&
        item.control_monitoring?.label &&
        item.control_effectiveness?.label
    )
    if (!allFilled) return null
    return inherent * ctrlScore
}

/** Compute residual risk for a multi-team (mixed) actionable.
 *  Combining logic: max likelihood, common impact, max control (worst-case).
 *  Currently risk scores are stored at the actionable level (not per-team),
 *  so this is equivalent to computeResidualScore. If per-team risk scores
 *  are added in the future, this function should aggregate across teams.
 */
export function computeMixedTeamResidualScore(item: ActionableItem): number | null {
    // Multi-team items share the same risk assessment at the actionable level.
    // The combining logic (max likelihood, avg control, common impact) is already
    // baked into computeResidualScore since likelihood = MAX(3 sub-scores),
    // control = AVG(2 sub-scores), and impact is a single shared value.
    return computeResidualScore(item)
}

/** Classify a theme average score using configurable thresholds. */
export function classifyTheme(
    avgScore: number,
    thresholds: ThemeRiskThreshold[],
): { label: string; color: string } {
    // Sort ascending by min
    const sorted = [...thresholds].sort((a, b) => a.min - b.min)
    for (const t of sorted) {
        if (avgScore >= t.min && avgScore < t.max) {
            return { label: t.label, color: t.color }
        }
    }
    // If score >= last band's max, use last band
    const last = sorted[sorted.length - 1]
    if (last && avgScore >= last.min) return { label: last.label, color: last.color }
    return { label: "Unclassified", color: "gray" }
}

/** Build theme risk analysis from completed actionables. */
export function buildThemeAnalysis(
    completedItems: ActionableItem[],
    thresholds: ThemeRiskThreshold[],
): ThemeRiskRow[] {
    // Group by theme
    const groups: Record<string, { scores: number[]; count: number }> = {}
    for (const item of completedItems) {
        const theme = item.theme || "Unassigned"
        if (!groups[theme]) groups[theme] = { scores: [], count: 0 }
        groups[theme].count++
        // Use client-recomputed or stored residual
        const residual = computeResidualScore(item) ?? item.residual_risk_score ?? 0
        groups[theme].scores.push(residual)
    }

    const rows: ThemeRiskRow[] = []
    for (const [theme, data] of Object.entries(groups)) {
        const avg = data.scores.length > 0
            ? data.scores.reduce((s, v) => s + v, 0) / data.scores.length
            : 0
        const highest = data.scores.length > 0 ? Math.max(...data.scores) : 0
        const { label, color } = classifyTheme(avg, thresholds)
        rows.push({
            theme,
            avgResidual: avg,
            highestResidual: highest,
            completedCount: data.count,
            riskLevel: label,
            color,
        })
    }

    // Sort by avgResidual ascending within each risk level
    return rows.sort((a, b) => a.avgResidual - b.avgResidual)
}

/** Compute Parameter 1 — Explicit Compliance Against Regulations (OLD: category-average method). */
export function computeParam1(
    themeRows: ThemeRiskRow[],
    weights: ExplicitComplianceWeights,
): { value: number; score: number } {
    if (themeRows.length === 0) return { value: 0, score: 0 }

    let lowCount = 0, medCount = 0, highCount = 0
    for (const row of themeRows) {
        const l = row.riskLevel.toLowerCase()
        if (l.includes("high") || l.includes("weak")) highCount++
        else if (l.includes("medium") || l.includes("improvement")) medCount++
        else lowCount++
    }

    const weighted = lowCount * weights.low + medCount * weights.medium + highCount * weights.high
    const value = weighted / themeRows.length
    return { value: Math.round(value * 100) / 100, score: Math.round(value * 100) / 100 }
}

/** Apply per-theme weights to theme rows (CAG officer only feature).
 *  If a theme has a custom weight, use it; otherwise default to 1.
 *  This is applied BEFORE category-based weighting in computeParam1Weighted.
 */
export function applyThemeWeights(
    themeRows: ThemeRiskRow[],
    themeWeights: Record<string, number>,
): ThemeRiskRow[] {
    return themeRows.map(row => ({
        ...row,
        weight: themeWeights[row.theme] ?? 1,
    }))
}

/** Compute Parameter 1 — True Weighted Average (NEW: per-theme weighting method).
 *  Applies weights to individual theme scores, not category averages.
 *  Correct formula: SUM(theme_score × weight) / SUM(weight)
 *  
 *  If themeRows have a weight property (from applyThemeWeights), that is used first.
 *  Otherwise, weights are determined by risk category classification.
 */
export function computeParam1Weighted(
    themeRows: ThemeRiskRow[],
    weights: ExplicitComplianceWeights,
): { value: number; score: number } {
    if (themeRows.length === 0) return { value: 0, score: 0 }

    let weightedSum = 0
    let weightedCount = 0

    for (const row of themeRows) {
        // If theme has explicit weight (from CAG officer), use it
        // Otherwise, determine weight based on risk level classification
        let weight: number
        if (row.weight !== undefined) {
            weight = row.weight
        } else {
            const l = row.riskLevel.toLowerCase()
            weight = weights.low // default
            if (l.includes("high") || l.includes("weak")) {
                weight = weights.high
            } else if (l.includes("medium") || l.includes("improvement")) {
                weight = weights.medium
            }
        }

        // Apply weight to the theme's average residual score
        weightedSum += row.avgResidual * weight
        weightedCount += weight
    }

    const value = weightedCount > 0 ? weightedSum / weightedCount : 0
    return { value: Math.round(value * 100) / 100, score: Math.round(value * 100) / 100 }
}

/** Compute Parameter 2 — Pending Implementation of Regulatory Circulars (auto-calculated). */
export function computeParam2(
    activeCount: number,
    totalCount: number,
    options: ParameterOption[],
): { percentage: number; matchedLabel: string; score: number } {
    if (totalCount === 0) return { percentage: 0, matchedLabel: "Nil overdue", score: 0 }
    const pct = (activeCount / totalCount) * 100

    // Match from highest to lowest
    const sorted = [...options].sort((a, b) => b.score - a.score)
    // Nil overdue = 0 active
    if (activeCount === 0) {
        const nilOpt = options.find(o => o.score === 0)
        return { percentage: 0, matchedLabel: nilOpt?.label || "Nil overdue", score: 0 }
    }

    // Try to match the percentage-based options
    if (pct > 30) return { percentage: pct, matchedLabel: sorted[0]?.label || "", score: sorted[0]?.score || 3 }
    if (pct >= 25) return { percentage: pct, matchedLabel: sorted[1]?.label || "", score: sorted[1]?.score || 2 }
    if (pct >= 20) return { percentage: pct, matchedLabel: sorted[2]?.label || "", score: sorted[2]?.score || 1.5 }
    return { percentage: pct, matchedLabel: sorted[3]?.label || "", score: sorted[3]?.score || 1 }
}

/** Resolve a manual dropdown selection to its score. */
export function resolveDropdownScore(
    selection: string | undefined,
    options: ParameterOption[],
): number {
    if (!selection) return 0
    const match = options.find(o => o.label === selection)
    return match?.score ?? 0
}

/** Interpret final bank-level risk score. */
export function interpretFinalScore(
    score: number,
    bands: FinalInterpretationBand[],
): { label: string; color: string } {
    const sorted = [...bands].sort((a, b) => a.min - b.min)
    for (const b of sorted) {
        if (score >= b.min && score < b.max) return { label: b.label, color: b.color }
    }
    const last = sorted[sorted.length - 1]
    if (last && score >= last.min) return { label: last.label, color: last.color }
    return { label: "Unclassified", color: "gray" }
}

// ─── Time filtering ─────────────────────────────────────────────────────────

export type TimeFilterOption = "1y" | "2y" | "3y" | "overall"

export const TIME_FILTER_LABELS: Record<TimeFilterOption, string> = {
    "1y": "Last 1 Year",
    "2y": "Last 2 Years",
    "3y": "Last 3 Years",
    "overall": "Overall (All Time)",
}

export interface TimeBucket {
    label: string
    start: Date
    end: Date
}

/** Build time buckets for a given filter option. */
export function buildTimeBuckets(filter: TimeFilterOption): TimeBucket[] {
    if (filter === "overall") return [] // no bucketing for overall
    const now = new Date()
    const currentYearStart = new Date(now.getFullYear(), 0, 1)
    const buckets: TimeBucket[] = []

    // Bucket 1: Current year
    buckets.push({ label: "Current Year", start: currentYearStart, end: now })

    const years = filter === "1y" ? 1 : filter === "2y" ? 2 : 3
    for (let i = 1; i < years; i++) {
        const start = new Date(now.getFullYear() - i, 0, 1)
        const end = new Date(now.getFullYear() - i + 1, 0, 1)
        buckets.push({ label: `${i} Year${i > 1 ? "s" : ""} Ago`, start, end })
    }
    return buckets
}

/** Get the cutoff date for a time filter. */
export function getTimeCutoff(filter: TimeFilterOption): Date | null {
    if (filter === "overall") return null
    const now = new Date()
    const years = filter === "1y" ? 1 : filter === "2y" ? 2 : 3
    return new Date(now.getFullYear() - years, now.getMonth(), now.getDate())
}

/** Filter tracker items by time. Uses published_at or completion_date. */
export function filterByTime(
    items: ActionableItem[],
    filter: TimeFilterOption,
): ActionableItem[] {
    const cutoff = getTimeCutoff(filter)
    if (!cutoff) return items // overall — no filtering
    const cutoffMs = cutoff.getTime()
    return items.filter(item => {
        // Use published_at as the primary date, fall back to completion_date
        const dateStr = item.published_at || item.completion_date || ""
        if (!dateStr) return false
        return new Date(dateStr).getTime() >= cutoffMs
    })
}

/** Filter to tracker-only items (published to tracker). */
export function getTrackerItems(allItems: ActionableItem[]): ActionableItem[] {
    return allItems.filter(item => !!item.published_at)
}
