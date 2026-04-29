"use client";

/**
 * PipelineActionDialog
 *
 * A reusable, custom modal dialog for confirming and tracking ML/AI pipeline
 * actions (extraction, re-extraction, reassignment, ingestion).
 *
 * Lifecycle:
 *   1. Opened with `open=true` and `phase="confirm"` -> shows confirm prompt.
 *   2. User clicks Accept -> caller flips to `phase="running"` and starts the
 *      async work. While running:
 *        - The dialog is fully modal and BLOCKING:
 *          * Escape key is suppressed
 *          * Outside-click (overlay) is suppressed
 *          * Close (X) button is hidden
 *        - A spinner + indeterminate / staged progress bar is visible.
 *        - Stage text updates as the caller advances `stageLabel`.
 *   3. When work finishes, caller flips to `phase="done"` (with success or
 *      error message) and the dialog auto-dismisses after a short delay or
 *      when the user clicks Close.
 *
 * Replaces ALL native `window.confirm` calls inside the intelligence
 * subsystem.
 */

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PipelinePhase = "confirm" | "running" | "done" | "error";

export interface PipelineActionDialogProps {
    open: boolean;
    phase: PipelinePhase;

    title: string;
    description: string;

    // Phase: running
    stageLabel?: string;        // e.g. "Extracting actionables"
    progressPercent?: number;   // 0..100 — if undefined, indeterminate

    // Phase: done | error
    finalMessage?: string;

    confirmLabel?: string;      // default: "Run Pipeline"
    cancelLabel?: string;       // default: "Cancel"

    onConfirm: () => void;
    onCancel: () => void;
    onClose: () => void;        // only called when phase === "done" | "error"
}

