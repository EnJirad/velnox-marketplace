import { useCallback, useEffect, useState } from "react";
import type { User } from "@/types";
import { authApi } from "@/lib/api";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState & {
  login: () => void;
  logout: () => void;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const refresh = useCallback(async () => {
    try {
      const { user } = await authApi.me();
      setState({ user, isLoading: false, isAuthenticated: true });
    } catch {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
    window.location.href = `${apiUrl}/auth/google`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
      setState({ user: null, isLoading: false, isAuthenticated: false });
      window.location.href = "/";
    } catch {
      // silent
    }
  }, []);

  return { ...state, login, logout, refresh };
}

// Simple singleton for sharing auth state across components
let authListeners: Array<() => void> = [];
let authState: AuthState = { user: null, isLoading: true, isAuthenticated: false };

export function getAuthState() {
  return authState;
}

export function subscribeAuth(listener: () => void) {
  authListeners.push(listener);
  return () => {
    authListeners = authListeners.filter((l) => l !== listener);
  };
}
