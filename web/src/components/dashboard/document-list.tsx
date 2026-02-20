"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileText, MoreHorizontal, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/ui/markdown"

import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { fetchDocuments } from "@/lib/api"
import { DocumentMeta } from "@/lib/types"

const API_BASE_URL = 'http://localhost:8001';

export function DocumentList() {
    const [documents, setDocuments] = useState<DocumentMeta[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedDoc, setExpandedDoc] = useState<DocumentMeta | null>(null)

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
        if (!confirm("Are you sure you want to delete this document?")) return

        try {
            const res = await fetch(`${API_BASE_URL}/documents/${id}`, {
                method: "DELETE",
            })
            if (!res.ok) throw new Error("Failed to delete")

            toast.success("Document deleted")
            loadDocuments()
        } catch (error) {
            toast.error("Failed to delete document")
        }
    }

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
        <div className="rounded-md border bg-card">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="w-[80px] text-right">Pages</TableHead>
                        <TableHead className="w-[80px] text-right">Nodes</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {documents.map((doc) => (
                        <TableRow key={doc.id}>
                            <TableCell>
                                <Link
                                    href={`/documents/${doc.id}`}
                                    className="flex items-center gap-2 hover:underline decoration-primary/50 underline-offset-4"
                                >
                                    <FileText className="h-4 w-4 text-primary shrink-0" />
                                    <span className="font-medium">{doc.name}</span>
                                </Link>
                                {doc.description && (
                                    <button
                                        className="text-xs text-muted-foreground truncate block max-w-full pl-6 mt-0.5 text-left hover:text-foreground transition-colors cursor-pointer"
                                        title="Click to view full description"
                                        onClick={() => setExpandedDoc(doc)}
                                    >
                                        {doc.description.replace(/\*\*/g, "").slice(0, 120)}...
                                    </button>
                                )}
                                <span className="text-[10px] font-mono text-muted-foreground/40 pl-6">{doc.id}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono">{doc.pages}</TableCell>
                            <TableCell className="text-right font-mono">{doc.nodes}</TableCell>
                            <TableCell className="text-right">
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                            <span className="sr-only">Open menu</span>
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            className="text-red-600 focus:text-red-600 focus:bg-red-100/10"
                                            onClick={() => handleDelete(doc.id)}
                                        >
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>

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
