/**
 * Payment foundation tests — Stripe TEST MODE, Card/PromptPay, webhook
 * signature + idempotency, and the DISABLED Cash-on-Delivery rail.
 *
 * Three layers, matching what each one can actually prove without a database:
 *
 *   1. **Configuration (pure).** Test/live classification, fail-closed COD
 *      flags, method normalization, and the method guard every route runs.
 *      These run everywhere, including a sandbox with no credentials.
 *   2. **HTTP (no DB, no fixture).** The webhook endpoint's refusal paths and
 *      the payment/checkout endpoints' rejection of a disabled method. Every
 *      one of these is settled before any database or provider call, which is
 *      exactly the property being asserted — a forged webhook or a direct
 *      `method=COD` call must be refused without touching an order.
 *   3. **Database-gated.** Webhook idempotency across two deliveries of the
 *      same event id. Skipped unless `TEST_DATABASE_URL` names a disposable
 *      database (see `.ai/context/testing.md`).
 *
 * No test here calls Stripe: no live credential, no real card, no real money.
 * The signature used in the webhook tests is computed locally with the same
 * HMAC scheme Stripe uses, against a fake `whsec_` value.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { createHmac, randomUUID } from "crypto";
import {
  assertPaymentMethodUsable,
  classifyStripePublishableKey,
  classifyStripeSecretKey,
  customerSelectablePaymentMethods,
  isCodCustomerSelectable,
  isCodEnabled,
  normalizePaymentMethod,
  paymentMethodOptions,
  stripePaymentMethodType,
  stripeStatus,
} from "../lib/payment-config.js";
import { setupCartRoutes } from "../routes/cart.js";
import { buildCheckoutLineItems, refundableMinorFor, sessionConfirmsPayment, setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";
const JWT_SECRET = process.env.JWT_SECRET;

/** Every environment variable these tests own. Cleared before each test. */
const PAYMENT_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MODE",
  "COD_ENABLED",
  "COD_CUSTOMER_SELECTABLE",
] as const;

/** A plausible test key. It is NOT a real credential and is never sent anywhere. */
const TEST_SECRET = "sk_test_000000000000000000000000";
const TEST_PUBLISHABLE = "pk_test_000000000000000000000000";
const TEST_WEBHOOK_SECRET = "whsec_000000000000000000000000";

const TEST_STRIPE_ENV = {
  STRIPE_SECRET_KEY: TEST_SECRET,
  STRIPE_PUBLISHABLE_KEY: TEST_PUBLISHABLE,
  STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
};

function setPaymentEnv(values: Record<string, string> = {}): void {
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

beforeEach(() => setPaymentEnv());
afterEach(() => setPaymentEnv());

// ─── HTTP harness ───────────────────────────────────────────────────────────

function buildApp(): express.Express {
  const app = express();
  // Mirror server.ts: the Stripe webhook must see the RAW body for signature
  // verification, so it is parsed before express.json.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/payments/stripe/webhook" && req.method === "POST") {
      express.raw({ type: "application/json" })(req, res, next);
      return;
    }
    next();
  });
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

/** A session token. Deliberately WITHOUT a `jti`: revocation then needs no DB. */
function makeToken(userId = "user-payment-test"): string {
  return jwt.sign({ userId, email: `${userId}@test.local` }, JWT_SECRET, { expiresIn: "1h" });
}

/** Stripe's own signature scheme, computed locally — no network, no SDK. */
function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Stripe configuration — TEST MODE ONLY
// ═══════════════════════════════════════════════════════════════════════════

