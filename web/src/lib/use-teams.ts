"use client"

import * as React from "react"
import { fetchTeams } from "./api"
import type { Team } from "./types"
import { MIXED_TEAM_CLASSIFICATION } from "./types"
import { syncTeamColors } from "./status-config"

/**
 * Default fallback colors for teams not yet in the database.
 * Used only during initial load or if the API is unreachable.
 */
const FALLBACK_COLORS = { bg: "bg-muted", text: "text-muted-foreground", header: "bg-muted" }

/**
 * Global in-memory cache so multiple components share the same fetch.
 * Avoids redundant API calls across pages/components.
 */
let _cachedTeams: Team[] | null = null
let _fetchPromise: Promise<Team[]> | null = null

function _fetchOnce(): Promise<Team[]> {
    if (_cachedTeams) return Promise.resolve(_cachedTeams)
    if (_fetchPromise) return _fetchPromise
    _fetchPromise = fetchTeams()
        .then(teams => {
            _cachedTeams = teams
            _fetchPromise = null
            // Sync the global WORKSTREAM_COLORS so existing code using getWorkstreamClass works
            syncTeamColors(teams)
            return teams
        })
        .catch(() => { _fetchPromise = null; return [] })
    return _fetchPromise
}

/** Invalidate cache so next useTeams call re-fetches. */
export function invalidateTeamsCache() {
    _cachedTeams = null
    _fetchPromise = null
}

/**
 * React hook — returns dynamic team data from the database.
 *
 * Provides:
 *  - `teams`: Full Team[] array (ordered, system teams first)
 *  - `teamNames`: string[] of team names (excludes system Mixed Team)
 *  - `allTeamNames`: string[] including Mixed Team Projects
 *  - `teamColors`: Record<string, Team["colors"]> lookup by name
 *  - `getTeamClass`: (name: string) => string — Tailwind class string for badges
 *  - `loading`: boolean
 *  - `refresh`: () => void — force re-fetch
 */
export function useTeams() {
    const [teams, setTeams] = React.useState<Team[]>(_cachedTeams || [])
    const [loading, setLoading] = React.useState(!_cachedTeams)

    const load = React.useCallback(() => {
        setLoading(true)
        _fetchOnce().then(t => { setTeams(t); setLoading(false) })
    }, [])

    React.useEffect(() => { load() }, [load])

    const refresh = React.useCallback(() => {
        invalidateTeamsCache()
        setLoading(true)
        fetchTeams()
            .then(t => { _cachedTeams = t; syncTeamColors(t); setTeams(t); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    // Derived values
    const teamNames = React.useMemo(
        () => teams.filter(t => !t.is_system).map(t => t.name),
        [teams],
    )

    const allTeamNames = React.useMemo(
        () => teams.map(t => t.name),
        [teams],
    )

    const teamColors = React.useMemo(() => {
        const map: Record<string, Team["colors"]> = {}
        for (const t of teams) map[t.name] = t.colors
        return map
    }, [teams])

    const getTeamClass = React.useCallback(
        (name: string): string => {
            const c = teamColors[name]
            if (c) return `${c.bg} ${c.text}`
            // Unknown team — use fallback
            return `${FALLBACK_COLORS.bg} ${FALLBACK_COLORS.text}`
        },
        [teamColors],
    )

    const getTeamColors = React.useCallback(
        (name: string): Team["colors"] => {
            return teamColors[name] || FALLBACK_COLORS
        },
        [teamColors],
    )

    return {
        teams,
        teamNames,
        allTeamNames,
        teamColors,
        getTeamClass,
        getTeamColors,
        loading,
        refresh,
        MIXED_TEAM: MIXED_TEAM_CLASSIFICATION,
    }
}
