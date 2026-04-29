"use client";

import { useEffect, useState } from "react";
import { Users, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { IntelTeam, TeamTaskAssignment } from "@/lib/intelligence-types";

interface TeamAssignmentDialogProps {
    open: boolean;
    onClose: () => void;
    teams: IntelTeam[];
    initialSelected: string[];
    initialTasks: TeamTaskAssignment[];
    actionableDescription?: string;
    onAccept: (teamIds: string[], tasks: TeamTaskAssignment[]) => void;
}

/**
 * Modal for editing team assignments with explicit Accept button + validation.
 *
 * Validation rules:
 * - For every selected team, `team_specific_task` must be non-empty.
 * - On click of Accept, if any selected team has empty task, a toast appears
 *   ("Please input the task") and the dialog stays open (no save).
 * - Save (call onAccept) only when validation passes.
 */
export function TeamAssignmentDialog({
    open,
    onClose,
    teams,
    initialSelected,
    initialTasks,
    actionableDescription,
    onAccept,
}: TeamAssignmentDialogProps) {
    const [selected, setSelected] = useState<string[]>(initialSelected);
    const [tasks, setTasks] = useState<Record<string, string>>(() => {
        const m: Record<string, string> = {};
        for (const t of initialTasks) m[t.team_id] = t.team_specific_task || "";
        return m;
    });

    // Reset internal state whenever the dialog reopens with fresh inputs.
    useEffect(() => {
        if (open) {
            setSelected(initialSelected);
            const m: Record<string, string> = {};
            for (const t of initialTasks) m[t.team_id] = t.team_specific_task || "";
            setTasks(m);
        }
    }, [open, initialSelected, initialTasks]);

    const toggleTeam = (teamId: string) => {
        setSelected((prev) => {
            if (prev.includes(teamId)) {
                return prev.filter((x) => x !== teamId);
            }
            return [...prev, teamId];
        });
    };

    const updateTask = (teamId: string, task: string) => {
        setTasks((prev) => ({ ...prev, [teamId]: task }));
    };

    const handleAccept = () => {
        // Validation: every selected team must have a non-empty task.
        const missing = selected.filter((tid) => !(tasks[tid] || "").trim());
        if (missing.length > 0) {
            toast.error("Please input the task");
            return;
        }

        const teamMap = new Map(teams.map((t) => [t.team_id, t]));
        const finalTasks: TeamTaskAssignment[] = selected.map((tid) => ({
            team_id: tid,
            team_name: teamMap.get(tid)?.name || "",
            team_specific_task: (tasks[tid] || "").trim(),
        }));
        onAccept(selected, finalTasks);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Users className="h-4 w-4" /> Assign Teams &amp; Tasks
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Select the teams responsible for this actionable. Each selected team
                        must have a specific task tailored to its function.
                    </DialogDescription>
                </DialogHeader>

                {actionableDescription && (
                    <div className="rounded border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground line-clamp-3">
                        {actionableDescription}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
                    {teams.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">
                            No teams defined. Add teams under the Teams tab first.
                        </p>
                    ) : (
                        teams.map((t) => {
                            const isSelected = selected.includes(t.team_id);
                            const taskValue = tasks[t.team_id] || "";
                            const isInvalid = isSelected && !taskValue.trim();
                            return (
                                <div
                                    key={t.team_id}
                                    className={cn(
                                        "rounded border p-2 transition-colors",
                                        isSelected
                                            ? "border-primary/40 bg-primary/5"
                                            : "border-border bg-background hover:bg-accent/30",
                                    )}
                                >
                                    <label className="flex items-start gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleTeam(t.team_id)}
                                            className="mt-0.5 accent-primary"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium text-foreground">
                                                {t.name}
                                                {t.department && (
                                                    <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                                                        · {t.department}
                                                    </span>
                                                )}
                                            </div>
                                            {t.function && (
                                                <div className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                                                    {t.function}
                                                </div>
                                            )}
                                        </div>
                                    </label>

                                    {isSelected && (
                                        <div className="mt-2 ml-6">
                                            <label className="text-[10px] text-muted-foreground block mb-1">
                                                Task for {t.name}{" "}
                                                <span className="text-red-500">*</span>
                                            </label>
                                            <textarea
                                                value={taskValue}
                                                onChange={(e) =>
                                                    updateTask(t.team_id, e.target.value)
                                                }
                                                placeholder={`What does ${t.name} specifically need to do?`}
                                                rows={2}
                                                className={cn(
                                                    "w-full rounded border bg-background px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary",
                                                    isInvalid
                                                        ? "border-red-500/50"
                                                        : "border-border",
                                                )}
                                            />
                                            {isInvalid && (
                                                <p className="text-[10px] text-red-500 mt-0.5">
                                                    Task is required for selected team.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t">
                    <span className="text-[10px] text-muted-foreground">
                        {selected.length} team{selected.length === 1 ? "" : "s"} selected
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleAccept}>
                            <Check className="h-3.5 w-3.5" />
                            Accept
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
