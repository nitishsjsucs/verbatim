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

/**
 * Hook to fetch and cache dropdown configurations from the backend.
 * Returns a map of category key -> category config.
 */
export function useDropdownConfig() {
    const [configs, setConfigs] = React.useState<Map<string, DropdownCategory>>(new Map())
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState<string | null>(null)

    const load = React.useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const res = await fetch(`${API_BASE_URL}/dropdown-configs`)
            if (!res.ok) throw new Error(`Failed to load dropdown configs: ${res.statusText}`)
            const data: DropdownConfigsResponse = await res.json()
            const map = new Map<string, DropdownCategory>()
            for (const cfg of data.configs) {
                map.set(cfg.key, cfg)
            }
            setConfigs(map)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error")
        } finally {
            setLoading(false)
        }
    }, [])

    React.useEffect(() => {
        load()
    }, [load])

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
