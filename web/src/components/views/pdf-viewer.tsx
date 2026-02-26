"use client"

import * as React from "react"
import * as pdfjsLib from "pdfjs-dist"
import {
    Loader2, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
    ZoomIn, ZoomOut, Download, Maximize, ChevronsLeft, ChevronsRight,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Custom PDF Viewer — built on pdfjs-dist, inspired by react-pdf-viewer source.
// React 19 compatible. Prop-based page navigation (no forwardRef).
// Features: canvas + text layer rendering, toolbar, zoom, page nav,
//           download, virtual scrolling, HiDPI, dark/light theme.
// ---------------------------------------------------------------------------

const WORKER_URL = "https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js"
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL

// Keep type export so existing imports compile (not used at runtime)
export interface PdfViewerHandle {
    jumpToPage: (pageIndex: number) => void
}

export interface PdfViewerProps {
    fileUrl: string
    initialPage?: number
    jumpToPage?: number
    jumpKey?: number
    className?: string
}

// --- Utility functions from react-pdf-viewer source ---

const MAX_CANVAS_SIZE = 4096 * 4096

function floatToRatio(x: number, limit: number): [number, number] {
    if (Math.floor(x) === x) return [x, 1]
    const y = 1 / x
    if (y > limit) return [1, limit]
    if (Math.floor(y) === y) return [1, y]
    const value = x > 1 ? y : x
    let a = 0, b = 1, c = 1, d = 1
    while (true) {
        const numerator = a + c
        const denominator = b + d
        if (denominator > limit) break
        value <= numerator / denominator ? ([c, d] = [numerator, denominator]) : ([a, b] = [numerator, denominator])
    }
    const middle = (a / b + c / d) / 2
    return value < middle ? (value === x ? [a, b] : [b, a]) : value === x ? [c, d] : [d, c]
}

function roundToDivide(a: number, b: number): number {
    const remainder = a % b
    return remainder === 0 ? a : Math.floor(a - remainder)
}

// --- Constants ---

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
const BUFFER_PAGES = 3

// --- Page Component ---

interface PageInfo {
    width: number
    height: number
}

function PdfPage({ doc, pageIndex, scale, isVisible }: {
    doc: pdfjsLib.PDFDocumentProxy
    pageIndex: number
    scale: number
    isVisible: boolean
}) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const textRef = React.useRef<HTMLDivElement>(null)
    const renderTaskRef = React.useRef<pdfjsLib.RenderTask | null>(null)
    const [pageSize, setPageSize] = React.useState<PageInfo | null>(null)

    React.useEffect(() => {
        if (!isVisible) return
        let cancelled = false

        doc.getPage(pageIndex + 1).then(page => {
            if (cancelled) return
            const viewport = page.getViewport({ scale })
            setPageSize({ width: viewport.width, height: viewport.height })

            // --- Canvas layer (from react-pdf-viewer CanvasLayer pattern) ---
            const canvas = canvasRef.current
            if (!canvas) return

            const outputScale = window.devicePixelRatio || 1
            const maxScale = Math.sqrt(MAX_CANVAS_SIZE / (viewport.width * viewport.height))
            const shouldScaleByCSS = outputScale > maxScale
            if (shouldScaleByCSS) {
                canvas.style.transform = "scale(1, 1)"
            } else {
                canvas.style.removeProperty("transform")
            }

            const possibleScale = Math.min(maxScale, outputScale)
            const [xr, yr] = floatToRatio(possibleScale, 8)

            canvas.width = roundToDivide(viewport.width * possibleScale, xr)
            canvas.height = roundToDivide(viewport.height * possibleScale, xr)
            canvas.style.width = `${roundToDivide(viewport.width, yr)}px`
            canvas.style.height = `${roundToDivide(viewport.height, yr)}px`

            const ctx = canvas.getContext("2d", { alpha: false })
            if (!ctx) return

            if (renderTaskRef.current) {
                renderTaskRef.current.cancel()
            }

            const transform = (shouldScaleByCSS || outputScale !== 1)
                ? [possibleScale, 0, 0, possibleScale, 0, 0] as [number, number, number, number, number, number]
                : undefined

            renderTaskRef.current = page.render({ canvasContext: ctx, viewport, transform })
            renderTaskRef.current.promise.then(() => {
                if (cancelled) return
                // --- Text layer (from react-pdf-viewer TextLayer pattern) ---
                const textContainer = textRef.current
                if (!textContainer) return
                // Clear previous text layer children
                while (textContainer.firstChild) textContainer.removeChild(textContainer.firstChild)
                textContainer.style.setProperty("--scale-factor", `${scale}`)

                page.getTextContent().then(textContent => {
                    if (cancelled || !textContainer) return
                    // pdfjs-dist 3.x uses the TextLayer class
                    const textLayer = new (pdfjsLib as any).TextLayer({
                        textContentSource: textContent,
                        container: textContainer,
                        viewport,
                    })
                    textLayer.render().catch(() => { /* cancelled */ })
                })
            }).catch(() => { /* render cancelled */ })
        })

        return () => {
            cancelled = true
            renderTaskRef.current?.cancel()
        }
    }, [doc, pageIndex, scale, isVisible])

    // Get page size for placeholder even when not visible
    React.useEffect(() => {
        if (pageSize) return
        doc.getPage(pageIndex + 1).then(page => {
            const vp = page.getViewport({ scale })
            setPageSize({ width: vp.width, height: vp.height })
        })
    }, [doc, pageIndex, scale, pageSize])

    const w = pageSize?.width ?? 0
    const h = pageSize?.height ?? 0

    return (
        <div
            data-page-index={pageIndex}
            className="rpv-page"
            style={{
                width: w ? `${w}px` : "100%",
                height: h ? `${h}px` : "800px",
                position: "relative",
                marginBottom: 8,
                background: "var(--rpv-page-bg, #fff)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)",
            }}
        >
            {isVisible ? (
                <>
                    <canvas
                        ref={canvasRef}
                        style={{ display: "block", position: "absolute", top: 0, left: 0 }}
                    />
                    <div
                        ref={textRef}
                        className="textLayer"
                        style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: `${w}px`,
                            height: `${h}px`,
                            overflow: "hidden",
                            opacity: 0.25,
                            lineHeight: 1,
                        }}
                    />
                </>
            ) : (
                <div style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#aaa",
                    fontSize: 12,
                }}>
                    Page {pageIndex + 1}
                </div>
            )}
        </div>
    )
}

