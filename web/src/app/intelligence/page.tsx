"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    FileText,
    Upload,
    Zap,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowRight,
    RefreshCw,
    Download,
    Trash2,
    Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadModal } from "@/components/dashboard/upload-modal";
import {
    PipelineActionDialog,
    usePipelineAction,
} from "@/components/intelligence/pipeline-action-dialog";
import {
    buildCsv,
    listIntelDocuments,
    extractIntelligence,
    resetAllIntelActionables,
    triggerCsvDownload,
} from "@/lib/intelligence-api";
import type { IntelDocumentMeta } from "@/lib/intelligence-types";

function formatDate(raw: string | undefined): string {
    if (!raw) return "";
    try {
        const d = new Date(raw);
        if (isNaN(d.getTime())) return raw;
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    } catch {
        return raw;
    }
}

function exportDocumentsCsv(docs: IntelDocumentMeta[]) {
    const rows = docs.map((d) => [
        d.id,
        d.name,
        d.regulator || "",
        d.circular_effective_date || "",
        d.has_intel_run ? "Intelligence ready" : "Not extracted",
        d.has_actionables ? "Yes" : "No",
        String(d.pages),
        String(d.nodes),
        d.description || "",
        d.circular_id || "",
        d.circular_title || "",
        d.regulation_issue_date || "",
        d.ingested_at || "",
        d.created_at || "",
    ]);
    const csv = buildCsv(
        ["ID", "Document", "Regulator", "Effective Date", "Intel Status", "Has Actionables", "Pages", "Nodes", "Description", "Circular ID", "Circular Title", "Issue Date", "Ingested At", "Created At"],
        rows,
    );
    triggerCsvDownload(csv, `workspace_documents_${new Date().toISOString().slice(0, 10)}.csv`);
}

