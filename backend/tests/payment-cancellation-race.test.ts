/**
 * Payment ↔ customer cancellation race hardening.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * A customer cancellation and a Stripe settlement/failure/expiry webhook can
 * arrive for the same order at the same moment. Two things must hold:
 *
 *   1. NOTHING CONTRADICTORY IS REACHABLE. Exactly one writer moves the order.
 *      The pair {order = cancelled, stock committed} and the pair
 *      {order = paid, stock released} must both be impossible, and a settlement
 *      that arrives after a cancellation must never resurrect the order, never
 *      re-reserve stock and never release it twice — while the money is still
 *      RECORDED (a `paid` payment row is what makes it refundable).
 *
 *   2. NEITHER SIDE DEADLOCKS. The guarded `UPDATE orders … WHERE status = ANY(…)`
 *      claims already made the winner deterministic under READ COMMITTED. What
 *      was missing was a shared LOCK ORDER: the cancellation invalidated
 *      `payments` after moving `orders` (orders → payments) while the
 *      failure/expiry webhook handlers updated `payments` FIRST and `orders`
 *      second (payments → orders). Two transactions taking the same two rows in
 *      opposite orders is an AB-BA deadlock that PostgreSQL breaks after
 *      `deadlock_timeout` by aborting one side — a 500 on the customer's cancel,
 *      or a `failed` event Stripe has to redeliver. `lib/order-lock.ts` now
 *      defines the ONE order: the order row is locked first, by every writer.
 *
 * The lock-order half is pinned twice: structurally (the lock must precede the
 * first `payments`/`refunds` write inside each transaction) and at runtime (both
 * requests must demonstrably WAIT on the order row — which is only possible if
 * neither is holding a `payments` lock while it waits).
 *
 * The DB-gated cases run against `TEST_DATABASE_URL` and skip when it is not
 * configured, exactly like the rest of this suite. No real Stripe call is made:
 * webhook cases sign a payload locally with Stripe's own scheme.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import jwt from "jsonwebtoken";
import { join } from "path";

import { expirePaymentReservation } from "../jobs/payment-reservation-scheduler.js";
import {
  PAYMENT_SETTLED_STATUSES,
  paymentBlocksCancellation,
} from "../lib/order-lock.js";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const SWEEP_JOB = "backend/jobs/payment-reservation-scheduler.ts";
const ORDER_LOCK_LIB = "backend/lib/order-lock.ts";

/**
 * The body of one top-level declaration, sliced from its opening text to the
 * next declaration — enough to assert an ORDERING inside a single function
 * without parsing TypeScript.
 */
function bodyOf(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing declaration: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + startMarker.length);
  const next = rest.search(/\n(export )?(async )?function |\napp\.(get|post|patch|put|delete)\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The `withTransaction(async (client) => { … })` block of a body, from its
 * opening to the end of the declaration.
 *
 * The lock order is a contract about ONE transaction: a statement that runs
 * outside it (e.g. the single-row `refunds` write syncRefundFromStripe does
 * before it opens its transaction) holds no order/payment lock and therefore
 * cannot take part in an order↔payments cycle. Only the transaction's own
 * statement order can.
 */
/** Index of the first fragment, or Infinity when it is absent. */
function firstIndexOf(source: string, ...needles: string[]): number {
  const found = needles.map((n) => source.indexOf(n)).filter((i) => i >= 0);
  return found.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...found);
}

