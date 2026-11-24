/**
 * Velnox API Client
 *
 * Provides useAction, useGet, usePost equivalents that call
 * the Express backend API.
 *
 * Auth is cookie-based (httpOnly JWT). No tokens in localStorage.
 */
import { useCallback, useEffect, useState } from "react";

// ─── API Base URL ───────────────────────────────────────────────────────────

import { apiBaseUrl as API_BASE } from "./sites";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApiUser {
  id: string;
  _id?: string; // backward compat alias for id
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  department: string | null;
  avatarUrl: string | null;
  image?: string | null; // backward compat alias for avatarUrl
  coverUrl: string | null;
  mustChangePassword?: boolean;
  /**
   * Effective VelCenter permission codes (`audit.view`, `staff.manage`, …).
   * owner/admin hold every code in the catalog; `staff` hold what was granted.
   * Used to hide tabs/actions the backend would reject — hiding is UX, the
   * endpoint is the boundary.
   */
  permissions?: string[];
  createdAt: number;
}

/**
 * The one VelCenter permission rule, shared by the session helper below and by
 * the pure tab-policy function in VelCenter: `owner`/`admin` hold every code
 * implicitly and `staff` hold what was granted — exactly the rule
 * `backend/lib/permissions.ts` applies. Mirror only; every endpoint re-checks.
 */
export function roleHoldsPermission(
  role: string | null | undefined,
  permissions: readonly string[] | null | undefined,
  code: string,
): boolean {
  if (role === "owner" || role === "admin") return true;
  return Array.isArray(permissions) && permissions.includes(code);
}

/** Does this signed-in user hold a VelCenter permission code? */
export function userHasPermission(user: ApiUser | null | undefined, code: string): boolean {
  return roleHoldsPermission(user?.role, user?.permissions, code);
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: ApiUser | null;
}

// ─── Token Storage & Cross-Origin Fallback ───────────────────────────────
const ACCESS_TOKEN_KEY = "velnox_access_token";
const REFRESH_TOKEN_KEY = "velnox_refresh_token";

export function getStoredAccessToken(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(ACCESS_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function setAuthTokens(accessToken: string, refreshToken?: string | null): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      if (refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
    }
  } catch { /* ignore storage errors */ }
}

export function clearAuthTokens(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } catch { /* ignore */ }
}

export function checkAndConsumeUrlToken(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");
    const refreshToken = url.searchParams.get("refresh_token");
    if (token) {
      setAuthTokens(token, refreshToken);
      try {
        sessionStorage.removeItem("velnox.googleAuthStart");
      } catch {}
      url.searchParams.delete("token");
      url.searchParams.delete("refresh_token");
      const cleanUrl = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      return true;
    }
  } catch {}
  return false;
}

// Synchronously consume token from URL upon script execution
checkAndConsumeUrlToken();

// ─── Auth Context (singleton) ───────────────────────────────────────────────

let authState: AuthState = { isLoading: true, isAuthenticated: false, user: null };
let authListeners: Array<() => void> = [];
let authInitPromise: Promise<void> | null = null; // singleton init guard

function notifyAuthListeners() {
  authListeners.forEach((l) => l());
}

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuthTokens();
      return false;
    }
    const json = await res.json();
    const tokens = json?.data;
    if (tokens?.accessToken) {
      setAuthTokens(tokens.accessToken, tokens.refreshToken);
      return true;
    }
  } catch {}
  return false;
}

