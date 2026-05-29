"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    ArrowLeft,
    FileText,
    Loader2,
    Undo,
    ChevronDown,
    ChevronRight,
} from "lucide-react";
import { isIntelAuthenticated, isIntelClient } from "@/lib/intel-auth";
import {
    getDocumentActionables,
    listAdditionals,
    type TenantActionablesResponse,
    type AdditionalEntry,
} from "@/lib/intel-tenant-api";

/**
 * Client Document View — read-only with LOCAL sandbox.
 *
 * - Shows actionables from the intelligence extraction.
 * - Shows "Additionals" appended by admin.
 * - Client can make local edits (notes, status) stored ONLY in localStorage.
 * - Local edits do NOT persist to the server.
 */

const SANDBOX_PREFIX = "intel_sandbox_";

interface SandboxEdit {
    [actionableId: string]: {
        local_notes?: string;
        local_status?: string;
    };
}

function loadSandbox(docId: string): SandboxEdit {
    try {
        const raw = localStorage.getItem(`${SANDBOX_PREFIX}${docId}`);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveSandbox(docId: string, edits: SandboxEdit): void {
    localStorage.setItem(`${SANDBOX_PREFIX}${docId}`, JSON.stringify(edits));
}

function clearSandbox(docId: string): void {
    localStorage.removeItem(`${SANDBOX_PREFIX}${docId}`);
}

export default function ClientDocDetailPage() {
    const params = useParams();
    const router = useRouter();
    const docId = params?.docId as string;

    const [data, setData] = React.useState<TenantActionablesResponse | null>(null);
    const [additionals, setAdditionals] = React.useState<AdditionalEntry[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [sandbox, setSandbox] = React.useState<SandboxEdit>({});
    const [showAdditionals, setShowAdditionals] = React.useState(true);

    React.useEffect(() => {
        if (!isIntelAuthenticated() || !isIntelClient()) {
            router.replace("/intelligence/login");
        }
    }, [router]);

    React.useEffect(() => {
        if (!docId) return;
        setSandbox(loadSandbox(docId));
        Promise.all([
            getDocumentActionables(docId),
            listAdditionals(docId),
        ])
            .then(([d, a]) => { setData(d); setAdditionals(a); })
            .catch(() => toast.error("Failed to load document"))
            .finally(() => setLoading(false));
    }, [docId]);

    const updateSandboxField = (id: string, field: "local_notes" | "local_status", value: string) => {
        const next = { ...sandbox, [id]: { ...sandbox[id], [field]: value } };
        setSandbox(next);
        saveSandbox(docId, next);
    };

    const resetSandbox = () => {
        clearSandbox(docId);
        setSandbox({});
        toast.success("Local edits cleared");
    };

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    }

    if (!data) {
        return (
            <div className="p-6 text-center">
                <p className="text-xs text-muted-foreground">Document not found or not accessible.</p>
                <button onClick={() => router.back()} className="mt-4 text-xs text-primary hover:underline">Go back</button>
            </div>
        );
    }

    const hasSandboxEdits = Object.keys(sandbox).length > 0;

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2">
                    <button onClick={() => router.back()} className="p-1 rounded hover:bg-muted">
                        <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold">{data.doc_name || docId}</span>
                </div>
                <div className="flex items-center gap-2">
                    {hasSandboxEdits && (
                        <>
                            <span className="text-[10px] text-yellow-600 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                                Local edits (sandbox)
                            </span>
                            <button
                                onClick={resetSandbox}
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                                <Undo className="h-3 w-3" /> Reset
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto w-full">
                {/* Actionables */}
                <section>
                    <h3 className="text-xs font-semibold mb-3">
                        Actionables ({data.actionables.length})
                    </h3>
                    {data.actionables.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No actionables extracted yet.</p>
                    ) : (
                        <div className="space-y-2">
                            {data.actionables.map((a: Record<string, unknown>, i: number) => {
                                const id = (a.id as string) || `act-${i}`;
                                const localEdits = sandbox[id] || {};
                                return (
                                    <ActionableCard
                                        key={id}
                                        actionable={a}
                                        localEdits={localEdits}
                                        onEditNote={(v) => updateSandboxField(id, "local_notes", v)}
                                        onEditStatus={(v) => updateSandboxField(id, "local_status", v)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </section>

                {/* Additionals */}
                {additionals.length > 0 && (
                    <section>
                        <button
                            onClick={() => setShowAdditionals(!showAdditionals)}
                            className="flex items-center gap-1.5 text-xs font-semibold mb-3"
                        >
                            {showAdditionals ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Additionals ({additionals.length})
                        </button>
                        {showAdditionals && (
                            <div className="space-y-3">
                                {additionals.map((entry) => (
                                    <div key={entry.entry_id} className="border border-border rounded-lg p-3 bg-muted/10">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-medium">{entry.title}</span>
                                            {entry.date && <span className="text-[10px] text-muted-foreground">{entry.date}</span>}
                                        </div>
                                        {entry.description && <p className="text-xs text-muted-foreground mb-2">{entry.description}</p>}
                                        {entry.actionables.length > 0 && (
                                            <div className="space-y-1 mt-2">
                                                {entry.actionables.map((ea: Record<string, unknown>, idx: number) => (
                                                    <div key={idx} className="text-xs bg-background border border-border/50 rounded px-2 py-1.5">
                                                        <span className="font-medium">{String(ea.title || ea.name || `Item ${idx + 1}`)}</span>
                                                        {ea.description ? <p className="text-muted-foreground mt-0.5">{String(ea.description)}</p> : null}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Actionable Card (with local sandbox editing)
// ---------------------------------------------------------------------------

function ActionableCard({
    actionable,
    localEdits,
    onEditNote,
    onEditStatus,
}: {
    actionable: Record<string, unknown>;
    localEdits: { local_notes?: string; local_status?: string };
    onEditNote: (v: string) => void;
    onEditStatus: (v: string) => void;
}) {
    const [expanded, setExpanded] = React.useState(false);

    const title = String(actionable.title || actionable.name || "Untitled");
    const description = String(actionable.description || actionable.requirement || "");
    const category = String(actionable.category || actionable.theme || "");
    const deadline = String(actionable.deadline || actionable.due_date || "");

    return (
        <div className="border border-border rounded-lg px-3 py-2.5 hover:bg-muted/10 transition-colors">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <button onClick={() => setExpanded(!expanded)} className="text-left w-full">
                        <p className="text-xs font-medium">{title}</p>
                        {!expanded && description && (
                            <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{description}</p>
                        )}
                    </button>
                </div>
                <div className="flex items-center gap-1.5 ml-2">
                    {category && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{category}</span>
                    )}
                    {deadline && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-600">{deadline}</span>
                    )}
                </div>
            </div>
            {expanded && (
                <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                    {/* Local sandbox fields */}
                    <div>
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Your Notes (local only)</label>
                        <textarea
                            value={localEdits.local_notes || ""}
                            onChange={(e) => onEditNote(e.target.value)}
                            placeholder="Add personal notes..."
                            className="w-full bg-background text-xs rounded px-2 py-1 border border-border/50 focus:border-primary focus:outline-none resize-none h-12"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] text-muted-foreground block mb-0.5">Your Status (local only)</label>
                        <select
                            value={localEdits.local_status || ""}
                            onChange={(e) => onEditStatus(e.target.value)}
                            className="bg-background text-xs rounded px-2 py-1 border border-border/50 focus:border-primary focus:outline-none"
                        >
                            <option value="">— None —</option>
                            <option value="noted">Noted</option>
                            <option value="in_progress">In Progress</option>
                            <option value="done">Done</option>
                            <option value="not_applicable">Not Applicable</option>
                        </select>
                    </div>
                    <p className="text-[9px] text-muted-foreground/60 italic">
                        These edits are stored locally on your device and are not shared.
                    </p>
                </div>
            )}
        </div>
    );
}
