"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTeams } from "@/lib/use-teams"
import type { Team } from "@/lib/types"
import { WORKSTREAM_COLORS, DEFAULT_WORKSTREAM_COLORS } from "@/lib/status-config"

// ─── Multi-select hierarchical team selector ─────────────────────────────────
// Parents are containers (not selectable). Only leaf sub-teams are selectable.
// Renders as inline expandable groups with toggle buttons.

interface HierarchicalTeamMultiSelectProps {
    selected: string[]
    onChange: (teams: string[]) => void
    /** Called when a new team is added (for initializing per-team drafts) */
    onTeamAdded?: (team: string) => void
}

export function HierarchicalTeamMultiSelect({ selected, onChange, onTeamAdded }: HierarchicalTeamMultiSelectProps) {
    const { teamTree } = useTeams()
    const [expandedParents, setExpandedParents] = React.useState<Set<string>>(() => {
        // Auto-expand parents that have selected children
        const expanded = new Set<string>()
        function findParents(nodes: Team[]) {
            for (const node of nodes) {
                if (node.children?.length) {
                    const hasSelected = hasSelectedDescendant(node, selected)
                    if (hasSelected) expanded.add(node.name)
                    findParents(node.children)
                }
            }
        }
        findParents(teamTree)
        return expanded
    })

    const toggleParent = (name: string) => {
        setExpandedParents(prev => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name); else next.add(name)
            return next
        })
    }

    const toggleLeaf = (team: string) => {
        if (selected.includes(team)) {
            if (selected.length <= 1) return // Must keep at least one
            onChange(selected.filter(t => t !== team))
        } else {
            onChange([team, ...selected])
            onTeamAdded?.(team)
        }
    }

    return (
        <div className="space-y-1">
            {teamTree.map(rootNode => (
                <TeamNodeRenderer
                    key={rootNode.name}
                    node={rootNode}
                    selected={selected}
                    expandedParents={expandedParents}
                    toggleParent={toggleParent}
                    toggleLeaf={toggleLeaf}
                    depth={0}
                />
            ))}
        </div>
    )
}

function TeamNodeRenderer({ node, selected, expandedParents, toggleParent, toggleLeaf, depth }: {
    node: Team
    selected: string[]
    expandedParents: Set<string>
    toggleParent: (name: string) => void
    toggleLeaf: (name: string) => void
    depth: number
}) {
    const isLeaf = !node.children?.length
    const isExpanded = expandedParents.has(node.name)
    const teamColors = WORKSTREAM_COLORS[node.name] || DEFAULT_WORKSTREAM_COLORS
    const selectedCount = isLeaf ? 0 : countSelectedDescendants(node, selected)

    if (isLeaf) {
        // Leaf team: selectable toggle button
        const isSelected = selected.includes(node.name)
        return (
            <button
                onClick={() => toggleLeaf(node.name)}
                className={cn(
                    "text-xs px-2 py-1 rounded-md border transition-colors font-medium inline-flex items-center gap-1",
                    isSelected
                        ? `${teamColors.bg} ${teamColors.text} border-current`
                        : "border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground/80"
                )}
                style={{ marginLeft: depth > 0 ? `${depth * 8}px` : undefined }}
            >
                {node.name}
            </button>
        )
    }

    // Parent team: expandable container, NOT selectable
    return (
        <div className="space-y-1">
            <button
                onClick={() => toggleParent(node.name)}
                className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold px-1.5 py-1 rounded transition-colors",
                    "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
                style={{ marginLeft: depth > 0 ? `${depth * 8}px` : undefined }}
            >
                {isExpanded
                    ? <ChevronDown className="h-3 w-3 shrink-0" />
                    : <ChevronRight className="h-3 w-3 shrink-0" />
                }
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-semibold", teamColors.bg, teamColors.text)}>
                    {node.name}
                </span>
                {selectedCount > 0 && (
                    <span className="text-[10px] text-primary font-mono">{selectedCount} selected</span>
                )}
            </button>
            {isExpanded && node.children && (
                <div className="flex flex-wrap gap-1 pl-2">
                    {node.children.map(child => (
                        <TeamNodeRenderer
                            key={child.name}
                            node={child}
                            selected={selected}
                            expandedParents={expandedParents}
                            toggleParent={toggleParent}
                            toggleLeaf={toggleLeaf}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Single-select hierarchical team dropdown ─────────────────────────────────
// For the Create Actionable form. Shows indented tree, only leaf teams selectable.

interface HierarchicalTeamSelectProps {
    value: string
    onChange: (team: string) => void
    className?: string
}

export function HierarchicalTeamSelect({ value, onChange, className }: HierarchicalTeamSelectProps) {
    const { teamTree, leafTeamNames } = useTeams()

    // Build flat option list with indentation
    const options = React.useMemo(() => {
        const result: { name: string; label: string; isLeaf: boolean; depth: number }[] = []
        function walk(nodes: Team[], depth: number) {
            for (const node of nodes) {
                const isLeaf = !node.children?.length
                const indent = "\u00A0\u00A0\u00A0\u00A0".repeat(depth)
                result.push({
                    name: node.name,
                    label: isLeaf ? `${indent}${node.name}` : `${indent}▸ ${node.name}`,
                    isLeaf,
                    depth,
                })
                if (node.children?.length) walk(node.children, depth + 1)
            }
        }
        walk(teamTree, 0)
        return result
    }, [teamTree])

    // If current value is not a leaf, auto-select first leaf
    React.useEffect(() => {
        if (value && !leafTeamNames.includes(value) && leafTeamNames.length > 0) {
            onChange(leafTeamNames[0])
        }
    }, [value, leafTeamNames, onChange])

    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className={cn(
                "w-full bg-background text-xs rounded px-2 py-1.5 border border-border focus:border-primary focus:outline-none text-foreground",
                className
            )}
        >
            {options.map(opt => (
                <option
                    key={opt.name}
                    value={opt.name}
                    disabled={!opt.isLeaf}
                    className={!opt.isLeaf ? "font-bold text-muted-foreground" : ""}
                >
                    {opt.label}
                </option>
            ))}
        </select>
    )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasSelectedDescendant(node: Team, selected: string[]): boolean {
    if (!node.children?.length) return selected.includes(node.name)
    return node.children.some(c => hasSelectedDescendant(c, selected))
}

function countSelectedDescendants(node: Team, selected: string[]): number {
    if (!node.children?.length) return selected.includes(node.name) ? 1 : 0
    return node.children.reduce((sum, c) => sum + countSelectedDescendants(c, selected), 0)
}
