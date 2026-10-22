/**
 * Wishlist state for VelShop.
 *
 * The server owns the rows (`product_favorites`); this provider caches only the
 * ID SET so every card's heart agrees without a request per card. Toggling is
 * optimistic with a rollback on failure — the original storefront flipped the
 * heart immediately, and a rejected request must not leave a lie on screen.
 */
import { useMvpSessionContext } from "@velnox/shared/mvp/ui";
import { getMvpApi } from "@velnox/shared/mvp";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface FavoritesValue {
  ids: Set<string>;
  loaded: boolean;
  busyId: string | null;
  isFavorited: (productId: string) => boolean;
  toggle: (productId: string) => Promise<boolean>;
  reload: () => void;
}

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { user } = useMvpSessionContext();
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user) {
      setIds(new Set());
      setLoaded(true);
      return;
    }
    let active = true;
    getMvpApi()
      .favorites.ids()
      .then((productIds) => {
        if (active) {
          setIds(new Set(productIds));
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user, nonce]);

  const toggle = useCallback(
    async (productId: string): Promise<boolean> => {
      if (!user) return false;
      const wasFavorited = ids.has(productId);
      setBusyId(productId);
      setIds((previous) => {
        const next = new Set(previous);
        if (wasFavorited) next.delete(productId);
        else next.add(productId);
        return next;
      });
      try {
        if (wasFavorited) await getMvpApi().favorites.remove(productId);
        else await getMvpApi().favorites.add(productId);
        return !wasFavorited;
      } catch (error) {
        // Roll the optimistic flip back: the server is the authority.
        setIds((previous) => {
          const next = new Set(previous);
          if (wasFavorited) next.add(productId);
          else next.delete(productId);
          return next;
        });
        throw error;
      } finally {
        setBusyId(null);
      }
    },
    [ids, user],
  );

  const value = useMemo<FavoritesValue>(
    () => ({
      ids,
      loaded,
      busyId,
      isFavorited: (productId) => ids.has(productId),
      toggle,
      reload: () => setNonce((n) => n + 1),
    }),
    [ids, loaded, busyId, toggle],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesValue {
  const value = useContext(FavoritesContext);
  if (!value) throw new Error("useFavorites must be used inside <FavoritesProvider>");
  return value;
}
