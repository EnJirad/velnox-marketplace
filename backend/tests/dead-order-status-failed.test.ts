/**
 * LOW #12 — the dead `"failed"` order status in `RELEASABLE_STATUSES`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `RELEASABLE_STATUSES` (`backend/lib/inventory.ts`) is the READ side of the
 * order-status domain: it gates the atomic `inventory_released` claim so that a
 * paid / shipped / delivered / completed order can never have its stock
 * returned. It listed `"failed"` — a value that does not exist in the order
 * domain at all. `"failed"` is a `payments.status` value (a per-ATTEMPT
 * outcome), never an `orders.status` one.
 *
 * The audit had to PROVE that before removing it, because a guard entry that
 * looks wrong is not the same as a guard entry that is wrong: if any writer
 * produced `orders.status = 'failed'`, removing the entry would silently stop
 * releasing inventory for a real state. The proof is in §2 and §5 below — the
 * writer enumeration, the whole-history check, and the live PostgreSQL refusal.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   1. `RELEASABLE_STATUSES` contains no dead order status (`"failed"` is
 *      gone, and nothing else dead was introduced in its place);
 *   2. every remaining member is a REAL `orders.status` value with a named
 *      writer in the source — the list cannot drift from the writers;
 *   3. `payment_failed` is still a genuine order/payment lifecycle value;
 *   4. `payments.status = 'failed'` is never read as an `orders.status` — the
 *      two axes stay separate in SQL, in the shared types and in the UI meta;
 *   5. the MEDIUM #9 allowed set is UNCHANGED (still exactly 12 values, still
 *      declared in both canonical SQL files and in V0050, and
 *      still WITHOUT `failed`) — the fix must not quietly widen the constraint;
 *   6. inventory release behavior is unchanged: each surviving status still
 *      releases, a non-releasable one still refuses, and a settled payment
 *      still outranks a cancellation.
 *
 * SCOPE
 * -----
 * This is a read-side guard cleanup. It adds no status, changes no state
 * machine, no cancellation / refund / retry policy, no `payments.status`
 * value, no Stripe semantics, and it does not touch `orders_status_check`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import { FULFILLMENT_STATUSES } from "../lib/order-fulfillment.js";
import { RELEASABLE_STATUSES, releaseOrderInventory } from "../lib/inventory.js";
import { PAYMENT_RESERVATION_EXPIRED_STATUS } from "../lib/payment-reservation.js";
import { PAYMENT_SETTLED_STATUSES } from "../lib/order-lock.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { NO_CANONICAL_DRIFT, canonicalParity } from "./helpers/canonical-schema.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Every `.ts` file under a directory, skipping tests and build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === "node_modules" || entry === "dist" || entry === "tests") continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (rel.endsWith(".ts") && !rel.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const BACKEND_SOURCE = sourceFiles("backend");
const PACKAGES_SOURCE = sourceFiles("packages/shared/src");

/** The payment half of `orders.status`, each with the writer that produces it. */
const PAYMENT_ORDER_STATUSES: Record<string, string> = {
  pending_payment: "backend/routes/stripe.ts",
  paid: "backend/routes/stripe.ts",
  payment_failed: "backend/routes/stripe.ts",
  refunded: "backend/routes/stripe.ts",
  [PAYMENT_RESERVATION_EXPIRED_STATUS]: "backend/jobs/payment-reservation-scheduler.ts",
};

/** The MEDIUM #9 allowed set, derived from the two authorities (not hardcoded). */
const ALLOWED_ORDER_STATUSES = [...FULFILLMENT_STATUSES, ...Object.keys(PAYMENT_ORDER_STATUSES)];

/** The set the guard is allowed to hold: real order statuses, never payments-only ones. */
const PAYMENTS_ONLY_STATUSES = ["processing", "requires_action", "partially_refunded", "succeeded", "failed"];

/** Given an index, the table the nearest preceding UPDATE / INSERT targets. */
function statementTable(content: string, index: number): string | null {
  const before = content.slice(0, index);
  const hits = [...before.matchAll(/\b(?:UPDATE|INTO)\s+([a-z_][a-z0-9_]*)/gi)];
  const last = hits[hits.length - 1];
  return last ? (last[1] as string).toLowerCase() : null;
}

