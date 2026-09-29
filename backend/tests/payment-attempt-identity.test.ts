/**
 * Payment ATTEMPT identity — a failure or a success is the state of ONE
 * attempt, not of "the newest `payments` row that happens to belong to the
 * order".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Audit HIGH #4 said: `"payment_failed"` is handled at the ORDER level while a
 * payment failure is a property of a payment ATTEMPT. Read from source, the
 * order-level half of that is already correct AND deliberate, and this file
 * deliberately does not change it:
 *
 *   • `markPaymentFailed` guards the order with
 *     `WHERE … status IN ('pending','pending_payment')`, so a failure can never
 *     overwrite a `paid` / `cancelled` / `expired` order, and
 *   • `POST /api/stripe/checkout` refuses anything outside
 *     `PAYABLE_ORDER_STATUSES` (`pending` | `pending_payment`), so a
 *     `payment_failed` order is terminal for payment and the documented answer
 *     is "buy again" (a new order) — see `.ai/context/payment.md`.
 *
 * The real defect is one level down. Every write to `payments` in
 * `routes/stripe.ts` picks its row with a NEWEST-ROW HEURISTIC:
 *
 *     WHERE id = (SELECT id FROM payments
 *                  WHERE order_id = $1 AND provider = 'stripe'
 *                    AND status <> 'paid'          -- or <> 'failed'
 *                  ORDER BY created_at DESC LIMIT 1)
 *
 * The Stripe event already names the attempt it is about — `paymentIntent.id`
 * and `session.id` are both in hand, and `payments` stores both
 * (`provider_payment_id`, `provider_checkout_session_id`) — but the identity is
 * discarded and replaced by "whatever row is newest".
 *
 * Multiple rows per order are NORMAL here, not a corruption: the checkout route
 * itself retires one attempt and opens another on the same order whenever the
 * customer re-opens checkout or switches rail
 * (`SESSION_NOT_REUSABLE`, `routes/stripe.ts`). So a LATE event about a dead
 * attempt is routine, and it currently lands on the LIVE one:
 *
 *   attempt A (failed / abandoned)  →  attempt B (requires_action, open)
 *   late `payment_intent.payment_failed` for A
 *     → marks B failed, flips the ORDER to `payment_failed`, releases the stock
 *     → the customer, sitting on an open session for B, loses the order AND the
 *       units go back on the shelf.
 *
 *   late `payment_intent.succeeded` for A
 *     → marks B `paid` and stamps A's PaymentIntent id onto B
 *     → the attempt that was actually charged stays `failed` and the attempt
 *       that was never charged reads `paid`, which is the record a refund is
 *       built from.
 *
 * Both are Invariant F: an event about attempt A must not change attempt B.
 *
 * WHAT IS FIXED HERE — the row is resolved BY the attempt identifier the event
 * carries, and the same status guards move onto the outer UPDATE so the
 * resolved row can never be overwritten out of terminal state. The newest-row
 * heuristic survives ONLY as the fallback for an event that carries no usable
 * identifier (legacy rows, rows written without one), so nothing that works
 * today changes behaviour.
 *
 * Structure mirrors the sibling suites: a DB-free contract block that runs in
 * any workspace, and a DB-gated block that drives the REAL webhook route with
 * locally signed Stripe events against `TEST_DATABASE_URL`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import { join } from "path";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const STRIPE_ROUTE = "backend/routes/stripe.ts";

/**
 * The body of one top-level declaration, from its opening text to the next one
 * — enough to assert something about ONE function without parsing TypeScript.
 */
