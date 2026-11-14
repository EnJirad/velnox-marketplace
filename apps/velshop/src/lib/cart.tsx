import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTracking } from "@velnox/shared/lib/track";
import { apiBaseUrl as API_BASE } from "@velnox/shared/lib/sites";
import {
  clearGuestCart,
  readGuestCart,
  writeGuestCart,
  type GuestCartRecord,
  type StorageLike,
} from "@velnox/shared/lib/guest-cart";
import { cartItemsFromResponse } from "@/lib/cart-response";

/**
 * Cart line — the real cart lives in the backend (Neon via API).
 * Guests get a local in-memory cart for browsing; signing in switches to the server cart.
 */
export interface CartLine {
  id: string;
  productId: string;
  /** True when the server priced this line at a wholesale pack tier. */
  wholesale?: boolean;
  packSize?: number | null;
  packs?: number | null;
  pricePerPack?: string | null;
  wholesaleReason?: string | null;
  variantId: string | null;
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
  variantOptionLabels?: Record<string, string>;
  imageUrl?: string;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  total: number;
  add: (product: AddToCartProduct, qty?: number) => void;
  setQty: (productId: string, qty: number, variantId?: string | null) => void;
  remove: (productId: string, variantId?: string | null) => void;
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
  availableStock?: number;
  shopId?: string | null;
  shopName?: string;
  productImageUrl?: string;
  /** Server-resolved wholesale annotation (null/absent for a retail line). */
  wholesale?: boolean;
  packSize?: number | null;
  packs?: number | null;
  pricePerPack?: string | null;
  wholesaleReason?: string | null;
}): CartLine {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId ?? null,
    variantName: item.variantName ?? null,
    variantSku: item.variantSku ?? null,
    variantOptionLabels: item.variantOptionLabels ?? null,
    name: item.productName ?? "สินค้า",
    unit: item.unit ?? "piece",
    price: item.priceSnapshot,
    qty: item.quantity,
    // Use availableStock from backend. Only fall back to quantity if backend didn't provide stock info at all.
    // When availableStock is explicitly 0 or null, treat as out-of-stock (don't use qty as stock).
    stock: item.availableStock != null ? item.availableStock : 9999,
    shopId: item.shopId ?? null,
    shopName: item.shopName,
    imageUrl: item.productImageUrl,
    wholesale: item.wholesale === true,
    packSize: item.packSize ?? null,
    packs: item.packs ?? null,
    pricePerPack: item.pricePerPack ?? null,
    wholesaleReason: item.wholesaleReason ?? null,
  };
}

let guestSeq = 0;

/**
 * localStorage when this runs in a browser, otherwise null. Reading it can throw
 * (Safari private mode, locked-down WebViews), so the access itself is guarded.
 */
function resolveGuestStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const guestStorage = resolveGuestStorage();

/** Only the durable fields survive a refresh; server-only annotations do not. */
function toGuestRecord(line: CartLine): GuestCartRecord {
  return {
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    unit: line.unit,
    price: line.price,
    qty: line.qty,
    stock: line.stock,
    ...(line.imageUrl ? { imageUrl: line.imageUrl } : {}),
    ...(line.shopId ? { shopId: line.shopId } : {}),
  };
}

