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
import { apiBaseUrl as API_BASE } from "@velnox/shared/lib/sites";

/**
 * Cart line — the real cart lives in the backend (Neon via API).
 * Guests get a local in-memory cart for browsing; signing in switches to the server cart.
 */
export interface CartLine {
  id: string;
  productId: string;
  variantId: string | null;
  /**
   * The selling unit this line is (a set / pack), or null for a plain line of
   * single pieces. `sellingUnitPieces` is how many BASE pieces one of it is
   * worth, so `qty` is always a count of SETS/PACKS — never of pieces — and
   * `qty * sellingUnitPieces` is what the stock authorities consume.
   */
  sellingUnitId: string | null;
  sellingUnitName?: string | null;
  sellingUnitPieces: number;
  variantName?: string | null;
  variantSku?: string | null;
  variantOptionLabels?: string | null;
  name: string;
  unit: string;
  price: number;
  qty: number;
  stock: number;
  /** products.shop_id — how orders are grouped and created (one order per shop) */
  shopId?: string | null;
  shopName?: string;
  imageUrl?: string;
}

export interface AddToCartProduct {
  id: string;
  name: string;
  unit: string;
  price?: number | null;
  stock: number;
  variantId?: string | null;
  /** The set/pack being bought; omit for a plain single-piece line. */
  sellingUnitId?: string | null;
  /** Base pieces per selling unit (1 for a plain line) — display + stock maths. */
  sellingUnitPieces?: number;
  sellingUnitName?: string | null;
  variantOptionLabels?: Record<string, string>;
  imageUrl?: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  total: number;
  add: (product: AddToCartProduct, qty?: number) => void;
  setQty: (productId: string, qty: number, variantId?: string | null, sellingUnitId?: string | null) => void;
  remove: (productId: string, variantId?: string | null, sellingUnitId?: string | null) => void;
  clear: () => void;
  syncing: boolean;
  error: string | null;
  reload: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function toLine(item: {
  id: string;
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  variantSku?: string | null;
  variantOptionLabels?: string | null;
  quantity: number;
  priceSnapshot: number;
  productName?: string;
  unit?: string;
  sellingUnitId?: string | null;
  sellingUnitName?: string | null;
  sellingUnitPieces?: number;
  availableStock?: number;
  shopId?: string | null;
  shopName?: string;
  productImageUrl?: string;
}): CartLine {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId ?? null,
    sellingUnitId: item.sellingUnitId ?? null,
    sellingUnitName: item.sellingUnitName ?? null,
    sellingUnitPieces: Math.max(1, Math.floor(Number(item.sellingUnitPieces) || 1)),
    variantName: item.variantName ?? null,
    variantSku: item.variantSku ?? null,
    variantOptionLabels: item.variantOptionLabels ?? null,
    name: item.productName ?? "สินค้า",
    unit: item.unit ?? "piece",
    price: item.priceSnapshot,
    qty: item.quantity,
    // The backend reports available stock in BASE units. This line is counted in
    // SELLING units, so what fits is the whole SETS/PACKS the stock can cover —
    // a pack of 12 with 20 pieces left is 1 pack, not 1.67.
    // Only fall back when the backend provided no stock at all; an explicit 0 is
    // out-of-stock, not "unknown".
    stock:
      item.availableStock != null
        ? Math.floor(item.availableStock / Math.max(1, Math.floor(Number(item.sellingUnitPieces) || 1)))
        : 9999,
    shopId: item.shopId ?? null,
    shopName: item.shopName,
    imageUrl: item.productImageUrl,
  };
}

let guestSeq = 0;

/** Unwrap the {success, data} envelope that the backend sends. */
function unwrapJson(raw: any): any {
  if (raw && typeof raw === "object" && "data" in raw && raw.success !== undefined) {
    return raw.data;
  }
  return raw;
}

