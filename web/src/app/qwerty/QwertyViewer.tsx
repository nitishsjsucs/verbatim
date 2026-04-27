"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface QwertyViewerProps {
    url: string | null;
    page: number;
    /**
     * Excerpt of the cited chunk. Significant words are highlighted on the
     * rendered text layer, mirroring qwerty's citationQuote highlighting in
     * `pdf-page-canvas.tsx`.
     */
    quote?: string | null;
}

const STOP_WORDS = new Set([
    "which", "their", "there", "these", "those", "being", "between",
    "should", "would", "could", "about", "after", "before", "under",
    "above", "other", "every", "through", "during", "against", "further",
    "however", "whereas", "section", "sections", "mentioned", "present",
    "having", "matter", "regard", "respect",
]);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Build a regex from significant words (>=6 chars, non-stopword) of the
 * cited excerpt. Word-level matching is robust to whitespace, hyphenation,
 * and line-break differences between the stored excerpt and rendered PDF.
 */
function buildHighlightRegex(quote: string | null | undefined): RegExp | null {
    if (!quote) return null;
    const words = quote
        .split(/[\s,.:;·\-–—"'()[\]{}]+/)
        .filter((w) => w.length >= 6 && !STOP_WORDS.has(w.toLowerCase()))
        .map(escapeRegExp);
    const unique = [...new Set(words)].slice(0, 15);
    if (unique.length === 0) return null;
    return new RegExp(`(${unique.join("|")})`, "gi");
}

export default function QwertyViewer({ url, page, quote }: QwertyViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState<number>(Math.max(1, page));
    const scrollRef = useRef<HTMLDivElement>(null);

    // Sync incoming citation page (and reset on file change).
    useEffect(() => {
        setCurrentPage(Math.max(1, page));
    }, [page, url]);

    // Snap to top whenever the visible page changes.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [currentPage, url]);

    const highlightRegex = useMemo(() => buildHighlightRegex(quote), [quote]);

    const renderText = useCallback(
        ({ str }: { str: string }) => {
            const safe = escapeHtml(str);
            if (!highlightRegex) return safe;
            highlightRegex.lastIndex = 0;
            return safe.replace(
                highlightRegex,
                (m) => `<mark class="qwerty-highlight">${m}</mark>`,
            );
        },
        [highlightRegex],
    );

    if (!url) {
        return (
            <div style={{ padding: 24, color: "#6b7280" }}>
                Select a citation to preview the source page here.
            </div>
        );
    }

    const goPrev = () => setCurrentPage((p) => Math.max(1, p - 1));
    const goNext = () => setCurrentPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1));

    const btnStyle: React.CSSProperties = {
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid #d1d5db",
        background: "white",
        cursor: "pointer",
        font: "inherit",
        fontSize: 13,
    };

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#f3f4f6" }}>
            <style>{`.qwerty-highlight { background: #fde68a; color: inherit; border-radius: 2px; padding: 0 1px; }`}</style>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderBottom: "1px solid #e5e7eb",
                    background: "white",
                    fontSize: 13,
                }}
            >
                <button type="button" onClick={goPrev} disabled={currentPage <= 1} style={btnStyle}>
                    ‹ Prev
                </button>
                <span style={{ color: "#374151" }}>
                    Page {currentPage}
                    {numPages ? ` of ${numPages}` : ""}
                </span>
                <button
                    type="button"
                    onClick={goNext}
                    disabled={!!numPages && currentPage >= numPages}
                    style={btnStyle}
                >
                    Next ›
                </button>
            </div>
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto" }}>
                <Document
                    file={url}
                    onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                    loading={<div style={{ padding: 16 }}>Loading PDF…</div>}
                    error={<div style={{ padding: 16, color: "#b91c1c" }}>Failed to load PDF</div>}
                >
                    <div style={{ margin: "8px auto", width: "fit-content" }}>
                        <Page
                            pageNumber={currentPage}
                            width={720}
                            customTextRenderer={renderText}
                        />
                    </div>
                </Document>
            </div>
        </div>
    );
}
