"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    AlertTriangle,
    FileText,
    Loader2,
    Printer,
    RefreshCw,
    Shield,
    Users as UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getIntelDashboard } from "@/lib/intelligence-api";
import type { IntelDashboardPayload } from "@/lib/intelligence-types";
import { cn } from "@/lib/utils";

const RISK_COLORS: Record<string, string> = {
    "1": "bg-emerald-500",
    "2": "bg-yellow-500",
    "3": "bg-amber-500",
    "4": "bg-red-500",
    "5": "bg-red-600",
};

function exportDashboardReport(data: IntelDashboardPayload) {
    const s = data.summary;
    const now = new Date().toLocaleString();
    const priorityRows = Object.entries(s.priority_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("");
    const categoryRows = Object.entries(s.category_counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("");
    const riskRows = Object.entries(s.risk_counts)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([k, v]) => `<tr><td>Risk ${k}</td><td>${v}</td></tr>`)
        .join("");
    const teamRows = Object.entries(s.team_workload)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("");
    const docRows = data.per_document
        .map((d) => `<tr><td>${d.doc_name}</td><td>${d.stats.total}</td><td>${d.stats.high_priority}</td><td>${d.stats.unassigned}</td><td>${d.stats.upcoming_deadlines}</td><td>${d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "—"}</td></tr>`)
        .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Intelligence Dashboard Report</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 13px; color: #111; margin: 32px; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
    .meta { font-size: 11px; color: #666; margin-bottom: 24px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; }
    .kpi { border: 1px solid #ddd; border-radius: 6px; padding: 12px; }
    .kpi-label { font-size: 10px; text-transform: uppercase; color: #888; }
    .kpi-value { font-size: 26px; font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }
    th { background: #f3f3f3; text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
    td { padding: 5px 8px; border: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>Intelligence Dashboard Report</h1>
  <div class="meta">Generated: ${now} &nbsp;|&nbsp; Documents: ${s.documents} &nbsp;|&nbsp; Teams configured: ${data.team_roster_size}</div>

  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-label">Total Actionables</div><div class="kpi-value">${s.total_actionables}</div></div>
    <div class="kpi"><div class="kpi-label">Unassigned</div><div class="kpi-value" style="color:#d97706">${s.unassigned}</div></div>
    <div class="kpi"><div class="kpi-label">High Priority</div><div class="kpi-value" style="color:#dc2626">${s.priority_counts["High"] || 0}</div></div>
    <div class="kpi"><div class="kpi-label">Documents</div><div class="kpi-value">${s.documents}</div></div>
  </div>

  <h2>Priority Breakdown</h2>
  <table><thead><tr><th>Priority</th><th>Count</th></tr></thead><tbody>${priorityRows}</tbody></table>

  <h2>Category Breakdown</h2>
  <table><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${categoryRows}</tbody></table>

  <h2>Risk Distribution</h2>
  <table><thead><tr><th>Level</th><th>Count</th></tr></thead><tbody>${riskRows}</tbody></table>

  <h2>Team Workload</h2>
  <table><thead><tr><th>Team</th><th>Assigned Actionables</th></tr></thead><tbody>${teamRows}</tbody></table>

  <h2>Per-Document Breakdown</h2>
  <table><thead><tr><th>Document</th><th>Total</th><th>High</th><th>Unassigned</th><th>Upcoming Deadlines</th><th>Last Updated</th></tr></thead><tbody>${docRows}</tbody></table>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
}

export default function IntelligenceDashboardPage() {
    const [data, setData] = useState<IntelDashboardPayload | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            setData(await getIntelDashboard());
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to load dashboard");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    if (loading || !data) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const s = data.summary;
    const maxWorkload = Math.max(1, ...Object.values(s.team_workload));
    const maxRisk = Math.max(1, ...Object.values(s.risk_counts));

    return (
        <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">Cross-Document Dashboard</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Aggregates enriched actionables across every document with an intelligence
                        run.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportDashboardReport(data)}>
                        <Printer className="h-3.5 w-3.5" /> Export Report
                    </Button>
                    <Button size="sm" variant="outline" onClick={refresh}>
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Documents" value={s.documents} icon={<FileText className="h-4 w-4" />} />
                <StatCard label="Actionables" value={s.total_actionables} icon={<Shield className="h-4 w-4" />} />
                <StatCard
                    label="Unassigned"
                    value={s.unassigned}
                    tint="text-amber-600"
                    icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
                />
                <StatCard
                    label="Teams"
                    value={data.team_roster_size}
                    icon={<UsersIcon className="h-4 w-4" />}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Priority breakdown */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Priority breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {(["High", "Medium", "Low"] as const).map((p) => {
                            const v = s.priority_counts[p] || 0;
                            const pct = s.total_actionables ? (v / s.total_actionables) * 100 : 0;
                            return (
                                <div key={p}>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span
                                            className={cn(
                                                "font-medium",
                                                p === "High"
                                                    ? "text-red-600"
                                                    : p === "Medium"
                                                        ? "text-amber-600"
                                                        : "text-emerald-600",
                                            )}
                                        >
                                            {p}
                                        </span>
                                        <span className="text-muted-foreground">{v}</span>
                                    </div>
                                    <div className="h-1.5 rounded bg-muted overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full",
                                                p === "High"
                                                    ? "bg-red-500"
                                                    : p === "Medium"
                                                        ? "bg-amber-500"
                                                        : "bg-emerald-500",
                                            )}
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </CardContent>
                </Card>

                {/* Risk heatmap */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Risk distribution (1–5)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-5 gap-1">
                            {["1", "2", "3", "4", "5"].map((k) => {
                                const v = s.risk_counts[k] || 0;
                                const intensity = Math.max(0.15, v / maxRisk);
                                return (
                                    <div key={k} className="text-center">
                                        <div
                                            className={cn(
                                                "h-16 rounded flex items-end justify-center text-[11px] font-semibold text-white",
                                                RISK_COLORS[k],
                                            )}
                                            style={{ opacity: intensity }}
                                        >
                                            <span className="pb-1">{v}</span>
                                        </div>
                                        <div className="mt-1 text-[10px] text-muted-foreground">
                                            Risk {k}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                {/* Category breakdown */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">By category</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {Object.entries(s.category_counts).length === 0 ? (
                            <p className="text-xs text-muted-foreground">No data yet.</p>
                        ) : (
                            Object.entries(s.category_counts)
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => {
                                    const pct = s.total_actionables ? (v / s.total_actionables) * 100 : 0;
                                    return (
                                        <div key={k}>
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span>{k}</span>
                                                <span className="text-muted-foreground">
                                                    {v} ({pct.toFixed(0)}%)
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded bg-muted overflow-hidden">
                                                <div
                                                    className="h-full bg-primary"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                        )}
                    </CardContent>
                </Card>

                {/* Team workload */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Team workload</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {Object.entries(s.team_workload).length === 0 ? (
                            <p className="text-xs text-muted-foreground">No assignments yet.</p>
                        ) : (
                            Object.entries(s.team_workload)
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => {
                                    const pct = (v / maxWorkload) * 100;
                                    return (
                                        <div key={k}>
                                            <div className="flex items-center justify-between text-[11px]">
                                                <span>{k}</span>
                                                <span className="text-muted-foreground">{v}</span>
                                            </div>
                                            <div className="h-1.5 rounded bg-muted overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500"
                                                    style={{ width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Per-document table */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Per-document breakdown</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid grid-cols-[1fr_90px_90px_90px_110px_110px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border">
                        <div>Document</div>
                        <div className="text-right">Total</div>
                        <div className="text-right">High</div>
                        <div className="text-right">Unassigned</div>
                        <div className="text-right">Upcoming</div>
                        <div className="text-right">Updated</div>
                    </div>
                    {data.per_document.length === 0 ? (
                        <div className="p-8 text-center text-xs text-muted-foreground">
                            Run intelligence extraction on at least one document to populate this
                            dashboard.
                        </div>
                    ) : (
                        data.per_document.map((d) => (
                            <Link
                                key={d.doc_id}
                                href={`/intelligence/workspace/${encodeURIComponent(d.doc_id)}`}
                                className="grid grid-cols-[1fr_90px_90px_90px_110px_110px] gap-2 px-4 py-2 text-xs border-b border-border last:border-0 hover:bg-muted/20"
                            >
                                <div className="truncate font-medium">{d.doc_name}</div>
                                <div className="text-right tabular-nums">{d.stats.total}</div>
                                <div className="text-right tabular-nums text-red-600">
                                    {d.stats.high_priority}
                                </div>
                                <div className="text-right tabular-nums text-amber-600">
                                    {d.stats.unassigned}
                                </div>
                                <div className="text-right tabular-nums">
                                    {d.stats.upcoming_deadlines}
                                </div>
                                <div className="text-right text-muted-foreground text-[10px]">
                                    {d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "—"}
                                </div>
                            </Link>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function StatCard({
    label,
    value,
    icon,
    tint,
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    tint?: string;
}) {
    return (
        <Card>
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                        {label}
                    </span>
                    {icon}
                </div>
                <div className={cn("text-2xl font-semibold mt-2 tabular-nums", tint)}>{value}</div>
            </CardContent>
        </Card>
    );
}