function transactionOf(body: string, marker: string): string {
  const start = body.indexOf("withTransaction(async (client) => {");
  expect(start, `${marker} opens no transaction`).toBeGreaterThanOrEqual(0);
  return body.slice(start);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The lock-order contract (structural — no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("order-row concurrency — one lock, one order", () => {
  test("the money-outranks-cancellation rule lives in one place", () => {
    expect([...PAYMENT_SETTLED_STATUSES]).toEqual(["paid", "processing"]);
    expect(paymentBlocksCancellation("paid")).toBe(true);
    expect(paymentBlocksCancellation("processing")).toBe(true);
    // Everything that leaves the order cancelable.
    expect(paymentBlocksCancellation("pending")).toBe(false);
    expect(paymentBlocksCancellation("requires_action")).toBe(false);
    expect(paymentBlocksCancellation("failed")).toBe(false);
    expect(paymentBlocksCancellation("cancelled")).toBe(false);
    expect(paymentBlocksCancellation(null)).toBe(false);
    expect(paymentBlocksCancellation(undefined)).toBe(false);
    expect(paymentBlocksCancellation({ status: "paid" })).toBe(false);
  });

  test("the lock is defined once, and its module states the rule", () => {
    const lib = read(ORDER_LOCK_LIB);
    expect(lib).toContain("export async function lockOrderRow(");
    // The multi-shop twin: one purchase, N per-shop orders, so the same rule is
    // stated once more for the whole group — locks together, in a stable order.
    expect(lib).toContain("export async function lockCheckoutGroupOrderRows(");
    // Both shapes really lock: `FOR UPDATE` is what makes the order row the
    // serialisation point, so a plain SELECT would silently remove the
    // guarantee for the whole module.
    expect(lib).toContain("FOR UPDATE");
    // The group lock takes EVERY member row, in a stable order — a stable order
    // is what stops two concurrent deliveries of the same event deadlocking
    // against each other (A->B here, B->A there).
    expect(lib).toMatch(
      /lockCheckoutGroupOrderRows[\s\S]{0,600}?WHERE checkout_group_id = \$1[\s\S]{0,200}?ORDER BY id ASC[\s\S]{0,200}?FOR UPDATE/,
    );
    // The rule is a comment-as-contract: a future editor who reorders the two
    // statements must be told why it matters.
    expect(lib).toContain("deadlock");

    const cart = read(CART_ROUTE);
    const stripe = read(STRIPE_ROUTE);
    const sweep = read(SWEEP_JOB);
    // Exactly one definition of the lock, imported everywhere it is used.
    expect((lib.match(/FROM orders WHERE id = \$1 FOR UPDATE/g) ?? []).length).toBe(1);
    expect((cart.match(/FOR UPDATE/g) ?? []).length).toBe(0);
    expect(cart).toContain("lockOrderRow(client, orderId)");
    expect(stripe).toContain("lockOrderRow(client, orderId)");
    expect(stripe).toContain("lockCheckoutGroupOrderRows(client, groupId)");
    expect(sweep).toContain("lockOrderRow(client, orderId)");
  });

  test("every order+payment transaction takes the ORDER lock before any payment write", () => {
    const stripe = read(STRIPE_ROUTE);
    const cases: Array<[string, string, string]> = [
      [STRIPE_ROUTE, stripe, "async function markPaymentSucceeded("],
      // The multi-shop settlement writer is the SAME invariant over N rows: it
      // locks every order of the purchase (one statement, stable order) before
      // it touches `payments`. Added with the group path, not in place of the
      // single-order one.
      [STRIPE_ROUTE, stripe, "async function settleCheckoutGroup("],
      [STRIPE_ROUTE, stripe, "async function markPaymentFailed("],
      [STRIPE_ROUTE, stripe, "async function markPaymentCanceled("],
      [STRIPE_ROUTE, stripe, "async function syncRefundFromStripe("],
      [
        CART_ROUTE,
        read(CART_ROUTE),
        'app.patch("/api/customer/orders/:orderId/cancel"',
      ],
      [
        SWEEP_JOB,
        read(SWEEP_JOB),
        "export async function expirePaymentReservation(",
      ],
    ];

    for (const [file, source, marker] of cases) {
      const tx = transactionOf(bodyOf(source, marker), `${file} — ${marker}`);
      // The ONE lock has two shapes: a single order row, and every order row of
      // a checkout group. Both are "the order lock", and both must come first.
      const lockAt = Math.min(
        ...["lockOrderRow(", "lockCheckoutGroupOrderRows("]
          .map((n) => tx.indexOf(n))
          .filter((i) => i >= 0),
      );
      expect(lockAt, `${file} — ${marker} never takes the order lock`).toBeLessThan(Number.POSITIVE_INFINITY);
      // The lock is the transaction's FIRST statement: nothing may be read or
      // written through a pool client before it.
      const firstStatementAt = tx.indexOf("client.query(");
      expect(
        lockAt < firstStatementAt,
        `${file} — ${marker} runs a statement before locking the order`,
      ).toBe(true);
      // …and specifically before any payment/refund write. The inverse order is
      // what produced the deadlock this file exists to pin.
      const paymentWriteAt = firstIndexOf(tx, "UPDATE payments", "INSERT INTO payments", "INSERT INTO refunds", "UPDATE refunds");
      expect(
        lockAt < paymentWriteAt,
        `${file} — ${marker} touches payments/refunds before locking the order`,
      ).toBe(true);
    }
  });

  test("the cancellation reads the payment state UNDER the lock, not just before it", () => {
    const cart = read(CART_ROUTE);
    const body = bodyOf(cart, 'app.patch("/api/customer/orders/:orderId/cancel"');
    const lockAt = body.indexOf("lockOrderRow(");
    const authoritativeReadAt = body.indexOf("latestPaymentStatusForOrder(");
    const claimAt = body.indexOf("UPDATE orders SET status = 'cancelled'");
    // The pre-transaction read is only a fast path: it answers 404/409 without a
    // lock. The gate that decides must sit between the lock and the claim, so a
    // payment that settled while this request waited for the row is still seen.
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(authoritativeReadAt).toBeGreaterThan(lockAt);
    expect(authoritativeReadAt).toBeLessThan(claimAt);
    expect(body).toContain("paymentBlocksCancellation(paymentStatus)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Database-gated: the real races, with real assertions
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("payment ↔ cancellation races (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
  ] as const;
  const WEBHOOK_SECRET = "whsec_000000000000000000000000";
  const JWT_SECRET = process.env.JWT_SECRET!;

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  function token(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.local` }, JWT_SECRET, { expiresIn: "1h" });
  }

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
    // The seller side of the fulfilment races: both legs of every cancel-vs-
    // seller case below are REAL HTTP requests against the REAL routes.
    setupSellerOrderRoutes(app);
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
    status: string;
    quantity?: number;
    /** Units this order has reserved — what a cancellation/expiry must give back. */
    reserved?: number;
    soldCount?: number;
    inventoryReleased?: boolean;
    payment?: { status: string; sessionId?: string | null } | null;
  }

  /**
   * Seed owner → seller → shop → product → inventory → order (+ item).
   * Stock is seeded the way checkout reserves it (`inventory.reserved += qty`),
   * so a correct cancellation must bring `reserved` back to 0 — and a second
   * release, or a settlement, would be visible as a wrong `reserved`/`sold_count`.
   */
  async function seedOrder(opts: SeedOptions) {
    const { query } = await import("../db/index.js");
    const quantity = opts.quantity ?? 3;
    const reserved = opts.reserved ?? quantity;
    const tag = `race-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Race Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Race Seller",
    ]);
    const sellerUserId = sellerUser.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [sellerUserId]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, 120.00, 'published', $4) RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`, opts.soldCount ?? 0],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, $2)`, [productId, reserved]);

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, inventory_released)
       VALUES ($1, $2, $3, $4, 360.00, 'THB', $5) RETURNING id`,
      [ownerId, shop.rows[0].id, `RC-${tag.slice(-12)}`, opts.status, opts.inventoryReleased ?? false],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shop.rows[0].id, `${tag} product`, quantity, quantity * 120],
    );
    if (opts.payment) {
      await query(
        `INSERT INTO payments (order_id, provider, method, amount, currency, status, provider_checkout_session_id)
         VALUES ($1, 'stripe', 'CARD', 360.00, 'THB', $2, $3)`,
        [orderId, opts.payment.status, opts.payment.sessionId ?? null],
      );
    }
    return { orderId, ownerId, sellerUserId, productId, quantity };
  }

  /** Everything a cancellation, a settlement or an expiry can change. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [orderId])).rows[0];
    const inventory = (await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])).rows[0];
    const product = (await query(`SELECT sold_count FROM products WHERE id = $1`, [productId])).rows[0];
    const payments = (
      await query(`SELECT status, failure_code FROM payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    ).rows as Array<{ status: string; failure_code: string | null }>;
    return {
      status: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      reserved: Number(inventory.reserved),
      quantity: Number(inventory.quantity),
      soldCount: Number(product.sold_count),
      payments,
    };
  }

  async function cancel(base: string, orderId: string, asUserId: string) {
    const res = await fetch(`${base}/api/customer/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(asUserId)}` },
    });
    const body = (await res.json()) as {
      data?: { status?: string; cancelled?: boolean; stockReleased?: boolean };
      error?: { code?: string };
    };
    return { status: res.status, body };
  }

  /** The seller's own transition endpoint — the other half of every race here. */
  async function sellerSetStatus(
    base: string,
    orderId: string,
    sellerUserId: string,
    status: string,
    extra?: Record<string, unknown>,
  ) {
    const res = await fetch(`${base}/api/seller/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(sellerUserId)}` },
      body: JSON.stringify({ status, ...(extra ?? {}) }),
    });
    const body = (await res.json()) as { data?: { status?: string }; error?: { code?: string } };
    return { status: res.status, body };
  }

  /** Deliver a locally signed Stripe event to the real webhook route. */
  async function deliverWebhook(event: Record<string, unknown>): Promise<number> {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const payload = JSON.stringify(event);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET) },
        body: payload,
      });
      return res.status;
    });
  }

  function succeededEvent(orderId: string, intentId = `pi_${crypto.randomUUID()}`) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
    };
  }

  function paidSessionEvent(orderId: string) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_test_${crypto.randomUUID()}`,
          object: "checkout.session",
          payment_status: "paid",
          payment_intent: `pi_${crypto.randomUUID()}`,
          metadata: { orderId },
        },
      },
    };
  }

  /** The provider closing the abandoned session — a `payments`-then-`orders` path. */
  function expiredSessionEvent(orderId: string) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.expired",
      data: { object: { id: `cs_test_${crypto.randomUUID()}`, object: "checkout.session", metadata: { orderId } } },
    };
  }

  /**
   * Hold the order row's exclusive lock in a SEPARATE connection, so a test can
   * put two real requests in flight and observe that they both wait on the very
   * same row — i.e. that neither is holding a `payments` lock while it waits.
   */
  async function holdOrderLock<T>(orderId: string, fn: (release: () => Promise<void>) => Promise<T>): Promise<T> {
    const { getClient } = await import("../db/index.js");
    const holder = await getClient();
    let released = false;
    await holder.query("BEGIN");
    await holder.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const release = async () => {
      released = true;
      await holder.query("COMMIT");
      holder.release();
    };
    try {
      return await fn(release);
    } finally {
      if (!released) {
        try {
          await holder.query("ROLLBACK");
        } catch {
          /* the connection is being discarded either way */
        }
        holder.release();
      }
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ── §8 cancel → payment success ──────────────────────────────────────────

  test("a settlement after the cancellation is RECORDED but never resurrects the order", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 3,
      payment: { status: "requires_action" },
    });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data?.cancelled).toBe(true);
      });

      // A real, correctly signed settlement for the order the customer just called off.
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);

      const after = await stateOf(seed.orderId, seed.productId);
      // The order is NOT resurrected and stays terminal.
      expect(after.status).toBe("cancelled");
      // Stock was released once and is NOT re-reserved.
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      // …and is NOT committed: nothing shipped, so nothing was sold.
      expect(after.soldCount).toBe(0);
      // The money is not lost: the payment row carries it, which is exactly what
      // makes the case refundable by an operator.
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0].status).toBe("paid");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  // ── §9 payment success → cancel ──────────────────────────────────────────

  test("the settlement that lands first wins: the later cancellation is refused and releases nothing", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 3,
      payment: { status: "requires_action" },
    });
    try {
      // 1. The money commits.
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);
      const paid = await stateOf(seed.orderId, seed.productId);
      expect(paid.status).toBe("paid");
      expect(paid.inventoryReleased).toBe(false);
      expect(paid.reserved).toBe(0); // reserved → committed
      expect(paid.soldCount).toBe(3); // exactly once

      // 2. The customer tries to cancel afterwards.
      const refused = await withServer((base) => cancel(base, seed.orderId, seed.ownerId));
      // Refused — never treated as the cancellation of an unpaid order. A fully
      // paid order is outside the cancelable set (`400 INVALID_STATUS`), which is
      // the state machine's own answer; `409 ORDER_ALREADY_PAID` is the answer for
      // a payment that settled while the order row lagged. Either way it refused.
      expect([400, 409]).toContain(refused.status);
      expect(["INVALID_STATUS", "ORDER_ALREADY_PAID"]).toContain(refused.body.error?.code ?? "");

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      // Not released: the units are sold now, and a "cancellation" must not hand
      // them back to the shelf.
      expect(after.inventoryReleased).toBe(false);
      expect(after.reserved).toBe(0);
      expect(after.soldCount).toBe(3);
      expect(after.payments[0].status).toBe("paid");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  // ── §10 duplicate webhooks ───────────────────────────────────────────────

  test("a duplicate payment_intent.succeeded settles exactly once", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 2,
      payment: { status: "requires_action" },
    });
    try {
      const event = succeededEvent(seed.orderId);
      expect(await deliverWebhook(event)).toBe(200);
      // The same event id again — Stripe's own redelivery.
      expect(await deliverWebhook(event)).toBe(200);

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      expect(after.soldCount).toBe(2); // NOT 4
      expect(after.reserved).toBe(0); // NOT -2
      expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("checkout.session.completed + payment_intent.succeeded settle one order exactly once", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 2,
      payment: { status: "requires_action" },
    });
    try {
      // Two DIFFERENT event ids for the same charge: both are authoritative and
      // carry `paid`, so the second must be an idempotent no-op on the order.
      expect(await deliverWebhook(paidSessionEvent(seed.orderId))).toBe(200);
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      expect(after.soldCount).toBe(2);
      expect(after.reserved).toBe(0);
      expect(after.inventoryReleased).toBe(false);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  // ── §5/§6 the concurrent cases ───────────────────────────────────────────

  test("a concurrent cancellation and settlement both WAIT on the order row, and exactly one wins", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 3,
      payment: { status: "requires_action" },
    });
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        // Fire both real requests while the order row is locked elsewhere.
        let cancelDone = false;
        let webhookDone = false;
        const cancelPromise = withServer((base) => cancel(base, seed.orderId, seed.ownerId)).then((r) => {
          cancelDone = true;
          return r;
        });
        const webhookPromise = deliverWebhook(succeededEvent(seed.orderId)).then((s) => {
          webhookDone = true;
          return s;
        });

        await sleep(600);
        // BOTH are blocked on the same row. This is the runtime proof of the lock
        // order: the webhook's failure/cancel handlers used to touch `payments`
        // first, which would have let it proceed (holding the payment row) and
        // deadlock against the cancellation. A path that never locks the order
        // row would simply have completed here.
        expect(cancelDone).toBe(false);
        expect(webhookDone).toBe(false);

        await release();

        const [cancelled, webhookStatus] = await Promise.all([cancelPromise, webhookPromise]);
        // Both requests resolved — no `deadlock detected` (40P01) 500, no 503.
        expect(webhookStatus).toBe(200);
        expect([200, 409]).toContain(cancelled.status);

        const after = await stateOf(seed.orderId, seed.productId);
        // Exactly one of the two legal outcomes — never a mixture.
        const cancelledWon = after.status === "cancelled";
        const paidWon = after.status === "paid";
        expect(cancelledWon || paidWon).toBe(true);

        if (cancelledWon) {
          expect(after.inventoryReleased).toBe(true);
          expect(after.reserved).toBe(0);
          expect(after.soldCount).toBe(0); // never committed for a cancelled order
        } else {
          expect(after.inventoryReleased).toBe(false);
          expect(after.reserved).toBe(0);
          expect(after.soldCount).toBe(3); // committed exactly once
        }
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a concurrent cancellation and expiry sweep end the order once and release the stock once", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 4,
      payment: { status: "requires_action" },
    });
    // Make the reservation due so the sweep is a live writer.
    const { query } = await import("../db/index.js");
    await query(
      `UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [seed.orderId],
    );
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let cancelDone = false;
        let sweepDone = false;
        const cancelPromise = withServer((base) => cancel(base, seed.orderId, seed.ownerId)).then((r) => {
          cancelDone = true;
          return r;
        });
        const sweepPromise = expirePaymentReservation(seed.orderId).then((r) => {
          sweepDone = true;
          return r;
        });

        await sleep(600);
        expect(cancelDone).toBe(false);
        expect(sweepDone).toBe(false);

        await release();
        const [cancelled, sweep] = await Promise.all([cancelPromise, sweepPromise]);
        expect([200, 409]).toContain(cancelled.status);
        // Loser or winner, the sweep itself never reports a contradiction.
        expect(sweep.outcome === "expired" || sweep.outcome === "skipped" || sweep.outcome === "missing").toBe(true);

        const after = await stateOf(seed.orderId, seed.productId);
        expect(["cancelled", "expired"]).toContain(after.status);
        // Released exactly once, by whichever side moved the order.
        expect(after.inventoryReleased).toBe(true);
        expect(after.reserved).toBe(0);
        expect(after.soldCount).toBe(0);
        // An expired reservation is never a captured payment.
        expect(after.payments.every((p) => p.status !== "paid")).toBe(true);

        // A repeated sweep after the fact stays a no-op — the stock is never
        // returned twice, whichever writer won.
        const repeat = await expirePaymentReservation(seed.orderId);
        expect(repeat.outcome).not.toBe("expired");
        const settled = await stateOf(seed.orderId, seed.productId);
        expect(settled.reserved).toBe(0);
        expect(settled.quantity).toBe(50);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("the expiry webhook waits on the ORDER row and never holds the payments row while it waits", async () => {
    // The discriminating case for the lock ORDER, not just the lock target: this
    // is the handler that used to run `UPDATE payments` BEFORE `UPDATE orders`,
    // inverting the order against the cancellation route. A transaction that
    // holds the payment row while it waits for the order row is one half of an
    // AB-BA deadlock; proving it holds NEITHER is what makes the fix real.
    const seed = await seedOrder({ status: "pending_payment", quantity: 2, payment: { status: "requires_action" } });
    const { getClient, query } = await import("../db/index.js");
    const event = expiredSessionEvent(seed.orderId);
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let webhookDone = false;
        const webhookPromise = deliverWebhook(event).then((s) => {
          webhookDone = true;
          return s;
        });

        // Wait until the event is CLAIMED — the handler is past signature
        // verification and about to enter the order/payment transaction.
        let claimed = false;
        for (let i = 0; i < 60 && !claimed; i++) {
          claimed = (await query(`SELECT id FROM payment_events WHERE event_id = $1`, [event.id])).rows.length > 0;
          if (!claimed) await sleep(25);
        }
        expect(claimed).toBe(true);
        await sleep(150);
        expect(webhookDone).toBe(false); // still inside the transaction, blocked

        // Probe the payments row from a third connection. If the webhook had
        // taken `payments` before `orders` (the old order) it would be holding
        // this row right now, and NOWAIT would raise 55P03.
        const probe = await getClient();
        try {
          await probe.query("BEGIN");
          await probe.query(`SELECT id FROM payments WHERE order_id = $1 FOR UPDATE NOWAIT`, [seed.orderId]);
          await probe.query("ROLLBACK");
        } finally {
          probe.release();
        }

        await release();
        expect(await webhookPromise).toBe(200);

        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe("cancelled");
        expect(after.inventoryReleased).toBe(true);
        expect(after.reserved).toBe(0);
      });
    } finally {
      await query(`DELETE FROM payment_events WHERE event_id = $1`, [event.id]);
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a settlement can never release, and a release can never settle, on the same order", async () => {
    // The two invariants, pinned directly against the guard each writer uses.
    const paidSeed = await seedOrder({
      status: "paid",
      quantity: 2,
      reserved: 0,
      soldCount: 2,
      payment: { status: "paid" },
    });
    const releasedSeed = await seedOrder({
      status: "cancelled",
      quantity: 2,
      reserved: 0,
      inventoryReleased: true,
      payment: { status: "cancelled" },
    });
    try {
      // A settlement for an already-paid order is a no-op on the stock.
      expect(await deliverWebhook(succeededEvent(paidSeed.orderId))).toBe(200);
      const paid = await stateOf(paidSeed.orderId, paidSeed.productId);
      expect(paid.soldCount).toBe(2); // exactly once
      expect(paid.inventoryReleased).toBe(false);
      expect(paid.reserved).toBe(0);

      // A settlement for an order whose stock was already released is recorded
      // and reported, never committed.
      expect(await deliverWebhook(succeededEvent(releasedSeed.orderId))).toBe(200);
      const released = await stateOf(releasedSeed.orderId, releasedSeed.productId);
      expect(released.status).toBe("cancelled");
      expect(released.soldCount).toBe(0);
      expect(released.reserved).toBe(0); // never re-reserved
      expect(released.inventoryReleased).toBe(true);
    } finally {
      await purgeUsers([paidSeed.ownerId, paidSeed.sellerUserId, releasedSeed.ownerId, releasedSeed.sellerUserId]);
    }
  });

  // ── Concurrency cases that need BOTH sides in flight ──────────────────────
  // Every test below holds the order row in a separate connection, issues both
  // real HTTP requests (or the real worker) while the lock is held, proves BOTH
  // are waiting on that one row, then releases it. That is what makes them race
  // tests rather than two sequential calls: the winner is decided by PostgreSQL,
  // never by the order the test happened to run them in.

  test("TEST 06 — checkout.session.completed ∥ payment_intent.succeeded settle the order exactly once", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let settled = 0;
        const session = deliverWebhook(paidSessionEvent(seed.orderId)).then((s) => { settled++; return s; });
        const intent = deliverWebhook(succeededEvent(seed.orderId)).then((s) => { settled++; return s; });

        await sleep(600);
        expect(settled).toBe(0); // BOTH deliveries are queued on the same order row
        await release();

        const [s1, s2] = await Promise.all([session, intent]);
        expect(s1).toBe(200);
        expect(s2).toBe(200);

        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe("paid");
        expect(after.soldCount).toBe(3); // committed ONCE, whichever event won
        expect(after.reserved).toBe(0); // never −3
        expect(after.inventoryReleased).toBe(false);
        expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 07 — the reservation expiry ∥ a settlement: one valid final state, decided by the database", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const { query } = await import("../db/index.js");
    await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [seed.orderId]);
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let decided = 0;
        const settle = deliverWebhook(succeededEvent(seed.orderId)).then((s) => { decided++; return s; });
        const expire = expirePaymentReservation(seed.orderId).then((r) => { decided++; return r; });

        await sleep(600);
        expect(decided).toBe(0); // both wait on the order row — no interleaved writes
        await release();

        const [webhookStatus, expiry] = await Promise.all([settle, expire]);
        expect(webhookStatus).toBe(200);
        expect(["expired", "skipped"]).toContain(expiry.outcome);

        const after = await stateOf(seed.orderId, seed.productId);
        const paymentWon = after.status === "paid";
        const expiryWon = after.status === "expired";
        // Exactly one valid final state — never a mixture, never a resurrection.
        expect(paymentWon || expiryWon).toBe(true);
        // Whatever happened, the reservation was released exactly once OR
        // committed exactly once — never both, never neither.
        expect(after.reserved).toBe(0);
        // COMMITTED and the 3 units left the shelf; RELEASED and `quantity`
        // is untouched (release only returns the hold). Either way non-negative.
        expect(after.quantity).toBe(paymentWon ? 47 : 50);
        expect(after.soldCount).toBe(paymentWon ? 3 : 0);
        expect(after.inventoryReleased).toBe(!paymentWon);

        if (paymentWon) {
          expect(expiry.outcome).toBe("skipped"); // the sweep refuses a settled charge
        } else {
          // The order is NOT resurrected, and the money is still RECORDED —
          // which is exactly what makes it refundable rather than lost.
          expect(after.payments[0].status).toBe("paid");
          expect(after.soldCount).toBe(0);
        }
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 18 — the SAME Stripe event delivered concurrently settles exactly once", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const event = succeededEvent(seed.orderId);
    try {
      // Three parallel deliveries of one event id: Stripe retries and parallel
      // workers both land here, and `payment_events` may claim the id only once.
      const results = await Promise.all([
        deliverWebhook(event),
        deliverWebhook(event),
        deliverWebhook(event),
      ]);
      expect(results).toEqual([200, 200, 200]);

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      expect(after.soldCount).toBe(3);
      expect(after.reserved).toBe(0);
      expect(after.inventoryReleased).toBe(false);
      expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 15 — a duplicated settlement retry after a cancellation changes nothing", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      await withServer(async (base) => {
        expect((await cancel(base, seed.orderId, seed.ownerId)).status).toBe(200);
      });

      const event = succeededEvent(seed.orderId);
      expect(await deliverWebhook(event)).toBe(200);
      expect(await deliverWebhook(event)).toBe(200); // Stripe's own redelivery

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("cancelled"); // never resurrected by a retry
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      expect(after.soldCount).toBe(0);
      expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1); // money recorded ONCE
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 09 — cancel ∥ confirmed: the payment axis decides, both in flight", async () => {
    const seed = await seedOrder({ status: "pending", quantity: 3, payment: { status: "requires_action" } });
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let decided = 0;
        const confirmed = withServer((base) => sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed"))
          .then((r) => { decided++; return r; });
        const cancelled = withServer((base) => cancel(base, seed.orderId, seed.ownerId))
          .then((r) => { decided++; return r; });

        await sleep(600);
        expect(decided).toBe(0); // both blocked on the SAME order row
        await release();

        const [sellerRes, cancelRes] = await Promise.all([confirmed, cancelled]);
        // Neither answer is a 500 — a deadlock would surface as one.
        expect(cancelRes.status).toBe(200);
        expect([400, 409]).toContain(sellerRes.status);
        // `confirmed` requires SETTLED money, and there is none: the seller may
        // never move an unpaid order into fulfilment, whoever held the lock first.
        if (sellerRes.status === 409) expect(sellerRes.body.error?.code).toBe("PAYMENT_NOT_CONFIRMED");
        else expect(sellerRes.body.error?.code).toBe("INVALID_TRANSITION");
        expect(cancelRes.body.data?.cancelled).toBe(true);

        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe("cancelled");
        expect(after.inventoryReleased).toBe(true);
        expect(after.reserved).toBe(0); // released exactly once
        expect(after.soldCount).toBe(0);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 08 — cancel ∥ packing: both in flight, one winner, no contradiction", async () => {
    // The genuinely contested case: an order in `confirmed` whose payment has
    // NOT settled, so BOTH the customer's cancel and the seller's `packing`
    // pass their own gates and it is the lock that decides. (The common shape —
    // a Card order that WAS paid — is covered by the second half of this test,
    // where the money gate refuses the cancel outright.)
    const seed = await seedOrder({ status: "confirmed", quantity: 3, payment: { status: "requires_action" } });
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let decided = 0;
        const packed = withServer((base) => sellerSetStatus(base, seed.orderId, seed.sellerUserId, "packing"))
          .then((r) => { decided++; return r; });
        const cancelled = withServer((base) => cancel(base, seed.orderId, seed.ownerId))
          .then((r) => { decided++; return r; });

        await sleep(600);
        expect(decided).toBe(0); // BOTH are inside their transaction, waiting
        await release();

        const [packRes, cancelRes] = await Promise.all([packed, cancelled]);
        expect(cancelRes.status).toBe(200); // definitive answers, never a 500
        expect([200, 400]).toContain(packRes.status);

        const after = await stateOf(seed.orderId, seed.productId);
        const cancelWon = after.status === "cancelled";
        const packWon = after.status === "packing";
        expect(cancelWon || packWon).toBe(true); // never both, never neither

        if (cancelWon) {
          // `packing` is refused: a cancelled order may never start fulfilment.
          expect(cancelRes.body.data?.cancelled).toBe(true);
          expect(packRes.status).toBe(400);
          expect(packRes.body.error?.code).toBe("INVALID_TRANSITION");
          expect(after.inventoryReleased).toBe(true);
          expect(after.reserved).toBe(0); // released exactly once
        } else {
          // `packing` committed first: the cancel then finds nothing to move —
          // the point of no return — and NO stock is handed back.
          expect(cancelRes.body.data?.cancelled).toBe(false);
          expect(cancelRes.body.data?.alreadyFinal).toBe(true);
          expect(packRes.status).toBe(200);
          expect(after.inventoryReleased).toBe(false);
          expect(after.reserved).toBe(3); // still held for the buyer
        }
        expect(after.soldCount).toBe(0); // nothing sold in either case
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 08b — on a PAID order the money gate refuses the cancel before packing is even asked", async () => {
    // The production shape of the same race: pay → confirm → cancel ∥ packing.
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);
      await withServer(async (base) => {
        expect((await sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed")).status).toBe(200);

        const [cancelRes, packRes] = await Promise.all([
          cancel(base, seed.orderId, seed.ownerId),
          sellerSetStatus(base, seed.orderId, seed.sellerUserId, "packing"),
        ]);
        expect(cancelRes.status).toBe(409);
        expect(cancelRes.body.error?.code).toBe("ORDER_ALREADY_PAID");
        expect(packRes.status).toBe(200);
      });

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("packing");
      expect(after.inventoryReleased).toBe(false);
      expect(after.reserved).toBe(0); // committed at settlement, never re-reserved
      expect(after.soldCount).toBe(3);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 10 — cancel ∥ shipped: a packed order can no longer be cancelled", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);
      await withServer(async (base) => {
        expect((await sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed")).status).toBe(200);
        expect((await sellerSetStatus(base, seed.orderId, seed.sellerUserId, "packing")).status).toBe(200);

        const [cancelRes, shipRes] = await Promise.all([
          cancel(base, seed.orderId, seed.ownerId),
          sellerSetStatus(base, seed.orderId, seed.sellerUserId, "shipped", {
            carrier: "Kerry",
            trackingNumber: "TH-RACE-1",
          }),
        ]);
        // `packing` is past the point of no return: the cancel is refused by the
        // state machine (and by the money gate) whichever answer arrives first.
        expect([400, 409]).toContain(cancelRes.status);
        expect(["INVALID_STATUS", "ORDER_ALREADY_PAID"]).toContain(cancelRes.body.error?.code ?? "");
        expect(shipRes.status).toBe(200);
      });

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("shipped");
      expect(after.inventoryReleased).toBe(false);
      expect(after.soldCount).toBe(3);
      const { query } = await import("../db/index.js");
      const shipments = await query(
        `SELECT carrier, tracking_number FROM shipments WHERE order_id = $1`,
        [seed.orderId],
      );
      // `shipped` is never a placeholder: a real shipment with real tracking.
      expect(shipments.rows).toHaveLength(1);
      expect(shipments.rows[0]).toMatchObject({ carrier: "Kerry", tracking_number: "TH-RACE-1" });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 14 — a cancelled order can NEVER return to active fulfilment (concurrent attempts)", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      await withServer(async (base) => {
        expect((await cancel(base, seed.orderId, seed.ownerId)).status).toBe(200);

        // Every forward move, issued at the same moment, from the same endpoint.
        const attempts = await Promise.all([
          sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed"),
          sellerSetStatus(base, seed.orderId, seed.sellerUserId, "packing"),
          sellerSetStatus(base, seed.orderId, seed.sellerUserId, "shipped", {
            carrier: "Kerry",
            trackingNumber: "TH-ZOMBIE",
          }),
        ]);
        for (const attempt of attempts) {
          expect(attempt.status).toBe(400);
          expect(attempt.body.error?.code).toBe("INVALID_TRANSITION");
        }
      });

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("cancelled"); // terminal, under concurrent pressure
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      expect(after.soldCount).toBe(0);
      const { query } = await import("../db/index.js");
      expect((await query(`SELECT id FROM shipments WHERE order_id = $1`, [seed.orderId])).rows).toHaveLength(0);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  // ── Part ②: the reservation worker against the rest of the system ────────

  test("TEST 05 — the expiry sweep ∥ a seller confirmation: an unpaid order never enters fulfilment", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const { query } = await import("../db/index.js");
    await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [seed.orderId]);
    try {
      await holdOrderLock(seed.orderId, async (release) => {
        let decided = 0;
        const confirm = withServer((base) => sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed"))
          .then((r) => { decided++; return r; });
        const expire = expirePaymentReservation(seed.orderId).then((r) => { decided++; return r; });

        await sleep(600);
        expect(decided).toBe(0); // both are inside their transaction, on the order row
        await release();

        const [sellerRes, expiry] = await Promise.all([confirm, expire]);
        // The confirmation is refused whichever side held the lock first: either
        // the transition table rejects `expired`, or the payment gate rejects an
        // unpaid order (`confirmed` requires settled money).
        expect([400, 409]).toContain(sellerRes.status);
        expect(["INVALID_TRANSITION", "PAYMENT_NOT_CONFIRMED"]).toContain(sellerRes.body.error?.code ?? "");
        expect(expiry.outcome).toBe("expired");

        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe("expired"); // never `confirmed`, never active
        expect(after.inventoryReleased).toBe(true);
        expect(after.reserved).toBe(0); // released exactly once
        expect(after.soldCount).toBe(0);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 06 — the expiry sweep ∥ packing: a lapsed deadline can never cancel work in progress", async () => {
    // Real flow up to the race: pay → confirm. `payment_expires_at` stays behind
    // as history and has now lapsed, so the worker has something to act on — and
    // must refuse to act on it while the shop starts packing.
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const { query } = await import("../db/index.js");
    try {
      expect(await deliverWebhook(succeededEvent(seed.orderId))).toBe(200);
      await withServer(async (base) => {
        expect((await sellerSetStatus(base, seed.orderId, seed.sellerUserId, "confirmed")).status).toBe(200);
      });
      await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [seed.orderId]);

      // Both run at the same moment against the same order.
      const [expiry, packRes] = await Promise.all([
        expirePaymentReservation(seed.orderId),
        withServer((base) => sellerSetStatus(base, seed.orderId, seed.sellerUserId, "packing")),
      ]);

      // The worker refuses on BOTH levels: the eligibility read excludes every
      // fulfilment status, and the guarded claim would match 0 rows anyway.
      expect(expiry.outcome).toBe("skipped");
      expect(expiry.reason).toContain("already decided");
      expect(packRes.status).toBe(200);

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("packing"); // NOT expired, NOT cancelled
      expect(after.inventoryReleased).toBe(false); // committed stock never released
      expect(after.reserved).toBe(0);
      expect(after.soldCount).toBe(3); // exactly one commit at settlement
      // …and the commit CONSUMED the units: on-hand dropped by the 3 sold,
      // which is what keeps them off every other customer's shelf.
      expect(after.quantity).toBe(47);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 09 — the settlement delivered twice DURING the expiry: one terminal transition at most", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const { query } = await import("../db/index.js");
    await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [seed.orderId]);
    const event = succeededEvent(seed.orderId);
    try {
      // Three real writers at once: the worker and two deliveries of ONE event.
      const [s1, s2, expiry] = await Promise.all([
        deliverWebhook(event),
        deliverWebhook(event),
        expirePaymentReservation(seed.orderId),
      ]);
      expect(s1).toBe(200);
      expect(s2).toBe(200);
      expect(["expired", "skipped"]).toContain(expiry.outcome);

      const after = await stateOf(seed.orderId, seed.productId);
      // Whichever side won, exactly ONE terminal inventory transition happened.
      const committed = after.status === "paid";
      const released = after.status === "expired";
      expect(committed || released).toBe(true);
      expect(after.reserved).toBe(0);
      // −3 exactly ONCE when committed, untouched when released: never
      // negative and never double-touched either way.
      expect(after.quantity).toBe(committed ? 47 : 50);
      expect(after.soldCount).toBe(committed ? 3 : 0);
      expect(after.inventoryReleased).toBe(released);
      expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1); // money recorded once
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("TEST 10 — checkout.session.completed ∥ the expiry sweep: the final state follows the real payment state", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    const { query } = await import("../db/index.js");
    await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [seed.orderId]);
    try {
      const [sessionStatus, expiry] = await Promise.all([
        deliverWebhook(paidSessionEvent(seed.orderId)),
        expirePaymentReservation(seed.orderId),
      ]);
      expect(sessionStatus).toBe(200);
      expect(["expired", "skipped"]).toContain(expiry.outcome);

      const after = await stateOf(seed.orderId, seed.productId);
      const paid = after.status === "paid";
      const expired = after.status === "expired";
      expect(paid || expired).toBe(true);
      expect(after.reserved).toBe(0);
      expect(after.quantity).toBe(paid ? 47 : 50);
      if (paid) {
        // The charge won: committed once, and the worker refuses to touch it.
        expect(expiry.outcome).toBe("skipped");
        expect(after.soldCount).toBe(3);
        expect(after.inventoryReleased).toBe(false);
      } else {
        // The deadline won first: the session's money is still RECORDED, but
        // the order is not resurrected and nothing is committed.
        expect(after.soldCount).toBe(0);
        expect(after.inventoryReleased).toBe(true);
        expect(after.payments.filter((p) => p.status === "paid")).toHaveLength(1);
      }
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });
});
