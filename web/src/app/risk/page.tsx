"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { ShieldAlert, TrendingUp, BarChart3, Shield, AlertTriangle } from "lucide-react"
import { fetchActionables, fetchRiskMatrix, type RiskMatrixEntry } from "@/lib/api"
import type { ActionableItem } from "@/lib/types"
import { cn } from "@/lib/utils"

function getRiskColor(label: string) {
  const l = (label || "").toLowerCase()
  if (l === "high") return "text-red-400 bg-red-500/10 border-red-500/30"
  if (l === "medium") return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30"
  if (l === "low") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
  return "text-muted-foreground bg-muted/20 border-border/30"
}

export default function RiskPage() {
  const [items, setItems] = React.useState<ActionableItem[]>([])
  const [matrix, setMatrix] = React.useState<RiskMatrixEntry[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function load() {
      try {
        const [actionablesData, matrixData] = await Promise.all([
          fetchActionables(),
          fetchRiskMatrix(),
        ])
        // Flatten all actionables from all documents
        const allItems: ActionableItem[] = []
        if (Array.isArray(actionablesData)) {
          for (const doc of actionablesData) {
            if (doc.actionables) allItems.push(...doc.actionables)
          }
        }
        setItems(allItems)
        setMatrix(matrixData)
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Compute distribution stats
  const scored = items.filter(i => i.residual_risk_label)
  const highCount = scored.filter(i => i.residual_risk_label === "High").length
  const medCount = scored.filter(i => i.residual_risk_label === "Medium").length
  const lowCount = scored.filter(i => i.residual_risk_label === "Low").length
  const unscored = items.length - scored.length

  const avgResidual = scored.length > 0
    ? scored.reduce((s, i) => s + (i.residual_risk_score || 0), 0) / scored.length
    : 0
  const avgInherent = scored.length > 0
    ? scored.reduce((s, i) => s + (i.inherent_risk_score || 0), 0) / scored.length
    : 0

  return (
    <RoleRedirect>
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Header */}
          <div className="h-11 border-b border-border flex items-center px-5 shrink-0 bg-background">
            <h1 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Risk Overview
            </h1>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {loading ? (
              <p className="text-sm text-muted-foreground animate-pulse">Loading risk data...</p>
            ) : (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  <StatCard icon={<BarChart3 className="h-4 w-4" />} iconClass="text-blue-400" label="Total Actionables" value={items.length} />
                  <StatCard icon={<Shield className="h-4 w-4" />} iconClass="text-emerald-400" label="Scored" value={scored.length} />
                  <StatCard icon={<AlertTriangle className="h-4 w-4" />} iconClass="text-red-400" label="High Risk" value={highCount} />
                  <StatCard icon={<TrendingUp className="h-4 w-4" />} iconClass="text-yellow-400" label="Medium Risk" value={medCount} />
                  <StatCard icon={<Shield className="h-4 w-4" />} iconClass="text-emerald-400" label="Low Risk" value={lowCount} />
                  <StatCard icon={<BarChart3 className="h-4 w-4" />} iconClass="text-muted-foreground" label="Unscored" value={unscored} />
                </div>

                {/* Averages */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                    <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">Avg Inherent Risk Score</p>
                    <p className="text-2xl font-mono font-bold text-foreground">{avgInherent.toFixed(1)}</p>
                  </div>
                  <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                    <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">Avg Residual Risk Score</p>
                    <p className="text-2xl font-mono font-bold text-foreground">{avgResidual.toFixed(1)}</p>
                  </div>
                </div>

                {/* Risk Distribution Bar */}
                {scored.length > 0 && (
                  <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                    <p className="text-xs font-semibold text-foreground/70 mb-3">Residual Risk Distribution</p>
                    <div className="flex h-6 rounded-full overflow-hidden border border-border/20">
                      {highCount > 0 && (
                        <div className="bg-red-500/70 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${(highCount / scored.length) * 100}%` }}>
                          {highCount}
                        </div>
                      )}
                      {medCount > 0 && (
                        <div className="bg-yellow-500/70 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${(medCount / scored.length) * 100}%` }}>
                          {medCount}
                        </div>
                      )}
                      {lowCount > 0 && (
                        <div className="bg-emerald-500/70 flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${(lowCount / scored.length) * 100}%` }}>
                          {lowCount}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                      <span>High ({((highCount / scored.length) * 100).toFixed(0)}%)</span>
                      <span>Medium ({((medCount / scored.length) * 100).toFixed(0)}%)</span>
                      <span>Low ({((lowCount / scored.length) * 100).toFixed(0)}%)</span>
                    </div>
                  </div>
                )}

                {/* Interpretation Matrix */}
                <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                  <p className="text-xs font-semibold text-foreground/70 mb-3">Residual Risk Interpretation Matrix</p>
                  {matrix.length > 0 ? (
                    <div className="space-y-1.5">
                      {matrix.map(entry => (
                        <div key={entry.id} className="flex items-center gap-3">
                          <span className={cn("text-xs font-semibold rounded px-2 py-0.5 border min-w-[70px] text-center", getRiskColor(entry.label))}>
                            {entry.label}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {entry.min_score} — {entry.max_score}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No matrix entries configured. Configure in Admin &rarr; Risk Matrix.</p>
                  )}
                </div>

                {/* High-risk actionables table */}
                {highCount > 0 && (
                  <div className="rounded-lg border border-border/30 p-4 bg-muted/5">
                    <p className="text-xs font-semibold text-foreground/70 mb-3">High Risk Actionables ({highCount})</p>
                    <div className="space-y-2">
                      {scored
                        .filter(i => i.residual_risk_label === "High")
                        .slice(0, 20)
                        .map(item => (
                          <div key={item.id} className="flex items-start gap-3 text-xs border-b border-border/10 pb-2">
                            <span className="font-mono text-muted-foreground/50 shrink-0">{item.actionable_id || item.id.slice(0, 8)}</span>
                            <span className="flex-1 text-foreground/80 line-clamp-1">{item.action}</span>
                            <span className="font-mono text-red-400 shrink-0">{(item.residual_risk_score || 0).toFixed(1)}</span>
                          </div>
                        ))}
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

function StatCard({ icon, iconClass, label, value }: { icon: React.ReactNode; iconClass: string; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/30 p-3 bg-muted/5">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={iconClass}>{icon}</span>
        <span className="text-[10px] font-medium text-muted-foreground/60">{label}</span>
      </div>
      <p className="text-lg font-bold font-mono text-foreground">{value}</p>
    </div>
  )
}
