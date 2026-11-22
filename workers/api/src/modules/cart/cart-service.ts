import type { ICartRepository } from "./cart-repository.js";
import type { AddCartItemData, CartItemRecord } from "./types.js";
import type { Cart, CartItem, CartShopGroup } from "@velnox/api-contract";

export class CartService {
  constructor(private readonly repo: ICartRepository) {}

  async getCart(userId: string): Promise<Cart> {
    const cartRecord = await this.repo.getOrCreateCart(userId);
    const rawItems = await this.repo.getCartItems(cartRecord.id);

    return this.buildCartView(cartRecord.id, rawItems);
  }

  async addItem(userId: string, item: AddCartItemData): Promise<Cart> {
    const cartRecord = await this.repo.getOrCreateCart(userId);
    await this.repo.addItem(cartRecord.id, item);
    return this.getCart(userId);
  }

  async updateItemQuantity(userId: string, itemId: string, quantity: number): Promise<Cart> {
    const cartRecord = await this.repo.getOrCreateCart(userId);
    if (quantity <= 0) {
      await this.repo.removeItem(cartRecord.id, itemId);
    } else {
      await this.repo.updateItemQuantity(cartRecord.id, itemId, quantity);
    }
    return this.getCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    const cartRecord = await this.repo.getOrCreateCart(userId);
    await this.repo.removeItem(cartRecord.id, itemId);
    return this.getCart(userId);
  }

  async clearCart(userId: string): Promise<Cart> {
    const cartRecord = await this.repo.getOrCreateCart(userId);
    await this.repo.clearCart(cartRecord.id);
    return this.getCart(userId);
  }

  private buildCartView(cartId: string, rawItems: CartItemRecord[]): Cart {
    const shopMap = new Map<string, { shopId: string; shopName: string; items: CartItem[]; subtotalSatang: number }>();
    let totalSatang = 0;
    let itemCount = 0;

    for (const item of rawItems) {
      const shopId = item.shopId || "unknown-shop";
      const shopName = item.shopName || "Marketplace Seller";
      const priceSatang = item.priceSatang || 0;
      const subtotalSatang = priceSatang * item.quantity;

      totalSatang += subtotalSatang;
      itemCount += item.quantity;

      const formattedItem: CartItem = {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId || undefined,
        productName: item.productName || "Unknown Product",
        variantName: item.variantName || undefined,
        imageUrl: item.imageUrl || undefined,
        unitPrice: priceSatang / 100, // THB decimal
        quantity: item.quantity,
        subtotal: subtotalSatang / 100,
        shopId,
        shopName,
        stockAvailable: item.stockAvailable !== undefined ? item.stockAvailable : 10,
      };

      if (!shopMap.has(shopId)) {
        shopMap.set(shopId, {
          shopId,
          shopName,
          items: [],
          subtotalSatang: 0,
        });
      }

      const shopGroup = shopMap.get(shopId)!;
      shopGroup.items.push(formattedItem);
      shopGroup.subtotalSatang += subtotalSatang;
    }

    const shopGroups: CartShopGroup[] = Array.from(shopMap.values()).map((g) => ({
      shopId: g.shopId,
      shopName: g.shopName,
      items: g.items,
      shopSubtotal: g.subtotalSatang / 100,
    }));

    return {
      id: cartId,
      shopGroups,
      totalAmount: totalSatang / 100,
      currency: "THB",
      itemCount,
      shopCount: shopGroups.length,
    };
  }
}
