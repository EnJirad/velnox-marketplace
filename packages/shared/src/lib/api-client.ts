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
  createdAt: number;
}

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: ApiUser | null;
}

// ─── Auth Context (singleton) ───────────────────────────────────────────────

let authState: AuthState = { isLoading: true, isAuthenticated: false, user: null };
let authListeners: Array<() => void> = [];
let authInitPromise: Promise<void> | null = null; // singleton init guard

function notifyAuthListeners() {
  authListeners.forEach((l) => l());
}

async function fetchCurrentUser(): Promise<ApiUser | null> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Backend returns { success: true, data: { user: { ... } } }
    const raw = json?.data?.user ?? json?.user ?? json;
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
    // If auth hasn't been initialized yet, fetch now (singleton)
    if (authState.isLoading) {
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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // Strip /api prefix if present — API_BASE already includes it
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
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
