/**
 * MVP cart state for VelShop.
 *
 * The cart is SERVER state: `GET /api/mvp/cart` returns every cart the caller
 * owns (ONE PER SELLER — the schema makes a mixed-seller cart unrepresentable),
 * and every mutation returns the authoritative cart. Nothing here keeps a local
 * copy of quantities or prices: after each call the list is re-read, so a line
 * the server rejected (out of stock, unpublished product) disappears instead of
 * lingering.
 *
 * This is the only cart provider in the app: it is mounted once by `App.tsx`, and
 * every mutation goes through `/api/mvp/cart`.
 */
import { MvpApiError, getMvpApi, type MvpCart } from "@velnox/shared/mvp";
import { useCallback, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface MvpCartValue {
  carts: MvpCart[];
  itemCount: number;
  loading: boolean;
  error: MvpApiError | null;
  reload: () => void;
  addItem: (input: {
    productId: string;
    variantId?: string | null;
    /** `null`/absent = the implicit base unit. */
    sellingUnitId?: string | null;
    quantity?: number;
  }) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
}

const MvpCartContext = createContext<MvpCartValue | null>(null);

/**
 * `enabled` is false for a signed-out visitor: the cart endpoints require a
 * session, and an anonymous cart would be a local fiction the checkout could not
 * honour.
 */
export function MvpCartProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [carts, setCarts] = useState<MvpCart[]>([]);
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<MvpApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setCarts([]);
      setItemCount(0);
      setLoading(false);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    getMvpApi()
      .cart.get()
      .then((data) => {
        if (!active) return;
        setCarts(data.carts ?? []);
        setItemCount(data.itemCount ?? 0);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // A 401 here just means the session expired mid-session.
        setError(err instanceof MvpApiError ? err : new MvpApiError(0, "UNEXPECTED", "Cart failed"));
        setCarts([]);
        setItemCount(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, nonce]);

  const addItem = useCallback<MvpCartValue["addItem"]>(
    async (input) => {
      await getMvpApi().cart.addItem(input);
      reload();
    },
    [reload],
  );

  const updateItem = useCallback<MvpCartValue["updateItem"]>(
    async (itemId, quantity) => {
      await getMvpApi().cart.updateItem(itemId, quantity);
      reload();
    },
    [reload],
  );

  const removeItem = useCallback<MvpCartValue["removeItem"]>(
    async (itemId) => {
      await getMvpApi().cart.removeItem(itemId);
      reload();
    },
    [reload],
  );

  const value = useMemo<MvpCartValue>(
    () => ({ carts, itemCount, loading, error, reload, addItem, updateItem, removeItem }),
    [carts, itemCount, loading, error, reload, addItem, updateItem, removeItem],
  );

  return <MvpCartContext.Provider value={value}>{children}</MvpCartContext.Provider>;
}

export function useMvpCart(): MvpCartValue {
  const value = useContext(MvpCartContext);
  if (!value) throw new Error("useMvpCart must be used inside <MvpCartProvider>");
  return value;
}
