"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * Build a regex matching distinctive phrases from the excerpt.
 *
 * Word-level matching produced too many false positives because legal
 * documents repeat terms like "customer", "account", "procedure" on every
 * page. Instead we match contiguous runs of 4+ words from the excerpt as
 * single phrases. Each text-layer fragment in pdfjs is typically a single
 * line, so any line of the cited paragraph that survived chunking will be
 * highlighted in one piece, while neighbouring paragraphs that just happen
 * to share vocabulary won't.
 */
function buildHighlightRegex(quote: string | null | undefined): RegExp | null {
    if (!quote) return null;
    // Normalise excerpt into runs separated by sentence-level punctuation.
    const runs = quote
        .split(/[\.\?!\n\r\u2022·]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    const phrases: string[] = [];
    for (const run of runs) {
        const words = run.split(/\s+/).filter((w) => w.length > 0);
        if (words.length < 4) continue;
        // Use up to 8-word slices so the phrase is distinctive but still
        // likely to fall within a single text-layer fragment.
        const slice = words.slice(0, Math.min(words.length, 8)).join("\\s+");
        phrases.push(slice);
        if (phrases.length >= 5) break;
    }
    if (phrases.length === 0) return null;
    // Sort longest first so longer phrases win when they share a prefix.
    phrases.sort((a, b) => b.length - a.length);
    return new RegExp(`(${phrases.map(escapeRegExp).join("|")})`, "gi");
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

    const renderText = useMemo(() => {
        if (!highlightRegex) return undefined;
        return ({ str }: { str: string }) => {
            const safe = escapeHtml(str);
            highlightRegex.lastIndex = 0;
            return safe.replace(
                highlightRegex,
                (m) =>
                    `<mark style="background:#fde047;color:#18181b;padding:1px 2px;border-radius:2px;font-weight:600">${m}</mark>`,
            );
        };
    }, [highlightRegex]);

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
                            renderTextLayer={Boolean(highlightRegex)}
                            renderAnnotationLayer={false}
                        />
                    </div>
                </Document>
            </div>
        </div>
    );
}
