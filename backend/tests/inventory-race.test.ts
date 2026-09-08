/**
 * P0 #2 — Non-variant inventory race condition.
 *
 * Unit tests cover the server-side quantity validation. The integration
 * tests (skipped when no DATABASE_URL is available) verify the atomic
 * reservation guard on real PostgreSQL: the concurrency test reproduces the
 * TOCTOU oversell scenario (two simultaneous quantity-1 purchases against
 * stock=1) and asserts exactly one allocation succeeds with stock never
 * going negative. Rollback and cancellation-restore consistency are also
 * verified against the real database.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_ORDER_QUANTITY,
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

// ─── Integration: atomic non-variant reservation (needs DATABASE_URL) ───────

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

  testFn("cancellation restore still works after atomic reservation", async () => {
    const { randomUUID } = await import("crypto");
    const { withTransaction } = await import("../db/index.js");
    const tag = `inv-cancel-${randomUUID().slice(0, 8)}`;
    const { query, userId, productId } = await seedStock(tag, 5);
    try {
      await withTransaction(async (client) => {
        await reserveInventoryStock(client, productId, 2);
      });
      // Same restore statement the customer/seller cancel paths use.
      await query(
        `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2`,
        [2, productId],
      );
      const after = await query(
        `SELECT reserved FROM inventory WHERE product_id = $1`,
        [productId],
      );
      expect(after.rows[0].reserved).toBe(0);
    } finally {
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  });
});