export default function IntelligenceWorkspacePage() {
    const router = useRouter();
    const [docs, setDocs] = useState<IntelDocumentMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [extractingId, setExtractingId] = useState<string | null>(null);
    const [query, setQuery] = useState("");

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listIntelDocuments();
            setDocs(list);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to load documents");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // The main UploadModal dispatches "document-uploaded" when ingestion completes.
    // Listen for that event so the workspace table re-syncs after a unified upload.
    useEffect(() => {
        const handler = () => void refresh();
        window.addEventListener("document-uploaded", handler);
        return () => window.removeEventListener("document-uploaded", handler);
    }, [refresh]);

    // Dialog controllers — one for extraction, one for the global reset.
    const extractDialog = usePipelineAction({
        title: "Run extraction pipeline?",
        description:
            "This will run the AI/ML enrichment + assignment pipeline on this document. The dialog will stay open with a progress indicator and cannot be dismissed while the pipeline is running.",
        confirmLabel: "Run pipeline",
        stages: [
            "Loading document tree",
            "Extracting raw actionables",
            "Enriching priority · deadline · risk",
            "Assigning teams + generating team-specific tasks",
            "Persisting intelligence run",
        ],
    });

    const reExtractDialog = usePipelineAction({
        title: "Re-run extraction pipeline?",
        description:
            "This will OVERWRITE the existing intelligence run for this document. The dialog will stay open with a progress indicator and cannot be dismissed while the pipeline is running.",
        confirmLabel: "Overwrite & re-run",
        stages: [
            "Loading document tree",
            "Extracting raw actionables",
            "Enriching priority · deadline · risk",
            "Assigning teams + generating team-specific tasks",
            "Persisting intelligence run",
        ],
    });

    const resetDialog = usePipelineAction({
        title: "Reset ALL extracted actionables?",
        description:
            "This wipes every extracted actionable across every document (team assignments, team-specific tasks, deadlines, priorities, risk, notes). Documents, document metadata, and teams are NOT touched. Use this for a clean slate before re-running extraction.",
        confirmLabel: "Wipe all actionables",
        stages: ["Wiping intel_runs collection", "Refreshing workspace"],
    });

    const onExtract = async (docId: string, force = false) => {
        const dlg = force ? reExtractDialog : extractDialog;
        setExtractingId(docId);
        const result = await dlg.request(
            () => extractIntelligence(docId, force),
            { successMessage: (run) => `Extracted ${run.actionables.length} actionable(s).` },
        );
        setExtractingId(null);
        if (result) {
            toast.success(`Extracted ${result.actionables.length} actionables`);
            await refresh();
        }
    };

    const onResetAll = async () => {
        const result = await resetDialog.request(
            async () => {
                const r = await resetAllIntelActionables();
                await refresh();
                return r;
            },
            { successMessage: (r) => `Wiped ${r.deleted_runs} intelligence run(s).` },
        );
        if (result) {
            toast.success(`Wiped ${result.deleted_runs} intelligence run(s)`);
        }
    };

    const filtered = docs.filter((d) =>
        query.trim() ? d.name.toLowerCase().includes(query.toLowerCase()) : true,
    );

    return (
        <div className="mx-auto max-w-7xl px-6 py-6 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-semibold">Document Actionable Workspace</h1>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Upload regulatory PDFs, extract enriched actionables, and review grouped insights.
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="h-8 w-48 pl-7 text-xs"
                        />
                    </div>
                    <UploadModal>
                        <Button size="sm">
                            <Upload className="h-3.5 w-3.5" />
                            Upload PDF
                        </Button>
                    </UploadModal>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportDocumentsCsv(docs)}
                        disabled={docs.length === 0}
                    >
                        <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onResetAll}
                        className="text-red-600 hover:text-red-700 hover:bg-red-500/10 border-red-500/30"
                    >
                        <Trash2 className="h-3.5 w-3.5" /> Reset
                    </Button>
                </div>
            </div>

            {/* Custom blocking pipeline dialogs */}
            <PipelineActionDialog {...extractDialog} />
            <PipelineActionDialog {...reExtractDialog} />
            <PipelineActionDialog {...resetDialog} />

            <div className="text-xs text-muted-foreground">
                {filtered.length} of {docs.length} document{docs.length !== 1 ? "s" : ""}
            </div>

            <div className="rounded-md border border-border overflow-x-auto">
                <div className="grid grid-cols-[minmax(180px,3fr)_55px_55px_85px_85px_36px_120px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
                    <div>Document</div>
                    <div className="text-center">Pages</div>
                    <div className="text-center">Nodes</div>
                    <div className="text-center">Effective</div>
                    <div className="text-center">Created</div>
                    <div className="text-center" title="Intelligence status"></div>
                    <div className="text-center">Actions</div>
                </div>
                {loading ? (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        Loading documents...
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="p-10 text-center text-xs text-muted-foreground">
                        No documents yet. Upload a PDF to begin.
                    </div>
                ) : (
                    filtered.map((d) => {
                        const extracting = extractingId === d.id;
                        const docUrl = `/intelligence/workspace/${encodeURIComponent(d.id)}`;
                        return (
                            <div
                                key={d.id}
                                className="grid grid-cols-[minmax(180px,3fr)_55px_55px_85px_85px_36px_120px] gap-2 items-center px-4 py-2.5 text-xs border-b border-border last:border-0 hover:bg-muted/20 cursor-pointer"
                                onDoubleClick={() => d.has_intel_run && router.push(docUrl)}
                            >
                                <div className="flex items-start gap-2 min-w-0">
                                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                    <span className="font-medium break-words whitespace-normal text-[12px] leading-snug" title={d.name}>
                                        {d.name}
                                    </span>
                                </div>
                                <div className="text-center tabular-nums text-muted-foreground">
                                    {d.pages}
                                </div>
                                <div className="text-center tabular-nums text-muted-foreground">
                                    {d.nodes}
                                </div>
                                <div className="text-center text-[11px] text-muted-foreground">
                                    {formatDate(d.circular_effective_date) || "\u2014"}
                                </div>
                                <div className="text-center text-[11px] text-muted-foreground">
                                    {formatDate(d.created_at) || formatDate(d.ingested_at) || "\u2014"}
                                </div>
                                <div className="flex items-center justify-center" title={d.has_intel_run ? "Intelligence ready" : "Not extracted"}>
                                    {d.has_intel_run ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                        <XCircle className="h-4 w-4 text-red-400" />
                                    )}
                                </div>
                                <div className="flex items-center justify-center gap-1.5">
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={extracting}
                                        onClick={(e) => { e.stopPropagation(); onExtract(d.id, d.has_intel_run); }}
                                    >
                                        {extracting ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <Zap className="h-3 w-3" />
                                        )}
                                        {d.has_intel_run ? "Re-extract" : "Extract"}
                                    </Button>
                                    {d.has_intel_run && (
                                        <Link href={docUrl} onClick={(e) => e.stopPropagation()}>
                                            <Button size="xs" variant="default" title="Open document">
                                                <ArrowRight className="h-3 w-3" />
                                            </Button>
                                        </Link>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
