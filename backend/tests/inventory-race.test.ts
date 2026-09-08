/**
 * P0 #2 + P1 #1 — Non-variant inventory race condition + idempotent release.
 *
 * Unit tests cover the server-side quantity validation. The integration
 * tests (skipped when no DATABASE_URL is available) verify:
 *
 *  • Atomic reservation guard (P0 #2)
 *  • Idempotent inventory release via releaseOrderInventory (P1 #1)
 *  • Concurrency: two simultaneous quantity-1 purchases on stock=1
 *  • Rollback: reserve then failure → no partial release
 *  • Double-release safety: calling releaseOrderInventory twice restores
 *    stock exactly once
 *  • Paid order receives late expiry → stock NOT restored
 *  • Cancellation restore still works
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_ORDER_QUANTITY,
  releaseOrderInventory,
  reserveInventoryStock,
  validateCheckoutQuantity,
} from "../lib/inventory.js";

// ─── Server-side quantity validation ─────────────────────────────────────────

describe("validateCheckoutQuantity", () => {
  test("accepts positive integers", () => {
    expect(validateCheckoutQuantity(1)).toBeNull();
    expect(validateCheckoutQuantity(100)).toBeNull();
    expect(validateCheckoutQuantity(MAX_ORDER_QUANTITY)).toBeNull();
  });

  test("rejects zero and negative quantities", () => {
    expect(validateCheckoutQuantity(0)).toContain("greater than zero");
    expect(validateCheckoutQuantity(-1)).toContain("greater than zero");
  });

  test("rejects non-integers (fractions, strings, null, NaN)", () => {
    expect(validateCheckoutQuantity(1.5)).toContain("whole number");
    expect(validateCheckoutQuantity("3")).toContain("whole number");
    expect(validateCheckoutQuantity(null)).toContain("whole number");
    expect(validateCheckoutQuantity(undefined)).toContain("whole number");
    expect(validateCheckoutQuantity(Number.NaN)).toContain("whole number");
  });

  test("rejects quantities above the allowed limit", () => {
    expect(validateCheckoutQuantity(MAX_ORDER_QUANTITY + 1)).toContain(
      `must not exceed ${MAX_ORDER_QUANTITY}`,
    );
  });
});

// ─── Integration: inventory reservation + release (needs DATABASE_URL) ──────

describe("non-variant inventory reservation (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  /** Seed a user → seller → shop → product → inventory chain; returns ids. */
  async function seedStock(tag: string, quantity: number) {
    const { query } = await import("../db/index.js");
    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [`${tag}@test.local`, "Inventory Test"],
    );
    const userId = user.rows[0].id as string;
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [userId],
    );
    const sellerId = seller.rows[0].id as string;
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, `${tag} shop`, tag],
    );
    const shopId = shop.rows[0].id as string;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, 100, 'published') RETURNING id`,
      [shopId, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(
      `INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, 0)`,
      [productId, quantity],
    );
    return { query, userId, productId };
  }

  /** Seed a user → seller → shop → product → inventory + order with items. */
  async function seedOrder(tag: string, stockQty: number, orderQty: number) {
    const { query, withTransaction } = await import("../db/index.js");
    const { userId, productId, ...rest } = await seedStock(tag, stockQty);
    // Reserve stock
    await withTransaction(async (client) => {
      await reserveInventoryStock(client, productId, orderQty);
    });
    // Create order
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency)
       VALUES ($1, 'pending_payment', $2, 'THB') RETURNING id`,
      [userId, 100 * orderQty],
    );
    const orderId = order.rows[0].id as string;
    // Create order items
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, 'test', $3, 100, $4)`,
      [orderId, productId, orderQty, 100 * orderQty],
    );
    return { query, withTransaction, userId, productId, orderId, orderQty };
  }

  testFn("stock 10, buy 1 → reserved 1", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-test-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId } = await seedStock(tag, 10);
    try {
      await withTransaction(async (client) => {
        await reserveInventoryStock(client, productId, 1);
      });
      const after = await query(
        `SELECT quantity, reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].quantity).toBe(10);
      expect(after.rows[0].reserved).toBe(1);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  testFn("stock 1, buy 2 → rejected, reserved stays 0", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-test-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId } = await seedStock(tag, 1);
    try {
      await expect(
        withTransaction(async (client) => {
          await reserveInventoryStock(client, productId, 2);
        }),
      ).rejects.toThrow("INSUFFICIENT_STOCK");
      const after = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  testFn(
    "stock 1 — two concurrent quantity-1 purchases: exactly one succeeds",
    async () => {
      const { randomUUID } = await import("crypto");
      const { withTransaction } = await import("../db/index.js");
      const tag = `inv-race-${randomUUID().slice(0, 8)}`;
      const { query, userId, productId } = await seedStock(tag, 1);
      try {
        // Two independent transactions fire at the same inventory row.
        const attempt = () =>
          withTransaction(async (client) => {
            await reserveInventoryStock(client, productId, 1);
            return "ok";
          });
        const [a, b] = await Promise.allSettled([attempt(), attempt()]);

        const ok = [a, b].filter((r) => r.status === "fulfilled");
        const failed = [a, b].filter((r) => r.status === "rejected");
        expect(ok.length).toBe(1);
        expect(failed.length).toBe(1);
        if (failed[0].status === "rejected") {
          expect(String((failed[0] as PromiseRejectedResult).reason)).toContain(
            "INSUFFICIENT_STOCK",
          );
        }

        // Stock must never go negative: reserved == 1, available == 0.
        const after = await query(
          `SELECT quantity, reserved FROM inventory WHERE product_id = $1`,
          [productId],
        );
        expect(after.rows[0].quantity).toBe(1);
        expect(after.rows[0].reserved).toBe(1);
      } finally {
        await query(`DELETE FROM users WHERE id = $1`, [userId]);
      }
    },
    30_000,
  );

  testFn("order creation failure after reservation → rollback restores stock", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-rollback-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId } = await seedStock(tag, 5);
    try {
      await expect(
        withTransaction(async (client) => {
          await reserveInventoryStock(client, productId, 2);
          // Simulate a later order-creation step failing — the whole
          // transaction (including the reservation) must roll back.
          throw new Error("simulated order insert failure");
        }),
      ).rejects.toThrow("simulated order insert failure");

      const after = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  // ─── P1 #1: releaseOrderInventory tests ────────────────────────────────

  testFn("releaseOrderInventory restores reserved stock exactly once (idempotent)", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-rel-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId, orderId } = await seedOrder(tag, 10, 3);
    try {
      // Confirm stock is reserved.
      const before = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(before.rows[0].reserved).toBe(3);

      // First release → succeeds, sets inventory_released flag.
      const r1 = await withTransaction(async (client) => {
        return await releaseOrderInventory(client, orderId);
      });
      expect(r1).toBe(true);

      const after1 = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after1.rows[0].reserved).toBe(0);

      // Second release → idempotent no-op (flag already set).
      const r2 = await withTransaction(async (client) => {
        return await releaseOrderInventory(client, orderId);
      });
      expect(r2).toBe(false);

      // Stock unchanged.
      const after2 = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after2.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  testFn("paid order + late expiry webhook → inventory NOT restored", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-paid-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId, orderId } = await seedOrder(tag, 10, 2);
    try {
      // Simulate payment success: release reserved inventory (as Stripe
      // success handler does) and mark order as paid.
      await withTransaction(async (client) => {
        // Release reserved (same as Stripe success handler).
        await client.query(
          `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2`,
          [2, productId],
        );
        await client.query(
          `UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1`,
          [orderId],
        );
      });

      // Late expiry webhook tries to release — must not (status is paid).
      const released = await withTransaction(async (client) => {
        return await releaseOrderInventory(client, orderId);
      });
      expect(released).toBe(false);

      // Stock must remain at quantity=10, reserved=0 (consumed by sale).
      const after = await query(
        `SELECT quantity, reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].quantity).toBe(10);
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  testFn("cancellation restore still works after atomic reservation", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-cancel-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId, orderId } = await seedOrder(tag, 5, 2);
    try {
      // Cancel + release via the shared path.
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [orderId],
        );
        await releaseOrderInventory(client, orderId);
      });
      const after = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });

  testFn("concurrent release attempts → only one effective restoration", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-drel-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId, orderId } = await seedOrder(tag, 5, 2);
    try {
      // Two concurrent release attempts for the same order.
      const release = () =>
        withTransaction(async (client) => {
          return await releaseOrderInventory(client, orderId);
        });
      const [a, b] = await Promise.allSettled([release(), release()]);
      // Both should complete (one returns true, one returns false).
      const results = [a, b].map((r) =>
        r.status === "fulfilled" ? r.value : null,
      );
      expect(results.filter((r) => r === true).length).toBe(1);
      expect(results.filter((r) => r === false).length).toBe(1);

      // Stock restored exactly once.
      const after = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  }, 30_000);
});