/** A restored line gets a fresh id so it can never collide with a new guest line. */
function toGuestLine(record: GuestCartRecord): CartLine {
  return {
    id: `guest-${++guestSeq}`,
    productId: record.productId,
    variantId: record.variantId,
    name: record.name,
    unit: record.unit,
    price: record.price,
    qty: record.qty,
    stock: record.stock,
    imageUrl: record.imageUrl,
    shopId: record.shopId ?? null,
  };
}

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
async function apiCartAdd(productId: string, quantity: number, variantId?: string | null): Promise<any> {
  const res = await fetch(`${API_BASE}/customer/cart/add`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId, quantity, variantId: variantId ?? null }),
  });
  const raw = await res.json();
  // A rejected add must be a rejection: the guest-cart merge relies on this to
  // keep only the lines the server refused, instead of dropping them silently.
  if (!res.ok) {
    throw new Error((raw as any)?.error?.message ?? `cart add failed (${res.status})`);
  }
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
  // A rejection must be a REJECTION. The optimistic quantity is already on
  // screen, so a silently-swallowed 400 (over stock, variant gone) would leave
  // the customer looking at a number the server does not have. Throwing lets
  // the caller's `.catch(() => reload())` put the real cart back.
  if (!res.ok) {
    throw new Error((raw as any)?.error?.message ?? `cart update failed (${res.status})`);
  }
  return unwrapJson(raw);
}
async function apiCartItemRemove(cartItemId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/customer/cart/item/${cartItemId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const raw = await res.json();
  // Same rule as the update: a failed removal must resync, or the line stays
  // hidden locally while it still exists on the server.
  if (!res.ok) {
    throw new Error((raw as any)?.error?.message ?? `cart remove failed (${res.status})`);
  }
  return unwrapJson(raw);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { track } = useTracking();

  // Read during the initial render, not in an effect: a guest cart restored in
  // an effect would be momentarily `[]`, and the persist effect could write
  // that empty value over the stored one.
  const [lines, setLines] = useState<CartLine[]>(() =>
    readGuestCart(guestStorage).map(toGuestLine),
  );
  const [syncing, setSyncing] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  /** One guest→server merge per sign-in; `version` bumps must not repeat it. */
  const mergedRef = useRef(false);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  // Mirror guest edits to storage. Skipped while signed in — the server owns the
  // cart then, and writing here would resurrect stale guest lines next sign-in.
  useEffect(() => {
    if (authLoading || isAuthenticated) return;
    writeGuestCart(guestStorage, lines.map(toGuestRecord));
  }, [lines, isAuthenticated, authLoading]);

  // Load the server cart whenever auth state changes (or after mutations), and
  // fold a guest's pending cart into it exactly once on sign-in.
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      mergedRef.current = false;
      setLines([]);
      return;
    }
    let alive = true;
    setSyncing(true);
    // Clear a previous failure so a retry starts from a clean state (a stale
    // error must not survive the request that fixes it).
    setCartError(null);

    const load = async () => {
      if (!mergedRef.current) {
        mergedRef.current = true;
        const pending = readGuestCart(guestStorage);
        if (pending.length > 0) {
          const refused: GuestCartRecord[] = [];
          for (const record of pending) {
            try {
              await apiCartAdd(record.productId, record.qty, record.variantId);
            } catch {
              refused.push(record);
            }
          }
          // Keep ONLY the lines the server refused. Clearing everything would
          // lose their cart; keeping everything would re-add the successful ones
          // and double their quantity on the next sign-in.
          if (refused.length > 0) writeGuestCart(guestStorage, refused);
          else clearGuestCart(guestStorage);
        }
      }
      return apiCartGet();
    };

    load()
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

  /**
   * Latest mutation per cart line.
   *
   * The optimistic update lands immediately and the server then answers with
   * the whole cart. Mashing +/- puts several requests in flight at once, and
   * applying an EARLIER response last would snap the quantity backwards. Only
   * the newest request for a line may apply its result.
   */
  const lineRequestSeq = useRef(new Map<string, number>());

  /**
   * Apply a server cart response.
   *
   * EVERY cart route (`GET`, `POST /add`, `PUT /item/:id`, `DELETE /item/:id`)
   * answers `{ items: [...] }`. This used to be typed as a bare array and call
   * `items.map(...)`, which threw a TypeError on the envelope — and the
   * caller's `.catch()` turned that into `reload()`. Result: a full cart
   * refetch on every single +/- press, which is the "it reloads every time"
   * the owner reported.
   */
  const applyServer = useCallback((payload: unknown) => {
    setCartError(null);
    const items = cartItemsFromResponse(payload);
    // No usable cart in the response: keep the optimistic state instead of
    // refetching (a refetch is what makes the list flash).
    if (items === null) return;
    setLines(items.map(toLine as (i: unknown) => CartLine));
  }, []);

  /** Reserve the next request slot for a line and get its response handler. */
  const beginLineRequest = useCallback(
    (key: string) => {
      const seq = (lineRequestSeq.current.get(key) ?? 0) + 1;
      lineRequestSeq.current.set(key, seq);
      return (payload: unknown) => {
        if (lineRequestSeq.current.get(key) !== seq) return; // superseded
        applyServer(payload);
      };
    },
    [applyServer],
  );

  /** Guest cart identity key: productId + variantId */
  const lineKey = (p: { productId: string; variantId?: string | null }) =>
    `${p.productId}::${p.variantId ?? ""}`;

  const add = useCallback(
    (product: AddToCartProduct, qty = 1) => {
      const price = product.price ?? 0;
      const vid = product.variantId ?? null;
      if (price <= 0 || product.stock <= 0) return;
      track("CART_ADD", { entityId: product.id, value: product.name, context: { qty, variantId: vid } });

      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId: product.id, variantId: vid });
          const existing = prev.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
          if (existing) {
            return prev.map((l) =>
              lineKey({ productId: l.productId, variantId: l.variantId }) === key
                ? { ...l, qty: Math.min(l.stock, l.qty + qty) }
                : l,
            );
          }
          return [...prev, {
            id: `guest-${++guestSeq}`, productId: product.id, variantId: vid,
            name: product.name, unit: product.unit, price,
            qty: Math.min(product.stock, qty), stock: product.stock,
            imageUrl: product.imageUrl,
          }];
        });
        return;
      }

      setLines((prev) => {
        const key = lineKey({ productId: product.id, variantId: vid });
        const existing = prev.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
        if (existing) {
          return prev.map((l) =>
            lineKey({ productId: l.productId, variantId: l.variantId }) === key
              ? { ...l, qty: Math.min(l.stock, l.qty + qty) }
              : l,
          );
        }
        return [...prev, {
          id: `guest-${++guestSeq}`, productId: product.id, variantId: vid,
          name: product.name, unit: product.unit, price,
          qty: Math.min(product.stock, qty), stock: product.stock,
          imageUrl: product.imageUrl,
        }];
      });

      const applyAdd = beginLineRequest(lineKey({ productId: product.id, variantId: vid }));
      apiCartAdd(product.id, qty, vid)
        .then(applyAdd)
        .catch((err) => { console.error("[cart] add failed:", err); reload(); });
    },
    [isAuthenticated, beginLineRequest, reload, track],
  );

  const setQty = useCallback(
    (productId: string, qty: number, variantId?: string | null) => {
      const vid = variantId ?? null;
      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId, variantId: vid });
          const line = prev.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
          if (line && qty <= 0) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.map((l) =>
            lineKey({ productId: l.productId, variantId: l.variantId }) === key
              ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) }
              : l,
          ).filter((l) => l.qty > 0);
        });
        return;
      }
      const key = lineKey({ productId, variantId: vid });
      const line = lines.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
      if (!line) return;
      if (qty <= 0) {
        track("CART_REMOVE", { entityId: line.productId, value: line.name });
        const applyRemove = beginLineRequest(key);
        apiCartItemRemove(line.id).then(applyRemove).catch(() => reload());
        return;
      }
      setLines((prev) => prev.map((l) =>
        lineKey({ productId: l.productId, variantId: l.variantId }) === key
          ? { ...l, qty: Math.max(0, Math.min(l.stock, qty)) }
          : l,
      ));
      // Reserve the slot BEFORE the request so responses are applied in the
      // order the customer clicked, not the order the network answered.
      const applyQty = beginLineRequest(key);
      apiCartItemUpdate(line.id, qty).then(applyQty).catch(() => reload());
    },
    [isAuthenticated, lines, beginLineRequest, reload, track],
  );

  const remove = useCallback(
    (productId: string, variantId?: string | null) => {
      const vid = variantId ?? null;
      if (!isAuthenticated) {
        setLines((prev) => {
          const key = lineKey({ productId, variantId: vid });
          const line = prev.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
          if (line) track("CART_REMOVE", { entityId: line.productId, value: line.name });
          return prev.filter((l) => lineKey({ productId: l.productId, variantId: l.variantId }) !== key);
        });
        return;
      }
      const key = lineKey({ productId, variantId: vid });
      const line = lines.find((l) => lineKey({ productId: l.productId, variantId: l.variantId }) === key);
      if (!line) return;
      track("CART_REMOVE", { entityId: line.productId, value: line.name });
      setLines((prev) => prev.filter((l) => lineKey({ productId: l.productId, variantId: l.variantId }) !== key));
      const applyRemove = beginLineRequest(lineKey({ productId, variantId: vid }));
      apiCartItemRemove(line.id).then(applyRemove).catch(() => reload());
    },
    [isAuthenticated, lines, beginLineRequest, reload, track],
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
