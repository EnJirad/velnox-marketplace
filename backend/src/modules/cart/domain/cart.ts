export interface CartItem {
  readonly id: string;
  readonly cartId: string;
  readonly shopId: string;
  readonly productId: string;
  readonly variantId: string | null;
  readonly productTitle: string;
  readonly productImage: string | null;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly priceMinor: bigint;
  readonly totalMinor: bigint;
}

export interface CartShopGroup {
  readonly shopId: string;
  readonly shopName: string;
  readonly items: readonly CartItem[];
  readonly subtotalMinor: bigint;
}

export interface Cart {
  readonly id: string;
  readonly userId: string;
  readonly groups: readonly CartShopGroup[];
  readonly totalItems: number;
  readonly grandTotalMinor: bigint;
}

export function groupCartItems(
  cartId: string,
  userId: string,
  rawItems: readonly (CartItem & { shopName: string })[],
): Cart {
  const shopMap = new Map<string, { shopId: string; shopName: string; items: CartItem[]; subtotal: bigint }>();
  let totalItems = 0;
  let grandTotal = 0n;

  for (const item of rawItems) {
    totalItems += item.quantity;
    grandTotal += item.totalMinor;

    if (!shopMap.has(item.shopId)) {
      shopMap.set(item.shopId, {
        shopId: item.shopId,
        shopName: item.shopName,
        items: [],
        subtotal: 0n,
      });
    }

    const group = shopMap.get(item.shopId)!;
    group.items.push(item);
    group.subtotal += item.totalMinor;
  }

  const groups: CartShopGroup[] = Array.from(shopMap.values()).map((g) => ({
    shopId: g.shopId,
    shopName: g.shopName,
    items: g.items,
    subtotalMinor: g.subtotal,
  }));

  return {
    id: cartId,
    userId,
    groups,
    totalItems,
    grandTotalMinor: grandTotal,
  };
}
