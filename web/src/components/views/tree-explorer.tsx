"use client"

import * as React from "react"
import { ChevronRight, ChevronDown, FileText, Folder, Table, Hash, BookOpen, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TreeNode, NodeType } from "@/lib/types"

interface TreeExplorerProps {
    structure: TreeNode[]
    className?: string
    onNodeSelect?: (node: TreeNode) => void
    selectedNodeId?: string
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
    const q = query.toLowerCase()
    const results: TreeNode[] = []
    for (const node of nodes) {
        const titleMatch = node.title?.toLowerCase().includes(q)
        const summaryMatch = node.summary?.toLowerCase().includes(q)
        const topicMatch = node.topics?.some(t => t.toLowerCase().includes(q))
        const filteredChildren = node.children ? filterTree(node.children, query) : []
        if (titleMatch || summaryMatch || topicMatch || filteredChildren.length > 0) {
            results.push({
                ...node,
                children: filteredChildren.length > 0 ? filteredChildren : (titleMatch || summaryMatch || topicMatch ? node.children : []),
            })
        }
    }
    return results
}

export function TreeExplorer({ structure, className, onNodeSelect, selectedNodeId }: TreeExplorerProps) {
    const [searchQuery, setSearchQuery] = React.useState("")

    const displayStructure = searchQuery.trim()
        ? filterTree(structure, searchQuery.trim())
        : structure

    return (
        <div className={cn("flex flex-col h-full bg-sidebar border-r border-sidebar-border", className)}>
            <div className="h-14 border-b border-sidebar-border/40 flex items-center px-4 shrink-0">
                <h3 className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">Structure</h3>
            </div>
            {/* Search */}
            <div className="px-3 pt-2 pb-1 shrink-0">
                <div className="relative">
                    <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground/50" />
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter nodes..."
                        className="w-full bg-sidebar-accent/50 text-xs text-sidebar-foreground rounded-md pl-7 pr-7 py-1.5 border border-transparent focus:border-sidebar-border focus:outline-none transition-colors"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-2 top-2 text-muted-foreground/50 hover:text-muted-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            <ScrollArea className="flex-1">
                <div className="p-2 pb-20">
                    {displayStructure.length === 0 && searchQuery && (
                        <p className="text-xs text-muted-foreground/50 text-center py-8">No matching nodes</p>
                    )}
                    {displayStructure.map(node => (
                        <TreeItem
                            key={node.node_id}
                            node={node}
                            onSelect={onNodeSelect}
                            selectedId={selectedNodeId}
                            defaultExpanded={!!searchQuery}
                        />
                    ))}
                </div>
            </ScrollArea>
        </div>
    )
}

function getNodeIcon(type: NodeType) {
    switch (type) {
        case "chapter": return Folder
        case "section": return FileText
        case "subsection": return Hash
        case "table": return Table
        case "root": return BookOpen
        default: return FileText
    }
}

interface TreeItemProps {
    node: TreeNode
    level?: number
    onSelect?: (node: TreeNode) => void
    selectedId?: string
    defaultExpanded?: boolean
}

function TreeItem({ node, level = 0, onSelect, selectedId, defaultExpanded }: TreeItemProps) {
    const [expanded, setExpanded] = React.useState(defaultExpanded || level < 1)
    const hasChildren = node.children && node.children.length > 0
    const Icon = getNodeIcon(node.node_type)
    const isSelected = selectedId === node.node_id

    // Auto-expand when search is active
    React.useEffect(() => {
        if (defaultExpanded) setExpanded(true)
    }, [defaultExpanded])

    const handleExpandProxy = (e: React.MouseEvent) => {
        e.stopPropagation()
        setExpanded(!expanded)
    }

    return (
        <div className="select-none">
            <div
                className={cn(
                    "group flex items-center py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors",
                    isSelected
                        ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    level > 0 && "ml-[12px]"
                )}
                onClick={() => {
                    if (onSelect) onSelect(node)
                    if (hasChildren && !expanded && !isSelected) setExpanded(true)
                }}
                style={{ paddingLeft: `${(level * 12) + 8}px` }}
            >
                <span
                    className={cn(
                        "mr-1 text-muted-foreground/50 hover:text-foreground transition-colors p-0.5 rounded-sm",
                        !hasChildren && "invisible"
                    )}
                    onClick={handleExpandProxy}
                >
                    {hasChildren && (
                        expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                    )}
                </span>

                <Icon className={cn(
                    "h-4 w-4 mr-2 opacity-70 group-hover:opacity-100",
                    isSelected ? "text-primary" : "text-muted-foreground"
                )} />

                <span className="truncate flex-1" title={node.title}>
                    {node.title || `Untitled ${node.node_type}`}
                </span>

                {node.start_page > 0 && (
                    <span className="text-[10px] opacity-40 group-hover:opacity-100 ml-2 font-mono">
                        p.{node.start_page}
                    </span>
                )}
            </div>

            {hasChildren && expanded && (
                <div className="border-l border-sidebar-border/20 ml-[15px]">
                    {node.children.map(child => (
                        <TreeItem
                            key={child.node_id}
                            node={child}
                            level={level + 1}
                            onSelect={onSelect}
                            selectedId={selectedId}
                            defaultExpanded={defaultExpanded}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