async function fetchCurrentUser(): Promise<ApiUser | null> {
  try {
    const token = getStoredAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include",
      headers,
    });
    if (!res.ok) {
      if (res.status === 401 && token) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          const retryToken = getStoredAccessToken();
          const retryHeaders: Record<string, string> = retryToken ? { Authorization: `Bearer ${retryToken}` } : {};
          const retryRes = await fetch(`${API_BASE}/auth/me`, {
            credentials: "include",
            headers: retryHeaders,
          });
          if (retryRes.ok) {
            const json = await retryRes.json();
            const raw = json?.data?.user ?? json?.data ?? json?.user ?? json;
            if (raw?.id || raw?._id) {
              return {
                id: raw.id ?? raw._id,
                _id: raw.id ?? raw._id,
                name: raw.name ?? null,
                email: raw.email ?? null,
                phone: raw.phone ?? null,
                role: raw.role ?? "customer",
                department: raw.department ?? null,
                avatarUrl: raw.avatar ?? raw.avatarUrl ?? null,
                image: raw.avatar ?? raw.avatarUrl ?? null,
                coverUrl: raw.coverUrl ?? null,
                mustChangePassword: raw.mustChangePassword === true,
                permissions: Array.isArray(raw.permissions)
                  ? raw.permissions.filter((code: unknown): code is string => typeof code === "string")
                  : [],
                createdAt: raw.created_at ?? raw.createdAt ?? 0,
              };
            }
          }
        }
        clearAuthTokens();
      }
      return null;
    }
    const json = await res.json();
    // Backend returns { success: true, data: user } or { success: true, data: { user } }
    const raw = json?.data?.user ?? json?.data ?? json?.user ?? json;
    if (!raw?.id && !raw?._id) return null;
    return {
      id: raw.id ?? raw._id,
      _id: raw.id ?? raw._id,
      name: raw.name ?? null,
      email: raw.email ?? null,
      phone: raw.phone ?? null,
      role: raw.role ?? "customer",
      department: raw.department ?? null,
      avatarUrl: raw.avatar ?? raw.avatarUrl ?? null,
      image: raw.avatar ?? raw.avatarUrl ?? null,
      coverUrl: raw.coverUrl ?? null,
      // Drives VelCenter's force-password-change gate (spec §10).
      mustChangePassword: raw.mustChangePassword === true,
      // VelCenter permission codes — see `userHasPermission` below.
      permissions: Array.isArray(raw.permissions)
        ? raw.permissions.filter((code: unknown): code is string => typeof code === "string")
        : [],
      createdAt: raw.created_at ?? raw.createdAt ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Initialize auth state (call once at app startup).
 * Uses a singleton promise so concurrent calls share the same fetch.
 */
export async function initAuth(): Promise<void> {
  const tokenConsumed = checkAndConsumeUrlToken();
  if (tokenConsumed) {
    authInitPromise = null;
  }
  if (authInitPromise) return authInitPromise;

  authInitPromise = (async () => {
    const user = await fetchCurrentUser();
    authState = {
      isLoading: false,
      isAuthenticated: !!user,
      user,
    };
    notifyAuthListeners();
  })();

  return authInitPromise;
}

/** Get current auth state (synchronous) */
export function getAuthState(): AuthState {
  return authState;
}

/** Subscribe to auth state changes */
export function onAuthChange(listener: () => void): () => void {
  authListeners.push(listener);
  return () => {
    authListeners = authListeners.filter((l) => l !== listener);
  };
}

/**
 * Force-refetch the current user from the backend.
 * Call this after profile mutations (avatar/cover/name update)
 * so the global auth state reflects the changes.
 */
export async function refetchCurrentUser(): Promise<ApiUser | null> {
  const user = await fetchCurrentUser();
  authState = {
    isLoading: false,
    isAuthenticated: !!user,
    user,
  };
  notifyAuthListeners();
  return user;
}

/**
 * Google OAuth sign-in (redirect-based).
 *
 * The actual Google flow is browser-redirect only:
 * 1. window.location.href → /auth/google?returnTo=... (GET, backend redirects to Google)
 * 2. Google → /auth/google/callback (GET, backend creates session + redirects to frontend)
 *
 * The Auth page (Auth.tsx) handles this via window.location.href directly.
 * This function is NOT used for the redirect flow — it exists only for
 * programmatic use-cases where the caller needs to trigger sign-in without
 * a full page reload (e.g., popup flow). In practice the Auth page handles everything.
 */
export async function signInWithGoogle(_code?: string): Promise<ApiUser> {
  // Google OAuth is redirect-based in Velnox. The backend exposes GET /auth/google
  // which redirects to Google. The frontend (Auth.tsx) does window.location.href =
  // to start the flow. This function is a no-op placeholder — callers should
  // use the redirect approach instead.
  throw new Error("Use redirect-based Google sign-in: window.location.href = apiUrl + '/auth/google?returnTo=...'");
}

/** Sign out — invalidate server session and clear all local auth state. */
export async function signOut(): Promise<void> {
  clearAuthTokens();
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch { /* logout request failed — still clear local state */ }

  // Clear all auth-related state
  authState = { isLoading: false, isAuthenticated: false, user: null };
  authInitPromise = null;

  // Clear sessionStorage markers (Google auth flow, etc.)
  try {
    sessionStorage.removeItem("velnox.googleAuthStart");
  } catch { /* ignore */ }

  // Verify session is actually cleared by checking /api/auth/me
  try {
    const verifyRes = await fetch(`${API_BASE}/auth/me`, { credentials: "include" });
    if (verifyRes.ok) {
      // Session still valid — this shouldn't happen but handle gracefully
      console.warn("[auth] Session still valid after logout — retrying");
      await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
    }
  } catch { /* expected — session cleared */ }

  notifyAuthListeners();
}

// ─── React Hooks ────────────────────────────────────────────────────────────

/**
 * useAuth — React hook for authentication state
 */
export function useAuth() {
  const [state, setState] = useState<AuthState>(authState);

  useEffect(() => {
    // If auth hasn't been initialized yet, or token exists but not authenticated, fetch now
    const hasToken = getStoredAccessToken() !== null;
    if (authState.isLoading || (!authState.isAuthenticated && hasToken)) {
      initAuth().then(() => setState({ ...authState }));
    }
    return onAuthChange(() => setState({ ...authState }));
  }, []);

  return {
    isLoading: state.isLoading,
    isAuthenticated: state.isAuthenticated,
    user: state.user,
    signIn: async () => { throw new Error("Use redirect-based sign-in"); },
    signOut,
  };
}

// ─── API Fetch Helpers ──────────────────────────────────────────────────────

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Strip /api prefix if present — API_BASE already includes it
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const token = getStoredAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers as Record<string, string>),
  };
  const res = await fetch(`${API_BASE}${p}`, {
    credentials: "include",
    ...options,
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * useAction — returns a callable function that makes a POST to the API.
 */
export function useAction<TArgs, TResult>(path: string) {
  return useCallback(async (args?: TArgs) => {
    return apiFetch<TResult>(path, {
      method: "POST",
      body: args ? JSON.stringify(args) : undefined,
    });
  }, [path]);
}

/**
 * useGet — returns data and loading state for a GET endpoint.
 */
export function useGet<T>(path: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch<T>(path)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [path, enabled]);

  return { data, loading, error };
}

/**
 * usePost — returns a callable function for POST endpoints.
 */
export function usePost<TArgs, TResult>(path: string) {
  return useCallback(async (args: TArgs) => {
    return apiFetch<TResult>(path, {
      method: "POST",
      body: JSON.stringify(args),
    });
  }, [path]);
}
