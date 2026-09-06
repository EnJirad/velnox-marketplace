/**
 * VelRepeat V2 — core logic tests.
 *
 * Unit tests cover the pure functions (next-run calculation, item
 * validation, price policy). The integration test (skipped when no
 * DATABASE_URL is available) verifies the two idempotency guards:
 * concurrent processPlan calls for the same plan produce exactly one
 * run row and one order.
 */
import { describe, expect, test } from "bun:test";
import {
  calculateNextRunAt,
  currentPriceOf,
  processPlan,
  validatePlanItem,
} from "../jobs/velrepeat-scheduler.js";

// ─── calculateNextRunAt ──────────────────────────────────────────────────────

describe("calculateNextRunAt", () => {
  const base = new Date("2026-09-06T08:00:00.000Z");

  test("adds days", () => {
    const next = calculateNextRunAt(base, "days", 7);
    expect(next.toISOString()).toBe("2026-09-13T08:00:00.000Z");
  });

  test("adds weeks as 7-day multiples", () => {
    const next = calculateNextRunAt(base, "weeks", 2);
    expect(next.toISOString()).toBe("2026-09-20T08:00:00.000Z");
  });

  test("adds months", () => {
    const next = calculateNextRunAt(base, "months", 1);
    expect(next.toISOString()).toBe("2026-10-06T08:00:00.000Z");
  });

  test("clamps month-end days (Jan 31 + 1 month → Feb 28/29)", () => {
    const jan31 = new Date("2026-01-31T08:00:00.000Z");
    const feb = calculateNextRunAt(jan31, "months", 1);
    expect(feb.toISOString()).toBe("2026-02-28T08:00:00.000Z");
  });

  test("clamps month-end days in leap years (Jan 31 2028 + 1 month → Feb 29)", () => {
    const jan31 = new Date("2028-01-31T08:00:00.000Z");
    const feb = calculateNextRunAt(jan31, "months", 1);
    expect(feb.toISOString()).toBe("2028-02-29T08:00:00.000Z");
  });

  test("normalizes invalid interval values to >= 1", () => {
    expect(calculateNextRunAt(base, "days", 0).toISOString()).toBe("2026-09-07T08:00:00.000Z");
  });
});

// ─── validatePlanItem ────────────────────────────────────────────────────────

describe("validatePlanItem", () => {
  const validItem = {
    product_id: "p1",
    product_status: "published",
    vrepeat_enabled: true,
    shop_status: "active",
    seller_status: "approved",
    variant_id: null,
    inv_quantity: 10,
    inv_reserved: 2,
    quantity: 3,
  };

  test("accepts a valid non-variant item using inventory stock", () => {
    const v = validatePlanItem(validItem);
    expect(v.ok).toBe(true);
  });

  test("rejects missing product", () => {
    const v = validatePlanItem({ ...validItem, product_id: null });
    expect(v).toMatchObject({ ok: false, code: "item_unavailable" });
  });

  test("rejects unpublished product", () => {
    const v = validatePlanItem({ ...validItem, product_status: "draft" });
    expect(v).toMatchObject({ ok: false, code: "item_unavailable" });
  });

  test("rejects product with VelRepeat disabled", () => {
    const v = validatePlanItem({ ...validItem, vrepeat_enabled: false });
    expect(v).toMatchObject({ ok: false, code: "item_unavailable" });
  });

  test("rejects inactive seller", () => {
    expect(validatePlanItem({ ...validItem, seller_status: "rejected" })).toMatchObject({ ok: false });
  });

  test("flags out-of-stock for non-variant items from inventory", () => {
    const v = validatePlanItem({ ...validItem, inv_quantity: 2, inv_reserved: 0, quantity: 3 });
    expect(v).toMatchObject({ ok: false, code: "out_of_stock" });
  });

  test("validates variant ownership, status and stock", () => {
    const withVariant = {
      ...validItem,
      variant_id: "v1",
      variant_id_matches: true,
      variant_status: "active",
      variant_stock: 5,
    };
    expect(validatePlanItem(withVariant).ok).toBe(true);

    expect(
      validatePlanItem({ ...withVariant, variant_id_matches: false }),
    ).toMatchObject({ ok: false, code: "item_unavailable" });

    expect(
      validatePlanItem({ ...withVariant, variant_status: "inactive" }),
    ).toMatchObject({ ok: false, code: "item_unavailable" });

    expect(
      validatePlanItem({ ...withVariant, variant_stock: 2, quantity: 3 }),
    ).toMatchObject({ ok: false, code: "out_of_stock" });
  });

  test("ignores inventory when a variant provides stock", () => {
    const v = validatePlanItem({
      ...validItem,
      variant_id: "v1",
      variant_id_matches: true,
      variant_status: "active",
      variant_stock: 5,
      inv_quantity: 0,
      quantity: 3,
    });
    expect(v.ok).toBe(true);
  });
});

