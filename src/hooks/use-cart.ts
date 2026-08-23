import { useCallback, useEffect, useState } from "react";
import type { Cart } from "@/types";
import { cartApi } from "@/lib/api";

interface CartState {
  cart: Cart | null;
  isLoading: boolean;
  itemCount: number;
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
  });

  const refresh = useCallback(async () => {
    try {
      const { cart } = await cartApi.get();
      setState({
        cart,
        isLoading: false,
        itemCount: cart?.totalItems ?? 0,
      });
    } catch {
      setState({ cart: null, isLoading: false, itemCount: 0 });
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
      });
    },
    []
  );

  const updateItem = useCallback(
    async (itemId: string, quantity: number) => {
      const { cart } = await cartApi.updateItem(itemId, quantity);
      setState({
        cart,
        isLoading: false,
        itemCount: cart?.totalItems ?? 0,
      });
    },
    []
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      const { cart } = await cartApi.removeItem(itemId);
      setState({
        cart,
        isLoading: false,
        itemCount: cart?.totalItems ?? 0,
      });
    },
    []
  );

  return { ...state, addItem, updateItem, removeItem, refresh };
}
