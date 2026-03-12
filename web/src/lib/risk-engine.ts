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

export interface ThemeRiskRow {
    theme: string
    avgResidual: number
    highestResidual: number
    completedCount: number
    riskLevel: string  // label from threshold
    color: string
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

/** Compute residual risk score for a single actionable (client-side recomputation). */
export function computeResidualScore(item: ActionableItem): number | null {
    const safeScore = (d: { score?: number } | null | undefined) =>
        d && typeof d.score === "number" ? d.score : 0

    const likScore = Math.max(
        safeScore(item.likelihood_business_volume),
        safeScore(item.likelihood_products_processes),
        safeScore(item.likelihood_compliance_violations),
    )
    const impScore = safeScore(item.impact_dropdown) ** 2
    const monS = safeScore(item.control_monitoring)
    const effS = safeScore(item.control_effectiveness)
    const ctrlScore = monS || effS ? (monS + effS) / 2 : 0
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

/** Compute Parameter 1 — Explicit Compliance Against Regulations. */
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
