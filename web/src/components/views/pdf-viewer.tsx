"use client"

import * as React from "react"
import { Loader2, AlertCircle, RefreshCw } from "lucide-react"

// ---------------------------------------------------------------------------
// Prop-based PDF viewer using browser's native PDF renderer (iframe).
// Replaces @react-pdf-viewer which is incompatible with React 19.
// Communication is via props (jumpToPage + jumpKey) instead of forwardRef,
// because next/dynamic does not forward refs reliably.
// ---------------------------------------------------------------------------

// Keep the type export so existing imports don't break at compile time,
// but it is no longer used at runtime.
export interface PdfViewerHandle {
    jumpToPage: (pageIndex: number) => void
}

export interface PdfViewerProps {
    fileUrl: string
    initialPage?: number
    /** 0-indexed page to jump to */
    jumpToPage?: number
    /** Increment to trigger a jump (even to the same page) */
    jumpKey?: number
    className?: string
}

export function PdfViewer({ fileUrl, initialPage = 0, jumpToPage: jumpPage, jumpKey, className }: PdfViewerProps) {
    const [blobUrl, setBlobUrl] = React.useState<string | null>(null)
    const [error, setError] = React.useState<string | null>(null)
    const iframeRef = React.useRef<HTMLIFrameElement>(null)

    // Fetch PDF as blob to bypass CORS / ngrok interstitial
    React.useEffect(() => {
        if (!fileUrl) return
        let objectUrl: string
        let cancelled = false
        setError(null)
        setBlobUrl(null)

        fetch(fileUrl, { headers: { "ngrok-skip-browser-warning": "1" } })
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return r.blob()
            })
            .then(blob => {
                if (cancelled) return
                objectUrl = URL.createObjectURL(blob)
                setBlobUrl(objectUrl)
            })
            .catch(err => {
                if (!cancelled) setError(err?.message || "Failed to load PDF")
            })

        return () => {
            cancelled = true
            if (objectUrl) URL.revokeObjectURL(objectUrl)
        }
    }, [fileUrl])

    // Jump to page when jumpKey/jumpPage changes
    React.useEffect(() => {
        if (jumpPage == null || !blobUrl || !iframeRef.current) return
        const pageNum = jumpPage + 1 // browser PDF viewers use 1-based page numbers
        try {
            // Blob URLs are same-origin, so contentWindow access works
            const win = iframeRef.current.contentWindow
            if (win) {
                win.location.hash = `page=${pageNum}`
                return
            }
        } catch { /* fall through */ }
        // Fallback: set src directly (causes a reload from the in-memory blob — fast)
        iframeRef.current.src = `${blobUrl}#page=${pageNum}`
    }, [jumpPage, jumpKey, blobUrl])

    if (error) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#888", fontSize: 13, padding: 24, textAlign: "center" }}>
                <AlertCircle style={{ width: 24, height: 24, color: "#ef4444" }} />
                <p>Failed to load PDF</p>
                <p style={{ fontSize: 11, opacity: 0.6 }}>{error}</p>
                <button
                    onClick={() => { setError(null); setBlobUrl(null) }}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, border: "1px solid #333", background: "transparent", color: "#888", cursor: "pointer", fontSize: 12 }}
                >
                    <RefreshCw style={{ width: 14, height: 14 }} /> Retry
                </button>
            </div>
        )
    }

    if (!blobUrl) {
        return (
            <div className={className} style={{ height: "100%", width: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading PDF…
            </div>
        )
    }

    const pageNum = (initialPage || 0) + 1
    return (
        <div className={className} style={{ height: "100%", width: "100%" }}>
            <iframe
                ref={iframeRef}
                src={`${blobUrl}#page=${pageNum}`}
                style={{ width: "100%", height: "100%", border: "none" }}
                title="PDF Document"
            />
        </div>
    )
}
