"use client";

import { useMemo } from "react";

import type { QwertyCitation } from "@/lib/qwerty/api";

interface AnnotatedAnswerProps {
    text: string;
    citations: QwertyCitation[];
    activeCitationNumber: number | null;
    onCitationClick: (n: number, citation: QwertyCitation) => void;
}

interface Segment {
    kind: "plain" | "cited";
    text: string;
    numbers: number[]; // 1-based citation numbers attached to this segment
}

interface Marker {
    start: number;
    end: number;
    n: number;
}

/**
 * Parses inline [N] markers and groups consecutive markers (e.g. "[1][2]").
 * Each group's preceding text becomes a "cited" segment with those numbers
 * attached, and the [N] marker text itself is stripped.
 *
 * Mirrors the segmentation logic from qwerty's
 * `lib/discovery/citation-utils.ts` (`segmentAnswerFromMarkers`).
 */
function segmentAnswer(answer: string): Segment[] {
    if (!answer) return [];

    const markers: Marker[] = [];
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(answer)) !== null) {
        const n = Number.parseInt(m[1], 10);
        if (n > 0) {
            markers.push({ start: m.index, end: m.index + m[0].length, n });
        }
    }

    if (markers.length === 0) {
        return [{ kind: "plain", text: answer, numbers: [] }];
    }

    // Group consecutive markers separated only by whitespace.
    interface Group {
        textStart: number;
        markersStart: number;
        markersEnd: number;
        numbers: number[];
    }
    const groups: Group[] = [];
    let i = 0;
    while (i < markers.length) {
        const head = markers[i];
        const numbers = [head.n];
        let tail = head;
        let j = i + 1;
        while (j < markers.length) {
            const between = answer.slice(tail.end, markers[j].start);
            if (between.trim().length === 0) {
                numbers.push(markers[j].n);
                tail = markers[j];
                j += 1;
            } else {
                break;
            }
        }
        const prevEnd = groups.length > 0 ? groups[groups.length - 1].markersEnd : 0;
        groups.push({
            textStart: prevEnd,
            markersStart: head.start,
            markersEnd: tail.end,
            numbers: [...new Set(numbers)].sort((a, b) => a - b),
        });
        i = j;
    }

    const segments: Segment[] = [];
    for (const g of groups) {
        const before = answer.slice(g.textStart, g.markersStart).replace(/\s+$/, "");
        if (before.length > 0) {
            segments.push({ kind: "cited", text: before, numbers: g.numbers });
        }
    }

    const last = groups[groups.length - 1];
    const trailing = answer.slice(last.markersEnd);
    if (trailing.trim().length > 0) {
        segments.push({ kind: "plain", text: trailing, numbers: [] });
    }

    return segments;
}

/**
 * Renders an answer with inline citation badges.
 * - `[N]` markers are stripped and replaced with numbered pills after the
 *   sentence they cite.
 * - The cited sentence gets a subtle background highlight when its citation
 *   is active.
 */
export default function AnnotatedAnswer({
    text,
    citations,
    activeCitationNumber,
    onCitationClick,
}: AnnotatedAnswerProps) {
    const byNumber = useMemo(() => {
        const map = new Map<number, QwertyCitation>();
        for (let i = 0; i < citations.length; i++) {
            map.set(i + 1, citations[i]);
        }
        return map;
    }, [citations]);

    const segments = useMemo(() => segmentAnswer(text), [text]);

    if (!text) return null;

    return (
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
            {segments.map((seg, idx) => {
                if (seg.kind === "plain") {
                    return <span key={idx}>{seg.text}</span>;
                }
                const isActive =
                    activeCitationNumber !== null &&
                    seg.numbers.includes(activeCitationNumber);
                return (
                    <span key={idx}>
                        <span
                            style={{
                                background: isActive ? "#fde68a" : "transparent",
                                borderRadius: 4,
                                padding: isActive ? "1px 2px" : 0,
                                transition: "background-color 120ms",
                            }}
                        >
                            {seg.text}
                        </span>
                        {seg.numbers.map((n) => {
                            const c = byNumber.get(n);
                            const active = activeCitationNumber === n;
                            return (
                                <button
                                    key={n}
                                    type="button"
                                    title={c ? `${c.filename} · p.${c.page_start}` : undefined}
                                    onClick={() => {
                                        if (c) onCitationClick(n, c);
                                    }}
                                    style={{
                                        marginLeft: 3,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        minWidth: 20,
                                        height: 18,
                                        padding: "0 5px",
                                        borderRadius: 999,
                                        verticalAlign: "super",
                                        fontSize: 10,
                                        fontWeight: 600,
                                        lineHeight: 1,
                                        background: active ? "#1e293b" : "#e2e8f0",
                                        color: active ? "#f8fafc" : "#334155",
                                        border: 0,
                                        cursor: "pointer",
                                        boxShadow: active
                                            ? "0 1px 2px rgba(0,0,0,0.15)"
                                            : "none",
                                    }}
                                >
                                    {n}
                                </button>
                            );
                        })}
                    </span>
                );
            })}
        </div>
    );
}
