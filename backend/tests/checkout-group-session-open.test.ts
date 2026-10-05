/**
 * OPENING A CHECKOUT SESSION — the multi-shop path, and what happens when the
 * database cannot record what Stripe returns.
 *
 * THE REPORTED SYMPTOM
 * --------------------
 *   • an order WAS created — `46d6e39b-e6f0-457b-86eb-58a09ae296b1`,
 *     number `017911592602649656`, PromptPay;
 *   • the storefront then said
 *       "สร้างคำสั่งซื้อแล้ว แต่ยังไม่ได้เริ่มการชำระเงิน"
 *       "Failed to create checkout session";
 *   • and offered "ลองชำระเงินอีกครั้ง".
 *
 * The message is the LAST line of a `catch`, not a diagnosis. It is identical
 * for every possible cause — a Stripe refusal, a schema error, a dead pool —
 * which is why the storefront's text alone cannot settle which one happened.
 *
 * THE ROOT CAUSE THIS FILE PINS (Case C)
 * --------------------------------------
 * The cart spans more than one shop, so the storefront always sends
 * `checkoutGroupId` and `POST /api/stripe/checkout` dispatches to
 * `openCheckoutGroupSession()`. That handler names `payments.checkout_group_id`
 * — a column added by `db/migrations/054_checkout_groups_numeric_order_number.sql`
 * §3 — as a bare COLUMN, in two statements:
 *
 *   1. the active-session lookup;
 *   2. the group `INSERT INTO payments (checkout_group_id, …)`.
 *
 * On a database without that column both raise `undefined_column` (42703). It is
 * a THROWN ERROR, not a NULL. Statement 2 runs AFTER
 * `stripe.checkout.sessions.create()`, which had already succeeded, so:
 *
 *   Stripe DID create a session      ← Case C, not Case A
 *     → the INSERT raises 42703
 *     → the outer catch answers 500 "Failed to create checkout session"
 *     → the customer is shown a failure for an order that exists
 *     → an OPEN session nobody holds is left at Stripe
 *     → pressing "try again" spends another one.
 *
 * The order and the `checkout_groups` row are created earlier, by
 * `POST /api/customer/checkout`, which does NOT need the column — which is
 * exactly why "the order was created" and "payment could not start" coexist.
 *
 * WHY THE EARLIER FIX DID NOT COVER IT
 * ------------------------------------
 * `checkoutGroupIdForAttempt()` (settlement) was made schema-tolerant with
 * `to_jsonb(p) ->> 'checkout_group_id'`. A READ can be phrased that way: it
 * yields NULL when the column is absent. A WRITE cannot — `INSERT INTO t (c,…)`
 * NAMES the column, so its absence is an error no matter how the read was
 * written. The group OPEN path therefore needs to know whether the column
 * exists BEFORE it asks Stripe for money.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   STATIC — the capability probe is consulted BEFORE `sessions.create`; the
 *   group write failure is logged WITH the session id and the session is
 *   expired rather than abandoned; the outer catch still returns the same
 *   generic message, so the fix adds observability without leaking anything;
 *   and no database transaction is held across the Stripe call.
 *
 *   LIVE (DB-gated) — the REAL route, driven with a stubbed Stripe client, for
 *   the six required regressions:
 *     1. first session creation succeeds (order, payment, session, URL);
 *     2. Stripe refuses → order remains, nothing is marked paid, the failure is
 *        recorded with `provider_request_id`, and a retry is safe;
 *     3. the session is created but the DB write fails → the session is EXPIRED
 *        and named in the log, and the retry produces exactly one live session;
 *     4. double-click → one session, one payment row, a replayable response;
 *     5. attempt A fails, B succeeds → B is authoritative and a LATE failure for
 *        A cannot undo it;
 *     6. PromptPay TEST → the request actually sent to Stripe carries THB, the
 *        server-derived minor amount and `payment_method_types: ["promptpay"]`.
 *
 * No network call is made and no payment is ever invented: the Stripe client is
 * replaced in-process and webhooks are signed locally against a disposable
 * TEST_DATABASE_URL. That is the suite's established substitute for a live round
 * trip — NOT a substitute for the real Stripe TEST E2E, which stays BLOCKED
 * without test credentials and a browser.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupStripeRoutes, __resetPaymentsGroupColumnCache } from "../routes/stripe.js";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const STRIPE_ROUTE = "backend/routes/stripe.ts";

const WEBHOOK_SECRET = "whsec_group_open_000000000000000";
// A key NO other suite uses. `getStripe()` caches one client per secret key for
// the whole process, and the sibling payment suites run against the real SDK —
// sharing their key would hand this suite their cached client instead of the
// stub, silently turning these tests back into live network calls.
const TEST_SECRET_KEY = "sk_test_group_open_000000000000000";
const TEST_PUBLISHABLE_KEY = "pk_test_group_open_000000000000000";

// ═══════════════════════════════════════════════════════════════════════════
// 1. STRUCTURE — the ordering and the boundaries the fix depends on
//    (static; runs in any workspace)
// ═══════════════════════════════════════════════════════════════════════════

/** The source of one top-level declaration, up to the next column-0 `}`. */
function bodyOf(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start, `missing declaration: ${declaration}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const end = rest.indexOf("\n}\n");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the group session is never opened before the database can record it", () => {
  test("the capability probe runs BEFORE sessions.create", () => {
    const stripe = read(STRIPE_ROUTE);
    const body = bodyOf(stripe, "async function openCheckoutGroupSession(");

    const probe = body.indexOf("paymentsCheckoutGroupColumnExists()");
    const create = body.indexOf("stripe.checkout.sessions.create(");
    expect(probe, "the group path must probe payments.checkout_group_id").toBeGreaterThanOrEqual(0);
    expect(create, "the group path must open a Stripe session").toBeGreaterThanOrEqual(0);
    expect(
      probe,
      "the probe must come first — a session opened before we know it can be " +
        "recorded is the orphan this whole incident produced",
    ).toBeLessThan(create);

    // …and the refusal is a 503 with its own code, not a generic 500: it is a
    // deploy-order condition, and it must not look like a Stripe failure.
    const guard = body.slice(probe, create);
    expect(guard).toContain('"CHECKOUT_GROUP_UNAVAILABLE"');
    expect(guard).toContain("503");
    expect(guard).toContain('stage: "group_column_missing"');
  });

  test("the probe reads the CATALOGUE, so it is true on an empty payments table", () => {
    const probe = bodyOf(read(STRIPE_ROUTE), "async function paymentsCheckoutGroupColumnExists(");
    expect(probe).toContain("pg_attribute");
    expect(probe).toContain("attrelid = 'payments'::regclass");
    expect(probe).toContain("attname = 'checkout_group_id'");
    // Probing a ROW would answer "absent" simply because no group payment had
    // been written yet — the exact production shape.
    expect(probe, "the probe must not read the payments TABLE").not.toMatch(/FROM\s+payments\b/);
  });

  test("a group write failure is recorded WITH the session id, and the session is closed", () => {
    const body = bodyOf(read(STRIPE_ROUTE), "async function openCheckoutGroupSession(");
    const insert = body.indexOf("INSERT INTO payments");
    const catchAt = body.indexOf("stage: \"group_payment_insert\"", insert);
    expect(insert, "the group payment row is still written by name").toBeGreaterThanOrEqual(0);
    expect(catchAt, "the insert failure must be logged, not swallowed").toBeGreaterThan(insert);
    // The session id is what makes the orphan findable in the Stripe dashboard.
    expect(body.slice(catchAt, catchAt + 400)).toContain("sessionId: session.id");
    // …and the session is closed rather than left payable.
    expect(body.slice(catchAt, catchAt + 800)).toContain("stripe.checkout.sessions.expire(session.id)");
    // The original error still propagates: no silent success.
    expect(body.slice(catchAt, catchAt + 800)).toContain("throw err");
  });

  test("failures are logged with the fields needed to find the Stripe call", () => {
    const fn = bodyOf(read(STRIPE_ROUTE), "function logCheckoutSessionFailure(");
    for (const field of [
      "failure_stage",
      "provider",
      "occurred_at",
      "order_id",
      "checkout_group_id",
      "method",
      "currency",
      "amount_minor",
      "stripe_session_id",
      "provider_error_type",
      "provider_error_code",
      "provider_http_status",
      "provider_request_id",
      "provider_error_param",
      "provider_error_message",
    ]) {
      expect(fn, `structured failure log is missing ${field}`).toContain(field);
    }
    // …and it logs a JSON LINE, so one log search finds that one Stripe call.
    expect(fn).toContain("checkout_session_failed");
    expect(fn).toContain("JSON.stringify(detail)");
  });

  test("the client still receives ONLY the generic message", () => {
    const stripe = read(STRIPE_ROUTE);
    // Observability must not become disclosure. The logger is the ONLY place
    // the Stripe envelope appears, and it has no way to reach a response: it
    // cannot name a request id, an order id or a status to the browser.
    const logger = bodyOf(stripe, "function logCheckoutSessionFailure(");
    expect(logger).not.toContain("res.");
    expect(logger).not.toContain("fail(");
    expect(logger).toContain("console.error");

    const refusals = [...stripe.matchAll(/fail\(res, 500, "STRIPE_ERROR", "([^"]+)"\)/g)].map((m) => m[1]);
    expect(refusals).toContain("Failed to create checkout session");
    // No customer-facing message gained the provider's detail.
    for (const message of refusals) expect(message).not.toMatch(/request_id|param|column|stripe_session/i);
  });

  test("no database transaction is held across the Stripe call", () => {
    const stripe = read(STRIPE_ROUTE);
    for (const declaration of ["async function openCheckoutGroupSession(", `app.post("/api/stripe/checkout"`]) {
      const body = bodyOf(stripe, declaration);
      expect(
        /BEGIN|COMMIT|ROLLBACK|withTransaction\(/.test(body),
        `${declaration} must not open a transaction — a BEGIN held across the ` +
          `Stripe network call pins a pool connection for the provider's latency`,
      ).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE SIX REQUIRED REGRESSIONS, against the real route
// ═══════════════════════════════════════════════════════════════════════════

interface FakeSession {
  id: string;
  url: string;
  status: "open" | "expired" | "complete";
  payment_intent: string | null;
  expires_at: number;
  metadata: Record<string, string>;
}

const fake = {
  created: [] as Array<Record<string, unknown>>,
  expired: [] as string[],
  sessions: new Map<string, FakeSession>(),
  failNextCreate: null as Error | null,
};

function resetFake(): void {
  fake.created = [];
  fake.expired = [];
  fake.sessions.clear();
  fake.failNextCreate = null;
}

/** Stripe's own error envelope shape, which the log has to survive. */
function stripeError(overrides: Record<string, unknown>): Error {
  const err = new Error(String(overrides.message ?? "Stripe rejected the request"));
  return Object.assign(err, {
    type: "StripeAPIError",
    code: "api_error",
    statusCode: 500,
    requestId: "req_unknown",
    param: undefined,
    ...overrides,
  });
}

/** The REAL SDK constructor, captured before the module is replaced. */
let RealStripe: (new (key: string, options?: unknown) => unknown) | null = null;

/**
 * The Stripe client, replaced in-process. Every call the OPEN path makes is one
 * of `checkout.sessions.create / retrieve / expire`, so this is the whole
 * surface: nothing reaches the network and nothing is invented at the route
 * boundary.
 *
 * Anything ELSE — `webhooks.constructEventAsync` above all — falls through to
 * the REAL SDK client. A module mock in `bun test` lasts for the whole process,
 * so a stub that swallowed the webhook verifier would silently break the
 * sibling suites that verify signatures for real.
 */
class FakeStripe {
  checkout = {
    sessions: {
      create: async (params: Record<string, unknown>): Promise<FakeSession> => {
        fake.created.push(params);
        if (fake.failNextCreate) {
          const err = fake.failNextCreate;
          fake.failNextCreate = null;
          throw err;
        }
        const id = `cs_test_${crypto.randomUUID().replace(/-/g, "")}`;
        const session: FakeSession = {
          id,
          url: `https://checkout.stripe.com/c/pay/${id}#fidk2Xx`,
          status: "open",
          payment_intent: `pi_test_${crypto.randomUUID().replace(/-/g, "")}`,
          expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
          metadata: (params.metadata ?? {}) as Record<string, string>,
        };
        fake.sessions.set(id, session);
        return session;
      },
      retrieve: async (id: string): Promise<FakeSession> => {
        const session = fake.sessions.get(id);
        if (!session) throw stripeError({ type: "StripeInvalidRequestError", code: "resource_missing", message: `No such checkout.session: ${id}` });
        return session;
      },
      expire: async (id: string): Promise<FakeSession> => {
        const session = fake.sessions.get(id);
        if (!session) throw stripeError({ type: "StripeInvalidRequestError", code: "resource_missing", message: `No such checkout.session: ${id}` });
        session.status = "expired";
        fake.expired.push(id);
        return session;
      },
    },
  };

  key: string;
  options: unknown;
  private real: any;

  constructor(key: string, options: unknown) {
    this.key = key;
    this.options = options;
    this.real = RealStripe ? new RealStripe(key, options) : null;
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) return Reflect.get(target, prop);
        const value = target.real?.[prop];
        return typeof value === "function" ? value.bind(target.real) : value;
      },
    }) as FakeStripe;
  }
}

