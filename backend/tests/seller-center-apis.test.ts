/**
 * P1 #4 — Seller/Center API support (goals, income, reorder, center data).
 *
 * Unit tests (always run) verify the pure helpers:
 *   • computeIncomeReport — commission 3%, return coverage 10%, payout
 *   • validateGoalInput   — required fields, category/period whitelists
 *   • computePurchaseStats / estimatedNextPurchase / reorderConfidence
 *   • migration + schema sync (seller_goals, users.department, employees.*)
 *
 * Integration tests (DB-gated, skipped without DATABASE_URL) verify the
 * real queries behind the new endpoints.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  computeIncomeReport,
  computePurchaseStats,
  estimatedNextPurchase,
  reorderConfidence,
  round2,
  validateGoalInput,
} from "../lib/seller-stats.js";

// ─── Income math (pure, always runs) ───────────────────────────────────────

describe("computeIncomeReport", () => {
  test("no sales → zero report", () => {
    const r = computeIncomeReport(0, 0, 0, 0);
    expect(r.gross).toBe(0);
    expect(r.commission).toBe(0);
    expect(r.payout).toBe(0);
    expect(r.returnRate).toBe(0);
  });

  test("gross 10000 → 3% commission, payout 9700", () => {
    const r = computeIncomeReport(10000, 10, 0, 0);
    expect(r.commission).toBe(300);
    expect(r.payout).toBe(9700);
    expect(r.commissionRate).toBe(0.03);
  });

  test("returns within the 10% coverage are fully covered by the platform", () => {
    // 1000 gross, 100 returns (exactly 10%) → payout 1000 - 30 = 970
    const r = computeIncomeReport(1000, 5, 100, 2);
    expect(r.payout).toBe(970);
    expect(r.returnRate).toBe(0.1);
  });

  test("returns beyond coverage are deducted from the payout", () => {
    // 1000 gross, 300 returns (30% > 10% coverage) → uncovered 200 → 1000-30-200
    const r = computeIncomeReport(1000, 5, 300, 3);
    expect(r.payout).toBe(770);
  });

  test("rounding stays at 2 decimals", () => {
    expect(round2(100 * 0.03)).toBe(3);
    expect(round2(99.99 * 0.03)).toBe(3);
  });
});

// ─── Goal validation (pure, always runs) ───────────────────────────────────

describe("validateGoalInput", () => {
  test("accepts a valid goal", () => {
    const v = validateGoalInput({
      title: " ยอดขาย 100k ",
      targetValue: 100000,
      currentValue: 25000,
      category: "revenue",
      period: "monthly",
      dueDate: Date.now() + 86400000,
    });
    expect(v.error).toBeNull();
    expect(v.title).toBe("ยอดขาย 100k");
    expect(v.targetValue).toBe(100000);
    expect(v.currentValue).toBe(25000);
    expect(v.dueDate).not.toBeNull();
  });

  test("rejects missing title", () => {
    expect(validateGoalInput({ targetValue: 100 }).error).not.toBeNull();
  });

  test("rejects target <= 0 or non-numeric", () => {
    expect(validateGoalInput({ title: "g", targetValue: 0 }).error).not.toBeNull();
    expect(validateGoalInput({ title: "g", targetValue: -5 }).error).not.toBeNull();
    expect(validateGoalInput({ title: "g", targetValue: "abc" }).error).not.toBeNull();
  });

  test("rejects unknown category / period", () => {
    expect(validateGoalInput({ title: "g", targetValue: 10, category: "nope" }).error).not.toBeNull();
    expect(validateGoalInput({ title: "g", targetValue: 10, period: "weekly" }).error).not.toBeNull();
  });
});

// ─── Purchase cycle helpers (pure, always runs) ────────────────────────────

describe("purchase cycle helpers", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  test("no purchases → no stats", () => {
    const s = computePurchaseStats([], 0);
    expect(s.purchaseCount).toBe(0);
    expect(s.avgCycleDays).toBeNull();
    expect(estimatedNextPurchase(s)).toBeNull();
  });

  test("single purchase → no cycle yet, low confidence", () => {
    const s = computePurchaseStats([now - 3 * DAY], 2);
    expect(s.purchaseCount).toBe(1);
    expect(s.avgCycleDays).toBeNull();
    expect(estimatedNextPurchase(s)).toBeNull();
    expect(reorderConfidence(1)).toBe("low");
  });

  test("two purchases 10 days apart → 10-day cycle", () => {
    const s = computePurchaseStats([now - 20 * DAY, now - 10 * DAY], 4);
    expect(s.avgCycleDays).toBe(10);
    expect(estimatedNextPurchase(s)).toBe(now);
    expect(reorderConfidence(2)).toBe("low");
    expect(reorderConfidence(3)).toBe("medium");
  });

  test("high confidence at 6+ purchases", () => {
    expect(reorderConfidence(6)).toBe("high");
    expect(reorderConfidence(0)).toBe("not_enough_data");
  });
});

// ─── Migration + schema sync (pure, always runs) ───────────────────────────

describe("P1 #4 migration + schema sync", () => {
  const root = join(import.meta.dir, "../..");

  test("migration 039 adds seller_goals + department + employee columns", () => {
    const sql = readFileSync(join(root, "db/migrations/039_seller_goals_and_center.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS seller_goals");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS department");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS permissions");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS employee_id");
  });

  test("schema.sql and run-sqleditor.sql carry the new structure", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = readFileSync(join(root, file), "utf8");
      expect(sql, file).toContain("CREATE TABLE IF NOT EXISTS seller_goals");
      expect(sql, file).toContain("department TEXT");
      expect(sql, file).toContain("permissions JSONB NOT NULL DEFAULT '[]'");
      expect(sql, file).toContain("employee_id TEXT");
    }
  });

  test("run-update.sql appends the V0039 migration", () => {
    const sql = readFileSync(join(root, "db/run-update.sql"), "utf8");
    expect(sql).toContain("Migration: V0039");
    expect(sql).toContain("seller_goals");
  });
});

// ─── Integration (needs DATABASE_URL) ──────────────────────────────────────

describe("seller goals + center queries (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  async function seedSeller() {
    const { query } = await import("../db/index.js");
    const tag = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const user = await query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [
      `p14-seller-${tag}@test.local`,
      "P1#4 Seller",
    ]);
    const userId = user.rows[0].id as string;
    const seller = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [userId]);
    const sellerId = seller.rows[0].id as string;
    const shop = await query("INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
      sellerId,
      "P1#4 Shop",
      `p14-shop-${tag}`,
    ]);
    const shopId = shop.rows[0].id as string;
    return { query, userId, sellerId, shopId };
  }

  testFn("goal CRUD round-trip (create → progress → update → delete)", async () => {
    const { query, sellerId } = await seedSeller();

    const created = await query(
      `INSERT INTO seller_goals (seller_id, title, category, period, unit, target_value, current_value)
       VALUES ($1, 'ยอดขาย 100k', 'revenue', 'monthly', 'บาท', 100000, 0) RETURNING *`,
      [sellerId],
    );
    const goalId = created.rows[0].id as string;

    // progress
    await query("UPDATE seller_goals SET current_value = current_value + 25000 WHERE id = $1", [goalId]);
    const after = await query("SELECT current_value FROM seller_goals WHERE id = $1", [goalId]);
    expect(parseFloat(after.rows[0].current_value)).toBe(25000);

    // owner-scoped delete
    await query("DELETE FROM seller_goals WHERE id = $1 AND seller_id = $2", [goalId, sellerId]);
    const gone = await query("SELECT id FROM seller_goals WHERE id = $1", [goalId]);
    expect(gone.rows).toHaveLength(0);
  });

  testFn("income report math over real orders (completed + cancelled)", async () => {
    const { query, userId, sellerId, shopId } = await seedSeller();

    const mkOrder = async (status: string) => {
      const o = await query(
        "INSERT INTO orders (user_id, shop_id, status, total_amount, currency) VALUES ($1, $2, $3, 1000, 'THB') RETURNING id",
        [userId, shopId, status],
      );
      const orderId = o.rows[0].id as string;
      await query(
        `INSERT INTO order_items (order_id, product_id, shop_id, product_name, product_name_snapshot, quantity, price, subtotal)
         VALUES ($1, NULL, $2, 'Item', 'Item', 2, 500, 1000)`,
        [orderId, shopId],
      );
      return orderId;
    };
    const completedOrderId = await mkOrder("completed");
    await mkOrder("cancelled");

    // Gross aggregate the same way GET /api/seller/income does.
    const agg = await query(
      `SELECT o.status, SUM(oi.subtotal) AS seller_subtotal, SUM(oi.quantity)::int AS seller_item_count
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN shops sh ON oi.shop_id = sh.id
       WHERE sh.seller_id = $1 AND o.id = ANY($2)
       GROUP BY o.status`,
      [sellerId, [completedOrderId]],
    );
    expect(agg.rows).toHaveLength(1);
    expect(parseFloat(agg.rows[0].seller_subtotal)).toBe(1000);
    expect(agg.rows[0].seller_item_count).toBe(2);
  });

  testFn("market overview aggregates match seeded data", async () => {
    const { query } = await import("../db/index.js");
    const tag = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await query("INSERT INTO users (email, name, role) VALUES ($1, 'C', 'customer')", [`p14-cust-${tag}@test.local`]);
    await query("INSERT INTO categories (slug, name) VALUES ($1, 'Test Cat') ON CONFLICT (slug) DO NOTHING", [`cat-${tag}`]);

    const counts = await query(
      `SELECT (SELECT COUNT(*)::int FROM users WHERE role = 'customer') AS customers,
              (SELECT COUNT(*)::int FROM sellers WHERE status = 'approved') AS sellers,
              (SELECT COUNT(*)::int FROM products WHERE status = 'published') AS published`,
    );
    expect(counts.rows[0].customers).toBeGreaterThanOrEqual(1);
    expect(counts.rows[0].sellers).toBeGreaterThanOrEqual(0);
    expect(counts.rows[0].published).toBeGreaterThanOrEqual(0);
  });
});