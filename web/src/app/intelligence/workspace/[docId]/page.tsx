"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { use } from "react";
import { toast } from "sonner";
import {
    AlertTriangle,
    ArrowLeft,
    CalendarClock,
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
    reassignIntelTeams,
} from "@/lib/intelligence-api";
import type {
    EnrichedActionable,
    IntelPriority,
    IntelRunPayload,
    IntelStatus,
} from "@/lib/intelligence-types";
import { cn } from "@/lib/utils";

type GroupMode = "flat" | "category" | "department" | "timeline";

const PRIORITIES: IntelPriority[] = ["High", "Medium", "Low"];
const STATUSES: IntelStatus[] = ["Pending", "In Progress", "Completed"];

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
            // If no run yet, try to auto-extract
            const msg = e instanceof Error ? e.message : "";
            if (msg.toLowerCase().includes("no intelligence run")) {
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

    const reassign = async () => {
        setBusy(true);
        try {
            const payload = await reassignIntelTeams(decodedId);
            setRun(payload);
            toast.success("Teams reassigned");
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
            if (groupMode === "category") return a.category || "Other";
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

    const allCategories = Array.from(new Set(run.actionables.map((a) => a.category)));
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
                    <Button size="sm" variant="outline" onClick={reassign} disabled={busy}>
                        <UsersIcon className="h-3.5 w-3.5" /> Reassign teams
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
                    <Select value={categoryFilter} onChange={setCategoryFilter} placeholder="All categories" options={allCategories.map((c) => ({ value: c, label: c }))} />
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
                        <div className="grid grid-cols-[80px_1fr_180px_90px_110px_130px_120px_120px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/10">
                            <div>ID</div>
                            <div>Description</div>
                            <div>Assigned Teams</div>
                            <div>Priority</div>
                            <div>Deadline</div>
                            <div>Category</div>
                            <div>Risk</div>
                            <div>Status</div>
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
                                    allCategories={allCategories}
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

function ActionableRow({
    a,
    teams,
    allCategories,
    onPatch,
}: {
    a: EnrichedActionable;
    teams: IntelRunPayload["team_snapshot"];
    allCategories: string[];
    onPatch: (patch: Partial<EnrichedActionable>) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="border-b border-border last:border-0">
            <div className="grid grid-cols-[80px_1fr_180px_90px_110px_130px_120px_120px] gap-2 items-start px-4 py-3 text-xs hover:bg-muted/20">
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
                <div className="text-[11px]">
                    {a.deadline === "Not Specified" ? (
                        <span className="text-muted-foreground">Not Specified</span>
                    ) : (
                        <span className="font-medium">{a.deadline}</span>
                    )}
                    {a.deadline_phrase && (
                        <div className="text-[10px] text-muted-foreground italic">
                            “{a.deadline_phrase}”
                        </div>
                    )}
                </div>
                <select
                    value={a.category}
                    onChange={(e) => onPatch({ category: e.target.value as EnrichedActionable["category"] })}
                    className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                >
                    {allCategories.map((c) => (
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
                <select
                    value={a.status}
                    onChange={(e) => onPatch({ status: e.target.value as IntelStatus })}
                    className="h-6 rounded border border-border bg-background px-1 text-[11px]"
                >
                    {STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </select>
            </div>
            {expanded && (
                <div className="px-4 pb-3 text-[11px] space-y-2 bg-muted/10">
                    {a.original_text && (
                        <div>
                            <div className="text-muted-foreground mb-1">Source excerpt</div>
                            <p className="italic border-l-2 border-border pl-2">{a.original_text}</p>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <span className="text-muted-foreground">Team assignment:</span>
                        {teams.map((t) => {
                            const on = a.assigned_teams.includes(t.team_id);
                            return (
                                <button
                                    key={t.team_id}
                                    onClick={() =>
                                        onPatch({
                                            assigned_teams: on
                                                ? a.assigned_teams.filter((x) => x !== t.team_id)
                                                : [...a.assigned_teams, t.team_id],
                                        })
                                    }
                                    className={cn(
                                        "rounded px-1.5 py-0.5 border text-[10px]",
                                        on
                                            ? "bg-primary/10 text-primary border-primary/30"
                                            : "bg-background text-muted-foreground border-border hover:bg-accent",
                                    )}
                                >
                                    {t.name}
                                </button>
                            );
                        })}
                        {teams.length === 0 && (
                            <span className="text-muted-foreground">
                                No teams defined. Add teams under Teams tab.
                            </span>
                        )}
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
