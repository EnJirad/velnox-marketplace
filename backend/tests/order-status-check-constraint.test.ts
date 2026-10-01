/**
 * `orders.status` CHECK constraint — audit MEDIUM #9.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `orders.status` was declared `TEXT NOT NULL DEFAULT 'pending'` with no CHECK,
 * while every other status column in this schema has one (`sellers.status`,
 * `verification_status`, `velrepeat_plans.status`, `velrepeat_runs.status`).
 * Free text means a typo, a retired code path or a hand-edited row can store a
 * value that no state machine, no query and no UI knows about — and
 * `normalizeOrderStatusToFulfillment()` answers "pending" for anything it does
 * not recognise, so the row looks un-actioned rather than broken.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   1. the allowed set is DERIVED from the writers, not chosen here: the
 *      fulfilment chain (`backend/lib/order-fulfillment.ts`) plus the payment
 *      lifecycle `routes/stripe.ts` and the reservation sweep write, and the
 *      test re-derives it from those files;
 *   2. the payment-domain values are NOT dumped in wholesale — each payment
 *      value in the set must have a real `orders.status` writer, and the
 *      payments-only statuses must stay out;
 *   3. both canonical SQL files carry the constraint and remain byte-identical;
 *   4. the constraint is a plain CHECK — no trigger, no enum, no state table;
 *   5. against a REAL database: every allowed value inserts and updates, an
 *      invalid value is refused by PostgreSQL itself (23514 on
 *      `orders_status_check`), and — the point of the last pair — a LEGAL
 *      status reached by an ILLEGAL transition is still accepted, because the
 *      transition table is not this constraint's job.
 *
 * The state machine is untouched: `canTransitionFulfillment()`, `lockOrderRow()`,
 * the payment / shipment / cancellation gates and every `WHERE status = ANY(...)`
 * claim remain exactly as they were. A CHECK decides whether a value EXISTS in
 * the domain, never whether a move between two existing values is allowed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

import { FULFILLMENT_STATUSES } from "../lib/order-fulfillment.js";
import { PAYMENT_RESERVATION_EXPIRED_STATUS } from "../lib/payment-reservation.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SCHEMA = "db/schema.sql";
const BOOTSTRAP = "db/run-sqleditor.sql";
const MIGRATION = "db/migrations/050_orders_status_check.sql";

const INVALID_STATUS = "__INVALID_ORDER_STATUS__";

/**
 * The payment half of `orders.status`, each with the writer that produces it.
 * If a writer is removed the derivation below must change too — that is the
 * point: this list cannot drift from the code without failing a test here.
 */
const PAYMENT_ORDER_STATUSES: Record<string, string> = {
  pending_payment: "backend/routes/stripe.ts",
  paid: "backend/routes/stripe.ts",
  payment_failed: "backend/routes/stripe.ts",
  refunded: "backend/routes/stripe.ts",
  [PAYMENT_RESERVATION_EXPIRED_STATUS]: "backend/jobs/payment-reservation-scheduler.ts",
};

/** The allowed set, built from the two authorities. */
const ALLOWED_ORDER_STATUSES = [...FULFILLMENT_STATUSES, ...Object.keys(PAYMENT_ORDER_STATUSES)];

/** Statuses that live in `payments.status` and must NOT leak into orders. */
const PAYMENTS_ONLY_STATUSES = ["processing", "requires_action", "partially_refunded", "succeeded"];

// ═══════════════════════════════════════════════════════════════════════════
// 1. The allowed set — derived from the real writers
// ═══════════════════════════════════════════════════════════════════════════

