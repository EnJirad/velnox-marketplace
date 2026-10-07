/**
 * ORDER STATE — the three axes and the legacy projection (P0-1).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `orders.status` used to carry THREE lifecycles in one column, so a move on one
 * axis could destroy a fact on another. The concrete data loss: a full refund
 * ran `UPDATE orders SET status = 'refunded'`, which overwrote a `shipped` or
 * `delivered` value — the record that the parcel left the warehouse was gone.
 *
 * `backend/lib/order-state.ts` is the ONE authority that replaced that, and this
 * file proves the four things the fix has to be true about:
 *
 *   1. THE PROJECTION IS TOTAL AND DETERMINISTIC. For every combination of the
 *      three vocabularies, one of the twelve `orders_status_check` values comes
 *      out — the same one every time.
 *   2. THE SQL MIRROR AND THE TYPESCRIPT FUNCTION CANNOT DRIFT. The writers
 *      project inside the statement (they have to: the value must be computed in
 *      the same UPDATE that moves the axis, under the order row's lock), so the
 *      two encodings are compared against a REAL database on EVERY combination.
 *      Without this, "one authority" would be a claim rather than a property.
 *   3. A PAYMENT FACT NEVER OVERWRITES A FULFILMENT FACT. Executed against real
 *      rows: after a refund on a shipped / delivered order the order still reads
 *      `shipped` / `delivered`, while the PAYMENT axis still reads `refunded`.
 *      The money fact is not lost — it moved to the axis that owns it.
 *   4. NEVER ROLL BACK A FULFILMENT FACT, AND NEVER LET THE TWO AXES CLOBBER
 *      EACH OTHER. A failed charge does not undo packing, and concurrent payment
 *      and fulfilment writes leave a row that still satisfies the projection.
 *
 * The statements executed here are the WRITERS' OWN: the SQL is built from
 * `projectOrderStatusSql()` — the exported fragment the routes interpolate — and
 * the source-level assertions below pin that the routes really use it and really
 * do not write the axes from a payment path. Nothing is mocked: every database
 * assertion runs against the configured TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { query, withTransaction } from "../db/index.js";
import { ORDER_PAYMENT_STATUS_SQL } from "../lib/payment-attempt.js";
import { FULFILLMENT_STATUSES } from "../lib/order-fulfillment.js";
import {
  FULFILLMENT_AXIS_STATUSES,
  LEGACY_ORDER_STATUSES,
  ORDER_STATES,
  PAYMENT_STATES,
  axesForFulfillmentStatus,
  fulfillmentStatusForAxes,
  projectOrderStatus,
  projectOrderStatusSql,
} from "../lib/order-state.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const testFn = hasTestDatabase() ? test : test.skip;
const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const STRIPE_ROUTE = "backend/routes/stripe.ts";
const SELLER_ROUTE = "backend/routes/seller-orders.ts";
const CENTER_ROUTE = "backend/routes/center.ts";

/** Every axis pair the two vocabularies allow (5 × 9). */
const AXIS_PAIRS = ORDER_STATES.flatMap((orderState) =>
  FULFILLMENT_AXIS_STATUSES.map((fulfillmentStatus) => ({ orderState, fulfillmentStatus })),
);

// ═══════════════════════════════════════════════════════════════════════════
// 1. The authority's own invariants — no database needed
// ═══════════════════════════════════════════════════════════════════════════

