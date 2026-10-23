/**
 * VelRepeat V2 — Phase 1 (domain + schema) tests.
 *
 * WHAT PHASE 1 ADDED (additive only, both canonical files)
 * --------------------------------------------------------
 *   • `velrepeat_packages` / `velrepeat_package_items` — a commercial
 *     composition of REAL products/variants. It owns no stock and carries no
 *     inventory authority: reservation/settlement keep flowing through the
 *     canonical `inventory` / `product_variants` rows for the referenced
 *     products (velrepeat-contract.md §40).
 *     `velrepeat_packages.seller_id` is NOT NULL (owner decision G3 = B,
 *     seller-owned packages): the package has exactly one owning seller, so a
 *     multi-seller package is impossible by construction. See
 *     `velrepeat-packages-ownership.test.ts`.
 *   • `velrepeat_plans.commitment_cycles` — the number of delivery cycles the
 *     customer buys (NULL for the pre-V2 pay-per-run plans that already exist;
 *     never defaulted, so no legacy row is silently reinterpreted).
 *   • `velrepeat_pricing_snapshots` / `velrepeat_pricing_snapshot_items` —
 *     append-only purchase-time pricing records (§45): commitment, currency,
 *     discount description/amount, total prepaid, pricing rule key/version,
 *     and per-line quantity/unit price/line total.
 *   • `velrepeat_cycles` — the delivery cycle entity, identity
 *     `UNIQUE (plan_id, cycle_number)` (§49/§58). This is the key the
 *     scheduler's idempotency ("same plan + same cycle ⇒ one order") must be
 *     provable against; its generation logic is Phase 5.
 *   • `orders.velrepeat_cycle_id` + FK + partial index — the cycle → order(s)
 *     link (§50). Nullable and unread by any code yet.
 *
 * WHAT PHASE 1 DELIBERATELY DID NOT ADD (owner decisions still open)
 * ------------------------------------------------------------------
 *   • any payment linkage for a plan-level prepaid charge (Q13 — payments
 *     remain strictly order-scoped; no nullability was loosened);
 *   • any plan-level inventory reservation (Decision A / Q1 — Phase 6);
 *   • any pricing-rule/tier storage (Decision H / Q11 — Phase 2);
 *   • any plan prepaid status vocabulary or payment_method semantics
 *     (Q13/Q14 — Phase 4);
 *   • no migration file: `.github/workflows/production-db-migrate.yml`
 *     auto-applies ALL pending migrations (048–050 are still unapplied — owner
 *     action) whenever `db/migrations/*.sql` changes on a push to main.
 *
 * The structural half runs everywhere (pure file reads). The integration half
 * needs a disposable database (`TEST_DATABASE_URL`, bootstrapped from
 * `db/run-sqleditor.sql`) and skips without one — exactly like every other
 * DB-gated suite here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { hasTestDatabase } from "./helpers/test-db.js";
import { NO_CANONICAL_DRIFT, canonicalParity, createTableBlock, unqualified } from "./helpers/canonical-schema.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const V2_TABLES = [
  "velrepeat_packages",
  "velrepeat_package_items",
  "velrepeat_pricing_snapshots",
  "velrepeat_pricing_snapshot_items",
  "velrepeat_cycles",
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. Canonical files — the DDL is present in BOTH and they stay identical
// ═══════════════════════════════════════════════════════════════════════════

describe("velrepeat v2 phase-1 schema — canonical files", () => {
  const schema = read("db/schema.sql");
  const bootstrap = read("db/run-sqleditor.sql");

  test("the reconciler still declares everything db/schema.sql declares", () => {
    // db/run-sqleditor.sql is the rerunnable additive reconciler, not a second
    // copy of the snapshot, so the contract is declaration parity rather than
    // byte-identity: it may carry the column/index/constraint passes an existing
    // database needs, but it may not drop or redefine what the snapshot declares.
    expect(canonicalParity(schema, bootstrap)).toEqual(NO_CANONICAL_DRIFT);
  });

  for (const table of V2_TABLES) {
    test(`both canonical files define ${table}`, () => {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
      expect(bootstrap).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    });
  }

  test("plans carry commitment_cycles and orders can link to a cycle", () => {
    for (const sql of [schema, bootstrap]) {
      expect(sql).toContain(
        "commitment_cycles INTEGER CHECK (commitment_cycles IS NULL OR commitment_cycles > 0)",
      );
      expect(sql).toContain("velrepeat_cycle_id UUID");
      expect(sql).toContain("orders_velrepeat_cycle_id_fkey");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_orders_velrepeat_cycle");
    }
  });

  test("cycle identity is (plan_id, cycle_number) — the scheduler's idempotency key", () => {
    for (const sql of [schema, bootstrap]) {
      expect(sql).toContain("UNIQUE (plan_id, cycle_number)");
    }
  });

  test("the package table owns no inventory authority (no stock column)", () => {
    for (const sql of [schema, bootstrap]) {
      // Bounded by the table's OWN closing paren. In the reconciler the index pass
      // is a later part, so anchoring the end on idx_velrepeat_packages_active
      // would scan unrelated tables (velrepeat_cycles has an 'out_of_stock'
      // status) and fail on text unrelated to this table.
      const block = createTableBlock(sql, "velrepeat_packages");
      expect(block).not.toBe("");
      expect(block).not.toContain("stock");
    }
  });

  test("G3=B — a package has exactly one owning seller and cannot exist without one", () => {
    for (const sql of [schema, bootstrap]) {
      expect(sql).toContain("seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE");
      expect(unqualified(sql)).toContain(
        "CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_seller ON velrepeat_packages (seller_id)",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Against a real database — constraints behave as the contract requires
// ═══════════════════════════════════════════════════════════════════════════

describe("velrepeat v2 phase-1 schema — integration (needs a test database)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;

  let userId: string | null = null;
  let shopId: string | null = null;
  let productAId: string | null = null;
  let productBId: string | null = null;
  let sellerId: string | null = null;
  const packageIds: string[] = [];
  let tag = "";

  beforeAll(async () => {
    if (!hasDb) return;
    const { query } = await import("../db/index.js");
    const { randomUUID } = await import("crypto");
    tag = `vr2-test-${randomUUID().slice(0, 8)}`;

    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [`${tag}@test.local`, "VelRepeat V2 Test"],
    );
    userId = user.rows[0].id as string;

    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [userId],
    );
    sellerId = seller.rows[0].id as string;

    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, `${tag} shop`, tag],
    );
    shopId = shop.rows[0].id as string;

    const productA = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, vrepeat_enabled)
       VALUES ($1, $2, $3, 100, 'published', TRUE) RETURNING id`,
      [shopId, `${tag} product A`, `${tag}-a`],
    );
    productAId = productA.rows[0].id as string;

    const productB = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, vrepeat_enabled)
       VALUES ($1, $2, $3, 25, 'published', TRUE) RETURNING id`,
      [shopId, `${tag} product B`, `${tag}-b`],
    );
    productBId = productB.rows[0].id as string;
  });

  afterAll(async () => {
    if (!hasDb) return;
    const { query } = await import("../db/index.js");
    if (packageIds.length > 0) {
      await query(`DELETE FROM velrepeat_packages WHERE id = ANY($1::uuid[])`, [packageIds]);
    }
    if (userId) await purgeUsers([userId]);
  });

  testFn("a package references real products and its composition is constrained", async () => {
    const { query } = await import("../db/index.js");

    const pkg = await query(
      `INSERT INTO velrepeat_packages (seller_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, `${tag} package`, "integration fixture — composition only"],
    );
    const packageId = pkg.rows[0].id as string;
    packageIds.push(packageId);

    await query(
      `INSERT INTO velrepeat_package_items (package_id, product_id, quantity)
       VALUES ($1, $2, 1), ($1, $3, 2)`,
      [packageId, productAId, productBId],
    );
    const items = await query(
      `SELECT COUNT(*)::int AS count FROM velrepeat_package_items WHERE package_id = $1`,
      [packageId],
    );
    expect(items.rows[0].count).toBe(2);

    // The same product twice in one composition is refused.
    let dupErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_package_items (package_id, product_id, quantity) VALUES ($1, $2, 1)`,
        [packageId, productAId],
      );
    } catch (e) {
      dupErr = e as { code?: string };
    }
    expect(dupErr?.code).toBe("23505");

    // A composition cannot reference a product that does not exist.
    let fkErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_package_items (package_id, product_id, quantity)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 1)`,
        [packageId],
      );
    } catch (e) {
      fkErr = e as { code?: string };
    }
    expect(fkErr?.code).toBe("23503");

    // quantity must be > 0.
    let checkErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_package_items (package_id, product_id, quantity) VALUES ($1, $2, 0)`,
        [packageId, productBId],
      );
    } catch (e) {
      checkErr = e as { code?: string };
    }
    expect(checkErr?.code).toBe("23514");
  });

  testFn("commitment_cycles is enforced and cycles are unique per (plan, cycle_number)", async () => {
    const { query } = await import("../db/index.js");

    const plan = await query(
      `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'active', 'days', 7, 4, NOW() + INTERVAL '7 days') RETURNING id`,
      [userId],
    );
    const planId = plan.rows[0].id as string;

    const stored = await query(`SELECT commitment_cycles FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(stored.rows[0].commitment_cycles).toBe(4);

    // The commitment promise expressed as cycle rows: 1..4.
    for (const n of [1, 2, 3, 4]) {
      await query(
        `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at)
         VALUES ($1, $2, NOW() + ($3 || ' days')::interval)`,
        [planId, n, String(n * 7)],
      );
    }
    const cycles = await query(
      `SELECT COUNT(*)::int AS count FROM velrepeat_cycles WHERE plan_id = $1`,
      [planId],
    );
    expect(cycles.rows[0].count).toBe(4);

    const first = await query(
      `SELECT status FROM velrepeat_cycles WHERE plan_id = $1 AND cycle_number = 1`,
      [planId],
    );
    expect(first.rows[0].status).toBe("scheduled");

    // Same plan + same cycle number ⇒ exactly one row, refused at the database.
    let dupErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at) VALUES ($1, 1, NOW())`,
        [planId],
      );
    } catch (e) {
      dupErr = e as { code?: string };
    }
    expect(dupErr?.code).toBe("23505");

    // cycle_number must be > 0.
    let cycleErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at) VALUES ($1, 0, NOW())`,
        [planId],
      );
    } catch (e) {
      cycleErr = e as { code?: string };
    }
    expect(cycleErr?.code).toBe("23514");

    // commitment_cycles = 0 must be refused.
    let planErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
         VALUES ($1, 'active', 'days', 7, 0, NOW() + INTERVAL '7 days')`,
        [userId],
      );
    } catch (e) {
      planErr = e as { code?: string };
    }
    expect(planErr?.code).toBe("23514");
  });

  testFn("orders link to their delivery cycle and the FK is enforced", async () => {
    const { query } = await import("../db/index.js");
    const { randomUUID } = await import("crypto");

    const plan = await query(
      `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'active', 'days', 7, 1, NOW() + INTERVAL '7 days') RETURNING id`,
      [userId],
    );
    const planId = plan.rows[0].id as string;

    const cycle = await query(
      `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at)
       VALUES ($1, 1, NOW() + INTERVAL '7 days') RETURNING id`,
      [planId],
    );
    const cycleId = cycle.rows[0].id as string;

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, status, total_amount, currency, velrepeat_cycle_id)
       VALUES ($1, $2, 'pending', 100, 'THB', $3) RETURNING id`,
      [userId, shopId, cycleId],
    );
    const linked = await query(`SELECT velrepeat_cycle_id FROM orders WHERE id = $1`, [order.rows[0].id]);
    expect(linked.rows[0].velrepeat_cycle_id).toBe(cycleId);

    // A cycle id that does not exist is refused.
    let fkErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO orders (user_id, shop_id, status, total_amount, currency, velrepeat_cycle_id)
         VALUES ($1, $2, 'pending', 100, 'THB', $3)`,
        [userId, shopId, randomUUID()],
      );
    } catch (e) {
      fkErr = e as { code?: string };
    }
    expect(fkErr?.code).toBe("23503");
  });

  testFn("pricing snapshots are append-only and carry the purchase-time totals", async () => {
    const { query } = await import("../db/index.js");

    const plan = await query(
      `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'active', 'days', 7, 4, NOW() + INTERVAL '7 days') RETURNING id`,
      [userId],
    );
    const planId = plan.rows[0].id as string;

    const snapshot = await query(
      `INSERT INTO velrepeat_pricing_snapshots
         (plan_id, commitment_cycles, currency, subtotal_amount, discount_type, discount_value, discount_amount, cycle_price, total_amount, pricing_rule_key, pricing_rule_version)
       VALUES ($1, 4, 'THB', 400, 'commitment_tier', 7, 28, 93, 372, 'velrepeat_commitment_v1', '1')
       RETURNING id`,
      [planId],
    );
    const snapshotId = snapshot.rows[0].id as string;

    await query(
      `INSERT INTO velrepeat_pricing_snapshot_items (snapshot_id, product_id, quantity, unit_price, line_total)
       VALUES ($1, $2, 1, 93, 93), ($1, $3, 1, 7, 7)`,
      [snapshotId, productAId, productBId],
    );

    const stored = await query(
      `SELECT total_amount, subtotal_amount, discount_amount, currency FROM velrepeat_pricing_snapshots WHERE id = $1`,
      [snapshotId],
    );
    expect(Number(stored.rows[0].total_amount)).toBe(372);
    expect(Number(stored.rows[0].subtotal_amount)).toBe(400);
    expect(Number(stored.rows[0].discount_amount)).toBe(28);
    expect(stored.rows[0].currency).toBe("THB");

    const lineItems = await query(
      `SELECT COUNT(*)::int AS count FROM velrepeat_pricing_snapshot_items WHERE snapshot_id = $1`,
      [snapshotId],
    );
    expect(lineItems.rows[0].count).toBe(2);

    // Negative money is refused. `cycle_price` is supplied so the refusal is
    // genuinely about the negative TOTAL and not merely the NOT NULL rule.
    let moneyErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_pricing_snapshots (plan_id, commitment_cycles, cycle_price, total_amount)
         VALUES ($1, 1, 0, -1)`,
        [planId],
      );
    } catch (e) {
      moneyErr = e as { code?: string };
    }
    expect(moneyErr?.code).toBe("23514");

    // A snapshot with no per-cycle price at all is refused too: every V2
    // snapshot must be able to say what ONE cycle costs as well as what the
    // whole commitment costs.
    let cyclePriceErr: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_pricing_snapshots (plan_id, commitment_cycles, total_amount)
         VALUES ($1, 4, 372)`,
        [planId],
      );
    } catch (e) {
      cyclePriceErr = e as { code?: string };
    }
    expect(cyclePriceErr?.code).toBe("23514");

    // Append-only: a later snapshot for the same plan is allowed.
    await query(
      `INSERT INTO velrepeat_pricing_snapshots (plan_id, commitment_cycles, cycle_price, total_amount)
       VALUES ($1, 4, 93, 372)`,
      [planId],
    );
    const snapshots = await query(
      `SELECT COUNT(*)::int AS count FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    expect(snapshots.rows[0].count).toBe(2);
  });
});
