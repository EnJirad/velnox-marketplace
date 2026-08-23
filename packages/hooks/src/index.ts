import { useCallback, useEffect, useState } from "react";
import type { User, Cart } from "@velnox/types";
import { authApi, cartApi } from "@velnox/api";

// ─── Auth Hook ───────────────────────────────────────────

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
    const apiUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as unknown as { env: Record<string, string> }).env
          .VITE_API_URL) ||
      "http://localhost:3001/api";
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

// ─── Cart Hook ───────────────────────────────────────────

interface CartState {
  cart: Cart | null;
  isLoading: boolean;
  itemCount: number;
  totalAmount: number;
}

export function useCart(): CartState & {
  addItem: (productId: string, quantity?: number) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<CartState>({
    cart: null,
    isLoading: true,
    itemCount: 0,
    totalAmount: 0,
  });

  const refresh = useCallback(async () => {
    try {
      const { cart } = await cartApi.get();
      setState({
        cart,
        isLoading: false,
        itemCount: cart?.totalItems ?? 0,
        totalAmount: cart?.totalAmount ?? 0,
      });
    } catch {
      setState({ cart: null, isLoading: false, itemCount: 0, totalAmount: 0 });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addItem = useCallback(
    async (productId: string, quantity = 1) => {
      const { cart } = await cartApi.addItem(productId, quantity);
      setState({
        cart,
        isLoading: false,
        itemCount: cart?.totalItems ?? 0,
        totalAmount: cart?.totalAmount ?? 0,
      });
    },
    []
  );

  const updateItem = useCallback(async (itemId: string, quantity: number) => {
    const { cart } = await cartApi.updateItem(itemId, quantity);
    setState({
      cart,
      isLoading: false,
      itemCount: cart?.totalItems ?? 0,
      totalAmount: cart?.totalAmount ?? 0,
    });
  }, []);

  const removeItem = useCallback(async (itemId: string) => {
    const { cart } = await cartApi.removeItem(itemId);
    setState({
      cart,
      isLoading: false,
      itemCount: cart?.totalItems ?? 0,
      totalAmount: cart?.totalAmount ?? 0,
    });
  }, []);

  return { ...state, addItem, updateItem, removeItem, refresh };
}

// ─── Mobile Hook ─────────────────────────────────────────

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
