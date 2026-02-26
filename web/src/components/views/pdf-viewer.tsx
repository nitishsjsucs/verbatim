"use client"

import * as React from "react"
import { Viewer, Worker, SpecialZoomLevel } from "@react-pdf-viewer/core"
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout"
import type { ToolbarSlot, TransformToolbarSlot } from "@react-pdf-viewer/toolbar"
import { AlertCircle, RefreshCw } from "lucide-react"

// Styles
import "@react-pdf-viewer/core/lib/styles/index.css"
import "@react-pdf-viewer/default-layout/lib/styles/index.css"

const WORKER_URL = "https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"

// Error boundary to catch React 19 compatibility issues with @react-pdf-viewer
class PdfErrorBoundary extends React.Component<
    { children: React.ReactNode; onRetry?: () => void },
    { hasError: boolean; error?: Error }
> {
    constructor(props: { children: React.ReactNode; onRetry?: () => void }) {
        super(props)
        this.state = { hasError: false }
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error }
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#888", fontSize: 13, padding: 24, textAlign: "center" }}>
                    <AlertCircle style={{ width: 24, height: 24, color: "#ef4444" }} />
                    <p>PDF viewer failed to load</p>
                    <p style={{ fontSize: 11, opacity: 0.6 }}>{this.state.error?.message}</p>
                    <button
                        onClick={() => { this.setState({ hasError: false, error: undefined }); this.props.onRetry?.() }}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", cursor: "pointer", fontSize: 12 }}
                    >
                        <RefreshCw style={{ width: 14, height: 14 }} /> Retry
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}

export interface PdfViewerHandle {
    jumpToPage: (pageIndex: number) => void
}

interface PdfViewerProps {
    fileUrl: string
    initialPage?: number
    className?: string
}

export const PdfViewer = React.forwardRef<PdfViewerHandle, PdfViewerProps>(
    function PdfViewer({ fileUrl, initialPage = 0, className }, ref) {
        const containerRef = React.useRef<HTMLDivElement>(null)
        const transform: TransformToolbarSlot = (slot: ToolbarSlot) => {
            // Remove: Open, Print, and "More actions" (properties) buttons
            const { Open, Print, ShowProperties, ...rest } = slot
            return {
                ...rest,
                Open: () => <></>,
                Print: () => <></>,
                ShowProperties: () => <></>,
            }
        }
        const defaultLayoutPluginInstance = defaultLayoutPlugin({
            // Remove sidebar tabs: thumbnails, bookmarks, attachments
            sidebarTabs: () => [],
            renderToolbar: (Toolbar) => (
                <Toolbar>{(slots: ToolbarSlot) => {
                    const transformed = transform(slots)
                    const {
                        CurrentPageInput, GoToNextPage, GoToPreviousPage, NumberOfPages,
                        EnterFullScreen, Download, Zoom, ZoomIn, ZoomOut,
                        Search, GoToFirstPage, GoToLastPage,
                    } = transformed
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <GoToFirstPage /><GoToPreviousPage />
                                <CurrentPageInput /> / <NumberOfPages />
                                <GoToNextPage /><GoToLastPage />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <ZoomOut /><Zoom /><ZoomIn />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Search /><Download /><EnterFullScreen />
                            </div>
                        </div>
                    )
                }}</Toolbar>
            ),
        })
        const [blobUrl, setBlobUrl] = React.useState<string | null>(null)

        React.useEffect(() => {
            if (!fileUrl) return
            let objectUrl: string
            fetch(fileUrl, { headers: { 'ngrok-skip-browser-warning': '1' } })
                .then(r => r.blob())
                .then(blob => {
                    objectUrl = URL.createObjectURL(blob)
                    setBlobUrl(objectUrl)
                })
                .catch(console.error)
            return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
        }, [fileUrl])

        const [pdfTheme, setPdfTheme] = React.useState<"dark" | "light">("dark")

        React.useEffect(() => {
            const check = () => setPdfTheme(document.documentElement.classList.contains("dark") ? "dark" : "light")
            check()
            const observer = new MutationObserver(check)
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
            return () => observer.disconnect()
        }, [])

        const rawJumpToPage = defaultLayoutPluginInstance.toolbarPluginInstance
            .pageNavigationPluginInstance.jumpToPage

        React.useImperativeHandle(ref, () => ({
            jumpToPage: (pageIndex: number) => {
                try {
                    if (typeof rawJumpToPage === "function") {
                        rawJumpToPage(pageIndex)
                    }
                } catch (err) {
                    console.warn("jumpToPage failed:", err)
                    return
                }

                // Poll until the target page element is in the DOM, then scroll to center it.
                // This is more reliable than a fixed timeout.
                let attempts = 0
                const poll = setInterval(() => {
                    attempts++
                    if (attempts > 30) { // give up after 3s
                        clearInterval(poll)
                        return
                    }
                    if (!containerRef.current) return

                    // Find the rendered page layer for the target page
                    const pageEl = containerRef.current.querySelector(
                        `[data-testid="core__page-layer-${pageIndex}"]`
                    ) as HTMLElement | null

                    if (!pageEl) return // page not rendered yet, keep polling

                    clearInterval(poll)

                    // Find the scroll container
                    const viewport = containerRef.current.querySelector(
                        '[data-testid="core__inner-pages"]'
                    ) as HTMLElement | null

                    if (!viewport) return

                    // Calculate scroll position to center the page in the viewport
                    const pageRect = pageEl.getBoundingClientRect()
                    const viewportRect = viewport.getBoundingClientRect()
                    const currentScroll = viewport.scrollTop
                    const pageTopRelative = pageRect.top - viewportRect.top + currentScroll
                    // Center: put the top of the page ~20% from top of viewport
                    const targetScroll = pageTopRelative - (viewportRect.height * 0.15)

                    viewport.scrollTo({
                        top: Math.max(0, targetScroll),
                        behavior: "smooth",
                    })
                }, 100)
            },
        }), [rawJumpToPage])

        if (!blobUrl) return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
                Loading PDF…
            </div>
        )

        return (
            <div ref={containerRef} className={className} style={{ height: "100%", width: "100%" }}>
                <PdfErrorBoundary onRetry={() => setBlobUrl(null)}>
                    <Worker workerUrl={WORKER_URL}>
                        <Viewer
                            fileUrl={blobUrl}
                            initialPage={initialPage}
                            defaultScale={SpecialZoomLevel.PageWidth}
                            theme={pdfTheme}
                            plugins={[defaultLayoutPluginInstance]}
                        />
                    </Worker>
                </PdfErrorBoundary>
            </div>
        )
    }
)
