"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ResearchChat } from "@/components/views/research-chat"
import { CorpusPanel } from "@/components/views/corpus-panel"
import dynamic from "next/dynamic"
import { Loader2, X, FileText } from "lucide-react"
import { fetchDocuments } from "@/lib/api"
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

    return (
        <RoleRedirect>
            <div className="flex h-screen overflow-hidden bg-background">
                <Sidebar />
                <main className="flex-1 flex overflow-hidden">
                    {/* Left: Research Chat (65%) */}
                    <div className="flex-[65] min-w-0 border-r border-border">
                        <ResearchChat onCitationClick={handleCitationClick} continueConvId={continueConvId} />
                    </div>

                    {/* Right: Corpus Panel or PDF Viewer (35%) */}
                    <div className="flex-[35] min-w-0 flex flex-col">
                        {rightPanel === "pdf" && pdfDocId ? (
                            <>
                                {/* PDF Header */}
                                <div className="h-11 border-b border-border flex items-center px-4 justify-between shrink-0 bg-background">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-[12px] font-medium text-foreground truncate">
                                            {pdfDocName || pdfDocId}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setRightPanel("corpus")}
                                            className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
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
                                        fileUrl={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/documents/${pdfDocId}/raw`}
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
