"use client"

import * as React from "react"
import { Viewer, Worker, SpecialZoomLevel } from "@react-pdf-viewer/core"
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout"

// Styles
import "@react-pdf-viewer/core/lib/styles/index.css"
import "@react-pdf-viewer/default-layout/lib/styles/index.css"

const WORKER_URL = "https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"

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
        const defaultLayoutPluginInstance = defaultLayoutPlugin()
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

        const rawJumpToPage = defaultLayoutPluginInstance.toolbarPluginInstance
            .pageNavigationPluginInstance.jumpToPage

        React.useImperativeHandle(ref, () => ({
            jumpToPage: (pageIndex: number) => {
                rawJumpToPage(pageIndex)

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
                <Worker workerUrl={WORKER_URL}>
                    <Viewer
                        fileUrl={blobUrl}
                        initialPage={initialPage}
                        defaultScale={SpecialZoomLevel.PageWidth}
                        theme="dark"
                        plugins={[defaultLayoutPluginInstance]}
                    />
                </Worker>
            </div>
        )
    }
)
