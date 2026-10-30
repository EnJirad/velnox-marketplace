/**
 * CHECKOUT TEST PAYMENT RAIL — why the DB-gated checkout suites can run in CI
 * without any payment credential.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `POST /api/customer/checkout` refuses to touch an order until
 * `assertPaymentMethodUsable()` says the chosen rail is usable
 * (`backend/routes/cart.ts`). For CARD that means `stripeStatus()` must report
 * a COMPLETE test-mode configuration: a `sk_test_…` secret key, an explicit
 * `STRIPE_MODE=test` (or none), and a configured `STRIPE_WEBHOOK_SECRET`
 * (`backend/lib/payment-config.ts`).
 *
 * The DB-gated suites that use checkout as SETUP (`buy-now-checkout`,
 * `realtime-commerce-phase2c`) used to set only the secret key and DELETE the
 * webhook secret — a half-configured rail that `stripeStatus()` rightly
 * refuses, so all 11 of their database cases received 503 in CI (Phase 2F).
 *
 * Those suites now install the same dummy test rail `checkout-payment-flow`
 * already used. This file pins the PROPERTIES that make that safe:
 *
 *   1. the rail is TEST-mode only: dummy `sk_test_`/`whsec_` shapes, never a
 *      live key, and it is restored afterwards so it cannot leak;
 *   2. the very same fixture is accepted by the real payment gate, while a
 *      live key or a missing webhook secret is still REFUSED — production
 *      guards are not bypassed by the test configuration;
 *   3. the checkout handler makes no Stripe API call, so the dummy key cannot
 *      charge anything anywhere;
 *   4. the CI workflow holds NO payment secret and NO rail flag, and still
 *      pins the production-database refusal: the rail lives only in test files.
 *
 * No database is required and no Stripe call is made.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { assertPaymentMethodUsable, classifyStripeSecretKey, stripeStatus } from "../lib/payment-config.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const WORKFLOW = ".github/workflows/test.yml";
const CHECKOUT_ROUTE = "backend/routes/cart.ts";

/** The suites that drive checkout only as SETUP for commerce/realtime logic. */
const CHECKOUT_SETUP_SUITES = [
  "backend/tests/buy-now-checkout.test.ts",
  "backend/tests/realtime-commerce-phase2c.test.ts",
] as const;

/** The exact rail fixture those suites install. Dummies, not credentials. */
const TEST_RAIL = {
  STRIPE_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_000000000000000000000000",
  STRIPE_WEBHOOK_SECRET: "whsec_000000000000000000000000",
} as const;

const RAIL_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MODE",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of RAIL_KEYS) savedEnv[key] = process.env[key];
});

