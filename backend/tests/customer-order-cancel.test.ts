/**
 * Customer order cancellation — order state, payment state, and STOCK.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An order that had been taken to Stripe ("pending_payment") could be paid
 * again but never cancelled: `PATCH /api/customer/orders/:orderId/cancel`
 * accepted only `pending` / `confirmed`, while the order page's own cancel
 * button used a second, local `["pending", "confirmed"]` set. After a failed or
 * abandoned payment the customer therefore had exactly one option — pay — with
 * no way to call the order off, even though the order was still holding stock.
 *
 * What is pinned here
 * -------------------
 *   1. the shared contract (`CUSTOMER_CANCELABLE_ORDER_STATUSES` /
 *      `orderCustomerCancelability`) and the backend's literal list agree — the
 *      button can never appear where the server refuses, or vanish where it
 *      would accept;
 *   2. a paid, shipped, delivered or completed order is refused (400) and a
 *      `paid` payment refuses the cancel even when the order row lags (409);
 *   3. `pending_payment` cancels: order → `cancelled`, the abandoned Stripe
 *      attempt → `cancelled`, and the reserved stock goes back exactly once;
 *   4. repeats, concurrency and a late/duplicate Stripe webhook can never
 *      release stock twice (`inventory_released` claim + the guarded UPDATE);
 *   5. an already-terminal order (`cancelled`, `payment_failed`) is an
 *      idempotent no-op — charged nothing, released nothing;
 *   6. another customer's order is a 404, never a 403 that confirms it exists;
 *   7. the Stripe side is closed first (the abandoned Checkout Session is
 *      expired), and a verified `payment_intent.succeeded` arriving afterwards
 *      still cannot turn a cancelled order into `paid`;
 *   8. the storefront offers "continue payment" AND "cancel order" for an unpaid
 *      order, and shows neither for a cancelled one;
 *   9. the new copy exists in th / en / my.
 *
 * The frontend and route assertions are source contracts, in the style this
 * suite already uses for `stripe.ts` and the order-status contract: the file is
 * read and the shape that must hold is asserted, so an edit that reintroduces
 * the dead end fails here.
 *
 * No test here calls Stripe. The DB-gated cases assert state transitions in the
 * test database; the one webhook case signs a payload locally with Stripe's own
 * scheme (no network, no SDK) and only ever asserts that the ORDER is protected.
 */
import { afterEach, describe, expect, test } from "bun:test";
import cookieParser from "cookie-parser";
import { createHmac } from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import {
  CUSTOMER_CANCELABLE_ORDER_STATUSES,
  isOrderCancelableByCustomer,
  orderCustomerCancelability,
} from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const ORDER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The cancellation rule (shared contract)
// ═══════════════════════════════════════════════════════════════════════════