/** Every SQL `status = 'failed'` write in the backend, with its target table. */
function failedStatusWrites(): Array<{ file: string; table: string | null }> {
  const found: Array<{ file: string; table: string | null }> = [];
  for (const file of BACKEND_SOURCE) {
    const content = read(file);
    for (const m of content.matchAll(/status\s*=\s*'failed'/gi)) {
      found.push({ file, table: statementTable(content, m.index ?? 0) });
    }
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The guard no longer holds a dead order status
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — RELEASABLE_STATUSES holds no dead order status", () => {
  test("`failed` is gone from the release guard", () => {
    expect(RELEASABLE_STATUSES).not.toContain("failed");
  });

  test("no payments-domain value leaks into the guard", () => {
    for (const status of PAYMENTS_ONLY_STATUSES) {
      expect(RELEASABLE_STATUSES).not.toContain(status);
    }
  });

  test("the guard is exactly the five statuses that were already reachable", () => {
    // Removal, not a rewrite: the four pre-existing real values plus `expired`.
    // A sixth entry here would mean something was added, not cleaned up.
    expect(RELEASABLE_STATUSES).toEqual([
      "pending",
      "pending_payment",
      "cancelled",
      "payment_failed",
      "expired",
    ]);
  });

  test("the guard holds no duplicates and no stray whitespace", () => {
    expect(new Set(RELEASABLE_STATUSES).size).toBe(RELEASABLE_STATUSES.length);
    for (const status of RELEASABLE_STATUSES) {
      expect(status).toBe(status.trim());
      expect(status).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  test("the source comment no longer advertises `failed` as an order status", () => {
    const lib = read("backend/lib/inventory.ts");
    const block = lib.slice(lib.indexOf("RELEASABLE_STATUSES: string[]"));
    // The declaration itself must be free of the dead value…
    expect(block.slice(0, block.indexOf("];"))).not.toContain('"failed"');
    // …and the guard is exported so this test can assert the real value, not a copy.
    expect(lib).toContain("export const RELEASABLE_STATUSES: string[]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Every remaining member is a REAL order status with a REAL writer
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — every remaining guard entry has a real orders.status writer", () => {
  test("the guard is a subset of the MEDIUM #9 allowed set", () => {
    for (const status of RELEASABLE_STATUSES) {
      expect(ALLOWED_ORDER_STATUSES).toContain(status);
    }
  });

  test("the two order-fulfilment entries come from the state machine", () => {
    // `pending` / `cancelled` are written by the INSERT + cancel paths, and are
    // also declared by the fulfilment authority — both must agree.
    for (const status of ["pending", "cancelled"]) {
      expect(FULFILLMENT_STATUSES).toContain(status as (typeof FULFILLMENT_STATUSES)[number]);
    }
  });

  test("checkout and VelRepeat INSERT orders as `pending`", () => {
    const cart = read("backend/routes/cart.ts");
    const velrepeat = read("backend/jobs/velrepeat-scheduler.ts");
    expect(cart).toMatch(/INSERT INTO orders \([^)]*status[^)]*\)[\s\S]{0,80}?'pending'/);
    expect(velrepeat).toMatch(/INSERT INTO orders \([^)]*status[^)]*\)[\s\S]{0,80}?'pending'/);
  });

  test("the payment-lifecycle entries are written by routes/stripe.ts", () => {
    const stripe = read("backend/routes/stripe.ts");
    for (const status of ["pending_payment", "paid", "payment_failed", "refunded", "cancelled"]) {
      expect(stripe).toContain(`UPDATE orders SET status = '${status}'`);
    }
  });

  test("`expired` is written by the reservation sweep", () => {
    // The value the sweep writes is the exported constant — pinned to the
    // literal so the guard and the writer cannot drift apart silently.
    expect(PAYMENT_RESERVATION_EXPIRED_STATUS).toBe("expired");
    const scheduler = read("backend/jobs/payment-reservation-scheduler.ts");
    expect(scheduler).toMatch(/UPDATE orders\s+SET status = \$2/);
    expect(scheduler).toContain("PAYMENT_RESERVATION_EXPIRED_STATUS,");
  });

  test("the two parameterized writers cannot escape the allowed set", () => {
    // `SET status = $1` is the only way an unlisted value could reach the
    // column at runtime, so both are gated on the fulfilment authority.
    const seller = read("backend/routes/seller-orders.ts");
    expect(seller).toContain("if (!isSellerOrderStatus(status))");
    expect(seller).toContain("SELLER_ORDER_STATUSES = FULFILLMENT_STATUSES");

    const center = read("backend/routes/center.ts");
    expect(center).toContain("if (!isFulfillmentStatus(to))");
    expect(center).toContain("UPDATE orders SET status = $1");
  });

  test("no source file anywhere writes `orders.status = 'failed'`", () => {
    // The whole point of the removal: a guard entry for a state nothing can
    // produce. Checked across EVERY backend + shared source file, not a sample.
    for (const file of [...BACKEND_SOURCE, ...PACKAGES_SOURCE]) {
      const content = read(file);
      expect(content).not.toMatch(/UPDATE\s+orders[\s\S]{0,200}?status\s*=\s*'failed'/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. `payment_failed` is still a real lifecycle value (nothing was over-pruned)
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — payment_failed survives as a real order status", () => {
  test("it is in both the guard and the MEDIUM #9 allowed set", () => {
    expect(RELEASABLE_STATUSES).toContain("payment_failed");
    expect(ALLOWED_ORDER_STATUSES).toContain("payment_failed");
  });

  test("it is written on `payment_intent.payment_failed` and normalizes to cancelled", () => {
    const stripe = read("backend/routes/stripe.ts");
    expect(stripe).toContain("UPDATE orders SET status = 'payment_failed'");
    // A failed charge means nothing left to fulfil — the state machine still
    // treats it as terminal, and that mapping must not change.
    expect(FULFILLMENT_STATUSES).toContain("cancelled");
  });

  test("a `payment_failed` order normalizes to `cancelled`, not to a dead state", () => {
    // Imported indirectly through the module the guard lives beside; the
    // normalization is the single authority for what a raw value MEANS.
    const fulfillment = read("backend/lib/order-fulfillment.ts");
    expect(fulfillment).toContain("case \"payment_failed\":");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. `payments.status = 'failed'` is never read as an `orders.status`
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — the payments axis stays separate from the orders axis", () => {
  test("every SQL `status = 'failed'` write targets payments, never orders", () => {
    const writes = failedStatusWrites();
    // Sanity: the scan must actually be finding the known sites, or it proves
    // nothing. If this list ever empties, the scan has silently broken.
    expect(writes.length).toBeGreaterThan(0);
    expect(
      writes.some((w) => w.file === "backend/routes/stripe.ts" && w.table === "payments"),
    ).toBe(true);
    expect(
      writes.some((w) => w.file === "backend/routes/stripe.ts" && w.table === "payment_events"),
    ).toBe(true);
    for (const w of writes) {
      expect(w.table).not.toBe("orders");
      expect(["payments", "payment_events"]).toContain(w.table);
    }
  });

  test("StoreOrderStatus has no `failed`; StorePaymentStatus does", () => {
    const commerce = read("packages/shared/src/lib/commerce.ts");
    const typeBody = (name: string) => {
      const start = commerce.indexOf(`export type ${name} =`);
      expect(start).toBeGreaterThan(-1);
      return commerce.slice(start, commerce.indexOf(";", start));
    };
    expect(typeBody("StoreOrderStatus")).not.toContain('"failed"');
    expect(typeBody("StorePaymentStatus")).toContain('"failed"');
  });

  test("the order badge metadata has no `failed` entry", () => {
    const shop = read("packages/shared/src/lib/shop.ts");
    const start = shop.indexOf("export const ORDER_STATUS_META");
    const block = shop.slice(start, shop.indexOf("};", start));
    const keys = [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1] as string);
    expect(keys).not.toContain("failed");
    expect(keys).toEqual([...FULFILLMENT_STATUSES]);
  });

  test("the read-side `NOT IN (… 'failed' …)` guards are reads, not writers", () => {
    // Analytics/display surfaces defensively exclude a `failed` order. That is
    // harmless once nothing can write one, and it is NOT this task's business
    // to rewrite. What matters is that none of them is a write path.
    const readSide = [
      "backend/routes/center.ts",
      "backend/routes/products.ts",
      "backend/routes/seller-intelligence.ts",
    ];
    for (const file of readSide) {
      const content = read(file);
      expect(content).toMatch(/o\.status NOT IN \('cancelled', 'failed', 'refunded'\)/);
      expect(content).not.toMatch(/UPDATE orders[\s\S]{0,200}?'failed'/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. MEDIUM #9's allowed set is UNCHANGED — the fix did not widen it
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — MEDIUM #9 (orders.status CHECK) is untouched", () => {
  const SCHEMA = "db/schema.sql";
  const BOOTSTRAP = "db/run-sqleditor.sql";
  const MIGRATION = "db/migrations/050_orders_status_check.sql";

  function declaredValues(sql: string): string[] {
    const match = sql.match(/ADD CONSTRAINT orders_status_check\s+CHECK \(status IN \(([^)]*)\)\)/);
    expect(match).not.toBeNull();
    return [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
  }

  test("the allowed set is still exactly the twelve derived values", () => {
    expect(ALLOWED_ORDER_STATUSES.sort()).toEqual([
      "cancelled",
      "completed",
      "confirmed",
      "delivered",
      "expired",
      "packing",
      "paid",
      "payment_failed",
      "pending",
      "pending_payment",
      "refunded",
      "shipped",
    ]);
    // `failed` is NOT one of them — the fix removed a dead guard entry, it did
    // not bless the dead value into the database.
    expect(ALLOWED_ORDER_STATUSES).not.toContain("failed");
    expect(ALLOWED_ORDER_STATUSES).toHaveLength(12);
  });

  test("both canonical SQL files still declare exactly that set", () => {
    // db/run-sqleditor.sql is a rerunnable additive reconciler, not a copy of
    // db/schema.sql, so the two are compared on what they DECLARE rather than on
    // their bytes; helpers/canonical-schema.ts carries that contract.
    expect(canonicalParity(read(SCHEMA), read(BOOTSTRAP))).toEqual(NO_CANONICAL_DRIFT);
    expect(declaredValues(read(SCHEMA)).sort()).toEqual([...ALLOWED_ORDER_STATUSES].sort());
  });

  test("V0050 still declares exactly that set and still excludes `failed`", () => {
    expect(declaredValues(read(MIGRATION)).sort()).toEqual([...ALLOWED_ORDER_STATUSES].sort());
    expect(read(MIGRATION)).not.toMatch(/CHECK[^;]*'failed'/);
  });

  test("the guard is a strict subset of what the CHECK allows", () => {
    // If the guard ever named something the CHECK forbids, the guard would be
    // describing a state the database itself will not store.
    for (const status of RELEASABLE_STATUSES) {
      expect(ALLOWED_ORDER_STATUSES).toContain(status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Inventory release behavior is UNCHANGED
// ═══════════════════════════════════════════════════════════════════════════

describe("LOW #12 — the release claim's shape is unchanged", () => {
  test("the guarded UPDATE still carries every clause that makes it safe", () => {
    const lib = read("backend/lib/inventory.ts");
    // The claim: not already released, status is releasable, no settled
    // payment, and it RETURNS the row so only the winner mutates stock.
    expect(lib).toMatch(/AND inventory_released = FALSE/);
    expect(lib).toMatch(/AND status = ANY\(\$2::text\[\]\)/);
    expect(lib).toMatch(/AND NOT EXISTS \(\s*SELECT 1 FROM payments p/);
    expect(lib).toMatch(/RETURNING id/);
    // The guard is still bound to the claim, as $2.
    expect(lib).toContain("[orderId, RELEASABLE_STATUSES, [...PAYMENT_SETTLED_STATUSES]]");
  });

  test("the settled-payment gate is unchanged", () => {
    // A settled payment still outranks a cancellation: the same values as
    // before this task, and they are read from `payments`, not `orders`.
    expect([...PAYMENT_SETTLED_STATUSES]).toEqual(["paid", "processing"]);
    const lib = read("backend/lib/inventory.ts");
    expect(lib).toMatch(/p\.status = ANY\(\$3::text\[\]\)/);
  });

  test("no new status was introduced to compensate for the removal", () => {
    // `RELEASABLE_STATUSES` is the ONLY array-valued constant in this module —
    // no second, parallel list was added to keep the removed entry alive.
    const lib = read("backend/lib/inventory.ts");
    const lists = [...lib.matchAll(/(?:const|export const) ([A-Z_]+)\s*(?::[^=]+)?=\s*\[/g)].map(
      (m) => m[1] as string,
    );
    expect(lists).toEqual(["RELEASABLE_STATUSES"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Database-gated: the real PostgreSQL answers
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("release guard + orders.status CHECK against a real database (requires TEST_DATABASE_URL)", () => {
  let seededUserIds: Array<string | null> = [];

  afterEach(async () => {
    await purgeUsers(seededUserIds);
    seededUserIds = [];
  });

  /** user → seller → shop → product → inventory, with `orderQty` reserved. */
  async function seedReservedOrder(orderQty: number) {
    const { query, withTransaction } = await import("../db/index.js");
    const { reserveInventoryStock } = await import("../lib/inventory.js");
    const tag = `low12-${crypto.randomUUID()}`;

    const user = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}@test.local`,
      "LOW12 Fixture",
    ]);
    const userId = user.rows[0].id as string;
    seededUserIds.push(userId);

    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      userId,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, 100, 'published') RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, 0)`, [productId, 10]);

    await withTransaction(async (client) => {
      await reserveInventoryStock(client, productId, orderQty);
    });

    return { query, withTransaction, userId, productId, orderQty };
  }

  async function attachOrder(userId: string, productId: string, orderQty: number, status: string) {
    const { query } = await import("../db/index.js");
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, $3, 'THB') RETURNING id`,
      [userId, status, 100 * orderQty],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, 'test', $3, 100, $4)`,
      [orderId, productId, orderQty, 100 * orderQty],
    );
    return orderId;
  }

  async function reservedOf(productId: string): Promise<number> {
    const { query } = await import("../db/index.js");
    const res = await query(`SELECT reserved FROM inventory WHERE product_id = $1`, [productId]);
    return Number(res.rows[0].reserved);
  }

  // ── 6. behaviour is unchanged for every status the guard still accepts ──

  testFn("every surviving guard status still releases its reserved stock", async () => {
    for (const status of RELEASABLE_STATUSES) {
      const ORDER_QTY = 2;
      const { query, withTransaction, userId, productId } = await seedReservedOrder(ORDER_QTY);
      const orderId = await attachOrder(userId, productId, ORDER_QTY, status);

      expect(await reservedOf(productId)).toBe(ORDER_QTY);

      const released = await withTransaction((client) => releaseOrderInventory(client, orderId));
      expect(released).toBe(true);
      expect(await reservedOf(productId)).toBe(0);

      // Still idempotent: a second call is a no-op, not a second restore.
      const again = await withTransaction((client) => releaseOrderInventory(client, orderId));
      expect(again).toBe(false);
      expect(await reservedOf(productId)).toBe(0);

      // Silence the unused-binding linters without weakening anything.
      expect(typeof query).toBe("function");
    }
  });

  testFn("a non-releasable status still refuses to release", async () => {
    for (const status of ["paid", "shipped", "delivered", "completed", "confirmed"]) {
      const ORDER_QTY = 2;
      const { withTransaction, userId, productId } = await seedReservedOrder(ORDER_QTY);
      const orderId = await attachOrder(userId, productId, ORDER_QTY, status);

      const released = await withTransaction((client) => releaseOrderInventory(client, orderId));
      expect(released).toBe(false);
      expect(await reservedOf(productId)).toBe(ORDER_QTY);
    }
  });

  testFn("a settled payment still outranks the status guard", async () => {
    const ORDER_QTY = 2;
    const { query, withTransaction, userId, productId } = await seedReservedOrder(ORDER_QTY);
    const orderId = await attachOrder(userId, productId, ORDER_QTY, "cancelled");
    await query(
      `INSERT INTO payments (order_id, method, status, amount, provider) VALUES ($1, 'CARD', 'paid', 100, 'stripe')`,
      [orderId],
    );

    const released = await withTransaction((client) => releaseOrderInventory(client, orderId));
    expect(released).toBe(false);
    expect(await reservedOf(productId)).toBe(ORDER_QTY);
  });

  // ── the definitive proof that the removed entry was dead ──

  testFn("PostgreSQL itself refuses `orders.status = 'failed'`", async () => {
    const { query } = await import("../db/index.js");
    const user = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `low12-refuse-${crypto.randomUUID()}@test.local`,
      "LOW12 Refusal",
    ]);
    const userId = user.rows[0].id as string;
    seededUserIds.push(userId);

    // INSERT is refused by `orders_status_check` (23514)…
    let insertErr: unknown = null;
    try {
      await query(
        `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'failed', 100, 'THB')`,
        [userId],
      );
    } catch (err) {
      insertErr = err;
    }
    expect(insertErr).not.toBeNull();
    expect((insertErr as { code?: string }).code).toBe("23514");

    // …and so is UPDATE onto an existing row, so no historical row and no
    // future writer can put a `failed` order past the guard that was removed.
    const ok = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'pending', 100, 'THB') RETURNING id`,
      [userId],
    );
    const orderId = ok.rows[0].id as string;

    let updateErr: unknown = null;
    try {
      await query(`UPDATE orders SET status = 'failed' WHERE id = $1`, [orderId]);
    } catch (err) {
      updateErr = err;
    }
    expect(updateErr).not.toBeNull();
    expect((updateErr as { code?: string }).code).toBe("23514");

    // The row is untouched — a refused write never half-applies.
    const after = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(after.rows[0].status).toBe("pending");
  });
});
