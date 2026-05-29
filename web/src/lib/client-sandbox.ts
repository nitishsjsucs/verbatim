/**
 * Client Sandbox System
 * 
 * Provides local-only editing for client users.
 * Client modifications are stored in localStorage and never synced to the server.
 * Admin users bypass this system and modify master data directly.
 */

import type { EnrichedActionable } from "./intelligence-types";

/**
 * Get the sandbox edits for a specific document.
 * Returns a map of actionable_id -> partial edits.
 */
export function getClientSandbox(docId: string): Record<string, Partial<EnrichedActionable>> {
    try {
        const key = `intel_sandbox_${docId}`;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : {};
    } catch {
        return {};
    }
}

/**
 * Save a client edit to the local sandbox.
 * Does NOT sync to server.
 */
export function saveClientEdit(
    docId: string,
    itemId: string,
    patch: Partial<EnrichedActionable>
): void {
    try {
        const sandbox = getClientSandbox(docId);
        sandbox[itemId] = { ...(sandbox[itemId] || {}), ...patch };
        const key = `intel_sandbox_${docId}`;
        localStorage.setItem(key, JSON.stringify(sandbox));
    } catch (err) {
        console.error("Failed to save client edit:", err);
    }
}

/**
 * Clear all local edits for a document.
 */
export function clearClientSandbox(docId: string): void {
    try {
        const key = `intel_sandbox_${docId}`;
        localStorage.removeItem(key);
    } catch (err) {
        console.error("Failed to clear client sandbox:", err);
    }
}

/**
 * Apply client edits on top of master actionables.
 * Returns a new array with edits overlaid.
 */
export function applyClientEdits(
    actionables: EnrichedActionable[],
    docId: string
): EnrichedActionable[] {
    const sandbox = getClientSandbox(docId);
    if (Object.keys(sandbox).length === 0) {
        return actionables;
    }
    
    return actionables.map((a) => ({
        ...a,
        ...(sandbox[a.id] || {}),
    }));
}

/**
 * Check if a document has any local edits.
 */
export function hasClientEdits(docId: string): boolean {
    const sandbox = getClientSandbox(docId);
    return Object.keys(sandbox).length > 0;
}

/**
 * Get count of edited actionables for a document.
 */
export function getEditCount(docId: string): number {
    const sandbox = getClientSandbox(docId);
    return Object.keys(sandbox).length;
}