describe("order cancellation — the rule the cancel button and the backend share", () => {
  test("the cancelable statuses are exactly the three the server accepts", () => {
    expect([...CUSTOMER_CANCELABLE_ORDER_STATUSES]).toEqual(["pending", "pending_payment", "confirmed"]);
    expect(isOrderCancelableByCustomer("pending")).toBe(true);
    expect(isOrderCancelableByCustomer("pending_payment")).toBe(true);
    expect(isOrderCancelableByCustomer("confirmed")).toBe(true);
  });

  test("an unpaid pending_payment order can be cancelled AND paid", () => {
    // The whole point of the change: this state offers both actions.
    expect(
      orderCustomerCancelability({ status: "pending_payment", paymentStatus: "requires_action" }),
    ).toEqual({ cancelable: true, reason: null });
    expect(
      orderCustomerCancelability({ status: "pending", paymentStatus: "unpaid" }),
    ).toEqual({ cancelable: true, reason: null });
  });

  test("a paid, shipped, delivered or completed order cannot be cancelled", () => {
    for (const status of ["paid", "shipped", "delivered", "completed", "refunded", "payment_failed", "cancelled"]) {
      expect(isOrderCancelableByCustomer(status)).toBe(false);
    }
    expect(orderCustomerCancelability({ status: "shipped", paymentStatus: "paid" })).toEqual({
      cancelable: false,
      reason: "payment_in_progress",
    });
    expect(orderCustomerCancelability({ status: "delivered", paymentStatus: "paid" }).cancelable).toBe(false);
  });

  test("money already taken (or in flight) blocks cancellation, whatever the order row says", () => {
    // An order row lagging one transition behind its payment must not offer a
    // cancel that would need a refund instead.
    expect(orderCustomerCancelability({ status: "pending_payment", paymentStatus: "paid" })).toEqual({
      cancelable: false,
      reason: "payment_in_progress",
    });
    expect(orderCustomerCancelability({ status: "pending_payment", paymentStatus: "processing" }).cancelable).toBe(false);
    expect(
      orderCustomerCancelability({ status: "pending_payment", payments: [{ status: "paid" }] }).cancelable,
    ).toBe(false);
  });

  test("a missing order is never cancelable", () => {
    expect(orderCustomerCancelability(null)).toEqual({ cancelable: false, reason: "not_cancelable" });
    expect(orderCustomerCancelability(undefined)).toEqual({ cancelable: false, reason: "not_cancelable" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Backend contract — one endpoint, transactional, idempotent
// ═══════════════════════════════════════════════════════════════════════════

describe("backend contract — the cancel endpoint", () => {
  const cartSrc = read(CART_ROUTE);
  const stripeSrc = read(STRIPE_ROUTE);
  const cancelStart = cartSrc.indexOf('app.patch("/api/customer/orders/:orderId/cancel"');
  const cancelEnd = cartSrc.indexOf('app.post("/api/customer/reorder"');
  const cancelBody = cartSrc.slice(cancelStart, cancelEnd);

  test("the route still exists, exactly once, in the module that owned it", () => {
    expect(cancelStart).toBeGreaterThan(-1);
    expect(cancelEnd).toBeGreaterThan(cancelStart);
    expect((cartSrc.match(/app\.patch\("\/api\/customer\/orders\/:orderId\/cancel"/g) ?? []).length).toBe(1);
    // No duplicate endpoint was invented anywhere else in the backend.
    const registrars = [...new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root })]
      .filter((f) => !f.includes("/tests/"))
      .filter((f) => read(f).includes('"/api/customer/orders/:orderId/cancel"'));
    expect(registrars).toEqual([CART_ROUTE]);
  });

  test("the status list is exactly the shared one (no drift)", () => {
    const match = cartSrc.match(/const CANCELABLE_STATUSES = \[([^\]]+)\];/);
    expect(match).not.toBeNull();
    const listed = [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual([...CUSTOMER_CANCELABLE_ORDER_STATUSES]);
  });

  test("ownership is enforced in the query, so another user gets a 404", () => {
    expect(cancelBody).toContain("WHERE o.id = $1 AND o.user_id = $2");
    expect(cancelBody).toContain('code: "NOT_FOUND"');
    // No ownership hint is accepted from the client.
    expect(cancelBody).not.toContain("req.body");
  });

  test("state and payment state are refused before anything is written", () => {
    expect(cancelBody).toContain('code: "INVALID_STATUS"');
    expect(cancelBody).toContain('code: "ORDER_ALREADY_PAID"');
    expect(cancelBody).toContain('code: "PAYMENT_IN_PROGRESS"');
    // The CHEAP refusals — the order's own status, and the payment state read
    // before the lock — all `return` before any transaction is opened.
    const invalidStatus = cancelBody.indexOf('code: "INVALID_STATUS"');
    const groupBranch = cancelBody.indexOf("if (order.checkout_group_id) {");
    expect(invalidStatus).toBeGreaterThan(-1);
    expect(groupBranch).toBeGreaterThan(-1);
    expect(invalidStatus).toBeLessThan(groupBranch);

    // A GROUPED purchase's refusal is deliberately decided INSIDE the transaction
    // that locks its member orders: a read taken outside those locks is only a fast
    // path, so `terminateCheckoutGroup` is the authority — and it refuses without
    // writing anything, which is what makes the in-transaction decision safe. The
    // refusal is answered before the provider session is closed and before a single
    // socket event is published.
    const refusal = cancelBody.indexOf(
      'if (groupOutcome.blockedBy === "paid" || groupOutcome.blockedBy === "processing")',
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(cancelBody.indexOf("await expireStripeCheckoutSession(groupOutcome.openSessionId)"));
    expect(refusal).toBeLessThan(cancelBody.indexOf("broadcast(CHANNELS.ORDER_UPDATED"));
    expect(read("backend/lib/checkout-group-lifecycle.ts")).toContain("blockedBy");

    // The SINGLE-ORDER refusals still precede their transaction.
    const guard = cancelBody.indexOf('if (order.latest_payment_status === "paid")');
    expect(guard).toBeGreaterThan(-1);
    expect(cancelBody.indexOf("await withTransaction(", guard)).toBeGreaterThan(guard);
  });

  test("the transition, the payment invalidation and the stock release share one transaction", () => {
    expect(cancelBody).toContain("const outcome = await withTransaction(async (client) => {");
    expect(cancelBody).toContain("await releaseOrderInventory(client, orderId);");
    // The transaction's FIRST statement is the order-row lock, so a concurrent
    // Stripe webhook serialises behind the same row in the same lock order
    // (`backend/tests/payment-cancellation-race.test.ts` pins that contract
    // across every order/payment writer). The result carries the refusal the
    // in-lock money gate can produce, which is answered above this block.
    expect(cancelBody).toContain("const locked = await lockOrderRow(client, orderId);");
    expect(cancelBody).toContain("return { moved, released, blockedBy: null as string | null };");
    expect(cancelBody).toContain("if (outcome.blockedBy === \"paid\") {");
    // The order must be `cancelled` BEFORE the release, because
    // releaseOrderInventory only releases for a releasable status. The order
    // write now sets the axes AND the projected legacy value in one statement
    // (P0-1), so the anchor is that statement.
    expect(cancelBody.indexOf("SET status = $3, order_state = $4, fulfillment_status = $5")).toBeLessThan(
      cancelBody.indexOf("releaseOrderInventory(client, orderId)"),
    );
  });

  test("the race gate is a guarded UPDATE, not a read-then-write", () => {
    expect(cancelBody).toContain("WHERE id = $1 AND status = ANY($2::text[])");
    expect(cancelBody).toContain("RETURNING id");
    expect(cancelBody).toContain("const moved = claim.rows.length > 0;");
    // The loser reports the authoritative state instead of claiming a cancel.
    expect(cancelBody).toContain("if (!outcome.moved) {");
  });

  test("the abandoned Stripe attempt is invalidated, and never a paid one", () => {
    expect(cancelBody).toContain("AND status IN ('pending', 'requires_action')");
    // The payment UPDATE is inside the transaction, after the order moved.
    // `orders` and `payments` each set their own `status`; the ORDER write is
    // the one that also carries the axes (P0-1), which is what makes the two
    // anchors unambiguous.
    const paymentsUpdate = cancelBody.indexOf("SET status = 'cancelled', failure_code = 'ORDER_CANCELLED'");
    expect(paymentsUpdate).toBeGreaterThan(
      cancelBody.indexOf("SET status = $3, order_state = $4, fulfillment_status = $5"),
    );
    expect(paymentsUpdate).toBeLessThan(cancelBody.indexOf("releaseOrderInventory(client, orderId)"));
  });

  test("the provider side is closed first, through the Stripe client's own module", () => {
    expect(cancelBody).toContain("await expireStripeCheckoutSession(order.open_session_id);");
    expect(cartSrc).toContain('import { expireStripeCheckoutSession } from "./stripe.js";');
    expect(stripeSrc).toContain("export async function expireStripeCheckoutSession(");
    // Expiring happens BEFORE the transaction, so a new charge is impossible
    // before the order is marked cancelled.
    expect(cancelBody.indexOf("expireStripeCheckoutSession")).toBeLessThan(
      cancelBody.indexOf("const outcome = await withTransaction("),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Webhook behaviour for a cancelled order — the ORDER is never resurrected
// ═══════════════════════════════════════════════════════════════════════════

describe("webhook behaviour after a cancellation", () => {
  const stripeSrc = read(STRIPE_ROUTE);

  /**
   * The SQL text of the statement starting at `marker` — from there to the
   * closing backtick of the template literal it lives in.
   *
   * The payment writers project the legacy status through the order-state
   * authority (P0-1) instead of naming a literal, so a guard assertion needs the
   * STATEMENT rather than a fixed substring: this helper keeps the assertions on
   * the WHERE clause — which is what the scenario is about — independently of
   * how the SET value is computed.
   */
  const statementAfter = (marker: string): string => {
    const at = stripeSrc.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const end = stripeSrc.indexOf("`", at);
    return stripeSrc.slice(at, end === -1 ? stripeSrc.length : end);
  };

  test("only a pre-payment status can become paid", () => {
    const paid = statementAfter(`projectOrderStatusSql("'paid'")`);
    const guard = paid.match(/status IN \(([^)]+)\)/);
    expect(guard).not.toBeNull();
    const accepted = [...guard![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    // `cancelled` is deliberately absent: a cancelled order stays cancelled.
    expect(accepted).toEqual(["pending", "pending_payment"]);
    expect(accepted).not.toContain("cancelled");
  });

  test("the same two statuses are the only ones a failure or expiry may move", () => {
    const failed = statementAfter(`projectOrderStatusSql("'failed'")`);
    expect(failed).toContain("status IN ('pending', 'pending_payment')");
    // The lapsed-session writer moves the axes too (the order really is over),
    // so its guard is pinned on the statement that carries both.
    const canceled = statementAfter("SET status = $2, order_state = $3");
    expect(canceled).toContain("status IN ('pending_payment', 'pending')");
  });

  test("funds arriving for a non-payable order are logged for an operator, never ignored", () => {
    // The payment row keeps recording the money (that is what makes it
    // refundable) while the ORDER is protected — and the case is visible.
    // The message names the case (cancelled, or a lapsed payment reservation)
    // and always asks for the manual review that refunds the money.
    expect(stripeSrc).toContain("no longer payable");
    expect(stripeSrc).toContain("manual review/refund required");
    // Derived by the schema-tolerant read, so the reason survives a database
    // that predates the reservation columns.
    expect(stripeSrc).toContain("const reservationExpired =");
    expect(stripeSrc).toContain("const priorPaymentStatus: string | null =");
  });

  test("the event claim stays idempotent — a redelivery cannot re-run the sync", () => {
    expect(stripeSrc).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(stripeSrc).toContain('row.status === "failed"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Storefront contract + copy
// ═══════════════════════════════════════════════════════════════════════════

describe("storefront — both actions on an unpaid order", () => {
  const src = read(ORDER_DETAIL_PAGE);

  test("the page reads the shared rule instead of its own list", () => {
    expect(src).toContain("orderCustomerCancelability");
    expect(src).toContain("const cancelability = orderCustomerCancelability(order);");
    expect(src).not.toContain('new Set(["pending", "confirmed"])');
  });

  test("pad payment offers continue-payment, unpaid orders offer cancel as well", () => {
    expect(src).toContain("{payability.payable && (");
    expect(src).toContain("{cancelability.cancelable && (");
    expect(src).toContain("<ResumePaymentButton");
    expect(src).toContain('t("orderDetail.cancelOrder")');
  });

  test("cancelling asks for confirmation first", () => {
    expect(src).toContain("<AlertDialog");
    expect(src).toContain('t("orderDetail.cancelDialogTitle")');
    expect(src).toContain('t("orderCancel.dialogDescUnpaid")');
    expect(src).toContain('t("orderCancel.back")');
    // The confirm action is guarded against a double submit.
    expect(src).toContain("disabled={busy}");
  });

  test("the dialog warns that the order can no longer be paid", () => {
    expect(src).toContain(
      '{payability.payable ? t("orderCancel.dialogDescUnpaid") : t("orderDetail.cancelDialogDesc")}',
    );
  });

  test("a cancelled order shows the cancelled state and no way back to payment", () => {
    expect(src).toContain('t("orderCancel.cancelledNotice")');
    // The same terminal slot also covers an expired payment reservation.
    expect(src).toMatch(/order\.status === "cancelled"[\s\S]{0,160}order\.status === "expired"/);
    expect(src).toContain('t("orderReservation.expiredTitle")');
    // Payability already excludes `cancelled`; the cancel button excludes it too.
    expect(isOrderCancelableByCustomer("cancelled")).toBe(false);
  });

  test("the copy exists in every locale", () => {
    const expected = ["back", "cancelledNotice", "dialogDescUnpaid"];
    for (const lang of ["th", "en", "my"] as const) {
      const ns = (translations[lang] as unknown as { orderCancel: Record<string, string> }).orderCancel;
      expect(ns).toBeDefined();
      expect(Object.keys(ns).sort()).toEqual(expected);
      for (const value of Object.values(ns)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Database-gated: the real transitions and the real stock movement
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("customer cancellation (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE"] as const;
  const JWT_SECRET = process.env.JWT_SECRET!;

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  /** Stripe's own signature scheme, computed locally — no network, no SDK. */
  function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  function buildApp(): express.Express {
    const app = express();
    app.use(stripeWebhookRawBody);
    app.use(express.json());
    app.use(cookieParser());
    setupCartRoutes(app);
    setupStripeRoutes(app);
    return app;
  }

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = buildApp().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  function token(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.local` }, JWT_SECRET, { expiresIn: "1h" });
  }

  interface SeedOptions {
    status: string;
    quantity?: number;
    /** Units already reserved by this order (what a cancel must give back). */
    reserved?: number;
    /**
     * True when a release ALREADY ran for this order — the `inventory_released`
     * flag a second release must find and refuse. A `payment_failed` order got
     * there through `markPaymentFailed`, which released its stock, so a fixture
     * that models one must set this or it is not modelling that order at all.
     */
    inventoryReleased?: boolean;
    /** An abandoned Stripe attempt: `requires_action`, no session id by default. */
    payment?: { status: string; method: string } | null;
    paymentMethod?: string;
  }

  /**
   * Seed owner → seller → shop → product → inventory → order (+order item).
   * Stock is seeded the way checkout reserves it: `inventory.reserved += qty`,
   * so a correct cancellation must bring `reserved` back to 0 — and a second
   * release would push it below zero.
   */
  async function seedOrder(opts: SeedOptions) {
    const { query } = await import("../db/index.js");
    const quantity = opts.quantity ?? 3;
    const reserved = opts.reserved ?? quantity;
    const tag = `cancel-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Cancel Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Cancel Seller",
    ]);
    const sellerUserId = sellerUser.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [sellerUserId]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, 120.00, 'published') RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, $2)`, [productId, reserved]);

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, inventory_released)
       VALUES ($1, $2, $3, $4, 360.00, 'THB', $5) RETURNING id`,
      [ownerId, shop.rows[0].id, `CX-${tag.slice(-12)}`, opts.status, opts.inventoryReleased ?? false],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shop.rows[0].id, `${tag} product`, quantity, quantity * 120],
    );
    if (opts.payment) {
      await query(
        `INSERT INTO payments (order_id, provider, method, amount, currency, status)
         VALUES ($1, 'stripe', $2, 360.00, 'THB', $3)`,
        [orderId, opts.payment.method, opts.payment.status],
      );
    } else if (opts.paymentMethod) {
      await query(
        `INSERT INTO payments (order_id, provider, method, amount, currency, status)
         VALUES ($1, 'stripe', $2, 360.00, 'THB', 'requires_action')`,
        [orderId, opts.paymentMethod],
      );
    }
    return { orderId, ownerId, sellerUserId, productId };
  }

  /** Everything a cancellation can change, read back in one query. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [orderId])
    ).rows[0];
    const inventory = (await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])).rows[0];
    const payments = (
      await query(`SELECT status FROM payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    ).rows.map((r: { status: string }) => r.status);
    return {
      status: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      reserved: Number(inventory.reserved),
      quantity: Number(inventory.quantity),
      payments,
    };
  }

  async function cancel(base: string, orderId: string, asUserId: string) {
    const res = await fetch(`${base}/api/customer/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(asUserId)}` },
    });
    const body = (await res.json()) as {
      data?: { status?: string; cancelled?: boolean; alreadyFinal?: boolean; stockReleased?: boolean };
      error?: { code?: string };
    };
    return { status: res.status, body };
  }

  test("pending_payment → cancelled, the Stripe attempt is voided and stock returns (scenario 1 + 2)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action", method: "PROMPTPAY" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "cancelled", cancelled: true, alreadyFinal: false, stockReleased: true });
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("cancelled");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      // The abandoned attempt can no longer be paid through it.
      expect(after.payments).toEqual(["cancelled"]);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a second cancel releases nothing again (scenario 3)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action", method: "CARD" } });
    try {
      await withServer(async (base) => {
        expect((await cancel(base, seed.orderId, seed.ownerId)).status).toBe(200);
        const second = await cancel(base, seed.orderId, seed.ownerId);
        expect(second.status).toBe(200);
        expect(second.body.data?.alreadyFinal).toBe(true);
        expect(second.body.data?.stockReleased).toBe(false);
      });
      const after = await stateOf(seed.orderId, seed.productId);
      // Exactly once: 0, never negative and never restored twice.
      expect(after.reserved).toBe(0);
      expect(after.status).toBe("cancelled");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("two concurrent cancels still release stock exactly once (scenario 11)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action", method: "CARD" } });
    try {
      await withServer(async (base) => {
        const [a, b] = await Promise.all([
          cancel(base, seed.orderId, seed.ownerId),
          cancel(base, seed.orderId, seed.ownerId),
        ]);
        expect([a.status, b.status]).toEqual([200, 200]);
        // Exactly one request did the work; the other reports the outcome.
        //
        // `alreadyFinal` is the discriminator, NOT `cancelled`. `cancelled`
        // reports the ORDER's state, so both requests legitimately say `true`
        // once the winner has committed — scenario 10 below pins exactly that, on
        // a cancel that never moved anything. Only the winner reports
        // `alreadyFinal: false`.
        const moved = [a, b].filter((r) => r.body.data?.alreadyFinal === false);
        expect(moved.length).toBe(1);
        // Both observe the same authoritative state: the order is cancelled.
        expect([a, b].every((r) => r.body.data?.status === "cancelled")).toBe(true);
        expect([a, b].every((r) => r.body.data?.cancelled === true)).toBe(true);
        expect([a, b].filter((r) => r.body.data?.stockReleased === true).length).toBeLessThanOrEqual(1);
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.reserved).toBe(0);
      expect(after.status).toBe("cancelled");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a paid order is refused and untouched (scenario 4)", async () => {
    const seed = await seedOrder({ status: "paid", reserved: 0, payment: { status: "paid", method: "CARD" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(400);
        expect(res.body.error?.code).toBe("INVALID_STATUS");
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "paid", inventoryReleased: false, reserved: 0, payments: ["paid"] });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a lagging order row cannot cancel a PAID payment — 409, not a silent refund hole", async () => {
    // The order still reads `pending_payment` while the money already landed.
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "paid", method: "CARD" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("ORDER_ALREADY_PAID");
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "pending_payment", inventoryReleased: false, payments: ["paid"] });
      // The reservation is left alone: the order is going to ship.
      expect(after.reserved).toBe(3);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a payment being authorised is refused until it settles", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "processing", method: "CARD" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("PAYMENT_IN_PROGRESS");
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "pending_payment", payments: ["processing"] });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a shipped or delivered order is refused (scenarios 5 + 6)", async () => {
    for (const status of ["shipped", "delivered", "completed"]) {
      const seed = await seedOrder({ status, reserved: 0, payment: { status: "paid", method: "CARD" } });
      try {
        await withServer(async (base) => {
          const res = await cancel(base, seed.orderId, seed.ownerId);
          expect(res.status).toBe(400);
          expect(res.body.error?.code).toBe("INVALID_STATUS");
        });
        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe(status);
        expect(after.reserved).toBe(0);
      } finally {
        await purgeUsers([seed.ownerId, seed.sellerUserId]);
      }
    }
  });

  test("another customer's order is a 404 and nothing moves (scenario 7)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action", method: "CARD" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.sellerUserId);
        // 404, not 403: a 403 would confirm the order exists to a stranger.
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe("NOT_FOUND");
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "pending_payment", inventoryReleased: false, reserved: 3 });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("an unknown order is a 404 (scenario 8)", async () => {
    await withServer(async (base) => {
      const res = await cancel(base, crypto.randomUUID(), crypto.randomUUID());
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
    });
  });

  test("a payment_failed order is an idempotent no-op — nothing is released twice (scenario 9)", async () => {
    // `markPaymentFailed` already released this order's stock, so a cancel
    // request must NOT give it back a second time. `inventoryReleased: true` is
    // what that release leaves behind — without it the fixture described an order
    // that never failed, and the assertion below could not be about idempotency.
    const seed = await seedOrder({
      status: "payment_failed",
      reserved: 0,
      inventoryReleased: true,
      payment: { status: "failed", method: "CARD" },
    });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "payment_failed", alreadyFinal: true, stockReleased: false });
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "payment_failed", reserved: 0, inventoryReleased: true });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("an already-cancelled order is an idempotent no-op (scenario 10)", async () => {
    const seed = await seedOrder({ status: "cancelled", reserved: 0, payment: { status: "cancelled", method: "PROMPTPAY" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "cancelled", cancelled: true, alreadyFinal: true, stockReleased: false });
      });
      const after = await stateOf(seed.orderId, seed.productId);
      // `inventory_released` is false here only because the fixture never set it
      // — and this endpoint deliberately does NOT release an already-terminal
      // order, so `reserved` cannot fall below zero.
      expect(after.reserved).toBe(0);
      expect(after.status).toBe("cancelled");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a verified payment_intent.succeeded after a cancel leaves the order cancelled (scenario 13)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action", method: "PROMPTPAY" } });
    try {
      await withServer(async (base) => {
        // 1. the customer cancels.
        const cancelled = await cancel(base, seed.orderId, seed.ownerId);
        expect(cancelled.status).toBe(200);
        expect(cancelled.body.data?.cancelled).toBe(true);
      });

      // 2. a real, correctly signed success event for that order arrives.
      process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_000000000000000000000000";
      const payload = JSON.stringify({
        id: `evt_cancel_${crypto.randomUUID()}`,
        object: "event",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: `pi_cancel_${crypto.randomUUID()}`,
            object: "payment_intent",
            metadata: { orderId: seed.orderId },
          },
        },
      });
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/stripe/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "stripe-signature": stripeSignature(payload, "whsec_000000000000000000000000"),
          },
          body: payload,
        });
        // Signature accepted: the handler ran (200, or 500 if it could not be
        // recorded) — never the 400 that would mean the request was rejected.
        expect(res.status).not.toBe(400);
      });

      const after = await stateOf(seed.orderId, seed.productId);
      // The ORDER is protected — and stock was not released a second time.
      expect(after.status).toBe("cancelled");
      expect(after.reserved).toBe(0);
      expect(after.inventoryReleased).toBe(true);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a duplicate checkout.session.expired after a cancel is harmless (scenario 12)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "cancelled", method: "CARD" } });
    try {
      const cancelled = await withServer((base) => cancel(base, seed.orderId, seed.ownerId));
      expect(cancelled.status).toBe(200);

      process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_000000000000000000000000";
      const payload = JSON.stringify({
        id: `evt_expired_${crypto.randomUUID()}`,
        object: "event",
        type: "checkout.session.expired",
        data: {
          object: { id: "cs_test_expired", object: "checkout.session", metadata: { orderId: seed.orderId } },
        },
      });
      await withServer(async (base) => {
        const res = await fetch(`${base}/api/payments/stripe/webhook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "stripe-signature": stripeSignature(payload, "whsec_000000000000000000000000"),
          },
          body: payload,
        });
        expect(res.status).not.toBe(400);
      });

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("cancelled");
      expect(after.reserved).toBe(0);
      expect(after.inventoryReleased).toBe(true);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("an order with NO payment row can still be cancelled (scenario 14: the path stays usable)", async () => {
    // An order created and never taken to Stripe: `pending`, nothing recorded.
    const seed = await seedOrder({ status: "pending", payment: null });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "cancelled", cancelled: true, stockReleased: true });
      });
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after).toMatchObject({ status: "cancelled", reserved: 0, inventoryReleased: true, payments: [] });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });
});
