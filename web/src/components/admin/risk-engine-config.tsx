"use client"

import React from "react"
import { fetchRiskEngineConfig, updateRiskEngineConfig } from "@/lib/api"
import {
  type RiskEngineConfig,
  type ThemeRiskThreshold,
  type ParameterOption,
  type FinalInterpretationBand,
  type ExplicitComplianceWeights,
  DEFAULT_RISK_ENGINE_CONFIG,
} from "@/lib/risk-engine"
import { cn } from "@/lib/utils"
import { Loader2, Save, RotateCcw, Plus, Trash2 } from "lucide-react"

export function RiskEngineConfigManager() {
  const [config, setConfig] = React.useState<RiskEngineConfig>(DEFAULT_RISK_ENGINE_CONFIG)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState("")
  const [success, setSuccess] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await fetchRiskEngineConfig()
      const merged: RiskEngineConfig = { ...DEFAULT_RISK_ENGINE_CONFIG }
      if (data && typeof data === "object") {
        const cd = data as Record<string, unknown>
        for (const k of Object.keys(merged) as (keyof RiskEngineConfig)[]) {
          if (k in cd && cd[k] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (merged as any)[k] = cd[k]
          }
        }
      }
      setConfig(merged)
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      await updateRiskEngineConfig(config as unknown as Record<string, unknown>)
      setSuccess("Risk engine configuration saved successfully.")
      setTimeout(() => setSuccess(""), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setConfig(DEFAULT_RISK_ENGINE_CONFIG)
    setSuccess("")
    setError("")
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading risk engine config...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Risk Engine Configuration</h3>
          <p className="text-[10px] text-muted-foreground/60">Configure thresholds, weights, parameter options, and final interpretation bands.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 text-[10px] px-2.5 py-1.5 rounded bg-muted/30 hover:bg-muted/50 text-muted-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to Defaults
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 text-[10px] px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Config
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">{error}</p>}
      {success && <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-1.5">{success}</p>}

      {/* ── Theme Risk Thresholds ── */}
      <Section title="Theme Risk Thresholds" subtitle="Classification bands for theme average residual risk scores">
        <ThresholdEditor
          items={config.theme_thresholds}
          onChange={(v) => setConfig(prev => ({ ...prev, theme_thresholds: v }))}
        />
      </Section>

      {/* ── Explicit Compliance Weights ── */}
      <Section title="Parameter 1 — Explicit Compliance Weights" subtitle="Weights for Low / Medium / High theme counts">
        <WeightsEditor
          weights={config.explicit_compliance_weights}
          onChange={(v) => setConfig(prev => ({ ...prev, explicit_compliance_weights: v }))}
        />
      </Section>

      {/* ── Parameter Options (P2–P7) ── */}
      <ParamOptionsSection
        title="Parameter 2 — Pending Implementation"
        options={config.param2_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param2_options: v }))}
      />
      <ParamOptionsSection
        title="Parameter 3 — Complaints % of Customers"
        options={config.param3_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param3_options: v }))}
      />
      <ParamOptionsSection
        title="Parameter 4 — New Products/Processes"
        options={config.param4_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param4_options: v }))}
      />
      <ParamOptionsSection
        title="Parameter 5 — Open Compliance Testing"
        options={config.param5_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param5_options: v }))}
      />
      <ParamOptionsSection
        title="Parameter 6 — Repeat RMP/RAR Observations"
        options={config.param6_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param6_options: v }))}
      />
      <ParamOptionsSection
        title="Parameter 7 — Material Compliance Violations"
        options={config.param7_options}
        onChange={(v) => setConfig(prev => ({ ...prev, param7_options: v }))}
      />

      {/* ── Final Interpretation Bands ── */}
      <Section title="Final Bank-Level Interpretation" subtitle="Score bands for the final risk score interpretation">
        <FinalBandsEditor
          bands={config.final_interpretation}
          onChange={(v) => setConfig(prev => ({ ...prev, final_interpretation: v }))}
        />
      </Section>
    </div>
  )
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/20">
        <p className="text-xs font-semibold text-foreground/80">{title}</p>
        <p className="text-[10px] text-muted-foreground/50">{subtitle}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── Theme Threshold Editor ──────────────────────────────────────────────────