async function apiCartGet(): Promise<{ items: unknown[] } | null> {
  const res = await fetch(`${API_BASE}/customer/cart`, { credentials: "include" });
  if (!res.ok) return null;
  const raw = await res.json();
  return unwrapJson(raw);
}
async function apiCartAdd(
  productId: string,
  quantity: number,
  variantId?: string | null,
  sellingUnitId?: string | null,
): Promise<any> {
  const res = await fetch(`${API_BASE}/customer/cart/add`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, quantity, variantId: variantId ?? null, sellingUnitId: sellingUnitId ?? null }),
  });
  const raw = await res.json();
  return unwrapJson(raw);
}
async function apiCartItemUpdate(cartItemId: string, quantity: number): Promise<any> {
  const res = await fetch(`${API_BASE}/customer/cart/item/${cartItemId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quantity }),
  });
  const raw = await res.json();
  return unwrapJson(raw);
}
async function apiCartItemRemove(cartItemId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/customer/cart/item/${cartItemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const raw = await res.json();
  return unwrapJson(raw);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { track } = useTracking();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
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
        if (alive) setCartError("ไม่สามารถโหลดตะกร้าได้");
      })
      .finally(() => alive && setSyncing(false));
    return () => { alive = false; };
  }, [isAuthenticated, authLoading, version]);

  const applyServer = useCallback((items: unknown[]) => {
    setCartError(null);
    setLines(items.map(toLine as (i: unknown) => CartLine));
  }, []);

  /**
   * Line identity: productId + variantId + SELLING UNIT. One product's "Set 12"
   * and its single pieces are two different lines, both in the cart and on the
   * server (which keys its own unique index the same way).
   */
  const lineKey = (p: { productId: string; variantId?: string | null; sellingUnitId?: string | null }) =>
    `${p.productId}::${p.variantId ?? ""}::${p.sellingUnitId ?? ""}`;

  const add = useCallback(
    (product: AddToCartProduct, qty = 1) => {
      const price = product.price ?? 0;
      const vid = product.variantId ?? null;
      const suId = product.sellingUnitId ?? null;
      const suPieces = Math.max(1, Math.floor(Number(product.sellingUnitPieces) || 1));
      if (price <= 0 || product.stock <= 0) return;
      track("CART_ADD", { entityId: product.id, value: product.name, context: { qty, variantId: vid } });

      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId: product.id, variantId: vid, sellingUnitId: suId });
          const existing = prev.find((l) => lineKey(l) === key);
          if (existing) {
            return prev.map((l) =>
              lineKey(l) === key
                ? { ...l, qty: Math.min(l.stock, l.qty + qty) }
                : l,
            );
          }
          return [...prev, {
            id: `guest-${++guestSeq}`, productId: product.id, variantId: vid,
            sellingUnitId: suId, sellingUnitName: product.sellingUnitName ?? null, sellingUnitPieces: suPieces,
            name: product.name, unit: product.unit, price,
            qty: Math.min(product.stock, qty), stock: product.stock,
            imageUrl: product.imageUrl,
          }];
        });
        return;
      }

      setLines((prev) => {
        const key = lineKey({ productId: product.id, variantId: vid, sellingUnitId: suId });
        const existing = prev.find((l) => lineKey(l) === key);
        if (existing) {
          return prev.map((l) =>
            lineKey(l) === key
              ? { ...l, qty: Math.min(l.stock, l.qty + qty) }
              : l,
          );
        }
        return [...prev, {
          id: `guest-${++guestSeq}`, productId: product.id, variantId: vid,
          sellingUnitId: suId, sellingUnitName: product.sellingUnitName ?? null, sellingUnitPieces: suPieces,
          name: product.name, unit: product.unit, price,
          qty: Math.min(product.stock, qty), stock: product.stock,
          imageUrl: product.imageUrl,
        }];
      });

      apiCartAdd(product.id, qty, vid, suId)
        .then(applyServer)
        .catch((err) => { console.error("[cart] add failed:", err); reload(); });
    },
    [isAuthenticated, applyServer, reload, track],
  );

  const setQty = useCallback(
    (productId: string, qty: number, variantId?: string | null, sellingUnitId?: string | null) => {
      const vid = variantId ?? null;
      const suId = sellingUnitId ?? null;
      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId, variantId: vid, sellingUnitId: suId });
          const line = prev.find((l) => lineKey(l) === key);
          if (line && qty <= 0) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.map((l) =>
            lineKey(l) === key
              ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) }
              : l,
          ).filter((l) => l.qty > 0);
        });
        return;
      }
      const key = lineKey({ productId, variantId: vid, sellingUnitId: suId });
      const line = lines.find((l) => lineKey(l) === key);
      if (!line) return;
      if (qty <= 0) {
        track("CART_REMOVE", { entityId: line.productId, value: line.name });
        apiCartItemRemove(line.id).then(applyServer).catch(() => reload());
        return;
      }
      setLines((prev) => prev.map((l) =>
        lineKey(l) === key
          ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) }
          : l,
      ));
      apiCartItemUpdate(line.id, qty).then(applyServer).catch(() => reload());
    },
    [isAuthenticated, lines, applyServer, reload, track],
  );

  const remove = useCallback(
    (productId: string, variantId?: string | null, sellingUnitId?: string | null) => {
      const vid = variantId ?? null;
      const suId = sellingUnitId ?? null;
      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId, variantId: vid, sellingUnitId: suId });
          const line = prev.find((l) => lineKey(l) === key);
          if (line) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.filter((l) => lineKey(l) !== key);
        });
        return;
      }
      const key = lineKey({ productId, variantId: vid, sellingUnitId: suId });
      const line = lines.find((l) => lineKey(l) === key);
      if (!line) return;
      track("CART_REMOVE", { entityId: line.productId, value: line.name });
      setLines((prev) => prev.filter((l) => lineKey(l) !== key));
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
    () => ({ lines, count, total, add, setQty, remove, clear, syncing, error: cartError, reload }),
    [lines, count, total, add, setQty, remove, clear, syncing, cartError, reload],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (ctx === null) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
