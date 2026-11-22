import type { DbQueryable } from "../../../../database/src/types.ts";
import { type Cart, type CartItem, groupCartItems } from "../domain/cart.ts";

export class CartRepository {
  public static async getOrCreateCartId(db: DbQueryable, userId: string): Promise<string> {
    const existing = await db.query(
      `SELECT id FROM carts WHERE user_id = $1 LIMIT 1;`,
      [userId],
    );
    if (existing.rows && existing.rows.length > 0) {
      return String(existing.rows[0].id);
    }

    const created = await db.query(
      `INSERT INTO carts (id, user_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING id;`,
      [userId],
    );
    return String(created.rows[0].id);
  }

  public static async getCart(db: DbQueryable, userId: string): Promise<Cart> {
    const cartId = await this.getOrCreateCartId(db, userId);

    const sql = `
      SELECT ci.id, ci.cart_id, ci.product_id, ci.variant_id, ci.quantity,
             p.shop_id, p.title AS product_title, p.price AS product_price, p.images AS product_images,
             s.name AS shop_name,
             pv.title AS variant_title, pv.price AS variant_price, pv.image_url AS variant_image
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      JOIN shops s ON s.id = p.shop_id
      LEFT JOIN product_variants pv ON pv.id = ci.variant_id
      WHERE ci.cart_id = $1
      ORDER BY ci.created_at ASC;
    `;
    const res = await db.query(sql, [cartId]);

    const rawItems: (CartItem & { shopName: string })[] = res.rows.map((row: any) => {
      const priceRaw = row.variant_price != null ? Number(row.variant_price) : Number(row.product_price ?? 0);
      const priceMinor = BigInt(Math.round(priceRaw * 100));
      const qty = Number(row.quantity ?? 1);
      const totalMinor = priceMinor * BigInt(qty);

      let image: string | null = row.variant_image ?? null;
      if (!image) {
        if (Array.isArray(row.product_images)) image = row.product_images[0] ?? null;
        else if (typeof row.product_images === "string") {
          try { image = JSON.parse(row.product_images)[0] ?? null; } catch { image = row.product_images; }
        }
      }

      return {
        id: String(row.id),
        cartId: String(row.cart_id),
        shopId: String(row.shop_id),
        productId: String(row.product_id),
        variantId: row.variant_id ? String(row.variant_id) : null,
        productTitle: String(row.product_title),
        productImage: image,
        variantTitle: row.variant_title ? String(row.variant_title) : null,
        quantity: qty,
        priceMinor,
        totalMinor,
        shopName: String(row.shop_name ?? "Shop"),
      };
    });

    return groupCartItems(cartId, userId, rawItems);
  }

  public static async addItem(
    db: DbQueryable,
    cartId: string,
    item: { productId: string; variantId?: string; quantity: number },
  ): Promise<void> {
    const sql = `
      INSERT INTO cart_items (id, cart_id, product_id, variant_id, quantity, created_at, updated_at)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = NOW();
    `;
    await db.query(sql, [cartId, item.productId, item.variantId ?? null, item.quantity]);
  }

  public static async updateItemQuantity(
    db: DbQueryable,
    cartId: string,
    itemId: string,
    quantity: number,
  ): Promise<void> {
    if (quantity <= 0) {
      await db.query(`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2;`, [itemId, cartId]);
    } else {
      await db.query(
        `UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND cart_id = $3;`,
        [quantity, itemId, cartId],
      );
    }
  }

  public static async removeItem(
    db: DbQueryable,
    cartId: string,
    itemId: string,
  ): Promise<void> {
    await db.query(`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2;`, [itemId, cartId]);
  }

  public static async clearCart(db: DbQueryable, cartId: string): Promise<void> {
    await db.query(`DELETE FROM cart_items WHERE cart_id = $1;`, [cartId]);
  }
}
