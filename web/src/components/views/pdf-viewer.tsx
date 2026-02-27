"use client"

import * as React from "react"
import * as pdfjsLib from "pdfjs-dist"
import {
    Loader2, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
    ZoomIn, ZoomOut, Download, Maximize, ChevronsLeft, ChevronsRight,
} from "lucide-react"

// ---------------------------------------------------------------------------
// Custom PDF Viewer — built on pdfjs-dist, React 19 compatible.
// Perf optimisations: in-memory doc cache, local worker, lazy page sizing,
// true virtualisation (only visible+buffer pages in DOM), throttled scroll.
// ---------------------------------------------------------------------------

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js"

// Keep type export so existing imports compile
export interface PdfViewerHandle { jumpToPage: (pageIndex: number) => void }

export interface PdfViewerProps {
    fileUrl: string
    initialPage?: number
    jumpToPage?: number
    jumpKey?: number
    className?: string
}

// --- In-memory PDF document cache (survives re-mounts, keyed by URL) ---
const docCache = new Map<string, { doc: pdfjsLib.PDFDocumentProxy; data: ArrayBuffer }>()
const MAX_CACHE = 5

function urlTag(url: string) { return url.split('/').pop()?.slice(0, 12) || url }

async function loadPdfDoc(url: string): Promise<pdfjsLib.PDFDocumentProxy> {
    const tag = urlTag(url)
    const cached = docCache.get(url)
    if (cached) {
        // Verify the proxy is still alive by trying getPage
        try {
            await cached.doc.getPage(1)
            console.log(`[PDF:${tag}] cache HIT — proxy alive, ${cached.doc.numPages} pages`)
            return cached.doc
        } catch (e) {
            console.warn(`[PDF:${tag}] cache HIT but proxy DEAD:`, e)
            // Proxy destroyed / stale — rebuild from stored ArrayBuffer
            try {
                const doc = await pdfjsLib.getDocument({ data: cached.data.slice(0) }).promise
                docCache.set(url, { doc, data: cached.data })
                console.log(`[PDF:${tag}] rebuilt proxy from ArrayBuffer, ${doc.numPages} pages`)
                return doc
            } catch (e2) {
                console.error(`[PDF:${tag}] rebuild FAILED, will re-fetch:`, e2)
                docCache.delete(url) // corrupted, re-fetch
            }
        }
    } else {
        console.log(`[PDF:${tag}] cache MISS — fetching from network`)
    }

    const res = await fetch(url, { headers: { "ngrok-skip-browser-warning": "1" } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.arrayBuffer()
    console.log(`[PDF:${tag}] fetched ${(data.byteLength / 1024).toFixed(0)}KB`)
    const doc = await pdfjsLib.getDocument({ data: data.slice(0) }).promise
    docCache.set(url, { doc, data })
    console.log(`[PDF:${tag}] loaded ${doc.numPages} pages, cache size=${docCache.size}`)
    // Evict oldest if cache grows too large
    if (docCache.size > MAX_CACHE) {
        const oldest = docCache.keys().next().value
        if (oldest && oldest !== url) {
            const old = docCache.get(oldest)
            old?.doc.destroy().catch(() => {})
            docCache.delete(oldest)
            console.log(`[PDF] evicted oldest cache entry: ${urlTag(oldest)}`)
        }
    }
    return doc
}

// --- Utility ---
const MAX_CANVAS_SIZE = 4096 * 4096

function floatToRatio(x: number, limit: number): [number, number] {
    if (Math.floor(x) === x) return [x, 1]
    const y = 1 / x
    if (y > limit) return [1, limit]
    if (Math.floor(y) === y) return [1, y]
    const value = x > 1 ? y : x
    let a = 0, b = 1, c = 1, d = 1
    while (true) {
        const n = a + c, den = b + d
        if (den > limit) break
        value <= n / den ? ([c, d] = [n, den]) : ([a, b] = [n, den])
    }
    const mid = (a / b + c / d) / 2
    return value < mid ? (value === x ? [a, b] : [b, a]) : value === x ? [c, d] : [d, c]
}

function roundToDivide(a: number, b: number): number {
    const r = a % b; return r === 0 ? a : Math.floor(a - r)
}

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]
const BUFFER = 2
const PAGE_GAP = 8

// --- Page Component (renders canvas + text layer) ---

const PdfPage = React.memo(function PdfPage({ doc, pageIndex, scale, width, height }: {
    doc: pdfjsLib.PDFDocumentProxy; pageIndex: number; scale: number; width: number; height: number
}) {
    const canvasRef = React.useRef<HTMLCanvasElement>(null)
    const textRef = React.useRef<HTMLDivElement>(null)
    const renderRef = React.useRef<pdfjsLib.RenderTask | null>(null)

    React.useEffect(() => {
        let cancelled = false
        const docPages = doc.numPages
        console.log(`[PdfPage] render START p${pageIndex + 1} scale=${scale.toFixed(2)} docPages=${docPages}`)

        doc.getPage(pageIndex + 1).then(page => {
            if (cancelled) { console.log(`[PdfPage] p${pageIndex + 1} cancelled before render`); return }
            const vp = page.getViewport({ scale })
            const canvas = canvasRef.current
            if (!canvas) { console.warn(`[PdfPage] p${pageIndex + 1} canvas ref is null`); return }

            const dpr = window.devicePixelRatio || 1
            const maxS = Math.sqrt(MAX_CANVAS_SIZE / (vp.width * vp.height))
            const css = dpr > maxS
            const ps = Math.min(maxS, dpr)
            const [xr, yr] = floatToRatio(ps, 8)

            canvas.width = roundToDivide(vp.width * ps, xr)
            canvas.height = roundToDivide(vp.height * ps, xr)
            canvas.style.width = `${roundToDivide(vp.width, yr)}px`
            canvas.style.height = `${roundToDivide(vp.height, yr)}px`
            if (css) canvas.style.transform = "scale(1,1)"; else canvas.style.removeProperty("transform")

            const ctx = canvas.getContext("2d", { alpha: false })
            if (!ctx) { console.warn(`[PdfPage] p${pageIndex + 1} canvas context is null`); return }
            renderRef.current?.cancel()

            const transform = (css || dpr !== 1)
                ? [ps, 0, 0, ps, 0, 0] as [number, number, number, number, number, number]
                : undefined
            renderRef.current = page.render({ canvasContext: ctx, viewport: vp, transform })
            renderRef.current.promise.then(() => {
                if (cancelled) return
                console.log(`[PdfPage] p${pageIndex + 1} canvas render DONE`)
                const tc = textRef.current
                if (!tc) return
                while (tc.firstChild) tc.removeChild(tc.firstChild)
                tc.style.setProperty("--scale-factor", `${scale}`)
                page.getTextContent().then(txt => {
                    if (cancelled || !tc) return
                    ;(pdfjsLib as typeof import('pdfjs-dist')).renderTextLayer({
                        textContentSource: txt,
                        container: tc,
                        viewport: vp,
                        textDivs: [],
                    })
                })
            }).catch(err => {
                if (!cancelled) console.warn(`[PdfPage] p${pageIndex + 1} render FAILED:`, err)
            })
        }).catch(err => {
            console.error(`[PdfPage] p${pageIndex + 1} getPage FAILED:`, err)
        })
        return () => { cancelled = true; renderRef.current?.cancel() }
    }, [doc, pageIndex, scale])

    return (
        <div
            data-page-index={pageIndex}
            className="rpv-page"
            style={{ width, height, position: "relative", background: "var(--rpv-page-bg,#fff)", boxShadow: "0 1px 3px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.08)" }}
        >
            <canvas ref={canvasRef} style={{ display: "block", position: "absolute", top: 0, left: 0 }} />
            <div ref={textRef} className="textLayer" style={{ position: "absolute", top: 0, left: 0, width, height, overflow: "hidden", opacity: 0.25, lineHeight: 1 }} />
        </div>
    )
})

// --- Toolbar ---

function Toolbar({ currentPage, numPages, scale, onPageChange, onZoom, onDownload, onFullscreen }: {
    currentPage: number; numPages: number; scale: number
    onPageChange: (p: number) => void; onZoom: (s: number) => void; onDownload: () => void; onFullscreen: () => void
}) {
    const [inp, setInp] = React.useState(String(currentPage + 1))
    React.useEffect(() => { setInp(String(currentPage + 1)) }, [currentPage])

    const submit = () => {
        const p = parseInt(inp, 10)
        if (!isNaN(p) && p >= 1 && p <= numPages) onPageChange(p - 1); else setInp(String(currentPage + 1))
    }
    const zIn = () => { const n = ZOOM_LEVELS.find(z => z > scale + 0.01); if (n) onZoom(n) }
    const zOut = () => { const p = [...ZOOM_LEVELS].reverse().find(z => z < scale - 0.01); if (p) onZoom(p) }

    return (
        <div className="rpv-toolbar">
            <button className="rpv-btn" onClick={() => onPageChange(0)} disabled={currentPage === 0} title="First page"><ChevronsLeft size={16} /></button>
            <button className="rpv-btn" onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0} title="Previous"><ChevronLeft size={16} /></button>
            <div className="rpv-page-input">
                <input type="text" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} onBlur={submit} />
                <span>/ {numPages}</span>
            </div>
            <button className="rpv-btn" onClick={() => onPageChange(Math.min(numPages - 1, currentPage + 1))} disabled={currentPage >= numPages - 1} title="Next"><ChevronRight size={16} /></button>
            <button className="rpv-btn" onClick={() => onPageChange(numPages - 1)} disabled={currentPage >= numPages - 1} title="Last page"><ChevronsRight size={16} /></button>
            <div className="rpv-sep" />
            <button className="rpv-btn" onClick={zOut} disabled={scale <= ZOOM_LEVELS[0]} title="Zoom out"><ZoomOut size={16} /></button>
            <span className="rpv-zoom-label">{Math.round(scale * 100)}%</span>
            <button className="rpv-btn" onClick={zIn} disabled={scale >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} title="Zoom in"><ZoomIn size={16} /></button>
            <div className="rpv-sep" />
            <button className="rpv-btn" onClick={onDownload} title="Download"><Download size={16} /></button>
            <button className="rpv-btn" onClick={onFullscreen} title="Full screen"><Maximize size={16} /></button>
        </div>
    )
}

