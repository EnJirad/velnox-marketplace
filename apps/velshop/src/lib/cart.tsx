import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTracking } from "@velnox/shared/lib/track";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Cart line — the real cart lives in the backend (Neon via API).
 * Guests get a local in-memory cart for browsing; signing in switches to the server cart.
 */
export interface CartLine {
  id: string;
  productId: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
  stock: number;
  shopName?: string;
  imageUrl?: string;
}

export interface AddToCartProduct {
  id: string;
  name: string;
  unit: string;
  price?: number | null;
  stock: number;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  total: number;
  add: (product: AddToCartProduct, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  syncing: boolean;
  reload: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function toLine(item: {
  id: string;
  productId: string;
  quantity: number;
  priceSnapshot: number;
  productName?: string;
  unit?: string;
  availableStock?: number;
  shopName?: string;
  productImageUrl?: string;
}): CartLine {
  return {
    id: item.id,
    productId: item.productId,
    name: item.productName ?? "สินค้า",
    unit: item.unit ?? "piece",
    price: item.priceSnapshot,
    qty: item.quantity,
    stock: item.availableStock ?? item.quantity,
    shopName: item.shopName,
    imageUrl: item.productImageUrl,
  };
}

let guestSeq = 0;

async function apiCartGet(): Promise<{ items: unknown[] } | null> {
  const res = await fetch(`${API_BASE}/api/customer/cart`, { credentials: "include" });
  if (!res.ok) return null;
  return res.json();
}
async function apiCartAdd(productId: string, quantity: number, variantId?: string | null) {
  const res = await fetch(`${API_BASE}/api/customer/cart/add`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, quantity, variantId }),
  });
  return res.json();
}
async function apiCartItemUpdate(cartItemId: string, quantity: number) {
  const res = await fetch(`${API_BASE}/api/customer/cart/item/${cartItemId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  return res.json();
}
async function apiCartItemRemove(cartItemId: string) {
  const res = await fetch(`${API_BASE}/api/customer/cart/item/${cartItemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  return res.json();
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { track } = useTracking();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Load the server cart whenever auth state changes (or after mutations).
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setLines([]);
      return;
    }
    let alive = true;
    setSyncing(true);
    apiCartGet()
      .then((cart) => {
        if (!alive) return;
        setLines(((cart as any)?.items ?? []).map(toLine));
      })
      .catch((err) => {
        console.error("[cart] load failed:", err);
        if (alive) setLines([]);
      })
      .finally(() => alive && setSyncing(false));
    return () => { alive = false; };
  }, [isAuthenticated, authLoading, version]);

  const applyServer = useCallback((items: unknown[]) => {
    setLines(items.map(toLine as (i: unknown) => CartLine));
  }, []);

  const add = useCallback(
    (product: AddToCartProduct, qty = 1) => {
      const price = product.price ?? 0;
      if (price <= 0 || product.stock <= 0) return;
      track("CART_ADD", { entityId: product.id, value: product.name, context: { qty } });
      if (!isAuthenticated) {
        setLines((prev) => {
          const existing = prev.find((l) => l.productId === product.id);
          if (existing) {
            return prev.map((l) =>
              l.productId === product.id ? { ...l, qty: Math.min(l.stock, l.qty + qty) } : l,
            );
          }
          return [...prev, {
            id: `guest-${++guestSeq}`, productId: product.id, name: product.name,
            unit: product.unit, price, qty: Math.min(product.stock, qty), stock: product.stock,
          }];
        });
        return;
      }
      setLines((prev) => {
        const existing = prev.find((l) => l.productId === product.id);
        if (existing) {
          return prev.map((l) =>
            l.productId === product.id ? { ...l, qty: Math.min(l.stock, l.qty + qty) } : l,
          );
        }
        return [...prev, {
          id: `guest-${++guestSeq}`, productId: product.id, name: product.name,
          unit: product.unit, price, qty: Math.min(product.stock, qty), stock: product.stock,
        }];
      });
      apiCartAdd(product.id, qty)
        .then(applyServer)
        .catch((err) => { console.error("[cart] add failed:", err); reload(); });
    },
    [isAuthenticated, applyServer, reload, track],
  );

  const setQty = useCallback(
    (productId: string, qty: number) => {
      if (!isAuthenticated) {
        setLines((prev) => {
          const line = prev.find((l) => l.productId === productId);
          if (line && qty <= 0) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.map((l) =>
            l.productId === productId ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) } : l,
          ).filter((l) => l.qty > 0);
        });
        return;
      }
      const line = lines.find((l) => l.productId === productId);
      if (!line) return;
      if (qty <= 0) {
        track("CART_REMOVE", { entityId: line.productId, value: line.name });
        apiCartItemRemove(line.id).then(applyServer).catch(() => reload());
        return;
      }
      setLines((prev) => prev.map((l) =>
        l.productId === productId ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) } : l,
      ));
      apiCartItemUpdate(line.id, qty).then(applyServer).catch(() => reload());
    },
    [isAuthenticated, lines, applyServer, reload, track],
  );

  const remove = useCallback(
    (productId: string) => {
      if (!isAuthenticated) {
        setLines((prev) => {
          const line = prev.find((l) => l.productId === productId);
          if (line) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.filter((l) => l.productId !== productId);
        });
        return;
      }
      const line = lines.find((l) => l.productId === productId);
      if (!line) return;
      track("CART_REMOVE", { entityId: line.productId, value: line.name });
      setLines((prev) => prev.filter((l) => l.productId !== productId));
      apiCartItemRemove(line.id).then(applyServer).catch(() => reload());
    },
    [isAuthenticated, lines, applyServer, reload, track],
  );

  const clear = useCallback(() => setLines([]), []);

  const { count, total } = useMemo(() => ({
    count: lines.reduce((sum, l) => sum + l.qty, 0),
    total: lines.reduce((sum, l) => sum + l.qty * l.price, 0),
  }), [lines]);

  const value = useMemo(
    () => ({ lines, count, total, add, setQty, remove, clear, syncing, reload }),
    [lines, count, total, add, setQty, remove, clear, syncing, reload],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (ctx === null) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
