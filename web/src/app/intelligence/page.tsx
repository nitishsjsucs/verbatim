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
    Edit2,
    Check,
    X,
    Tag as TagIcon,
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
    extractIntelligence,
    resetAllIntelActionables,
    triggerCsvDownload,
} from "@/lib/intelligence-api";
import {
    listInstitutionTags,
    getDocTags,
    setDocTags,
    listTenantDocuments,
    type InstitutionTag,
    type TenantDocument,
} from "@/lib/intel-tenant-api";
import type { IntelDocumentMeta } from "@/lib/intelligence-types";
import { isIntelAdmin } from "@/lib/intel-auth";

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

interface DocumentRowProps {
    doc: IntelDocumentMeta;
    tags: string[];
    availableTags: InstitutionTag[];
    extracting: boolean;
    isEditing: boolean;
    isTagging: boolean;
    editName: string;
    isAdmin: boolean;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
    onEditNameChange: (name: string) => void;
    onStartTagging: () => void;
    onCancelTagging: () => void;
    onSaveTags: (tags: string[]) => void;
    onExtract: () => void;
    onOpen: () => void;
}

function DocumentRow({
    doc,
    tags,
    availableTags,
    extracting,
    isEditing,
    isTagging,
    editName,
    isAdmin,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onEditNameChange,
    onStartTagging,
    onCancelTagging,
    onSaveTags,
    onExtract,
    onOpen,
}: DocumentRowProps) {
    const [selectedTags, setSelectedTags] = useState<string[]>(tags);

    useEffect(() => {
        setSelectedTags(tags);
    }, [tags]);

    const toggleTag = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
        );
    };

    const docUrl = `/intelligence/workspace/${encodeURIComponent(doc.id)}`;

    return (
        <div
            className="grid grid-cols-[minmax(200px,3fr)_minmax(150px,2fr)_85px_36px_140px] gap-2 items-center px-4 py-2.5 text-xs border-b border-border last:border-0 hover:bg-muted/20"
        >
            {/* Document Name */}
            <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {isEditing ? (
                    <div className="flex items-center gap-1 flex-1">
                        <Input
                            value={editName}
                            onChange={(e) => onEditNameChange(e.target.value)}
                            className="h-6 text-xs flex-1"
                            autoFocus
                        />
                        <Button size="xs" variant="ghost" onClick={onSaveEdit}>
                            <Check className="h-3 w-3 text-green-600" />
                        </Button>
                        <Button size="xs" variant="ghost" onClick={onCancelEdit}>
                            <X className="h-3 w-3 text-red-500" />
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="font-medium break-words text-[12px] leading-snug flex-1" title={doc.name}>
                            {doc.name}
                        </span>
                        {isAdmin && (
                            <Button size="xs" variant="ghost" onClick={onStartEdit} className="shrink-0">
                                <Edit2 className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* Tags */}
            <div className="flex items-center gap-1 flex-wrap">
                {isTagging ? (
                    <div className="flex flex-col gap-1 w-full">
                        <div className="flex flex-wrap gap-1">
                            {availableTags.map((t) => (
                                <button
                                    key={t.name}
                                    onClick={() => toggleTag(t.name)}
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full border transition-colors ${
                                        selectedTags.includes(t.name)
                                            ? "bg-primary/10 text-primary border-primary/30"
                                            : "text-muted-foreground border-border hover:border-primary/30"
                                    }`}
                                >
                                    {t.name}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1">
                            <Button size="xs" variant="ghost" onClick={() => onSaveTags(selectedTags)}>
                                <Check className="h-3 w-3 text-green-600" />
                            </Button>
                            <Button size="xs" variant="ghost" onClick={onCancelTagging}>
                                <X className="h-3 w-3 text-red-500" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        {tags.map((t) => (
                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                {t}
                            </span>
                        ))}
                        {isAdmin && (
                            <Button size="xs" variant="ghost" onClick={onStartTagging}>
                                <TagIcon className="h-3 w-3" />
                            </Button>
                        )}
                    </>
                )}
            </div>

            {/* Effective Date */}
            <div className="text-center text-[11px] text-muted-foreground">
                {formatDate(doc.circular_effective_date) || "\u2014"}
            </div>

            {/* Status */}
            <div className="flex items-center justify-center" title={doc.has_intel_run ? "Intelligence ready" : "Not extracted"}>
                {doc.has_intel_run ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-center gap-1.5">
                {isAdmin && (
                    <Button
                        size="xs"
                        variant="outline"
                        disabled={extracting}
                        onClick={(e) => { e.stopPropagation(); onExtract(); }}
                    >
                        {extracting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <Zap className="h-3 w-3" />
                        )}
                        {doc.has_intel_run ? "Re-extract" : "Extract"}
                    </Button>
                )}
                {doc.has_intel_run && (
                    <Link href={docUrl} onClick={(e) => e.stopPropagation()}>
                        <Button size="xs" variant="default" title="Open document">
                            <ArrowRight className="h-3 w-3" />
                        </Button>
                    </Link>
                )}
            </div>
        </div>
    );
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
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [docTags, setDocTagsState] = useState<Record<string, string[]>>({});
    const [availableTags, setAvailableTags] = useState<InstitutionTag[]>([]);
    const [taggingId, setTaggingId] = useState<string | null>(null);
    const isAdmin = isIntelAdmin();

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [tenantDocs, tags] = await Promise.all([
                listTenantDocuments(),
                listInstitutionTags().catch(() => [] as InstitutionTag[]),
            ]);
            
            // Map TenantDocument to IntelDocumentMeta format
            const mappedDocs: IntelDocumentMeta[] = tenantDocs.map((d: TenantDocument) => ({
                id: d.doc_id,
                name: d.doc_name,
                pages: d.pages,
                nodes: d.nodes,
                has_intel_run: d.has_run,
                has_actionables: d.has_run,
            }));
            
            setDocs(mappedDocs);
            setAvailableTags(tags);
            
            // Build tag map from tenant response
            const tagMap: Record<string, string[]> = {};
            tenantDocs.forEach((d: TenantDocument) => {
                tagMap[d.doc_id] = d.tags || [];
            });
            setDocTagsState(tagMap);
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
                    {isAdmin && (
                        <UploadModal>
                            <Button size="sm">
                                <Upload className="h-3.5 w-3.5" />
                                Upload PDF
                            </Button>
                        </UploadModal>
                    )}
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
                    {isAdmin && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={onResetAll}
                            className="text-red-600 hover:text-red-700 hover:bg-red-500/10 border-red-500/30"
                        >
                            <Trash2 className="h-3.5 w-3.5" /> Reset
                        </Button>
                    )}
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
                <div className="grid grid-cols-[minmax(200px,3fr)_minmax(150px,2fr)_85px_36px_140px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
                    <div>Document</div>
                    <div>Tags</div>
                    <div className="text-center">Effective</div>
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
                        const isEditing = editingId === d.id;
                        const isTagging = taggingId === d.id;
                        const tags = docTags[d.id] || [];
                        return (
                            <DocumentRow
                                key={d.id}
                                doc={d}
                                tags={tags}
                                availableTags={availableTags}
                                extracting={extracting}
                                isEditing={isEditing}
                                isTagging={isTagging}
                                editName={editName}
                                isAdmin={isAdmin}
                                onStartEdit={() => { setEditingId(d.id); setEditName(d.name); }}
                                onCancelEdit={() => { setEditingId(null); setEditName(""); }}
                                onSaveEdit={async () => {
                                    // TODO: Add rename API call when backend supports it
                                    toast.info("Rename not yet implemented in backend");
                                    setEditingId(null);
                                }}
                                onEditNameChange={setEditName}
                                onStartTagging={() => setTaggingId(d.id)}
                                onCancelTagging={() => setTaggingId(null)}
                                onSaveTags={async (newTags: string[]) => {
                                    try {
                                        await setDocTags(d.id, newTags);
                                        setDocTagsState((prev) => ({ ...prev, [d.id]: newTags }));
                                        setTaggingId(null);
                                        toast.success("Tags updated");
                                    } catch {
                                        toast.error("Failed to update tags");
                                    }
                                }}
                                onExtract={() => onExtract(d.id, d.has_intel_run)}
                                onOpen={() => d.has_intel_run && router.push(docUrl)}
                            />
                        );
                    })
                )}
            </div>
        </div>
    );
}
