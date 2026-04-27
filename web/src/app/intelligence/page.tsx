"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    FileText,
    Upload,
    Zap,
    Loader2,
    CheckCircle2,
    ArrowRight,
    RefreshCw,
    Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { UploadModal } from "@/components/dashboard/upload-modal";
import {
    buildCsv,
    listIntelDocuments,
    extractIntelligence,
    triggerCsvDownload,
} from "@/lib/intelligence-api";
import type { IntelDocumentMeta } from "@/lib/intelligence-types";

function exportDocumentsCsv(docs: IntelDocumentMeta[]) {
    const rows = docs.map((d) => [
        d.name,
        String(d.pages),
        String(d.nodes),
        d.has_intel_run ? "Intelligence ready" : "Not extracted",
        d.ingested_at || "",
        d.id,
    ]);
    const csv = buildCsv(["Document", "Pages", "Nodes", "Status", "Ingested At", "ID"], rows);
    triggerCsvDownload(csv, `workspace_documents_${new Date().toISOString().slice(0, 10)}.csv`);
}

export default function IntelligenceWorkspacePage() {
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

    const onExtract = async (docId: string, force = false) => {
        if (force) {
            const ok = window.confirm(
                "Re-extracting will run the AI/ML enrichment + assignment pipeline. This may take some time and will overwrite the existing run. Do you want to proceed?",
            );
            if (!ok) return;
        }
        setExtractingId(docId);
        try {
            const run = await extractIntelligence(docId, force);
            toast.success(`Extracted ${run.actionables.length} actionables`);
            await refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Extraction failed");
        } finally {
            setExtractingId(null);
        }
    };

    void Upload; // upload icon retained for design parity inside header CTA

    const filtered = docs.filter((d) =>
        query.trim() ? d.name.toLowerCase().includes(query.toLowerCase()) : true,
    );

    return (
        <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Document Actionable Workspace</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                        Upload regulatory PDFs, extract enriched actionables, and review grouped
                        insights. Ingestion, chunking, and raw extraction reuse the existing system.
                    </p>
                </div>
                <div className="flex items-center gap-2">
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
                </div>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Upload className="h-4 w-4" /> Upload a PDF
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Uses the same ingestion pipeline as the rest of the app — circular title,
                        issue date, effective date, and regulator are captured here and become
                        document metadata downstream (including the deadline-fallback used by
                        intelligence extraction).
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3">
                    <UploadModal>
                        <Button size="sm">
                            <Upload className="h-3.5 w-3.5" />
                            Upload PDF
                        </Button>
                    </UploadModal>
                    <Input
                        placeholder="Search documents..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-8 max-w-xs text-xs"
                    />
                    <div className="ml-auto text-xs text-muted-foreground">
                        {filtered.length} of {docs.length} documents
                    </div>
                </CardContent>
            </Card>

            <div className="rounded-md border border-border">
                <div className="grid grid-cols-[1fr_120px_120px_160px_220px] gap-2 px-4 py-2 text-[11px] font-medium text-muted-foreground border-b border-border bg-muted/30">
                    <div>Document</div>
                    <div className="text-right">Pages</div>
                    <div className="text-right">Nodes</div>
                    <div>Status</div>
                    <div className="text-right">Actions</div>
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
                        return (
                            <div
                                key={d.id}
                                className="grid grid-cols-[1fr_120px_120px_160px_220px] gap-2 items-center px-4 py-3 text-xs border-b border-border last:border-0 hover:bg-muted/20"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="truncate font-medium" title={d.name}>
                                        {d.name}
                                    </span>
                                </div>
                                <div className="text-right tabular-nums text-muted-foreground">
                                    {d.pages}
                                </div>
                                <div className="text-right tabular-nums text-muted-foreground">
                                    {d.nodes}
                                </div>
                                <div>
                                    {d.has_intel_run ? (
                                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="h-3 w-3" /> Intelligence ready
                                        </span>
                                    ) : (
                                        <span className="text-muted-foreground">Not extracted</span>
                                    )}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        disabled={extracting}
                                        onClick={() => onExtract(d.id, d.has_intel_run)}
                                    >
                                        {extracting ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <Zap className="h-3 w-3" />
                                        )}
                                        {d.has_intel_run ? "Re-extract" : "Extract"}
                                    </Button>
                                    {d.has_intel_run && (
                                        <Link href={`/intelligence/workspace/${encodeURIComponent(d.id)}`}>
                                            <Button size="xs" variant="default">
                                                Open <ArrowRight className="h-3 w-3" />
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