// Installed from `beforeAll`, not at module scope: `bun test` loads every file
// before it runs any test, so a top-level patch here races the other suites'
// imports of the same SDK. The route constructs its client lazily per request,
// so patching before the first request is what matters — and the real
// constructor is captured first so everything this stub does not cover (the
// webhook signature verifier) keeps working for the other suites.
const installFakeStripe = async () => {
  if (!RealStripe) RealStripe = (await import("stripe")).default as never;
  mock.module("stripe", () => ({ default: FakeStripe }));
};

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

/** A trigger that reproduces the production 42703 on the group payment write. */
const FAILING_INSERT_TRIGGER = "velnox_test_group_insert_failure";

describeDb("opening a checkout session (requires TEST_DATABASE_URL)", () => {
  const ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "VITE_VELSHOP_URL",
  ] as const;
  const saved: Record<string, string | undefined> = {};
  const fixtureUsers: Array<string | null> = [];

  beforeAll(async () => {
    await installFakeStripe();
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.STRIPE_SECRET_KEY = TEST_SECRET_KEY;
    process.env.STRIPE_PUBLISHABLE_KEY = TEST_PUBLISHABLE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.VITE_VELSHOP_URL = "https://velshop.test";
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await purgeUsers(fixtureUsers);
  });

  let consoleErrors: string[] = [];
  const realConsoleError = console.error;

  beforeEach(() => {
    resetFake();
    consoleErrors = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  });

  afterEach(async () => {
    console.error = realConsoleError;
    await purgeUsers(fixtureUsers.splice(0));
  });

  /** Every structured checkout failure logged during the last test. */
  function failureLines(): Array<Record<string, unknown>> {
    return consoleErrors
      .filter((line) => line.includes("checkout_session_failed"))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)) as Record<string, unknown>);
  }

  async function seedShop(tag: string, name: string): Promise<{ sellerUserId: string; shopId: string }> {
    const { query } = await import("../db/index.js");
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-${name}@test.local`,
      `Session Seller ${name}`,
    ]);
    fixtureUsers.push(sellerUser.rows[0].id as string);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} ${name}`,
      `${tag}-${name}`,
    ]);
    return { sellerUserId: sellerUser.rows[0].id as string, shopId: shop.rows[0].id as string };
  }

  /**
   * A MULTI-SHOP checkout exactly as `POST /api/customer/checkout` leaves it:
   * one `checkout_groups` parent and N per-shop orders in `pending`, each with a
   * line item and reserved stock. Total 360.00 THB across the group.
   */
  async function seedGroupCheckout() {
    const { query } = await import("../db/index.js");
    const tag = `grp-${crypto.randomUUID().slice(0, 8)}`;
    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Group Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    fixtureUsers.push(ownerId);

    const orderIds: string[] = [];
    const productIds: string[] = [];
    for (const [index, name] of ["alpha", "beta"].entries()) {
      const { shopId } = await seedShop(tag, name);
      const product = await query(
        `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
         VALUES ($1, $2, $3, 120.00, 'published', 0) RETURNING id`,
        [shopId, `${tag} ${name} product`, `${tag}-${name}-p`],
      );
      const productId = product.rows[0].id as string;
      productIds.push(productId);
      await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, 3)`, [productId]);

      const order = await query(
        `INSERT INTO orders
           (user_id, shop_id, order_number, status, subtotal, total_amount, currency,
            inventory_released, payment_expires_at)
         VALUES ($1, $2, $3, 'pending', 180.00, 180.00, 'THB', FALSE, NOW() + INTERVAL '30 minutes')
         RETURNING id`,
        [ownerId, shopId, `G-${tag.slice(-6)}-${index}`],
      );
      const orderId = order.rows[0].id as string;
      orderIds.push(orderId);
      await query(
        `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
         VALUES ($1, $2, $3, $4, 3, 120.00, 360.00)`,
        [orderId, productId, shopId, `${tag} ${name} product`],
      );
    }

    const group = await query(
      `INSERT INTO checkout_groups (user_id, total_amount, currency, item_count, shop_count)
       VALUES ($1, 360.00, 'THB', 6, 2) RETURNING id`,
      [ownerId],
    );
    const groupId = group.rows[0].id as string;
    await query(`UPDATE orders SET checkout_group_id = $1 WHERE id = ANY($2::uuid[])`, [groupId, orderIds]);

    return { tag, ownerId, groupId, orderIds, productIds, total: 360 };
  }

  /** A single-shop order, for the attempt A/B webhook sequence. */
  async function seedSingleOrder() {
    const { query } = await import("../db/index.js");
    const tag = `sgl-${crypto.randomUUID().slice(0, 8)}`;
    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Single Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    fixtureUsers.push(ownerId);
    const { shopId } = await seedShop(tag, "solo");
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, 360.00, 'published', 0) RETURNING id`,
      [shopId, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, 3)`, [productId]);
    const order = await query(
      `INSERT INTO orders
         (user_id, shop_id, order_number, status, subtotal, total_amount, currency,
          inventory_released, payment_expires_at)
       VALUES ($1, $2, $3, 'pending', 360.00, 360.00, 'THB', FALSE, NOW() + INTERVAL '30 minutes')
       RETURNING id`,
      [ownerId, shopId, `S-${tag.slice(-6)}`],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, 3, 360.00, 1080.00)`,
      [orderId, productId, shopId, `${tag} product`],
    );
    return { tag, ownerId, orderId, productId, total: 360 };
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

  async function openSession(
    userId: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, any> }> {
    return withServer(async (base) => {
      const token = jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, any> };
    });
  }

  /** Stripe's own signature scheme, computed locally — no network, no SDK. */
  function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
  }

  async function deliverWebhook(event: Record<string, unknown>): Promise<number> {
    const payload = JSON.stringify(event);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET) },
        body: payload,
      });
      if (res.status !== 200) {
        throw new Error(`webhook ${event.type} → ${res.status} ${await res.text()}`);
      }
      return res.status;
    });
  }

  const intentEvent = (type: string, orderId: string, intentId: string, lastPaymentError?: Record<string, string>) => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type,
    data: {
      object: {
        id: intentId,
        object: "payment_intent",
        metadata: { orderId },
        ...(lastPaymentError ? { last_payment_error: lastPaymentError } : {}),
      },
    },
  });

  async function stateOf(orderIds: string[]) {
    const { query } = await import("../db/index.js");
    const orders = await query(`SELECT id, status FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [orderIds]);
    return Object.fromEntries(orders.rows.map((r) => [r.id as string, r.status as string]));
  }

  async function groupPayments(groupId: string) {
    const { query } = await import("../db/index.js");
    const res = await query(
      `SELECT id, status, amount, currency, method, provider,
              provider_checkout_session_id, provider_payment_id, paid_at
         FROM payments WHERE checkout_group_id = $1 ORDER BY created_at ASC, id ASC`,
      [groupId],
    );
    return res.rows as Array<{
      id: string;
      status: string;
      amount: string;
      currency: string;
      method: string;
      provider: string;
      provider_checkout_session_id: string | null;
      provider_payment_id: string | null;
      paid_at: Date | null;
    }>;
  }

  async function activeCount(where: string, value: string, column = "checkout_group_id"): Promise<number> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `SELECT COUNT(*)::int AS n FROM payments
        WHERE ${column} = $1 AND provider = 'stripe' AND status IN ('pending', 'requires_action')`,
      [value],
    );
    return Number(res.rows[0].n);
  }

  // ── Test 1 + Test 6 ────────────────────────────────────────────────────

  testFn("Test 1/6: a PromptPay multi-shop checkout opens one session the storefront can use", async () => {
    const { ownerId, groupId, orderIds, total } = await seedGroupCheckout();

    const res = await openSession(ownerId, {
      checkoutGroupId: groupId,
      method: "PROMPTPAY",
      requestKey: crypto.randomUUID(),
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.url, "the storefront needs a URL to redirect to").toBeTruthy();
    expect(String(data.sessionId)).toMatch(/^cs_test_/);
    expect(data.reused).toBe(false);
    expect(data.currency).toBe("THB");
    expect(Number(data.amount)).toBe(total);

    // Order → pending_payment for the WHOLE purchase, not one shop.
    expect(await stateOf(orderIds)).toEqual(
      Object.fromEntries(orderIds.map((id) => [id, "pending_payment"])),
    );

    const payments = await groupPayments(groupId);
    expect(payments, "the payment attempt must exist").toHaveLength(1);
    expect(payments[0]!.status).toBe("requires_action");
    expect(payments[0]!.method).toBe("PROMPTPAY");
    expect(payments[0]!.provider).toBe("stripe");
    expect(payments[0]!.provider_checkout_session_id).toBe(data.sessionId);
    expect(Number(payments[0]!.amount)).toBe(total);
    expect(payments[0]!.paid_at, "opening a session is not paying").toBeNull();

    // ── the request Stripe actually received (Test 6) ──
    expect(fake.created).toHaveLength(1);
    const sent = fake.created[0]!;
    expect(sent.mode).toBe("payment");
    expect(sent.payment_method_types).toEqual(["promptpay"]);
    expect(sent.customer_creation).toBe("always");
    expect(sent.allow_promotion_codes).toBe(true);

    const lines = sent.line_items as Array<{ price_data: { currency: string; unit_amount: number }; quantity: number }>;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.price_data.currency).toBe("thb");
    const charged = lines.reduce((sum, l) => sum + l.price_data.unit_amount * l.quantity, 0);
    expect(charged, "THB minor units, summed from the request").toBe(total * 100);

    // Server-derived, not client-derived: the URLs carry the group and the
    // representative order, and the metadata identifies this purchase.
    expect(String(sent.success_url)).toContain(`group=${groupId}`);
    expect(String(sent.success_url)).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(String(sent.cancel_url)).toContain(`group=${groupId}`);
    expect(sent.metadata).toMatchObject({ checkoutGroupId: groupId, method: "PROMPTPAY", provider: "stripe" });
    expect(sent.payment_intent_data).toMatchObject({ metadata: { checkoutGroupId: groupId, method: "PROMPTPAY" } });
  });

  testFn("the amount sent to Stripe is the DATABASE total, whatever the client claims", async () => {
    const { ownerId, groupId } = await seedGroupCheckout();
    await openSession(ownerId, {
      checkoutGroupId: groupId,
      method: "PROMPTPAY",
      requestKey: crypto.randomUUID(),
      // A hostile or stale client figure — none of it may reach Stripe.
      amount: 1,
      total_amount: 1,
      orderId: crypto.randomUUID(),
    });
    const lines = fake.created[0]!.line_items as Array<{ price_data: { unit_amount: number }; quantity: number }>;
    expect(lines.reduce((s, l) => s + l.price_data.unit_amount * l.quantity, 0)).toBe(36000);
  });

  // ── Test 2 ─────────────────────────────────────────────────────────────

  testFn("Test 2: Stripe refuses → nothing is paid, the failure is findable, a retry is safe", async () => {
    const { ownerId, groupId, orderIds } = await seedGroupCheckout();
    fake.failNextCreate = stripeError({
      type: "StripeInvalidRequestError",
      code: "parameter_unknown",
      statusCode: 400,
      requestId: "req_refused_probe",
      param: "payment_method_types[0]",
      message: "No such PaymentMethodType: 'promptpay'",
    });

    const failed = await openSession(ownerId, {
      checkoutGroupId: groupId,
      method: "PROMPTPAY",
      requestKey: crypto.randomUUID(),
    });
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe("STRIPE_ERROR");

    // The order survives and stays payable; nothing claims to be paid.
    expect(await stateOf(orderIds)).toEqual(
      Object.fromEntries(orderIds.map((id) => [id, "pending"])),
    );
    expect(await groupPayments(groupId), "a refused create must not leave an attempt").toHaveLength(0);

    // The whole point of requirement 3: the generic message the customer sees
    // is now backed by the Stripe envelope that actually explains it.
    const [failure] = failureLines();
    expect(failure).toBeDefined();
    expect(failure!.failure_stage).toBe("group_session_create");
    expect(failure!.provider_error_type).toBe("StripeInvalidRequestError");
    expect(failure!.provider_error_code).toBe("parameter_unknown");
    expect(failure!.provider_http_status).toBe("400");
    expect(failure!.provider_request_id).toBe("req_refused_probe");
    expect(failure!.provider_error_param).toBe("payment_method_types[0]");
    expect(failure!.checkout_group_id).toBe(groupId);
    expect(failure!.amount_minor).toBe(36000);
    expect(failure!.provider).toBe("stripe");
    expect(typeof failure!.occurred_at).toBe("string");

    // Retry — what "ลองชำระเงินอีกครั้ง" does — succeeds, with no leftover state.
    const retried = await openSession(ownerId, {
      checkoutGroupId: groupId,
      method: "PROMPTPAY",
      requestKey: crypto.randomUUID(),
    });
    expect(retried.status).toBe(200);
    expect(await activeCount("checkout_group_id", groupId)).toBe(1);
  });

  // ── Test 3 ─────────────────────────────────────────────────────────────

  testFn("Test 3: the session exists but the payment row cannot be written → no orphan, no duplicate", async () => {
    const { query } = await import("../db/index.js");
    const { ownerId, groupId, orderIds } = await seedGroupCheckout();

    // The production failure, reproduced exactly: 42703 on the group INSERT,
    // raised AFTER Stripe has already opened the session.
    await query(`DROP TRIGGER IF EXISTS ${FAILING_INSERT_TRIGGER} ON payments`);
    await query(`CREATE OR REPLACE FUNCTION ${FAILING_INSERT_TRIGGER}_fn() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'column "checkout_group_id" does not exist'
          USING ERRCODE = '42703', COLUMN = 'checkout_group_id';
      END $$ LANGUAGE plpgsql`);
    await query(
      `CREATE TRIGGER ${FAILING_INSERT_TRIGGER} BEFORE INSERT ON payments
         FOR EACH ROW WHEN (NEW.checkout_group_id IS NOT NULL)
         EXECUTE FUNCTION ${FAILING_INSERT_TRIGGER}_fn()`,
    );

    try {
      const res = await openSession(ownerId, {
        checkoutGroupId: groupId,
        method: "PROMPTPAY",
        requestKey: crypto.randomUUID(),
      });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("STRIPE_ERROR");

      // Stripe DID create a session (Case C) — but it must not stay payable.
      expect(fake.created, "Stripe was asked for a session").toHaveLength(1);
      const [orphan] = [...fake.sessions.values()];
      expect(orphan, "a session exists at Stripe").toBeDefined();
      expect(fake.expired, "the abandoned session is expired, not left open").toContain(orphan!.id);
      expect(orphan!.status).toBe("expired");

      // …and it is NAMED, so an operator can find it in the Stripe dashboard.
      const [failure] = failureLines();
      expect(failure!.failure_stage).toBe("group_payment_insert");
      expect(failure!.stripe_session_id).toBe(orphan!.id);
      // 42703 is the production error code, recorded verbatim.
      expect(failure!.provider_error_code).toBe("42703");
      expect(failure!.provider_error_message).toContain("checkout_group_id");
      expect(failure!.checkout_group_id).toBe(groupId);
      expect(failure!.amount_minor).toBe(36000);

      // Nothing was recorded, so the retry is not a duplicate of anything.
      expect(await groupPayments(groupId)).toHaveLength(0);
      expect(await stateOf(orderIds)).toEqual(
        Object.fromEntries(orderIds.map((id) => [id, "pending"])),
      );
    } finally {
      await query(`DROP TRIGGER IF EXISTS ${FAILING_INSERT_TRIGGER} ON payments`);
      await query(`DROP FUNCTION IF EXISTS ${FAILING_INSERT_TRIGGER}_fn()`);
    }

    // With the schema repaired, the retry reconciles onto exactly ONE attempt
    // and one live session — the earlier orphan stays closed.
    const retried = await openSession(ownerId, {
      checkoutGroupId: groupId,
      method: "PROMPTPAY",
      requestKey: crypto.randomUUID(),
    });
    expect(retried.status).toBe(200);
    const payments = await groupPayments(groupId);
    expect(payments).toHaveLength(1);
    expect(await activeCount("checkout_group_id", groupId)).toBe(1);
    const live = [...fake.sessions.values()].filter((s) => s.status === "open");
    expect(live, "exactly one live session survives the retry").toHaveLength(1);
    expect(live[0]!.id).toBe(payments[0]!.provider_checkout_session_id);
  });

  // ── Test 4 ─────────────────────────────────────────────────────────────

  testFn("Test 4: double-clicking pay opens ONE session and ONE attempt", async () => {
    const { ownerId, groupId } = await seedGroupCheckout();
    const requestKey = crypto.randomUUID();

    // Two clicks of the same button carry the same request key — exactly what
    // the storefront sends (one key per ATTEMPT, reused across the clicks).
    const [first, second] = await Promise.all([
      openSession(ownerId, { checkoutGroupId: groupId, method: "PROMPTPAY", requestKey }),
      openSession(ownerId, { checkoutGroupId: groupId, method: "PROMPTPAY", requestKey }),
    ]);

    expect(fake.created, "the provider must be called once for one attempt").toHaveLength(1);
    expect(await groupPayments(groupId), "no duplicate payment attempt").toHaveLength(1);
    expect(await activeCount("checkout_group_id", groupId)).toBe(1);

    // The request key is CLAIMED on this path too. Without the claim there is
    // no durable record of the attempt, so the replay below could only ever be
    // served by the active-session lookup — which says nothing about a request
    // that arrives in the window before the first INSERT commits.
    const { query } = await import("../db/index.js");
    const claim = await query(
      `SELECT response FROM checkout_requests WHERE user_id = $1 AND scope = 'payment' AND request_key = $2`,
      [ownerId, requestKey],
    );
    expect(claim.rows, "the group path must claim the request key").toHaveLength(1);
    expect(claim.rows[0].response, "and snapshot the response so a replay is exact").toBeTruthy();

    // Both clicks answer from the same attempt: either the stored replay, or
    // the honest "already being prepared" refusal while the first is in flight.
    for (const res of [first!, second!]) {
      expect([200, 409]).toContain(res.status);
      if (res.status === 409) expect(res.body.error.code).toBe("DUPLICATE_PAYMENT_IN_PROGRESS");
    }
    const ok = [first!, second!].find((r) => r.status === 200);
    expect(ok, "one click must succeed").toBeDefined();
    // The click that succeeded is pointing at the ONE session that exists.
    expect(String(ok!.body.data.sessionId)).toBe((await groupPayments(groupId))[0]!.provider_checkout_session_id);

    // A later retry with the SAME key replays the stored response instead of
    // opening another session — that is what makes the button safe.
    const replay = await openSession(ownerId, { checkoutGroupId: groupId, method: "PROMPTPAY", requestKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data.sessionId).toBe(ok!.body.data.sessionId);
    expect(fake.created, "a replay never reaches Stripe").toHaveLength(1);
    expect(await groupPayments(groupId)).toHaveLength(1);
  });

  // ── Test 5 ─────────────────────────────────────────────────────────────

  testFn("Test 5: attempt A fails, B succeeds, and a LATE failure for A cannot undo B", async () => {
    const { query } = await import("../db/index.js");
    const { ownerId, orderId } = await seedSingleOrder();

    // Attempt A, opened by the real route.
    const a = await openSession(ownerId, { orderId, method: "PROMPTPAY", requestKey: crypto.randomUUID() });
    expect(a.status).toBe(200);
    const attemptA = (
      await query(`SELECT id, provider_payment_id, provider_checkout_session_id FROM payments WHERE order_id = $1`, [orderId])
    ).rows[0];

    // A's session goes stale at Stripe (the customer wandered off). Retrying is
    // the route's own retirement path: A becomes terminal, B is opened, and the
    // ORDER STAYS PAYABLE — which is exactly the "attempt A failed, attempt B
    // succeeds" sequence production sees.
    const staleSession = fake.sessions.get(attemptA.provider_checkout_session_id)!;
    staleSession.status = "expired";

    const b = await openSession(ownerId, { orderId, method: "PROMPTPAY", requestKey: crypto.randomUUID() });
    expect(b.status).toBe(200);
    expect(String(b.body.data.sessionId)).not.toBe(String(a.body.data.sessionId));
    const attemptB = (
      await query(
        `SELECT id, provider_payment_id FROM payments WHERE order_id = $1 AND id <> $2 LIMIT 1`,
        [orderId, attemptA.id],
      )
    ).rows[0];
    expect(attemptB, "a second attempt must exist").toBeDefined();
    const retired = await query(`SELECT status, failure_code FROM payments WHERE id = $1`, [attemptA.id]);
    expect(retired.rows[0].status).toBe("failed");
    expect(retired.rows[0].failure_code).toBe("SESSION_NOT_REUSABLE");

    // B is the attempt that succeeds — and only the webhook may say so.
    expect(await deliverWebhook(intentEvent("payment_intent.succeeded", orderId, attemptB.provider_payment_id))).toBe(200);
    const settled = await query(`SELECT status, paid_at FROM payments WHERE id = $1`, [attemptB.id]);
    expect(settled.rows[0].status).toBe("paid");
    expect(settled.rows[0].paid_at).not.toBeNull();
    expect((await stateOf([orderId]))[orderId]).toBe("paid");

    // Stripe delivers the OLD failure for A afterwards — out of order, or as a
    // redelivery of an event it had queued while B was in flight.
    expect(
      await deliverWebhook(
        intentEvent("payment_intent.payment_failed", orderId, attemptA.provider_payment_id, {
          code: "payment_intent_payment_attempt_failed",
          message: "The customer declined the payment.",
        }),
      ),
    ).toBe(200);

    const finalOrder = await stateOf([orderId]);
    const finalPayments = await query(`SELECT id, status, paid_at FROM payments WHERE order_id = $1`, [orderId]);
    const byId = Object.fromEntries(finalPayments.rows.map((r) => [r.id as string, r]));
    expect(finalOrder[orderId], "a late failure must not un-pay a settled order").toBe("paid");
    expect(byId[attemptB.id].status, "B stays authoritative").toBe("paid");
    expect(byId[attemptB.id].paid_at).not.toBeNull();
    expect(byId[attemptA.id].status, "A stays failed and never becomes authoritative").toBe("failed");
  });

  // ── the refusal this incident actually needs ───────────────────────────

  testFn("a database that cannot record a group payment refuses BEFORE Stripe is asked", async () => {
    const { query } = await import("../db/index.js");
    const { ownerId, groupId } = await seedGroupCheckout();

    // Make the capability probe report the pre-054 schema without touching the
    // real column: the probe reads the CATALOGUE, so hiding it there is the
    // faithful simulation of a database that never ran migration 054 §3.
    await query(`ALTER TABLE payments RENAME COLUMN checkout_group_id TO checkout_group_id_hidden`);
    // The probe caches its answer for the process (a migration, not traffic,
    // changes it), so the cache must be re-read around the simulation.
    __resetPaymentsGroupColumnCache();
    try {
      const res = await openSession(ownerId, {
        checkoutGroupId: groupId,
        method: "PROMPTPAY",
        requestKey: crypto.randomUUID(),
      });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("CHECKOUT_GROUP_UNAVAILABLE");
      // The decisive assertion: no session was ever opened, so there is nothing
      // at Stripe that could take money and nothing to reconcile later.
      expect(fake.created, "Stripe must not be called when the row cannot be written").toHaveLength(0);
      expect([...fake.sessions.values()]).toHaveLength(0);

      const [failure] = failureLines();
      expect(failure!.failure_stage).toBe("group_column_missing");
      expect(failure!.checkout_group_id).toBe(groupId);
      expect(failure!.provider_error_message).toContain("checkout_group_id");
    } finally {
      await query(`ALTER TABLE payments RENAME COLUMN checkout_group_id_hidden TO checkout_group_id`);
      __resetPaymentsGroupColumnCache();
    }
  });
});