function ThresholdEditor({ items, onChange }: {
  items: ThemeRiskThreshold[]; onChange: (v: ThemeRiskThreshold[]) => void
}) {
  const update = (idx: number, field: keyof ThemeRiskThreshold, val: string | number) => {
    const next = [...items]
    next[idx] = { ...next[idx], [field]: val }
    onChange(next)
  }
  const add = () => {
    onChange([...items, { label: "New Band", min: 0, max: 100, color: "gray" }])
  }
  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_80px_90px_32px] gap-2 text-[10px] font-semibold text-muted-foreground/50 uppercase">
        <span>Label</span><span>Min</span><span>Max</span><span>Color</span><span />
      </div>
      {items.map((item, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_80px_80px_90px_32px] gap-2 items-center">
          <input
            value={item.label}
            onChange={e => update(idx, "label", e.target.value)}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80"
          />
          <input
            type="number"
            value={item.min}
            onChange={e => update(idx, "min", Number(e.target.value))}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80 font-mono"
          />
          <input
            type="number"
            value={item.max}
            onChange={e => update(idx, "max", Number(e.target.value))}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80 font-mono"
          />
          <select
            value={item.color}
            onChange={e => update(idx, "color", e.target.value)}
            className="text-xs bg-background border border-border/30 rounded px-1.5 py-1 text-foreground/80"
          >
            {["emerald", "yellow", "orange", "red", "rose", "gray"].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-300 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors mt-1">
        <Plus className="h-3 w-3" /> Add band
      </button>
    </div>
  )
}

// ─── Weights Editor ──────────────────────────────────────────────────────────

function WeightsEditor({ weights, onChange }: {
  weights: ExplicitComplianceWeights; onChange: (v: ExplicitComplianceWeights) => void
}) {
  return (
    <div className="flex gap-4">
      {(["low", "medium", "high"] as const).map(key => (
        <div key={key} className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground/60 uppercase font-semibold">{key}</label>
          <input
            type="number"
            step="0.1"
            value={weights[key]}
            onChange={e => onChange({ ...weights, [key]: Number(e.target.value) })}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80 font-mono w-20"
          />
        </div>
      ))}
    </div>
  )
}

// ─── Parameter Options Section ───────────────────────────────────────────────

function ParamOptionsSection({ title, options, onChange }: {
  title: string; options: ParameterOption[]; onChange: (v: ParameterOption[]) => void
}) {
  const update = (idx: number, field: keyof ParameterOption, val: string | number) => {
    const next = [...options]
    next[idx] = { ...next[idx], [field]: val }
    onChange(next)
  }
  const add = () => {
    onChange([...options, { label: "New Option", score: 0 }])
  }
  const remove = (idx: number) => {
    onChange(options.filter((_, i) => i !== idx))
  }

  return (
    <Section title={title} subtitle="Dropdown options and their scores">
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_80px_32px] gap-2 text-[10px] font-semibold text-muted-foreground/50 uppercase">
          <span>Label</span><span>Score</span><span />
        </div>
        {options.map((opt, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_80px_32px] gap-2 items-center">
            <input
              value={opt.label}
              onChange={e => update(idx, "label", e.target.value)}
              className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80"
            />
            <input
              type="number"
              step="0.5"
              value={opt.score}
              onChange={e => update(idx, "score", Number(e.target.value))}
              className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80 font-mono"
            />
            <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-300 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button onClick={add} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors mt-1">
          <Plus className="h-3 w-3" /> Add option
        </button>
      </div>
    </Section>
  )
}

// ─── Final Interpretation Bands Editor ───────────────────────────────────────

function FinalBandsEditor({ bands, onChange }: {
  bands: FinalInterpretationBand[]; onChange: (v: FinalInterpretationBand[]) => void
}) {
  const update = (idx: number, field: keyof FinalInterpretationBand, val: string | number) => {
    const next = [...bands]
    next[idx] = { ...next[idx], [field]: val }
    onChange(next)
  }
  const add = () => {
    onChange([...bands, { label: "New Band", min: 0, max: 100, color: "gray" }])
  }
  const remove = (idx: number) => {
    onChange(bands.filter((_, i) => i !== idx))
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_80px_80px_90px_32px] gap-2 text-[10px] font-semibold text-muted-foreground/50 uppercase">
        <span>Label</span><span>Min</span><span>Max</span><span>Color</span><span />
      </div>
      {bands.map((band, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_80px_80px_90px_32px] gap-2 items-center">
          <input
            value={band.label}
            onChange={e => update(idx, "label", e.target.value)}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80"
          />
          <input
            type="number"
            value={band.min}
            onChange={e => update(idx, "min", Number(e.target.value))}
            className="text-xs bg-background border border-border/30 rounded px-2 py-1 text-foreground/80 font-mono"
          />
          <input
            type="number"
            value={band.max === Infinity ? 9999 : band.max}
            onChange={e => update(idx, "max", Number(e.target.value))}
            className={cn("text-xs bg-background border border-border/30 rounded px-2 py-1 font-mono", band.max === Infinity ? "text-muted-foreground/40" : "text-foreground/80")}
          />
          <select
            value={band.color}
            onChange={e => update(idx, "color", e.target.value)}
            className="text-xs bg-background border border-border/30 rounded px-1.5 py-1 text-foreground/80"
          >
            {["emerald", "yellow", "orange", "red", "rose", "gray"].map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button onClick={() => remove(idx)} className="text-red-400 hover:text-red-300 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={add} className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors mt-1">
        <Plus className="h-3 w-3" /> Add band
      </button>
    </div>
  )
}
