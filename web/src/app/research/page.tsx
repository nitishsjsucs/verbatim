"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ResearchChat } from "@/components/views/research-chat"
import { CorpusPanel } from "@/components/views/corpus-panel"
import dynamic from "next/dynamic"
import { Loader2, X, FileText } from "lucide-react"
import { fetchDocuments, API_BASE_URL } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useRouter, useSearchParams } from "next/navigation"
import { RoleRedirect } from "@/components/auth/role-redirect"

// Dynamic import — pdf.js requires browser APIs (no SSR)
const PdfViewer = dynamic(
    () => import("@/components/views/pdf-viewer").then(mod => mod.PdfViewer),
    { ssr: false }
)

type RightPanel = "corpus" | "pdf"

export default function ResearchPage() {
    return (
        <React.Suspense fallback={
            <div className="flex h-screen w-full bg-background items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="animate-pulse">Loading...</span>
            </div>
        }>
            <ResearchPageContent />
        </React.Suspense>
    )
}

function ResearchPageContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const continueConvId = searchParams.get("continue") || null
    // Which right panel to show
    const [rightPanel, setRightPanel] = React.useState<RightPanel>("corpus")

    // PDF viewer state
    const [pdfDocId, setPdfDocId] = React.useState<string | null>(null)
    const [pdfDocName, setPdfDocName] = React.useState<string>("")
    const [pdfJumpPage, setPdfJumpPage] = React.useState<number | undefined>(undefined)
    const [pdfJumpKey, setPdfJumpKey] = React.useState(0)

    // Cache document name → id map for resolving citations with missing doc_id
    const [docNameMap, setDocNameMap] = React.useState<Record<string, string>>({})
    React.useEffect(() => {
        fetchDocuments().then(docs => {
            const map: Record<string, string> = {}
            docs.forEach(d => { map[d.name] = d.id })
            setDocNameMap(map)
        }).catch(() => {})
    }, [])

    // When citation is clicked in chat, load the document's PDF and jump to page
    const handleCitationClick = React.useCallback((docId: string, pageNumber: number, docName?: string) => {
        let resolvedId = docId
        // Resolve empty docId from docName using cached document list
        if (!resolvedId && docName) {
            resolvedId = docNameMap[docName] || ""
            if (!resolvedId) {
                for (const [name, id] of Object.entries(docNameMap)) {
                    if (name.includes(docName) || docName.includes(name)) {
                        resolvedId = id
                        break
                    }
                }
            }
        }
        if (!resolvedId) return

        setPdfDocId(resolvedId)
        setPdfDocName(docName || resolvedId)
        setPdfJumpPage(pageNumber - 1)
        setPdfJumpKey(k => k + 1)
        setRightPanel("pdf")
    }, [docNameMap])

    const handleDocumentClick = React.useCallback((docId: string) => {
        // Navigate to the document detail page
        router.push(`/documents/${docId}`)
    }, [router])

    const closePdf = React.useCallback(() => {
        setRightPanel("corpus")
        setPdfDocId(null)
        setPdfDocName("")
    }, [])

    // Resizable splitter
    const [researchSplit, setResearchSplit] = React.useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("doc_split_research")
            if (saved) return Math.max(15, Math.min(85, Number(saved)))
        }
        return 65
    })
    const researchContainerRef = React.useRef<HTMLDivElement>(null)
    const researchDraggingRef = React.useRef(false)

    const handleSplitMouseDown = React.useCallback(() => {
        researchDraggingRef.current = true
        document.body.style.cursor = "col-resize"
        document.body.style.userSelect = "none"
    }, [])

    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!researchDraggingRef.current || !researchContainerRef.current) return
            const rect = researchContainerRef.current.getBoundingClientRect()
            const pct = ((e.clientX - rect.left) / rect.width) * 100
            const clamped = Math.max(15, Math.min(85, pct))
            setResearchSplit(clamped)
            localStorage.setItem("doc_split_research", String(Math.round(clamped)))
        }
        const onUp = () => {
            if (researchDraggingRef.current) {
                researchDraggingRef.current = false
                document.body.style.cursor = ""
                document.body.style.userSelect = ""
            }
        }
        window.addEventListener("mousemove", onMove)
        window.addEventListener("mouseup", onUp)
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    }, [])

    return (
        <RoleRedirect>
            <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar />
                <main ref={researchContainerRef} className="flex-1 flex overflow-hidden">
                    {/* Left: Research Chat */}
                    <div style={{ width: `${researchSplit}%` }} className="min-w-0 border-r border-border shrink-0">
                        <ResearchChat onCitationClick={handleCitationClick} continueConvId={continueConvId} />
                    </div>

                    {/* Drag Handle */}
                    <div
                        onMouseDown={handleSplitMouseDown}
                        className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors relative group"
                    >
                        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
                    </div>

                    {/* Right: Corpus Panel or PDF Viewer */}
                    <div className="flex-1 min-w-0 flex flex-col">
                        {rightPanel === "pdf" && pdfDocId ? (
                            <>
                                {/* PDF Header */}
                                <div className="h-11 border-b border-border flex items-center px-4 justify-between shrink-0 bg-background">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-xs font-medium text-foreground truncate">
                                            {pdfDocName || pdfDocId}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setRightPanel("corpus")}
                                            className="text-xs-plus text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                                        >
                                            Corpus
                                        </button>
                                        <button
                                            onClick={closePdf}
                                            className="p-1.5 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                {/* PDF Viewer */}
                                <div className="flex-1 min-h-0 overflow-hidden">
                                    <PdfViewer
                                        fileUrl={`${API_BASE_URL}/documents/${pdfDocId}/raw`}
                                        jumpToPage={pdfJumpPage}
                                        jumpKey={pdfJumpKey}
                                    />
                                </div>
                            </>
                        ) : (
                            <CorpusPanel onDocumentClick={handleDocumentClick} />
                        )}
                    </div>
                </main>
            </div>
        </RoleRedirect>
    )
}