describe("order state — one vocabulary per axis, and no duplicate state machine", () => {
  test("the axis vocabularies are exactly the CHECK vocabularies the schema declares", () => {
    const schema = read("db/schema.sql");
    const orderCheck = schema.match(/CHECK \(order_state IS NULL OR order_state IN \(([^)]+)\)\)/);
    expect(orderCheck).not.toBeNull();
    expect([...orderCheck![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...ORDER_STATES]);

    const fulfillmentCheck = schema.match(
      /CHECK \(fulfillment_status IS NULL OR fulfillment_status IN \(([^)]+)\)\)/,
    );
    expect(fulfillmentCheck).not.toBeNull();
    expect([...fulfillmentCheck![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([
      ...FULFILLMENT_AXIS_STATUSES,
    ]);
  });

  test("the legacy column's twelve values are unchanged, and the projection only emits them", () => {
    const schema = read("db/schema.sql");
    const statusCheck = schema.match(/ADD CONSTRAINT orders_status_check\s*\n?\s*CHECK \(status IN \(([^)]+)\)\)/);
    expect(statusCheck).not.toBeNull();
    const declared = [...statusCheck![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // Set equality, not order: the module documents its own precedence order.
    expect([...declared].sort()).toEqual([...LEGACY_ORDER_STATUSES].sort());

    // Every combination projects into that set — the column can never hold a
    // value the CHECK (and therefore every deployed frontend) does not know.
    for (const paymentState of PAYMENT_STATES) {
      for (const { orderState, fulfillmentStatus } of AXIS_PAIRS) {
        expect(LEGACY_ORDER_STATUSES).toContain(
          projectOrderStatus({ paymentState, orderState, fulfillmentStatus }),
        );
      }
    }
  });

  test("the axis encoding inverts the fulfilment machine exactly — no second machine", () => {
    // `axesForFulfillmentStatus` and `fulfillmentStatusForAxes` are the storage
    // encoding of `FULFILLMENT_TRANSITIONS`, which stays the ONE authority. If
    // the round trip ever stopped being lossless, two vocabularies would mean
    // different things at once — the duplicate-state-machine hazard.
    for (const status of FULFILLMENT_STATUSES) {
      expect(fulfillmentStatusForAxes(axesForFulfillmentStatus(status))).toBe(status);
    }
  });

  test("the projection is a pure function — the same axes always give the same status", () => {
    for (const paymentState of PAYMENT_STATES) {
      for (const { orderState, fulfillmentStatus } of AXIS_PAIRS) {
        const once = projectOrderStatus({ paymentState, orderState, fulfillmentStatus });
        const twice = projectOrderStatus({ paymentState, orderState, fulfillmentStatus });
        expect(twice).toBe(once);
      }
    }
  });

  test("an unknown value on any axis falls towards the safe state", () => {
    // An unrecognised fulfilment value must never read as shipped/delivered, and
    // an unrecognised payment value must never read as paid or refunded.
    expect(projectOrderStatus({ paymentState: "who-knows", orderState: "pending", fulfillmentStatus: "who-knows" })).toBe("pending");
    expect(projectOrderStatus({ paymentState: null, orderState: null, fulfillmentStatus: null })).toBe("pending");
    expect(
      projectOrderStatus({ paymentState: "who-knows", orderState: "pending", fulfillmentStatus: "shipped" }),
    ).not.toBe("refunded");
  });
});

// ─── The writers really use the authority, and really do not clobber the axes ──

/**
 * `src` with COMMENTS blanked out (newlines preserved).
 *
 * The guards below assert things about the CODE — “no writer still writes a bare
 * literal”, “this statement does not name the axes” — and this file's own subject
 * is a migration, so the docs deliberately QUOTE the old statements they
 * replaced (`// This used to be \`UPDATE orders SET status = 'refunded'\``). Scan
 * the raw text and that documentation reads as a live writer. Blanking comment
 * content (rather than deleting it) keeps every line/offset in place, so a
 * match that spans lines still has the same distance to travel.
 *
 * Only ever used for NEGATIVE assertions, and it can only ever remove text, so an
 * imperfect strip cannot hide a real statement — it can only expose one sooner.
 */
function codeOnly(src: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    // A line comment, but not the `//` of a URL or a protocol-relative string.
    .replace(/(^|[^:"'`\w])\/\/[^\n]*/gm, (m, prefix: string) => prefix + blank(m.slice(prefix.length)));
}

/** Every index at which `needle` occurs in `src`. */
function occurrences(src: string, needle: string): number[] {
  const at: number[] = [];
  let i = src.indexOf(needle);
  while (i !== -1) {
    at.push(i);
    i = src.indexOf(needle, i + 1);
  }
  return at;
}

/**
 * The SQL template literal each occurrence of `needle` sits in — from the needle
 * to the closing backtick. This is the STATEMENT text, which is what a guard
 * assertion needs now that the SET value is computed rather than literal.
 */
function statementsAround(src: string, needle: string): string[] {
  return occurrences(src, needle).map((at) => {
    const end = src.indexOf("`", at);
    return src.slice(at, end === -1 ? src.length : end);
  });
}

describe("order state — the writers go through the authority", () => {
  const stripe = read(STRIPE_ROUTE);
  /** The route's code, with its documentation blanked — see `codeOnly`. */
  const stripeCode = codeOnly(stripe);

  test("no order-status writer in stripe.ts still writes a bare literal", () => {
    // Every `status` assignment in this file is either a bound parameter or the
    // projection fragment; a string literal is the pre-fix shape, whose value was
    // a fourth opinion about the order rather than a reading of its axes.
    expect(stripeCode).not.toMatch(/UPDATE orders[\s\S]{0,80}?SET status = '/);
  });

  test("every payment statement projects, and NONE of them writes an order/fulfilment axis", () => {
    const projected = ["pending", "paid", "failed", "refunded"].flatMap((state) =>
      statementsAround(stripeCode, `projectOrderStatusSql("'${state}'")`),
    );
    // Guard the scrape: a refactor of the SQL shape must fail loudly.
    expect(projected.length).toBeGreaterThanOrEqual(6);
    for (const statement of projected) {
      // THE FIX, stated as a property of the source: a money path may not name
      // the order or fulfilment axis. If one did, a refund could erase the
      // record that a parcel shipped — exactly the defect this work removed.
      expect(statement).not.toContain("order_state =");
      expect(statement).not.toContain("fulfillment_status =");
    }
  });

  test("the lapsed-session writer is the ONE payment path that ends the order", () => {
    const statements = statementsAround(stripeCode, 'projectOrderStatus({ paymentState: "cancelled"');
    expect(statements.length).toBe(1);
    // It moves the axes because the order really is over — and it uses the SAME
    // axis encoding the fulfilment machine uses for `cancelled`.
    const axes = axesForFulfillmentStatus("cancelled");
    expect(stripeCode).toContain("axesForFulfillmentStatus(\"cancelled\")");
    expect(
      projectOrderStatus({ paymentState: "cancelled", ...axes }),
    ).toBe("cancelled");
  });

  test("the two staff routes record the axes from the machine's own target status", () => {
    for (const file of [SELLER_ROUTE, CENTER_ROUTE]) {
      const src = read(file);
      expect(src).toContain("axesForFulfillmentStatus(");
      expect(src).toContain("projectOrderStatus({ paymentState");
      // The target is still validated by the ONE fulfilment machine first.
      expect(src).toContain("canTransition");
    }
  });

  test("the cancellation and expiry writers record both axes through the machine encoding", () => {
    for (const file of [
      "backend/routes/cart.ts",
      "backend/lib/checkout-group-lifecycle.ts",
      "backend/jobs/payment-reservation-scheduler.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("axesForFulfillmentStatus(");
      expect(src).toContain("projectOrderStatus(");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Real rows: the projection against the database
// ═══════════════════════════════════════════════════════════════════════════

describe("order state against a real database", () => {
  let userId: string;
  let sellerId: string;
  let shopId: string;
  let orderId: string;
  let paymentId: string;

  /** Put the order on a known axis pair, exactly as a writer would. */
  async function setAxes(
    axes: { orderState: string; fulfillmentStatus: string },
    status: string,
  ): Promise<void> {
    await query(
      `UPDATE orders SET order_state = $2, fulfillment_status = $3, status = $4, updated_at = NOW()
        WHERE id = $1`,
      [orderId, axes.orderState, axes.fulfillmentStatus, status],
    );
  }

  /** The row's three axes, read back. */
  async function axesOf(): Promise<{
    status: string;
    order_state: string;
    fulfillment_status: string;
    payment_status: string;
  }> {
    const res = await query(
      `SELECT o.status, o.order_state, o.fulfillment_status,
              ${ORDER_PAYMENT_STATUS_SQL} AS payment_status
         FROM orders o WHERE o.id = $1`,
      [orderId],
    );
    return res.rows[0];
  }

  /**
   * The statement the payment writers run, built from the writers' OWN fragment.
   *
   * `guarded` toggles the `status IN ('pending','pending_payment')` clause the
   * four payment paths carry. Running it WITHOUT the guard is the stronger test:
   * it asks what the projection would do even if a payment statement reached an
   * order that had already shipped.
   */
  async function runPaymentStatement(
    paymentState: string,
    options: { guarded?: boolean } = {},
  ): Promise<number> {
    const guard = options.guarded === false ? "" : " AND status IN ('pending', 'pending_payment')";
    const res = await query(
      `UPDATE orders
          SET status = ${projectOrderStatusSql(`'${paymentState}'`)}, updated_at = NOW()
        WHERE id = $1${guard}`,
      [orderId],
    );
    return res.rowCount ?? 0;
  }

  beforeAll(async () => {
    if (!hasTestDatabase()) return;

    const stamp = Date.now();
    const u = await query(
      `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
      [`order-state-${stamp}@velnox.test`, "Order State Fixture"],
    );
    userId = u.rows[0].id;

    const s = await query(
      `INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'approved', 'verified') RETURNING id`,
      [userId],
    );
    sellerId = s.rows[0].id;

    const sh = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, "Order State Shop", `order-state-shop-${stamp}`],
    );
    shopId = sh.rows[0].id;

    // The order is created the way the checkout creates it (Group A): all three
    // axes recorded, the legacy column projected from them.
    const created = projectOrderStatus({ paymentState: "unpaid", ...axesForFulfillmentStatus("pending") });
    const o = await query(
      `INSERT INTO orders (user_id, shop_id, status, order_state, fulfillment_status, subtotal, shipping_fee, discount, total_amount)
       VALUES ($1, $2, $3, $4, $5, 100, 0, 0, 100) RETURNING id`,
      [
        userId,
        shopId,
        created,
        axesForFulfillmentStatus("pending").orderState,
        axesForFulfillmentStatus("pending").fulfillmentStatus,
      ],
    );
    orderId = o.rows[0].id;

    const pay = await query(
      `INSERT INTO payments (order_id, amount, currency, method, status, provider)
       VALUES ($1, 100, 'THB', 'card', 'pending', 'stripe') RETURNING id`,
      [orderId],
    );
    paymentId = pay.rows[0].id;
  });

  afterAll(async () => {
    if (!hasTestDatabase()) return;
    await purgeUsers([userId]);
  });

  // ─── Test 6: the SQL mirror and the TypeScript projection agree, everywhere ──

  testFn("the SQL projection and the TypeScript projection agree on EVERY combination", async () => {
    let checked = 0;
    for (const paymentState of PAYMENT_STATES) {
      // One derived table per payment state, carrying the 45 axis pairs with the
      // EXACT column names the fragment reads (`order_state`,
      // `fulfillment_status`), so the statement is the mirror in its real shape.
      const params: string[] = [paymentState];
      const values = AXIS_PAIRS.map(({ orderState, fulfillmentStatus }) => {
        params.push(orderState, fulfillmentStatus);
        return `($${params.length - 1}::text, $${params.length}::text)`;
      }).join(", ");

      const res = await query(
        `SELECT order_state, fulfillment_status, ${projectOrderStatusSql("$1")} AS projected
           FROM (VALUES ${values}) AS v(order_state, fulfillment_status)`,
        params,
      );
      expect(res.rows.length).toBe(AXIS_PAIRS.length);

      for (const row of res.rows as Array<{
        order_state: string;
        fulfillment_status: string;
        projected: string;
      }>) {
        const ts = projectOrderStatus({
          paymentState,
          orderState: row.order_state,
          fulfillmentStatus: row.fulfillment_status,
        });
        expect(ts, `SQL and TS disagree for ${paymentState}/${row.order_state}/${row.fulfillment_status}`).toBe(
          row.projected,
        );
        expect(LEGACY_ORDER_STATUSES).toContain(ts as (typeof LEGACY_ORDER_STATUSES)[number]);
        checked += 1;
      }
    }
    expect(checked).toBe(PAYMENT_STATES.length * ORDER_STATES.length * FULFILLMENT_AXIS_STATUSES.length);
  });

  testFn("the database accepts the projected value for every combination", async () => {
    // The projection is only useful if `orders_status_check` accepts its output,
    // so every distinct projected value is written to a REAL row. A value the
    // CHECK refuses would raise 23514 here rather than in production.
    const produced = new Set<string>();
    for (const paymentState of PAYMENT_STATES) {
      for (const { orderState, fulfillmentStatus } of AXIS_PAIRS) {
        produced.add(projectOrderStatus({ paymentState, orderState, fulfillmentStatus }));
      }
    }
    expect(produced.size).toBeGreaterThanOrEqual(11);
    for (const status of produced) {
      const res = await query(`UPDATE orders SET status = $2 WHERE id = $1 RETURNING status`, [
        orderId,
        status,
      ]);
      expect(res.rows[0].status).toBe(status);
    }
    const pending = projectOrderStatus({ paymentState: "unpaid", ...axesForFulfillmentStatus("pending") });
    await query(`UPDATE orders SET status = $2 WHERE id = $1`, [orderId, pending]);
  });

  // ─── Test 1: payment success never overwrites fulfilment ────────────────────

  testFn("Test 1 — `paid` + `shipped` stays shipped; the payment fact never wins", async () => {
    const shipped = axesForFulfillmentStatus("shipped");
    await setAxes(shipped, "shipped");

    // (a) The real statement, with its real guard: it does not even match a
    //     shipped order, so it changes nothing.
    expect(await runPaymentStatement("paid", { guarded: true })).toBe(0);
    expect((await axesOf()).status).toBe("shipped");

    // (b) The WIDENED statement (no status guard) is the interesting half: even
    //     if a payment writer reached this row, the projection must still answer
    //     `shipped`. This is the assertion that makes the axis split real.
    await runPaymentStatement("paid", { guarded: false });
    const after = await axesOf();
    expect(after.status).toBe("shipped");
    expect(after.order_state).toBe(shipped.orderState);
    expect(after.fulfillment_status).toBe(shipped.fulfillmentStatus);
  });

  testFn("a paid, unshipped order still publishes `paid` — nothing regressed", async () => {
    const axes = axesForFulfillmentStatus("pending");
    await setAxes(axes, "pending");
    await query(`UPDATE payments SET status = 'paid', refund_status = NULL WHERE id = $1`, [paymentId]);
    // Guarded: this is exactly the settlement path's reachable state.
    expect(await runPaymentStatement("paid", { guarded: true })).toBe(1);
    const after = await axesOf();
    expect(after.status).toBe("paid");
    // …and the axes are untouched by the money event.
    expect(after.order_state).toBe("pending");
    expect(after.fulfillment_status).toBe("unfulfilled");
  });

  // ─── Tests 2 + 3: a refund can never destroy a shipping fact ────────────────

  testFn("Test 2 — refund after SHIPPED keeps the shipping fact AND records the refund", async () => {
    const shipped = axesForFulfillmentStatus("shipped");
    await setAxes(shipped, "shipped");
    await query(`UPDATE payments SET status = 'paid', refund_status = 'refunded' WHERE id = $1`, [paymentId]);

    // The refund statement, verbatim in shape from the writer: it projects the
    // payment axis and touches nothing else.
    const applied = await query(
      `UPDATE orders
          SET status = ${projectOrderStatusSql("'refunded'")}, updated_at = NOW()
        WHERE id = $1 AND status <> 'refunded'`,
      [orderId],
    );
    expect(applied.rowCount).toBe(1);

    const after = await axesOf();
    // The shipping fact SURVIVES — this is the regression the migration fixed.
    expect(after.status).toBe("shipped");
    expect(after.fulfillment_status).toBe("shipped");
    expect(after.order_state).toBe("processing");
    // And the refund is NOT lost: it moved to the axis that owns money, which is
    // what the order pages render as `paymentStatus`.
    expect(after.payment_status).toBe("refunded");

    // Idempotent: a replayed refund event changes nothing.
    const again = await query(
      `UPDATE orders
          SET status = ${projectOrderStatusSql("'refunded'")}, updated_at = NOW()
        WHERE id = $1 AND status <> 'refunded'`,
      [orderId],
    );
    expect(again.rowCount).toBe(1);
    expect((await axesOf()).status).toBe("shipped");
  });

  testFn("Test 3 — refund after DELIVERED keeps the delivery fact (and `completed` too)", async () => {
    for (const [machineStatus, expected] of [
      ["delivered", "delivered"],
      ["completed", "completed"],
    ] as const) {
      const axes = axesForFulfillmentStatus(machineStatus);
      await setAxes(axes, expected);

      await query(
        `UPDATE orders
            SET status = ${projectOrderStatusSql("'refunded'")}, updated_at = NOW()
          WHERE id = $1 AND status <> 'refunded'`,
        [orderId],
      );

      const after = await axesOf();
      expect(after.status).toBe(expected);
      expect(after.fulfillment_status).toBe(axes.fulfillmentStatus);
      expect(after.order_state).toBe(axes.orderState);
      expect(after.payment_status).toBe("refunded");
    }
  });

  testFn("a refund on an UNSHIPPED order still publishes `refunded` — the old behaviour", async () => {
    const axes = axesForFulfillmentStatus("pending");
    await setAxes(axes, "pending");
    await query(`UPDATE orders SET status = 'pending_payment' WHERE id = $1`, [orderId]);

    await query(
      `UPDATE orders
          SET status = ${projectOrderStatusSql("'refunded'")}, updated_at = NOW()
        WHERE id = $1 AND status <> 'refunded'`,
      [orderId],
    );
    // Nothing had shipped, so the legacy column keeps the value the old code
    // wrote — no frontend-visible change where the old code was correct.
    expect((await axesOf()).status).toBe("refunded");
  });

  // ─── Test 4: a failed payment never rolls fulfilment back ──────────────────

  testFn("Test 4 — a payment FAILURE never rolls a fulfilment fact backwards", async () => {
    for (const machineStatus of ["packing", "shipped", "delivered"] as const) {
      const axes = axesForFulfillmentStatus(machineStatus);
      const before = projectOrderStatus({ paymentState: "paid", ...axes });
      await setAxes(axes, before);

      // The failure statement, guarded and widened.
      expect(await runPaymentStatement("failed", { guarded: true })).toBe(0);
      await runPaymentStatement("failed", { guarded: false });

      const after = await axesOf();
      expect(after.status).toBe(before);
      expect(after.order_state).toBe(axes.orderState);
      expect(after.fulfillment_status).toBe(axes.fulfillmentStatus);
    }
    // …and on an order that has NOT shipped, the failure IS published.
    const pendingAxes = axesForFulfillmentStatus("pending");
    await setAxes(pendingAxes, "pending_payment");
    expect(await runPaymentStatement("failed", { guarded: true })).toBe(1);
    expect((await axesOf()).status).toBe("payment_failed");
  });

  // ─── Test 5: concurrent payment and fulfilment writes ──────────────────────

  testFn("Test 5 — concurrent payment and fulfilment writes cannot clobber each other", async () => {
    // Both writers take the ORDER row lock first (lib/order-lock.ts), so the two
    // statements serialise. The invariant under test is that the row they leave
    // behind is coherent on BOTH orders of arrival: the fulfilment axes are the
    // ones the fulfilment move wrote, and the legacy column is exactly the
    // projection of the axes that are actually stored.
    const paymentStatement = `UPDATE orders
        SET status = ${projectOrderStatusSql("'paid'")}, updated_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'pending_payment') AND inventory_released = FALSE`;

    for (const paymentFirst of [true, false]) {
      const start = axesForFulfillmentStatus("pending");
      await setAxes(start, "pending");

      const packing = axesForFulfillmentStatus("packing");
      const fulfilmentStatement = `UPDATE orders
          SET status = $2, order_state = $3, fulfillment_status = $4, updated_at = NOW()
        WHERE id = $1`;

      const paymentTx = withTransaction(async (client) => {
        await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
        if (!paymentFirst) await new Promise((r) => setTimeout(r, 40));
        const res = await client.query(paymentStatement, [orderId]);
        return res.rowCount ?? 0;
      });
      const fulfilmentTx = withTransaction(async (client) => {
        if (paymentFirst) await new Promise((r) => setTimeout(r, 10));
        await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
        if (paymentFirst) await new Promise((r) => setTimeout(r, 40));
        const res = await client.query(fulfilmentStatement, [
          orderId,
          projectOrderStatus({ paymentState: "paid", ...packing }),
          packing.orderState,
          packing.fulfillmentStatus,
        ]);
        return res.rowCount ?? 0;
      });

      const [paidMoved, fulfilmentMoved] = await Promise.all([paymentTx, fulfilmentTx]);
      expect(fulfilmentMoved).toBe(1);

      const after = await axesOf();
      // The fulfilment fact is intact — no interleaving erases it.
      expect(after.order_state).toBe(packing.orderState);
      expect(after.fulfillment_status).toBe(packing.fulfillmentStatus);
      expect(after.status).toBe("packing");
      // …and if the settlement won the race, it still moved the order exactly
      // once, and the final column is the projection of the stored axes.
      expect(paidMoved).toBeLessThanOrEqual(1);
      expect(
        projectOrderStatus({
          paymentState: after.payment_status,
          orderState: after.order_state,
          fulfillmentStatus: after.fulfillment_status,
        }),
      ).toBe(after.status);
    }
  });

  testFn("a shipped row refuses a later settlement instead of rewriting it", async () => {
    // The anti-resurrection property, executed: an order that already shipped
    // cannot be settled into `paid`, so a stale payment event can never take the
    // order back out of fulfilment.
    const shipped = axesForFulfillmentStatus("shipped");
    await setAxes(shipped, "shipped");
    expect(await runPaymentStatement("paid", { guarded: true })).toBe(0);
    expect((await axesOf()).status).toBe("shipped");
  });
});
