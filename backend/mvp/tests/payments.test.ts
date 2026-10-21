/**
 * MVP payments — signature verification, idempotent settlement, amount checks,
 * and the fulfilment path that follows a real settlement.
 *
 * WHAT IS REAL HERE
 *   • the webhook route, the raw-body ordering, `constructEventAsync` and a
 *     genuine HMAC signature produced by the Stripe SDK;
 *   • every database write (event claim, payment, order, stock, audit);
 *   • the state machines (order status trigger, one-active-session index).
 *
 * WHAT IS NOT: a Stripe API round trip. `stripe.checkout.sessions.create` is
 * never called with a real account here, so "a session was created at Stripe"
 * is NOT verified by this file — only the local guards around it. The test-mode
 * key below is a syntactically valid FAKE and is never used to reach Stripe.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  checkout,
  createUser,
  deliverPaidWebhook,
  seedCart,
  startApp,
  stockRow,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

const FAKE_TEST_KEY = "sk_test_mvp_local_only_not_a_real_key";
const FAKE_WEBHOOK_SECRET = "whsec_mvp_local_only_secret";

interface PaymentFixture {
  orderId: string;
  paymentId: string;
  sessionId: string;
  totalMinor: number;
  sellerCookie: string;
  buyerCookie: string;
  productId: string;
}

describe("MVP payments (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: Awaited<ReturnType<typeof createUser>>;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
    saved.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
    saved.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
    saved.STRIPE_MODE = process.env.STRIPE_MODE;
    process.env.STRIPE_SECRET_KEY = FAKE_TEST_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;
    delete process.env.STRIPE_MODE;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (app) await app.close();
  });

  /** A real order plus the payment row the session endpoint would have created. */
  async function pendingPayment(opts: { stock?: number; quantity?: number } = {}): Promise<PaymentFixture> {
    const seeded = await seedCart(app.base, {
      adminId: admin.id,
      price: "100.00",
      stock: opts.stock ?? 5,
    });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId, {
      requestKey: `pay-${crypto.randomUUID()}`,
    });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order;
    const totalMinor = Math.round(Number(order.totalAmount) * 100);
    const sessionId = `cs_test_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const payment = await query(
      `INSERT INTO payments (order_id, provider, status, amount, currency, method, provider_checkout_session_id)
       VALUES ($1, 'stripe', 'requires_action', $2, 'THB', 'card', $3)
       RETURNING id`,
      [order.id, order.totalAmount, sessionId],
    );
    return {
      orderId: order.id,
      paymentId: (payment.rows[0] as { id: string }).id,
      sessionId,
      totalMinor,
      sellerCookie: seeded.seller.cookie,
      buyerCookie: seeded.buyer.cookie,
      productId: seeded.product.id,
    };
  }

  itDb("reports a usable TEST configuration without ever exposing the secret key", async () => {
    const res = await api(app.base, "/api/mvp/payments/status");
    expect(res.status).toBe(200);
    expect(res.body.data.usable).toBe(true);
    expect(res.body.data.mode).toBe("test");
    expect(res.body.data.methods).toEqual(["CARD", "PROMPTPAY"]);
    expect(JSON.stringify(res.body)).not.toContain("sk_test");
    expect(JSON.stringify(res.body)).not.toContain("whsec_");
  });

  itDb("refuses a forged webhook and records no event", async () => {
    const res = await fetch(`${app.base}/api/mvp/payments/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", data: { object: {} } }),
    });
    expect(res.status).toBe(400);
    const events = await query(`SELECT COUNT(*)::int AS n FROM payment_events WHERE event_id = 'evt_forged'`);
    expect((events.rows[0] as { n: number }).n).toBe(0);
  });

  itDb("settles a paid session exactly once: order paid, stock committed, audit written", async () => {
    const fixture = await pendingPayment({ stock: 5 });
    const eventId = `evt_${crypto.randomUUID()}`;

    const first = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
      eventId,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.settled).toBe(true);

    const order = await query(`SELECT status, paid_at, payment_reference FROM orders WHERE id = $1`, [
      fixture.orderId,
    ]);
    const orderRow = order.rows[0] as { status: string; paid_at: string | null; payment_reference: string | null };
    expect(orderRow.status).toBe("paid");
    expect(orderRow.paid_at).not.toBeNull();
    expect(orderRow.payment_reference).toBeTruthy();

    const payment = await query(`SELECT status, paid_at FROM payments WHERE id = $1`, [fixture.paymentId]);
    expect((payment.rows[0] as { status: string }).status).toBe("paid");

    expect(await stockRow(fixture.productId)).toEqual({ quantity: 4, reserved: 0 });

    const audit = await query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [fixture.paymentId]);
    expect((audit.rows as Array<{ action: string }>).map((r) => r.action)).toContain("PAYMENT_SETTLED");

    // Same event delivered again: acknowledged as a duplicate, no second commit.
    const duplicate = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
      eventId,
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.duplicate).toBe(true);
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 4, reserved: 0 });

    // A DIFFERENT event for the same session must also not double-commit.
    const secondEvent = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
    });
    expect(secondEvent.status).toBe(200);
    expect(secondEvent.body.data.reason).toBe("ALREADY_SETTLED");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 4, reserved: 0 });
  });

  itDb("refuses a webhook whose amount does not match the order", async () => {
    const fixture = await pendingPayment();
    const res = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor - 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.settled).toBe(false);
    expect(res.body.data.reason).toBe("AMOUNT_MISMATCH");

    const order = await query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect((order.rows[0] as { status: string }).status).toBe("pending_payment");

    const payment = await query(`SELECT status FROM payments WHERE id = $1`, [fixture.paymentId]);
    expect((payment.rows[0] as { status: string }).status).toBe("requires_action");

    const event = await query(
      `SELECT status, error FROM payment_events ORDER BY created_at DESC LIMIT 1`,
    );
    expect((event.rows[0] as { status: string }).status).toBe("failed");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("refuses a webhook whose currency does not match the order", async () => {
    const fixture = await pendingPayment();
    const res = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
      currency: "usd",
    });
    expect(res.body.data.reason).toBe("AMOUNT_MISMATCH");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("acknowledges a session that maps to no payment at all, marking nothing paid", async () => {
    const { default: Stripe } = await import("stripe");
    const fixture = await pendingPayment();
    const payload = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_unknown_session",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: fixture.totalMinor,
          currency: "thb",
          metadata: {},
        },
      },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: FAKE_WEBHOOK_SECRET,
    });
    const res = await fetch(`${app.base}/api/mvp/payments/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.data.reason).toBe("PAYMENT_NOT_FOUND");

    const order = await query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect((order.rows[0] as { status: string }).status).toBe("pending_payment");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("marks a failed async payment as failed but leaves the order payable", async () => {
    const fixture = await pendingPayment();
    const { default: Stripe } = await import("stripe");
    const payload = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.async_payment_failed",
      data: { object: { id: fixture.sessionId, object: "checkout.session", payment_status: "unpaid" } },
    });
    const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
      payload,
      secret: FAKE_WEBHOOK_SECRET,
    });
    const res = await fetch(`${app.base}/api/mvp/payments/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);

    const payment = await query(`SELECT status FROM payments WHERE id = $1`, [fixture.paymentId]);
    expect((payment.rows[0] as { status: string }).status).toBe("failed");
    const order = await query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect((order.rows[0] as { status: string }).status).toBe("pending_payment");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("a late payment on a cancelled order is recorded but never re-opens the order", async () => {
    const fixture = await pendingPayment();
    const cancel = await api(app.base, `/api/mvp/orders/${fixture.orderId}/cancel`, {
      method: "POST",
      cookie: fixture.buyerCookie,
    });
    expect(cancel.status).toBe(200);
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 0 });

    const res = await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.reason).toBe("ORDER_CANCELLED");

    const order = await query(`SELECT status FROM orders WHERE id = $1`, [fixture.orderId]);
    expect((order.rows[0] as { status: string }).status).toBe("cancelled");
    expect(await stockRow(fixture.productId)).toEqual({ quantity: 5, reserved: 0 });
  });

  itDb("a paid order cannot be cancelled by the buyer (no refund flow exists)", async () => {
    const fixture = await pendingPayment();
    await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
    });

    const res = await api(app.base, `/api/mvp/orders/${fixture.orderId}/cancel`, {
      method: "POST",
      cookie: fixture.buyerCookie,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ORDER_NOT_CANCELLABLE");
  });

  itDb("the payment-status endpoint only reports what the server knows", async () => {
    const fixture = await pendingPayment();
    const before = await api(app.base, `/api/mvp/orders/${fixture.orderId}/payment-status`, {
      cookie: fixture.buyerCookie,
    });
    expect(before.status).toBe(200);
    expect(before.body.data.settled).toBe(false);

    await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
    });

    const after = await api(app.base, `/api/mvp/orders/${fixture.orderId}/payment-status`, {
      cookie: fixture.buyerCookie,
    });
    expect(after.body.data.settled).toBe(true);
    expect(after.body.data.paymentStatus).toBe("paid");
  });

  itDb("fulfilment: paid → processing → shipped (shipment row) → delivered", async () => {
    const fixture = await pendingPayment();
    await deliverPaidWebhook(app.base, {
      orderId: fixture.orderId,
      paymentId: fixture.paymentId,
      sessionId: fixture.sessionId,
      amountTotal: fixture.totalMinor,
    });

    const jump = await api(app.base, `/api/mvp/seller/orders/${fixture.orderId}/status`, {
      method: "PATCH",
      cookie: fixture.sellerCookie,
      body: { status: "delivered" },
    });
    expect(jump.status).toBe(409);

    const processing = await api(app.base, `/api/mvp/seller/orders/${fixture.orderId}/status`, {
      method: "PATCH",
      cookie: fixture.sellerCookie,
      body: { status: "processing" },
    });
    expect(processing.status).toBe(200);

    const shipped = await api(app.base, `/api/mvp/seller/orders/${fixture.orderId}/status`, {
      method: "PATCH",
      cookie: fixture.sellerCookie,
      body: { status: "shipped", carrier: "Kerry", trackingNumber: "KRY123" },
    });
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.order.shipped_at).not.toBeNull();

    const delivered = await api(app.base, `/api/mvp/seller/orders/${fixture.orderId}/status`, {
      method: "PATCH",
      cookie: fixture.sellerCookie,
      body: { status: "delivered" },
    });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.order.delivered_at).not.toBeNull();

    const shipment = await query(
      `SELECT carrier, tracking_number, shipped_at, delivered_at FROM shipments WHERE order_id = $1`,
      [fixture.orderId],
    );
    const row = shipment.rows[0] as {
      carrier: string;
      tracking_number: string;
      shipped_at: string | null;
      delivered_at: string | null;
    };
    expect(row.carrier).toBe("Kerry");
    expect(row.tracking_number).toBe("KRY123");
    expect(row.delivered_at).not.toBeNull();
  });

  itDb("a seller cannot set 'cancelled' or 'paid' (not a seller action)", async () => {
    const fixture = await pendingPayment();
    for (const status of ["cancelled", "paid", "pending_payment"]) {
      const res = await api(app.base, `/api/mvp/seller/orders/${fixture.orderId}/status`, {
        method: "PATCH",
        cookie: fixture.sellerCookie,
        body: { status },
      });
      expect(res.status).toBe(400);
    }
  });

  itDb("payment-session: 404 for a foreign order and 503 when Stripe is not configured", async () => {
    const fixture = await pendingPayment();
    const intruder = await (await import("./helpers/mvp-app.js")).createUser();
    const foreign = await api(app.base, `/api/mvp/orders/${fixture.orderId}/payment-session`, {
      method: "POST",
      cookie: intruder.cookie,
      body: { method: "CARD" },
    });
    expect(foreign.status).toBe(404);

    const secret = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const res = await api(app.base, `/api/mvp/orders/${fixture.orderId}/payment-session`, {
        method: "POST",
        cookie: fixture.buyerCookie,
        body: { method: "CARD" },
      });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("STRIPE_NOT_CONFIGURED");

      const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE order_id = $1`, [
        fixture.orderId,
      ]);
      expect((payments.rows[0] as { n: number }).n).toBe(1); // only the fixture row
    } finally {
      process.env.STRIPE_SECRET_KEY = secret;
    }
  });
});
