/**
 * Intelligence System Auth Client.
 *
 * Manages JWT-based authentication for the multi-tenant intelligence system.
 * Completely separate from the main app's better-auth system.
 */

import { API_BASE_URL } from "./api";

const TOKEN_KEY = "intel_token";
const USER_KEY = "intel_user";

export type IntelRole = "admin" | "client";

export interface IntelUser {
    account_id: string;
    username: string;
    role: IntelRole;
    display_name: string;
    institution_tags: string[];
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

export function getIntelToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function getIntelUser(): IntelUser | null {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as IntelUser;
    } catch {
        return null;
    }
}

export function setIntelSession(token: string, user: IntelUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearIntelSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export function isIntelAuthenticated(): boolean {
    return !!getIntelToken();
}

export function isIntelAdmin(): boolean {
    return getIntelUser()?.role === "admin";
}

export function isIntelClient(): boolean {
    return getIntelUser()?.role === "client";
}

// ---------------------------------------------------------------------------
// API helpers (with auth header)
// ---------------------------------------------------------------------------

export function intelAuthFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const token = getIntelToken();
    return fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            "ngrok-skip-browser-warning": "1",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
}

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

export interface LoginResult {
    success: boolean;
    error?: string;
    user?: IntelUser;
}

export async function intelLogin(username: string, password: string): Promise<LoginResult> {
    try {
        const res = await fetch(`${API_BASE_URL}/intel-auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "ngrok-skip-browser-warning": "1",
            },
            body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            return { success: false, error: body.detail || "Login failed" };
        }

        const data = await res.json();
        const user: IntelUser = {
            account_id: data.account_id,
            username: data.username,
            role: data.role,
            display_name: data.display_name,
            institution_tags: data.institution_tags || [],
        };
        setIntelSession(data.token, user);
        return { success: true, user };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
}

export function intelLogout(): void {
    clearIntelSession();
}

export async function fetchIntelMe(): Promise<IntelUser | null> {
    try {
        const res = await intelAuthFetch("/intel-auth/me");
        if (!res.ok) return null;
        const data = await res.json();
        const user: IntelUser = {
            account_id: data.account_id,
            username: data.username,
            role: data.role,
            display_name: data.display_name,
            institution_tags: data.institution_tags || [],
        };
        // Update local cache
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        return user;
    } catch {
        return null;
    }
}