// --- Main PdfViewer ---

export function PdfViewer({ fileUrl, initialPage = 0, jumpToPage: jumpPage, jumpKey, className }: PdfViewerProps) {
    const [pdfDoc, setPdfDoc] = React.useState<pdfjsLib.PDFDocumentProxy | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(true)
    const [scale, setScale] = React.useState(1.0)
    const [currentPage, setCurrentPage] = React.useState(initialPage)
    // Page dimensions (only measured for page 1, rest estimated until scrolled)
    const [pageSizes, setPageSizes] = React.useState<{ w: number; h: number }[]>([])
    const [visibleRange, setVisibleRange] = React.useState<[number, number]>([0, 1])
    // Callback ref: tracks scroll container mount/unmount via state so effects can depend on it.
    // scrollRef stays for imperative access (scrollTo, scrollTop, etc.)
    const scrollRef = React.useRef<HTMLDivElement | null>(null)
    const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
    const scrollRefCallback = React.useCallback((node: HTMLDivElement | null) => {
        scrollRef.current = node
        setScrollEl(node)
    }, [])
    const rootRef = React.useRef<HTMLDivElement>(null)
    const rafRef = React.useRef(0)

    // Load PDF (uses cache) — reset ALL dependent state on URL change
    React.useEffect(() => {
        if (!fileUrl) return
        let cancelled = false
        const tag = urlTag(fileUrl)
        console.log(`[PdfViewer:${tag}] fileUrl changed, resetting state`)

        setError(null)
        setLoading(true)
        // CRITICAL: reset virtual-scroll state to avoid stale ranges from previous doc
        setPageSizes([])
        setVisibleRange([0, 1])
        setCurrentPage(initialPage)
        // Reset scroll position
        if (scrollRef.current) scrollRef.current.scrollTop = 0

        loadPdfDoc(fileUrl)
            .then(doc => {
                if (cancelled) return
                console.log(`[PdfViewer:${tag}] setPdfDoc — ${doc.numPages} pages`)
                setPdfDoc(doc)
            })
            .catch(err => {
                if (!cancelled) {
                    console.error(`[PdfViewer:${tag}] load FAILED:`, err)
                    setError(err?.message || "Failed to load PDF")
                }
            })
            .finally(() => { if (!cancelled) setLoading(false) })

        return () => { cancelled = true }
    }, [fileUrl, initialPage])

    // Measure page 1 to get base dimensions, estimate rest
    React.useEffect(() => {
        if (!pdfDoc) return
        let cancelled = false
        pdfDoc.getPage(1).then(page => {
            if (cancelled) return
            const vp = page.getViewport({ scale })
            const sizes = Array.from({ length: pdfDoc.numPages }, () => ({ w: Math.round(vp.width), h: Math.round(vp.height) }))
            console.log(`[PdfViewer] pageSizes computed: ${sizes.length} pages, each ${sizes[0]?.w}x${sizes[0]?.h}`)
            setPageSizes(sizes)
        }).catch(err => {
            console.error(`[PdfViewer] pageSizes getPage(1) FAILED:`, err)
        })
        return () => { cancelled = true }
    }, [pdfDoc, scale])

    // Fit-to-width — depends on scrollEl so it runs when scroll container mounts
    React.useEffect(() => {
        if (!pdfDoc || !scrollEl) return
        let cancelled = false
        const calc = () => {
            const cw = scrollEl.clientWidth
            if (!cw || cancelled) return
            pdfDoc.getPage(1).then(page => {
                if (cancelled) return
                const vp = page.getViewport({ scale: 1.0 })
                const newScale = Math.max(0.5, Math.min(3.0, (cw - 40) / vp.width))
                console.log(`[PdfViewer] fit-to-width: containerWidth=${cw} → scale=${newScale.toFixed(3)}`)
                setScale(newScale)
            }).catch(err => {
                console.error(`[PdfViewer] fit-to-width getPage FAILED:`, err)
            })
        }
        calc()
        const ro = new ResizeObserver(calc)
        ro.observe(scrollEl)
        return () => { cancelled = true; ro.disconnect() }
    }, [pdfDoc, scrollEl])

    // Compute cumulative offsets for virtual scroll
    const offsets = React.useMemo(() => {
        if (!pageSizes.length) return []
        const arr: number[] = [0]
        for (let i = 0; i < pageSizes.length; i++) arr.push(arr[i] + pageSizes[i].h + PAGE_GAP)
        return arr
    }, [pageSizes])

    const totalHeight = offsets.length > 0 ? offsets[offsets.length - 1] : 0

    // Scroll handler — binary search for visible range
    // Depends on scrollEl (callback ref state) so it re-runs when the scroll container mounts.
    // Uses useLayoutEffect to fire SYNCHRONOUSLY after DOM mutations.
    React.useLayoutEffect(() => {
        const c = scrollEl
        console.log(`[PdfViewer:scrollEffect] entered — ref=${!!c} offsets=${offsets.length} pageSizes=${pageSizes.length}`)
        if (!c || offsets.length === 0) return

        const computeVisibleRange = (source: string) => {
            const top = c.scrollTop
            const bottom = top + c.clientHeight
            const n = pageSizes.length

            if (n === 0 || bottom === 0) {
                console.warn(`[PdfViewer:scroll] ${source}: skip — n=${n} clientHeight=${c.clientHeight}`)
                return
            }

            // Binary search for first visible page
            let lo = 0, hi = n - 1
            while (lo < hi) { const m = (lo + hi) >> 1; offsets[m + 1] < top - 200 ? lo = m + 1 : hi = m }
            const first = Math.max(0, lo - BUFFER)

            // Find last visible page
            let last = lo
            while (last < n - 1 && offsets[last] < bottom + 200) last++
            last = Math.min(n - 1, last + BUFFER)

            console.log(`[PdfViewer:scroll] ${source}: scrollTop=${Math.round(top)} clientH=${c.clientHeight} → visible=[${first},${last}] (n=${n})`)

            setVisibleRange(prev => prev[0] === first && prev[1] === last ? prev : [first, last])

            // Track current page
            let closest = lo, minDist = Infinity
            for (let i = lo; i <= Math.min(last, n - 1); i++) {
                const d = Math.abs(offsets[i] - top)
                if (d < minDist) { minDist = d; closest = i }
            }
            setCurrentPage(prev => prev === closest ? prev : closest)
        }

        // Compute IMMEDIATELY on mount/update (not deferred to RAF)
        computeVisibleRange("init")

        // Safety: if clientHeight was 0 (layout not yet complete), retry after a short delay
        let retryTimer = 0
        if (c.clientHeight === 0) {
            retryTimer = window.setTimeout(() => computeVisibleRange("init-retry"), 50)
        }

        const onScroll = () => {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = requestAnimationFrame(() => computeVisibleRange("scroll"))
        }

        c.addEventListener("scroll", onScroll, { passive: true })
        return () => { c.removeEventListener("scroll", onScroll); cancelAnimationFrame(rafRef.current); clearTimeout(retryTimer) }
    }, [scrollEl, offsets, pageSizes.length])

    // Jump to page via props
    React.useEffect(() => {
        if (jumpPage == null || !pdfDoc || !scrollRef.current || offsets.length === 0) return
        const idx = Math.max(0, Math.min(jumpPage, offsets.length - 2))
        scrollRef.current.scrollTo({ top: offsets[idx], behavior: "smooth" })
    }, [jumpPage, jumpKey, pdfDoc, offsets])

    // Toolbar page change
    const handlePageChange = React.useCallback((idx: number) => {
        if (!scrollRef.current || offsets.length === 0) return
        const i = Math.max(0, Math.min(idx, offsets.length - 2))
        scrollRef.current.scrollTo({ top: offsets[i], behavior: "smooth" })
        setCurrentPage(i)
    }, [offsets])

    const handleDownload = React.useCallback(() => {
        if (!fileUrl) return
        const a = document.createElement("a"); a.href = fileUrl; a.download = "document.pdf"; a.click()
    }, [fileUrl])

    const handleFullscreen = React.useCallback(() => { rootRef.current?.requestFullscreen?.() }, [])

    // Error state
    if (error) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#888", fontSize: 13, padding: 24, textAlign: "center" }}>
                <AlertCircle style={{ width: 24, height: 24, color: "#ef4444" }} />
                <p>Failed to load PDF</p>
                <p style={{ fontSize: 11, opacity: 0.6 }}>{error}</p>
                <button onClick={() => { setError(null); setLoading(true) }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", cursor: "pointer", fontSize: 12 }}>
                    <RefreshCw style={{ width: 14, height: 14 }} /> Retry
                </button>
            </div>
        )
    }

    // Loading state
    if (loading || !pdfDoc) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading PDF…
            </div>
        )
    }

    const numPages = pdfDoc.numPages

    // FAILSAFE: ensure we always render at least the first few pages when
    // pageSizes exist, even if the scroll layoutEffect hasn't updated visibleRange yet.
    // This prevents blank pages on fast cache-hit doc switches.
    const minVisible = pageSizes.length > 0 ? Math.min(numPages - 1, BUFFER * 2 + 1) : 1
    const vStart = visibleRange[0]
    const vEnd = Math.max(visibleRange[1], minVisible)

    // Debug: log when render runs with mismatched state
    if (pageSizes.length > 0 && pageSizes.length !== numPages) {
        console.warn(`[PdfViewer] STATE MISMATCH: pageSizes.length=${pageSizes.length} but numPages=${numPages}`)
    }
    if (vStart >= numPages || vEnd >= numPages) {
        console.warn(`[PdfViewer] VISIBLE RANGE OUT OF BOUNDS: visibleRange=[${vStart},${vEnd}] but numPages=${numPages}`)
    }

    return (
        <div ref={rootRef} className={className} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column" }}>
            <style>{`
                .rpv-toolbar { display:flex; align-items:center; gap:2px; padding:4px 8px; border-bottom:1px solid var(--rpv-border,hsl(var(--border,220 13% 91%))); background:var(--rpv-toolbar-bg,hsl(var(--background,0 0% 100%))); flex-shrink:0; min-height:40px; user-select:none; }
                .rpv-btn { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border:none; border-radius:6px; background:transparent; color:var(--rpv-icon,hsl(var(--foreground,0 0% 9%))); cursor:pointer; transition:background .15s; }
                .rpv-btn:hover:not(:disabled) { background:hsl(var(--muted,220 14% 96%)); }
                .rpv-btn:disabled { opacity:.3; cursor:default; }
                .rpv-sep { width:1px; height:20px; margin:0 4px; background:var(--rpv-border,hsl(var(--border,220 13% 91%))); }
                .rpv-page-input { display:flex; align-items:center; gap:4px; font-size:13px; color:var(--rpv-icon,hsl(var(--foreground,0 0% 9%))); }
                .rpv-page-input input { width:40px; height:28px; border:1px solid var(--rpv-border,hsl(var(--border,220 13% 91%))); border-radius:4px; text-align:center; font-size:13px; background:transparent; color:inherit; outline:none; }
                .rpv-page-input input:focus { border-color:hsl(var(--primary,221 83% 53%)); }
                .rpv-page-input span { font-size:12px; opacity:.6; }
                .rpv-zoom-label { font-size:12px; min-width:44px; text-align:center; color:var(--rpv-icon,hsl(var(--foreground,0 0% 9%))); }
                .rpv-scroll-container { flex:1; overflow:auto; background:var(--rpv-container-bg,hsl(var(--muted,220 14% 96%))); }
                .rpv-page { --rpv-page-bg:#fff; }
                :root.dark .rpv-toolbar,.dark .rpv-toolbar { background:var(--rpv-toolbar-bg,hsl(var(--background,0 0% 5.5%))); border-color:hsl(var(--border,0 0% 20%)); }
                :root.dark .rpv-btn,.dark .rpv-btn { color:hsl(var(--foreground,0 0% 96%)); }
                :root.dark .rpv-btn:hover:not(:disabled),.dark .rpv-btn:hover:not(:disabled) { background:hsl(var(--muted,0 0% 15%)); }
                :root.dark .rpv-page-input input,.dark .rpv-page-input input { border-color:hsl(var(--border,0 0% 20%)); color:hsl(var(--foreground,0 0% 96%)); }
                :root.dark .rpv-zoom-label,.dark .rpv-zoom-label { color:hsl(var(--foreground,0 0% 96%)); }
                :root.dark .rpv-sep,.dark .rpv-sep { background:hsl(var(--border,0 0% 20%)); }
                :root.dark .rpv-scroll-container,.dark .rpv-scroll-container { background:hsl(var(--background,0 0% 5.5%)); }
                :root.dark .rpv-page,.dark .rpv-page { --rpv-page-bg:hsl(0 0% 14%); filter:invert(.88) hue-rotate(180deg); }
                .textLayer { pointer-events:all; }
                .textLayer span { position:absolute; white-space:pre; color:transparent; font-size:1px; }
                .textLayer span::selection { background:rgba(0,0,255,.3); }
                :root.dark .textLayer span::selection,.dark .textLayer span::selection { background:rgba(100,150,255,.4); }
            `}</style>

            <Toolbar
                currentPage={currentPage}
                numPages={numPages}
                scale={scale}
                onPageChange={handlePageChange}
                onZoom={setScale}
                onDownload={handleDownload}
                onFullscreen={handleFullscreen}
            />

            <div ref={scrollRefCallback} className="rpv-scroll-container">
                {/* Single tall container for correct scrollbar */}
                <div style={{ height: totalHeight, position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    {pageSizes.length > 0 && Array.from({ length: vEnd - vStart + 1 }, (_, i) => {
                        const idx = vStart + i
                        if (idx >= numPages) return null
                        const ps = pageSizes[idx]
                        if (!ps) return null
                        return (
                            <div key={idx} style={{ position: "absolute", top: offsets[idx], width: ps.w, height: ps.h }}>
                                <PdfPage doc={pdfDoc} pageIndex={idx} scale={scale} width={ps.w} height={ps.h} />
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
