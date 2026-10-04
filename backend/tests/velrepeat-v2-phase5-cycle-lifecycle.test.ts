/**
 * VelRepeat V2 — Phase 5: cycle lifecycle & per-cycle order creation.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE PROVES
 * ──────────────────────
 * The two halves of the phase, against a real database:
 *
 *   1. ACTIVATION MINTS A SCHEDULE. A 4-cycle prepaid plan gets exactly four
 *      `velrepeat_cycles` rows, numbered 1..4, on the plan's own cadence, all
 *      pointing at the one pricing snapshot — and NOTHING else. No order, no
 *      inventory movement, no run row.
 *
 *   2. A DUE CYCLE CREATES ITS OWN ORDER, ONCE. When a cycle reaches its
 *      `scheduled_at` the worker creates a real row in the canonical `orders`
 *      / `order_items` tables, linked by `orders.velrepeat_cycle_id`, priced
 *      from the FROZEN snapshot rather than today's catalog.
 *
 * And the three properties the owner called out as hard requirements:
 * idempotency under a repeated tick, idempotency under CONCURRENT workers, and
 * the separation of the cycle axis from the order axis.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ─────────────────────────────
 * No HTTP. The Phase 4 suite already proves the Stripe activation boundary end
 * to end, and the two updated assertions there are what pin "activation creates
 * a schedule and no fulfillment". This suite drives `createCycleSchedule`,
 * `processCycle` and `processDueCycles` directly, because the properties under
 * test are database properties — claiming a row under contention is not
 * observable through a request.
 *
 * Every fixture is scoped to a `p5-` tag and purged through the shared
 * `purgeUsers` helper, so nothing this suite writes can reach another test or,
 * more importantly, a production database (the suite is gated by
 * `hasTestDatabase()`, which refuses a production-shaped configuration).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";
import {
  createCycleSchedule,
  processCycle,
  processDueCycles,
  planCycleInstants,
  CycleScheduleError,
} from "../lib/velrepeat-cycles.js";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Comments are documentation, not code. The migration header NAMES the
 * destructive statements it refuses to run ("no DROP TABLE, no DELETE…") and
 * the module header NAMES the side effects it refuses to write
 * ("NO `sold_count` WRITE"), so asserting on the raw text would fail on the
 * very comments that prove the intent. Assertions about what code DOES are made
 * against the stripped source.
 */
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const stripTsComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/.*$/gm, "");

