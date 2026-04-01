import { API_BASE_URL } from "./api"
import type { TestingItem, TestingAdHocWindow } from "./types"

const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" }

// ---------------------------------------------------------------------------
// Testing Items
// ---------------------------------------------------------------------------

export async function fetchTestingItems(section?: string, status?: string): Promise<{ items: TestingItem[]; total: number }> {
    const params = new URLSearchParams()
    if (section) params.set("section", section)
    if (status) params.set("status", status)
    const qs = params.toString()
    const res = await fetch(`${API_BASE_URL}/testing/items${qs ? `?${qs}` : ""}`, { headers })
    if (!res.ok) throw new Error(`Failed to fetch testing items: ${res.status}`)
    return res.json()
}

export async function fetchTestingItem(itemId: string): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}`, { headers })
    if (!res.ok) throw new Error(`Failed to fetch testing item: ${res.status}`)
    return res.json()
}

export async function pullActionablesToTesting(actionableIds?: string[]): Promise<{ pulled: number; items: TestingItem[] }> {
    const res = await fetch(`${API_BASE_URL}/testing/pull-actionables`, {
        method: "POST",
        headers,
        body: JSON.stringify({ actionable_ids: actionableIds || [] }),
    })
    if (!res.ok) throw new Error(`Failed to pull actionables: ${res.status}`)
    return res.json()
}

export async function updateTestingItem(itemId: string, updates: Record<string, unknown>): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(updates),
    })
    if (!res.ok) throw new Error(`Failed to update testing item: ${res.status}`)
    return res.json()
}

// ---------------------------------------------------------------------------
// Workflow Actions
// ---------------------------------------------------------------------------

export async function assignTestingItem(itemId: string, body: {
    tester_id: string; tester_name: string; testing_deadline: string; assigned_by: string
}): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/assign`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to assign testing item: ${res.status}`)
    return res.json()
}

export async function forwardToMaker(itemId: string, body: {
    maker_id: string; maker_name: string; forwarded_by: string
}): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/forward-to-maker`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to forward to maker: ${res.status}`)
    return res.json()
}

export async function submitMakerDecision(itemId: string, body: {
    decision: "open" | "close"; maker_deadline?: string; actor: string
}): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/maker-decision`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to submit maker decision: ${res.status}`)
    return res.json()
}

export async function checkerConfirmDeadline(itemId: string, body: {
    checker_name: string
}): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/checker-confirm`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to confirm deadline: ${res.status}`)
    return res.json()
}

export async function submitTesterVerdict(itemId: string, body: {
    verdict: "pass" | "reject"; reason?: string; tester_name: string
}): Promise<TestingItem> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/tester-verdict`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to submit verdict: ${res.status}`)
    return res.json()
}

export async function addTestingComment(itemId: string, body: {
    author: string; role: string; text: string
}): Promise<{ comment: Record<string, unknown>; item: TestingItem }> {
    const res = await fetch(`${API_BASE_URL}/testing/items/${itemId}/comment`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to add comment: ${res.status}`)
    return res.json()
}

// ---------------------------------------------------------------------------
// Ad-Hoc Windows
// ---------------------------------------------------------------------------

export async function fetchTestingWindows(): Promise<{ windows: TestingAdHocWindow[] }> {
    const res = await fetch(`${API_BASE_URL}/testing/windows`, { headers })
    if (!res.ok) throw new Error(`Failed to fetch testing windows: ${res.status}`)
    return res.json()
}

export async function createTestingWindow(body: {
    name: string; start_date: string; end_date: string;
    completion_deadline: string; themes: string[]; created_by: string
}): Promise<TestingAdHocWindow> {
    const res = await fetch(`${API_BASE_URL}/testing/windows`, {
        method: "POST", headers, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Failed to create testing window: ${res.status}`)
    return res.json()
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function fetchTestingStats(): Promise<{
    total: number; by_section: Record<string, number>; by_status: Record<string, number>
}> {
    const res = await fetch(`${API_BASE_URL}/testing/stats`, { headers })
    if (!res.ok) throw new Error(`Failed to fetch testing stats: ${res.status}`)
    return res.json()
}
