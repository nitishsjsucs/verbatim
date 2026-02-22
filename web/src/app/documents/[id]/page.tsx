"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ChatInterface } from "@/components/views/chat-interface"
import { TreeExplorer } from "@/components/views/tree-explorer"
import { NodeDetailPanel } from "@/components/views/node-detail-panel"
import { ActionablesPanel } from "@/components/views/actionables-panel"
import dynamic from "next/dynamic"
import type { PdfViewerHandle } from "@/components/views/pdf-viewer"
import { fetchDocument } from "@/lib/api"
import { DocumentDetail, TreeNode } from "@/lib/types"
import { Loader2, AlertCircle, FileText, MessageSquare, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

// Dynamic import — pdf.js requires browser APIs (no SSR)
const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center h-full w-full text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading PDF viewer...
            </div>
        ),
    }
)

function findNodeById(nodes: TreeNode[], nodeId: string): TreeNode | undefined {
    for (const node of nodes) {
        if (node.node_id === nodeId) return node
        if (node.children?.length) {
            const found = findNodeById(node.children, nodeId)
            if (found) return found
        }
    }
    return undefined
}

type ViewMode = "document" | "chat" | "actionables"

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params)

    const [doc, setDoc] = React.useState<DocumentDetail | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [selectedNodeId, setSelectedNodeId] = React.useState<string | undefined>()
    const [viewMode, setViewMode] = React.useState<ViewMode>("document")

    // Ref to control PDF viewer — no state updates, no re-render loops
    const pdfRef = React.useRef<PdfViewerHandle>(null)

    React.useEffect(() => {
        fetchDocument(id)
            .then(setDoc)
            .catch(err => {
                console.error(err)
                setError("Failed to load document")
            })
            .finally(() => setLoading(false))
    }, [id])

    const selectedNode = selectedNodeId && doc?.structure
        ? findNodeById(doc.structure, selectedNodeId)
        : undefined

    const handleNodeSelect = React.useCallback((node: TreeNode) => {
        setSelectedNodeId(node.node_id)
        // Jump to the page in the PDF viewer via ref (no state update)
        if (pdfRef.current && node.start_page >= 1) {
            pdfRef.current.jumpToPage(node.start_page - 1)
        }
    }, [])

    const handleCitationClick = React.useCallback((pageNumber: number) => {
        if (pdfRef.current && pageNumber >= 1) {
            pdfRef.current.jumpToPage(pageNumber - 1)
        }
    }, [])

    const handleActionableSourceClick = React.useCallback((_nodeId: string, pageNumber: number) => {
        if (pdfRef.current && pageNumber >= 1) {
            pdfRef.current.jumpToPage(pageNumber - 1)
        }
    }, [])

    const pdfUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/documents/${id}/raw`

    if (loading) {
        return (
            <div className="flex h-screen w-full bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="animate-pulse">Loading document structure...</span>
            </div>
        )
    }

    if (error || !doc) {
        return (
            <div className="flex h-screen w-full bg-background items-center justify-center text-destructive flex-col gap-2">
                <AlertCircle className="h-8 w-8" />
                <p className="font-medium">{error || "Document not found"}</p>
            </div>
        )
    }

    return (
        <div className="flex bg-background h-screen w-full overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                {/* Tab Bar */}
                <div className="h-11 border-b border-border flex items-center px-2 bg-background/80 backdrop-blur-md flex-shrink-0 gap-1">
                    <TabButton
                        active={viewMode === "document"}
                        onClick={() => setViewMode("document")}
                        icon={<FileText className="h-3.5 w-3.5" />}
                        label="Document"
                    />
                    <TabButton
                        active={viewMode === "chat"}
                        onClick={() => setViewMode("chat")}
                        icon={<MessageSquare className="h-3.5 w-3.5" />}
                        label="Chat"
                    />
                    <TabButton
                        active={viewMode === "actionables"}
                        onClick={() => setViewMode("actionables")}
                        icon={<Shield className="h-3.5 w-3.5" />}
                        label="Actionables"
                    />
                    <div className="flex-1" />
                    <div className="text-xs text-muted-foreground/50 pr-2">
                        {doc.doc_name} &middot; {doc.total_pages} pages
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex overflow-hidden min-h-0">
                    {viewMode === "document" ? (
                        /* ===== DOCUMENT VIEW: Tree + PDF ===== */
                        <>
                            {/* Tree Explorer Panel — 40% width */}
                            <div className="w-[40%] min-w-[260px] border-r border-border flex flex-col bg-sidebar/50">
                                <div className="p-3 border-b border-border/40 flex-shrink-0">
                                    <h2 className="font-semibold text-sm truncate" title={doc.doc_name}>
                                        Structure
                                    </h2>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {doc.structure.length} top-level sections
                                    </p>
                                </div>
                                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <div className={selectedNode ? "h-1/2 overflow-y-auto" : "flex-1 overflow-y-auto"}>
                                        <TreeExplorer
                                            structure={doc.structure}
                                            className="border-0 bg-transparent h-full"
                                            onNodeSelect={handleNodeSelect}
                                            selectedNodeId={selectedNodeId}
                                        />
                                    </div>
                                    {selectedNode && (
                                        <div className="h-1/2 overflow-y-auto border-t border-border/40">
                                            <NodeDetailPanel
                                                node={selectedNode}
                                                onClose={() => setSelectedNodeId(undefined)}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* PDF Viewer — 60% width */}
                            <div className="w-[60%] min-w-0 h-full">
                                <PdfViewer
                                    ref={pdfRef}
                                    fileUrl={pdfUrl}
                                />
                            </div>
                        </>
                    ) : viewMode === "chat" ? (
                        /* ===== CHAT VIEW: Chat 60% + PDF 40% ===== */
                        <>
                            {/* Chat Interface (left side — 60%) */}
                            <div className="w-[60%] min-w-[300px] h-full border-r border-border bg-background overflow-hidden">
                                <ChatInterface docId={id} onCitationClick={handleCitationClick} />
                            </div>

                            {/* PDF Viewer (right side — 40%) */}
                            <div className="w-[40%] min-w-0 h-full">
                                <PdfViewer
                                    ref={pdfRef}
                                    fileUrl={pdfUrl}
                                />
                            </div>
                        </>
                    ) : (
                        /* ===== ACTIONABLES VIEW: Actionables 55% + PDF 45% ===== */
                        <>
                            {/* Actionables Panel (left side — 55%) */}
                            <div className="w-[55%] min-w-[300px] h-full border-r border-border bg-background overflow-hidden">
                                <ActionablesPanel
                                    docId={id}
                                    onSourceClick={handleActionableSourceClick}
                                />
                            </div>

                            {/* PDF Viewer (right side — 45%) */}
                            <div className="w-[45%] min-w-0 h-full">
                                <PdfViewer
                                    ref={pdfRef}
                                    fileUrl={pdfUrl}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

/* --- Tab Button Component --- */
function TabButton({ active, onClick, icon, label }: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                active
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
        >
            {icon}
            {label}
        </button>
    )
}