export function PipelineActionDialog({
    open,
    phase,
    title,
    description,
    stageLabel,
    progressPercent,
    finalMessage,
    confirmLabel = "Run Pipeline",
    cancelLabel = "Cancel",
    onConfirm,
    onCancel,
    onClose,
}: PipelineActionDialogProps) {
    const blocking = phase === "running";

    return (
        <DialogPrimitive.Root
            open={open}
            // Disallow programmatic close while running. Only allow when
            // confirm/done/error states.
            onOpenChange={(next) => {
                if (next) return;
                if (phase === "confirm") onCancel();
                else if (phase === "done" || phase === "error") onClose();
                // running: ignore
            }}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay
                    className={cn(
                        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
                        "data-[state=open]:animate-in data-[state=closed]:animate-out",
                        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                    )}
                />
                <DialogPrimitive.Content
                    onEscapeKeyDown={(e) => {
                        if (blocking) e.preventDefault();
                    }}
                    onPointerDownOutside={(e) => {
                        if (blocking) e.preventDefault();
                    }}
                    onInteractOutside={(e) => {
                        if (blocking) e.preventDefault();
                    }}
                    className={cn(
                        "fixed top-[50%] left-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%]",
                        "gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none",
                        "data-[state=open]:animate-in data-[state=closed]:animate-out",
                        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                    )}
                >
                    {/* Header */}
                    <div className="flex items-start gap-3">
                        <div className="mt-0.5">
                            {phase === "confirm" && (
                                <AlertTriangle className="h-5 w-5 text-amber-500" />
                            )}
                            {phase === "running" && (
                                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                            )}
                            {phase === "done" && (
                                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                            )}
                            {phase === "error" && (
                                <AlertTriangle className="h-5 w-5 text-red-500" />
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <DialogPrimitive.Title className="text-base font-semibold leading-tight">
                                {title}
                            </DialogPrimitive.Title>
                            <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
                                {description}
                            </DialogPrimitive.Description>
                        </div>
                    </div>

                    {/* Body */}
                    {phase === "running" && (
                        <div className="space-y-3 mt-1">
                            <div className="text-xs text-foreground font-medium">
                                {stageLabel || "Working..."}
                            </div>
                            <ProgressBar percent={progressPercent} />
                            <p className="text-[11px] text-muted-foreground">
                                Please wait. The pipeline is running. Do not close this window or navigate away.
                            </p>
                        </div>
                    )}

                    {(phase === "done" || phase === "error") && finalMessage && (
                        <div
                            className={cn(
                                "rounded-md border p-3 text-xs",
                                phase === "done"
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
                            )}
                        >
                            {finalMessage}
                        </div>
                    )}

                    {/* Footer */}
                    <div className="flex justify-end gap-2 mt-1">
                        {phase === "confirm" && (
                            <>
                                <Button variant="outline" size="sm" onClick={onCancel}>
                                    {cancelLabel}
                                </Button>
                                <Button size="sm" onClick={onConfirm}>
                                    {confirmLabel}
                                </Button>
                            </>
                        )}
                        {(phase === "done" || phase === "error") && (
                            <Button size="sm" onClick={onClose}>
                                Close
                            </Button>
                        )}
                        {phase === "running" && (
                            <Button size="sm" disabled>
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                                Running…
                            </Button>
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}

/* -------------------------------------------------------------------------- */
/*  Progress bar                                                              */
/* -------------------------------------------------------------------------- */

function ProgressBar({ percent }: { percent?: number }) {
    const determinate = typeof percent === "number" && !Number.isNaN(percent);
    return (
        <div className="h-2 w-full rounded-full overflow-hidden bg-muted">
            {determinate ? (
                <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, percent!))}%` }}
                />
            ) : (
                <div className="relative h-full">
                    <div className="absolute inset-y-0 left-0 w-1/3 bg-primary animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full" />
                    {/* Inline keyframes (Tailwind doesn't ship one for indeterminate progress) */}
                    <style jsx>{`
                        @keyframes indeterminate {
                            0% { transform: translateX(-100%); }
                            50% { transform: translateX(150%); }
                            100% { transform: translateX(350%); }
                        }
                    `}</style>
                </div>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  usePipelineAction — small hook to drive the dialog ergonomically          */
/* -------------------------------------------------------------------------- */

export interface UsePipelineActionOptions {
    title: string;
    description: string;
    /** Stages displayed sequentially while `run` is awaiting. */
    stages?: string[];
    /** Confirm button label (default: "Run Pipeline"). */
    confirmLabel?: string;
}

export interface PipelineActionController {
    open: boolean;
    phase: PipelinePhase;
    title: string;
    description: string;
    stageLabel?: string;
    progressPercent?: number;
    finalMessage?: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    onClose: () => void;
    /** Trigger the dialog. Returns a promise resolving with the run result, or null if user cancelled. */
    request: <T>(fn: () => Promise<T>, opts?: { successMessage?: (res: T) => string }) => Promise<T | null>;
}

/**
 * Hook that wires a confirm-then-run pattern with a blocking loading state
 * and staged progress text. Pass the returned controller props directly to
 * <PipelineActionDialog />.
 */
export function usePipelineAction(options: UsePipelineActionOptions): PipelineActionController {
    const [open, setOpen] = React.useState(false);
    const [phase, setPhase] = React.useState<PipelinePhase>("confirm");
    const [stageIdx, setStageIdx] = React.useState(0);
    const [finalMessage, setFinalMessage] = React.useState<string | undefined>();
    const stageTimer = React.useRef<ReturnType<typeof setInterval> | null>(null);

    const pendingRef = React.useRef<{
        fn: () => Promise<unknown>;
        successMessage?: (res: unknown) => string;
        resolve: (value: unknown) => void;
    } | null>(null);

    const stages = options.stages && options.stages.length > 0
        ? options.stages
        : ["Preparing", "Running pipeline", "Finalizing"];

    const stopStageRotation = () => {
        if (stageTimer.current) {
            clearInterval(stageTimer.current);
            stageTimer.current = null;
        }
    };

    const startStageRotation = () => {
        stopStageRotation();
        setStageIdx(0);
        // Advance through stages every 2.5s, pausing on the last one.
        stageTimer.current = setInterval(() => {
            setStageIdx((i) => Math.min(i + 1, stages.length - 1));
        }, 2500);
    };

    const onCancel = React.useCallback(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setOpen(false);
        setPhase("confirm");
        if (pending) pending.resolve(null);
    }, []);

    const onClose = React.useCallback(() => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        stopStageRotation();
        setOpen(false);
        setPhase("confirm");
        setFinalMessage(undefined);
        if (pending) pending.resolve(null);
    }, []);

    const onConfirm = React.useCallback(async () => {
        const pending = pendingRef.current;
        if (!pending) {
            setOpen(false);
            return;
        }
        setPhase("running");
        startStageRotation();

        try {
            const result = await pending.fn();
            stopStageRotation();
            setStageIdx(stages.length - 1);
            setPhase("done");
            const msg = pending.successMessage ? pending.successMessage(result) : "Completed successfully.";
            setFinalMessage(msg);
            pending.resolve(result);
            // Auto-dismiss after a short delay so the user sees success briefly
            window.setTimeout(() => {
                if (pendingRef.current === null) {
                    setOpen(false);
                    setPhase("confirm");
                    setFinalMessage(undefined);
                }
            }, 1200);
        } catch (err) {
            stopStageRotation();
            setPhase("error");
            setFinalMessage(err instanceof Error ? err.message : "Pipeline failed");
            pending.resolve(null);
        } finally {
            // Clear pendingRef so onClose works correctly without re-resolving.
            pendingRef.current = null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stages.length]);

    const request = React.useCallback(
        <T,>(
            fn: () => Promise<T>,
            opts?: { successMessage?: (res: T) => string },
        ): Promise<T | null> => {
            return new Promise<T | null>((resolve) => {
                pendingRef.current = {
                    fn: fn as () => Promise<unknown>,
                    successMessage: opts?.successMessage as ((res: unknown) => string) | undefined,
                    resolve: resolve as (value: unknown) => void,
                };
                setFinalMessage(undefined);
                setPhase("confirm");
                setOpen(true);
            });
        },
        [],
    );

    React.useEffect(() => {
        return () => stopStageRotation();
    }, []);

    return {
        open,
        phase,
        title: options.title,
        description: options.description,
        stageLabel: phase === "running" ? stages[stageIdx] : undefined,
        progressPercent: undefined, // indeterminate (we don't have real percent from backend)
        finalMessage,
        confirmLabel: options.confirmLabel,
        onConfirm,
        onCancel,
        onClose,
        request,
    };
}
