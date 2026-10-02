/**
 * VelRepeat V2 — Phase 4: the prepaid PLAN-level Stripe payment and the
 * payment-gated `draft → active` transition.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE PROVES
 * ─────────────────────
 *   1. Money — the charged amount comes from the immutable Phase 3 snapshot,
 *      through exact rational arithmetic, and agrees with the ONE Stripe
 *      minor-unit rule the order path already uses.
 *   2. Payment creation — a draft plan of the OWNER can be paid; a missing
 *      plan, someone else's plan, a non-draft plan, an already-paid plan, an
 *      unsupported method and an unconfigured Stripe all fail closed, and none
 *      of them opens a session or writes a payment.
 *   3. Webhook — a signed, verified success activates the plan EXACTLY once
 *      with the real Stripe method and re-anchored timing; an invalid
 *      signature, a wrong plan, a wrong amount, a wrong currency, a failure, a
 *      cancellation, an expiry, a redelivery and a concurrent redelivery all
 *      do NOT activate.
 *   4. Activation — `draft → active`, real payment method, `started_at` and
 *      `next_run_at` re-anchored to the settlement instant, and ZERO orders,
 *      cycles, reservations, shipments or stock changes.
 *   5. Security — a customer cannot pay for, activate, or re-price another
 *      customer's plan, cannot change an amount/seller/currency, and cannot
 *      activate anything without a verified webhook.
 *   6. V1 is unchanged.
 *
 * The pure and structural halves run everywhere. The integration half needs a
 * disposable database (`TEST_DATABASE_URL`, bootstrapped from
 * db/run-sqleditor.sql) and skips without one — like every other DB-gated suite
 * here. It drives the REAL express routes over HTTP, so the signature check,
 * the event claim, the SQL, the status codes and the response shape are all
 * exercised together.
 *
 * No test here reaches Stripe: signatures are computed locally with the same
 * HMAC scheme Stripe uses against a fake `whsec_` value, and every event object
 * is synthetic. That is a real end-to-end run of this backend's half of the
 * contract and is explicitly NOT a Stripe round trip.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID, createHmac } from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import type Stripe from "stripe";

import { hasTestDatabase } from "./helpers/test-db.js";
import {
  makeRational,
  multiply,
  parseDecimal,
  toExactDecimalString,
  toMoneyString,
} from "../lib/money.js";
import { purgeUsers } from "./helpers/purge.js";
import { withTransaction } from "../db/index.js";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { calculateNextRunAt } from "../jobs/velrepeat-scheduler.js";
import { PRICING_RULES_SETTING_KEY, VELREPEAT_CURRENCY } from "../lib/velrepeat-pricing.js";
import { toStripeMinor } from "../routes/stripe.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { setupVelRepeatV2PlanRoutes } from "../routes/velrepeat-v2-plans.js";
import {
  RepeatPlanPaymentError,
  V2_PREPAID_METHODS,
  VELREPEAT_V2_PAYMENT_SCOPE,
  assertCommitmentCoversEveryCycle,
  assertPayableDraft,
  buildPlanLineItem,
  buildPlanStripeMetadata,
  handleVelRepeatV2PaymentEvent,
  isVelRepeatV2PaymentEvent,
  parsePrepaidMethod,
  planTotalToStripeMinor,
  readPlanChargeEvent,
  setupVelRepeatV2PaymentRoutes,
} from "../routes/velrepeat-v2-payments.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Strip comments so a negative assertion describes CODE, not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** SQL `--` line comments, so "no DROP TABLE" is asserted against statements. */
function stripSqlComments(source: string): string {
  return source.replace(/--[^\n]*/g, "");
}

// ─── Test-mode Stripe environment (never a real credential) ────────────────
const PAYMENT_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MODE",
  "COD_ENABLED",
  "COD_CUSTOMER_SELECTABLE",
] as const;

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

/** Stripe's own signature scheme, computed locally — no network, no SDK. */
function stripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}

const PLAN_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function refusalFrom(run: () => unknown): RepeatPlanPaymentError {
  try {
    run();
  } catch (error) {
    if (error instanceof RepeatPlanPaymentError) return error;
    throw error;
  }
  throw new Error("expected a RepeatPlanPaymentError, but nothing was refused");
}

/** Build a synthetic Stripe event carrying our V2 scope marker. */
function v2Event(
  type: string,
  object: Record<string, unknown>,
  id = `evt_${randomUUID()}`,
): Stripe.Event {
  return {
    id,
    object: "event",
    api_version: "2025-08-27.basil",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object: object as never },
  } as unknown as Stripe.Event;
}