describe("stripe configuration", () => {
  test("no configuration at all means payments are unavailable (never a fallback)", () => {
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.mode).toBeNull();
    expect(status.reason).toBe("STRIPE_NOT_CONFIGURED");
    expect(status.publishableKey).toBeNull();
  });

  test("a test secret key with a webhook secret is usable and reported as test mode", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const status = stripeStatus();
    expect(status.usable).toBe(true);
    expect(status.mode).toBe("test");
    expect(status.reason).toBeNull();
    expect(status.webhookConfigured).toBe(true);
  });

  test("a LIVE secret key is refused, not used", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_SECRET_KEY: "sk_live_000000000000000000000000" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_LIVE_KEY_REFUSED");
    // A live publishable key must not be handed to a browser either.
    expect(status.publishableKey).toBeNull();
  });

  test("a live publishable key alone never makes the deployment usable", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_PUBLISHABLE_KEY: "pk_live_000000000000000000000000" });
    const status = stripeStatus();
    expect(status.usable).toBe(true); // the SECRET is still a test key
    expect(status.publishableKey).toBeNull();
    expect(status.publishableKeyMatchesMode).toBe(false);
  });

  test("an unrecognized secret key shape is refused rather than attempted", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_SECRET_KEY: "not-a-stripe-key" });
    expect(stripeStatus().usable).toBe(false);
    expect(stripeStatus().reason).toBe("STRIPE_KEY_UNRECOGNIZED");
  });

  test("a missing webhook secret makes payments unavailable (they could not be confirmed)", () => {
    setPaymentEnv({ STRIPE_SECRET_KEY: TEST_SECRET, STRIPE_PUBLISHABLE_KEY: TEST_PUBLISHABLE });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_WEBHOOK_NOT_CONFIGURED");
  });

  test("an explicit non-test STRIPE_MODE is refused even with a test key", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_MODE: "live" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_MODE_MISMATCH");
  });

  test("explicit STRIPE_MODE=test is accepted", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_MODE: "test" });
    expect(stripeStatus().usable).toBe(true);
  });

  test("key classification distinguishes test, live, and unusable", () => {
    expect(classifyStripeSecretKey("sk_test_abc")).toBe("test");
    expect(classifyStripeSecretKey("rk_test_abc")).toBe("test");
    expect(classifyStripeSecretKey("sk_live_abc")).toBe("live");
    expect(classifyStripeSecretKey("rk_live_abc")).toBe("live");
    expect(classifyStripeSecretKey("sk_abc")).toBeNull();
    expect(classifyStripeSecretKey("")).toBeNull();
    expect(classifyStripeSecretKey(null)).toBeNull();
    expect(classifyStripePublishableKey("pk_test_abc")).toBe("test");
    expect(classifyStripePublishableKey("pk_live_abc")).toBe("live");
    expect(classifyStripePublishableKey("sk_test_abc")).toBeNull();
  });

  test("the only publishable key ever exposed is a test key", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    expect(stripeStatus().publishableKey).toBe(TEST_PUBLISHABLE);
    // …and the secret key is never part of that value.
    expect(stripeStatus().publishableKey).not.toContain("sk_test");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Payment methods — normalization and discovery
// ═══════════════════════════════════════════════════════════════════════════

describe("payment method normalization", () => {
  test("canonical names and legacy aliases resolve", () => {
    expect(normalizePaymentMethod("CARD")).toBe("CARD");
    expect(normalizePaymentMethod("card")).toBe("CARD");
    expect(normalizePaymentMethod("promptpay")).toBe("PROMPTPAY");
    expect(normalizePaymentMethod("PromptPay")).toBe("PROMPTPAY");
    expect(normalizePaymentMethod("cod")).toBe("COD");
    // The pre-foundation value for "pay with Stripe".
    expect(normalizePaymentMethod("online")).toBe("CARD");
  });

  test("anything unrecognized is null so the caller can answer 400 instead of guessing", () => {
    expect(normalizePaymentMethod("bitcoin")).toBeNull();
    expect(normalizePaymentMethod("")).toBeNull();
    expect(normalizePaymentMethod("   ")).toBeNull();
    expect(normalizePaymentMethod(42)).toBeNull();
    expect(normalizePaymentMethod(null)).toBeNull();
    expect(normalizePaymentMethod(undefined)).toBeNull();
  });

  test("only Stripe-backed methods have a Stripe payment-method type", () => {
    expect(stripePaymentMethodType("CARD")).toBe("card");
    expect(stripePaymentMethodType("PROMPTPAY")).toBe("promptpay");
    expect(stripePaymentMethodType("COD")).toBeNull();
  });
});

describe("payment method discovery", () => {
  test("nothing configured: no method is selectable, and COD is reported disabled", () => {
    expect(customerSelectablePaymentMethods()).toEqual([]);
    const cod = paymentMethodOptions().find((m) => m.id === "COD");
    expect(cod?.enabled).toBe(false);
  });

  test("test-mode Stripe enables Card and PromptPay", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    expect(customerSelectablePaymentMethods()).toEqual(["CARD", "PROMPTPAY"]);
  });

  test("COD is absent from the selectable list by default", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    expect(customerSelectablePaymentMethods()).not.toContain("COD");
  });

  test("enabling the COD rail alone does not make COD customer-selectable", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, COD_ENABLED: "true" });
    expect(isCodEnabled()).toBe(true);
    expect(isCodCustomerSelectable()).toBe(false);
    expect(customerSelectablePaymentMethods()).toEqual(["CARD", "PROMPTPAY"]);
  });

  test("COD becomes selectable only when both flags are explicitly on", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, COD_ENABLED: "true", COD_CUSTOMER_SELECTABLE: "true" });
    expect(customerSelectablePaymentMethods()).toEqual(["CARD", "PROMPTPAY", "COD"]);
  });

  test("COD_CUSTOMER_SELECTABLE cannot be true while the rail itself is off", () => {
    setPaymentEnv({ COD_CUSTOMER_SELECTABLE: "true" });
    expect(isCodEnabled()).toBe(false);
    expect(isCodCustomerSelectable()).toBe(false);
    expect(customerSelectablePaymentMethods()).not.toContain("COD");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. COD feature flag — fails closed
// ═══════════════════════════════════════════════════════════════════════════

describe("COD feature flag fails closed", () => {
  test("absent configuration means disabled", () => {
    expect(isCodEnabled()).toBe(false);
  });

  test("only the explicit truthy strings enable it", () => {
    for (const value of ["true", "1", "TRUE", "True"]) {
      setPaymentEnv({ COD_ENABLED: value });
      expect(isCodEnabled()).toBe(true);
    }
  });

  test("a misspelled, quoted, empty, or arbitrary value stays disabled", () => {
    for (const value of ["", "  ", "false", "FALSE", "0", "no", "yes", "enabled", "tru", "'true'", '"true"', "2"]) {
      setPaymentEnv({ COD_ENABLED: value });
      expect(isCodEnabled()).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The method guard every payment route runs
// ═══════════════════════════════════════════════════════════════════════════

describe("assertPaymentMethodUsable", () => {
  test("COD while disabled is refused with 403 PAYMENT_METHOD_DISABLED", () => {
    const result = assertPaymentMethodUsable("COD");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(403);
    expect(result.code).toBe("PAYMENT_METHOD_DISABLED");
  });

  test("COD is still refused when every other flag is misconfigured", () => {
    setPaymentEnv({ COD_CUSTOMER_SELECTABLE: "true", COD_ENABLED: "yes" });
    const result = assertPaymentMethodUsable("COD");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("PAYMENT_METHOD_DISABLED");
    expect(result.status).toBe(403);
  });

  test("COD passes the guard only on an explicit opt-in", () => {
    setPaymentEnv({ COD_ENABLED: "true" });
    expect(assertPaymentMethodUsable("COD").ok).toBe(true);
  });

  test("Card and PromptPay are unavailable when Stripe is not configured", () => {
    for (const method of ["CARD", "PROMPTPAY"] as const) {
      const result = assertPaymentMethodUsable(method);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.status).toBe(503);
    }
  });

  test("Card and PromptPay pass in test-mode Stripe", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    expect(assertPaymentMethodUsable("CARD").ok).toBe(true);
    expect(assertPaymentMethodUsable("PROMPTPAY").ok).toBe(true);
  });

  test("Card is unavailable under a live key rather than silently using it", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_SECRET_KEY: "sk_live_000000000000000000000000" });
    const result = assertPaymentMethodUsable("CARD");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("STRIPE_LIVE_KEY_REFUSED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Method discovery endpoint
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/payments/methods", () => {
  test("returns no selectable method and a disabled COD flag when nothing is configured", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/methods`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.paymentMethods).toEqual([]);
      expect(body.data.cod).toEqual({ enabled: false, customerSelectable: false });
      const ids = body.data.methods.map((m: { id: string }) => m.id);
      expect(ids).toContain("COD");
      expect(body.data.methods.find((m: { id: string }) => m.id === "COD").enabled).toBe(false);
    });
  });

  test("returns Card and PromptPay in test mode and still hides COD", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/methods`);
      const body = await res.json();
      expect(body.data.paymentMethods).toEqual(["CARD", "PROMPTPAY"]);
      expect(body.data.stripe.configured).toBe(true);
      expect(body.data.stripe.mode).toBe("test");
      expect(body.data.cod.enabled).toBe(false);
    });
  });

  test("never leaks the Stripe secret key to the browser", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/methods`);
      const raw = await res.text();
      expect(raw).not.toContain(TEST_SECRET);
      expect(raw).not.toContain(TEST_WEBHOOK_SECRET);
      // The publishable key is allowed — and is the only key present.
      expect(raw).toContain(TEST_PUBLISHABLE);
    });
  });

  test("GET /api/stripe/configured reports mode without exposing a secret", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/configured`);
      const raw = await res.text();
      expect(raw).not.toContain(TEST_SECRET);
      const body = JSON.parse(raw);
      expect(body.data.configured).toBe(true);
      expect(body.data.mode).toBe("test");
      expect(body.data.publishableKey).toBe(TEST_PUBLISHABLE);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Webhook signature verification
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/payments/stripe/webhook — signature", () => {
  const payload = JSON.stringify({ id: "evt_test_1", type: "payment_intent.created", data: { object: {} } });

  test("refuses to process anything when Stripe test mode is not configured", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
        body: payload,
      });
      expect(res.status).toBe(503);
    });
  });

  test("rejects a request with no signature header", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(400);
    });
  });

  test("rejects an invalid signature without touching the database", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
        body: payload,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid signature");
    });
  });

  test("rejects a signature computed with the wrong secret", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(payload, "whsec_wrong_secret"),
        },
        body: payload,
      });
      expect(res.status).toBe(400);
    });
  });

  test("a correctly signed event is ACCEPTED, not rejected as forged", async () => {
    // Guards the opposite failure to the tests above: a verifier that throws on
    // every input rejects forgeries and real events alike, silently disabling
    // every webhook while still looking like it is enforcing signatures.
    setPaymentEnv(TEST_STRIPE_ENV);
    const signedBody = JSON.stringify({
      id: `evt_sig_${randomUUID()}`,
      object: "event",
      type: "payment_intent.created",
      data: { object: { id: "pi_test", object: "payment_intent", metadata: {} } },
    });

    await withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(signedBody, TEST_WEBHOOK_SECRET),
        },
        body: signedBody,
      });
      // The request got past the signature gate to the event claim. Without a
      // test database that claim cannot be recorded and the endpoint answers
      // 500 (so Stripe retries) — never the 400 "Invalid signature" refusal.
      expect(res.status).not.toBe(400);
      expect(res.status).toBe(hasTestDatabase() ? 200 : 500);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. COD cannot be ordered through the API (bypass attempt)
