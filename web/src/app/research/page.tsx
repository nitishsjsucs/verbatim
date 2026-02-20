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
    const handleCitationClick = React.useCallback((docId: string, pageNumber: number) => {
        if (pdfDocId === docId) {
            // Same document — just jump
            pdfRef.current?.jumpToPage(pageNumber - 1)
        } else {
            // Different document — load it and queue the page jump
            setPdfDocId(docId)
            setPdfDocName("")  // Will be filled from citation data
            setPendingPage(pageNumber)
            setRightPanel("pdf")
        }
    }, [pdfDocId])

    // Jump to pending page when PdfViewer mounts with a new doc
    React.useEffect(() => {
        if (pendingPage !== null && pdfDocId) {
            // Small delay to let the PDF viewer mount
            const timer = setTimeout(() => {
                pdfRef.current?.jumpToPage(pendingPage - 1)
                setPendingPage(null)
            }, 500)
            return () => clearTimeout(timer)
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
                <div className="flex-[65] min-w-0 border-r border-border/40">
                    <ResearchChat onCitationClick={handleCitationClick} />
                </div>

                {/* Right: Corpus Panel or PDF Viewer (35%) */}
                <div className="flex-[35] min-w-0 flex flex-col">
                    {rightPanel === "pdf" && pdfDocId ? (
                        <>
                            {/* PDF Header */}
                            <div className="h-10 border-b border-border/40 flex items-center px-4 justify-between shrink-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                                    <span className="text-xs font-medium text-muted-foreground truncate">
                                        {pdfDocName || pdfDocId}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setRightPanel("corpus")}
                                        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                                    >
                                        Corpus
                                    </button>
                                    <button
                                        onClick={closePdf}
                                        className="p-1 hover:bg-muted/50 rounded transition-colors"
                                    >
                                        <X className="h-3 w-3 text-muted-foreground" />
                                    </button>
                                </div>
                            </div>
                            {/* PDF Viewer */}
                            <div className="flex-1 min-h-0">
                                <PdfViewer
                                    ref={pdfRef}
                                    fileUrl={`http://localhost:8001/documents/${pdfDocId}/raw`}
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