function bodyOf(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing declaration: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + startMarker.length);
  const next = rest.search(/\n(export )?(async )?function |\napp\.(get|post|patch|put|delete)\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** The three writers that move a payment row from a Stripe event. */
const ATTEMPT_SCOPED_WRITERS = [
  "async function markPaymentSucceeded(",
  "async function markPaymentFailed(",
  "async function markPaymentCanceled(",
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// 1. The attempt-identity contract (structural — runs anywhere)
// ═══════════════════════════════════════════════════════════════════════════

describe("a payment row is chosen by the ATTEMPT the event names", () => {
  test("no writer picks its row with the newest-row heuristic", () => {
    const stripe = read(STRIPE_ROUTE);
    for (const marker of ATTEMPT_SCOPED_WRITERS) {
      const body = bodyOf(stripe, marker);
      expect(
        body,
        `${marker} still chooses the payment row with "ORDER BY created_at DESC LIMIT 1" — ` +
          `a late event about a dead attempt would land on the live one`,
      ).not.toContain("ORDER BY created_at DESC LIMIT 1");
    }
  });

  test("each writer resolves the row through the ONE attempt resolver", () => {
    const stripe = read(STRIPE_ROUTE);
    expect(stripe).toContain("async function resolvePaymentAttemptRow(");
    // Exactly one definition — a second copy would be a second source of truth.
    expect((stripe.match(/async function resolvePaymentAttemptRow\(/g) ?? []).length).toBe(1);
    for (const marker of ATTEMPT_SCOPED_WRITERS) {
      expect(bodyOf(stripe, marker), `${marker} never resolves an attempt`).toContain(
        "resolvePaymentAttemptRow(",
      );
    }
  });

  test("the resolver matches on the identifiers Stripe actually sends", () => {
    const stripe = read(STRIPE_ROUTE);
    const body = bodyOf(stripe, "async function resolvePaymentAttemptRow(");
    // provider_payment_id = the PaymentIntent id; provider_checkout_session_id
    // = the Checkout Session id. An event about attempt A must therefore never
    // be able to select attempt B's row while B is still open.
    expect(body).toContain("provider_payment_id");
    expect(body).toContain("provider_checkout_session_id");
    // Still scoped to the order, and still Stripe-only.
    expect(body).toContain("order_id = $1");
    expect(body).toContain("provider = 'stripe'");
  });

  test("every event passes the attempt it carries into the writer", () => {
    const stripe = read(STRIPE_ROUTE);
    // The PaymentIntent events hand over `paymentIntent.id`; the session events
    // hand over `session.id` (and the intent when the session carries one).
    // Whitespace-tolerant on purpose: pinning the exact line break would make
    // this test fail on a harmless reformat instead of on a lost identity.
    for (const writer of ["markPaymentSucceeded", "markPaymentFailed", "markPaymentCanceled"]) {
      expect(
        stripe,
        `${writer} is never called with a bare orderId — the attempt would be lost`,
      ).toMatch(
        new RegExp(`${writer}\\(\\s*orderId,\\s*\\{[^}]*providerPaymentId:\\s*paymentIntent\\.id`),
      );
    }
    expect(stripe).toContain("checkoutSessionId: session.id");
  });

  test("the order-level guards are UNCHANGED — a failure still cannot touch a settled order", () => {
    const stripe = read(STRIPE_ROUTE);
    // The order-level half of HIGH #4 is already right and must stay right:
    // payment_failed is terminal for payment, and the customer re-orders.
    expect(bodyOf(stripe, "async function markPaymentFailed(")).toContain(
      "status IN ('pending', 'pending_payment')",
    );
    expect(bodyOf(stripe, "async function markPaymentCanceled(")).toContain(
      "status IN ('pending_payment', 'pending')",
    );
    expect(bodyOf(stripe, "async function markPaymentSucceeded(")).toContain("inventory_released = FALSE");
    // The route still refuses a non-payable order outright.
    expect(stripe).toContain(`if (!["pending", "pending_payment"].includes(order.status))`);
  });

  test("the terminal status guards moved onto the outer UPDATE of the resolved row", () => {
    const stripe = read(STRIPE_ROUTE);
    // Resolving the right row is not enough on its own: a DUPLICATE or LATE
    // event for the same attempt must still be refused out of a terminal state.
    expect(bodyOf(stripe, "async function markPaymentSucceeded(")).toMatch(
      /UPDATE payments[\s\S]{0,400}?AND status <> 'failed'/,
    );
    // The failure/cancel writers are stricter still: the row must still be OPEN
    // for the event to be a transition of that attempt, so a duplicate delivery
    // cannot re-assert a failure it already recorded.
    for (const marker of ["async function markPaymentFailed(", "async function markPaymentCanceled("]) {
      expect(bodyOf(stripe, marker), `${marker} does not require an OPEN attempt row`).toMatch(
        /UPDATE payments[\s\S]{0,400}?AND status NOT IN \('paid', 'failed', 'cancelled'\)/,
      );
    }
  });

  test("the ORDER only moves when THIS attempt actually transitioned", () => {
    const stripe = read(STRIPE_ROUTE);
    // The order-level half of HIGH #4: a late failure for a dead attempt must
    // not flip a live order to `payment_failed` (and release its stock) just
    // because "a failure happened for this order". The order claim is gated on
    // the attempt row's own transition, and returns early when there was none.
    for (const [marker, earlyReturn] of [
      ["async function markPaymentFailed(", "attemptFailed"],
      ["async function markPaymentCanceled(", "attemptCanceled"],
    ] as const) {
      const body = bodyOf(stripe, marker);
      expect(body, `${marker} never records the attempt transition`).toContain(earlyReturn);
      // The guard must be read from the UPDATE's rowCount, not inferred.
      expect(body).toMatch(new RegExp(`rowCount \\?\\? 0\\) > 0`));
      // …and the order claim must come AFTER it, guarded by an early return.
      const guardAt = body.indexOf(`if (!${earlyReturn})`);
      const claimAt = body.indexOf("UPDATE orders SET status =");
      expect(guardAt, `${marker} has no early return for an unattributable failure`).toBeGreaterThan(0);
      expect(claimAt).toBeGreaterThan(guardAt);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Database-gated: the real webhook, the real attempts
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("payment attempt identity (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
  ] as const;
  const WEBHOOK_SECRET = "whsec_000000000000000000000000";

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

  interface SeedOptions {
    status?: string;
    /** `pending` (needs `providerPaymentId`) = an abandoned attempt. */
    attempts: Array<{
      method: string;
      status: string;
      providerPaymentId: string;
      checkoutSessionId: string;
      failureCode?: string;
    }>;
    quantity?: number;
  }

  /**
   * Seed owner → seller → shop → product → inventory → order (+ item), then
   * the payment attempts in the order they were created. Stock is seeded the
   * way checkout reserves it (`inventory.reserved += qty`), so a settlement is
   * visible as `quantity -q` / `reserved -q` / `sold_count +q`, and a release as
   * `reserved -q` with `quantity` unchanged.
   */
  async function seedOrder(opts: SeedOptions) {
    const { query } = await import("../db/index.js");
    const quantity = opts.quantity ?? 3;
    const tag = `att-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Attempt Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Attempt Seller",
    ]);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, 120.00, 'published', 0) RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, $2)`, [
      productId,
      quantity,
    ]);

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, inventory_released)
       VALUES ($1, $2, $3, $4, 360.00, 'THB', FALSE) RETURNING id`,
      [ownerId, shop.rows[0].id, `AT-${tag.slice(-12)}`, opts.status ?? "pending_payment"],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shop.rows[0].id, `${tag} product`, quantity, quantity * 120],
    );

    for (const attempt of opts.attempts) {
      await query(
        `INSERT INTO payments
           (order_id, provider, method, status, amount, currency,
            provider_checkout_session_id, provider_payment_id, failure_code)
         VALUES ($1, 'stripe', $2, $3, 360.00, 'THB', $4, $5, $6)`,
        [orderId, attempt.method, attempt.status, attempt.checkoutSessionId, attempt.providerPaymentId, attempt.failureCode ?? null],
      );
    }
    return { orderId, ownerId, productId, quantity };
  }

  /** Everything a settlement, a failure or an expiry can change. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [orderId])
    ).rows[0];
    const inventory = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    const product = (await query(`SELECT sold_count FROM products WHERE id = $1`, [productId])).rows[0];
    const payments = (
      await query(
        `SELECT provider_payment_id, status, failure_code
           FROM payments WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
        [orderId],
      )
    ).rows as Array<{ provider_payment_id: string; status: string; failure_code: string | null }>;
    return {
      orderStatus: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      quantity: Number(inventory.quantity),
      reserved: Number(inventory.reserved),
      soldCount: Number(product.sold_count),
      /** Keyed by PaymentIntent id so an assertion can name the ATTEMPT. */
      payments: Object.fromEntries(payments.map((p) => [p.provider_payment_id, p.status])),
      failureCodes: Object.fromEntries(payments.map((p) => [p.provider_payment_id, p.failure_code])),
    };
  }

  /** Deliver a locally signed Stripe event to the real webhook route. */
  async function deliverWebhook(event: Record<string, unknown>): Promise<number> {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const payload = JSON.stringify(event);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET),
        },
        body: payload,
      });
      return res.status;
    });
  }

  const succeededEvent = (orderId: string, intentId: string) => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
  });

  const failedEvent = (orderId: string, intentId: string, code = "card_declined") => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: intentId,
        object: "payment_intent",
        metadata: { orderId },
        last_payment_error: { code, message: "The card was declined." },
      },
    },
  });

  /** A dead attempt (the method-switch shape) plus a live one, as checkout leaves it. */
  function twoAttempts(tag: string) {
    return {
      status: "pending_payment",
      attempts: [
        {
          method: "CARD",
          status: "failed",
          providerPaymentId: `pi_${tag}_A`,
          checkoutSessionId: `cs_${tag}_A`,
          failureCode: "SESSION_NOT_REUSABLE",
        },
        {
          method: "PROMPTPAY",
          status: "requires_action",
          providerPaymentId: `pi_${tag}_B`,
          checkoutSessionId: `cs_${tag}_B`,
        },
      ],
    } as const;
  }

  // ── Invariant F: a LATE event about a dead attempt must not touch the live one ──

  testFn("a late FAILURE for a dead attempt leaves the live attempt and the order alone", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder(twoAttempts(tag));
    try {
      expect(await deliverWebhook(failedEvent(orderId, `pi_${tag}_A`))).toBe(200);

      const state = await stateOf(orderId, productId);
      // Attempt A was already terminal; the event changes nothing on it.
      expect(state.payments[`pi_${tag}_A`]).toBe("failed");
      // Attempt B is the customer's OPEN session — it must still be payable.
      expect(state.payments[`pi_${tag}_B`]).toBe("requires_action");
      // The order is still inside its payment window.
      expect(state.orderStatus).toBe("pending_payment");
      // …and the stock is still held for it.
      expect(state.inventoryReleased).toBe(false);
      expect(state.reserved).toBe(quantity);
      expect(state.quantity).toBe(50);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("a late SUCCESS for a dead attempt settles the ORDER without rewriting the attempt's history", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder(twoAttempts(tag));
    try {
      expect(await deliverWebhook(succeededEvent(orderId, `pi_${tag}_A`))).toBe(200);

      const state = await stateOf(orderId, productId);
      // Invariant A: an attempt already recorded as `failed` is NEVER rewritten
      // to `paid` by a later event. History is not mutable through a webhook.
      expect(state.payments[`pi_${tag}_A`]).toBe("failed");
      // …and the live attempt is not touched either — this event was not about it.
      expect(state.payments[`pi_${tag}_B`]).toBe("requires_action");
      // The ORDER still settles (the existing policy: captured money settles the
      // order), and the stock is consumed exactly once.
      expect(state.orderStatus).toBe("paid");
      expect(state.inventoryReleased).toBe(false);
      expect(state.quantity).toBe(50 - quantity);
      expect(state.reserved).toBe(0);
      expect(state.soldCount).toBe(quantity);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  // ── Invariant E: a duplicate event is still exactly one transition ──

  testFn("a duplicate SUCCESS settles once — never a second inventory transition", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder({
      status: "pending_payment",
      attempts: [
        {
          method: "CARD",
          status: "requires_action",
          providerPaymentId: `pi_${tag}_A`,
          checkoutSessionId: `cs_${tag}_A`,
        },
      ],
    });
    try {
      const event = succeededEvent(orderId, `pi_${tag}_A`);
      expect(await deliverWebhook(event)).toBe(200);
      expect(await deliverWebhook({ ...event, id: `evt_${crypto.randomUUID()}` })).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("paid");
      expect(state.payments[`pi_${tag}_A`]).toBe("paid");
      // quantity -N exactly once, sold_count +N exactly once.
      expect(state.quantity).toBe(50 - quantity);
      expect(state.reserved).toBe(0);
      expect(state.soldCount).toBe(quantity);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("a duplicate FAILURE releases once — never a second restoration", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder({
      status: "pending_payment",
      attempts: [
        {
          method: "CARD",
          status: "requires_action",
          providerPaymentId: `pi_${tag}_A`,
          checkoutSessionId: `cs_${tag}_A`,
        },
      ],
    });
    try {
      expect(await deliverWebhook(failedEvent(orderId, `pi_${tag}_A`))).toBe(200);
      expect(
        await deliverWebhook(failedEvent(orderId, `pi_${tag}_A`, "expired_card")),
      ).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("payment_failed");
      expect(state.payments[`pi_${tag}_A`]).toBe("failed");
      expect(state.inventoryReleased).toBe(true);
      // Released once: reserved back to 0, quantity untouched, nothing sold.
      expect(state.reserved).toBe(0);
      expect(state.quantity).toBe(50);
      expect(state.soldCount).toBe(0);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  // ── Invariant F at the ORDER level: a late failure never un-settles a paid order ──

  testFn("a late FAILURE after a SUCCESS does not move a paid order back to payment_failed", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    // TWO live attempts are not a legal state: `idx_payments_one_active_stripe`
    // allows at most one row in ('pending','requires_action') per order. The
    // real shape is one ACTIVE attempt plus one RETIRED (`failed`) one — which
    // is exactly what checkout leaves behind after a method switch.
    const { orderId, ownerId, productId, quantity } = await seedOrder({
      status: "pending_payment",
      attempts: [
        {
          method: "CARD",
          status: "requires_action",
          providerPaymentId: `pi_${tag}_A`,
          checkoutSessionId: `cs_${tag}_A`,
        },
        {
          method: "PROMPTPAY",
          status: "failed",
          providerPaymentId: `pi_${tag}_B`,
          checkoutSessionId: `cs_${tag}_B`,
          failureCode: "SESSION_NOT_REUSABLE",
        },
      ],
    });
    try {
      expect(await deliverWebhook(succeededEvent(orderId, `pi_${tag}_A`))).toBe(200);
      // A failure for the OTHER attempt, arriving after the money settled.
      expect(await deliverWebhook(failedEvent(orderId, `pi_${tag}_B`))).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("paid");
      expect(state.payments[`pi_${tag}_A`]).toBe("paid");
      expect(state.payments[`pi_${tag}_B`]).toBe("failed");
      // Committed stock is never handed back by a status change.
      expect(state.inventoryReleased).toBe(false);
      expect(state.quantity).toBe(50 - quantity);
      expect(state.reserved).toBe(0);
      expect(state.soldCount).toBe(quantity);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  // ── The legacy fallback: an event with no usable identifier still works ──

  testFn("an attempt row written WITHOUT a PaymentIntent id still settles on a bare success", async () => {
    const { query } = await import("../db/index.js");
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder({
      status: "pending_payment",
      attempts: [
        {
          method: "CARD",
          status: "requires_action",
          providerPaymentId: "",
          checkoutSessionId: "",
        },
      ],
    });
    // Give the row a NULL id the way an older/other writer would.
    await query(`UPDATE payments SET provider_payment_id = NULL WHERE order_id = $1`, [orderId]);
    try {
      // An event whose id matches nothing stored must fall back, not dead-letter.
      expect(await deliverWebhook(succeededEvent(orderId, `pi_${tag}_unknown`))).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("paid");
      expect(state.quantity).toBe(50 - quantity);
      expect(state.soldCount).toBe(quantity);
    } finally {
      await purgeUsers([ownerId]);
    }
  });
});

