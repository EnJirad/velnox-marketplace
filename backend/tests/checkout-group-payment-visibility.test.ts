/**
 * A MULTI-SHOP PURCHASE'S MONEY MUST BE VISIBLE FROM EVERY ORDER IN IT.
 *
 * THE REPORTED SYMPTOM
 * --------------------
 * A customer paid for a two-shop cart and the storefront showed it as unpaid:
 * `orders.status = 'paid'` ("ชำระเงินแล้ว") rendered BESIDE a `paymentStatus` of
 * "ยังไม่ชำระ". No frontend defect was involved, and settlement was not at fault.
 *
 * THE ROOT CAUSE
 * --------------
 * `POST /api/customer/checkout` splits a cart into ONE ORDER PER SHOP and the
 * customer is charged ONCE for the whole purchase: a single Stripe Checkout
 * Session whose `payments` row carries
 *
 *     order_id IS NULL, checkout_group_id = <group>
 *
 * (`routes/stripe.ts` → `openCheckoutGroupSession`). `settleCheckoutGroup()`
 * correctly moves EVERY member order to `paid`. But every per-order READ resolved
 * the ledger by `payments.order_id = <order>` ALONE — a predicate that matches
 * NOTHING for a grouped purchase. The subquery returned NULL, `COALESCE(…,
 * 'unpaid')` turned it into the string `'unpaid'`, and the UI showed a paid
 * purchase as unpaid.
 *
 * The same blindness broke the DECISIONS, which is what makes this a money bug
 * rather than a display bug:
 *   • the confirm gate found no payment → 409 on a paid order, so a seller could
 *     never ship it;
 *   • the stock-release guard found no settled payment → it would hand the stock
 *     of a SOLD order back to the shelf;
 *   • the cancellation gate found no settled payment → a paid purchase could be
 *     cancelled;
 *   • the expiry sweep found no live session and no blocking payment → it could
 *     expire a purchase the customer was still paying, leaving the Stripe session
 *     OPEN, so the charge could still land and settle against `expired` orders:
 *     money taken, nothing sold, no incident;
 *   • a refund of a grouped charge raised 23502 (`refunds.order_id` was NOT NULL)
 *     → webhook 500 → Stripe redelivered forever.
 *
 * WHAT THIS FILE PINS
 * -------------------
 * Every assertion is made against ROWS READ BACK FROM THE DATABASE through the
 * SAME queries the routes execute — never against a frontend value, a log line,
 * or a re-implementation of the rule. Where a query is a production constant
 * (`ORDER_PAYMENT_STATUS_SQL`, `ORDER_PAYMENT_METHOD_SQL`, `ORDER_OPEN_SESSION_SQL`
 * from `lib/payment-attempt.ts`) the test interpolates THAT constant, so a drift
 * between the test and production is impossible.
 *
 * The pure half of the fold (`foldPaymentStatus`, `foldPaymentRow`,
 * `openSessionFor`) is exercised without a database, so the precedence rule is
 * checked even on a machine with no test database configured.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const testFn = hasTestDatabase() ? test : test.skip;

// ─── The pure fold (no database required) ────────────────────────────────────

describe("foldPaymentStatus — precedence, not recency", () => {
  const row = (status: string, refund_status: string | null = null, minutesAgo = 0) => ({
    id: `row-${status}-${refund_status ?? "none"}-${minutesAgo}`,
    order_id: null as string | null,
    checkout_group_id: "group" as string | null,
    method: "CARD" as string | null,
    status,
    amount: "100.00" as string | null,
    currency: "THB" as string | null,
    provider: "stripe" as string | null,
    provider_checkout_session_id: null as string | null,
    provider_payment_id: null as string | null,
    refunded_amount: "0" as string | null,
    refund_status,
    created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    paid_at: null as string | Date | null,
  });

  test("an empty covering set folds to null (so a caller picks its own sentinel)", async () => {
    const { foldPaymentStatus, foldPaymentRow } = await import("../lib/payment-attempt.js");
    expect(foldPaymentStatus([])).toBeNull();
    expect(foldPaymentRow([])).toBeNull();
  });

  test("a settled row outranks a NEWER abandoned retry", async () => {
    const { foldPaymentStatus } = await import("../lib/payment-attempt.js");
    // The group charge settled, then a retry opened afterwards.
    const rows = [row("requires_action", null, 0), row("paid", null, 30)];
    expect(foldPaymentStatus(rows)).toBe("paid");
    // …and the answer does not depend on the order the rows arrive in.
    expect(foldPaymentStatus([...rows].reverse())).toBe("paid");
  });

  test("paid outranks processing; refund states outrank paid", async () => {
    const { foldPaymentStatus } = await import("../lib/payment-attempt.js");
    expect(foldPaymentStatus([row("processing", null, 0), row("requires_action", null, 10)])).toBe("processing");
    expect(foldPaymentStatus([row("paid", null, 0), row("processing", null, 10)])).toBe("paid");
    expect(foldPaymentStatus([row("paid", "partially_refunded", 0), row("paid", null, 10)])).toBe(
      "partially_refunded",
    );
    expect(foldPaymentStatus([row("paid", "refunded", 0), row("paid", "partially_refunded", 10)])).toBe("refunded");
  });

  test("with nothing settled, the NEWEST row decides", async () => {
    const { foldPaymentStatus } = await import("../lib/payment-attempt.js");
    expect(foldPaymentStatus([row("cancelled", null, 1), row("failed", null, 20)])).toBe("cancelled");
  });

  test("foldPaymentRow prefers the captured row a money action must use", async () => {
    const { foldPaymentRow } = await import("../lib/payment-attempt.js");
    const retry = row("requires_action", null, 0);
    const captured = row("paid", null, 30);
    expect(foldPaymentRow([retry, captured])?.id).toBe(captured.id);
    // With nothing captured the newest row is still the best answer.
    expect(foldPaymentRow([retry])?.id).toBe(retry.id);
  });

  test("openSessionFor finds a live session but never reports a settled order as open", async () => {
    const { openSessionFor } = await import("../lib/payment-attempt.js");
    const open = { ...row("requires_action", null, 0), provider_checkout_session_id: "cs_open" };
    const paid = { ...row("paid", null, 10), provider_checkout_session_id: "cs_paid" };
    expect(openSessionFor([open, paid])).toBe("cs_open");
    expect(openSessionFor([paid])).toBeNull();
  });
});

// ─── The same questions, asked of a real database ────────────────────────────

describe("a multi-shop purchase through the covering-set resolver", () => {
  const fixtureUserIds: string[] = [];
  const q = async (sql: string, params?: unknown[]) => {
    const { query } = await import("../db/index.js");
    return query(sql, params);
  };

  let shopA = "";
  let shopB = "";
  let productA = "";
  let productB = "";
  let owner = "";
  let group = "";
  let orderA = "";
  let orderB = "";
  let groupPayment = "";

  beforeAll(async () => {
    // Products are needed so `order_items` can satisfy its FK to `products`,
    // which is what `releaseOrderInventory` walks.
    owner = (await q(`INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id`, [
      "cgi-vis-owner@test.local",
      "CGI Visibility Owner",
    ])).rows[0].id as string;
    fixtureUserIds.push(owner);

    const sellerUser = (await q(`INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id`, [
      "cgi-vis-seller@test.local",
      "CGI Visibility Seller",
    ])).rows[0].id as string;
    fixtureUserIds.push(sellerUser);
    const seller = (await q(`INSERT INTO sellers (user_id, status) VALUES ($1,'approved') RETURNING id`, [
      sellerUser,
    ])).rows[0].id as string;

    shopA = (await q(`INSERT INTO shops (seller_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [
      seller, "CGI Vis A", "cgi-vis-a",
    ])).rows[0].id as string;
    shopB = (await q(`INSERT INTO shops (seller_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [
      seller, "CGI Vis B", "cgi-vis-b",
    ])).rows[0].id as string;

    const mkProduct = async (name: string, slug: string, quantity: number) => {
      const product = (await q(
        `INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1,$2,$3,100.00,'approved') RETURNING id`,
        [shopA, name, slug],
      )).rows[0].id as string;
      await q(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1,$2,$2)`, [product, quantity]);
      return product;
    };
    productA = await mkProduct("CGI Vis Product A", "cgi-vis-product-a", 5);
    productB = await mkProduct("CGI Vis Product B", "cgi-vis-product-b", 5);

    // ── The purchase, exactly as checkout leaves it ──────────────────────
    group = (await q(
      `INSERT INTO checkout_groups (user_id, total_amount, currency, item_count, shop_count)
       VALUES ($1, 1500.00, 'THB', 4, 2) RETURNING id`,
      [owner],
    )).rows[0].id as string;

    const mkOrder = async (shopId: string, productId: string, total: string) => {
      const order = (await q(
        `INSERT INTO orders (user_id, shop_id, status, subtotal, total_amount, currency,
                             checkout_group_id, payment_expires_at)
         VALUES ($1,$2,'pending_payment',$3,$3,'THB',$4, NOW() + interval '30 minutes') RETURNING id`,
        [owner, shopId, total, group],
      )).rows[0].id as string;
      await q(
        `INSERT INTO order_items (order_id, product_id, shop_id, quantity, price, subtotal)
         VALUES ($1,$2,$3,2,${total === "700.00" ? "350.00" : "400.00"},$4)`,
        [order, productId, shopId, total],
      );
      return order;
    };
    orderA = await mkOrder(shopA, productA, "700.00");
    orderB = await mkOrder(shopB, productB, "800.00");

    // ONE charge for the whole purchase — `order_id` NULL is the entire point.
    groupPayment = (await q(
      `INSERT INTO payments (order_id, checkout_group_id, provider, method, status, amount, currency,
                             provider_checkout_session_id, provider_payment_id, paid_at)
       VALUES (NULL, $1, 'stripe', 'PROMPTPAY', 'paid', 1500.00, 'THB', 'cs_cgi_paid', 'pi_cgi_paid', NOW())
       RETURNING id`,
      [group],
    )).rows[0].id as string;

    // …and the orders read as settled, which is what the webhook writes.
    await q(`UPDATE orders SET status = 'paid' WHERE checkout_group_id = $1`, [group]);
  });

  // Deliberately NO `afterEach` purge: these cases are sequential and later ones
  // read the state earlier ones produced (the sweep refusing, the purchase being
  // terminated, the refund landing). Cleanup is once, at the end.
  afterAll(async () => {
    await purgeUsers(fixtureUserIds);
  });

  testFn("CASE 1 — the quantity of payment rows is ONE for the whole purchase", async () => {
    const groupRows = await q(`SELECT id FROM payments WHERE checkout_group_id = $1`, [group]);
    expect(groupRows.rows.length).toBe(1);
    expect(groupRows.rows[0].id).toBe(groupPayment);

    const perOrder = await q(`SELECT id FROM payments WHERE order_id = ANY($1::uuid[])`, [[orderA, orderB]]);
    expect(perOrder.rows.length).toBe(0);
  });

  testFn("CASE 2 — the OLD blind read is what produced the symptom", async () => {
    for (const orderId of [orderA, orderB]) {
      const res = await q(
        `SELECT o.status AS order_status,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id
                           ORDER BY created_at DESC LIMIT 1), 'unpaid') AS blind_status
           FROM orders o WHERE o.id = $1`,
        [orderId],
      );
      // The contradiction, reproduced: paid order, "unpaid" payment.
      expect(res.rows[0].order_status).toBe("paid");
      expect(res.rows[0].blind_status).toBe("unpaid");
    }
  });

  testFn("CASE 3 — ORDER_PAYMENT_STATUS_SQL agrees with orders.status for EVERY member order", async () => {
    const { ORDER_PAYMENT_METHOD_SQL, ORDER_PAYMENT_STATUS_SQL } = await import("../lib/payment-attempt.js");
    for (const orderId of [orderA, orderB]) {
      const res = await q(
        `SELECT o.status AS order_status,
                ${ORDER_PAYMENT_STATUS_SQL} AS payment_status,
                ${ORDER_PAYMENT_METHOD_SQL} AS payment_method
           FROM orders o WHERE o.id = $1`,
        [orderId],
      );
      expect(res.rows[0].payment_status).toBe("paid");
      expect(res.rows[0].payment_status).toBe(res.rows[0].order_status);
      // The rail comes from the GROUP row, which is the only row there is.
      expect(res.rows[0].payment_method).toBe("PROMPTPAY");
    }
  });

  testFn("CASE 4 — the row-level resolver returns the covering set and the folded status", async () => {
    const { coveringPaymentsForOrder, orderPaymentState } = await import("../lib/payment-attempt.js");
    const { query } = await import("../db/index.js");

    for (const orderId of [orderA, orderB]) {
      const rows = await coveringPaymentsForOrder({ query }, orderId);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(groupPayment);

      const state = await orderPaymentState({ query }, orderId);
      expect(state.status).toBe("paid");
      expect(state.displayStatus).toBe("paid");
      expect(state.settled).toBe(true);
      expect(state.checkoutGroupId).toBe(group);
      expect(state.row?.id).toBe(groupPayment);
    }
  });

  testFn("CASE 5 — the price of the purchase is the group's, not one shop's", async () => {
    // The retry hole was that a request naming only `orderId` was dispatched to the
    // single-order branch, which charged `toStripeMinor(order.total_amount)` — ONE
    // shop's 700.00 beside the live group charge of 1500.00. The server now derives
    // the purchase from the ORDER's own `checkout_group_id`, so the dispatch cannot
    // be steered by omitting a client value.
    const { readOrderPurchaseScope } = await import("../lib/payment-attempt.js");
    const { query } = await import("../db/index.js");

    for (const orderId of [orderA, orderB]) {
      const scope = await readOrderPurchaseScope({ query }, orderId);
      expect(scope.checkoutGroupId).toBe(group);
      expect(scope.userId).toBe(owner);
    }

    const totals = await q(
      `SELECT SUM(total_amount)::text AS purchase_total FROM orders WHERE checkout_group_id = $1`,
      [group],
    );
    expect(Number(totals.rows[0].purchase_total)).toBe(1500);
    const charge = await q(`SELECT amount::text AS amount FROM payments WHERE id = $1`, [groupPayment]);
    expect(Number(charge.rows[0].amount)).toBe(1500);
  });

  testFn("CASE 6 — the CONFIRM gate passes for a paid purchase (it used to be a permanent 409)", async () => {
    const { assertPaymentConfirmedForConfirmation } = await import("../lib/order-fulfillment.js");
    const { withTransaction } = await import("../db/index.js");
    for (const orderId of [orderA, orderB]) {
      const decision = await withTransaction((client) => assertPaymentConfirmedForConfirmation(client, orderId));
      expect(decision.method).toBe("PROMPTPAY");
    }
  });

  testFn("CASE 7 — the RELEASE guard refuses: stock of a sold order is never returned", async () => {
    const { releaseOrderInventory } = await import("../lib/inventory.js");
    const { withTransaction } = await import("../db/index.js");
    for (const orderId of [orderA, orderB]) {
      const released = await withTransaction((client) => releaseOrderInventory(client, orderId));
      expect(released).toBe(false);
    }
    const flags = await q(
      `SELECT inventory_released FROM orders WHERE id = ANY($1::uuid[])`,
      [[orderA, orderB]],
    );
    for (const flag of flags.rows) expect(flag.inventory_released).toBe(false);
  });

  testFn("CASE 8 — the CANCELLATION gate blocks: a paid purchase cannot be cancelled", async () => {
    const { latestPaymentStatusForOrder, paymentBlocksCancellation } = await import("../lib/order-lock.js");
    const { withTransaction } = await import("../db/index.js");
    for (const orderId of [orderA, orderB]) {
      const status = await withTransaction((client) => latestPaymentStatusForOrder(client, orderId));
      expect(status).toBe("paid");
      expect(paymentBlocksCancellation(status)).toBe(true);
    }
  });

  testFn("CASE 9 — the EXPIRY SWEEP refuses: a live/captured charge owns the purchase", async () => {
    const { expirePaymentReservation } = await import("../jobs/payment-reservation-scheduler.js");
    // Give the orders a lapsed deadline so ONLY the payment guard can save them.
    await q(`UPDATE orders SET payment_expires_at = NOW() - interval '1 minute' WHERE checkout_group_id = $1`, [
      group,
    ]);

    const reservedBefore = await q(
      `SELECT product_id, reserved FROM inventory WHERE product_id = ANY($1::uuid[]) ORDER BY product_id`,
      [[productA, productB]],
    );

    // (1) An order whose status is already decided is refused by the cheapest
    // guard, before a payment is even consulted.
    const decided = await expirePaymentReservation(orderA);
    expect(decided.outcome).toBe("skipped");
    expect(decided.reason).toBe("status 'paid' is already decided");

    // (2) The PAYMENT guard, on its own. A stale order status is exactly the
    // window between the charge landing and the webhook writing `paid` — and a
    // captured charge owns the purchase whatever `orders.status` still says.
    await q(`UPDATE orders SET status = 'pending_payment' WHERE checkout_group_id = $1`, [group]);
    const guarded = await expirePaymentReservation(orderA);
    expect(guarded.outcome).toBe("skipped");
    expect(guarded.reason).toBe("payment is 'paid'");

    // Nothing moved: not the orders, not their stock. `payment_expires_at` is
    // lapsed, so ONLY the payment guard can have saved this purchase.
    const after = await q(
      `SELECT status, inventory_released FROM orders WHERE checkout_group_id = $1 ORDER BY id`,
      [group],
    );
    for (const row of after.rows) {
      expect(row.status).toBe("pending_payment");
      expect(row.inventory_released).toBe(false);
    }
    const reservedAfterSweep = await q(
      `SELECT product_id, reserved FROM inventory WHERE product_id = ANY($1::uuid[]) ORDER BY product_id`,
      [[productA, productB]],
    );
    for (let i = 0; i < reservedBefore.rows.length; i += 1) {
      expect(reservedAfterSweep.rows[i].product_id).toBe(reservedBefore.rows[i].product_id);
      expect(reservedAfterSweep.rows[i].reserved).toBe(reservedBefore.rows[i].reserved);
    }
  });

  testFn("CASE 10 — a purchase is TERMINATED as one unit, and a repeat is an idempotent no-op", async () => {
    const { terminateCheckoutGroup } = await import("../lib/checkout-group-lifecycle.js");
    const { withTransaction } = await import("../db/index.js");

    // Move the purchase back to an abandoned state: two orders, one charge.
    await q(`UPDATE orders SET status = 'pending_payment' WHERE checkout_group_id = $1`, [group]);
    await q(`UPDATE payments SET status = 'requires_action', paid_at = NULL WHERE id = $1`, [groupPayment]);

    // What each product physically holds, and how much of it THIS purchase holds:
    // `reserved` may include units held by anything else, so the assertion below is
    // "the hold drops by exactly the units these orders reserved", not "reserved is 0".
    const reservedBefore = await q(
      `SELECT i.product_id, i.reserved, COALESCE(SUM(it.quantity), 0)::int AS held
         FROM inventory i
         LEFT JOIN order_items it
                ON it.product_id = i.product_id AND it.order_id = ANY($1::uuid[])
        WHERE i.product_id = ANY($2::uuid[])
        GROUP BY i.product_id, i.reserved
        ORDER BY i.product_id`,
      [[orderA, orderB], [productA, productB]],
    );
    expect(reservedBefore.rows.length).toBe(2);
    for (const row of reservedBefore.rows) expect(row.held).toBeGreaterThan(0);

    const first = await withTransaction((client) =>
      terminateCheckoutGroup(client, group, {
        toStatus: "cancelled",
        failureCode: "ORDER_CANCELLED",
        failureMessage: "test",
      }),
    );
    expect(first.moved).toBe(true);
    expect(first.blockedBy).toBeNull();
    expect(first.claimed.length).toBe(2);
    expect(first.released.length).toBe(2);
    expect(first.openSessionId).toBe("cs_cgi_paid");
    expect(first.voidedRows).toBe(1);

    const state = await q(
      `SELECT status, inventory_released FROM orders WHERE checkout_group_id = $1`,
      [group],
    );
    for (const row of state.rows) {
      expect(row.status).toBe("cancelled");
      expect(row.inventory_released).toBe(true);
    }
    const charge = await q(`SELECT status FROM payments WHERE id = $1`, [groupPayment]);
    expect(charge.rows[0].status).toBe("cancelled");

    // STOCK IS RETURNED EXACTLY ONCE — the atomic claim, not a read-then-write.
    const reservedAfter = await q(
      `SELECT product_id, reserved FROM inventory WHERE product_id = ANY($1::uuid[]) ORDER BY product_id`,
      [[productA, productB]],
    );
    for (let i = 0; i < reservedBefore.rows.length; i += 1) {
      expect(reservedAfter.rows[i].product_id).toBe(reservedBefore.rows[i].product_id);
      expect(reservedAfter.rows[i].reserved).toBe(reservedBefore.rows[i].reserved - reservedBefore.rows[i].held);
    }

    // A second call (a double click, a retried request, a redelivered webhook)
    // claims nothing and moves nothing.
    const second = await withTransaction((client) =>
      terminateCheckoutGroup(client, group, {
        toStatus: "cancelled",
        failureCode: "ORDER_CANCELLED",
        failureMessage: "test",
      }),
    );
    expect(second.moved).toBe(false);
    expect(second.claimed.length).toBe(0);

    const invAgain = await q(
      `SELECT product_id, reserved FROM inventory WHERE product_id = ANY($1::uuid[]) ORDER BY product_id`,
      [[productA, productB]],
    );
    for (let i = 0; i < invAgain.rows.length; i += 1) {
      expect(invAgain.rows[i].reserved).toBe(reservedAfter.rows[i].reserved);
    }
  });

  testFn("CASE 11 — a refund of a purchase has a parent and does not raise 23502", async () => {
    const { withTransaction } = await import("../db/index.js");
    // `refunds.order_id` was NOT NULL, so this INSERT raised 23502, the webhook
    // answered 500 and Stripe redelivered the same event forever.
    const inserted = await withTransaction(async (client) => {
      await client.query(`SELECT id FROM orders WHERE checkout_group_id = $1 ORDER BY id ASC FOR UPDATE`, [group]);
      return client.query(
        `INSERT INTO refunds
           (order_id, checkout_group_id, payment_id, provider, provider_refund_id, amount, reason, status, refunded_at)
         VALUES (NULL, $1, $2, 'stripe', 're_cgi_group', 1500.00, 'requested_by_customer', 'succeeded', NOW())
         ON CONFLICT (provider_refund_id) DO UPDATE SET updated_at = NOW()
         RETURNING id, order_id, checkout_group_id`,
        [group, groupPayment],
      );
    });
    expect(inserted.rows.length).toBe(1);
    expect(inserted.rows[0].order_id).toBeNull();
    expect(inserted.rows[0].checkout_group_id).toBe(group);

    // …and it resolves from EITHER member order through the covering set.
    const fromOrder = await q(
      `SELECT r.id FROM refunds r
        WHERE r.order_id = $1
           OR (r.order_id IS NULL
               AND to_jsonb(r) ->> 'checkout_group_id' = (
                 SELECT o.checkout_group_id::text FROM orders o WHERE o.id = $1))`,
      [orderB],
    );
    expect(fromOrder.rows.length).toBe(1);

    // A parentless refund is refused by the schema, so the rule is enforced in
    // the database and not only in application code.
    let violated = false;
    try {
      await q(
        `INSERT INTO refunds (order_id, checkout_group_id, payment_id, provider, amount, status)
         VALUES (NULL, NULL, $1, 'stripe', 1.00, 'pending')`,
        [groupPayment],
      );
    } catch (err) {
      violated = (err as { code?: string }).code === "23514";
    }
    expect(violated).toBe(true);
  });

  testFn("CASE 12 — the stored payment vocabulary is the one the schema allows", async () => {
    // `payments_status_check` (migration 055) exists on a freshly reconciled
    // database because no row can violate it.
    const constraint = await q(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'payments_status_check'`,
    );
    expect(constraint.rows.length).toBe(1);
    for (const value of ["pending", "requires_action", "processing", "paid", "failed", "cancelled"]) {
      expect(constraint.rows[0].def).toContain(value);
    }

    let rejected = false;
    try {
      await q(`UPDATE payments SET status = 'partially_refunded' WHERE id = $1`, [groupPayment]);
    } catch (err) {
      rejected = (err as { code?: string }).code === "23514";
    }
    expect(rejected).toBe(true);

    // `refunds_parent_check` likewise, from migration 055.
    const refundsCheck = await q(
      `SELECT 1 FROM pg_constraint WHERE conname = 'refunds_parent_check'`,
    );
    expect(refundsCheck.rows.length).toBe(1);
  });
});