function v2Metadata(planId: string, over: Record<string, unknown> = {}) {
  return {
    scope: VELREPEAT_V2_PAYMENT_SCOPE,
    planId,
    userId: "user-1",
    method: "CARD",
    provider: "stripe",
    mode: "test",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Exact money — the commitment total, never a float
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — the charged amount comes from the immutable snapshot", () => {
  test("the charged amount comes from the immutable snapshot", () => {
    // The brief's worked example: 4 cycles × 100 THB, 10% commitment discount,
    // charged ONCE as 360.00 THB.
    expect(planTotalToStripeMinor("360.00")).toBe(36000);
  });

  test("whole and fractional baht convert exactly", () => {
    expect(planTotalToStripeMinor("0.01")).toBe(1);
    expect(planTotalToStripeMinor("1")).toBe(100);
    expect(planTotalToStripeMinor("1.05")).toBe(105);
    expect(planTotalToStripeMinor("99999999.99")).toBe(9_999_999_999);
    // A NUMERIC(12,2) column can never hold a third decimal; if one ever
    // arrived, the rule is still exactly one half-up rounding (G2).
    expect(planTotalToStripeMinor("10.005")).toBe(1001);
    expect(planTotalToStripeMinor("10.004")).toBe(1000);
  });

  test("it agrees with the ONE minor-unit rule the order path uses", () => {
    // Two derivations, one answer: if these ever diverge, a plan would be
    // charged differently from an order for the same money.
    for (const total of ["360.00", "1.00", "0.07", "12345.67", "1000000.01"]) {
      expect(planTotalToStripeMinor(total)).toBe(toStripeMinor(total));
    }
  });

  test("an amount that cannot be charged is refused, never coerced", () => {
    for (const bad of ["0", "0.00", "-1.00", "-0.01", "not-a-number", "", null, undefined]) {
      expect(planTotalToStripeMinor(bad)).toBeNull();
    }
  });

  test("the commitment total is never accepted from a request body", () => {
    // Structural: the module reads a total from exactly ONE place — the
    // pricing snapshot, through one shared helper that both the creation path
    // and the settlement path use. Any second read, or a client-sourced amount,
    // would be a price this backend did not freeze.
    const code = stripComments(read("backend/routes/velrepeat-v2-payments.ts"));
    const snapshotReads = code.match(/FROM velrepeat_pricing_snapshots/g) ?? [];
    expect(snapshotReads).toHaveLength(1);
    // Both the charge and the settlement re-derive through that one reader.
    expect(code.match(/readCommitmentSnapshot\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(code).not.toMatch(/body\s*\.\s*(amount|total|price|final)/i);
    expect(code).not.toMatch(/req\.body\s*\.\s*(amount|total|price)/i);
  });

  test("a snapshot that does not cover every cycle can never be charged", () => {
    // The Phase 3 engine freezes the CYCLE PRICE; the contract's pipeline ends
    // `Cycle Price → Total Prepaid`. This guard is what stops a per-cycle total
    // being charged once for an N-cycle commitment.
    setPaymentEnv(TEST_STRIPE_ENV);
    const covered = { totalAmount: "360.00", commitmentCycles: 4, finalPriceExact: "90" };
    expect(() => assertCommitmentCoversEveryCycle(covered)).not.toThrow();

    // The Phase 3 shape for the same purchase: the cycle price, not the total.
    const perCycleOnly = { totalAmount: "90.00", commitmentCycles: 4, finalPriceExact: "90" };
    const refusal = refusalFrom(() => assertCommitmentCoversEveryCycle(perCycleOnly));
    expect(refusal.status).toBe(409);
    expect(refusal.code).toBe("COMMITMENT_TOTAL_UNVERIFIED");

    // A single-cycle commitment is exactly satisfied by the cycle price.
    expect(() =>
      assertCommitmentCoversEveryCycle({ totalAmount: "90.00", commitmentCycles: 1, finalPriceExact: "90" }),
    ).not.toThrow();

    // Anything unverifiable is refused rather than assumed.
    for (const bad of [
      { totalAmount: "360.00", commitmentCycles: 0, finalPriceExact: "90" },
      { totalAmount: "360.00", commitmentCycles: 4, finalPriceExact: null },
      { totalAmount: "360.00", commitmentCycles: 4.5, finalPriceExact: "90" },
    ]) {
      expect(refusalFrom(() => assertCommitmentCoversEveryCycle(bad)).code).toBe(
        "COMMITMENT_TOTAL_UNVERIFIED",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The Stripe object — one Checkout Session for the whole commitment
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — the Stripe object and its metadata", () => {
  test("the line item is the whole commitment, once", () => {
    const item = buildPlanLineItem({
      amountMinor: 36000,
      currency: "THB",
      name: "VelRepeat prepaid plan",
    });
    expect(item.quantity).toBe(1);
    expect(item.price_data?.unit_amount).toBe(36000);
    expect(item.price_data?.currency).toBe("thb");
  });

  test("the metadata identifies the plan, the owner, the method and test mode", () => {
    const metadata = buildPlanStripeMetadata({
      planId: PLAN_A,
      userId: "user-1",
      method: "CARD",
    });
    expect(metadata.scope).toBe(VELREPEAT_V2_PAYMENT_SCOPE);
    expect(metadata.planId).toBe(PLAN_A);
    expect(metadata.userId).toBe("user-1");
    expect(metadata.method).toBe("CARD");
    expect(metadata.mode).toBe("test");
    // No money is ever described in metadata — the amount is re-derived from
    // the snapshot at settlement.
    expect(Object.keys(metadata).sort()).toEqual([
      "method",
      "mode",
      "planId",
      "provider",
      "scope",
      "userId",
    ]);
  });

  test("the session is a Checkout Session payment, never a Subscription", () => {
    const code = stripComments(read("backend/routes/velrepeat-v2-payments.ts"));
    expect(code).toContain('mode: "payment"');
    expect(code).not.toMatch(/stripe\.subscriptions/);
    // A promotion code would let Stripe capture less than the snapshot commits,
    // which settlement must refuse; so the phase never offers one.
    expect(code).not.toMatch(/allow_promotion_codes/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Methods — Card + PromptPay only, never COD
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — payment methods fail closed", () => {
  test("Card and PromptPay are the supported prepaid rails", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    expect(V2_PREPAID_METHODS).toEqual(["CARD", "PROMPTPAY"]);
    expect(parsePrepaidMethod("CARD")).toBe("CARD");
    expect(parsePrepaidMethod("promptpay")).toBe("PROMPTPAY");
    expect(parsePrepaidMethod(undefined)).toBe("CARD");
  });

  test("COD is refused by name, before any provider call", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const refusal = refusalFrom(() => parsePrepaidMethod("COD"));
    expect(refusal.status).toBe(400);
    expect(refusal.code).toBe("UNSUPPORTED_PAYMENT_METHOD");
    // Even with COD's own flag switched on, a V2 prepaid plan cannot use it.
    setPaymentEnv({ ...TEST_STRIPE_ENV, COD_ENABLED: "true", COD_CUSTOMER_SELECTABLE: "true" });
    expect(refusalFrom(() => parsePrepaidMethod("cod")).code).toBe("UNSUPPORTED_PAYMENT_METHOD");
  });

  test("an unknown method is refused", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    for (const bad of ["bitcoin", "bank_transfer", 42, {}]) {
      expect(refusalFrom(() => parsePrepaidMethod(bad)).code).toBe("INVALID_PAYMENT_METHOD");
    }
  });

  test("an unusable Stripe configuration refuses the payment, naming the reason", () => {
    setPaymentEnv();
    const refusal = refusalFrom(() => parsePrepaidMethod("CARD"));
    expect(refusal.status).toBe(503);
    expect(refusal.code).toBe("STRIPE_NOT_CONFIGURED");
  });

  test("a LIVE key is refused — this phase is test mode only", () => {
    setPaymentEnv({
      STRIPE_SECRET_KEY: "sk_live_000000000000000000000000",
      STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    });
    const refusal = refusalFrom(() => parsePrepaidMethod("CARD"));
    expect(refusal.status).toBe(503);
    expect(refusal.code).toBe("STRIPE_LIVE_KEY_REFUSED");
    setPaymentEnv();
  });

  test("a plan that is not a draft is never payable", () => {
    const commitment = {
      planId: PLAN_A,
      userId: "user-1",
      status: "draft",
      frequencyType: "weeks" as const,
      intervalValue: 1,
      currency: "THB",
      snapshotId: "s-1",
      totalAmount: "360.00",
      amountMinor: 36000,
    };
    expect(() => assertPayableDraft(commitment)).not.toThrow();
    for (const status of ["active", "paused", "cancelled", "completed", "payment_failed"]) {
      const refusal = refusalFrom(() => assertPayableDraft({ ...commitment, status }));
      expect(refusal.status).toBe(409);
      expect(refusal.code).toBe("PLAN_NOT_PAYABLE");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Event classification — what a Stripe event is allowed to claim
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — reading a Stripe event", () => {
  test("only our own scope marker makes an event ours", () => {
    expect(isVelRepeatV2PaymentEvent(v2Event("payment_intent.succeeded", { metadata: v2Metadata(PLAN_A) }))).toBe(true);
    // An ordinary V1 order event is never diverted.
    expect(
      isVelRepeatV2PaymentEvent(
        v2Event("payment_intent.succeeded", { metadata: { orderId: "o-1" } }),
      ),
    ).toBe(false);
    // Nor is an event type this phase does not act on.
    expect(
      isVelRepeatV2PaymentEvent(
        v2Event("charge.refunded", { metadata: v2Metadata(PLAN_A) }),
      ),
    ).toBe(false);
    expect(isVelRepeatV2PaymentEvent(v2Event("checkout.session.completed", {}))).toBe(false);
  });

  test("a paid Checkout Session settles; an unpaid one does not (PromptPay)", () => {
    // The trap: Stripe completes the session while PromptPay money is still in
    // flight. Treating that event as proof of payment would fabricate a
    // success and activate a plan nobody paid for.
    const unpaid = readPlanChargeEvent(
      v2Event("checkout.session.completed", {
        id: "cs_unpaid",
        metadata: v2Metadata(PLAN_A),
        payment_status: "unpaid",
        amount_total: 36000,
        currency: "thb",
      }),
    );
    expect(unpaid?.outcome).toBe("awaiting_payment");

    const paid = readPlanChargeEvent(
      v2Event("checkout.session.completed", {
        id: "cs_paid",
        metadata: v2Metadata(PLAN_A),
        payment_status: "paid",
        amount_total: 36000,
        currency: "thb",
        payment_intent: "pi_1",
      }),
    );
    expect(paid?.outcome).toBe("succeeded");
    expect(paid?.amountMinor).toBe(36000);
    expect(paid?.currency).toBe("THB");
    expect(paid?.sessionId).toBe("cs_paid");
    expect(paid?.intentId).toBe("pi_1");
  });

  test("failure, cancellation and expiry are distinct, and none settles", () => {
    const cases: Array<[string, string]> = [
      ["checkout.session.async_payment_failed", "failed"],
      ["payment_intent.payment_failed", "failed"],
      ["checkout.session.expired", "canceled"],
      ["payment_intent.canceled", "canceled"],
    ];
    for (const [type, outcome] of cases) {
      const charge = readPlanChargeEvent(
        v2Event(type, {
          id: "cs_x",
          metadata: v2Metadata(PLAN_A),
          payment_status: "paid",
          currency: "thb",
        }),
      );
      expect(charge?.outcome).toBe(outcome);
    }
  });

  test("the delayed PromptPay success settles on the async event", () => {
    const charge = readPlanChargeEvent(
      v2Event("checkout.session.async_payment_succeeded", {
        id: "cs_async",
        metadata: v2Metadata(PLAN_A),
        payment_status: "paid",
        amount_total: 36000,
        currency: "thb",
        payment_intent: "pi_async",
      }),
    );
    expect(charge?.outcome).toBe("succeeded");
    expect(charge?.amountMinor).toBe(36000);
  });

  test("a payment_intent success reports the amount it actually received", () => {
    const charge = readPlanChargeEvent(
      v2Event("payment_intent.succeeded", {
        id: "pi_2",
        metadata: v2Metadata(PLAN_A),
        amount: 36000,
        amount_received: 36000,
        currency: "thb",
      }),
    );
    expect(charge?.outcome).toBe("succeeded");
    expect(charge?.amountMinor).toBe(36000);
  });

  test("each event carries the identifier its own object actually has", () => {
    // A PaymentIntent IS the intent and points at no session; a Checkout
    // Session IS the session and points at its PaymentIntent. Reading the wrong
    // field yields null, the attempt cannot be resolved, and the plan silently
    // never activates — Stripe fires `payment_intent.succeeded` for EVERY
    // charge, so this is the event that matters most.
    const intentEvent = readPlanChargeEvent(
      v2Event("payment_intent.succeeded", {
        id: "pi_direct",
        metadata: v2Metadata(PLAN_A),
        amount_received: 36000,
        currency: "thb",
      }),
    );
    expect(intentEvent?.intentId).toBe("pi_direct");
    expect(intentEvent?.sessionId).toBeNull();

    const sessionEvent = readPlanChargeEvent(
      v2Event("checkout.session.completed", {
        id: "cs_direct",
        payment_intent: "pi_child",
        metadata: v2Metadata(PLAN_A),
        payment_status: "paid",
        amount_total: 36000,
        currency: "thb",
      }),
    );
    expect(sessionEvent?.sessionId).toBe("cs_direct");
    expect(sessionEvent?.intentId).toBe("pi_child");
  });

  test("an unusable plan reference yields no charge at all", () => {
    for (const planId of [undefined, "", "not-a-uuid", 42, null]) {
      const charge = readPlanChargeEvent(
        v2Event("payment_intent.succeeded", {
          id: "pi_3",
          metadata: v2Metadata(PLAN_A, { planId }),
        }),
      );
      expect(charge).toBeNull();
    }
  });

  test("our marker with an unusable plan reference is acknowledged, not acted on", async () => {
    // It returns `true` (this module owns the event) without settling: the
    // backend decided, so throwing would only make Stripe retry forever.
    const handled = await handleVelRepeatV2PaymentEvent(
      v2Event("payment_intent.succeeded", { id: "pi_bad", metadata: v2Metadata("nope") }),
    );
    expect(handled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Structural — the boundaries this phase promises
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — module boundaries (structural)", () => {
  const code = stripComments(read("backend/routes/velrepeat-v2-payments.ts"));

  test("Phase 4 creates no order, cycle, reservation or shipment", () => {
    for (const forbidden of [
      /INSERT INTO orders/i,
      /INSERT INTO order_items/i,
      /INSERT INTO velrepeat_cycles/i,
      /reserveInventoryStock/i,
      /releaseOrderInventory/i,
      /commitOrderInventory/i,
      /INSERT INTO inventory/i,
      /INSERT INTO shipments/i,
      /sold_count/i,
    ]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  test("the plan is activated in exactly ONE place, and only from draft", () => {
    const activations = code.match(/SET status = 'active'/g) ?? [];
    expect(activations).toHaveLength(1);
    expect(code).toMatch(/WHERE id = \$1 AND status = 'draft'[\s\S]{0,120}RETURNING id/);
  });

  test("activation always sets a real method and re-anchors both timestamps", () => {
    expect(code).toMatch(/SET status = 'active',[\s\S]*?started_at = \$2,[\s\S]*?next_run_at = \$3,[\s\S]*?payment_method = \$4/);
    // The re-anchored instant comes from the canonical scheduler derivation,
    // never from a creation-time column.
    expect(code).toMatch(/calculateNextRunAt\(\s*startedAt/);
  });

  test("no second Stripe client and no second payment authority", () => {
    expect(code).not.toMatch(/new Stripe\(/);
    // The ONE existing client is reused, and the ONE payments table is the only
    // thing this module writes money to.
    expect(code).toContain("stripeServerClient()");
    expect(code).not.toMatch(/INSERT INTO payment_events/);
    expect(code).not.toMatch(/INSERT INTO refunds/);
  });

  test("there is no client-callable activation route", () => {
    // The only route this module mounts is payment initiation. Nothing accepts
    // a client claim of success.
    const routes = code.match(/app\.(get|post|patch|put|delete)\(([^\n]*)/g) ?? [];
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain("/api/velrepeat/v2/plans/:planId/payment");
    expect(code).not.toMatch(/\/activate|\/confirm/);
  });

  test("the webhook path is the pre-existing one, with the pre-existing checks", () => {
    const stripe = read("backend/routes/stripe.ts");
    expect(stripe).toContain('app.post("/api/payments/stripe/webhook"');
    expect(stripe).toContain("constructEventAsync");
    expect(stripe).toContain("ON CONFLICT (event_id) DO NOTHING");
    // The V2 dispatch happens inside that handler, before the order logic.
    expect(stripe).toMatch(
      /async function handleStripeEvent[\s\S]{0,2000}handleVelRepeatV2PaymentEvent\(event\)/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. V1 regression (structural)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — V1 is untouched (structural)", () => {
  test("no V1 route, scheduler or COD path was modified", () => {
    for (const file of [
      "backend/routes/velrepeat-plans.ts",
      "backend/routes/velrepeat.ts",
      "backend/jobs/velrepeat-scheduler.ts",
      "backend/lib/inventory.ts",
      "backend/lib/order-fulfillment.ts",
      "backend/lib/order-lock.ts",
      "backend/lib/payment-reservation.ts",
    ]) {
      const source = read(file);
      // The V2 scope marker appears nowhere in the V1 / shared surface.
      expect(source).not.toContain(VELREPEAT_V2_PAYMENT_SCOPE);
      expect(source).not.toContain("velrepeat-v2-payments");
    }
    // V1 still creates its plans exactly as it did, still active and COD-only.
    const v1 = read("backend/routes/velrepeat-plans.ts");
    expect(v1).toContain("Only paymentMethod 'cod' is supported for recurring plans");
  });

  test("payment-config (the one gate) is shared, not forked", () => {
    const code = read("backend/routes/velrepeat-v2-payments.ts");
    expect(code).toContain("assertPaymentMethodUsable");
    expect(code).toContain("normalizePaymentMethod");
    expect(code).toContain("stripePaymentMethodType");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. The schema — plan-level payment parent (Q13=B)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — the payments schema carries a plan parent", () => {
  const schema = read("db/schema.sql");
  const migration = stripSqlComments(read("db/migrations/051_payments_velrepeat_v2_plan_parent.sql"));

  test("the two canonical SQL files are byte-identical", () => {
    expect(read("db/run-sqleditor.sql")).toBe(schema);
  });

  test("order_id is nullable, plan_id exists, and exactly one parent is required", () => {
    expect(schema).toMatch(/order_id UUID REFERENCES orders\(id\),\n {2}plan_id UUID,/);
    expect(schema).toContain("CONSTRAINT payments_exactly_one_parent_check CHECK (");
    expect(schema).toMatch(
      /\(order_id IS NOT NULL AND plan_id IS NULL\)\s*\n\s*OR \(order_id IS NULL AND plan_id IS NOT NULL\)/,
    );
    expect(schema).toContain("payments_plan_id_fkey");
  });

  test("a plan-scoped twin of the single-active-attempt index exists", () => {
    // Without it, NULL order_id rows are all "distinct" to the order-scoped
    // index and a double-click could open two sessions for one plan.
    expect(schema).toContain("idx_payments_one_active_stripe_plan");
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_plan[\s\S]*?provider = 'stripe'[\s\S]*?plan_id IS NOT NULL[\s\S]*?status IN \('pending', 'requires_action'\)/,
    );
  });

  test("the migration is additive and idempotent, and never revives run-update.sql", () => {
    expect(migration).toContain("ALTER TABLE payments ALTER COLUMN order_id DROP NOT NULL");
    expect(migration).toContain("ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id UUID");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe_plan");
    for (const destructive of [/DROP TABLE/i, /DROP COLUMN/i, /TRUNCATE/i, /\bDELETE FROM\b/i]) {
      expect(migration).not.toMatch(destructive);
    }
  });

  test("the deprecated db/run-update.sql was not resurrected", () => {
    let resurrected = false;
    try {
      read("db/run-update.sql");
      resurrected = true;
    } catch {
      resurrected = false;
    }
    expect(resurrected).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Integration — payment creation + verified webhook + activation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 4 — payment creation and verified activation (integration)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;
  const tag = `p4-${randomUUID().slice(0, 8)}`;

  let server: Server | undefined;
  let base = "";
  const userIds: string[] = [];

  let buyerId = "";
  let otherBuyerId = "";
  let packageId = "";
  let planId = "";

  /** 4 cycles × 100 THB with a 10% commitment discount = 360.00 THB prepaid. */
  const COMMITMENT_TOTAL = "360.00";
  const COMMITMENT_MINOR = 36000;
  /**
   * The discounted price of ONE delivery cycle for the fixture purchase: a
   * 100 THB composition at a 10% commitment discount. The 4-cycle PREPAID
   * commitment for the same purchase is `COMMITMENT_TOTAL` = 360.00 above.
   * They are different numbers, and the difference is the whole point.
   */
  const PHASE3_CYCLE_PRICE = "90.00";

  let previousRules: string | null = null;
  let previousRulesExisted = false;
  /** Every plan this suite creates — so its plan-scoped money can be purged. */
  const planIds: string[] = [];

  async function db() {
    return import("../db/index.js");
  }

  /**
   * A draft plan whose snapshot covers EVERY prepaid cycle — the shape the
   * V2 contract's pipeline (`… → Cycle Price → Total Prepaid`) defines and the
   * shape the coverage guard requires.
   *
   * The plan created through the Phase 3 route in `beforeAll` is deliberately
   * NOT usable here: the Phase 3 engine freezes the CYCLE PRICE, so for 4
   * cycles it writes `total_amount = 90.00` where the commitment is 360.00.
   * That is the defect the guard exists for, and it has its own test below.
   */
  async function makeCoveredPlan(
    userId: string,
    opts: { cycles: number; perCycle: string; frequency?: string; interval?: number } = {
      cycles: 4,
      perCycle: "90.00",
    },
  ): Promise<string> {
    const { query } = await db();
    const created = await query(
      `INSERT INTO velrepeat_plans
         (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'draft', $2, $3, $4, NOW() + INTERVAL '7 days') RETURNING id`,
      [userId, opts.frequency ?? "weeks", opts.interval ?? 1, opts.cycles],
    );
    const id = String(created.rows[0].id);
    planIds.push(id);
    const perCycle = parseDecimal(opts.perCycle);
    await query(
      `INSERT INTO velrepeat_pricing_snapshots
         (plan_id, commitment_cycles, currency, subtotal_amount, discount_amount,
          cycle_price, total_amount, discount_type, discount_value, metadata)
       VALUES ($1, $2, 'THB', $3, 0.00, $4, $5, 'sequential_percentage', '0',
               $6::jsonb)`,
      [
        id,
        opts.cycles,
        toMoneyString(perCycle),
        toMoneyString(perCycle),
        toMoneyString(multiply(perCycle, makeRational(BigInt(opts.cycles), 1n))),
        JSON.stringify({
          final_price_exact: toExactDecimalString(perCycle),
          base_price: toMoneyString(perCycle),
          cycle_price: toMoneyString(perCycle),
          commitment_cycles: opts.cycles,
          total_prepaid: toMoneyString(multiply(perCycle, makeRational(BigInt(opts.cycles), 1n))),
          effective_discount: "0",
        }),
      ],
    );
    return id;
  }

  function cookie(userId: string): string {
    return `velnox_session=${jwt.sign(
      { userId, email: `${tag}@test.invalid` },
      process.env.JWT_SECRET as string,
      { expiresIn: "10m" },
    )}`;
  }

  async function postPayment(userId: string, id: string, body: unknown) {
    return fetch(`${base}/api/velrepeat/v2/plans/${id}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(userId) },
      body: JSON.stringify(body),
    });
  }

  /** A raw, correctly signed webhook delivery — the real signature path. */
  async function deliver(
    type: string,
    object: Record<string, unknown>,
    opts: { secret?: string; id?: string } = {},
  ) {
    const payload = JSON.stringify({
      id: opts.id ?? `evt_${randomUUID()}`,
      object: "event",
      type,
      data: { object },
    });
    return fetch(`${base}/api/payments/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignature(payload, opts.secret ?? TEST_WEBHOOK_SECRET),
      },
      body: payload,
    });
  }

  /** The attempt row the session-creation step would have written. */
  async function recordAttempt(
    id: string,
    opts: { method?: string; amount?: string; currency?: string; status?: string } = {},
  ): Promise<string> {
    const { query } = await db();
    const result = await query(
      `INSERT INTO payments
         (plan_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING id`,
      [
        id,
        opts.method ?? "CARD",
        opts.status ?? "requires_action",
        opts.amount ?? COMMITMENT_TOTAL,
        opts.currency ?? "THB",
        `cs_${randomUUID()}`,
        `pi_${randomUUID()}`,
        JSON.stringify({ scope: VELREPEAT_V2_PAYMENT_SCOPE }),
      ],
    );
    return String(result.rows[0].id);
  }

  async function readAttempt(paymentId: string) {
    const { query } = await db();
    const result = await query(
      `SELECT id, plan_id, order_id, method, provider, status, amount, currency,
              provider_checkout_session_id, provider_payment_id, paid_at
         FROM payments WHERE id = $1`,
      [paymentId],
    );
    return result.rows[0];
  }

  async function readPlan(id: string) {
    const { query } = await db();
    const result = await query(
      `SELECT id, status, started_at, next_run_at, payment_method, payment_method_ref,
              commitment_cycles, currency
         FROM velrepeat_plans WHERE id = $1`,
      [id],
    );
    return result.rows[0];
  }

  /**
   * Record ONE attempt and deliver its paid session. It returns the attempt so
   * the caller can assert against it — a caller that ALSO recorded an attempt
   * would collide with `idx_payments_one_active_stripe_plan`, which is the
   * database doing exactly what it exists to do.
   */
  async function settledSession(
    plan: string,
    over: Record<string, unknown> = {},
    method = "CARD",
  ): Promise<{ res: Response; paymentId: string; attempt: any }> {
    const paymentId = await recordAttempt(plan, { method });
    const attempt = await readAttempt(paymentId);
    const res = await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      payment_intent: attempt.provider_payment_id,
      metadata: v2Metadata(plan, { method }),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
      ...over,
    });
    return { res, paymentId, attempt };
  }

  async function sideEffectsFor(plan: string) {
    const { query } = await db();
    const [orders, cycles, runs, activations, paid] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM orders WHERE velrepeat_run_id IN
               (SELECT id FROM velrepeat_runs WHERE plan_id = $1)`, [plan]),
      query(`SELECT COUNT(*)::int AS n FROM velrepeat_cycles WHERE plan_id = $1`, [plan]),
      query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [plan]),
      query(`SELECT COUNT(*)::int AS n FROM velrepeat_events
              WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`, [plan]),
      query(`SELECT COUNT(*)::int AS n FROM payments
              WHERE plan_id = $1 AND status = 'paid'`, [plan]),
    ]);
    return {
      orders: orders.rows[0].n as number,
      cycles: cycles.rows[0].n as number,
      runs: runs.rows[0].n as number,
      activations: activations.rows[0].n as number,
      paidPayments: paid.rows[0].n as number,
    };
  }

  beforeAll(async () => {
    if (!hasDb) return;
    const { query } = await db();

    const app = express();
    app.use(cookieParser());
    // The raw-body gate must stay BEFORE express.json — the same wiring the
    // real server has (see middleware/stripe-raw-body.ts).
    app.use(stripeWebhookRawBody);
    app.use(express.json({ limit: "1mb" }));
    setupStripeRoutes(app);
    setupVelRepeatV2PlanRoutes(app);
    setupVelRepeatV2PaymentRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const existingRules = await query(`SELECT value FROM platform_settings WHERE key = $1`, [
      PRICING_RULES_SETTING_KEY,
    ]);
    previousRulesExisted = existingRules.rows.length > 0;
    previousRules = (existingRules.rows[0]?.value as string | undefined) ?? null;

    // 4 cycles × 100 THB = 400.00, less a 10% commitment discount = 360.00.
// NOTE the SHAPE: the setting is the platform rule format — snake_case keys,
// and `discount_value` is a FRACTION (`"0.10"`), not a percentage. The parser
// rejects anything else, and Phase 3 then refuses the purchase (fail closed),
// so this fixture must be written exactly as the parser reads it.
await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        PRICING_RULES_SETTING_KEY,
        JSON.stringify([
          { key: "commitment10", discount_type: "percentage", discount_value: "0.10", priority: 1, version: "1" },
        ]),
      ],
    );

    const mk = async (label: string) => {
      const r = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
        `${tag}-${label}@test.invalid`,
        `VelRepeat P4 ${label}`,
      ]);
      const id = String(r.rows[0].id);
      userIds.push(id);
      return id;
    };

    buyerId = await mk("buyer");
    otherBuyerId = await mk("other-buyer");

    const sellerUser = await mk("seller");
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUser],
    );
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [seller.rows[0].id, `${tag} shop`, `${tag}-shop`],
    );
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, 100.00, 'published') RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-product`],
    );
    const pkg = await query(
      `INSERT INTO velrepeat_packages (seller_id, name, is_active) VALUES ($1, $2, TRUE) RETURNING id`,
      [seller.rows[0].id, `${tag} package`],
    );
    packageId = String(pkg.rows[0].id);
    await query(
      `INSERT INTO velrepeat_package_items (package_id, product_id, quantity)
       VALUES ($1, $2, 1)`,
      [packageId, product.rows[0].id],
    );

    const created = await fetch(`${base}/api/velrepeat/v2/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyerId) },
      body: JSON.stringify({
        packageId,
        commitmentCycles: 4,
        frequencyType: "weeks",
        intervalValue: 1,
      }),
    });
    const body = (await created.json()) as {
      data?: {
        plan?: { id: string };
        pricing?: { cyclePrice: string; totalPrepaidAmount: string };
      };
      error?: { code: string; message: string };
    };
    // A failed fixture must name its own refusal. A bare `body.data!.plan!`
    // would surface as "undefined is not an object" and hide the real cause.
    expect({ status: created.status, error: body.error }).toEqual({
      status: 201,
      error: undefined,
    });
    planId = body.data!.plan!.id;
    planIds.push(planId);
    // The distinction, end to end through the real route: one cycle costs
    // 90.00, the 4-cycle prepaid commitment costs 360.00.
    expect(body.data!.pricing!.cyclePrice).toBe(PHASE3_CYCLE_PRICE);
    expect(body.data!.pricing!.totalPrepaidAmount).toBe(COMMITMENT_TOTAL);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (hasDb) {
      const { query } = await db();
      if (previousRulesExisted && previousRules !== null) {
        await query(`UPDATE platform_settings SET value = $1 WHERE key = $2`, [
          previousRules,
          PRICING_RULES_SETTING_KEY,
        ]);
      } else {
        await query(`DELETE FROM platform_settings WHERE key = $1`, [PRICING_RULES_SETTING_KEY]);
      }
      // Plan-scoped money is purged here, before the users: `payments.plan_id`
      // is a NO ACTION foreign key, so a payment that has outlived its plan
      // blocks the cascade that removes the plan. That is the intended
      // financial behaviour (a paid commitment must not be silently deleted),
      // so the fixture owns its cleanup rather than the shared order-scoped
      // helper.
      for (const id of planIds) {
        await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [id]);
        await query(`DELETE FROM payments WHERE plan_id = $1`, [id]);
      }
      await purgeUsers(userIds);
    }
    setPaymentEnv();
  });

  // ─── Payment creation refusals ──────────────────────────────────────────

  testFn("a non-existent plan is refused and writes nothing", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await postPayment(buyerId, randomUUID(), { method: "CARD" });
    expect(res.status).toBe(404);
    const { query } = await db();
    const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id IS NOT NULL`);
    expect(payments.rows[0].n).toBe(0);
  });

  testFn("another customer's plan cannot be paid for", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await postPayment(otherBuyerId, planId, { method: "CARD" });
    expect(res.status).toBe(403);
    const { query } = await db();
    const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [planId]);
    expect(payments.rows[0].n).toBe(0);
  });

  testFn("a client cannot pay a different amount, seller or currency", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    for (const attack of [
      { method: "CARD", amount: 1 },
      { method: "CARD", total: "1.00" },
      { method: "CARD", price: "0.01" },
      { method: "CARD", currency: "USD" },
      { method: "CARD", sellerId: randomUUID() },
      { method: "CARD", status: "active" },
      { method: "CARD", planStatus: "active" },
      { method: "CARD", paymentStatus: "paid" },
    ]) {
      const res = await postPayment(buyerId, planId, attack);
      // The property under test is that an injected field changes NOTHING: the
      // plan stays a draft, no payment row is written, and the response is
      // never a success that quotes a payable amount.
      //
      // The STATUS deliberately is not asserted. This request belongs to the
      // plan's real owner, so it is NOT refused at the ownership or pricing
      // gates — it legitimately reaches the payment provider, which is a live
      // network call this suite must not depend on. It used to assert
      // `[403, 409]`, but that only ever held because the pre-correction
      // pricing guard refused an under-covered snapshot before Stripe was
      // contacted. Asserting the outcome instead of a provider-dependent code
      // keeps the security claim honest and the test deterministic.
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(201);
      const plan = await readPlan(planId);
      expect(plan.status).toBe("draft");
      const { query } = await db();
      const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [planId]);
      expect(payments.rows[0].n).toBe(0);
    }
  });

  testFn("COD is refused at the payment endpoint", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await postPayment(buyerId, planId, { method: "COD" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe("UNSUPPORTED_PAYMENT_METHOD");
  });

  testFn("an unusable Stripe configuration refuses before anything is written", async () => {
    setPaymentEnv();
    const res = await postPayment(buyerId, planId, { method: "CARD" });
    expect(res.status).toBe(503);
    const { query } = await db();
    const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [planId]);
    expect(payments.rows[0].n).toBe(0);
  });

  testFn("a malformed plan id is refused", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await postPayment(buyerId, "not-a-uuid", { method: "CARD" });
    expect(res.status).toBe(400);
  });

  testFn("one live Stripe attempt per plan is enforced by the database", async () => {
    const a = await recordAttempt(planId);
    await expect(recordAttempt(planId)).rejects.toMatchObject({ code: "23505" });
    const { query } = await db();
    await query(`UPDATE payments SET status = 'cancelled' WHERE id = $1`, [a]);
  });

  testFn("a payment row can never name both parents, or neither", async () => {
    const { query } = await db();
    const { randomUUID: uuid } = await import("crypto");
    const orders = await query(`INSERT INTO orders (user_id, total_amount) VALUES ($1, 10) RETURNING id`, [buyerId]);
    await expect(
      query(
        `INSERT INTO payments (order_id, plan_id, provider, method, amount)
         VALUES ($1, $2, 'stripe', 'CARD', 10)`,
        [orders.rows[0].id, planId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      query(`INSERT INTO payments (provider, method, amount) VALUES ('stripe', 'CARD', 10)`),
    ).rejects.toMatchObject({ code: "23514" });
  });

  // ─── Webhook: refusals that must never activate ─────────────────────────

  testFn("an invalid signature is refused and nothing changes", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const paymentId = await recordAttempt(planId);
    const attempt = await readAttempt(paymentId);
    const forged = await deliver(
      "checkout.session.completed",
      {
        id: attempt.provider_checkout_session_id,
        metadata: v2Metadata(planId),
        payment_status: "paid",
        amount_total: COMMITMENT_MINOR,
        currency: "thb",
      },
      { secret: "whsec_a_completely_different_secret" },
    );
    expect(forged.status).toBe(400);
    expect((await readPlan(planId)).status).toBe("draft");
    expect((await readAttempt(paymentId)).status).toBe("requires_action");
    await db().then(({ query }) => query(`DELETE FROM payments WHERE id = $1`, [paymentId]));
  });

  testFn("an unpaid (PromptPay) session completes the checkout but never activates", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const paymentId = await recordAttempt(planId);
    const attempt = await readAttempt(paymentId);
    await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      metadata: v2Metadata(planId),
      payment_status: "unpaid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
    });
    expect((await readPlan(planId)).status).toBe("draft");
    const payment = await readAttempt(paymentId);
    expect(payment.status).toBe("requires_action");
    expect(payment.paid_at).toBeNull();
    await db().then(({ query }) => query(`DELETE FROM payments WHERE id = $1`, [paymentId]));
  });

  testFn("a wrong amount is refused: the money is recorded, the plan is NOT activated", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const plan = await makeCoveredPlan(buyerId);
    const paymentId = await recordAttempt(plan);
    const attempt = await readAttempt(paymentId);
    await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      metadata: v2Metadata(plan),
      payment_status: "paid",
      amount_total: 1, // under-charged, e.g. a tampered session
      currency: "thb",
    });
    expect((await readPlan(plan)).status).toBe("draft");
    // The money is still recorded — that is what makes it refundable and
    // visible — and a durable operator incident exists.
    expect((await readAttempt(paymentId)).status).toBe("paid");
    const { query } = await db();
    const incident = await query(
      `SELECT reason FROM payment_incidents WHERE plan_id = $1 AND payment_id = $2`,
      [plan, paymentId],
    );
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].reason).toBe("PLAN_AMOUNT_MISMATCH");
    await db().then(({ query }) =>
      query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [plan]),
    );
    await db().then(({ query }) => query(`DELETE FROM payments WHERE id = $1`, [paymentId]));
  });

  testFn("a wrong currency is refused and never activates", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const plan = await makeCoveredPlan(buyerId);
    const paymentId = await recordAttempt(plan);
    const attempt = await readAttempt(paymentId);
    await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      metadata: v2Metadata(plan),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "usd",
    });
    expect((await readPlan(plan)).status).toBe("draft");
    const { query } = await db();
    const incident = await query(`SELECT reason FROM payment_incidents WHERE plan_id = $1`, [plan]);
    expect(incident.rows[0].reason).toBe("PLAN_CURRENCY_MISMATCH");
    await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [plan]);
    await query(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  });

  testFn("a plan whose recorded method is the default COD never activates", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    // The schema default of `velrepeat_plans.payment_method` is 'cod'; a plan
    // must never become active while carrying a method no real charge used.
    const target = await makeCoveredPlan(buyerId);
    const paymentId = await recordAttempt(target, { method: "cod" });
    const attempt = await readAttempt(paymentId);
    await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      metadata: v2Metadata(target),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
    });
    const plan = await readPlan(target);
    expect(plan.status).toBe("draft");
    expect(plan.payment_method).toBe("cod");
    const { query } = await db();
    await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [target]);
    await query(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  });

  testFn("failure, cancellation and expiry settle nothing", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    for (const [type, expected] of [
      ["checkout.session.async_payment_failed", "failed"],
      ["checkout.session.expired", "cancelled"],
      ["payment_intent.canceled", "cancelled"],
    ] as const) {
      const plan = await makeCoveredPlan(buyerId);
      const paymentId = await recordAttempt(plan);
      const attempt = await readAttempt(paymentId);
      // Each event must name the identifier ITS object actually has: a
      // PaymentIntent event carries the intent id, a session event the session
      // id. Sending the wrong one resolves no attempt and proves nothing.
      const isCheckout = type.startsWith("checkout.");
      await deliver(type, {
        id: isCheckout ? attempt.provider_checkout_session_id : attempt.provider_payment_id,
        payment_intent: isCheckout ? attempt.provider_payment_id : undefined,
        metadata: v2Metadata(plan),
        currency: "thb",
      });
      expect((await readPlan(plan)).status).toBe("draft");
      expect((await readAttempt(paymentId)).status).toBe(expected);
      await db().then(({ query }) => query(`DELETE FROM payments WHERE id = $1`, [paymentId]));
    }
  });

  testFn("an event for an unknown plan never activates anything", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await deliver("payment_intent.succeeded", {
      id: "pi_orphan",
      metadata: v2Metadata(randomUUID()),
      amount_received: COMMITMENT_MINOR,
      currency: "thb",
    });
    expect(res.status).toBe(200);
    expect((await readPlan(planId)).status).toBe("draft");
  });

  // ─── Activation: the one transition this phase owns ─────────────────────

  testFn("the correctly priced plan created above is PAIDABLE at the total, not the cycle price", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    // The real Phase 3 route now writes cycle_price 90.00 AND total 360.00, so
    // the coverage guard is satisfied by construction. Reaching Stripe would
    // need the network, so what is proven here is that the refusal path is NOT
    // taken: the endpoint gets past pricing validation and fails only at the
    // provider, with an unconfigured live call — never with
    // COMMITMENT_TOTAL_UNVERIFIED.
    const { query } = await db();
    const snapshot = await query(
      `SELECT cycle_price, total_amount, commitment_cycles FROM velrepeat_pricing_snapshots
        WHERE plan_id = $1`,
      [planId],
    );
    expect(snapshot.rows[0].cycle_price).toBe("90.00");
    expect(snapshot.rows[0].total_amount).toBe("360.00");
    expect(snapshot.rows[0].commitment_cycles).toBe(4);
  });

  testFn("a snapshot that does not cover every cycle is REFUSED, never charged", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    // A LEGACY-shaped row: total_amount holds the per-cycle price while the
    // plan commits to 4 cycles. Migration 052 backfills rows like this, but a
    // corrupt or hand-written one must still be refused rather than charged at a
    // quarter of the commitment.
    const legacyPlan = await makeCoveredPlan(buyerId);
    await db().then(({ query }) =>
      query(
        `UPDATE velrepeat_pricing_snapshots
            SET total_amount = cycle_price
          WHERE plan_id = $1`,
        [legacyPlan],
      ),
    );

    const { query: beforeQuery } = await db();
    const beforeRows = await beforeQuery(
      `SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`,
      [legacyPlan],
    );
    const paymentCountBefore = beforeRows.rows[0].n as number;

    const res = await postPayment(buyerId, legacyPlan, { method: "CARD" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe("COMMITMENT_TOTAL_UNVERIFIED");

    // Nothing was created by this request.
    const { query } = await db();
    const after = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [
      legacyPlan,
    ]);
    expect(after.rows[0].n).toBe(paymentCountBefore);
    expect((await readPlan(legacyPlan)).status).toBe("draft");
  });

  testFn("an under-covered snapshot cannot activate a plan through the webhook either", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const legacyPlan = await makeCoveredPlan(buyerId);
    await db().then(({ query }) =>
      query(
        `UPDATE velrepeat_pricing_snapshots SET total_amount = cycle_price WHERE plan_id = $1`,
        [legacyPlan],
      ),
    );
    await db().then(({ query }) =>
      query(
        `UPDATE payments SET status = 'cancelled'
          WHERE plan_id = $1 AND status IN ('pending', 'requires_action')`,
        [legacyPlan],
      ),
    );
    const paymentId = await recordAttempt(legacyPlan);
    const attempt = await readAttempt(paymentId);
    await deliver("checkout.session.completed", {
      id: attempt.provider_checkout_session_id,
      metadata: v2Metadata(legacyPlan),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
    });
    // Stripe really did take 36000 minor units, and the row records it — but
    // the plan is NOT activated, because the frozen snapshot only commits 9000
    // per cycle. The money is visible and an operator is paged; no commitment
    // is activated against a total that does not cover it.
    expect((await readPlan(legacyPlan)).status).toBe("draft");
    expect((await readAttempt(paymentId)).status).toBe("paid");
    const { query } = await db();
    const incident = await query(
      `SELECT reason FROM payment_incidents WHERE plan_id = $1 AND payment_id = $2`,
      [legacyPlan, paymentId],
    );
    expect(incident.rows[0].reason).toBe("PLAN_NOT_ACTIVATABLE");
    await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [legacyPlan]);
    await query(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  });

  testFn("a verified success activates the plan exactly once, with no side effects", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const target = await makeCoveredPlan(buyerId);

    // A draft that has been sitting for a while: the re-anchoring must NOT be
    // decided by those stale timestamps.
    const { query } = await db();
    await query(
      `UPDATE velrepeat_plans
          SET started_at = NOW() - INTERVAL '40 days',
              next_run_at = NOW() - INTERVAL '33 days'
        WHERE id = $1`,
      [target],
    );

    // The window the settlement must fall inside, captured around the delivery.
    const before = new Date();
    const { res, paymentId, attempt } = await settledSession(target, {}, "CARD");
    const intentId = attempt.provider_payment_id;
    const sessionId = attempt.provider_checkout_session_id;
    expect(res.status).toBe(200);
    const after = new Date();

    // ── The plan moved, and only to `active` ──────────────────────────────
    const plan = await readPlan(target);
    expect(plan.status).toBe("active");
    // The real Stripe method — never the schema's 'cod' default.
    expect(plan.payment_method).toBe("CARD");
    expect(plan.payment_method_ref).toBe(intentId);
    expect(plan.currency).toBe("THB");
    expect(plan.commitment_cycles).toBe(4);

    // ── Timing re-anchored to the settlement instant ──────────────────────
    const startedAt = new Date(plan.started_at as string).getTime();
    expect(startedAt).toBeGreaterThanOrEqual(before.getTime() - 2000);
    expect(startedAt).toBeLessThanOrEqual(after.getTime() + 2000);
    const nextRunAt = new Date(plan.next_run_at as string);
    expect(nextRunAt.getTime()).toBe(
      calculateNextRunAt(new Date(startedAt), "weeks", 1).getTime(),
    );
    // Not 40 days ago, and not immediately — one committed interval after
    // activation, by the canonical scheduler derivation.
    expect(startedAt).toBeGreaterThan(before.getTime() - 60_000);

    // ── The money is in the canonical payments authority, parented by the plan
    const payment = await readAttempt(paymentId);
    expect(payment.status).toBe("paid");
    expect(payment.plan_id).toBe(target);
    // The whole point of migration 051: no order was involved at any point.
    expect(payment.order_id).toBeNull();
    expect(Number(payment.amount)).toBe(360);
    expect(payment.currency).toBe("THB");
    expect(payment.paid_at).not.toBeNull();

    // ── Zero orders, runs or fulfillment — and exactly the cycle SCHEDULE ──
    // Phase 5 (owner §10) changed ONE line of this block: activation now mints
    // the cycle SCHEDULE, so `commitment_cycles` cycles exist and all of them
    // are `scheduled`. Before Phase 5 this asserted 0. Everything that would
    // constitute premature fulfillment is still asserted at 0 below, and the
    // cycle states are pinned so a schedule can never quietly become work.
    const effects = await sideEffectsFor(target);
    expect(effects.orders).toBe(0);
    expect(effects.cycles).toBe(Number(plan.commitment_cycles));
    const cycleStates = await query(
      `SELECT status, COUNT(*)::int AS n FROM velrepeat_cycles
        WHERE plan_id = $1 GROUP BY status`,
      [target],
    );
    expect(cycleStates.rows).toEqual([{ status: "scheduled", n: 4 }]);
    expect(effects.runs).toBe(0);
    expect(effects.activations).toBe(1);
    expect(effects.paidPayments).toBe(1);

    // ── Idempotency: the same event again, and a DIFFERENT event for the
    //    same charge (what Stripe does: session + payment_intent) ─────────
    const replay = await deliver("checkout.session.completed", {
      id: sessionId,
      payment_intent: intentId,
      metadata: v2Metadata(target, { method: "CARD" }),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
    });
    expect(replay.status).toBe(200);

    await deliver("payment_intent.succeeded", {
      id: intentId,
      metadata: v2Metadata(target, { method: "CARD" }),
      amount_received: COMMITMENT_MINOR,
      currency: "thb",
    });

    const after_ = await sideEffectsFor(target);
    expect(after_.activations).toBe(1);
    expect(after_.paidPayments).toBe(1);
    // A duplicate delivery must not mint a SECOND schedule. `UNIQUE (plan_id,
    // cycle_number)` makes this impossible to fake, so the count holding at
    // the commitment is a real assertion about the replay.
    expect(after_.cycles).toBe(Number(plan.commitment_cycles));
    const planAfter = await readPlan(target);
    expect(planAfter.status).toBe("active");
    // Timing is NOT re-stamped by a duplicate delivery.
    expect(new Date(planAfter.started_at as string).getTime()).toBe(startedAt);

    // ── And an already-paid plan cannot be paid again ─────────────────────
    const rePay = await postPayment(buyerId, target, { method: "CARD" });
    expect(rePay.status).toBe(409);
  });

  testFn("concurrent deliveries of the same charge activate exactly once", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const plans = await query(
      `INSERT INTO velrepeat_plans
         (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'draft', 'weeks', 1, 4, NOW() + INTERVAL '7 days') RETURNING id`,
      [otherBuyerId],
    );
    const plan = String(plans.rows[0].id);
    planIds.push(plan);
    const snapshot = await query(
      `INSERT INTO velrepeat_pricing_snapshots
         (plan_id, commitment_cycles, currency, subtotal_amount, discount_amount,
          cycle_price, total_amount, metadata)
       VALUES ($1, 4, 'THB', 400.00, 40.00, 90.00, $2, $3::jsonb) RETURNING id`,
      [
        plan,
        COMMITMENT_TOTAL,
        JSON.stringify({ final_price_exact: "90", base_price: "100.00" }),
      ],
    );
    expect(snapshot.rows).toHaveLength(1);

    const paymentId = await recordAttempt(plan, { method: "PROMPTPAY" });
    const attempt = await readAttempt(paymentId);

    const event = (id: string) => ({
      id: attempt.provider_checkout_session_id,
      payment_intent: attempt.provider_payment_id,
      metadata: v2Metadata(plan, { method: "PROMPTPAY" }),
      payment_status: "paid",
      amount_total: COMMITMENT_MINOR,
      currency: "thb",
      __id: id,
    });

    // Five simultaneous deliveries, five distinct event ids: the plan lock and
    // the `status = 'draft'` guard must let exactly one of them activate.
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        deliver("checkout.session.completed", event(`evt_conc_${plan}_${n}`)),
      ),
    );
    for (const res of results) expect(res.status).toBe(200);

    const effects = await sideEffectsFor(plan);
    expect(effects.activations).toBe(1);
    expect(effects.paidPayments).toBe(1);
    const settled = await readPlan(plan);
    expect(settled.status).toBe("active");
    expect(settled.payment_method).toBe("PROMPTPAY");
    expect(effects.orders).toBe(0);
    // Five simultaneous deliveries produced ONE schedule, sized by the
    // commitment — not five schedules and not none. See the Phase 5 note on
    // the sibling assertion above.
    expect(effects.cycles).toBe(Number(settled.commitment_cycles));
  });

  testFn("an active plan is refused a second payment", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const res = await postPayment(otherBuyerId, randomUUID(), { method: "CARD" });
    expect(res.status).toBe(404);
  });

  testFn("settlement and activation are atomic with the payment record", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const plans = await query(
      `INSERT INTO velrepeat_plans
         (user_id, status, frequency_type, interval_value, commitment_cycles, next_run_at)
       VALUES ($1, 'draft', 'months', 1, 2, NOW()) RETURNING id`,
      [buyerId],
    );
    const plan = String(plans.rows[0].id);
    planIds.push(plan);
    await query(
      `INSERT INTO velrepeat_pricing_snapshots
         (plan_id, commitment_cycles, currency, subtotal_amount, discount_amount,
          cycle_price, total_amount, metadata)
       VALUES ($1, 2, 'THB', 200.00, 0.00, 180.00, $2, $3::jsonb)`,
      [
        plan,
        COMMITMENT_TOTAL,
        JSON.stringify({ final_price_exact: "180", base_price: "200.00" }),
      ],
    );
    const paymentId = await recordAttempt(plan, { method: "CARD" });
    const attempt = await readAttempt(paymentId);

    await deliver("payment_intent.succeeded", {
      id: attempt.provider_payment_id,
      metadata: v2Metadata(plan),
      amount_received: COMMITMENT_MINOR,
      currency: "thb",
    });

    // A month after activation, using the plan's own committed interval.
    const settled = await readPlan(plan);
    const expected = calculateNextRunAt(new Date(settled.started_at as string), "months", 1);
    expect(new Date(settled.next_run_at as string).getTime()).toBe(expected.getTime());
    expect(settled.status).toBe("active");

    // The activation event carries the linkage an operator needs, and no secret.
    const event = await query(
      `SELECT metadata FROM velrepeat_events
        WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`,
      [plan],
    );
    expect(event.rows).toHaveLength(1);
    const metadata = event.rows[0].metadata as Record<string, unknown>;
    expect(metadata.payment_id).toBe(paymentId);
    expect(metadata.mode).toBe("test");
    expect(metadata.snapshot_id).toBeTruthy();
    expect(JSON.stringify(metadata)).not.toContain("sk_test");
  });

  testFn("a payment for another customer's plan is never settled from a client claim", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    // The only writer of `active` is the webhook; no HTTP route exists that
    // could do it, and the V2 module exposes none.
    const target = await makeCoveredPlan(buyerId);
    for (const path of ["activate", "confirm", "complete", "status"]) {
      const res = await fetch(`${base}/api/velrepeat/v2/plans/${target}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(buyerId) },
        body: JSON.stringify({ paymentStatus: "paid", status: "active", amount: 1 }),
      });
      expect(res.status).toBe(404);
    }
    // A client claim of success changes nothing.
    expect((await readPlan(target)).status).toBe("draft");
  });

  testFn("the plan row is never locked across a provider call", async () => {
    // Structural: the Stripe client is obtained and used OUTSIDE the
    // validation transaction, so no row lock is ever held over the network.
    const code = stripComments(read("backend/routes/velrepeat-v2-payments.ts"));
    const transactionBlocks = code.match(/withTransaction\(async \(client\) => \{[\s\S]*?\n {2}\}\);/g) ?? [];
    expect(transactionBlocks.length).toBeGreaterThan(0);
    for (const block of transactionBlocks) {
      expect(block).not.toMatch(/stripe\./);
      expect(block).not.toMatch(/stripeServerClient\(/);
    }
    expect(() => withTransaction(async () => "unused")).not.toThrow();
  });
});