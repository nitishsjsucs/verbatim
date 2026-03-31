"use client"

import * as React from "react"
import { Plus, Trash2, Pencil, Check, X, Save, Loader2, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { DropdownCategory, DropdownOption } from "@/lib/use-dropdown-config"
import { API_BASE_URL } from "@/lib/api"

const API_BASE = API_BASE_URL

export function DropdownConfigManager() {
    const [configs, setConfigs] = React.useState<DropdownCategory[]>([])
    const [loading, setLoading] = React.useState(true)
    const [editingCategory, setEditingCategory] = React.useState<string | null>(null)
    const [editingOption, setEditingOption] = React.useState<{ categoryKey: string; index: number } | null>(null)
    const [newCategoryMode, setNewCategoryMode] = React.useState(false)

    // New category form state
    const [newCatKey, setNewCatKey] = React.useState("")
    const [newCatLabel, setNewCatLabel] = React.useState("")

    // New option form state
    const [addingOptionTo, setAddingOptionTo] = React.useState<string | null>(null)
    const [newOptLabel, setNewOptLabel] = React.useState("")
    const [newOptValue, setNewOptValue] = React.useState("")

    // Edit state
    const [editLabel, setEditLabel] = React.useState("")
    const [editValue, setEditValue] = React.useState("")

    const loadConfigs = React.useCallback(async () => {
        try {
            setLoading(true)
            console.log(`[DropdownConfig] Fetching from: ${API_BASE}/dropdown-configs`)
            const res = await fetch(`${API_BASE}/dropdown-configs`, { headers: { "ngrok-skip-browser-warning": "1" } })
            console.log(`[DropdownConfig] Response status: ${res.status}`)
            if (!res.ok) {
                const text = await res.text()
                console.error(`[DropdownConfig] Error response:`, text.substring(0, 200))
                throw new Error(`Failed to load configs (${res.status})`)
            }
            const data = await res.json()
            console.log(`[DropdownConfig] Loaded ${data.configs?.length || 0} configs`)
            setConfigs(data.configs || [])
        } catch (err) {
            console.error(`[DropdownConfig] Load error:`, err)
            toast.error(err instanceof Error ? err.message : "Failed to load configs")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        loadConfigs()
    }, [loadConfigs])

    const handleCreateCategory = async () => {
        if (!newCatKey.trim() || !newCatLabel.trim()) {
            toast.error("Key and label are required")
            return
        }
        try {
            const res = await fetch(`${API_BASE}/dropdown-configs`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
                body: JSON.stringify({ key: newCatKey, label: newCatLabel, options: [] }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || "Failed to create category")
            }
            toast.success(`Category "${newCatLabel}" created`)
            setNewCategoryMode(false)
            setNewCatKey("")
            setNewCatLabel("")
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to create category")
        }
    }

    const handleDeleteCategory = async (key: string) => {
        if (!confirm(`Delete category "${key}"? This cannot be undone.`)) return
        try {
            const res = await fetch(`${API_BASE}/dropdown-configs/${key}`, { method: "DELETE", headers: { "ngrok-skip-browser-warning": "1" } })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || "Failed to delete category")
            }
            toast.success(`Category "${key}" deleted`)
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete category")
        }
    }

    const handleAddOption = async (categoryKey: string) => {
        if (!newOptLabel.trim() || !newOptValue.trim()) {
            toast.error("Label and value are required")
            return
        }
        const value = parseInt(newOptValue, 10)
        if (isNaN(value)) {
            toast.error("Value must be a number")
            return
        }
        try {
            const res = await fetch(`${API_BASE}/dropdown-configs/${categoryKey}/options`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
                body: JSON.stringify({ label: newOptLabel, value }),
            })
            if (!res.ok) throw new Error("Failed to add option")
            toast.success("Option added")
            setAddingOptionTo(null)
            setNewOptLabel("")
            setNewOptValue("")
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to add option")
        }
    }

    const handleUpdateOption = async (categoryKey: string, index: number) => {
        if (!editLabel.trim()) {
            toast.error("Label is required")
            return
        }
        const value = editValue.trim() ? parseInt(editValue, 10) : undefined
        if (editValue.trim() && isNaN(value!)) {
            toast.error("Value must be a number")
            return
        }
        try {
            const body: { label?: string; value?: number } = { label: editLabel }
            if (value !== undefined) body.value = value
            const res = await fetch(`${API_BASE}/dropdown-configs/${categoryKey}/options/${index}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
                body: JSON.stringify(body),
            })
            if (!res.ok) throw new Error("Failed to update option")
            toast.success("Option updated")
            setEditingOption(null)
            setEditLabel("")
            setEditValue("")
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update option")
        }
    }

    const handleDeleteOption = async (categoryKey: string, index: number) => {
        if (!confirm("Delete this option?")) return
        try {
            const res = await fetch(`${API_BASE}/dropdown-configs/${categoryKey}/options/${index}`, {
                method: "DELETE",
                headers: { "ngrok-skip-browser-warning": "1" },
            })
            if (!res.ok) throw new Error("Failed to delete option")
            toast.success("Option deleted")
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to delete option")
        }
    }

    const handleUpdateCategoryLabel = async (key: string, newLabel: string) => {
        if (!newLabel.trim()) {
            toast.error("Label is required")
            return
        }
        try {
            const res = await fetch(`${API_BASE}/dropdown-configs/${key}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
                body: JSON.stringify({ label: newLabel }),
            })
            if (!res.ok) throw new Error("Failed to update category")
            toast.success("Category updated")
            setEditingCategory(null)
            setEditLabel("")
            loadConfigs()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Failed to update category")
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                <span className="text-sm text-muted-foreground">Loading dropdown configurations...</span>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <Settings className="h-5 w-5 text-primary" />
                        Dropdown Configuration Manager
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                        Manage dropdown categories and options for actionables. Changes reflect immediately across all views.
                    </p>
                </div>
                <button
                    onClick={() => setNewCategoryMode(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
                >
                    <Plus className="h-3.5 w-3.5" /> New Category
                </button>
            </div>

            {/* New Category Form */}
            {newCategoryMode && (
                <div className="border border-border/40 rounded-lg p-4 bg-muted/20">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Create New Category</h3>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                            <label className="text-xs text-muted-foreground/70 mb-1 block">Key (unique identifier)</label>
                            <input
                                value={newCatKey}
                                onChange={e => setNewCatKey(e.target.value)}
                                placeholder="e.g. priority"
                                className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted-foreground/70 mb-1 block">Display Label</label>
                            <input
                                value={newCatLabel}
                                onChange={e => setNewCatLabel(e.target.value)}
                                placeholder="e.g. Priority"
                                className="w-full bg-background text-xs rounded-md px-2.5 py-1.5 border border-border/40 focus:border-border focus:outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCreateCategory}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors font-medium"
                        >
                            <Check className="h-3 w-3" /> Create
                        </button>
                        <button
                            onClick={() => {
                                setNewCategoryMode(false)
                                setNewCatKey("")
                                setNewCatLabel("")
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-muted/30 text-muted-foreground hover:bg-muted/50 transition-colors"
                        >
                            <X className="h-3 w-3" /> Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Categories List */}
            <div className="space-y-4">
                {configs.map(cat => (
                    <div key={cat.key} className="border border-border/40 rounded-lg overflow-hidden">
                        {/* Category Header */}
                        <div className="bg-muted/20 px-4 py-3 flex items-center justify-between border-b border-border/20">
                            {editingCategory === cat.key ? (
                                <div className="flex items-center gap-2 flex-1">
                                    <input
                                        value={editLabel}
                                        onChange={e => setEditLabel(e.target.value)}
                                        className="bg-background text-sm rounded px-2 py-1 border border-border/40 focus:border-border focus:outline-none"
                                        autoFocus
                                    />
                                    <button
                                        onClick={() => handleUpdateCategoryLabel(cat.key, editLabel)}
                                        className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingCategory(null)
                                            setEditLabel("")
                                        }}
                                        className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <h3 className="text-sm font-semibold text-foreground">{cat.label}</h3>
                                        <p className="text-xs text-muted-foreground/50 font-mono">Key: {cat.key}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                setEditingCategory(cat.key)
                                                setEditLabel(cat.label)
                                            }}
                                            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                            title="Edit label"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCategory(cat.key)}
                                            className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                                            title="Delete category"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Options List */}
                        <div className="p-4 space-y-2">
                            {cat.options.length === 0 && (
                                <p className="text-xs text-muted-foreground/40 italic">No options yet</p>
                            )}
                            {cat.options.map((opt, idx) => (
                                <div
                                    key={idx}
                                    className="flex items-center justify-between bg-background rounded-md px-4 py-3 border border-border/30 hover:border-border/50 transition-colors"
                                >
                                    {editingOption?.categoryKey === cat.key && editingOption.index === idx ? (
                                        <div className="flex items-center gap-2 flex-1">
                                            <input
                                                value={editLabel}
                                                onChange={e => setEditLabel(e.target.value)}
                                                placeholder="Label"
                                                className="bg-muted/30 text-sm rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none flex-1 text-foreground"
                                                autoFocus
                                            />
                                            <input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                placeholder="Value"
                                                type="number"
                                                className="bg-muted/30 text-sm rounded px-2 py-1.5 border border-border/40 focus:border-border focus:outline-none w-24 text-foreground"
                                            />
                                            <button
                                                onClick={() => handleUpdateOption(cat.key, idx)}
                                                className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400"
                                            >
                                                <Check className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingOption(null)
                                                    setEditLabel("")
                                                    setEditValue("")
                                                }}
                                                className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex items-center gap-4 flex-1">
                                                <span className="text-sm font-medium text-foreground min-w-[100px]">{opt.label}</span>
                                                <span className="text-sm text-muted-foreground font-mono bg-muted/20 px-2 py-1 rounded">
                                                    {opt.value}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => {
                                                        setEditingOption({ categoryKey: cat.key, index: idx })
                                                        setEditLabel(opt.label)
                                                        setEditValue(opt.value.toString())
                                                    }}
                                                    className="p-1.5 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                                                    title="Edit option"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteOption(cat.key, idx)}
                                                    className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                                                    title="Delete option"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}

                            {/* Add Option Form */}
                            {addingOptionTo === cat.key ? (
                                <div className="flex items-center gap-2 bg-muted/10 rounded-md px-3 py-2 border border-dashed border-border/40">
                                    <input
                                        value={newOptLabel}
                                        onChange={e => setNewOptLabel(e.target.value)}
                                        placeholder="Label"
                                        className="bg-background text-xs rounded px-2 py-1 border border-border/40 focus:border-border focus:outline-none flex-1"
                                        autoFocus
                                    />
                                    <input
                                        value={newOptValue}
                                        onChange={e => setNewOptValue(e.target.value)}
                                        placeholder="Value"
                                        type="number"
                                        className="bg-background text-xs rounded px-2 py-1 border border-border/40 focus:border-border focus:outline-none w-20"
                                    />
                                    <button
                                        onClick={() => handleAddOption(cat.key)}
                                        className="p-1 rounded hover:bg-emerald-500/20 text-emerald-400"
                                    >
                                        <Check className="h-3 w-3" />
                                    </button>
                                    <button
                                        onClick={() => {
                                            setAddingOptionTo(null)
                                            setNewOptLabel("")
                                            setNewOptValue("")
                                        }}
                                        className="p-1 rounded hover:bg-muted/50 text-muted-foreground"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setAddingOptionTo(cat.key)}
                                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-md border border-dashed border-border/40 text-muted-foreground hover:text-foreground hover:border-border/60 transition-colors"
                                >
                                    <Plus className="h-3 w-3" /> Add Option
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {configs.length === 0 && !newCategoryMode && (
                <div className="text-center py-12 text-muted-foreground/50">
                    <Settings className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No dropdown categories configured yet</p>
                </div>
            )}
        </div>
    )
}
