/**
 * Payment-reservation expiry — the sweep, the races, and the storefront rule.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * `backend/jobs/payment-reservation-scheduler.ts` ends an unpaid order whose
 * reservation window has lapsed and returns its stock. What must hold, and is
 * pinned here:
 *
 *    1. an expired reservation ends the order (`expired`) and releases the
 *       reserved stock EXACTLY ONCE — a repeat, a concurrent sweep, a retry or a
 *       late webhook can never return the same units twice;
 *    2. an order that is not due, already decided, or has a live/paid payment is
 *       never expired out from under the customer;
 *    3. a payment that arrived BEFORE the deadline wins, and the sweep then
 *       leaves the order alone;
 *    4. a payment arriving AFTER the order expired cannot resurrect it and
 *       cannot reclaim another customer's stock — the money stays on the payment
 *       row, which is what makes it refundable (the reconciliation path);
 *    5. a duplicate Stripe delivery stays idempotent (`payment_events`);
 *    6. the storefront hides "continue payment" at exactly the same instant the
 *       backend stops accepting a session for the order;
 *    7. the expiry status has ONE writer, the window is written in ONE place, and
 *       both schema files carry the same columns and index.
 *
 * The DB-gated cases run against `TEST_DATABASE_URL` (they skip when it is not
 * configured, exactly like the rest of this suite). No real Stripe call is made:
 * the webhook cases sign a payload locally with Stripe's own scheme.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import { existsSync, readFileSync } from "fs";
import jwt from "jsonwebtoken";
import { join } from "path";

import {
  formatPaymentCountdown,
  getOrderStatusMeta,
  NEXT_ORDER_STATUSES,
  orderStripePayability,
  paymentReservationState,
} from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";
import {
  EXPIRY_BLOCKING_PAYMENT_STATUSES,
  expirePaymentReservation,
  findDuePaymentReservations,
  processExpiredPaymentReservations,
} from "../jobs/payment-reservation-scheduler.js";
import {
  applyPaymentReservationPolicy,
  isUndefinedColumnError,
  PAYMENT_RESERVATION_EXPIRABLE_STATUSES,
  PAYMENT_RESERVATION_EXPIRED_STATUS,
} from "../lib/payment-reservation.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const SERVER = "backend/server.ts";
const POLICY_LIB = "backend/lib/payment-reservation.ts";
const SWEEP_JOB = "backend/jobs/payment-reservation-scheduler.ts";
const ORDER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The storefront rule: countdown, expiry and payability
// ═══════════════════════════════════════════════════════════════════════════

describe("payment reservation — the countdown the order page renders", () => {
  test("formats MM:SS under an hour, H:MM:SS above it, and never shows a negative", () => {
    expect(formatPaymentCountdown(0)).toBe("00:00");
    expect(formatPaymentCountdown(999)).toBe("00:00");
    expect(formatPaymentCountdown(1_000)).toBe("00:01");
    expect(formatPaymentCountdown(60_000)).toBe("01:00");
    expect(formatPaymentCountdown(24 * 60_000 + 37_000)).toBe("24:37");
    expect(formatPaymentCountdown(59 * 60_000 + 59_000)).toBe("59:59");
    expect(formatPaymentCountdown(3_600_000)).toBe("1:00:00");
    expect(formatPaymentCountdown(3_725_000)).toBe("1:02:05");
    expect(formatPaymentCountdown(-5_000)).toBe("00:00");
    expect(formatPaymentCountdown(Number.NaN)).toBe("00:00");
    expect(formatPaymentCountdown(Number.POSITIVE_INFINITY)).toBe("00:00");
  });

  test("reads the deadline off the order and reports the remaining time", () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    const state = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: now + 24 * 60_000 + 37_000 },
      now,
    );
    expect(state).toEqual({
      hasWindow: true,
      expiresAt: now + 24 * 60_000 + 37_000,
      expired: false,
      remainingMs: 24 * 60_000 + 37_000,
    });
  });

  test("an ISO deadline (not just ms) is accepted — the API may send either", () => {
    const expiresAt = Date.UTC(2026, 8, 28, 12, 30, 0);
    const state = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: new Date(expiresAt).toISOString() },
      expiresAt - 60_000,
    );
    expect(state.hasWindow).toBe(true);
    expect(state.remainingMs).toBe(60_000);
  });

  test("a lapsed deadline is expired with no remaining time", () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    const state = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: now - 1 },
      now,
    );
    expect(state.expired).toBe(true);
    expect(state.remainingMs).toBe(0);
    expect(state.hasWindow).toBe(true);
  });

  test("an order with no window shows no countdown (COD, legacy rows, junk values)", () => {
    for (const order of [
      { status: "pending_payment" },
      { status: "pending_payment", paymentExpiresAt: null },
      { status: "pending_payment", paymentExpiresAt: "not-a-date" },
      { status: "pending_payment", paymentExpiresAt: Number.NaN },
      null,
      undefined,
    ]) {
      const state = paymentReservationState(order, Date.now());
      expect(state.hasWindow).toBe(false);
      expect(state.expiresAt).toBeNull();
    }
  });

  test("a decided order has no countdown, whatever deadline it still carries", () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    for (const status of ["paid", "cancelled", "expired", "payment_failed", "shipped"]) {
      const state = paymentReservationState(
        { status, paymentExpiresAt: now + 10 * 60_000 },
        now,
      );
      expect(state.hasWindow).toBe(false);
      expect(state.remainingMs).toBe(0);
    }
  });

  test("the pay button disappears exactly when the backend stops accepting a session", () => {
    // The production path reads the real clock, so the deadlines are relative to it.
    const now = Date.now();
    // Inside the window: payable.
    expect(
      orderStripePayability({ status: "pending_payment", paymentMethod: "PROMPTPAY", paymentExpiresAt: now + 60_000 }),
    ).toEqual({ payable: true, method: "PROMPTPAY", expired: false });
    // At the deadline: refused (the backend answers 400 PAYMENT_RESERVATION_EXPIRED).
    expect(
      orderStripePayability({ status: "pending_payment", paymentMethod: "PROMPTPAY", paymentExpiresAt: now - 1 }),
    ).toEqual({ payable: false, method: null, expired: true });
    // Already swept: the status alone is terminal for payment.
    expect(orderStripePayability({ status: "expired", paymentMethod: "PROMPTPAY" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
    // No window recorded (legacy order): unchanged behaviour, still payable.
    expect(orderStripePayability({ status: "pending_payment", paymentMethod: "CARD" }).payable).toBe(true);
  });

  test("an expired order is terminal in the shared order contract", () => {
    expect(Object.keys(NEXT_ORDER_STATUSES)).toContain("expired");
    expect(NEXT_ORDER_STATUSES.expired).toEqual([]);
    const meta = getOrderStatusMeta("expired");
    expect(meta.label.length).toBeGreaterThan(0);
    expect(meta.badge.length).toBeGreaterThan(0);
  });

  test("the order page counts down from the API deadline and never invents one", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("paymentReservationState");
    expect(page).toContain("formatPaymentCountdown");
    // Presentation only: no status write, no fabricated deadline.
    expect(page).not.toContain("paymentExpiresAt: Date.now()");
    expect(page).not.toMatch(/status:\s*"expired"/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. i18n — the copy exists in every locale
// ═══════════════════════════════════════════════════════════════════════════

describe("payment reservation copy (th / en / my)", () => {
  const keys = ["payWithin", "windowNote", "expiredTitle", "expiredDesc"] as const;

  for (const lang of ["th", "en", "my"] as const) {
    test(`${lang} has the whole namespace`, () => {
      const ns = (translations[lang] as unknown as { orderReservation: Record<string, string> })
        .orderReservation;
      expect(ns).toBeDefined();
      for (const key of keys) {
        expect(typeof ns[key]).toBe("string");
        expect(ns[key].trim().length).toBeGreaterThan(0);
      }
      // The countdown value is injected by the shared formatter, so the
      // placeholder must survive in every language.
      expect(ns.payWithin).toContain("{time}");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Wiring — exactly one window writer, one expiry writer, one release path
// ═══════════════════════════════════════════════════════════════════════════

describe("payment reservation — the wiring contracts", () => {
  const backendFiles = [...new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root })]
    .filter((f) => !f.includes("/tests/"));

  test("the sweep is started once, at boot, next to the other scheduler", () => {
    const server = read(SERVER);
    expect((server.match(/startPaymentReservationScheduler\(\)/g) ?? []).length).toBe(1);
    expect(server).toContain('from "./jobs/payment-reservation-scheduler.js"');
    expect(server.indexOf("startPaymentReservationScheduler()")).toBeGreaterThan(
      server.indexOf("server.listen("),
    );
  });

  test("the reservation window is written in exactly ONE module", () => {
    const writers = backendFiles.filter((f) => /payment_expires_at\s*=\s*\$/.test(read(f)));
    expect(writers).toEqual([POLICY_LIB]);
  });

  test("the `expired` status is written in exactly ONE module, and never in a route", () => {
    const writers = backendFiles.filter((f) =>
      /PAYMENT_RESERVATION_EXPIRED_STATUS|SET status = 'expired'/.test(read(f)),
    );
    expect(writers.sort()).toEqual([SWEEP_JOB, POLICY_LIB].sort());
    expect(writers.some((f) => f.startsWith("backend/routes/"))).toBe(false);
  });

  test("order creation takes the window inside the checkout transaction", () => {
    const cart = read(CART_ROUTE);
    expect((cart.match(/applyPaymentReservationPolicy\(/g) ?? []).length).toBe(1);
    const checkoutStart = cart.indexOf('app.post("/api/customer/checkout"');
    const checkoutEnd = cart.indexOf('app.get("/api/customer/orders"');
    const checkout = cart.slice(checkoutStart, checkoutEnd);
    expect(checkout).toContain("await withTransaction(async (client) => {");
    expect(checkout).toContain("applyPaymentReservationPolicy(client, orderId, paymentMethod)");
  });

  test("the deadline is exposed to the order pages (ms) on both read routes", () => {
    const cart = read(CART_ROUTE);
    expect((cart.match(/paymentExpiresAt:/g) ?? []).length).toBe(2);
  });

  test("the sweep releases stock through the ONE release path", () => {
    const job = read(SWEEP_JOB);
    expect(job).toContain("releaseOrderInventory(client, orderId)");
    expect(job).toContain("withTransaction");
    // The claim carries the state guards that make it a race gate.
    expect(job).toContain("inventory_released = FALSE");
    expect(job).toContain("payment_expires_at <= NOW()");
    expect(job).toContain("status = ANY($3::text[])");
    // …and a live charge blocks the automatic expiry.
    expect(job).toContain("EXPIRY_BLOCKING_PAYMENT_STATUSES");
    expect([...EXPIRY_BLOCKING_PAYMENT_STATUSES]).toEqual(["paid", "processing"]);
  });

  test("a payment can never mark an order paid once its stock was released", () => {
    const stripe = read(STRIPE_ROUTE);
    const guard = stripe.slice(
      stripe.indexOf("SET status = 'paid', updated_at = NOW()"),
      stripe.indexOf("SET status = 'paid', updated_at = NOW()") + 300,
    );
    expect(guard).toContain("status IN ('pending', 'pending_payment')");
    expect(guard).toContain("inventory_released = FALSE");
    // …and the refusal is logged with the reservation reason, never silently.
    expect(stripe).toContain("reservation_expired");
  });

  test("checkout refuses a lapsed reservation BEFORE it can open a session", () => {
    const stripe = read(STRIPE_ROUTE);
    const refusal = stripe.indexOf('"PAYMENT_RESERVATION_EXPIRED"');
    const sessionCreate = stripe.indexOf("s.checkout.sessions.create(");
    expect(refusal).toBeGreaterThan(-1);
    expect(sessionCreate).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(sessionCreate);
    // The session is also asked to close no later than the deadline.
    expect(stripe).toContain("expires_at: sessionExpiresAt");
  });

  test("the reservation write survives being deployed before its migration", () => {
    const lib = read(POLICY_LIB);
    // The write is savepointed, so a missing column cannot abort the caller's
    // order-creation transaction (which would break EVERY checkout), and only
    // `undefined_column` is tolerated.
    expect(lib).toContain("SAVEPOINT velnox_payment_reservation");
    expect(lib).toContain("ROLLBACK TO SAVEPOINT velnox_payment_reservation");
    expect(lib).toContain("RELEASE SAVEPOINT velnox_payment_reservation");
    expect(lib).toContain("isUndefinedColumnError(err)");
    expect(lib).toContain("throw err;");
    expect(lib).toContain("048_payment_reservation.sql");
    // The sweep says so once and keeps serving rather than crashing every tick.
    const job = read(SWEEP_JOB);
    expect(job).toContain("sweep disabled");
    expect(job).toContain("schemaMissingWarned");
  });

  test("both canonical schema files carry the same columns and index", () => {
    const extract = (sql: string) =>
      sql
        .split("\n")
        .filter((line) => /payment_expires_at|reservation_policy/.test(line))
        .map((line) => line.trim())
        .sort();
    const schema = extract(read("db/schema.sql"));
    const bootstrap = extract(read("db/run-sqleditor.sql"));
    expect(schema.length).toBeGreaterThanOrEqual(3);
    expect(bootstrap).toEqual(schema);
    expect(schema.some((l) => l.includes("payment_expires_at TIMESTAMPTZ"))).toBe(true);
    expect(schema.some((l) => l.includes("reservation_policy JSONB"))).toBe(true);
    expect(schema.some((l) => l.includes("idx_orders_payment_expires_at"))).toBe(true);
  });

  test("the migration is additive and idempotent, and the deprecated file is untouched", () => {
    const migration = read("db/migrations/048_payment_reservation.sql");
    // The header comment explains the safety rules, so only executable lines are judged.
    const statements = migration
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect((statements.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length).toBe(2);
    expect(statements).toContain("CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at");
    expect(statements).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE )\b/);
    if (existsSync(join(root, "db/run-update.sql"))) {
      expect(read("db/run-update.sql")).not.toContain("payment_expires_at");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Database-gated: the real transitions and the real stock movement
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("payment reservation expiry (requires TEST_DATABASE_URL)", () => {
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

  function sessionToken(userId: string): string {
    // The route only verifies the cookie — no network, no real session.
    return jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  }

  function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  function buildApp(): express.Express {
    const app = express();
    app.use(express.json());
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

  interface SeedOptions {
    status: string;
    quantity?: number;
    /** Units this order has reserved — what an expiry must give back. */
    reserved?: number;
    inventoryQuantity?: number;
    /** Deadline relative to NOW (negative = already lapsed); null = no window. */
    expiresInMs?: number | null;
    payment?: { status: string; sessionId?: string | null } | null;
  }

  /**
   * Seed owner → seller → shop → product → inventory → order (+ item).
   * Stock is seeded the way checkout reserves it, so a correct expiry must bring
   * `reserved` back to 0 — and a second release would push it negative.
   */
  async function seedOrder(opts: SeedOptions) {
    const { query } = await import("../db/index.js");
    const quantity = opts.quantity ?? 3;
    const reserved = opts.reserved ?? quantity;
    const tag = `resv-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Reservation Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Reservation Seller",
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
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, $3)`, [
      productId,
      opts.inventoryQuantity ?? 50,
      reserved,
    ]);

    const expiresInMs = opts.expiresInMs === undefined ? -60_000 : opts.expiresInMs;
    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, payment_expires_at)
       VALUES ($1, $2, $3, $4, 360.00, 'THB',
               CASE WHEN $5::bigint IS NULL THEN NULL ELSE NOW() + ($5::bigint || ' milliseconds')::interval END)
       RETURNING id`,
      [ownerId, shop.rows[0].id, `RS-${tag.slice(-12)}`, opts.status, expiresInMs],
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
    return { orderId, ownerId, sellerUserId, productId };
  }

  /** Everything an expiry can change, read back in one query set. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(
        `SELECT status, inventory_released, payment_expires_at, reservation_policy FROM orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];
    const inventory = (await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])).rows[0];
    const payments = (
      await query(`SELECT status, failure_code FROM payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    ).rows as Array<{ status: string; failure_code: string | null }>;
    return {
      status: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      paymentExpiresAt: order.payment_expires_at as Date | null,
      reservationPolicy: order.reservation_policy as Record<string, unknown> | null,
      reserved: Number(inventory.reserved),
      quantity: Number(inventory.quantity),
      payments,
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
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET) },
        body: payload,
      });
      return res.status;
    });
  }

  test("an expired reservation ends the order and releases the stock exactly once", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      const result = await expirePaymentReservation(seed.orderId);
      expect(result).toMatchObject({ outcome: "expired", released: true });

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe(PAYMENT_RESERVATION_EXPIRED_STATUS);
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      expect(after.quantity).toBe(50);
      // The waiting payment stops waiting — the same transition the Stripe
      // `checkout.session.expired` webhook performs.
      expect(after.payments).toHaveLength(1);
      expect(after.payments[0].status).toBe("cancelled");
      expect(after.payments[0].failure_code).toBe("PAYMENT_RESERVATION_EXPIRED");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a repeated sweep is a no-op: the stock is never released twice", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 4, payment: { status: "requires_action" } });
    try {
      expect((await expirePaymentReservation(seed.orderId)).outcome).toBe("expired");
      const second = await expirePaymentReservation(seed.orderId);
      expect(second.outcome).toBe("skipped");
      expect(second.released).toBe(false);

      const after = await stateOf(seed.orderId, seed.productId);
      // Never negative, never double restored.
      expect(after.reserved).toBe(0);
      expect(after.inventoryReleased).toBe(true);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("five concurrent sweeps still release exactly once", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 4, payment: { status: "requires_action" } });
    try {
      const results = await Promise.all(Array.from({ length: 5 }, () => expirePaymentReservation(seed.orderId)));
      expect(results.filter((r) => r.outcome === "expired")).toHaveLength(1);
      expect(results.filter((r) => r.released)).toHaveLength(1);

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.reserved).toBe(0);
      expect(after.status).toBe("expired");
      expect(after.inventoryReleased).toBe(true);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a reservation that is not due yet is left completely alone", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 2, expiresInMs: 30 * 60_000 });
    try {
      const result = await expirePaymentReservation(seed.orderId);
      expect(result).toMatchObject({ outcome: "skipped", released: false });
      expect(result.reason).toContain("not due");

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("pending_payment");
      expect(after.inventoryReleased).toBe(false);
      expect(after.reserved).toBe(2);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a paid order is never expired", async () => {
    const seed = await seedOrder({ status: "paid", quantity: 2, reserved: 0, payment: { status: "paid" } });
    try {
      const result = await expirePaymentReservation(seed.orderId);
      expect(result.outcome).toBe("skipped");
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      expect(after.inventoryReleased).toBe(false);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a payment in flight blocks the automatic expiry", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 2, payment: { status: "processing" } });
    try {
      const result = await expirePaymentReservation(seed.orderId);
      expect(result.outcome).toBe("skipped");
      expect(result.reason).toContain("processing");
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("pending_payment");
      expect(after.reserved).toBe(2);
      expect(after.inventoryReleased).toBe(false);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a captured payment blocks it even when the order row lags behind", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 2, payment: { status: "paid" } });
    try {
      const result = await expirePaymentReservation(seed.orderId);
      expect(result.outcome).toBe("skipped");
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("pending_payment");
      expect(after.reserved).toBe(2);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("the scan returns only due, unreleased, still-expirable orders", async () => {
    const due = await seedOrder({ status: "pending_payment", payment: { status: "requires_action" } });
    const future = await seedOrder({ status: "pending_payment", expiresInMs: 45 * 60_000 });
    const released = await seedOrder({ status: "pending_payment" });
    const noWindow = await seedOrder({ status: "pending_payment", expiresInMs: null });
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE orders SET inventory_released = TRUE WHERE id = $1`, [released.orderId]);

      const ids = await findDuePaymentReservations(200);
      expect(ids).toContain(due.orderId);
      expect(ids).not.toContain(future.orderId);
      expect(ids).not.toContain(released.orderId);
      expect(ids).not.toContain(noWindow.orderId);

      // And the sweep actually ends it.
      const summary = await processExpiredPaymentReservations(200);
      expect(summary.due).toBeGreaterThanOrEqual(1);
      expect(summary.expired).toBeGreaterThanOrEqual(1);
      expect((await stateOf(due.orderId, due.productId)).status).toBe("expired");
    } finally {
      await purgeUsers([due.ownerId, due.sellerUserId]);
      await purgeUsers([future.ownerId, future.sellerUserId]);
      await purgeUsers([released.ownerId, released.sellerUserId]);
      await purgeUsers([noWindow.ownerId, noWindow.sellerUserId]);
    }
  });

  test("a late payment cannot resurrect an expired order — the reconciliation path", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 3, payment: { status: "requires_action" } });
    try {
      expect((await expirePaymentReservation(seed.orderId)).outcome).toBe("expired");

      const status = await deliverWebhook({
        id: `evt_late_${crypto.randomUUID()}`,
        object: "event",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: `pi_late_${crypto.randomUUID()}`,
            object: "payment_intent",
            metadata: { orderId: seed.orderId },
          },
        },
      });
      expect(status).not.toBe(400);

      const after = await stateOf(seed.orderId, seed.productId);
      // The order is NOT resurrected and no unit is reclaimed from anyone.
      expect(after.status).toBe("expired");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(0);
      // The money is still recorded — which is exactly what makes it refundable.
      expect(after.payments.some((p) => p.status === "paid")).toBe(true);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a duplicate delivery of the same event stays idempotent", async () => {
    const seed = await seedOrder({ status: "pending_payment", quantity: 2, payment: { status: "requires_action" } });
    const eventId = `evt_dup_${crypto.randomUUID()}`;
    const event = {
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: { id: `pi_dup_${crypto.randomUUID()}`, object: "payment_intent", metadata: { orderId: seed.orderId } },
      },
    };
    try {
      expect(await deliverWebhook(event)).not.toBe(400);
      const firstPaid = await stateOf(seed.orderId, seed.productId);
      expect(await deliverWebhook(event)).not.toBe(400);
      const second = await stateOf(seed.orderId, seed.productId);

      expect(second.status).toBe(firstPaid.status);
      expect(second.reserved).toBe(firstPaid.reserved);
      expect(second.inventoryReleased).toBe(firstPaid.inventoryReleased);

      const { query } = await import("../db/index.js");
      const rows = await query(`SELECT COUNT(*)::int AS n FROM payment_events WHERE event_id = $1`, [eventId]);
      expect(Number(rows.rows[0].n)).toBe(1);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a payment that arrives BEFORE the deadline wins, and the sweep then leaves it alone", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      quantity: 2,
      expiresInMs: 20 * 60_000,
      payment: { status: "requires_action" },
    });
    try {
      const status = await deliverWebhook({
        id: `evt_early_${crypto.randomUUID()}`,
        object: "event",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: `pi_early_${crypto.randomUUID()}`,
            object: "payment_intent",
            metadata: { orderId: seed.orderId },
          },
        },
      });
      expect(status).not.toBe(400);

      const paid = await stateOf(seed.orderId, seed.productId);
      expect(paid.status).toBe("paid");
      // Reserved stock became SOLD stock — released back to nobody.
      expect(paid.reserved).toBe(0);
      expect(paid.inventoryReleased).toBe(false);

      const sweep = await expirePaymentReservation(seed.orderId);
      expect(sweep.outcome).toBe("skipped");
      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("paid");
      expect(after.reserved).toBe(0);
      expect(after.quantity).toBe(50);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  async function startCheckout(orderId: string, ownerId: string, method = "CARD") {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_MODE = "test";
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `velnox_session=${sessionToken(ownerId)}`,
        },
        body: JSON.stringify({ orderId, method }),
      });
      return { status: res.status, body: (await res.json()) as { error?: { code?: string } } };
    });
  }

  test("checkout refuses a lapsed reservation with PAYMENT_RESERVATION_EXPIRED", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { status: "requires_action" } });
    try {
      const lapsed = await startCheckout(seed.orderId, seed.ownerId);
      // The guard fires BEFORE any Stripe call (there is no network here), so a
      // 400 with this code proves the deadline — not the provider — decided.
      expect(lapsed.status).toBe(400);
      expect(lapsed.body.error?.code).toBe("PAYMENT_RESERVATION_EXPIRED");

      const after = await stateOf(seed.orderId, seed.productId);
      expect(after.status).toBe("pending_payment");
      expect(after.payments).toHaveLength(1);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("inside the window the deadline is not the reason for refusing", async () => {
    const seed = await seedOrder({
      status: "pending_payment",
      expiresInMs: 25 * 60_000,
      payment: { status: "requires_action" },
    });
    try {
      const res = await startCheckout(seed.orderId, seed.ownerId, "PROMPTPAY");
      // Without a reachable Stripe this cannot succeed — but it must NOT be
      // refused for being expired, which is what makes the previous case a real
      // discriminator rather than a blanket refusal.
      expect(res.body.error?.code).not.toBe("PAYMENT_RESERVATION_EXPIRED");
      expect((await stateOf(seed.orderId, seed.productId)).status).toBe("pending_payment");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("the window written at creation is risk-based, stored and auditable", async () => {
    const { withTransaction, query } = await import("../db/index.js");

    // Scarce: 2 sellable units, no sales history → CRITICAL 15 min.
    const scarce = await seedOrder({ status: "pending", quantity: 1, reserved: 1, inventoryQuantity: 100 });
    await query(`UPDATE inventory SET reserved = 98 WHERE product_id = $1`, [scarce.productId]);
    try {
      const policy = await withTransaction((client) =>
        applyPaymentReservationPolicy(client, scarce.orderId, "CARD"),
      );
      expect(policy).not.toBeNull();
      expect(policy!.riskLevel).toBe("CRITICAL");
      expect(policy!.reservationMinutes).toBe(15);
      expect(policy!.signals.availableStock).toBe(2);

      const state = await stateOf(scarce.orderId, scarce.productId);
      expect(state.reservationPolicy).toMatchObject({ riskLevel: "CRITICAL", reservationMinutes: 15 });
      const deltaMinutes = (state.paymentExpiresAt!.getTime() - Date.now()) / 60_000;
      expect(deltaMinutes).toBeGreaterThan(13);
      expect(deltaMinutes).toBeLessThanOrEqual(15);
    } finally {
      await purgeUsers([scarce.ownerId, scarce.sellerUserId]);
    }

    // Deep stock, no demand → VERY_LOW 60 min.
    const deep = await seedOrder({ status: "pending", quantity: 1, reserved: 1, inventoryQuantity: 500 });
    try {
      const policy = await withTransaction((client) => applyPaymentReservationPolicy(client, deep.orderId, "PROMPTPAY"));
      expect(policy!.riskLevel).toBe("VERY_LOW");
      expect(policy!.reservationMinutes).toBe(60);
      const state = await stateOf(deep.orderId, deep.productId);
      expect(state.reservationPolicy).toMatchObject({ riskLevel: "VERY_LOW", reservationMinutes: 60 });
    } finally {
      await purgeUsers([deep.ownerId, deep.sellerUserId]);
    }

    // COD waits on no online payment: no window at all.
    const cod = await seedOrder({ status: "pending", quantity: 1, expiresInMs: null });
    try {
      const policy = await withTransaction((client) => applyPaymentReservationPolicy(client, cod.orderId, "COD"));
      expect(policy).toBeNull();
      const state = await stateOf(cod.orderId, cod.productId);
      expect(state.paymentExpiresAt).toBeNull();
      expect(state.reservationPolicy).toBeNull();
    } finally {
      await purgeUsers([cod.ownerId, cod.sellerUserId]);
    }
  });

  test("a SAVEPOINT keeps a failed reservation write from poisoning the checkout transaction", async () => {
    // Mechanics of the deploy-order shim in `applyPaymentReservationPolicy`: a
    // statement that fails with `undefined_column` must be recoverable, so the
    // order (and the customer's checkout) survives a backend that is newer than
    // its database. ANY other failure must still abort the transaction.
    const { withTransaction } = await import("../db/index.js");
    const seed = await seedOrder({ status: "pending" });
    try {
      const outcome = await withTransaction(async (client) => {
        await client.query("SAVEPOINT velnox_payment_reservation");
        let undefinedColumn = false;
        try {
          await client.query(`UPDATE orders SET definitely_not_a_column = 'x' WHERE id = $1`, [seed.orderId]);
        } catch (err) {
          undefinedColumn = isUndefinedColumnError(err);
          await client.query("ROLLBACK TO SAVEPOINT velnox_payment_reservation");
        }
        // The transaction is STILL USABLE — that is the point of the shim.
        const after = await client.query(`SELECT id, status FROM orders WHERE id = $1`, [seed.orderId]);
        await client.query(`UPDATE orders SET updated_at = NOW() WHERE id = $1`, [seed.orderId]);
        return { undefinedColumn, rows: after.rows.length, status: after.rows[0]?.status as string };
      });
      expect(outcome.undefinedColumn).toBe(true);
      expect(outcome.rows).toBe(1);
      expect(outcome.status).toBe("pending");
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("the expiry sweep only ever touches the pre-payment statuses it declares", async () => {
    // Belt and braces against a future edit widening the blast radius.
    expect([...PAYMENT_RESERVATION_EXPIRABLE_STATUSES]).toEqual(["pending", "pending_payment"]);
    for (const status of ["paid", "shipped", "delivered", "completed", "cancelled", "refunded"]) {
      const seed = await seedOrder({ status, quantity: 2, reserved: 0, payment: { status: "paid" } });
      try {
        const result = await expirePaymentReservation(seed.orderId);
        expect(result.outcome).toBe("skipped");
        const after = await stateOf(seed.orderId, seed.productId);
        expect(after.status).toBe(status);
        expect(after.reserved).toBe(0);
      } finally {
        await purgeUsers([seed.ownerId, seed.sellerUserId]);
      }
    }
  });
});
