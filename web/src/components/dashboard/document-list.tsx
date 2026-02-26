"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import { FileText, Trash2, X, MessageSquare, Search, Pencil, Shield, Loader2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, BookOpen, Filter } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/ui/markdown"

import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { fetchDocuments, extractActionablesStreaming, ExtractionProgressEvent } from "@/lib/api"
import { DocumentMeta } from "@/lib/types"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export function DocumentList() {
    const [documents, setDocuments] = useState<DocumentMeta[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedDoc, setExpandedDoc] = useState<DocumentMeta | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [sortBy, setSortBy] = useState<"name" | "date">("date")
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
    const [yearFilter, setYearFilter] = useState<string>("all")
    const [extractionFilter, setExtractionFilter] = useState<"all" | "extracted" | "not_extracted">("all")
    const [renamingDocId, setRenamingDocId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState("")
    const [extractingDocId, setExtractingDocId] = useState<string | null>(null)
    const [extractConfirmDocId, setExtractConfirmDocId] = useState<string | null>(null)
    // Detailed extraction progress
    const [extStage, setExtStage] = useState<"starting" | "prefilter" | "extracting" | "validating" | "done">("starting")
    const [extTotalNodes, setExtTotalNodes] = useState(0)
    const [extCandidates, setExtCandidates] = useState(0)
    const [extTotalBatches, setExtTotalBatches] = useState(0)
    const [extCurrentBatch, setExtCurrentBatch] = useState(0)
    const [extCumulative, setExtCumulative] = useState(0)
    const [extValidated, setExtValidated] = useState(0)
    const [extFlagged, setExtFlagged] = useState(0)
    const [deletingDocId, setDeletingDocId] = useState<string | null>(null)

    const loadDocuments = async () => {
        try {
            const docs = await fetchDocuments()
            setDocuments(docs)
        } catch (error) {
            toast.error("Failed to load documents")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadDocuments()
        window.addEventListener("document-uploaded", loadDocuments)
        return () => window.removeEventListener("document-uploaded", loadDocuments)
    }, [])

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/documents/${id}`, {
                method: "DELETE",
            })
            if (!res.ok) throw new Error("Failed to delete")

            toast.success("Document deleted")
            setDeletingDocId(null)
            loadDocuments()
        } catch (error) {
            toast.error("Failed to delete document")
        }
    }

    const handleExtract = async (docId: string, docName: string) => {
        setExtractConfirmDocId(null)
        setExtractingDocId(docId)
        setExtStage("starting")
        setExtTotalNodes(0)
        setExtCandidates(0)
        setExtTotalBatches(0)
        setExtCurrentBatch(0)
        setExtCumulative(0)
        setExtValidated(0)
        setExtFlagged(0)
        try {
            const result = await extractActionablesStreaming(docId, false, (event: ExtractionProgressEvent) => {
                switch (event.event) {
                    case "start":
                        setExtStage("prefilter")
                        setExtTotalNodes(event.total_nodes || 0)
                        break
                    case "prefilter_done":
                        setExtCandidates(event.candidate_count || 0)
                        setExtTotalNodes(event.total_nodes || 0)
                        break
                    case "batches_planned":
                        setExtStage("extracting")
                        setExtTotalBatches(event.total_batches || 0)
                        setExtCandidates(event.candidate_count || 0)
                        break
                    case "batch_start":
                        setExtCurrentBatch(event.batch || 0)
                        break
                    case "batch_done":
                        setExtCurrentBatch(event.batch || 0)
                        setExtCumulative(event.cumulative_actionables || 0)
                        break
                    case "validation_start":
                        setExtStage("validating")
                        setExtCumulative(event.total_actionables || 0)
                        break
                    case "validation_done":
                        setExtStage("done")
                        setExtValidated(event.validated || 0)
                        setExtFlagged(event.flagged || 0)
                        break
                }
            })
            toast.success(`Extracted ${result.actionables?.length || 0} actionables from ${docName}`)
            loadDocuments()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Extraction failed")
        } finally {
            setExtractingDocId(null)
        }
    }

    const handleRename = async (id: string, newName: string) => {
        if (!newName.trim()) { toast.error("Name cannot be empty"); return }
        try {
            const res = await fetch(`${API_BASE_URL}/documents/${id}/rename`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName.trim() }),
            })
            if (!res.ok) throw new Error("Failed to rename")
            toast.success("Document renamed")
            setRenamingDocId(null)
            loadDocuments()
        } catch (error) {
            toast.error("Failed to rename document")
        }
    }

    // Derive available years from documents
    const availableYears = useMemo(() => {
        const years = new Set<string>()
        for (const doc of documents) {
            if (doc.ingested_at) {
                years.add(new Date(doc.ingested_at).getFullYear().toString())
            }
        }
        return Array.from(years).sort((a, b) => Number(b) - Number(a))
    }, [documents])

    const filteredDocuments = useMemo(() => {
        let filtered = documents
        // Name search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase()
            filtered = filtered.filter(doc =>
                doc.name.toLowerCase().includes(q) ||
                (doc.description && doc.description.toLowerCase().includes(q))
            )
        }
        // Year filter
        if (yearFilter !== "all") {
            filtered = filtered.filter(doc => {
                if (!doc.ingested_at) return false
                return new Date(doc.ingested_at).getFullYear().toString() === yearFilter
            })
        }
        // Extraction status filter
        if (extractionFilter !== "all") {
            filtered = filtered.filter(doc => {
                if (extractionFilter === "extracted") return !!doc.has_actionables
                return !doc.has_actionables
            })
        }
        // Sort
        filtered = [...filtered].sort((a, b) => {
            if (sortBy === "name") {
                const cmp = a.name.localeCompare(b.name)
                return sortDir === "asc" ? cmp : -cmp
            }
            // sort by date
            const dateA = a.ingested_at ? new Date(a.ingested_at).getTime() : 0
            const dateB = b.ingested_at ? new Date(b.ingested_at).getTime() : 0
            return sortDir === "asc" ? dateA - dateB : dateB - dateA
        })
        return filtered
    }, [documents, searchQuery, yearFilter, extractionFilter, sortBy, sortDir])

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Loading documents...</div>
    }

    if (documents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-[400px] border border-dashed rounded-lg bg-card/50">
                <FileText className="h-10 w-10 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium">No documents yet</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Upload a PDF to get started.
                </p>
            </div>
        )
    }

    return (
        <>
        {/* Search & Filter Bar */}
        <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1">
                <Search className="absolute left-2.5 top-[9px] h-3.5 w-3.5 text-muted-foreground" />
                <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search documents by name..."
                    className="w-full bg-muted/30 text-sm rounded-md pl-8 pr-3 py-2 border border-transparent focus:border-border focus:outline-none text-foreground placeholder:text-muted-foreground/50"
                />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                <Filter className="h-3.5 w-3.5 text-muted-foreground/50" />
                {/* Year filter */}
                <select
                    value={yearFilter}
                    onChange={e => setYearFilter(e.target.value)}
                    className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                >
                    <option value="all">All years</option>
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                {/* Extraction status filter */}
                <select
                    value={extractionFilter}
                    onChange={e => setExtractionFilter(e.target.value as "all" | "extracted" | "not_extracted")}
                    className="bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent focus:border-border focus:outline-none text-foreground"
                >
                    <option value="all">All status</option>
                    <option value="extracted">Extracted</option>
                    <option value="not_extracted">Not Extracted</option>
                </select>
                {/* Sort */}
                <button
                    onClick={() => {
                        if (sortBy === "name") { setSortBy("date"); setSortDir("desc") }
                        else { setSortBy("name"); setSortDir("asc") }
                    }}
                    className="flex items-center gap-1 bg-muted/30 text-xs rounded-md px-2 py-1.5 border border-transparent hover:border-border text-muted-foreground hover:text-foreground transition-colors"
                    title={`Sort by ${sortBy === "name" ? "date" : "name"}`}
                >
                    <ArrowUpDown className="h-3 w-3" />
                    {sortBy === "name" ? "Name" : "Date"}
                </button>
                <button
                    onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
                    className="p-1.5 rounded-md bg-muted/30 hover:border-border text-muted-foreground hover:text-foreground transition-colors"
                    title={sortDir === "asc" ? "Ascending" : "Descending"}
                >
                    {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                </button>
                {(yearFilter !== "all" || extractionFilter !== "all") && (
                    <button
                        onClick={() => { setYearFilter("all"); setExtractionFilter("all") }}
                        className="p-1 rounded hover:bg-muted/30 text-muted-foreground/40 hover:text-foreground transition-colors"
                        title="Clear filters"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>
            {(searchQuery || yearFilter !== "all" || extractionFilter !== "all") && (
                <span className="text-xs text-muted-foreground/60 font-mono shrink-0">
                    {filteredDocuments.length} of {documents.length}
                </span>
            )}
        </div>

        <Table>
            <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider h-9 pl-4" style={{ width: '50%'}}>Name</TableHead>
                    <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider h-9 w-[72px] text-right">Pages</TableHead>
                    <TableHead className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider h-9 w-[130px] text-right">Date Ingested</TableHead>
                    <TableHead className="h-9"></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {filteredDocuments.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground/60">
                            No documents match your search
                        </TableCell>
                    </TableRow>
                )}
                {filteredDocuments.map((doc) => (
                    <TableRow key={doc.id} className="border-b border-border/60 hover:bg-accent/40 transition-colors group">
                        <TableCell className="pl-4 py-2.5">
                            <Link
                                href={`/documents/${doc.id}`}
                                className="flex items-center gap-2 group/link"
                            >
                                <FileText className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 group-hover/link:text-primary transition-colors" />
                                <span className="text-[13px] font-medium text-foreground group-hover/link:text-primary transition-colors">{doc.name}</span>
                            </Link>
                            {doc.description && (
                                <button
                                    className="text-[11px] text-muted-foreground/60 truncate block max-w-full pl-[22px] mt-0.5 text-left hover:text-muted-foreground transition-colors cursor-pointer"
                                    title="Click to view full description"
                                    onClick={() => setExpandedDoc(doc)}
                                >
                                    {doc.description.replace(/\*\*/g, "").slice(0, 100)}…
                                </button>
                            )}
                        </TableCell>
                        <TableCell className="text-right text-[12px] font-mono text-muted-foreground py-2.5">{doc.pages}</TableCell>
                        <TableCell className="text-right text-[12px] text-muted-foreground py-2.5">
                            {doc.ingested_at ? (
                                <span className="text-muted-foreground/70">
                                    {new Date(doc.ingested_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                                </span>
                            ) : (
                                <span className="text-muted-foreground/60">—</span>
                            )}
                        </TableCell>
                        <TableCell className="text-right py-2.5 pr-2">
                            <div className="flex items-center justify-end gap-1.5">
                                {doc.description && (
                                    <button
                                        onClick={() => setExpandedDoc(doc)}
                                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors text-[11px] font-medium"
                                        title="Read full summary"
                                    >
                                        <BookOpen className="h-3 w-3" />
                                        Summary
                                    </button>
                                )}
                                <Link
                                    href={`/documents/${doc.id}?tab=chat`}
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-medium"
                                    title="Chat with document"
                                >
                                    <MessageSquare className="h-3 w-3" />
                                    Chat
                                </Link>
                                <button
                                    onClick={() => { setRenamingDocId(doc.id); setRenameValue(doc.name) }}
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors text-[11px] font-medium"
                                    title="Rename document"
                                >
                                    <Pencil className="h-3 w-3" />
                                    Rename
                                </button>
                                {doc.has_actionables ? (
                                    <span
                                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-emerald-500/10 text-emerald-500 text-[11px] font-medium cursor-default"
                                        title="Actionables already extracted"
                                    >
                                        <CheckCircle2 className="h-3 w-3" />
                                        Extracted
                                    </span>
                                ) : (
                                    <button
                                        onClick={() => setExtractConfirmDocId(doc.id)}
                                        disabled={extractingDocId === doc.id}
                                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 transition-colors text-[11px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Extract actionables from document"
                                    >
                                        {extractingDocId === doc.id
                                            ? <Loader2 className="h-3 w-3 animate-spin" />
                                            : <Shield className="h-3 w-3" />}
                                        Extract
                                    </button>
                                )}
                                <button
                                    onClick={() => setDeletingDocId(doc.id)}
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-[11px] font-medium"
                                    title="Delete document"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    Delete
                                </button>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>

        {/* Extract Confirm Dialog */}
        {extractConfirmDocId && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={() => setExtractConfirmDocId(null)}
            >
                <div
                    className="bg-background border border-border rounded-xl shadow-2xl w-[420px] p-6 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                            <Shield className="h-5 w-5 text-amber-500" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-foreground">Extract Actionables</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {documents.find(d => d.id === extractConfirmDocId)?.name}
                            </p>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        This will analyze the document and extract compliance actionables. This process may take several minutes depending on document size.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setExtractConfirmDocId(null)}>Cancel</Button>
                        <Button
                            size="sm"
                            className="gap-1.5 bg-amber-500 hover:bg-amber-600 text-white"
                            onClick={() => {
                                const doc = documents.find(d => d.id === extractConfirmDocId)
                                handleExtract(extractConfirmDocId, doc?.name || extractConfirmDocId)
                            }}
                        >
                            <Shield className="h-3.5 w-3.5" />
                            Start Extraction
                        </Button>
                    </div>
                </div>
            </div>
        )}

        {/* Extract Progress Dialog — rich progress bar */}
        {extractingDocId && (() => {
            const batchPct = extTotalBatches > 0 ? Math.round((extCurrentBatch / extTotalBatches) * 100) : 0
            const overallPct =
                extStage === "starting" || extStage === "prefilter" ? 5 :
                extStage === "extracting" ? Math.round(10 + (batchPct * 0.7)) :
                extStage === "validating" ? 85 :
                100
            const stageLabel =
                extStage === "starting" ? "Initializing..." :
                extStage === "prefilter" ? "Scanning document for deontic language..." :
                extStage === "extracting" ? `Extracting batch ${extCurrentBatch} of ${extTotalBatches}` :
                extStage === "validating" ? "Validating & deduplicating actionables..." :
                "Finishing up..."

            return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-background border border-border rounded-xl shadow-2xl w-[480px] p-6 space-y-5">
                        {/* Header */}
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-amber-500/15 flex items-center justify-center">
                                <Loader2 className="h-5 w-5 text-amber-500 animate-spin" />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold text-foreground">Extracting Actionables</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {documents.find(d => d.id === extractingDocId)?.name}
                                </p>
                            </div>
                        </div>

                        {/* Stage label */}
                        <p className="text-xs text-foreground/80 font-medium">{stageLabel}</p>

                        {/* Overall progress bar */}
                        <div className="space-y-1.5">
                            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-amber-500/70 rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${overallPct}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                <span>{overallPct}% complete</span>
                                {extStage === "extracting" && extTotalBatches > 0 && (
                                    <span>Batch {extCurrentBatch}/{extTotalBatches}</span>
                                )}
                            </div>
                        </div>

                        {/* Stats grid */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-lg font-semibold font-mono">
                                    {extCandidates > 0 ? extCandidates : "..."}
                                </p>
                                <p className="text-[10px] text-muted-foreground">Sections scanned</p>
                                {extTotalNodes > 0 && (
                                    <p className="text-[9px] text-muted-foreground/50">of {extTotalNodes} total</p>
                                )}
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-lg font-semibold font-mono text-amber-500">
                                    {extCumulative}
                                </p>
                                <p className="text-[10px] text-muted-foreground">Found so far</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-lg font-semibold font-mono">
                                    {extStage === "done" ? `${extValidated}/${extFlagged}` : "..."}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                    {extStage === "done" ? "Valid / Flagged" : "Validation"}
                                </p>
                            </div>
                        </div>

                        {/* Validation indeterminate bar */}
                        {extStage === "validating" && (
                            <div className="w-full h-1.5 bg-muted/50 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500/40 rounded-full animate-pulse w-full" />
                            </div>
                        )}

                        <p className="text-[10px] text-muted-foreground/50 text-center">
                            This may take several minutes depending on document size.
                        </p>
                    </div>
                </div>
            )
        })()}

        {/* Delete Confirm Dialog */}
        {deletingDocId && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={() => setDeletingDocId(null)}
            >
                <div
                    className="bg-background border border-border rounded-xl shadow-2xl w-[400px] p-6 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-red-500/15 flex items-center justify-center">
                            <Trash2 className="h-5 w-5 text-red-500" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-foreground">Delete Document</h2>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                {documents.find(d => d.id === deletingDocId)?.name}
                            </p>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        This will permanently delete this document and all associated data. This action cannot be undone.
                    </p>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setDeletingDocId(null)}>Cancel</Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="gap-1.5"
                            onClick={() => handleDelete(deletingDocId)}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                        </Button>
                    </div>
                </div>
            </div>
        )}

        {/* Rename Dialog */}
        {renamingDocId && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={() => setRenamingDocId(null)}
            >
                <div
                    className="bg-background border border-border rounded-xl shadow-2xl w-[400px] p-6 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h2 className="text-sm font-semibold text-foreground">Rename Document</h2>
                    <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleRename(renamingDocId, renameValue) }}
                        className="w-full bg-muted/30 text-sm rounded-md px-3 py-2 border border-border focus:border-primary focus:outline-none text-foreground"
                        placeholder="Document name..."
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setRenamingDocId(null)}>Cancel</Button>
                        <Button size="sm" onClick={() => handleRename(renamingDocId, renameValue)}>Save</Button>
                    </div>
                </div>
            </div>
        )}

        {/* Document Description Dialog */}
        {expandedDoc && (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={() => setExpandedDoc(null)}
            >
                <div
                    className="bg-background border border-border rounded-xl shadow-2xl max-w-2xl w-[90vw] max-h-[80vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-primary shrink-0" />
                                <h2 className="text-base font-semibold text-foreground truncate">
                                    {expandedDoc.name}
                                </h2>
                            </div>
                            <div className="flex items-center gap-3 mt-1.5 pl-6">
                                <span className="text-[10px] font-mono text-muted-foreground/50">{expandedDoc.id}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{expandedDoc.pages} pages</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{expandedDoc.nodes} nodes</span>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setExpandedDoc(null)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto px-6 py-5">
                        {expandedDoc.description ? (
                            <Markdown content={expandedDoc.description} className="text-sm text-foreground/90 [&_p]:leading-7" />
                        ) : (
                            <p className="text-sm text-muted-foreground italic">No description available.</p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-3 border-t border-border/40 flex justify-end">
                        <Button variant="outline" size="sm" onClick={() => setExpandedDoc(null)}>
                            Close
                        </Button>
                    </div>
                </div>
            </div>
        )}
        </>
    )
}
