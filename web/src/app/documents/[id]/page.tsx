"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ChatInterface } from "@/components/views/chat-interface"
import { TreeExplorer } from "@/components/views/tree-explorer"
import { NodeDetailPanel } from "@/components/views/node-detail-panel"
import dynamic from "next/dynamic"
import { fetchDocument, API_BASE_URL } from "@/lib/api"
import { DocumentDetail, TreeNode } from "@/lib/types"
import { Loader2, AlertCircle, FileText, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import { RoleRedirect } from "@/components/auth/role-redirect"
import { useSearchParams } from "next/navigation"

// Dynamic import — pdf.js requires browser APIs (no SSR)
const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
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

type ViewMode = "document" | "chat"

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
    return (
        <React.Suspense fallback={
            <div className="flex h-screen w-full bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="animate-pulse">Loading...</span>
            </div>
        }>
            <DocumentPageContent params={params} />
        </React.Suspense>
    )
}

function DocumentPageContent({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params)

    const [doc, setDoc] = React.useState<DocumentDetail | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)
    const [selectedNodeId, setSelectedNodeId] = React.useState<string | undefined>()
    const searchParams = useSearchParams()
    const initialTab = searchParams.get("tab") === "chat" ? "chat" : "document"
    const continueConvId = searchParams.get("continue") || null
    const [viewMode, setViewMode] = React.useState<ViewMode>(initialTab)

    // Prop-based page navigation for PdfViewer (ref forwarding broken with dynamic + React 19)
    const [pdfJumpPage, setPdfJumpPage] = React.useState<number | undefined>(undefined)
    const [pdfJumpKey, setPdfJumpKey] = React.useState(0)

    // Resizable panels — left panel width as percentage (persisted per view mode)
    const [docSplit, setDocSplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_doc")
            if (saved) return Math.max(15, Math.min(85, Number(saved)))
        }
        return 40
    })
    const [chatSplit, setChatSplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_chat")
            if (saved) return Math.max(15, Math.min(85, Number(saved)))
        }
        return 60
    })
    const containerRef = React.useRef<HTMLDivElement>(null)
    const draggingRef = React.useRef<"doc" | "chat" | null>(null)

    // Vertical resizable partition for tree/node-detail split
    const [vertSplit, setVertSplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_vert")
            if (saved) return Math.max(20, Math.min(80, Number(saved)))
        }
        return 50
    })
    const vertContainerRef = React.useRef<HTMLDivElement>(null)
    const vertDraggingRef = React.useRef(false)

    const handleMouseDown = React.useCallback((mode: "doc" | "chat") => {
        draggingRef.current = mode
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }, [])

    const handleVertMouseDown = React.useCallback(() => {
        vertDraggingRef.current = true
        document.body.style.cursor = "row-resize"
        document.body.style.userSelect = "none"
    }, [])

    React.useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (draggingRef.current && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                const pct = ((e.clientX - rect.left) / rect.width) * 100
                const clamped = Math.max(15, Math.min(85, pct))
                if (draggingRef.current === "doc") {
                    setDocSplit(clamped)
                    localStorage.setItem("doc_split_doc", String(Math.round(clamped)))
                } else {
                    setChatSplit(clamped)
                    localStorage.setItem("doc_split_chat", String(Math.round(clamped)))
                }
            }
            if (vertDraggingRef.current && vertContainerRef.current) {
                const rect = vertContainerRef.current.getBoundingClientRect()
                const pct = ((e.clientY - rect.top) / rect.height) * 100
                const clamped = Math.max(20, Math.min(80, pct))
                setVertSplit(clamped)
                localStorage.setItem("doc_split_vert", String(Math.round(clamped)))
            }
        }
        const handleMouseUp = () => {
            if (draggingRef.current) {
                draggingRef.current = null
                document.body.style.cursor = ""
                document.body.style.userSelect = ""
            }
            if (vertDraggingRef.current) {
                vertDraggingRef.current = false
                document.body.style.cursor = ""
                document.body.style.userSelect = ""
            }
        }
        window.addEventListener("mousemove", handleMouseMove)
        window.addEventListener("mouseup", handleMouseUp)
        return () => {
            window.removeEventListener("mousemove", handleMouseMove)
            window.removeEventListener("mouseup", handleMouseUp)
        }
    }, [])

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
        if (node.start_page >= 1) {
            setPdfJumpPage(node.start_page - 1)
            setPdfJumpKey(k => k + 1)
        }
    }, [])

    const handleCitationClick = React.useCallback((pageNumber: number) => {
        if (pageNumber >= 1) {
            setPdfJumpPage(pageNumber - 1)
            setPdfJumpKey(k => k + 1)
        }
    }, [])

    const pdfUrl = `${API_BASE_URL}/documents/${id}/raw`

    if (loading) {
        return (
            <RoleRedirect>
            <div className="flex h-screen w-full bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="animate-pulse">Loading...</span>
            </div>
            </RoleRedirect>
        )
    }

    if (error || !doc) {
        return (
            <RoleRedirect>
            <div className="flex h-screen w-full bg-background items-center justify-center text-destructive flex-col gap-2">
                <AlertCircle className="h-8 w-8" />
                <p className="font-medium">{error || "Document not found"}</p>
            </div>
            </RoleRedirect>
        )
    }

    return (
        <RoleRedirect>
        <div className="flex bg-background h-screen w-full overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                {/* Tab Bar */}
                <div className="h-11 border-b border-border flex items-center px-4 bg-background flex-shrink-0">
                    <div className="flex items-center gap-0 h-full">
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
                    </div>
                    <div className="flex-1" />
                    <div className="text-xs text-muted-foreground/40 font-medium truncate" title={doc.doc_name}>
                        {doc.doc_name} &middot; {doc.total_pages}p
                    </div>
                </div>

                {/* Content Area */}
                <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0">
                    {viewMode === "document" ? (
                        /* ===== DOCUMENT VIEW: Tree + PDF ===== */
                        <>
                            {/* Tree Explorer Panel — resizable */}
                            <div style={{ width: `${docSplit}%` }} className="min-w-0 border-r border-border flex flex-col bg-sidebar/50 shrink-0">
                                <div className="p-3 border-b border-border/40 flex-shrink-0">
                                    <h2 className="font-semibold text-xs truncate" title={doc.doc_name}>
                                        Document Structure
                                    </h2>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {doc.structure.length} top-level sections
                                    </p>
                                </div>
                                <div ref={vertContainerRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <div style={selectedNode ? { height: `${vertSplit}%` } : undefined} className={selectedNode ? "overflow-y-auto shrink-0" : "flex-1 overflow-y-auto"}>
                                        <TreeExplorer
                                            structure={doc.structure}
                                            className="border-0 bg-transparent h-full"
                                            onNodeSelect={handleNodeSelect}
                                            selectedNodeId={selectedNodeId}
                                        />
                                    </div>
                                    {selectedNode && (
                                        <>
                                            <div
                                                onMouseDown={handleVertMouseDown}
                                                className="h-1 shrink-0 cursor-row-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                                            >
                                                <div className="absolute inset-x-0 -top-1 -bottom-1 group-hover:bg-primary/10" />
                                            </div>
                                            <div className="flex-1 overflow-y-auto">
                                                <NodeDetailPanel
                                                    node={selectedNode}
                                                    onClose={() => setSelectedNodeId(undefined)}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Drag Handle */}
                            <div
                                onMouseDown={() => handleMouseDown("doc")}
                                className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                            >
                                <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
                            </div>

                            {/* PDF Viewer — fills remaining */}
                            <div className="flex-1 min-w-0 h-full">
                                <PdfViewer
                                    fileUrl={pdfUrl}
                                    jumpToPage={pdfJumpPage}
                                    jumpKey={pdfJumpKey}
                                />
                            </div>
                        </>
                    ) : (
                        /* ===== CHAT VIEW: Chat + PDF ===== */
                        <>
                            {/* Chat Interface — resizable */}
                            <div style={{ width: `${chatSplit}%` }} className="min-w-0 h-full border-r border-border bg-background overflow-hidden shrink-0">
                                <ChatInterface docId={id} onCitationClick={handleCitationClick} continueConvId={continueConvId} />
                            </div>

                            {/* Drag Handle */}
                            <div
                                onMouseDown={() => handleMouseDown("chat")}
                                className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                            >
                                <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
                            </div>

                            {/* PDF Viewer — fills remaining */}
                            <div className="flex-1 min-w-0 h-full">
                                <PdfViewer
                                    fileUrl={pdfUrl}
                                    jumpToPage={pdfJumpPage}
                                    jumpKey={pdfJumpKey}
                                />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
        </RoleRedirect>
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
                "relative flex items-center gap-1.5 px-3 h-full text-xs font-medium transition-colors border-b-2",
                active
                    ? "text-foreground border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:border-border"
            )}
        >
            {icon}
            {label}
        </button>
    )
}