// --- Toolbar Component ---

function Toolbar({ currentPage, numPages, scale, onPageChange, onZoom, onDownload, onFullscreen }: {
    currentPage: number
    numPages: number
    scale: number
    onPageChange: (page: number) => void
    onZoom: (scale: number) => void
    onDownload: () => void
    onFullscreen: () => void
}) {
    const [inputValue, setInputValue] = React.useState(String(currentPage + 1))

    React.useEffect(() => {
        setInputValue(String(currentPage + 1))
    }, [currentPage])

    const handleInputSubmit = () => {
        const p = parseInt(inputValue, 10)
        if (!isNaN(p) && p >= 1 && p <= numPages) {
            onPageChange(p - 1)
        } else {
            setInputValue(String(currentPage + 1))
        }
    }

    const zoomIn = () => {
        const next = ZOOM_LEVELS.find(z => z > scale + 0.01)
        if (next) onZoom(next)
    }
    const zoomOut = () => {
        const prev = [...ZOOM_LEVELS].reverse().find(z => z < scale - 0.01)
        if (prev) onZoom(prev)
    }

    const btnClass = "rpv-btn"
    const sepClass = "rpv-sep"

    return (
        <div className="rpv-toolbar">
            {/* Page navigation */}
            <button className={btnClass} onClick={() => onPageChange(0)} disabled={currentPage === 0} title="First page">
                <ChevronsLeft size={16} />
            </button>
            <button className={btnClass} onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0} title="Previous page">
                <ChevronLeft size={16} />
            </button>
            <div className="rpv-page-input">
                <input
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleInputSubmit()}
                    onBlur={handleInputSubmit}
                />
                <span>/ {numPages}</span>
            </div>
            <button className={btnClass} onClick={() => onPageChange(Math.min(numPages - 1, currentPage + 1))} disabled={currentPage >= numPages - 1} title="Next page">
                <ChevronRight size={16} />
            </button>
            <button className={btnClass} onClick={() => onPageChange(numPages - 1)} disabled={currentPage >= numPages - 1} title="Last page">
                <ChevronsRight size={16} />
            </button>

            <div className={sepClass} />

            {/* Zoom */}
            <button className={btnClass} onClick={zoomOut} disabled={scale <= ZOOM_LEVELS[0]} title="Zoom out">
                <ZoomOut size={16} />
            </button>
            <span className="rpv-zoom-label">{Math.round(scale * 100)}%</span>
            <button className={btnClass} onClick={zoomIn} disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} title="Zoom in">
                <ZoomIn size={16} />
            </button>

            <div className={sepClass} />

            {/* Actions */}
            <button className={btnClass} onClick={onDownload} title="Download">
                <Download size={16} />
            </button>
            <button className={btnClass} onClick={onFullscreen} title="Full screen">
                <Maximize size={16} />
            </button>
        </div>
    )
}

