"use client"

import { useState } from "react"
import { Upload, X, Loader2, CheckCircle2, FileText } from "lucide-react"
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
import { ingestDocument } from "@/lib/api"
import { IngestResponse } from "@/lib/types"

export function UploadModal({ children }: { children?: React.ReactNode }) {
    const [open, setOpen] = useState(false)
    const [file, setFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [force, setForce] = useState(false)
    const [result, setResult] = useState<IngestResponse | null>(null)
    const router = useRouter()

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile && selectedFile.type === "application/pdf") {
            setFile(selectedFile)
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
        } else {
            toast.error("Please provide a valid PDF file")
        }
    }

    const handleUpload = async () => {
        if (!file) return

        setUploading(true)

        try {
            const response = await ingestDocument(file, force)
            setResult(response)
            window.dispatchEvent(new Event("document-uploaded"))
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Upload failed")
        } finally {
            setUploading(false)
        }
    }

    const handleClose = () => {
        setOpen(false)
        setFile(null)
        setResult(null)
        setForce(false)
    }

    const handleOpenDoc = () => {
        if (result) {
            router.push(`/documents/${result.doc_id}`)
        }
        handleClose()
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true) }}>
            <DialogTrigger asChild>
                {children || (
                    <Button>
                        <Upload className="mr-2 h-4 w-4" />
                        New Document
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{result ? "Ingestion Complete" : "Upload Document"}</DialogTitle>
                    <DialogDescription>
                        {result
                            ? "Your document has been processed successfully."
                            : "Drag and drop a PDF file here or click to browse."
                        }
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    /* Post-ingestion result summary */
                    <div className="mt-4 space-y-4">
                        <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                            <CheckCircle2 className="h-8 w-8 text-green-500 shrink-0" />
                            <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{result.doc_name}</p>
                                {result.doc_description && (
                                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                        <Markdown content={result.doc_description} className="[&_p]:mb-0 [&_p]:inline text-xs" />
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-muted/30 rounded-md p-3 text-center">
                                <p className="text-lg font-semibold font-mono">{result.total_pages}</p>
                                <p className="text-[10px] text-muted-foreground">Pages</p>
                            </div>
                            <div className="bg-muted/30 rounded-md p-3 text-center">
                                <p className="text-lg font-semibold font-mono">{result.node_count}</p>
                                <p className="text-[10px] text-muted-foreground">Nodes</p>
                            </div>
                            <div className="bg-muted/30 rounded-md p-3 text-center">
                                <p className="text-lg font-semibold font-mono">{result.time_seconds.toFixed(1)}s</p>
                                <p className="text-[10px] text-muted-foreground">Time</p>
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
                                    <p className="text-sm text-muted-foreground text-center mb-2">
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
                                    <div className="flex items-center justify-between w-full p-2 bg-background border rounded mb-4">
                                        <span className="text-sm truncate max-w-[200px]">{file.name}</span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => setFile(null)}
                                            disabled={uploading}
                                        >
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Button
                                        className="w-full"
                                        onClick={handleUpload}
                                        disabled={uploading}
                                    >
                                        {uploading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Processing...
                                            </>
                                        ) : (
                                            "Upload & Process"
                                        )}
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
