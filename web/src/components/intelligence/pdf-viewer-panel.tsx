"use client";

import { useCallback, useEffect, useRef } from "react";
import { X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfViewerPanelProps {
    url: string | null;
    onClose: () => void;
}

/**
 * Slide-in panel that renders a PDF inside an <iframe>.
 * Appears from the right edge of the viewport.
 */
export function PdfViewerPanel({ url, onClose }: PdfViewerPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on Escape key
    useEffect(() => {
        if (!url) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [url, onClose]);

    // Click outside to close
    const handleOverlayClick = useCallback(
        (e: React.MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        },
        [onClose],
    );

    if (!url) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-end"
            onClick={handleOverlayClick}
        >
            {/* Semi-transparent backdrop */}
            <div className="absolute inset-0 bg-black/40 transition-opacity" />

            {/* Slide-in panel */}
            <div
                ref={panelRef}
                className="relative w-full max-w-3xl h-full bg-background shadow-2xl animate-in slide-in-from-right-full duration-300 flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                        Source PDF
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Open in new tab"
                            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                        >
                            <Maximize2 className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={onClose}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* PDF iframe */}
                <iframe
                    src={url}
                    className="flex-1 w-full border-0"
                    title="PDF Viewer"
                />
            </div>
        </div>
    );
}