// --- Main PdfViewer Component ---

export function PdfViewer({ fileUrl, initialPage = 0, jumpToPage: jumpPage, jumpKey, className }: PdfViewerProps) {
    const [pdfDoc, setPdfDoc] = React.useState<pdfjsLib.PDFDocumentProxy | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [scale, setScale] = React.useState(1.0)
    const [currentPage, setCurrentPage] = React.useState(initialPage)
    const [visiblePages, setVisiblePages] = React.useState<Set<number>>(new Set())
    const scrollContainerRef = React.useRef<HTMLDivElement>(null)
    const rootRef = React.useRef<HTMLDivElement>(null)
    const blobUrlRef = React.useRef<string | null>(null)

    // Load PDF document
    React.useEffect(() => {
        if (!fileUrl) return
        let cancelled = false
        setError(null)
        setLoading(true)
        setPdfDoc(null)

        // Revoke old blob
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = null
        }

        fetch(fileUrl, { headers: { "ngrok-skip-browser-warning": "1" } })
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return r.arrayBuffer()
            })
            .then(data => {
                if (cancelled) return
                return pdfjsLib.getDocument({ data }).promise
            })
            .then(doc => {
                if (cancelled || !doc) return
                setPdfDoc(doc)
                setLoading(false)
                setCurrentPage(initialPage)
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err?.message || "Failed to load PDF")
                    setLoading(false)
                }
            })

        return () => { cancelled = true }
    }, [fileUrl])

    // Calculate fit-to-width scale on mount and resize
    React.useEffect(() => {
        if (!pdfDoc || !scrollContainerRef.current) return

        const calculateFitScale = () => {
            const containerWidth = scrollContainerRef.current?.clientWidth
            if (!containerWidth) return

            pdfDoc.getPage(1).then(page => {
                const vp = page.getViewport({ scale: 1.0 })
                const fitScale = (containerWidth - 40) / vp.width // 40px padding
                const clamped = Math.max(0.5, Math.min(3.0, fitScale))
                setScale(clamped)
            })
        }

        calculateFitScale()
        const observer = new ResizeObserver(calculateFitScale)
        observer.observe(scrollContainerRef.current)
        return () => observer.disconnect()
    }, [pdfDoc])

    // Determine which pages are visible (virtual scrolling)
    React.useEffect(() => {
        const container = scrollContainerRef.current
        if (!container || !pdfDoc) return

        const handleScroll = () => {
            const pages = container.querySelectorAll<HTMLElement>(".rpv-page")
            const containerRect = container.getBoundingClientRect()
            const visible = new Set<number>()
            let closestPage = 0
            let closestDist = Infinity

            pages.forEach(pageEl => {
                const idx = parseInt(pageEl.dataset.pageIndex || "0", 10)
                const rect = pageEl.getBoundingClientRect()
                const isInView = rect.bottom > containerRect.top - 500 && rect.top < containerRect.bottom + 500

                if (isInView) {
                    visible.add(idx)
                    // Buffer pages
                    for (let b = 1; b <= BUFFER_PAGES; b++) {
                        if (idx - b >= 0) visible.add(idx - b)
                        if (idx + b < pdfDoc.numPages) visible.add(idx + b)
                    }
                }

                // Track current page (most visible)
                const overlap = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top)
                if (overlap > 0) {
                    const dist = Math.abs(rect.top - containerRect.top)
                    if (dist < closestDist) {
                        closestDist = dist
                        closestPage = idx
                    }
                }
            })

            setVisiblePages(prev => {
                if (prev.size === visible.size && [...visible].every(v => prev.has(v))) return prev
                return visible
            })
            setCurrentPage(closestPage)
        }

        handleScroll()
        container.addEventListener("scroll", handleScroll, { passive: true })
        return () => container.removeEventListener("scroll", handleScroll)
    }, [pdfDoc, scale])

    // Jump to page via props
    React.useEffect(() => {
        if (jumpPage == null || !pdfDoc || !scrollContainerRef.current) return

        // Wait a tick for pages to be laid out
        requestAnimationFrame(() => {
            const container = scrollContainerRef.current
            if (!container) return
            const targetEl = container.querySelector<HTMLElement>(`[data-page-index="${jumpPage}"]`)
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: "smooth", block: "start" })
            }
        })
    }, [jumpPage, jumpKey, pdfDoc, scale])

    // Handle page change from toolbar
    const handlePageChange = React.useCallback((pageIndex: number) => {
        const container = scrollContainerRef.current
        if (!container) return
        const targetEl = container.querySelector<HTMLElement>(`[data-page-index="${pageIndex}"]`)
        if (targetEl) {
            targetEl.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        setCurrentPage(pageIndex)
    }, [])

    // Download
    const handleDownload = React.useCallback(() => {
        if (!fileUrl) return
        const a = document.createElement("a")
        a.href = fileUrl
        a.download = "document.pdf"
        a.click()
    }, [fileUrl])

    // Fullscreen
    const handleFullscreen = React.useCallback(() => {
        rootRef.current?.requestFullscreen?.()
    }, [])

    // Error state
    if (error) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#888", fontSize: 13, padding: 24, textAlign: "center" }}>
                <AlertCircle style={{ width: 24, height: 24, color: "#ef4444" }} />
                <p>Failed to load PDF</p>
                <p style={{ fontSize: 11, opacity: 0.6 }}>{error}</p>
                <button
                    onClick={() => { setError(null); setLoading(true) }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", cursor: "pointer", fontSize: 12 }}
                >
                    <RefreshCw style={{ width: 14, height: 14 }} /> Retry
                </button>
            </div>
        )
    }

    // Loading state
    if (loading || !pdfDoc) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading PDF…
            </div>
        )
    }

    return (
        <div ref={rootRef} className={className} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <style>{`
                .rpv-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                    padding: 4px 8px;
                    border-bottom: 1px solid var(--rpv-border, hsl(var(--border, 220 13% 91%)));
                    background: var(--rpv-toolbar-bg, hsl(var(--background, 0 0% 100%)));
                    flex-shrink: 0;
                    min-height: 40px;
                    user-select: none;
                }
                .rpv-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border: none;
                    border-radius: 6px;
                    background: transparent;
                    color: var(--rpv-icon, hsl(var(--foreground, 0 0% 9%)));
                    cursor: pointer;
                    transition: background 0.15s;
                }
                .rpv-btn:hover:not(:disabled) { background: hsl(var(--muted, 220 14% 96%)); }
                .rpv-btn:disabled { opacity: 0.3; cursor: default; }
                .rpv-sep {
                    width: 1px;
                    height: 20px;
                    margin: 0 4px;
                    background: var(--rpv-border, hsl(var(--border, 220 13% 91%)));
                }
                .rpv-page-input {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 13px;
                    color: var(--rpv-icon, hsl(var(--foreground, 0 0% 9%)));
                }
                .rpv-page-input input {
                    width: 40px;
                    height: 28px;
                    border: 1px solid var(--rpv-border, hsl(var(--border, 220 13% 91%)));
                    border-radius: 4px;
                    text-align: center;
                    font-size: 13px;
                    background: transparent;
                    color: inherit;
                    outline: none;
                }
                .rpv-page-input input:focus { border-color: hsl(var(--primary, 221 83% 53%)); }
                .rpv-page-input span { font-size: 12px; opacity: 0.6; }
                .rpv-zoom-label {
                    font-size: 12px;
                    min-width: 44px;
                    text-align: center;
                    color: var(--rpv-icon, hsl(var(--foreground, 0 0% 9%)));
                }
                .rpv-scroll-container {
                    flex: 1;
                    overflow: auto;
                    background: var(--rpv-container-bg, hsl(var(--muted, 220 14% 96%)));
                }
                .rpv-pages {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 16px 0;
                }
                .rpv-page {
                    --rpv-page-bg: #fff;
                }
                :root.dark .rpv-scroll-container, .dark .rpv-scroll-container {
                    background: hsl(var(--muted, 220 14% 10%));
                }
                :root.dark .rpv-page, .dark .rpv-page {
                    --rpv-page-bg: hsl(0 0% 15%);
                    filter: invert(0.88) hue-rotate(180deg);
                }
                .textLayer { pointer-events: all; }
                .textLayer span { position: absolute; white-space: pre; color: transparent; font-size: 1px; }
                .textLayer span::selection { background: rgba(0, 0, 255, 0.3); }
            `}</style>

            <Toolbar
                currentPage={currentPage}
                numPages={pdfDoc.numPages}
                scale={scale}
                onPageChange={handlePageChange}
                onZoom={setScale}
                onDownload={handleDownload}
                onFullscreen={handleFullscreen}
            />

            <div ref={scrollContainerRef} className="rpv-scroll-container">
                <div className="rpv-pages">
                    {Array.from({ length: pdfDoc.numPages }, (_, i) => (
                        <PdfPage
                            key={i}
                            doc={pdfDoc}
                            pageIndex={i}
                            scale={scale}
                            isVisible={visiblePages.has(i)}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}
