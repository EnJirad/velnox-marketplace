import type { IDatabaseClient } from "../../core/database/db-client.js";
import type { AddCartItemData, CartItemRecord, CartRecord } from "./types.js";

export interface ICartRepository {
  getOrCreateCart(userId: string): Promise<CartRecord>;
  getCartItems(cartId: string): Promise<CartItemRecord[]>;
  addItem(cartId: string, item: AddCartItemData): Promise<CartItemRecord>;
  updateItemQuantity(cartId: string, itemId: string, quantity: number): Promise<CartItemRecord | null>;
  removeItem(cartId: string, itemId: string): Promise<boolean>;
  clearCart(cartId: string): Promise<void>;
}

export class NeonCartRepository implements ICartRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async getOrCreateCart(userId: string): Promise<CartRecord> {
    const existing = await this.db.query<any>(
      `SELECT id, user_id as "userId", created_at as "createdAt", updated_at as "updatedAt"
       FROM carts WHERE user_id = $1`,
      [userId],
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created = await this.db.query<any>(
      `INSERT INTO carts (id, user_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       RETURNING id, user_id as "userId", created_at as "createdAt", updated_at as "updatedAt"`,
      [id, userId, now],
    );
    return created.rows[0];
  }

  async getCartItems(cartId: string): Promise<CartItemRecord[]> {
    const res = await this.db.query<any>(
      `SELECT ci.id, ci.cart_id as "cartId", ci.product_id as "productId", ci.variant_id as "variantId",
              ci.quantity, ci.created_at as "createdAt", ci.updated_at as "updatedAt",
              p.name as "productName", p.shop_id as "shopId", s.name as "shopName",
              COALESCE(pv.price, p.price) as "priceSatang",
              COALESCE(p.primary_image_url, (p.images->>0)) as "imageUrl",
              COALESCE(pv.stock, (p.total_quantity - p.reserved_quantity)) as "stockAvailable"
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       JOIN shops s ON p.shop_id = s.id
       LEFT JOIN product_variants pv ON ci.variant_id = pv.id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at ASC`,
      [cartId],
    );
    return res.rows;
  }

  async addItem(cartId: string, item: AddCartItemData): Promise<CartItemRecord> {
    const now = new Date().toISOString();
    // Check if item with same variant already exists
    const existing = await this.db.query<any>(
      `SELECT id, quantity FROM cart_items
       WHERE cart_id = $1 AND product_id = $2 AND (variant_id = $3 OR (variant_id IS NULL AND $3 IS NULL))`,
      [cartId, item.productId, item.variantId || null],
    );

    if (existing.rows.length > 0) {
      const existingId = existing.rows[0].id;
      const newQty = existing.rows[0].quantity + item.quantity;
      const updated = await this.db.query<any>(
        `UPDATE cart_items SET quantity = $1, updated_at = $2 WHERE id = $3
         RETURNING id, cart_id as "cartId", product_id as "productId", variant_id as "variantId",
                   quantity, created_at as "createdAt", updated_at as "updatedAt"`,
        [newQty, now, existingId],
      );
      return updated.rows[0];
    }

    const id = crypto.randomUUID();
    const created = await this.db.query<any>(
      `INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       RETURNING id, cart_id as "cartId", product_id as "productId", variant_id as "variantId",
                 quantity, created_at as "createdAt", updated_at as "updatedAt"`,
      [id, cartId, item.productId, item.variantId || null, item.quantity, now],
    );
    return created.rows[0];
  }

  async updateItemQuantity(cartId: string, itemId: string, quantity: number): Promise<CartItemRecord | null> {
    const res = await this.db.query<any>(
      `UPDATE cart_items SET quantity = $1, updated_at = NOW()
       WHERE id = $2 AND cart_id = $3
       RETURNING id, cart_id as "cartId", product_id as "productId", variant_id as "variantId",
                 quantity, created_at as "createdAt", updated_at as "updatedAt"`,
      [quantity, itemId, cartId],
    );
    return res.rows[0] || null;
  }

  async removeItem(cartId: string, itemId: string): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`,
      [itemId, cartId],
    );
    return res.rowCount > 0;
  }

  async clearCart(cartId: string): Promise<void> {
    await this.db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  }
}

export class MockCartRepository implements ICartRepository {
  private carts: Map<string, CartRecord> = new Map();
  private cartItems: Map<string, CartItemRecord[]> = new Map();

  async getOrCreateCart(userId: string): Promise<CartRecord> {
    let cart = Array.from(this.carts.values()).find((c) => c.userId === userId);
    if (!cart) {
      cart = {
        id: `cart-${userId}`,
        userId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.carts.set(cart.id, cart);
      this.cartItems.set(cart.id, []);
    }
    return cart;
  }

  async getCartItems(cartId: string): Promise<CartItemRecord[]> {
    return this.cartItems.get(cartId) || [];
  }

  async addItem(cartId: string, item: AddCartItemData): Promise<CartItemRecord> {
    const items = this.cartItems.get(cartId) || [];
    const existing = items.find(
      (i) => i.productId === item.productId && (i.variantId === item.variantId || (!i.variantId && !item.variantId)),
    );

    if (existing) {
      existing.quantity += item.quantity;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const newItem: CartItemRecord = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      cartId,
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: item.quantity,
      productName: "Velnox Pro Max Smartphone 256GB",
      shopId: "shop-001",
      shopName: "Velnox Official Flagship",
      priceSatang: 2990000,
      imageUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/products/phone1.webp",
      stockAvailable: 95,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    items.push(newItem);
    this.cartItems.set(cartId, items);
    return newItem;
  }

  async updateItemQuantity(cartId: string, itemId: string, quantity: number): Promise<CartItemRecord | null> {
    const items = this.cartItems.get(cartId) || [];
    const item = items.find((i) => i.id === itemId);
    if (!item) return null;
    item.quantity = quantity;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  async removeItem(cartId: string, itemId: string): Promise<boolean> {
    const items = this.cartItems.get(cartId) || [];
    const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) return false;
    items.splice(idx, 1);
    return true;
  }

  async clearCart(cartId: string): Promise<void> {
    this.cartItems.set(cartId, []);
  }
}
