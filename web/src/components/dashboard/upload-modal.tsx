"use client"

import { useState, useEffect, useRef } from "react"
import { Upload, X, Loader2, CheckCircle2, FileText, Pencil, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { Markdown } from "@/components/ui/markdown"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { ingestDocument, fetchRegulators, updateDocumentMetadata } from "@/lib/api"
import { IngestResponse } from "@/lib/types"

export function UploadModal({ children }: { children?: React.ReactNode }) {
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const [force, setForce] = useState(false)
    const [result, setResult] = useState<IngestResponse | null>(null)
    const [stageLabel, setStageLabel] = useState("")
    const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null)
    const [customName, setCustomName] = useState("")
    const [editingName, setEditingName] = useState(false)
    const [circularTitle, setCircularTitle] = useState("")
    const [regulationIssueDate, setRegulationIssueDate] = useState("")
    const [circularEffectiveDate, setCircularEffectiveDate] = useState("")
    const [regulator, setRegulator] = useState("")
    const [regulators, setRegulators] = useState<string[]>([])
    const router = useRouter()

    // Fetch regulator list on mount
    useEffect(() => {
        fetchRegulators().then(setRegulators).catch(() => {})
    }, [])

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile && selectedFile.type === "application/pdf") {
            setFile(selectedFile)
            setCustomName(selectedFile.name.replace(/\.pdf$/i, ""))
        } else {
            toast.error("Please upload a PDF file")
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const droppedFile = e.dataTransfer.files?.[0]
        if (droppedFile && droppedFile.type === "application/pdf") {
            setFile(droppedFile)
            setCustomName(droppedFile.name.replace(/\.pdf$/i, ""))
        } else {
            toast.error("Please provide a valid PDF file")
        }
    }

    const handleConfirm = () => {
        if (!file) return
        setConfirming(true)
    }

    const handleAcceptAndUpload = async () => {
        if (!file) return
        setConfirming(false)
        setUploading(true)

        // Staged progress labels
        const stages = [
            "Uploading PDF to server",
            "Parsing document structure",
            "Chunking into nodes",
            "Building search index",
            "Saving document metadata",
            "Finalizing ingestion",
        ]
        let idx = 0
        setStageLabel(stages[0])
        stageTimer.current = setInterval(() => {
            idx = Math.min(idx + 1, stages.length - 1)
            setStageLabel(stages[idx])
        }, 3000)

        try {
            const response = await ingestDocument(file, force)
            setResult(response)
            // Save document metadata (circular info + regulation dates + regulator)
            if (circularTitle || regulationIssueDate || circularEffectiveDate || regulator) {
                try {
                    await updateDocumentMetadata(response.doc_id, {
                        circular_title: circularTitle,
                        regulation_issue_date: regulationIssueDate,
                        circular_effective_date: circularEffectiveDate,
                        regulator,
                    })
                } catch { /* metadata save is non-fatal */ }
            } else {
                // Always trigger metadata save to auto-generate circular_id
                try {
                    await updateDocumentMetadata(response.doc_id, {})
                } catch { /* non-fatal */ }
            }
            window.dispatchEvent(new Event("document-uploaded"))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Upload failed")
        } finally {
            if (stageTimer.current) { clearInterval(stageTimer.current); stageTimer.current = null }
            setUploading(false)
            setStageLabel("")
        }
    }

    const handleClose = () => {
        setOpen(false)
        setFile(null)
        setResult(null)
        setForce(false)
        setConfirming(false)
        setCustomName("")
        setEditingName(false)
        setCircularTitle("")
        setRegulationIssueDate("")
        setCircularEffectiveDate("")
        setRegulator("")
    }

    const handleOpenDoc = () => {
        if (result) {
            router.push(`/documents/${result.doc_id}`)
        }
        handleClose()
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !uploading && !confirming) { handleClose(); } else if (v) { setOpen(true) } }}>
            <DialogTrigger asChild>
                {children || (
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs">
                        <Upload className="h-3.5 w-3.5" />
                        New Document
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] max-h-[85vh] overflow-hidden flex flex-col" showCloseButton={!uploading && !confirming} onInteractOutside={(e) => { if (uploading) e.preventDefault() }} onEscapeKeyDown={(e) => { if (uploading) e.preventDefault() }}>
                <DialogHeader>
                    <DialogTitle>{result ? "Ingestion Complete" : "Upload Document"}</DialogTitle>
                    <DialogDescription>
                        {result
                            ? "Your document has been processed successfully."
                            : "Drag and drop a PDF file here or click to browse (This process may take upwards of 10 minutes)."
                        }
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    /* Post-ingestion result summary — matches Extract Actionable style */
                    <div className="mt-4 space-y-5 overflow-y-auto max-h-[60vh]">
                        {/* Header with icon */}
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
                                <CheckCircle2 className="h-7 w-7 text-green-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-foreground truncate">{result.doc_name}</p>
                                {result.doc_description && (
                                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                        <Markdown content={result.doc_description} className="[&_p]:mb-0 [&_p]:inline text-xs" />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Progress bar — 100% complete */}
                        <div className="space-y-1.5">
                            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500/70 rounded-full transition-all duration-700 ease-out" style={{ width: "100%" }} />
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>100% complete</span>
                                <span>Ingestion finished</span>
                            </div>
                        </div>

                        {/* Stats grid — matches extraction style */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-xs font-semibold font-mono">{result.total_pages}</p>
                                <p className="text-xs text-muted-foreground">Pages</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-xs font-semibold font-mono">{result.node_count}</p>
                                <p className="text-xs text-muted-foreground">Nodes</p>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-3 text-center">
                                <p className="text-xs font-semibold font-mono">{result.time_seconds.toFixed(1)}s</p>
                                <p className="text-xs text-muted-foreground">Time</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" className="flex-1" onClick={handleClose}>
                                Done
                            </Button>
                            <Button className="flex-1" onClick={handleOpenDoc}>
                                <FileText className="h-4 w-4 mr-2" />
                                Open Document
                            </Button>
                        </div>
                    </div>
                ) : confirming ? (
                    /* Confirmation step before ingestion */
                    <div className="mt-4 space-y-5">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                                <AlertTriangle className="h-7 w-7 text-amber-500" />
                            </div>
                            <div>
                                <h2 className="text-xs font-semibold text-foreground">Confirm Ingestion</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">{customName || file?.name}</p>
                            </div>
                        </div>
                        <p className="text-xs text-foreground/80">
                            This will run the full ingestion pipeline: parsing, chunking, and indexing.
                            The dialog will become blocking and cannot be dismissed while the pipeline is running.
                            This may take upwards of 10 minutes.
                        </p>
                        <div className="flex gap-2">
                            <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>Back</Button>
                            <Button className="flex-1" onClick={handleAcceptAndUpload}>Accept &amp; Ingest</Button>
                        </div>
                    </div>
                ) : uploading ? (
                    /* Uploading state — progress bar matching Extract Actionable style */
                    <div className="mt-4 space-y-5">
                        <div className="flex items-center gap-4">
                            <div className="h-14 w-14 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
                                <Loader2 className="h-7 w-7 text-purple-500 animate-spin" />
                            </div>
                            <div>
                                <h2 className="text-xs font-semibold text-foreground">Ingesting Document</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">{customName || file?.name}</p>
                            </div>
                        </div>

                        <p className="text-xs text-foreground/80 font-medium">{stageLabel || "Parsing, chunking, and indexing document..."}</p>

                        {/* Indeterminate progress bar */}
                        <div className="space-y-1.5">
                            <div className="w-full h-3 bg-muted/50 rounded-full overflow-hidden relative">
                                <div className="absolute inset-y-0 left-0 w-1/3 bg-purple-500/70 rounded-full" style={{animation: 'indeterminate 1.4s ease-in-out infinite'}} />
                                <style>{`@keyframes indeterminate { 0% { transform: translateX(-100%); } 50% { transform: translateX(150%); } 100% { transform: translateX(350%); } }`}</style>
                            </div>
                            <div className="text-xs text-muted-foreground text-center">
                                Please wait. Do not close this window or navigate away.
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Upload form */
                    <div className="mt-4 space-y-4">
                        <div
                            className={`
                                border-2 border-dashed rounded-lg p-8
                                flex flex-col items-center justify-center
                                transition-colors
                                ${file ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}
                            `}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                        >
                            {!file ? (
                                <>
                                    <Upload className="h-10 w-10 text-muted-foreground mb-4" />
                                    <p className="text-xs text-muted-foreground text-center mb-2">
                                        Drag PDF here
                                    </p>
                                    <div className="relative">
                                        <input
                                            type="file"
                                            accept=".pdf"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            onChange={handleFileChange}
                                        />
                                        <Button variant="secondary" size="sm">Browse Files</Button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex flex-col items-center w-full">
                                    <div className="flex items-center justify-between w-full p-2 bg-background border rounded mb-2">
                                        <span className="text-xs truncate max-w-[200px]">{file.name}</span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => { setFile(null); setCustomName("") }}
                                            disabled={uploading}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>

                                    {/* Editable document name */}
                                    <div className="w-full mb-3">
                                        <label className="text-xs font-medium text-muted-foreground/60 block mb-1">Document Name</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                value={customName}
                                                onChange={e => setCustomName(e.target.value)}
                                                placeholder="Enter document name..."
                                                className="flex-1 bg-muted/30 text-xs rounded-md px-3 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                                            />
                                            <Pencil className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                        </div>
                                    </div>

                                    {/* Circular Title */}
                                    <div className="w-full mb-3">
                                        <label className="text-xs font-medium text-muted-foreground/60 block mb-1">Circular Title</label>
                                        <input
                                            value={circularTitle}
                                            onChange={e => setCircularTitle(e.target.value)}
                                            placeholder="Enter circular title..."
                                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                                        />
                                    </div>

                                    {/* Circular Issued Date */}
                                    <div className="w-full mb-3">
                                        <label className="text-xs font-medium text-muted-foreground/60 block mb-1">Circular Issued Date</label>
                                        <input
                                            type="date"
                                            value={regulationIssueDate}
                                            onChange={e => setRegulationIssueDate(e.target.value)}
                                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                                        />
                                    </div>

                                    {/* Circular Effective Date */}
                                    <div className="w-full mb-3">
                                        <label className="text-xs font-medium text-muted-foreground/60 block mb-1">Circular Effective Date</label>
                                        <input
                                            type="date"
                                            value={circularEffectiveDate}
                                            onChange={e => setCircularEffectiveDate(e.target.value)}
                                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                                        />
                                    </div>

                                    {/* Regulator Dropdown */}
                                    <div className="w-full mb-4">
                                        <label className="text-xs font-medium text-muted-foreground/60 block mb-1">Regulator</label>
                                        <select
                                            value={regulator}
                                            onChange={e => setRegulator(e.target.value)}
                                            className="w-full bg-muted/30 text-xs rounded-md px-3 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground"
                                        >
                                            <option value="">Select regulator...</option>
                                            {regulators.map(r => (
                                                <option key={r} value={r}>{r}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <Button
                                        className="w-full"
                                        onClick={handleConfirm}
                                        disabled={uploading}
                                    >
                                        Upload & Process
                                    </Button>
                                </div>
                            )}
                        </div>

                        {/* Force re-ingest checkbox */}
                        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none px-1">
                            <input
                                type="checkbox"
                                checked={force}
                                onChange={(e) => setForce(e.target.checked)}
                                className="rounded border-border h-3.5 w-3.5 accent-primary"
                            />
                            Force re-ingest (overwrite existing tree)
                        </label>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
