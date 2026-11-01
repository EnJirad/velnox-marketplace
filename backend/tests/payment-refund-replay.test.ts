/**
 * REFUND + DUPLICATE WEBHOOK REPLAY (2026-11-02).
 *
 * The audit left these paths unproven: nothing drove the REAL webhook twice with
 * the SAME event id, and nothing exercised `charge.refunded` end to end. This
 * file closes that gap against the REAL routes and a disposable PostgreSQL
 * (`TEST_DATABASE_URL`) — never production Neon, never a live Stripe call.
 *
 * What it pins:
 *   • the same signed event delivered twice is stored ONCE (`payment_events.event_id`
 *     is UNIQUE) and applied once (paid_at stays the value the first delivery wrote);
 *   • a refund event syncs a refund row once, keeps the payment `paid` and does not
 *     downgrade the order;
 *   • a forged signature is refused with 400 and writes nothing.
 *
 * Signatures are produced locally with the same HMAC scheme Stripe uses, so
 * `constructEventAsync` verifies them for real — no bypass.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const WEBHOOK_SECRET = "whsec_test_refund_replay_only";
const testFn = hasTestDatabase() ? test : test.skip;

function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

describe("refund + duplicate webhook replay (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: string[] = [];

  beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = "[redacted]";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterAll(async () => {
    await purgeUsers(fixtureUsers);
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(stripeWebhookRawBody);
    app.use(express.json());
    app.use(cookieParser());
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

  async function postEvent(event: Record<string, unknown>, opts?: { secret?: string }) {
    const payload = JSON.stringify(event);
    const header = stripeSignature(payload, opts?.secret ?? WEBHOOK_SECRET);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": header },
        body: payload,
      });
      return res.status;
    });
  }

  /** One buyer, one approved seller/shop, one order and one PAID stripe payment. */
  async function seedPaidOrder() {
    const { query } = await import("../db/index.js");
    const tag = `replay-${randomUUID().slice(0, 8)}`;

    const buyer = await query(`INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id`, [
      `${tag}-buyer@test.local`,
      "Replay Buyer",
    ]);
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1,$2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Replay Seller",
    ]);
    fixtureUsers.push(buyer.rows[0].id, sellerUser.rows[0].id);

    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1,'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, order_state, fulfillment_status, total_amount, currency, inventory_released)
       VALUES ($1,$2,$3,'paid','pending','unfulfilled',360.00,'THB',TRUE) RETURNING id`,
      [buyer.rows[0].id, shop.rows[0].id, `RP-${tag.slice(-10)}`],
    );
    const orderId = order.rows[0].id as string;
    const intentId = `pi_${tag}`;
    const payment = await query(
      `INSERT INTO payments (order_id, provider, method, status, amount, currency, provider_payment_id, provider_checkout_session_id, paid_at)
       VALUES ($1,'stripe','CARD','paid',360.00,'THB',$2,$3,NOW()) RETURNING id, paid_at`,
      [orderId, intentId, `cs_test_${tag}`],
    );
    return {
      orderId,
      intentId,
      paymentId: payment.rows[0].id as string,
      paidAt: new Date(payment.rows[0].paid_at as string).toISOString(),
    };
  }

  // ── 1. duplicate delivery of payment_intent.succeeded ─────────────────────

  testFn("the same succeeded event delivered twice is stored once and stays paid", async () => {
    const { query } = await import("../db/index.js");
    const { orderId, intentId, paymentId, paidAt } = await seedPaidOrder();
    const eventId = `evt_${randomUUID()}`;
    const event = {
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
    };

    expect(await postEvent(event)).toBe(200);
    expect(await postEvent(event)).toBe(200);

    const stored = await query(`SELECT COUNT(*)::int AS n FROM payment_events WHERE event_id = $1`, [eventId]);
    expect(stored.rows[0].n, "one event row per event id").toBe(1);

    const pay = await query(`SELECT status, paid_at FROM payments WHERE id = $1`, [paymentId]);
    expect(pay.rows[0].status).toBe("paid");
    expect(new Date(pay.rows[0].paid_at).toISOString(), "paid_at never moves").toBe(paidAt);

    const ord = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(ord.rows[0].status).toBe("paid");
  });

  // ── 2. duplicate delivery of charge.refunded ──────────────────────────────

  testFn("the same refund event delivered twice records one refund and keeps the order paid", async () => {
    const { query } = await import("../db/index.js");
    const { orderId, intentId, paymentId } = await seedPaidOrder();
    const eventId = `evt_${randomUUID()}`;
    const refundId = `re_${randomUUID().slice(0, 10)}`;
    const chargeId = `ch_${randomUUID().slice(0, 10)}`;
    const event = {
      id: eventId,
      object: "event",
      type: "charge.refunded",
      data: {
        object: {
          id: chargeId,
          object: "charge",
          amount: 36000,
          amount_refunded: 36000,
          currency: "thb",
          payment_intent: intentId,
          metadata: { orderId },
          refunds: {
            object: "list",
            data: [
              {
                id: refundId,
                object: "refund",
                amount: 36000,
                currency: "thb",
                status: "succeeded",
                payment_intent: intentId,
                charge: chargeId,
              },
            ],
          },
        },
      },
    };

    expect(await postEvent(event)).toBe(200);
    const afterFirst = await query(
      `SELECT status, refunded_amount, refund_status FROM payments WHERE id = $1`,
      [paymentId],
    );
    expect(afterFirst.rows[0].status, "a refund never un-pays the payment").toBe("paid");

    expect(await postEvent(event)).toBe(200);

    const events = await query(`SELECT COUNT(*)::int AS n FROM payment_events WHERE event_id = $1`, [eventId]);
    expect(events.rows[0].n).toBe(1);

    const refunds = await query(
      `SELECT COUNT(*)::int AS n FROM refunds WHERE provider_refund_id = $1`,
      [refundId],
    );
    expect(refunds.rows[0].n, "one refund row per provider refund").toBe(1);

    const ord = await query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    expect(["paid", "refunded", "completed"]).toContain(ord.rows[0].status as string);
    expect(ord.rows[0].status, "a refund must not resurrect or cancel the order").not.toBe("pending_payment");
  });

  // ── 3. forged signature ───────────────────────────────────────────────────

  testFn("an invalid signature is rejected with 400 and writes nothing", async () => {
    const { query } = await import("../db/index.js");
    const { intentId, orderId } = await seedPaidOrder();
    const eventId = `evt_${randomUUID()}`;
    const event = {
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
    };

    expect(await postEvent(event, { secret: "whsec_wrong_secret_for_this_test" })).toBe(400);

    const stored = await query(`SELECT COUNT(*)::int AS n FROM payment_events WHERE event_id = $1`, [eventId]);
    expect(stored.rows[0].n).toBe(0);
  });
});