describe("order status CHECK — the allowed set comes from the writers, not from this test", () => {
  test("every fulfilment status is in the set (order-fulfillment.ts is the authority)", () => {
    for (const status of FULFILLMENT_STATUSES) {
      expect(ALLOWED_ORDER_STATUSES).toContain(status);
    }
    // The fulfilment chain is exactly the seven states the module declares.
    expect(FULFILLMENT_STATUSES).toEqual([
      "pending",
      "confirmed",
      "packing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ]);
  });

  test("every status stripe.ts writes as a SQL literal is in the set", () => {
    const src = read("backend/routes/stripe.ts");
    const written = [...src.matchAll(/UPDATE orders SET status = '([a-z_]+)'/g)].map((m) => m[1]);
    // Guard the scrape: a refactor of the SQL shape must fail loudly.
    expect(written.length).toBeGreaterThanOrEqual(4);
    for (const status of new Set(written)) {
      expect(ALLOWED_ORDER_STATUSES).toContain(status);
    }
    // The four payment-lifecycle transitions plus the abandoned-session cancel.
    expect(new Set(written)).toEqual(
      new Set(["pending_payment", "paid", "payment_failed", "refunded", "cancelled"]),
    );
  });

  test("the two order-creating INSERTs write statuses the set allows", () => {
    for (const file of ["backend/routes/cart.ts", "backend/jobs/velrepeat-scheduler.ts"]) {
      const src = read(file);
      const inserted = [...src.matchAll(/INSERT INTO orders[\s\S]{0,400}?VALUES\s*\([^)]{0,400}?'([a-z_]+)'/g)];
      expect(inserted.length).toBeGreaterThan(0);
      for (const match of inserted) {
        expect(ALLOWED_ORDER_STATUSES).toContain(match[1]);
      }
    }
  });

  test("the expiry sweep's target status is a real orders.status value", () => {
    // `expired` is written to the ORDER row by the sweep, so it belongs here
    // even though it reads like a payment state.
    expect(PAYMENT_RESERVATION_EXPIRED_STATUS).toBe("expired");
    expect(ALLOWED_ORDER_STATUSES).toContain("expired");
    const scheduler = read("backend/jobs/payment-reservation-scheduler.ts");
    expect(scheduler).toContain("PAYMENT_RESERVATION_EXPIRED_STATUS");
  });

  test("every payment-domain status in the set has a real writer in the code", () => {
    for (const [status, file] of Object.entries(PAYMENT_ORDER_STATUSES)) {
      expect(ALLOWED_ORDER_STATUSES).toContain(status);
      // The claimed writer must actually mention the literal it claims to write.
      if (file.endsWith("stripe.ts")) {
        expect(read(file)).toContain(`status = '${status}'`);
      } else {
        expect(read(file)).toContain("PAYMENT_RESERVATION_EXPIRED_STATUS");
      }
    }
  });

  test("payments-only statuses are NOT folded into orders.status", () => {
    // `processing`, `requires_action` and `partially_refunded` belong to
    // `payments.status`. Pulling them in "because they appear in the payment
    // flow" would be exactly the architecture change this task must not make.
    for (const status of PAYMENTS_ONLY_STATUSES) {
      expect(ALLOWED_ORDER_STATUSES).not.toContain(status);
    }
    // `failed` was the dead entry in `RELEASABLE_STATUSES` (audit LOW #12,
    // removed 2026-09-30): it is a `payments.status` value, not an
    // `orders.status` one, so no writer produces it on an order and the schema
    // must not bless it either. This assertion is what pins that decision.
    expect(ALLOWED_ORDER_STATUSES).not.toContain("failed");
  });

  test("the set has no duplicates and no stray whitespace", () => {
    expect(new Set(ALLOWED_ORDER_STATUSES).size).toBe(ALLOWED_ORDER_STATUSES.length);
    for (const status of ALLOWED_ORDER_STATUSES) {
      expect(status).toBe(status.trim());
      expect(status).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The constraint is declared everywhere it must be
// ═══════════════════════════════════════════════════════════════════════════

describe("order status CHECK — declared in both canonical files and in its migration", () => {
  /** The allowed values as the constraint text declares them. */
  function declaredValues(sql: string): string[] {
    const match = sql.match(
      /ADD CONSTRAINT orders_status_check\s+CHECK \(status IN \(([^)]*)\)\)/,
    );
    expect(match).not.toBeNull();
    return [...match![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }

  test("db/schema.sql and db/run-sqleditor.sql stay byte-identical", () => {
    expect(read(SCHEMA)).toBe(read(BOOTSTRAP));
  });

  test("the schema declares exactly the derived allowed set", () => {
    expect(declaredValues(read(SCHEMA)).sort()).toEqual([...ALLOWED_ORDER_STATUSES].sort());
  });

  test("the bootstrap file declares exactly the same allowed set", () => {
    expect(declaredValues(read(BOOTSTRAP)).sort()).toEqual([...ALLOWED_ORDER_STATUSES].sort());
  });

  test("a fresh CREATE TABLE also carries the constraint inline", () => {
    // The ALTER block alone would leave a brand-new database relying on the
    // self-heal pass; the inline form is what the other status columns do.
    const schema = read(SCHEMA);
    const createOrders = schema.slice(
      schema.indexOf("CREATE TABLE IF NOT EXISTS orders ("),
      schema.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique"),
    );
    expect(createOrders).toContain("CHECK (status IN (");
    for (const status of ALLOWED_ORDER_STATUSES) {
      expect(createOrders).toContain(`'${status}'`);
    }
  });

  test("the migration exists, is idempotent and states its data-safety rule", () => {
    const migration = read(MIGRATION);
    expect(declaredValues(migration).sort()).toEqual([...ALLOWED_ORDER_STATUSES].sort());
    // Re-runnable: DROP IF EXISTS before ADD.
    expect(migration).toContain("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;");
    // It must not silently rewrite an order's business state.
    expect(migration).toContain("FAILS LOUDLY");
    expect(migration).not.toMatch(/UPDATE orders/i);
  });

  test("only V0050 ADDS the constraint — no older migration was edited to carry it", () => {
    // V0016 legitimately mentions the name because it DROPPED the old one
    // (see the history test below). This pins that no other migration ADDs it,
    // which is what broke V0035 (two files numbered 035, one silently skipped).
    const files = readdirSync(join(root, "db/migrations")).filter((f) => f.endsWith(".sql"));
    const adding = files.filter((f) =>
      /ADD\s+CONSTRAINT\s+orders_status_check/i.test(read(`db/migrations/${f}`)),
    );
    expect(adding).toEqual(["050_orders_status_check.sql"]);
  });

  test("V0050 took the next free number, and later migrations did not reuse it", () => {
    // The number was read from the repository, not assumed: 049 was the highest
    // before this task, so the constraint took the next free number. V0051
    // (VelRepeat V2 plan payment parent) was added by a later task and takes
    // the number after it — what must never happen is a REUSED number.
    const files = readdirSync(join(root, "db/migrations")).filter((f) => /^\d{3}_/.test(f));
    const numbers = files.map((f) => Number(f.slice(0, 3)));
    expect(Math.max(...numbers)).toBeGreaterThanOrEqual(50);
    // 050 must be used exactly once — a second 050 would be skipped by a
    // prefix-keyed runner, which is the V0035 failure mode.
    expect(numbers.filter((n) => n === 50).length).toBe(1);

    // Historical collisions still exist and are NOT this task's business:
    // 029/030/034/035 each name two files (documented VelRepeat breakage).
    // Assert no NEW collision was introduced from V0040 on.
    const maintained = numbers.filter((n) => n >= 40);
    expect(new Set(maintained).size).toBe(maintained.length);
    const duplicated = [...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i))].sort();
    expect(duplicated).toEqual([29, 30, 34, 35]);
  });

  test("history: V0003 shipped a narrower CHECK and V0016 dropped it", () => {
    // The constraint is being RE-ADDED, not invented. V0003 declared
    //   ('pending','confirmed','processing','shipped','delivered','cancelled')
    // which never included `packing`, `completed` or any payment-lifecycle
    // value, so the real writers started failing and V0016 dropped it. The new
    // list must therefore be the DERIVED one — and must not resurrect V0003's.
    const v0003 = read("db/migrations/003_customer.sql");
    expect(v0003).toMatch(/orders[\s\S]{0,400}?CHECK \(status IN \('pending', 'confirmed', 'processing'/);
    const v0016 = read("db/migrations/016_sync_schema_discrepancies.sql");
    expect(v0016).toContain("ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;");
    // `processing` is a payments/velrepeat value, not an orders.status one.
    expect(ALLOWED_ORDER_STATUSES).not.toContain("processing");
  });

  test("it is a plain CHECK — no trigger, no enum, no state table", () => {
    // Only the executable SQL is inspected: the migration's own header explains
    // the history in prose, and prose is not DDL.
    const statements = read(MIGRATION)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--") && line.trim().length > 0)
      .join("\n");
    expect(statements).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(statements).not.toMatch(/CREATE\s+TYPE/i);
    expect(statements).not.toMatch(/CREATE\s+TABLE/i);
    expect(statements).not.toMatch(/\bgo\b|\bnode\b|\bbun\b/i);
    // Exactly two statements: drop-if-exists, then add.
    expect(statements.split(";").filter((s) => s.trim().length > 0).length).toBe(2);
  });

  test("the state machine authority is untouched by the constraint", () => {
    const fulfillment = read("backend/lib/order-fulfillment.ts");
    // The transition table, the terminal set and the gates must all still be
    // the authority — a CHECK does not replace any of them.
    expect(fulfillment).toContain("export function canTransitionFulfillment");
    expect(fulfillment).toContain("TERMINAL_FULFILLMENT_STATUSES");
    expect(fulfillment).toContain("assertNoSettledPaymentForCancellation");
    expect(fulfillment).toContain("ensureShipmentForShipping");
    // The row lock every writer takes is not weakened.
    expect(read("backend/lib/order-lock.ts")).toContain("lockOrderRow");
    // And no writer gained a status write it did not have.
    expect(read("backend/routes/stripe.ts")).toContain(
      "UPDATE orders SET status = 'payment_failed'",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Database-gated: the real PostgreSQL answers
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("orders.status CHECK against a real database (requires TEST_DATABASE_URL)", () => {
  let seededUserIds: Array<string | null> = [];

  afterEach(async () => {
    await purgeUsers(seededUserIds);
    seededUserIds = [];
  });

  async function seedUser(): Promise<string> {
    const { query } = await import("../db/index.js");
    const tag = `status-${crypto.randomUUID()}`;
    const user = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}@test.local`,
      "Status Fixture",
    ]);
    const userId = user.rows[0].id as string;
    seededUserIds.push(userId);
    return userId;
  }

  async function insertOrder(userId: string, status: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
      [userId, status],
    );
    return res.rows[0].id as string;
  }

  // ── 5. the constraint really exists in PostgreSQL ──

  testFn("PostgreSQL holds the constraint, with the derived allowed set", async () => {
    const { query } = await import("../db/index.js");
    const res = await query(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
          AND contype = 'c'
          AND conname = 'orders_status_check'`,
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].def).toContain("status = ANY");
    const declared = [...res.rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(declared).toEqual([...ALLOWED_ORDER_STATUSES].sort());
  });

  // ── 1. every allowed value INSERTs ──

  testFn("every allowed status can be INSERTed", async () => {
    const userId = await seedUser();
    for (const status of ALLOWED_ORDER_STATUSES) {
      const orderId = await insertOrder(userId, status);
      const { query } = await import("../db/index.js");
      const res = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
      expect(res.rows[0].status).toBe(status);
    }
  });

  // ── 2. every allowed value UPDATEs ──

  testFn("every allowed status can be UPDATEd onto an existing order", async () => {
    const userId = await seedUser();
    const orderId = await insertOrder(userId, "pending");
    for (const status of ALLOWED_ORDER_STATUSES) {
      const { query } = await import("../db/index.js");
      const res = await query(
        `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING status`,
        [status, orderId],
      );
      expect(res.rowCount).toBe(1);
      expect(res.rows[0].status).toBe(status);
    }
  });

  // ── 3. an invalid value is refused on INSERT ──

  testFn("an invalid status is REJECTED on INSERT, by the constraint itself", async () => {
    const userId = await seedUser();
    let caught: any = null;
    try {
      await insertOrder(userId, INVALID_STATUS);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    // The real PostgreSQL error, not a string match on the schema file.
    expect(caught.code).toBe("23514");
    expect(caught.constraint).toBe("orders_status_check");
    expect(caught.severity).toBe("ERROR");
    // And nothing was written.
    const { query } = await import("../db/index.js");
    const res = await query(`SELECT count(*)::int AS n FROM orders WHERE user_id = $1`, [userId]);
    expect(res.rows[0].n).toBe(0);
  });

  // ── 4. an invalid value is refused on UPDATE ──

  testFn("an invalid status is REJECTED on UPDATE, leaving the row untouched", async () => {
    const userId = await seedUser();
    const orderId = await insertOrder(userId, "pending");
    let caught: any = null;
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE orders SET status = $1 WHERE id = $2`, [INVALID_STATUS, orderId]);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("23514");
    expect(caught.constraint).toBe("orders_status_check");

    const { query } = await import("../db/index.js");
    const res = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(res.rows[0].status).toBe("pending");
  });

  testFn("near-miss values are refused too — the set is exact, not a prefix match", async () => {
    const userId = await seedUser();
    for (const status of ["PAID", "Pending", " pending", "pending ", "", "ship", "deliverd", "payed"]) {
      let caught: any = null;
      try {
        await insertOrder(userId, status);
      } catch (err) {
        caught = err;
      }
      expect(caught).not.toBeNull();
      expect(caught.code).toBe("23514");
    }
  });

  // ── the CHECK is not the state machine ──

  testFn("a LEGAL status reached by an ILLEGAL transition is still accepted by the database", async () => {
    // `completed` is a valid value and `pending` is too, but the state machine
    // has no edge back from `completed`. If this UPDATE were refused, the
    // constraint would have quietly become a transition table — which is the
    // over-reach this task must avoid. The application's own guard
    // (`canTransitionFulfillment`) is what refuses the move; the column only
    // decides whether the value exists.
    const userId = await seedUser();
    const orderId = await insertOrder(userId, "completed");
    const { query } = await import("../db/index.js");
    const res = await query(`UPDATE orders SET status = 'pending' WHERE id = $1 RETURNING status`, [
      orderId,
    ]);
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].status).toBe("pending");
  });

  testFn("the constraint coexists with the writers the existing flows depend on", async () => {
    // Cancellation, expiry, payment settlement and fulfilment all move orders
    // through these exact values; every one of them must remain writable, or
    // the constraint would have broken a shipped flow.
    const userId = await seedUser();
    const { query } = await import("../db/index.js");
    const orderId = await insertOrder(userId, "pending");

    // The customer/seller cancellation shape (guarded UPDATE, as written in
    // routes/cart.ts and the seller/center transition routes).
    const cancelled = await query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND status IN ('pending_payment', 'pending') RETURNING status`,
      [orderId],
    );
    expect(cancelled.rows[0].status).toBe("cancelled");

    // The expiry sweep's guarded claim.
    const expired = await query(
      `UPDATE orders SET status = $1, updated_at = NOW()
        WHERE id = $2 AND status = ANY($3::text[]) AND inventory_released = FALSE RETURNING status`,
      [PAYMENT_RESERVATION_EXPIRED_STATUS, orderId, ["pending", "pending_payment"]],
    );
    expect(expired.rowCount).toBe(0); // already cancelled — the guard still governs
  });

  testFn("the default and NOT NULL still hold", async () => {
    const userId = await seedUser();
    const { query } = await import("../db/index.js");
    // RETURNING must include `id`: a `WHERE id = NULL` UPDATE matches no row and
    // raises nothing, which would make the NOT NULL assertion below vacuous.
    const res = await query(
      `INSERT INTO orders (user_id, total_amount, currency) VALUES ($1, 100, 'THB') RETURNING id, status`,
      [userId],
    );
    const orderId = res.rows[0].id as string;
    expect(res.rows[0].status).toBe("pending");

    let caught: any = null;
    try {
      const updated = await query(`UPDATE orders SET status = NULL WHERE id = $1`, [orderId]);
      // The statement must have reached the row, or the refusal below proves nothing.
      expect(updated.rowCount).toBe(1);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("23502");

    // The row kept its value.
    const after = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(after.rows[0].status).toBe("pending");
  });
});
