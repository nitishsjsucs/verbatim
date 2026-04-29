"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { use } from "react";
import { toast } from "sonner";
import {
    AlertTriangle,
    ArrowLeft,
    CalendarClock,
    ChevronDown,
    Download,
    FileDown,
    Info,
    Loader2,
    RefreshCw,
    Shield,
    Upload,
    Users as UsersIcon,
    Zap,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { ImportCsvModal } from "@/components/intelligence/import-csv-modal";
import {
    PipelineActionDialog,
    usePipelineAction,
} from "@/components/intelligence/pipeline-action-dialog";
import { PdfViewerPanel } from "@/components/intelligence/pdf-viewer-panel";
import { TeamAssignmentDialog } from "@/components/intelligence/team-assignment-dialog";
import {
    API_BASE_URL,
} from "@/lib/api";
import {
    buildCsv,
    extractIntelligence,
    getIntelRun,
    importIntelActionables,
    patchIntelActionable,
    triggerCsvDownload,
} from "@/lib/intelligence-api";
import type {
    EnrichedActionable,
    ImportMode,
    ImportResult,
    IntelPriority,
    IntelRunPayload,
} from "@/lib/intelligence-types";
import { cn } from "@/lib/utils";

type GroupMode = "flat" | "category" | "department" | "timeline";

const PRIORITIES: IntelPriority[] = ["High", "Medium", "Low"];

const PRIORITY_STYLES: Record<IntelPriority, string> = {
    High: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
    Medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
    Low: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
};

const RISK_STAR_COLOR = (score: number) => {
    if (score >= 4) return "text-red-500";
    if (score >= 2) return "text-yellow-500";
    return "text-green-500";
};

const CSV_FIELDS: Array<{ key: string; label: string }> = [
    { key: "id", label: "id" },
    { key: "description", label: "description" },
    { key: "source", label: "source" },
    { key: "priority", label: "priority" },
    { key: "category", label: "category" },
    { key: "risk_score", label: "risk_score" },
    { key: "deadline", label: "deadline" },
    { key: "deadline_phrase", label: "deadline_phrase" },
    { key: "timeline_bucket", label: "timeline_bucket" },
    { key: "assigned_team_names", label: "assigned_team_names" },
    { key: "team_specific_tasks", label: "team_specific_tasks" },
    { key: "notes", label: "notes" },
];

function csvEscapeLocal(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function serializeCsvField(a: EnrichedActionable, key: string): unknown {
    if (key === "team_specific_tasks") {
        const tasks = a.team_specific_tasks || [];
        return tasks.map((t) => `${t.team_name}: ${t.team_specific_task}`).join("; ");
    }
    return (a as unknown as Record<string, unknown>)[key];
}

function downloadCsv(actionables: EnrichedActionable[], docName: string) {
    const header = CSV_FIELDS.map((f) => csvEscapeLocal(f.label)).join(",");
    const rows = actionables.map((a) =>
        CSV_FIELDS.map((f) => csvEscapeLocal(serializeCsvField(a, f.key))).join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const safeName = (docName || "document").replace(/[^a-z0-9-_]+/gi, "_").slice(0, 60);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}_actionables_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function downloadActionablesTemplate() {
    const headers = ["id", "description", "priority", "deadline", "risk_score", "category", "team_specific_tasks", "notes"];
    const example = [
        ["ACT-XXXXXXXXXX", "Implement revised KYC checks for all new accounts", "High", "2025-06-30", "4", "Compliance & Regulatory Implementation", "Compliance: Verify KYC norms; Operations: Update branch processes", ""],
    ];
    const csv = buildCsv(headers, example);
    triggerCsvDownload(csv, "actionables_import_template.csv");
}

export default function IntelligenceDocPage({
    params,
}: {
    params: Promise<{ docId: string }>;
}) {
    const { docId } = use(params);
    const decodedId = decodeURIComponent(docId);

    const [run, setRun] = useState<IntelRunPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [noRun, setNoRun] = useState(false);
    const [busy, setBusy] = useState(false);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [editTeams, setEditTeams] = useState(false);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);

    // Pipeline dialogs (custom blocking pop-ups for ALL ML/AI pipeline calls)
    const extractDialog = usePipelineAction({
        title: "Run extraction pipeline?",
        description:
            "This will run the AI/ML enrichment + assignment pipeline on this document. The dialog will stay open with a progress indicator and cannot be dismissed while the pipeline is running.",
        confirmLabel: "Run pipeline",
        stages: [
            "Loading document tree",
            "Extracting raw actionables",
            "Enriching priority · deadline · risk · category",
            "Assigning teams + generating team-specific tasks",
            "Persisting intelligence run",
        ],
    });
    const reExtractDialog = usePipelineAction({
        title: "Re-run extraction pipeline?",
        description:
            "This will OVERWRITE the existing intelligence run. The dialog will stay open with a progress indicator and cannot be dismissed while the pipeline is running.",
        confirmLabel: "Overwrite & re-run",
        stages: [
            "Loading document tree",
            "Extracting raw actionables",
            "Enriching priority · deadline · risk · category",
            "Assigning teams + generating team-specific tasks",
            "Persisting intelligence run",
        ],
    });

    // filters
    const [search, setSearch] = useState("");
    const [priorityFilter, setPriorityFilter] = useState<string>("");
    const [categoryFilter, setCategoryFilter] = useState<string>("");
    const [teamFilter, setTeamFilter] = useState<string>("");
    const [deadlineFilter, setDeadlineFilter] = useState<string>("");
    const [groupMode, setGroupMode] = useState<GroupMode>("flat");

    const load = useCallback(async () => {
        setLoading(true);
        setNoRun(false);
        try {
            const payload = await getIntelRun(decodedId);
            setRun(payload);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (msg.toLowerCase().includes("no intelligence run")) {
                // Page renders normally with an empty-state CTA instead of blocking on a confirm dialog.
                setNoRun(true);
            } else {
                toast.error(msg || "Failed to load");
            }
        } finally {
            setLoading(false);
        }
    }, [decodedId]);

    const triggerInitialExtract = useCallback(async () => {
        const result = await extractDialog.request(
            () => extractIntelligence(decodedId),
            { successMessage: (r) => `Extracted ${r.actionables.length} actionable(s).` },
        );
        if (result) {
            setRun(result);
            setNoRun(false);
            toast.success(`Extracted ${result.actionables.length} actionables`);
        }
    }, [decodedId, extractDialog]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleImport = async (file: File, mode: ImportMode): Promise<ImportResult> => {
        const result = await importIntelActionables(decodedId, file, mode);
        // Reload run to reflect changes
        const payload = await getIntelRun(decodedId);
        setRun(payload);
        return result;
    };

    const reExtract = async () => {
        setBusy(true);
        const result = await reExtractDialog.request(
            () => extractIntelligence(decodedId, true),
            { successMessage: (r) => `Re-extracted ${r.actionables.length} actionable(s).` },
        );
        setBusy(false);
        if (result) {
            setRun(result);
            setNoRun(false);
            toast.success("Re-extracted");
        }
    };

    /**
     * Open the original PDF in a new tab, jumping to the page parsed from the
     * source location string (e.g. "Section 5.2, pp.12-13" or "p.7").
     */
    const openSourcePdf = useCallback((source: string | undefined) => {
        const m = (source || "").match(/p\.?\s*(\d+)/i);
        const page = m ? Math.max(1, parseInt(m[1], 10)) : 1;
        const url = `${API_BASE_URL}/documents/${encodeURIComponent(decodedId)}/raw#page=${page}`;
        setPdfUrl(url);
    }, [decodedId]);

    const patchItem = async (itemId: string, patch: Partial<EnrichedActionable>) => {
        if (!run) return;
        try {
            const updated = await patchIntelActionable(decodedId, itemId, patch);
            setRun({
                ...run,
                actionables: run.actionables.map((a) => (a.id === itemId ? { ...a, ...updated } : a)),
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed");
        }
    };

    const filtered = useMemo(() => {
        if (!run) return [];
        return run.actionables.filter((a) => {
            if (priorityFilter && a.priority !== priorityFilter) return false;
            if (categoryFilter && a.category !== categoryFilter) return false;
            if (teamFilter) {
                if (teamFilter === "__unassigned__") {
                    if (a.assigned_teams.length > 0) return false;
                } else if (!a.assigned_teams.includes(teamFilter)) return false;
            }
            if (deadlineFilter && a.timeline_bucket !== deadlineFilter) return false;
            if (search && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
            return true;
        });
    }, [run, search, priorityFilter, categoryFilter, teamFilter, deadlineFilter]);

    const grouped = useMemo(() => {
        const out = new Map<string, EnrichedActionable[]>();
        if (groupMode === "flat") {
            out.set("All", filtered);
            return out;
        }
        const key = (a: EnrichedActionable) => {
            if (groupMode === "category") return a.category || "Uncategorized";
            if (groupMode === "timeline") return a.timeline_bucket;
            // department
            if (a.assigned_team_names.length === 0) return "Unassigned";
            return a.assigned_team_names.join(", ");
        };
        for (const a of filtered) {
            const k = key(a);
            if (!out.has(k)) out.set(k, []);
            out.get(k)!.push(a);
        }
        return out;
    }, [filtered, groupMode]);

    if (loading) {
        return (
            <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
                <Link
                    href="/intelligence"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-3 w-3" /> Workspace
                </Link>
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-xs text-muted-foreground">Loading actionables…</span>
                </div>
            </div>
        );
    }

    if (!run || noRun) {
        // Empty-state: page renders fully so the user is never stuck on a blank screen.
        // The extract action triggers our custom blocking dialog.
        return (
            <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
                <PipelineActionDialog {...extractDialog} />
                <PdfViewerPanel url={pdfUrl} onClose={() => setPdfUrl(null)} />
                <Link
                    href="/intelligence"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-3 w-3" /> Workspace
                </Link>
                <Card>
                    <CardContent className="p-10 flex flex-col items-center text-center gap-4">
                        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                            <Zap className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold">No actionables yet</h2>
                            <p className="text-xs text-muted-foreground mt-1 max-w-md">
                                This document has been ingested but the AI extraction pipeline has not been run.
                                Click below to extract actionables, assign teams, and generate team-specific tasks.
                            </p>
                        </div>
                        <Button onClick={triggerInitialExtract}>
                            <Zap className="h-3.5 w-3.5" /> Run extraction pipeline
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Category options come from the user-defined roster; "Uncategorized" is
    // always available as a fallback even when no categories are configured.
    const categoryOptions = (() => {
        const names = new Set<string>(run.categories.map((c) => c.name));
        for (const a of run.actionables) if (a.category) names.add(a.category);
        names.add("Uncategorized");
        return Array.from(names).sort();
    })();
    const teamOptions = run.team_snapshot;

    return (
        <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
            {/* Custom blocking pipeline dialogs */}
            <PipelineActionDialog {...extractDialog} />
            <PipelineActionDialog {...reExtractDialog} />
            <PdfViewerPanel url={pdfUrl} onClose={() => setPdfUrl(null)} />
            <ImportCsvModal
                section="Actionables"
                open={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onImport={handleImport}
                onDownloadTemplate={downloadActionablesTemplate}
                disableAddOnly
            />
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <Link
                        href="/intelligence"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-3 w-3" /> Workspace
                    </Link>
                    <h1 className="text-lg font-semibold mt-1 truncate" title={run.doc_name}>
                        {run.doc_name}
                    </h1>
                    <p className="text-[11px] text-muted-foreground">
                        Updated {new Date(run.updated_at).toLocaleString()}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={downloadActionablesTemplate}
                        title="Download the CSV template for bulk import"
                    >
                        <FileDown className="h-3.5 w-3.5" /> Template
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setImportModalOpen(true)}
                        title="Import a CSV to bulk-update actionables"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        Import CSV
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadCsv(filtered, run.doc_name)}
                        disabled={filtered.length === 0}
                        title="Export the current (filtered) actionables as CSV"
                    >
                        <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                    <Button
                        size="sm"
                        variant={editTeams ? "default" : "outline"}
                        onClick={() => setEditTeams((v) => !v)}
                        title="Manually edit team assignments per actionable. This does NOT trigger AI."
                    >
                        <UsersIcon className="h-3.5 w-3.5" />
                        {editTeams ? "Done editing teams" : "Reassign teams"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={reExtract} disabled={busy}>
                        {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Zap className="h-3.5 w-3.5" />
                        )}
                        Re-extract
                    </Button>
                </div>
            </div>

            {editTeams && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Manual edit mode: click the team cell on any actionable to add/remove teams via
                    multi-select. No AI/ML processing is triggered by this action.
                </div>
            )}

            {/* Insights */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InsightCard label="Total Actionables" value={run.stats.total} icon={<Shield className="h-4 w-4" />} />
                <InsightCard
                    label="High Priority"
                    value={run.stats.high_priority}
                    tint="text-red-600"
                    icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
                />
                <InsightCard
                    label="Unassigned"
                    value={run.stats.unassigned}
                    tint="text-amber-600"
                    icon={<UsersIcon className="h-4 w-4 text-amber-600" />}
                />
                <InsightCard
                    label="With Deadlines"
                    value={run.stats.upcoming_deadlines}
                    icon={<CalendarClock className="h-4 w-4" />}
                />
            </div>

            {/* Filters */}
            <Card>
                <CardContent className="flex flex-wrap items-center gap-2 p-3">
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search actionables..."
                        className="h-8 max-w-xs text-xs"
                    />
                    <Select value={priorityFilter} onChange={setPriorityFilter} placeholder="All priorities" options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
                    <Select value={categoryFilter} onChange={setCategoryFilter} placeholder="All categories" options={categoryOptions.map((c) => ({ value: c, label: c }))} />
                    <Select
                        value={teamFilter}
                        onChange={setTeamFilter}
                        placeholder="All teams"
                        options={[
                            { value: "__unassigned__", label: "Unassigned" },
                            ...teamOptions.map((t) => ({ value: t.team_id, label: t.name })),
                        ]}
                    />
                    <Select
                        value={deadlineFilter}
                        onChange={setDeadlineFilter}
                        placeholder="All timelines"
                        options={["Immediate", "Short-term", "Long-term", "Not Specified"].map((t) => ({ value: t, label: t }))}
                    />
                    <div className="ml-auto flex items-center gap-1">
                        <span className="text-[11px] text-muted-foreground mr-1">Group:</span>
                        {(["flat", "category", "department", "timeline"] as GroupMode[]).map((m) => (
                            <button
                                key={m}
                                onClick={() => setGroupMode(m)}
                                className={cn(
                                    "px-2 py-1 rounded text-[11px] border",
                                    groupMode === m
                                        ? "border-primary text-primary bg-primary/5"
                                        : "border-border text-muted-foreground hover:bg-accent",
                                )}
                            >
                                {m === "flat" ? "None" : m[0].toUpperCase() + m.slice(1)}
                            </button>
                        ))}
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                                setSearch("");
                                setPriorityFilter("");
                                setCategoryFilter("");
                                setTeamFilter("");
                                setDeadlineFilter("");
                            }}
                        >
                            <RefreshCw className="h-3 w-3" /> Clear
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Actionables table (grouped) */}
            <div className="space-y-4">
                {Array.from(grouped.entries()).map(([groupKey, items]) => (
                    <div key={groupKey} className="rounded-md border border-border">
                        {groupMode !== "flat" && (
                            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                                <span className="text-xs font-semibold">{groupKey}</span>
                                <span className="text-[11px] text-muted-foreground">
                                    {items.length} item{items.length === 1 ? "" : "s"}
                                </span>
                            </div>
                        )}
                        <div className="grid grid-cols-[80px_1fr_200px_90px_150px_140px_90px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/10">
                            <div>ID</div>
                            <div>Description</div>
                            <div>Assigned Teams</div>
                            <div>Priority</div>
                            <div>Deadline</div>
                            <div>Category</div>
                            <div>Risk</div>
                        </div>
                        {items.length === 0 ? (
                            <div className="p-6 text-center text-xs text-muted-foreground">
                                No actionables match the filters.
                            </div>
                        ) : (
                            items.map((a) => (
                                <ActionableRow
                                    key={a.id}
                                    a={a}
                                    teams={teamOptions}
                                    categoryOptions={categoryOptions}
                                    editTeams={editTeams}
                                    onPatch={(p) => patchItem(a.id, p)}
                                    onOpenSource={openSourcePdf}
                                />
                            ))
                        )}
                    </div>
                ))}
            </div>

            {/* Notice Board */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Info className="h-4 w-4" /> Notice Board
                        <span className="text-[11px] font-normal text-muted-foreground">
                            ({run.notice_board.length} items)
                        </span>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {run.notice_board.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            No informational or contextual items were extracted for this document.
                        </p>
                    ) : (
                        run.notice_board.map((n) => (
                            <div
                                key={n.id}
                                className="flex items-start gap-3 rounded border border-border p-3 text-xs"
                            >
                                <span
                                    className={cn(
                                        "shrink-0 rounded px-2 py-0.5 text-[10px] font-medium border",
                                        n.tag === "Advisory"
                                            ? "bg-blue-500/10 text-blue-600 border-blue-500/30"
                                            : n.tag === "Contextual"
                                                ? "bg-purple-500/10 text-purple-600 border-purple-500/30"
                                                : "bg-slate-500/10 text-slate-600 border-slate-500/30",
                                    )}
                                >
                                    {n.tag}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-foreground">{n.text}</p>
                                    {n.source && (
                                        <p className="text-[10px] text-muted-foreground mt-1">
                                            {n.source}
                                        </p>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function InsightCard({
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

function Select({
    value,
    onChange,
    placeholder,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    options: { value: string; label: string }[];
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
            <option value="">{placeholder}</option>
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    );
}

// Multi-select team picker with per-team task editing.
// Each selected team gets an input for "Task for this team".
function TeamMultiSelect({
    teams,
    selected,
    teamTasks,
    onChange,
}: {
    teams: IntelRunPayload["team_snapshot"];
    selected: string[];
    teamTasks: { team_id: string; team_name: string; team_specific_task: string }[];
    onChange: (next: string[], tasks: { team_id: string; team_name: string; team_specific_task: string }[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [open]);

    const taskMap = new Map(teamTasks.map((t) => [t.team_id, t.team_specific_task]));

    const toggle = (tid: string) => {
        const teamObj = teams.find((t) => t.team_id === tid);
        const tname = teamObj?.name || "";
        if (selected.includes(tid)) {
            const nextSelected = selected.filter((x) => x !== tid);
            const nextTasks = teamTasks.filter((t) => t.team_id !== tid);
            onChange(nextSelected, nextTasks);
        } else {
            const nextSelected = [...selected, tid];
            const nextTasks = [...teamTasks, { team_id: tid, team_name: tname, team_specific_task: "" }];
            onChange(nextSelected, nextTasks);
        }
    };

    const updateTask = (tid: string, task: string) => {
        const nextTasks = teamTasks.map((t) =>
            t.team_id === tid ? { ...t, team_specific_task: task } : t,
        );
        onChange(selected, nextTasks);
    };

    const selectedNames = teams
        .filter((t) => selected.includes(t.team_id))
        .map((t) => t.name);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-1 rounded border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-[11px] hover:bg-primary/10"
            >
                <span className="truncate text-left">
                    {selectedNames.length === 0 ? (
                        <span className="text-amber-600">Unassigned — click to add</span>
                    ) : (
                        selectedNames.join(", ")
                    )}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </button>
            {open && (
                <div className="absolute z-20 mt-1 w-80 max-h-80 overflow-y-auto rounded-md border border-border bg-popover shadow-md p-1">
                    {teams.length === 0 ? (
                        <div className="px-2 py-2 text-[11px] text-muted-foreground">
                            No teams defined. Add teams under the Teams tab.
                        </div>
                    ) : (
                        teams.map((t) => {
                            const on = selected.includes(t.team_id);
                            return (
                                <div key={t.team_id} className="space-y-1 mb-1">
                                    <button
                                        type="button"
                                        onClick={() => toggle(t.team_id)}
                                        className={cn(
                                            "w-full flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-left",
                                            on ? "bg-primary/10 text-primary" : "hover:bg-accent",
                                        )}
                                    >
                                        <input
                                            readOnly
                                            type="checkbox"
                                            checked={on}
                                            className="pointer-events-none accent-primary"
                                        />
                                        <span className="truncate">
                                            {t.name}
                                            {t.department && (
                                                <span className="ml-1 text-muted-foreground">
                                                    · {t.department}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    {on && (
                                        <input
                                            type="text"
                                            value={taskMap.get(t.team_id) || ""}
                                            onChange={(e) => updateTask(t.team_id, e.target.value)}
                                            placeholder={`Task for ${t.name}...`}
                                            className="w-full ml-6 mr-2 rounded border border-border bg-background px-2 py-1 text-[10px]"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

// Star-based risk rating component
function RiskStars({
    score,
    onRate,
}: {
    score: number;
    onRate: (s: number) => void;
}) {
    const [hover, setHover] = useState(0);
    const colorClass = RISK_STAR_COLOR(hover || score);

    return (
        <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((s) => (
                <button
                    key={s}
                    type="button"
                    onClick={() => onRate(s)}
                    onMouseEnter={() => setHover(s)}
                    className={cn(
                        "h-4 w-4 transition-colors",
                        s <= (hover || score) ? colorClass : "text-muted-foreground/30",
                    )}
                >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-full w-full">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                </button>
            ))}
        </div>
    );
}

function ActionableRow({
    a,
    teams,
    categoryOptions,
    editTeams,
    onPatch,
    onOpenSource,
}: {
    a: EnrichedActionable;
    teams: IntelRunPayload["team_snapshot"];
    categoryOptions: string[];
    editTeams: boolean;
    onPatch: (patch: Partial<EnrichedActionable>) => void;
    onOpenSource?: (source: string | undefined) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [teamDialogOpen, setTeamDialogOpen] = useState(false);

    // Local controlled deadline so the date input stays usable while typing.
    const [deadlineDraft, setDeadlineDraft] = useState<string>(
        a.deadline && a.deadline !== "Not Specified" ? a.deadline : "",
    );
    useEffect(() => {
        setDeadlineDraft(a.deadline && a.deadline !== "Not Specified" ? a.deadline : "");
    }, [a.deadline]);

    const commitDeadline = (next: string) => {
        const value = next || "Not Specified";
        if (value === a.deadline) return;
        onPatch({ deadline: value });
    };

    // Toggle expansion only when the click did not originate from an interactive
    // child (input, select, button, textarea) — so editing fields stays usable.
    const handleRowClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, select, textarea, a, label, [data-no-expand]")) {
            return;
        }
        setExpanded((v) => !v);
    };

    return (
        <div className="border-b border-border last:border-0">
            <div
                role="button"
                tabIndex={0}
                onClick={handleRowClick}
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((v) => !v);
                    }
                }}
                className="grid grid-cols-[80px_1fr_200px_90px_150px_140px_90px] gap-2 items-start px-4 py-3 text-xs hover:bg-muted/20 cursor-pointer select-none"
                title={expanded ? "Click to collapse" : "Click to expand"}
            >
                <span className="text-left font-mono text-[11px] text-muted-foreground">
                    {a.id.replace(/^A-/, "")}
                </span>
                <div className="min-w-0">
                    <p className="text-foreground break-words">{a.description}</p>
                    {a.source && (
                        onOpenSource ? (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onOpenSource(a.source); }}
                                className="text-[10px] text-primary hover:underline mt-1 text-left"
                                title="Open the original PDF at this page"
                            >
                                {a.source}
                            </button>
                        ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">{a.source}</p>
                        )
                    )}
                </div>
                <div className="min-w-0">
                    {editTeams ? (
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setTeamDialogOpen(true); }}
                            className="w-full flex flex-wrap items-center gap-1 rounded border border-dashed border-primary/40 bg-primary/5 px-2 py-1 text-[11px] hover:bg-primary/10 text-left min-h-[24px]"
                            title="Click to edit team assignments"
                        >
                            {a.assigned_team_names.length === 0 ? (
                                <span className="text-amber-600">Unassigned — click to add</span>
                            ) : (
                                a.assigned_team_names.map((n) => (
                                    <span
                                        key={n}
                                        className="rounded bg-primary/10 text-primary text-[10px] px-1.5 py-0.5"
                                    >
                                        {n}
                                    </span>
                                ))
                            )}
                        </button>
                    ) : (
                        <div className="flex flex-wrap gap-1">
                            {a.assigned_team_names.length === 0 ? (
                                <span className="text-[10px] text-amber-600">Unassigned</span>
                            ) : (
                                a.assigned_team_names.map((n) => (
                                    <span
                                        key={n}
                                        className="rounded bg-primary/10 text-primary text-[10px] px-1.5 py-0.5"
                                    >
                                        {n}
                                    </span>
                                ))
                            )}
                        </div>
                    )}
                </div>
                <select
                    value={a.priority}
                    onChange={(e) => onPatch({ priority: e.target.value as IntelPriority })}
                    className={cn(
                        "h-6 rounded border px-1 text-[11px] font-medium",
                        PRIORITY_STYLES[a.priority],
                    )}
                >
                    {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                            {p}
                        </option>
                    ))}
                </select>
                <div className="text-[11px] space-y-1">
                    <input
                        type="date"
                        value={deadlineDraft}
                        onChange={(e) => setDeadlineDraft(e.target.value)}
                        onBlur={() => commitDeadline(deadlineDraft)}
                        className="h-6 w-full rounded border border-border bg-background px-1 text-[11px]"
                    />
                    {a.deadline_phrase && (
                        <div className="text-[10px] text-muted-foreground italic truncate" title={a.deadline_phrase}>
                            &ldquo;{a.deadline_phrase}&rdquo;
                        </div>
                    )}
                </div>
                <select
                    value={a.category}
                    onChange={(e) => onPatch({ category: e.target.value })}
                    className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                >
                    {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                            {c}
                        </option>
                    ))}
                </select>
                <RiskStars
                    score={a.risk_score}
                    onRate={(s) => onPatch({ risk_score: s })}
                />
            </div>
            {expanded && (
                <div className="px-4 pb-3 text-[11px] space-y-2 bg-muted/10">
                    {a.original_text && (
                        <div>
                            <div className="text-muted-foreground mb-1">Source excerpt</div>
                            <p className="italic border-l-2 border-border pl-2">{a.original_text}</p>
                        </div>
                    )}
                    {(a.team_specific_tasks || []).length > 0 && (
                        <div>
                            <div className="text-muted-foreground mb-1">Team-Specific Tasks</div>
                            <div className="space-y-1.5">
                                {a.team_specific_tasks.map((t) => (
                                    <div
                                        key={t.team_id}
                                        className="flex items-start gap-2 rounded border border-border p-2 bg-background"
                                    >
                                        <span className="shrink-0 rounded bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 font-medium">
                                            {t.team_name}
                                        </span>
                                        <span className="text-foreground">{t.team_specific_task || "No task defined"}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <div className="text-muted-foreground mb-1">Notes</div>
                        <textarea
                            defaultValue={a.notes || ""}
                            onBlur={(e) => {
                                if (e.target.value !== (a.notes || "")) {
                                    onPatch({ notes: e.target.value });
                                }
                            }}
                            className="w-full h-16 rounded border border-border bg-background p-2 text-[11px]"
                            placeholder="Operational notes..."
                        />
                    </div>
                </div>
            )}
            <TeamAssignmentDialog
                open={teamDialogOpen}
                onClose={() => setTeamDialogOpen(false)}
                teams={teams}
                initialSelected={a.assigned_teams}
                initialTasks={a.team_specific_tasks || []}
                actionableDescription={a.description}
                onAccept={(teamIds, tasks) => {
                    onPatch({
                        assigned_teams: teamIds,
                        team_specific_tasks: tasks,
                    });
                }}
            />
        </div>
    );
}
