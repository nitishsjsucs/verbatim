"use client"

import * as React from "react"
import { API_BASE_URL } from "@/lib/api"

export interface DropdownOption {
    label: string
    value: number
}

export interface DropdownCategory {
    key: string
    label: string
    options: DropdownOption[]
}

interface DropdownConfigsResponse {
    configs: DropdownCategory[]
}

// ── Module-level shared cache ──────────────────────────────────────────
// All hook instances share a single fetch so we never fire N duplicate
// requests when N components mount at the same time.
let _cachedMap: Map<string, DropdownCategory> | null = null
let _inflight: Promise<Map<string, DropdownCategory>> | null = null

async function fetchDropdownConfigs(): Promise<Map<string, DropdownCategory>> {
    if (_cachedMap) return _cachedMap
    if (_inflight) return _inflight

    _inflight = (async () => {
        const res = await fetch(`${API_BASE_URL}/dropdown-configs`, {
            headers: { "ngrok-skip-browser-warning": "1" },
        })
        if (!res.ok) throw new Error(`Failed to load dropdown configs: ${res.statusText}`)
        const data: DropdownConfigsResponse = await res.json()
        const map = new Map<string, DropdownCategory>()
        for (const cfg of data.configs) {
            map.set(cfg.key, cfg)
        }
        _cachedMap = map
        return map
    })()

    try {
        return await _inflight
    } catch (err) {
        _inflight = null   // allow retry on failure
        throw err
    }
}

/**
 * Hook to fetch and cache dropdown configurations from the backend.
 * Returns a map of category key -> category config.
 */
export function useDropdownConfig() {
    const [configs, setConfigs] = React.useState<Map<string, DropdownCategory>>(_cachedMap ?? new Map())
    const [loading, setLoading] = React.useState(!_cachedMap)
    const [error, setError] = React.useState<string | null>(null)

    const load = React.useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            _cachedMap = null  // bust cache on explicit reload
            _inflight = null
            const map = await fetchDropdownConfigs()
            setConfigs(map)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        if (_cachedMap) {
            setConfigs(_cachedMap)
            setLoading(false)
            return
        }
        fetchDropdownConfigs()
            .then(map => { setConfigs(map); setLoading(false) })
            .catch(err => { setError(err instanceof Error ? err.message : "Unknown error"); setLoading(false) })
    }, [])

    const getOptions = React.useCallback(
        (categoryKey: string): DropdownOption[] => {
            return configs.get(categoryKey)?.options || []
        },
        [configs]
    )

    const getLabel = React.useCallback(
        (categoryKey: string): string => {
            return configs.get(categoryKey)?.label || categoryKey
        },
        [configs]
    )

    return { configs, loading, error, load, getOptions, getLabel }
}
