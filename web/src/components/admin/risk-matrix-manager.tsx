"use client"

import React from "react"
import {
    fetchRiskMatrix,
    createRiskMatrixEntry,
    updateRiskMatrixEntry,
    deleteRiskMatrixEntry,
    migrateRiskFields,
    type RiskMatrixEntry,
} from "@/lib/api"

export function RiskMatrixManager() {
    const [entries, setEntries] = React.useState<RiskMatrixEntry[]>([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState("")
    const [migrating, setMigrating] = React.useState(false)
    const [migrationResult, setMigrationResult] = React.useState("")

    // New entry form
    const [newLabel, setNewLabel] = React.useState("")
    const [newMin, setNewMin] = React.useState("")
    const [newMax, setNewMax] = React.useState("")

    // Edit state
    const [editId, setEditId] = React.useState<string | null>(null)
    const [editLabel, setEditLabel] = React.useState("")
    const [editMin, setEditMin] = React.useState("")
    const [editMax, setEditMax] = React.useState("")

    const load = React.useCallback(async () => {
        setLoading(true)
        setError("")
        try {
            const data = await fetchRiskMatrix()
            setEntries(data)
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => { load() }, [load])

    const handleCreate = async () => {
        if (!newLabel.trim()) return
        try {
            await createRiskMatrixEntry({
                label: newLabel.trim(),
                min_score: Number(newMin) || 0,
                max_score: Number(newMax) || 0,
            })
            setNewLabel("")
            setNewMin("")
            setNewMax("")
            load()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to create")
        }
    }

    const handleUpdate = async () => {
        if (!editId || !editLabel.trim()) return
        try {
            await updateRiskMatrixEntry(editId, {
                label: editLabel.trim(),
                min_score: Number(editMin) || 0,
                max_score: Number(editMax) || 0,
            })
            setEditId(null)
            load()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to update")
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this matrix entry?")) return
        try {
            await deleteRiskMatrixEntry(id)
            load()
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to delete")
        }
    }

    const handleMigrate = async () => {
        if (!confirm("This will backfill new risk fields for all existing actionables with safe defaults. Continue?")) return
        setMigrating(true)
        setMigrationResult("")
        try {
            const result = await migrateRiskFields()
            setMigrationResult(result.message)
        } catch (e: unknown) {
            setMigrationResult(e instanceof Error ? e.message : "Migration failed")
        } finally {
            setMigrating(false)
        }
    }

    const startEdit = (entry: RiskMatrixEntry) => {
        setEditId(entry.id)
        setEditLabel(entry.label)
        setEditMin(String(entry.min_score))
        setEditMax(String(entry.max_score))
    }

    const inputCls = "bg-muted/30 text-xs rounded px-2 py-1.5 border border-border/40 focus:border-primary focus:outline-none text-foreground"

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-sm font-semibold text-foreground">Residual Risk Interpretation Matrix</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Configure how residual risk scores map to labels (Low, Medium, High, etc.).
                    The residual risk score is computed as: Inherent Risk &times; Control Score.
                </p>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            {/* Entries table */}
            {loading ? (
                <p className="text-xs text-muted-foreground animate-pulse">Loading...</p>
            ) : (
                <div className="border border-border/30 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-muted/20 text-muted-foreground">
                                <th className="text-left px-3 py-2 font-medium">Label</th>
                                <th className="text-left px-3 py-2 font-medium">Min Score</th>
                                <th className="text-left px-3 py-2 font-medium">Max Score</th>
                                <th className="text-right px-3 py-2 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(entry => (
                                <tr key={entry.id} className="border-t border-border/20 hover:bg-muted/10">
                                    {editId === entry.id ? (
                                        <>
                                            <td className="px-3 py-2">
                                                <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className={inputCls + " w-full"} />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input type="number" value={editMin} onChange={e => setEditMin(e.target.value)} className={inputCls + " w-20"} />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input type="number" value={editMax} onChange={e => setEditMax(e.target.value)} className={inputCls + " w-20"} />
                                            </td>
                                            <td className="px-3 py-2 text-right space-x-1">
                                                <button onClick={handleUpdate} className="text-emerald-400 hover:text-emerald-300 font-medium">Save</button>
                                                <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground">Cancel</button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="px-3 py-2 font-medium">{entry.label}</td>
                                            <td className="px-3 py-2 font-mono text-muted-foreground">{entry.min_score}</td>
                                            <td className="px-3 py-2 font-mono text-muted-foreground">{entry.max_score}</td>
                                            <td className="px-3 py-2 text-right space-x-1">
                                                <button onClick={() => startEdit(entry)} className="text-blue-400 hover:text-blue-300 font-medium">Edit</button>
                                                <button onClick={() => handleDelete(entry.id)} className="text-red-400 hover:text-red-300 font-medium">Del</button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                            {entries.length === 0 && (
                                <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">No entries. Add ranges below.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Add new entry form */}
            <div className="flex items-end gap-2">
                <div className="flex-1">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Label</p>
                    <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. High" className={inputCls + " w-full"} />
                </div>
                <div className="w-24">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Min Score</p>
                    <input type="number" value={newMin} onChange={e => setNewMin(e.target.value)} placeholder="0" className={inputCls + " w-full"} />
                </div>
                <div className="w-24">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Max Score</p>
                    <input type="number" value={newMax} onChange={e => setNewMax(e.target.value)} placeholder="999" className={inputCls + " w-full"} />
                </div>
                <button onClick={handleCreate} className="px-3 py-1.5 text-xs font-medium rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors whitespace-nowrap">
                    + Add
                </button>
            </div>

            {/* Migration section */}
            <div className="border-t border-border/20 pt-4 space-y-2">
                <h4 className="text-xs font-semibold text-foreground/70">Data Migration</h4>
                <p className="text-[11px] text-muted-foreground">
                    Backfill new structured risk fields for all existing actionables that lack the <code className="bg-muted/40 px-1 rounded">impact_dropdown</code> field.
                    Sets safe defaults (Low/Weak, score 1) and recomputes all derived scores.
                </p>
                <button
                    onClick={handleMigrate}
                    disabled={migrating}
                    className="px-4 py-2 text-xs font-medium rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                >
                    {migrating ? "Migrating..." : "Run Risk Fields Migration"}
                </button>
                {migrationResult && (
                    <p className="text-xs text-emerald-400 mt-1">{migrationResult}</p>
                )}
            </div>
        </div>
    )
}
