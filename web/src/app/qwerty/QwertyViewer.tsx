"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface QwertyViewerProps {
    url: string | null;
    page: number;
}

export default function QwertyViewer({ url, page }: QwertyViewerProps) {
    const [numPages, setNumPages] = useState<number>(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current || page < 1) return;
        const target = containerRef.current.querySelector<HTMLElement>(`[data-page="${page}"]`);
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [page, numPages]);

    if (!url) {
        return (
            <div style={{ padding: 24, color: "#6b7280" }}>
                Select a citation to preview the source page here.
            </div>
        );
    }

    return (
        <div ref={containerRef} style={{ height: "100%", overflowY: "auto", background: "#f3f4f6" }}>
            <Document
                file={url}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={<div style={{ padding: 16 }}>Loading PDF…</div>}
                error={<div style={{ padding: 16, color: "#b91c1c" }}>Failed to load PDF</div>}
            >
                {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                    <div key={p} data-page={p} style={{ margin: "8px auto", width: "fit-content" }}>
                        <Page pageNumber={p} width={720} />
                    </div>
                ))}
            </Document>
        </div>
    );
}
