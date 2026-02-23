"use client"

import * as React from "react"
import { Sidebar } from "@/components/layout/sidebar"
import { ResearchChat } from "@/components/views/research-chat"
import { CorpusPanel } from "@/components/views/corpus-panel"
import dynamic from "next/dynamic"
import type { PdfViewerHandle } from "@/components/views/pdf-viewer"
import { Loader2, X, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

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

type RightPanel = "corpus" | "pdf"

export default function ResearchPage() {
    const router = useRouter()
    const pdfRef = React.useRef<PdfViewerHandle>(null)

    // Which right panel to show
    const [rightPanel, setRightPanel] = React.useState<RightPanel>("corpus")

    // PDF viewer state
    const [pdfDocId, setPdfDocId] = React.useState<string | null>(null)
    const [pdfDocName, setPdfDocName] = React.useState<string>("")
    const [pendingPage, setPendingPage] = React.useState<number | null>(null)

    // When citation is clicked in chat, load the document's PDF and jump to page
    const handleCitationClick = React.useCallback((docId: string, pageNumber: number, docName?: string) => {
        if (pdfDocId === docId) {
            // Same document — just jump
            pdfRef.current?.jumpToPage(pageNumber - 1)
            setRightPanel("pdf")
        } else {
            // Different document — load it and queue the page jump
            setPdfDocId(docId)
            setPdfDocName(docName || docId)
            setPendingPage(pageNumber)
            setRightPanel("pdf")
        }
    }, [pdfDocId])

    // Jump to pending page when PdfViewer mounts with a new doc
    React.useEffect(() => {
        if (pendingPage !== null && pdfDocId) {
            // Retry jumping until the PDF is ready (blob fetch + render takes time)
            let attempts = 0
            const interval = setInterval(() => {
                attempts++
                if (pdfRef.current) {
                    pdfRef.current.jumpToPage(pendingPage - 1)
                }
                if (attempts >= 20) {
                    clearInterval(interval)
                    setPendingPage(null)
                }
            }, 300)
            return () => clearInterval(interval)
        }
    }, [pendingPage, pdfDocId])

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
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar />
            <main className="flex-1 flex overflow-hidden">
                {/* Left: Research Chat (65%) */}
                <div className="flex-[65] min-w-0 border-r border-border">
                    <ResearchChat onCitationClick={handleCitationClick} />
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
                                    ref={pdfRef}
                                    fileUrl={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001'}/documents/${pdfDocId}/raw`}
                                />
                            </div>
                        </>
                    ) : (
                        <CorpusPanel onDocumentClick={handleDocumentClick} />
                    )}
                </div>
            </main>
        </div>
    )
}
