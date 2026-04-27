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
    Info,
    Loader2,
    RefreshCw,
    Shield,
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
import {
    extractIntelligence,
    getIntelRun,
    patchIntelActionable,
} from "@/lib/intelligence-api";
import type {
    EnrichedActionable,
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

const RISK_STYLES = (score: number) => {
    if (score >= 5) return "bg-red-600 text-white";
    if (score >= 4) return "bg-red-500 text-white";
    if (score >= 3) return "bg-amber-500 text-white";
    if (score >= 2) return "bg-yellow-500 text-black";
    return "bg-emerald-500 text-white";
};

const CSV_FIELDS: Array<{ key: string; label: string }> = [
    { key: "id", label: "ID" },
    { key: "description", label: "Description" },
    { key: "source", label: "Source" },
    { key: "priority", label: "Priority" },
    { key: "category", label: "Category" },
    { key: "risk_score", label: "Risk Score" },
    { key: "deadline", label: "Deadline" },
    { key: "deadline_phrase", label: "Deadline Phrase" },
    { key: "deadline_reasoning", label: "Deadline Reasoning" },
    { key: "timeline_bucket", label: "Timeline Bucket" },
    { key: "assigned_team_names", label: "Assigned Teams" },
    { key: "notes", label: "Notes" },
];

function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = Array.isArray(v) ? v.join("; ") : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function downloadCsv(actionables: EnrichedActionable[], docName: string) {
    const header = CSV_FIELDS.map((f) => csvEscape(f.label)).join(",");
    const rows = actionables.map((a) =>
        CSV_FIELDS.map((f) => csvEscape((a as unknown as Record<string, unknown>)[f.key])).join(","),
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

export default function IntelligenceDocPage({
    params,
}: {
    params: Promise<{ docId: string }>;
}) {
    const { docId } = use(params);
    const decodedId = decodeURIComponent(docId);

    const [run, setRun] = useState<IntelRunPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editTeams, setEditTeams] = useState(false);

    // filters
    const [search, setSearch] = useState("");
    const [priorityFilter, setPriorityFilter] = useState<string>("");
    const [categoryFilter, setCategoryFilter] = useState<string>("");
    const [teamFilter, setTeamFilter] = useState<string>("");
    const [deadlineFilter, setDeadlineFilter] = useState<string>("");
    const [groupMode, setGroupMode] = useState<GroupMode>("flat");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const payload = await getIntelRun(decodedId);
            setRun(payload);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "";
            if (msg.toLowerCase().includes("no intelligence run")) {
                // First-time view: confirm before triggering AI extraction.
                const ok = window.confirm(
                    "No intelligence run exists yet for this document. Running extraction will invoke the AI/ML pipeline and may take some time. Do you want to proceed?",
                );
                if (!ok) {
                    setLoading(false);
                    return;
                }
                try {
                    const payload = await extractIntelligence(decodedId);
                    setRun(payload);
                    toast.success("Intelligence extracted");
                } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Extraction failed");
                }
            } else {
                toast.error(msg || "Failed to load");
            }
        } finally {
            setLoading(false);
        }
    }, [decodedId]);

    useEffect(() => {
        void load();
    }, [load]);

    const reExtract = async () => {
        const ok = window.confirm(
            "Re-extracting will run the AI/ML enrichment + assignment pipeline on this document. This may take some time and will overwrite the current run. Do you want to proceed?",
        );
        if (!ok) return;
        setBusy(true);
        try {
            const payload = await extractIntelligence(decodedId, true);
            setRun(payload);
            toast.success("Re-extracted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
            setBusy(false);
        }
    };

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

    if (loading || !run) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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

// Multi-select team picker — purely manual; dispatches an `assigned_teams`
// patch only when the user changes the selection. Section 5 of the spec.
function TeamMultiSelect({
    teams,
    selected,
    onChange,
}: {
    teams: IntelRunPayload["team_snapshot"];
    selected: string[];
    onChange: (next: string[]) => void;
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

    const toggle = (tid: string) => {
        if (selected.includes(tid)) {
            onChange(selected.filter((x) => x !== tid));
        } else {
            onChange([...selected, tid]);
        }
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
                <div className="absolute z-20 mt-1 w-64 max-h-64 overflow-y-auto rounded-md border border-border bg-popover shadow-md p-1">
                    {teams.length === 0 ? (
                        <div className="px-2 py-2 text-[11px] text-muted-foreground">
                            No teams defined. Add teams under the Teams tab.
                        </div>
                    ) : (
                        teams.map((t) => {
                            const on = selected.includes(t.team_id);
                            return (
                                <button
                                    key={t.team_id}
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
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}

function ActionableRow({
    a,
    teams,
    categoryOptions,
    editTeams,
    onPatch,
}: {
    a: EnrichedActionable;
    teams: IntelRunPayload["team_snapshot"];
    categoryOptions: string[];
    editTeams: boolean;
    onPatch: (patch: Partial<EnrichedActionable>) => void;
}) {
    const [expanded, setExpanded] = useState(false);

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
        onPatch({
            deadline: value,
            deadline_reasoning: next
                ? "Manually set by user."
                : "Cleared by user.",
        });
    };

    return (
        <div className="border-b border-border last:border-0">
            <div className="grid grid-cols-[80px_1fr_200px_90px_150px_140px_90px] gap-2 items-start px-4 py-3 text-xs hover:bg-muted/20">
                <button
                    onClick={() => setExpanded((v) => !v)}
                    className="text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                    {a.id.replace(/^A-/, "")}
                </button>
                <div className="min-w-0">
                    <p className="text-foreground break-words">{a.description}</p>
                    {a.source && (
                        <p className="text-[10px] text-muted-foreground mt-1">{a.source}</p>
                    )}
                </div>
                <div className="min-w-0">
                    {editTeams ? (
                        <TeamMultiSelect
                            teams={teams}
                            selected={a.assigned_teams}
                            onChange={(next) => onPatch({ assigned_teams: next })}
                        />
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
                            “{a.deadline_phrase}”
                        </div>
                    )}
                    {a.deadline_reasoning && (
                        <div
                            className="text-[10px] text-muted-foreground line-clamp-2"
                            title={a.deadline_reasoning}
                        >
                            {a.deadline_reasoning}
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
                <div className="flex items-center gap-1">
                    <span
                        className={cn(
                            "inline-flex items-center justify-center h-5 min-w-5 rounded text-[10px] font-bold px-1.5",
                            RISK_STYLES(a.risk_score),
                        )}
                    >
                        {a.risk_score}/5
                    </span>
                </div>
            </div>
            {expanded && (
                <div className="px-4 pb-3 text-[11px] space-y-2 bg-muted/10">
                    {a.original_text && (
                        <div>
                            <div className="text-muted-foreground mb-1">Source excerpt</div>
                            <p className="italic border-l-2 border-border pl-2">{a.original_text}</p>
                        </div>
                    )}
                    <div>
                        <div className="text-muted-foreground mb-1">Deadline reasoning</div>
                        <textarea
                            defaultValue={a.deadline_reasoning || ""}
                            onBlur={(e) => {
                                if (e.target.value !== (a.deadline_reasoning || "")) {
                                    onPatch({ deadline_reasoning: e.target.value });
                                }
                            }}
                            className="w-full h-14 rounded border border-border bg-background p-2 text-[11px]"
                            placeholder="Explain how this deadline was derived..."
                        />
                    </div>
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
        </div>
    );
}