afterAll(() => {
  for (const key of RAIL_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

/** Install the fixture into the live process env, optionally overriding a key. */
function installRail(overrides: Record<string, string> = {}): void {
  for (const key of RAIL_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries({ ...TEST_RAIL, ...overrides })) {
    process.env[key] = value;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The checkout-as-setup suites configure a COMPLETE, test-mode-only rail
// ═══════════════════════════════════════════════════════════════════════════

describe("the checkout-as-setup suites configure a complete TEST-mode rail", () => {
  for (const suite of CHECKOUT_SETUP_SUITES) {
    test(`${suite} sets the secret key, the mode and the webhook secret`, () => {
      const source = read(suite);
      // All three values the gate checks, in the same shape the fixture uses.
      expect(source).toContain('process.env.STRIPE_MODE = "test"');
      expect(source).toContain('process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000"');
      expect(source).toContain('process.env.STRIPE_WEBHOOK_SECRET = "whsec_000000000000000000000000"');
      // A live key must never enter a test file: `stripeStatus()` refuses it,
      // and the guard below pins that refusal independently of this scan.
      expect(source).not.toContain("sk_live_");
      expect(source).not.toContain("pk_live_");
      // The rail is saved and restored, so it cannot leak into another file.
      expect(source).toContain("savedEnv[key] = process.env[key]");
      expect(source).toContain("savedEnv[key]");
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The real payment gate accepts exactly this fixture — and keeps refusing
//    live or half-configured deployments
// ═══════════════════════════════════════════════════════════════════════════

describe("the rail is test mode only and the production guards still hold", () => {
  test("the fixture is usable, reported as test mode, and passes the checkout gate", () => {
    installRail();
    const status = stripeStatus();
    expect(status.usable).toBe(true);
    expect(status.mode).toBe("test");
    expect(status.reason).toBeNull();
    expect(status.webhookConfigured).toBe(true);
    expect(assertPaymentMethodUsable("CARD")).toEqual({ ok: true });
    // The key is classified as a TEST key — never live.
    expect(classifyStripeSecretKey(TEST_RAIL.STRIPE_SECRET_KEY)).toBe("test");
  });

  test("a live key in the same position is still REFUSED, never used", () => {
    installRail({ STRIPE_SECRET_KEY: "sk_live_000000000000000000000000" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_LIVE_KEY_REFUSED");
    expect(assertPaymentMethodUsable("CARD").ok).toBe(false);
  });

  test("without the webhook secret the gate still refuses — no half-configuration", () => {
    installRail({ STRIPE_WEBHOOK_SECRET: "" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_WEBHOOK_NOT_CONFIGURED");
    expect(assertPaymentMethodUsable("CARD").ok).toBe(false);
  });

  test("with no configuration at all the gate still refuses (never a fallback)", () => {
    for (const key of RAIL_KEYS) delete process.env[key];
    expect(stripeStatus().usable).toBe(false);
    expect(stripeStatus().reason).toBe("STRIPE_NOT_CONFIGURED");
    expect(assertPaymentMethodUsable("CARD")).toEqual({
      ok: false,
      code: "STRIPE_NOT_CONFIGURED",
      status: 503,
      message: "Card and PromptPay payments are not available right now.",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The dummy key can never charge: the checkout handler calls no Stripe API
// ═══════════════════════════════════════════════════════════════════════════

describe("the checkout handler makes no Stripe API call", () => {
  const route = read(CHECKOUT_ROUTE);
  const start = route.indexOf('app.post("/api/customer/checkout"');
  const end = route.indexOf("// ── GET /api/customer/orders", start);

  test("the checkout handler exists and can be sliced", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  test("it creates no session and reaches no Stripe endpoint", () => {
    const handler = route.slice(start, end);
    // No SDK/HTTP call, no session creation, no webhook settlement. The route
    // imports `expireStripeCheckoutSession` for the CANCEL paths, so the slice
    // must also show the expiry call is not part of checkout creation.
    expect(handler).not.toContain("api.stripe.com");
    expect(handler).not.toContain(".sessions.create");
    expect(handler).not.toContain("expireStripeCheckoutSession(");
    // The only payment work in the handler is the local policy/gate decision.
    expect(handler).toContain("assertPaymentMethodUsable(paymentMethod)");
    expect(handler).toContain("applyPaymentReservationPolicy(client, orderId, paymentMethod)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CI holds no payment credential: the rail exists only in test files
// ═══════════════════════════════════════════════════════════════════════════

describe("the CI workflow carries no payment configuration", () => {
  const workflow = read(WORKFLOW);

  test("it references no repository secret and no payment rail variable", () => {
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("STRIPE_");
    // The COD rail is not switched on to make checkout tests pass: the real
    // default stays OFF, and the tested path stays CARD.
    expect(workflow).not.toContain("COD_ENABLED");
    expect(workflow).not.toContain("COD_CUSTOMER_SELECTABLE");
  });

  test("the disposable database stays the only data source and the refusal is still pinned", () => {
    expect(workflow).toContain("TEST_DATABASE_URL:");
    expect(workflow).toContain('DATABASE_URL="postgresql://u:p@ep-ci-guard-check.us-east-2.aws.neon.tech/velnox?sslmode=require"');
    expect(workflow).toContain("REFUSING TEST AGAINST PRODUCTION DATABASE");
  });
});