// ─── currentPriceOf ──────────────────────────────────────────────────────────

describe("currentPriceOf", () => {
  test("variant price wins when a variant exists", () => {
    expect(currentPriceOf({ variant_id: "v1", variant_price: "120.00", product_price: "100.00" })).toBe(120);
  });

  test("falls back to product price without a variant", () => {
    expect(currentPriceOf({ variant_id: null, variant_price: null, product_price: "100.00" })).toBe(100);
  });
});

// ─── Integration: concurrency + idempotency (needs DATABASE_URL) ────────────

describe("scheduler idempotency (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  testFn(
    "two concurrent processPlan calls create exactly one run and one order",
    async () => {
      const { query } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `vr-test-${randomUUID().slice(0, 8)}`;

      // ── Seed minimal rows (all FKs satisfied) ─────────────────────────
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [`${tag}@test.local`, "VelRepeat Test"],
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
        `INSERT INTO products (shop_id, name, slug, price, status, vrepeat_enabled)
         VALUES ($1, $2, $3, 100, 'published', TRUE) RETURNING id`,
        [shopId, `${tag} product`, `${tag}-p`],
      );
      const productId = product.rows[0].id as string;

      await query(
        `INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 100, 0)`,
        [productId],
      );

      const plan = await query(
        `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, next_run_at)
         VALUES ($1, 'active', 'days', 7, NOW()) RETURNING id`,
        [userId],
      );
      const planId = plan.rows[0].id as string;

      await query(
        `INSERT INTO velrepeat_items (plan_id, product_id, shop_id, seller_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, 1, 100)`,
        [planId, productId, shopId, sellerId],
      );

      try {
        // ── Fire two workers at the same plan simultaneously ──────────
        const [a, b] = await Promise.allSettled([processPlan(planId), processPlan(planId)]);
        expect(a.status).toBe("fulfilled");
        expect(b.status).toBe("fulfilled");
        const outcomes = [a, b].map((r) => (r.status === "fulfilled" ? r.value : null));
        // Exactly one worker should have processed the run
        expect(outcomes.filter((o) => o === "success").length).toBe(1);
        expect(outcomes.filter((o) => o === null).length).toBe(1);

        const runs = await query(
          `SELECT COUNT(*)::int AS count FROM velrepeat_runs WHERE plan_id = $1`,
          [planId],
        );
        expect(runs.rows[0].count).toBe(1);

        const orders = await query(
          `SELECT COUNT(*)::int AS count FROM orders WHERE velrepeat_run_id IS NOT NULL
           AND user_id = $1`,
          [userId],
        );
        expect(orders.rows[0].count).toBe(1);

        const planAfter = await query(
          `SELECT status, next_run_at FROM velrepeat_plans WHERE id = $1`,
          [planId],
        );
        expect(planAfter.rows[0].status).toBe("active");
        // next_run_at must have advanced into the future
        expect(new Date(planAfter.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now());
      } finally {
        // ── Cleanup (cascade deletes) ──────────────────────────────────
        await query(`DELETE FROM velrepeat_plans WHERE id = $1`, [planId]);
        await query(`DELETE FROM users WHERE id = $1`, [userId]);
      }
    },
    30_000,
  );
});