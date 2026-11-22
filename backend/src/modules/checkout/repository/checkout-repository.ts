import type { DbQueryable } from "../../../../database/src/types.ts";
import type { CheckoutGroup, CheckoutOrder, CheckoutOrderItem } from "../domain/checkout.ts";

export class CheckoutRepository {
  public static async findByGroupKey(
    db: DbQueryable,
    idempotencyKey: string,
  ): Promise<{ group: CheckoutGroup; orders: CheckoutOrder[] } | null> {
    const groupRes = await db.query(
      `SELECT id, user_id, idempotency_key, status, total_amount, currency, created_at
       FROM checkout_groups
       WHERE idempotency_key = $1
       LIMIT 1;`,
      [idempotencyKey],
    );

    if (!groupRes.rows || groupRes.rows.length === 0) return null;
    const g = groupRes.rows[0];

    const group: CheckoutGroup = {
      id: String(g.id),
      userId: String(g.user_id),
      idempotencyKey: String(g.idempotency_key),
      status: String(g.status),
      totalAmountMinor: BigInt(Math.round(Number(g.total_amount ?? 0) * 100)),
      currency: String(g.currency ?? "THB"),
      createdAt: new Date(g.created_at),
    };

    const ordersRes = await db.query(
      `SELECT id, checkout_group_id, shop_id, status, total_amount, payment_expires_at
       FROM orders
       WHERE checkout_group_id = $1
       ORDER BY created_at ASC;`,
      [group.id],
    );

    const orders: CheckoutOrder[] = [];
    for (const o of ordersRes.rows) {
      const itemsRes = await db.query(
        `SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.quantity, oi.unit_price, oi.total_price,
                p.title AS product_title
         FROM order_items oi
         JOIN products p ON p.id = oi.product_id
         WHERE oi.order_id = $1;`,
        [o.id],
      );

      const items: CheckoutOrderItem[] = itemsRes.rows.map((i: any) => ({
        id: String(i.id),
        orderId: String(i.order_id),
        productId: String(i.product_id),
        variantId: i.variant_id ? String(i.variant_id) : null,
        productTitle: String(i.product_title),
        quantity: Number(i.quantity),
        priceMinor: BigInt(Math.round(Number(i.unit_price ?? 0) * 100)),
        totalMinor: BigInt(Math.round(Number(i.total_price ?? 0) * 100)),
      }));

      orders.push({
        id: String(o.id),
        checkoutGroupId: String(o.checkout_group_id),
        shopId: String(o.shop_id),
        status: String(o.status),
        totalAmountMinor: BigInt(Math.round(Number(o.total_amount ?? 0) * 100)),
        paymentExpiresAt: new Date(o.payment_expires_at ?? Date.now() + 30 * 60 * 1000),
        items,
      });
    }

    return { group, orders };
  }

  public static async createCheckoutGroup(
    db: DbQueryable,
    params: {
      userId: string;
      idempotencyKey: string;
      totalAmountMinor: bigint;
      currency?: string;
    },
  ): Promise<CheckoutGroup> {
    const totalDecimal = (Number(params.totalAmountMinor) / 100).toFixed(2);
    const res = await db.query(
      `INSERT INTO checkout_groups (
        id, user_id, idempotency_key, status, total_amount, currency, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, 'pending', $3, $4, NOW(), NOW()
      ) RETURNING id, user_id, idempotency_key, status, total_amount, currency, created_at;`,
      [params.userId, params.idempotencyKey, totalDecimal, params.currency ?? "THB"],
    );

    const g = res.rows[0];
    return {
      id: String(g.id),
      userId: String(g.user_id),
      idempotencyKey: String(g.idempotency_key),
      status: String(g.status),
      totalAmountMinor: params.totalAmountMinor,
      currency: String(g.currency),
      createdAt: new Date(g.created_at),
    };
  }

  public static async createOrder(
    db: DbQueryable,
    params: {
      checkoutGroupId: string;
      userId: string;
      shopId: string;
      totalAmountMinor: bigint;
      paymentExpiresAt: Date;
    },
  ): Promise<string> {
    const totalDecimal = (Number(params.totalAmountMinor) / 100).toFixed(2);
    const res = await db.query(
      `INSERT INTO orders (
        id, checkout_group_id, customer_id, shop_id, status, total_amount,
        payment_expires_at, inventory_released, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, 'pending', $4, $5, false, NOW(), NOW()
      ) RETURNING id;`,
      [
        params.checkoutGroupId,
        params.userId,
        params.shopId,
        totalDecimal,
        params.paymentExpiresAt.toISOString(),
      ],
    );
    return String(res.rows[0].id);
  }

  public static async createOrderItem(
    db: DbQueryable,
    params: {
      orderId: string;
      productId: string;
      variantId?: string | null;
      quantity: number;
      priceMinor: bigint;
    },
  ): Promise<string> {
    const unitPriceDecimal = (Number(params.priceMinor) / 100).toFixed(2);
    const totalPriceDecimal = (Number(params.priceMinor * BigInt(params.quantity)) / 100).toFixed(2);

    const res = await db.query(
      `INSERT INTO order_items (
        id, order_id, product_id, variant_id, quantity, unit_price, total_price, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW()
      ) RETURNING id;`,
      [
        params.orderId,
        params.productId,
        params.variantId ?? null,
        params.quantity,
        unitPriceDecimal,
        totalPriceDecimal,
      ],
    );
    return String(res.rows[0].id);
  }
}