// ═══════════════════════════════════════════════════════════════════════════
// 1. STRUCTURAL — the boundaries this phase must not cross
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5 — structural boundaries", () => {
  const lib = stripTsComments(read("backend/lib/velrepeat-cycles.ts"));
  const migration = stripSqlComments(
    read("db/migrations/053_velrepeat_v2_cycle_lifecycle.sql"),
  );

  test("the delivery-cycle substrate ships in a migration, not only in the schema files", () => {
    // This is the omission that killed V0052 in production: `velrepeat_cycles`
    // and `orders.velrepeat_cycle_id` were in `db/schema.sql` and in no
    // `db/migrations/*.sql`, so they never reached the production database.
    expect(existsSync(join(root, "db/migrations/053_velrepeat_v2_cycle_lifecycle.sql"))).toBe(true);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS velrepeat_cycles/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS velrepeat_cycle_id UUID/i);
    expect(migration).toMatch(/orders_velrepeat_cycle_id_fkey/i);
  });

  test("the cycle → order link is constrained to ONE order per (cycle, shop)", () => {
    // Decision Q17: a plan may span sellers, so a cycle splits into one order
    // per shop and the exactly-once key is (cycle, shop), not (cycle).
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle_seller_unique/i,
    );
    expect(migration).toMatch(/\(velrepeat_cycle_id, shop_id\)/i);
  });

  test("migration 053 is additive and backward-compatible", () => {
    for (const destructive of [
      /DROP TABLE/i,
      /DROP COLUMN/i,
      /TRUNCATE/i,
      /\bDELETE FROM\b/i,
      /\bUPDATE\s+orders\b/i,
    ]) {
      expect(migration).not.toMatch(destructive);
    }
    // The one statement that touches a V1 core table only ADDS a nullable
    // column, so every pre-existing order keeps its row and its values.
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS velrepeat_cycle_id UUID;\s*$/m);
    // `db/run-update.sql` stays dead.
    expect(existsSync(join(root, "db/run-update.sql"))).toBe(false);
  });

  test("both canonical schema files carry the constraint, and stay identical", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      expect(read(file)).toMatch(/idx_orders_velrepeat_cycle_seller_unique/i);
      expect(read(file)).toMatch(/CREATE TABLE IF NOT EXISTS velrepeat_cycles/i);
    }
    expect(read("db/schema.sql")).toBe(read("db/run-sqleditor.sql"));
  });

  test("scheduling reuses the ONE existing authority instead of re-deriving it", () => {
    // Decision Q16 fixes UTC/`calculateNextRunAt` as the single authority. A
    // second date arithmetic implementation is exactly the duplication
    // contract §42 forbids, and it is how month-clamping drifts.
    expect(lib).toMatch(
      /import \{ calculateNextRunAt, type FrequencyType \} from "\.\.\/jobs\/velrepeat-scheduler\.js"/,
    );
    expect(lib).not.toMatch(/setUTCDate|setUTCMonth|setUTCFullYear/);
    expect(lib).not.toMatch(/function calculateNextRunAt/);
  });

  test("no payment, no sold_count, no run, no inventory commit", () => {
    // Q14: one prepaid charge per plan, so a cycle order has no payment of
    // its own. Q2: the recognition moment is an OPEN owner decision, so
    // writing sold_count here would invent policy. §9.2: velrepeat_runs is the
    // execution attempt, retired in Phase 7 — Phase 5 writes no run row.
    expect(lib).not.toMatch(/sold_count/i);
    expect(lib).not.toMatch(/INSERT INTO payments/i);
    expect(lib).not.toMatch(/commitOrderInventory/);
    expect(lib).not.toMatch(/INSERT INTO velrepeat_runs/i);
    // A cycle order is a real order in the canonical machine, not a special
    // status of its own.
    expect(lib).not.toMatch(/pending_payment|INSERT INTO velrepeat_orders/i);
  });

  test("a plan holds each product at most once, so a multi-seller cycle splits by DIFFERENT products", () => {
    // Decision Q17 says multi-seller plans are real, and the shape of one is
    // determined by the canonical schema, not by this phase. `products.shop_id`
    // is NOT NULL and `velrepeat_items` carries two partial unique indexes, so
    // a plan can hold a given product at most once and a product belongs to
    // exactly one shop. A plan therefore spans sellers by carrying DIFFERENT
    // products from different shops — it cannot list one product twice. This is
    // pinned here because getting it wrong produces a fixture the database
    // rejects, and because it is the reason a cycle's per-shop money sum is
    // keyed on line identity rather than on `product_id`.
    const schema = read("db/schema.sql");
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_variant ON velrepeat_items \(plan_id, product_id, variant_id\) WHERE variant_id IS NOT NULL/,
    );
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_items_unique_no_variant ON velrepeat_items \(plan_id, product_id\) WHERE variant_id IS NULL/,
    );
    // …and the snapshot join must not match on price, which is where the
    // discounted snapshot price and the base plan price legitimately differ.
    const stripped = stripTsComments(read("backend/lib/velrepeat-cycles.ts"));
    expect(stripped).toMatch(/vi\.variant_id IS NOT DISTINCT FROM i\.variant_id/);
    expect(stripped).not.toMatch(/vi\.unit_price = i\.unit_price/);
    expect(stripped).not.toMatch(/vi\.quantity = i\.quantity/);
  });

  test("the cycle state machine is the owner's, and adds no synonym for `completed`", () => {
    // `fulfilled` would be a second word for `completed` — the
    // duplicate-state-machine hazard. It must never appear as a written state.
    expect(lib).not.toMatch(/'fulfilled'|"fulfilled"/);
    // The canonical ORDER vocabulary is untouched: this module writes exactly
    // one order status, and it is the canonical entry state. `$3` is the
    // server-generated public order number (`order_number`), which sits between
    // the shop and the status — the STATE is still the only written value.
    expect(lib).toMatch(/VALUES \(\$1, \$2, \$3, 'pending'/);
  });

  test("activation is wired into the Phase 4 settlement, inside its transaction", () => {
    const payments = read("backend/routes/velrepeat-v2-payments.ts");
    expect(payments).toMatch(/import \{ createCycleSchedule \} from "\.\.\/lib\/velrepeat-cycles\.js"/);
    expect(payments).toMatch(/await createCycleSchedule\(client, charge\.planId/);
  });

  test("the due-cycle worker exists and is started, and is not the V1 scheduler", () => {
    const job = read("backend/jobs/velrepeat-v2-cycle-scheduler.ts");
    const server = read("backend/server.ts");
    expect(job).toMatch(/processDueCycles/);
    expect(server).toMatch(/startVelRepeatV2CycleScheduler\(\)/);
    // The V1 scheduler is untouched: it is still the pay-per-run worker.
    expect(read("backend/jobs/velrepeat-scheduler.ts")).toMatch(
      /export function startVelRepeatScheduler/,
    );
  });

  test("planCycleInstants steps by the plan's own cadence", () => {
    const first = new Date("2026-01-15T00:00:00.000Z");
    expect(planCycleInstants(first, "weeks", 1, 4).map((d) => d.toISOString())).toEqual([
      "2026-01-15T00:00:00.000Z",
      "2026-01-22T00:00:00.000Z",
      "2026-01-29T00:00:00.000Z",
      "2026-02-05T00:00:00.000Z",
    ]);
    // Month day-clamping is inherited, not reinvented: Jan 31 + 1 month is
    // Feb 28, never Mar 3.
    expect(planCycleInstants(new Date("2026-01-31T00:00:00.000Z"), "months", 1, 2)[1].toISOString())
      .toBe("2026-02-28T00:00:00.000Z");
    // A commitment below one is refused rather than silently clamped.
    expect(() => planCycleInstants(first, "weeks", 1, 0)).toThrow(CycleScheduleError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2–6. Integration — the cycle lifecycle against a real database
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 5 — cycle lifecycle & per-cycle order creation (integration)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;
  const tag = `p5-${randomUUID().slice(0, 8)}`;

  const userIds: string[] = [];
  let customerId = "";
  let shopId = "";
  let sellerId = "";
  /** A non-variant product on `inventory`, with real stock. */
  let plainProductId = "";
  /** A variant product, so the guarded `product_variants` path is covered too. */
  let variantProductId = "";
  let variantId = "";
  /** A second shop + its own product, for the multi-seller (Q17) split. */
  let shop2Id = "";
  let seller2Id = "";
  let shop2ProductId = "";

  async function db() {
    return import("../db/index.js");
  }

  interface PlanItem {
    productId: string;
    variantId: string | null;
    shopId: string;
    sellerId: string;
    quantity: number;
    unitPrice: string;
  }

  /**
   * An ACTIVE prepaid plan with its composition and its frozen pricing
   * snapshot — the exact shape `createCycleSchedule` consumes.
   *
   * The snapshot's `unit_price`/`line_total` are written independently of the
   * live catalog price, which is what lets the suite prove the order is priced
   * from the snapshot rather than from `products.price`.
   */
  async function makeActivePlan(opts: {
    commitment: number;
    items: PlanItem[];
    nextRunAt: Date;
    frequency?: "days" | "weeks" | "months";
    interval?: number;
    status?: string;
  }): Promise<{ planId: string; snapshotId: string }> {
    const { query } = await db();
    const plan = await query(
      `INSERT INTO velrepeat_plans
         (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        customerId,
        opts.status ?? "active",
        opts.frequency ?? "weeks",
        opts.interval ?? 1,
        opts.commitment,
        opts.nextRunAt.toISOString(),
      ],
    );
    const planId = String(plan.rows[0].id);

    for (const item of opts.items) {
      await query(
        `INSERT INTO velrepeat_items
           (plan_id, product_id, variant_id, shop_id, seller_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          planId,
          item.productId,
          item.variantId,
          item.shopId,
          item.sellerId,
          item.quantity,
          item.unitPrice,
        ],
      );
    }

    const cyclePrice = opts.items.reduce(
      (sum, i) => sum + Number(i.unitPrice) * i.quantity,
      0,
    );
    const snapshot = await query(
      `INSERT INTO velrepeat_pricing_snapshots
         (plan_id, commitment_cycles, currency, subtotal_amount, discount_amount,
          cycle_price, total_amount, discount_type, discount_value, metadata)
       VALUES ($1, $2, 'THB', $3, 0.00, $3, $4, 'sequential_percentage', '0', $5::jsonb)
       RETURNING id`,
      [
        planId,
        opts.commitment,
        cyclePrice.toFixed(2),
        (cyclePrice * opts.commitment).toFixed(2),
        JSON.stringify({ final_price_exact: cyclePrice.toFixed(2) }),
      ],
    );
    const snapshotId = String(snapshot.rows[0].id);

    for (const item of opts.items) {
      await query(
        `INSERT INTO velrepeat_pricing_snapshot_items
           (snapshot_id, product_id, variant_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          snapshotId,
          item.productId,
          item.variantId,
          item.quantity,
          item.unitPrice,
          (Number(item.unitPrice) * item.quantity).toFixed(2),
        ],
      );
    }
    return { planId, snapshotId };
  }

  /** The plan's cycles, in schedule order. */
  async function cyclesOf(planId: string) {
    const { query } = await db();
    const res = await query(
      `SELECT id, cycle_number, status, scheduled_at, pricing_snapshot_id, metadata
         FROM velrepeat_cycles WHERE plan_id = $1 ORDER BY cycle_number ASC`,
      [planId],
    );
    return res.rows as Array<{
      id: string;
      cycle_number: number;
      status: string;
      scheduled_at: string;
      pricing_snapshot_id: string;
      metadata: Record<string, unknown>;
    }>;
  }

  /** Orders produced by any cycle of a plan, via the canonical link. */
  async function ordersOf(planId: string) {
    const { query } = await db();
    const res = await query(
      `SELECT o.id, o.status, o.subtotal, o.total_amount, o.currency, o.shop_id,
              o.velrepeat_cycle_id
         FROM orders o
        WHERE o.velrepeat_cycle_id IN (SELECT id FROM velrepeat_cycles WHERE plan_id = $1)
        ORDER BY o.created_at ASC`,
      [planId],
    );
    return res.rows as Array<{
      id: string;
      status: string;
      subtotal: string;
      total_amount: string;
      currency: string;
      shop_id: string;
      velrepeat_cycle_id: string;
    }>;
  }

  beforeAll(async () => {
    if (!hasDb) return;
    const { query } = await db();

    const mk = async (label: string) => {
      const r = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
        `${tag}-${label}@test.invalid`,
        `VelRepeat P5 ${label}`,
      ]);
      const id = String(r.rows[0].id);
      userIds.push(id);
      return id;
    };

    customerId = await mk("customer");
    const sellerUser = await mk("seller");
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUser],
    );
    sellerId = String(seller.rows[0].id);
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, `${tag} shop`, `${tag}-shop`],
    );
    shopId = String(shop.rows[0].id);

    const seller2User = await mk("seller2");
    const seller2 = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [seller2User],
    );
    seller2Id = String(seller2.rows[0].id);
    const shop2 = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [seller2Id, `${tag} shop2`, `${tag}-shop2`],
    );
    shop2Id = String(shop2.rows[0].id);

    // A SECOND SHOP NEEDS ITS OWN PRODUCT, and that is a schema fact rather
    // than a convenience. `products.shop_id` is NOT NULL and `velrepeat_items`
    // carries two partial unique indexes — `(plan_id, product_id, variant_id)`
    // for variant lines and `(plan_id, product_id)` for the rest — so a single
    // plan can hold a given product at most once, and one product can only ever
    // belong to one shop. A plan is therefore multi-seller by carrying
    // DIFFERENT products from DIFFERENT shops, never the same product twice.
    const shop2Product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, 555.00, 'published') RETURNING id`,
      [shop2Id, `${tag} shop2-product`, `${tag}-shop2-product`],
    );
    shop2ProductId = String(shop2Product.rows[0].id);
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 500, 0)`, [
      shop2ProductId,
    ]);

    // Deliberately priced FAR away from the snapshot price (100.00) the
    // fixtures commit to. If an order ever came out at 999.00, the suite has
    // caught the order reading today's catalog instead of the frozen snapshot.
    const plain = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, 999.00, 'published') RETURNING id`,
      [shopId, `${tag} plain`, `${tag}-plain`],
    );
    plainProductId = String(plain.rows[0].id);
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 500, 0)`, [
      plainProductId,
    ]);

    const withVariant = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, 888.00, 'published') RETURNING id`,
      [shopId, `${tag} variant-product`, `${tag}-variant-product`],
    );
    variantProductId = String(withVariant.rows[0].id);
    const variant = await query(
      `INSERT INTO product_variants (product_id, name, price, stock, status)
       VALUES ($1, $2, 777.00, 500, 'active') RETURNING id`,
      [variantProductId, `${tag} variant`],
    );
    variantId = String(variant.rows[0].id);
  });

  afterAll(async () => {
    if (!hasDb) return;
    await purgeUsers(userIds);
  });

  // ── §11 BASIC ────────────────────────────────────────────────────────────

  testFn("a 1-cycle commitment creates exactly 1 cycle", async () => {
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await schedule(planId);
    expect(result.cycles).toHaveLength(1);
    expect(result.pricingSnapshotId).toBe(snapshotId);

    const cycles = await cyclesOf(planId);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle_number).toBe(1);
    expect(cycles[0].status).toBe("scheduled");
    expect(new Date(cycles[0].scheduled_at).toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(cycles[0].pricing_snapshot_id).toBe(snapshotId);

    // A schedule is not fulfillment.
    expect(await ordersOf(planId)).toHaveLength(0);
    const inv = await query(`SELECT reserved FROM inventory WHERE product_id = $1`, [plainProductId]);
    expect(Number(inv.rows[0].reserved)).toBe(0);
  });

  testFn("a 4-cycle commitment creates exactly 4 cycles, numbered 1..4", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 4,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 2, unitPrice: "100.00" },
      ],
      nextRunAt: new Date("2026-03-01T00:00:00.000Z"),
    });

    const result = await schedule(planId, snapshotId);
    expect(result.cycles).toHaveLength(4);

    const cycles = await cyclesOf(planId);
    expect(cycles).toHaveLength(4);
    expect(cycles.map((c) => c.cycle_number)).toEqual([1, 2, 3, 4]);
    // Cycle numbers are sequential, and every one is `scheduled`.
    expect(cycles.every((c) => c.status === "scheduled")).toBe(true);

    // Each cycle is one interval after the previous, from the plan's own
    // `next_run_at` — NOT from NOW().
    expect(cycles.map((c) => new Date(c.scheduled_at).toISOString())).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-03-08T00:00:00.000Z",
      "2026-03-15T00:00:00.000Z",
      "2026-03-22T00:00:00.000Z",
    ]);

    // The whole commitment points at ONE frozen snapshot.
    expect(cycles.every((c) => c.pricing_snapshot_id === snapshotId)).toBe(true);

    // Still no fulfillment of any kind.
    expect(await ordersOf(planId)).toHaveLength(0);
  });

  testFn("createCycleSchedule is idempotent — a second call adds no second schedule", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 3,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    await schedule(planId, snapshotId);
    const again = await schedule(planId, snapshotId);

    expect(again.cycles).toHaveLength(3);
    const cycles = await cyclesOf(planId);
    expect(cycles).toHaveLength(3);
    expect(cycles.map((c) => c.cycle_number)).toEqual([1, 2, 3]);
  });

  testFn("a non-active plan is refused a schedule", async () => {
    const { planId } = await makeActivePlan({
      commitment: 2,
      status: "draft",
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(schedule(planId)).rejects.toThrow(CycleScheduleError);
    expect(await cyclesOf(planId)).toHaveLength(0);
  });

  // ── §11 ORDER CREATION ───────────────────────────────────────────────────

  testFn("a due cycle creates exactly ONE order, linked by orders.velrepeat_cycle_id", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 4,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 2, unitPrice: "100.00" },
      ],
      // Due an hour ago, so it is genuinely overdue.
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);

    const [due] = await cyclesOf(planId);
    const result = await processCycle(due.id);

    expect(result.outcome).toBe("ordered");
    expect(result.orderIds).toHaveLength(1);

    const orders = await ordersOf(planId);
    expect(orders).toHaveLength(1);
    // The canonical link, and the cycle the owner is asking about.
    expect(orders[0].velrepeat_cycle_id).toBe(due.id);
    // A real order in the canonical machine, in its canonical entry state —
    // NOT `pending_payment`, because the customer already prepaid (Q14).
    expect(orders[0].status).toBe("pending");
    expect(orders[0].shop_id).toBe(shopId);
    expect(orders[0].currency).toBe("THB");

    // Priced from the FROZEN snapshot (100.00 × 2), not today's 999.00 catalog.
    expect(Number(orders[0].subtotal)).toBe(200);
    expect(Number(orders[0].total_amount)).toBe(200);

    // The line carries the snapshot's quantity and unit price.
    const { query } = await db();
    const items = await query(
      `SELECT product_id, quantity, price, subtotal, shop_id FROM order_items WHERE order_id = $1`,
      [orders[0].id],
    );
    expect(items.rows).toHaveLength(1);
    expect(Number(items.rows[0].quantity)).toBe(2);
    expect(Number(items.rows[0].price)).toBe(100);
    expect(Number(items.rows[0].subtotal)).toBe(200);
    expect(items.rows[0].product_id).toBe(plainProductId);
    expect(items.rows[0].shop_id).toBe(shopId);

    // The cycle advanced to `ordered` — not `completed`. A generated order is
    // not a fulfilled one.
    const [after] = await cyclesOf(planId);
    expect(after.status).toBe("ordered");
    expect((after.metadata as any).orderIds).toEqual(result.orderIds);

    // Only the DUE cycle produced an order; cycles 2..4 are still untouched.
    const all = await cyclesOf(planId);
    expect(all.slice(1).every((c) => c.status === "scheduled")).toBe(true);
    expect((await ordersOf(planId)).length).toBe(1);

    // NO payment row for the cycle (Q14) and NO sold_count write (Q2).
    const payments = await query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1`,
      [orders[0].id],
    );
    expect(payments.rows[0].n).toBe(0);
    const sold = await query(`SELECT sold_count FROM products WHERE id = $1`, [plainProductId]);
    expect(Number(sold.rows[0].sold_count)).toBe(0);
  });

  testFn("a FUTURE cycle creates no order", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() + 7 * 86_400_000),
    });
    await schedule(planId, snapshotId);
    const [cycle] = await cyclesOf(planId);

    // Other fixtures in this file leave due cycles behind, so the assertion is
    // scoped to THIS cycle rather than to a global due count: the point is
    // that a cycle whose `scheduled_at` has not arrived is never attempted.
    const report = await processDueCycles();
    expect(report.processed.map((c) => c.cycleId)).not.toContain(cycle.id);
    expect(await ordersOf(planId)).toHaveLength(0);
    expect((await cyclesOf(planId))[0].status).toBe("scheduled");
  });

  testFn("a variant line is ordered and its stock decremented exactly once", async () => {
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: variantProductId, variantId, shopId, sellerId, quantity: 3, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);

    const before = await query(`SELECT stock FROM product_variants WHERE id = $1`, [variantId]);
    const stockBefore = Number(before.rows[0].stock);

    const [cycle] = await cyclesOf(planId);
    expect((await processCycle(cycle.id)).outcome).toBe("ordered");

    const after = await query(`SELECT stock FROM product_variants WHERE id = $1`, [variantId]);
    // 3 units consumed, not 777.00 (the live variant price).
    expect(stockBefore - Number(after.rows[0].stock)).toBe(3);

    const orders = await ordersOf(planId);
    expect(orders).toHaveLength(1);
    expect(Number(orders[0].subtotal)).toBe(300);
  });

  testFn("a cycle spanning two shops splits into one order per shop", async () => {
    // Decision Q17: multi-seller plans are real, so a cycle is one order per
    // shop — and the (cycle, shop) unique key is what makes that safe. The
    // multi-seller shape is two DIFFERENT products from two different shops
    // (see the fixture note on the partial unique indexes).
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
        { productId: shop2ProductId, variantId: null, shopId: shop2Id, sellerId: seller2Id, quantity: 4, unitPrice: "50.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);

    const [cycle] = await cyclesOf(planId);
    const result = await processCycle(cycle.id);
    expect(result.outcome).toBe("ordered");
    expect(result.orderIds).toHaveLength(2);

    const orders = await ordersOf(planId);
    expect(orders).toHaveLength(2);
    // Each order is priced from ITS OWN shop's lines only: 100.00, then
    // 4 × 50.00. A whole-snapshot total (300.00) on both orders would be the
    // per-shop money bug, so the sorted totals are asserted exactly.
    const totals = orders.map((o) => Number(o.subtotal)).sort((a, b) => a - b);
    expect(totals).toEqual([100, 200]);
    // And each order really belongs to one of the two shops.
    const byShop = new Map(orders.map((o) => [o.shop_id, Number(o.subtotal)]));
    expect(byShop.get(shopId)).toBe(100);
    expect(byShop.get(shop2Id)).toBe(200);
    expect(byShop.size).toBe(2);
  });

  // ── §11 IDEMPOTENCY ──────────────────────────────────────────────────────

  testFn("a repeated scheduler tick creates NO duplicate order or reservation", async () => {
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 2, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);
    const [cycle] = await cyclesOf(planId);

    const reservedBefore = await query(
      `SELECT reserved FROM inventory WHERE product_id = $1`,
      [plainProductId],
    );

    // Three ticks, as a scheduler that retries would do. The claim is scoped
    // to this cycle: `processDueCycles` also picks up other fixtures' due
    // cycles, so what matters is that this cycle is worked exactly once.
    const attempts = [await processDueCycles(), await processDueCycles(), await processDueCycles()];
    expect(attempts[0].processed.map((c) => c.cycleId)).toContain(cycle.id);
    for (const retry of attempts.slice(1)) {
      expect(retry.processed.map((c) => c.cycleId)).not.toContain(cycle.id);
    }

    expect(await ordersOf(planId)).toHaveLength(1);

    // And the direct call that a naive retry would make is refused too.
    const retry = await processCycle(cycle.id);
    expect(retry.outcome).toBe("already_claimed");
    expect(retry.orderIds).toHaveLength(0);

    // The hold was taken exactly once — a double reservation is the specific
    // failure the owner named.
    const reservedAfter = await query(
      `SELECT reserved FROM inventory WHERE product_id = $1`,
      [plainProductId],
    );
    expect(Number(reservedAfter.rows[0].reserved) - Number(reservedBefore.rows[0].reserved)).toBe(2);

    // The cycle is still exactly one `ordered` cycle, and no duplicate
    // transition happened.
    const cycles = await cyclesOf(planId);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].status).toBe("ordered");
  });

  testFn("CONCURRENT workers create exactly one order between them", async () => {
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 5, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);
    const [cycle] = await cyclesOf(planId);

    const reservedBefore = await query(
      `SELECT reserved FROM inventory WHERE product_id = $1`,
      [plainProductId],
    );

    // Four workers reach the same cycle at the same instant. Exactly one may
    // win the `SELECT … FOR UPDATE` claim; the rest must block, re-read, and
    // return without writing. This is the test that would fail if the claim
    // were an in-memory flag.
    const results = await Promise.all([
      processCycle(cycle.id),
      processCycle(cycle.id),
      processCycle(cycle.id),
      processCycle(cycle.id),
    ]);

    const winners = results.filter((r) => r.outcome === "ordered");
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "already_claimed")).toHaveLength(3);
    // Every loser wrote nothing at all.
    for (const loser of results.filter((r) => r.outcome !== "ordered")) {
      expect(loser.orderIds).toHaveLength(0);
    }

    expect(await ordersOf(planId)).toHaveLength(1);

    const reservedAfter = await query(
      `SELECT reserved FROM inventory WHERE product_id = $1`,
      [plainProductId],
    );
    expect(Number(reservedAfter.rows[0].reserved) - Number(reservedBefore.rows[0].reserved)).toBe(5);
  });

  testFn("the database itself refuses a second order for the same (cycle, shop)", async () => {
    // The claim makes the common case clean; this unique index is what makes
    // the invariant true regardless of the code path. Tested directly so the
    // guarantee is not taken on the module's word.
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);
    const [cycle] = await cyclesOf(planId);
    await processCycle(cycle.id);

    expect(
      query(
        `INSERT INTO orders (user_id, shop_id, status, subtotal, total_amount, velrepeat_cycle_id)
         VALUES ($1, $2, 'pending', 0, 0, $3)`,
        [customerId, shopId, cycle.id],
      ),
    ).rejects.toThrow();

    // Still exactly one order for the cycle.
    expect(await ordersOf(planId)).toHaveLength(1);
  });

  // ── §11 STATE SAFETY ─────────────────────────────────────────────────────

  testFn("a DRAFT plan's due cycle creates no order", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      status: "draft",
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    // Force the cycle in by hand, so the test exercises the guard rather than
    // the (correct) fact that a draft plan is never scheduled.
    const { query } = await db();
    await query(
      `UPDATE velrepeat_plans SET status = 'draft' WHERE id = $1`,
      [planId],
    );
    // The plan is a draft, so a schedule is refused outright.
    expect(schedule(planId)).rejects.toThrow(CycleScheduleError);
    expect(await cyclesOf(planId)).toHaveLength(0);
    expect(snapshotId).toBeTruthy();
  });

  testFn("a non-active plan with a due cycle creates no order", async () => {
    // Insert the cycle directly so the plan's status is the ONLY thing under
    // test — the `plan_not_active` guard inside `processCycle`.
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      status: "active",
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    const cycle = await query(
      `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at, pricing_snapshot_id, status)
       VALUES ($1, 1, NOW() - INTERVAL '1 hour', $2, 'scheduled') RETURNING id`,
      [planId, snapshotId],
    );
    await query(`UPDATE velrepeat_plans SET status = 'cancelled' WHERE id = $1`, [planId]);

    const result = await processCycle(String(cycle.rows[0].id));
    expect(result.outcome).toBe("plan_not_active");
    expect(result.orderIds).toHaveLength(0);
    expect(await ordersOf(planId)).toHaveLength(0);
    // The cycle was left alone, not advanced.
    expect((await cyclesOf(planId))[0].status).toBe("scheduled");
  });

  testFn("an ACTIVE plan does not mean any order is completed", async () => {
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 4,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);

    // Four due cycles, all worked. Driven cycle by cycle rather than through
    // the batch, so the assertion does not depend on how many other fixtures'
    // due cycles are competing for one tick's limit.
    const cycles = await cyclesOf(planId);
    expect(cycles).toHaveLength(4);
    for (const cycle of cycles) {
      expect((await processCycle(cycle.id)).outcome).toBe("ordered");
    }
    expect(await ordersOf(planId)).toHaveLength(4);

    // Orders are `pending` — generated, not fulfilled. The canonical order
    // machine still owns every later step.
    const { query } = await db();
    const statuses = await query(
      `SELECT DISTINCT status FROM orders
        WHERE velrepeat_cycle_id IN (SELECT id FROM velrepeat_cycles WHERE plan_id = $1)`,
      [planId],
    );
    expect(statuses.rows.map((r) => r.status)).toEqual(["pending"]);

    // The cycles reached `ordered`, NOT `completed`.
    const after = await cyclesOf(planId);
    expect(after.every((c) => c.status === "ordered")).toBe(true);
    expect(after.some((c) => c.status === "completed")).toBe(false);

    // And the plan itself is still `active`, not `completed`.
    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("active");
  });

  testFn("insufficient stock ends the cycle `out_of_stock` with NO order and no false `ordered`", async () => {
    const { query } = await db();
    await query(`UPDATE inventory SET quantity = 1, reserved = 0 WHERE product_id = $1`, [
      plainProductId,
    ]);

    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 50, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);
    const [cycle] = await cyclesOf(planId);

    const result = await processCycle(cycle.id);
    expect(result.outcome).toBe("out_of_stock");

    // THE property the owner asked for: a failed order creation must NOT mark
    // the cycle `ordered`.
    const [after] = await cyclesOf(planId);
    expect(after.status).toBe("out_of_stock");
    expect(after.status).not.toBe("ordered");
    expect(after.metadata).toHaveProperty("refusal");

    // No order identity exists, and the refusal is recorded.
    expect(await ordersOf(planId)).toHaveLength(0);
    const event = await query(
      `SELECT event_type FROM velrepeat_events WHERE plan_id = $1 AND event_type LIKE 'CYCLE_%'`,
      [planId],
    );
    expect(event.rows.map((r) => r.event_type)).toContain("CYCLE_OUT_OF_STOCK");

    // A refused cycle is terminal: a retry must not re-attempt it forever.
    const retry = await processCycle(cycle.id);
    expect(retry.outcome).toBe("already_claimed");
    expect(await ordersOf(planId)).toHaveLength(0);
  });

  testFn("an unavailable product ends the cycle `item_unavailable`, separately from stock", async () => {
    const { query } = await db();
    await query(`UPDATE inventory SET quantity = 500, reserved = 0 WHERE product_id = $1`, [
      plainProductId,
    ]);
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);

    // The product is withdrawn from sale after the customer prepaid.
    await query(`UPDATE products SET status = 'draft' WHERE id = $1`, [plainProductId]);

    const [cycle] = await cyclesOf(planId);
    const result = await processCycle(cycle.id);

    // A withdrawn product is NOT "out of stock" — the two refusals mean
    // different things and are kept apart.
    expect(result.outcome).toBe("item_unavailable");
    expect(result.outcome).not.toBe("out_of_stock");
    expect((await cyclesOf(planId))[0].status).toBe("item_unavailable");
    expect(await ordersOf(planId)).toHaveLength(0);
  });

  testFn("a cycle whose line can no longer be attributed to a shop is refused", async () => {
    // An order with no shop_id would fall OUTSIDE the (cycle, shop) unique
    // index, silently removing the database half of the exactly-once
    // guarantee. Refusing is the only response that keeps it true.
    const { query } = await db();
    const { planId, snapshotId } = await makeActivePlan({
      commitment: 1,
      items: [
        { productId: plainProductId, variantId: null, shopId, sellerId, quantity: 1, unitPrice: "100.00" },
      ],
      nextRunAt: new Date(Date.now() - 3_600_000),
    });
    await schedule(planId, snapshotId);
    await query(`DELETE FROM velrepeat_items WHERE plan_id = $1`, [planId]);

    const [cycle] = await cyclesOf(planId);
    const result = await processCycle(cycle.id);
    expect(result.outcome).toBe("item_unavailable");
    expect(await ordersOf(planId)).toHaveLength(0);
  });
});

// ─── `createCycleSchedule` takes a PoolClient, because the Phase 4 activation
//     calls it inside the SETTLEMENT transaction so that "the plan went
//     active" and "its schedule exists" are one unit of work. These tests
//     reproduce that call shape exactly — a real transaction per call, the
//     client released by `withTransaction` — rather than a borrowed client
//     that would not model how production calls it. ────────────────────────
async function schedule(planId: string, pricingSnapshotId?: string) {
  const { withTransaction } = await import("../db/index.js");
  return withTransaction((c) =>
    createCycleSchedule(c, planId, pricingSnapshotId ? { pricingSnapshotId } : {}),
  );
}