// ═══════════════════════════════════════════════════════════════════════════

describe("COD bypass is rejected server-side", () => {
  test("POST /api/customer/checkout with method=COD is refused", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/customer/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ addressId: randomUUID(), paymentMethod: "COD" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("PAYMENT_METHOD_DISABLED");
    });
  });

  test("lowercase `cod` is refused too (the flag is not case-sensitive to bypass)", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/customer/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ addressId: randomUUID(), paymentMethod: "cod" }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("PAYMENT_METHOD_DISABLED");
    });
  });

  test("POST /api/stripe/checkout with method=COD is refused with 403", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ orderId: randomUUID(), method: "COD" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("PAYMENT_METHOD_DISABLED");
    });
  });

  test("the refusal happens even when nothing else is configured", async () => {
    // No Stripe, no COD flag: COD must still answer with its own code rather
    // than a provider error, and must not create anything.
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ orderId: randomUUID(), method: "COD" }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("PAYMENT_METHOD_DISABLED");
    });
  });

  test("an unknown method is a 400, never silently coerced", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ orderId: randomUUID(), method: "BITCOIN" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_PAYMENT_METHOD");
    });
  });

  test("an unauthenticated payment request is rejected before any method logic", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: randomUUID(), method: "CARD" }),
      });
      expect(res.status).toBe(401);
    });
  });

  test("a missing orderId is a 400", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ method: "CARD" }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
    });
  });

  test("Card with Stripe unconfigured is 503, not a fabricated success", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ orderId: randomUUID(), method: "CARD" }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("STRIPE_NOT_CONFIGURED");
    });
  });

  test("refunding without the orders.manage permission is forbidden", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/admin/orders/${randomUUID()}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken()}` },
        body: JSON.stringify({ amount: 10 }),
      });
      // No DB means the permission lookup cannot succeed, and a lookup that
      // cannot prove the grant must deny — never default to allowed.
      expect([403, 500]).toContain(res.status);
      expect(res.status).not.toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Price / total tampering — the charge is derived, never accepted
// ═══════════════════════════════════════════════════════════════════════════

/** Sum every line item the way Stripe would charge it, in minor units. */
function lineItemsTotal(lines: ReturnType<typeof buildCheckoutLineItems>): number {
  return lines.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0);
}

describe("the charged amount comes from the order, not the request", () => {
  const items = [
    { product_name_snapshot: "Widget", quantity: 2, price: 25.5, image_url_snapshot: null },
    { product_name_snapshot: "Gadget", quantity: 1, price: 49.0, image_url_snapshot: null },
  ];

  test("an order whose item lines already sum to the total is charged exactly that", () => {
    // 2 × 25.50 + 1 × 49.00 = 100.00 from the order's own line prices.
    const lines = buildCheckoutLineItems(items, 10000, "THB", "VNX-1");
    expect(lineItemsTotal(lines)).toBe(10000);
    expect(lines).toHaveLength(2);
  });

  test("a shipping/fee remainder becomes its own line so the sum still matches", () => {
    // Items cover 100.00 but the authoritative total is 130.00 (30.00 shipping).
    const lines = buildCheckoutLineItems(items, 13000, "THB", "VNX-1");
    expect(lineItemsTotal(lines)).toBe(13000);
    expect(lines).toHaveLength(3);
    expect(lines[2].price_data.product_data.name).toBe("Shipping & fees");
    expect(lines[2].price_data.unit_amount).toBe(3000);
  });

  test("a discount below the item sum collapses to one line for the authoritative total", () => {
    // Items would total 100.00, but the order says 80.00 — Stripe must be asked
    // for 80.00, never 100.00.
    const lines = buildCheckoutLineItems(items, 8000, "THB", "VNX-1");
    expect(lineItemsTotal(lines)).toBe(8000);
    expect(lines).toHaveLength(1);
    expect(lines[0].price_data.unit_amount).toBe(8000);
  });

  test("no usable item lines still charges the authoritative total, not zero", () => {
    const lines = buildCheckoutLineItems([], 15000, "THB", "VNX-9");
    expect(lineItemsTotal(lines)).toBe(15000);
    expect(lines).toHaveLength(1);
    expect(lines[0].price_data.product_data.name).toContain("VNX-9");
  });

  test("garbage quantity/price values cannot inflate or deflate the charge", () => {
    const lineItems = [
      { product_name_snapshot: "X", quantity: 999, price: 999999 }, // absurd but non-negative
      { product_name_snapshot: "Neg", quantity: -5, price: 100 }, // rejected
      { product_name_snapshot: "Zero", quantity: 0, price: 100 }, // rejected
      { product_name_snapshot: "NaN", quantity: 1, price: "abc" }, // rejected
      { product_name_snapshot: "Frac", quantity: 1.5, price: 100 }, // rejected
    ];
    // Only the first line survives; the remainder is reconciled to the total.
    const lines = buildCheckoutLineItems(lineItems, 5000, "thb", "VNX-2");
    expect(lineItemsTotal(lines)).toBe(5000);
    expect(lines.every((l) => l.price_data.currency === "thb")).toBe(true);
  });

  test("the currency on every line is the order's currency", () => {
    const lines = buildCheckoutLineItems(items, 12000, "THB", "VNX-3");
    expect(lines.every((l) => l.price_data.currency === "thb")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Refundable amount arithmetic
// ═══════════════════════════════════════════════════════════════════════════

describe("refundableMinorFor", () => {
  test("an untouched payment is fully refundable", () => {
    expect(refundableMinorFor(100, 0)).toBe(10000);
    expect(refundableMinorFor(100, null)).toBe(10000);
    expect(refundableMinorFor(100, undefined)).toBe(10000);
  });

  test("a partially refunded payment exposes only the remainder", () => {
    expect(refundableMinorFor(100, 30)).toBe(7000);
  });

  test("a fully refunded payment exposes nothing — over-refund is not representable", () => {
    expect(refundableMinorFor(100, 100)).toBe(0);
    expect(refundableMinorFor(100, 150)).toBe(0);
  });

  test("unusable input is zero, never a negative that could invert a comparison", () => {
    expect(refundableMinorFor("abc", 0)).toBe(0);
    expect(refundableMinorFor(null, 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. PromptPay is delayed-notification — an event is not a payment
// ═══════════════════════════════════════════════════════════════════════════

describe("sessionConfirmsPayment (PromptPay async trap)", () => {
  test("only an explicitly paid session confirms money was received", () => {
    expect(sessionConfirmsPayment({ payment_status: "paid" })).toBe(true);
  });

  test("an unpaid completed session does NOT confirm payment", () => {
    // This is the exact shape Stripe sends for PromptPay when the customer has
    // scanned the QR but the bank has not settled: the session is completed,
    // the money is not there. Marking the order paid here would be fake.
    expect(sessionConfirmsPayment({ payment_status: "unpaid" })).toBe(false);
  });

  test("no_payment_required and a missing status never count as paid", () => {
    expect(sessionConfirmsPayment({ payment_status: "no_payment_required" })).toBe(false);
    expect(sessionConfirmsPayment({ payment_status: null })).toBe(false);
    expect(sessionConfirmsPayment({})).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. Database-gated: webhook idempotency
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("webhook idempotency (requires TEST_DATABASE_URL)", () => {
  /** An event type this implementation deliberately does not act on. */
  function signedEventBody(eventId: string): string {
    return JSON.stringify({
      id: eventId,
      object: "event",
      type: "payment_intent.created",
      data: { object: { id: "pi_test", object: "payment_intent", metadata: {} } },
    });
  }

  test("a duplicated event id is processed once and acknowledged twice", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const eventId = `evt_dup_${randomUUID()}`;

    await withServer(async (base) => {
      const payload = signedEventBody(eventId);
      const headers = {
        "Content-Type": "application/json",
        "stripe-signature": stripeSignature(payload, TEST_WEBHOOK_SECRET),
      };

      const first = await fetch(`${base}/api/payments/stripe/webhook`, { method: "POST", headers, body: payload });
      expect(first.status).toBe(200);

      const second = await fetch(`${base}/api/payments/stripe/webhook`, { method: "POST", headers, body: payload });
      expect(second.status).toBe(200);
      expect((await second.json()).duplicate).toBe(true);
    });

    const { query } = await import("../db/index.js");
    const rows = await query("SELECT id, status FROM payment_events WHERE event_id = $1", [eventId]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].status).toBe("processed");
    await query("DELETE FROM payment_events WHERE event_id = $1", [eventId]);
  });
});
