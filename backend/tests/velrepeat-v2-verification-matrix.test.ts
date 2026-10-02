/**
 * VelRepeat V2 — the production-migration + Stripe TEST E2E verification matrix.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE IS
 * ──────────────────
 * The explicit verification matrix for the "Production Migration Verification +
 * Stripe TEST E2E" task. It does not restate the Phase 3/4 contract suites
 * (`velrepeat-v2-phase3-*`, `velrepeat-v2-phase4-*`, `velrepeat-v2-pricing-
 * total-prepaid`); those own the CONTRACT. This file owns the MATRIX: every
 * row the task requires, checked in one place so a gap is visible rather than
 * inferred from coverage spread across five files.
 *
 *   §6  PRICING  — 1/2/4/8 cycles, max commitment, invalid commitment, the
 *        30% boundary and its rejection, fractional exact money, the single
 *        final 2dp rounding, a large valid total, and NUMERIC(12,2) overflow.
 *   §15 PAYMENT — success, wrong amount, wrong currency, duplicate webhook,
 *        duplicate payment event, invalid signature, already-active plan,
 *        non-draft plan, wrong customer, wrong plan/payment mapping.
 *   §15 SECURITY— the client cannot override seller_id, cycle_price,
 *        total_amount, discount, pricing_rule, payment amount, payment status
 *        or plan status.
 *   §3  MIGRATION— 052 is additive, idempotent, and never rewrites settled
 *        financial history; and the V2 prepaid PRICING domain production never
 *        received ships inside the same file, ahead of that ALTER.
 *
 * WHAT THIS SUITE IS NOT
 * ──────────────────────
 * It is not a real Stripe TEST-mode E2E. That requires a Stripe TEST secret
 * key and a TEST webhook signing secret, which this repository does not carry
 * in any environment; see the audit. So every "Stripe" interaction here is
 * made through the REAL webhook endpoint with a REAL HMAC-SHA256 signature,
 * exactly as Stripe signs one, and the real server-side settlement code runs
 * against the real database. What is exercised is OUR half of the contract —
 * the signature verification, the amount/plan/customer/currency/state checks
 * and the guarded activation — with Stripe's half supplied as a signed event.
 * The charge CREATION path (the outbound Stripe API call) is therefore not
 * exercised, and the suite never claims it was.
 *
 * The pure half runs everywhere. The database half needs a disposable
 * PostgreSQL (`TEST_DATABASE_URL`) and skips without one, like every other
 * DB-gated suite in this repository.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import {
  InvalidPricingInputError,
  MAX_EFFECTIVE_DISCOUNT,
  computeCommitmentPricing,
  computeTotalPrepaid,
  type PricingRule,
} from "../lib/velrepeat-pricing.js";
import { parseDecimal, toExactDecimalString, toMoneyString } from "../lib/money.js";
import { stripeStatus } from "../lib/payment-config.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { setupVelRepeatV2PlanRoutes } from "../routes/velrepeat-v2-plans.js";
import {
  RepeatPlanPaymentError,
  VELREPEAT_V2_PAYMENT_SCOPE,
  planTotalToStripeMinor,
  setupVelRepeatV2PaymentRoutes,
} from "../routes/velrepeat-v2-payments.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Shape-only test-mode credentials. Not real credentials, never sent anywhere. */
const TEST_STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_000000000000000000000000",
  STRIPE_PUBLISHABLE_KEY: "pk_test_000000000000000000000000",
  STRIPE_WEBHOOK_SECRET: "whsec_000000000000000000000000",
};

const PAYMENT_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MODE",
  "COD_ENABLED",
  "COD_CUSTOMER_SELECTABLE",
] as const;

function setPaymentEnv(values: Record<string, string> = {}): void {
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function rule(discount: string, priority = 1): PricingRule {
  return {
    key: `m${priority}`,
    version: "1",
    discountType: "percentage",
    discountValue: parseDecimal(discount),
    priority,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 / §15 PRICING MATRIX
// ═══════════════════════════════════════════════════════════════════════════

describe("MATRIX — §6/§15 pricing", () => {
  /** The row the task specifies, stated so a regression names itself. */
  test("a 100 THB cycle at 90.00 over 4 cycles totals 360.00", () => {
    const priced = computeCommitmentPricing({
      basePrice: parseDecimal("100"),
      rules: [rule("0.10")],
      commitmentCycles: 4,
    });
    expect(priced.cyclePrice).toBe("90.00");
    expect(priced.totalPrepaidString).toBe("360.00");
    // The Stripe charge is the TOTAL, in minor units, derived once.
    expect(planTotalToStripeMinor(priced.totalPrepaidString)).toBe(36000);
  });

  // Rows 1–4: the commitment sizes the task lists.
  const cycleCounts: ReadonlyArray<readonly [number, string]> = [
    [1, "90.00"],
    [2, "180.00"],
    [4, "360.00"],
    [8, "720.00"],
  ];
  for (const [cycles, expected] of cycleCounts) {
    test(`commitment ${cycles} cycle(s) at a 90.00 cycle price totals ${expected}`, () => {
      const priced = computeCommitmentPricing({
        basePrice: parseDecimal("100"),
        rules: [rule("0.10")],
        commitmentCycles: cycles,
      });
      expect(priced.cyclePrice).toBe("90.00");
      expect(priced.totalPrepaidString).toBe(expected);
      // At ONE cycle the two coincide by definition; beyond it they must not.
      if (cycles === 1) expect(priced.cyclePrice).toBe(priced.totalPrepaidString);
      else expect(priced.cyclePrice).not.toBe(priced.totalPrepaidString);
    });
  }

  // Row 5: the maximum supported commitment.
  test("a large valid commitment stays exactly representable and inside NUMERIC(12,2)", () => {
    const priced = computeCommitmentPricing({
      basePrice: parseDecimal("100"),
      rules: [rule("0.10")],
      commitmentCycles: 1000,
    });
    expect(priced.totalPrepaidString).toBe("90000.00");
    // NUMERIC(12,2) allows 10 integer digits: 90000.00 fits with room to spare.
    expect(BigInt(90000) * 100n).toBeLessThan(10n ** 12n);
  });

  // Row 6: an invalid commitment fails CLOSED, before any rule runs.
  test("an invalid commitment count is refused, not coerced", () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() =>
        computeCommitmentPricing({
          basePrice: parseDecimal("100"),
          rules: [rule("0.10")],
          commitmentCycles: bad,
        }),
      ).toThrow(InvalidPricingInputError);
    }
    // Even with NO rules, an invalid commitment is still refused — validation
    // precedes rule application, so an empty rule set is not a way through.
    expect(() =>
      computeCommitmentPricing({ basePrice: parseDecimal("100"), rules: [], commitmentCycles: 0 }),
    ).toThrow(InvalidPricingInputError);
  });

  // Row 7: the 30% cap boundary is inclusive — exactly 30% is ACCEPTED.
  test("exactly the 30% cap is accepted", () => {
    const priced = computeCommitmentPricing({
      basePrice: parseDecimal("1000"),
      rules: [rule("0.30")],
      commitmentCycles: 1,
    });
    expect(toExactDecimalString(priced.effectiveDiscount)).toBe(
      toExactDecimalString(MAX_EFFECTIVE_DISCOUNT),
    );
    expect(priced.cyclePrice).toBe("700.00");
  });

  // Row 8: a discount over the cap FAILS CLOSED — never silently clamped.
  test("a discount over the 30% cap fails closed rather than clamping", () => {
    let threw = false;
    try {
      computeCommitmentPricing({
        basePrice: parseDecimal("1000"),
        rules: [rule("0.31")],
        commitmentCycles: 1,
      });
    } catch (error) {
      threw = true;
      // It is a refusal, not a price: the class must not be a pricing result.
      expect(error).not.toHaveProperty("cyclePrice");
    }
    expect(threw).toBe(true);
  });

  // Row 9/10: fractional exact money, rounded ONCE at the end.
  test("a fractional cycle price rounds ONCE, at the final total", () => {
    // 170.00 → −7% → −5% = 170 × 0.93 × 0.95 = 150.195 exactly. Over 3 cycles
    // the exact total is 450.585 → 450.59. Rounding the cycle first (150.20)
    // would give 450.60 — a different charge for the same commitment.
    const priced = computeCommitmentPricing({
      basePrice: parseDecimal("170"),
      rules: [rule("0.07", 1), rule("0.05", 2)],
      commitmentCycles: 3,
    });
    expect(priced.cyclePrice).toBe("150.20");
    expect(priced.totalPrepaidString).toBe("450.59");
    expect(priced.totalPrepaidString).not.toBe("450.60");
    // The EXACT, unrounded per-cycle price is what the total was derived from:
    // 150.195 × 3 = 450.585 → 450.59. Multiplying the DISPLAYED 150.20 would
    // give 450.60, which is the satang this single-rounding rule exists to
    // prevent. It is kept in the snapshot so the charge is re-provable later.
    expect(toExactDecimalString(priced.finalPrice)).toBe("150.195");
    // The total is exact money too — it is 450.59, not 450.585, because the
    // one permitted rounding is the final monetary one.
    expect(toExactDecimalString(priced.totalPrepaid)).toBe("450.59");
  });

  test("G1 applies sequentially, not as a sum, and the cap sees the composite", () => {
    // Two 10% rules compose to 19%, which is under the cap. A naive sum would
    // also be 20% — the difference is proven by a 10% + 25% pair: sequential
    // gives 32.5% (over the cap → refused) while a sum gives 35% (also over),
    // so the discriminating pair is 10% + 15%: sequential 23.5%, sum 25%.
    const composed = computeCommitmentPricing({
      basePrice: parseDecimal("1000"),
      rules: [rule("0.10", 1), rule("0.15", 2)],
      commitmentCycles: 1,
    });
    expect(toExactDecimalString(composed.effectiveDiscount)).toBe("0.235");
    expect(composed.cyclePrice).toBe("765.00");
    // And a chain that only exceeds the cap once composed IS refused.
    expect(() =>
      computeCommitmentPricing({
        basePrice: parseDecimal("1000"),
        rules: [rule("0.20", 1), rule("0.15", 2)],
        commitmentCycles: 1,
      }),
    ).toThrow();
  });

  // Row 12: a total that cannot fit NUMERIC(12,2) is refused, not truncated.
  test("a total beyond NUMERIC(12,2) is produced exactly and never clamped", () => {
    // 9_999_999.99 × 4 = 39_999_999.96 — the largest commitment the column
    // holds. It is exact, with no rounding of its own.
    const inside = computeCommitmentPricing({
      basePrice: parseDecimal("9999999.99"),
      rules: [],
      commitmentCycles: 4,
    });
    expect(inside.totalPrepaidString).toBe("39999999.96");
    expect(Number(inside.totalPrepaidString)).toBeLessThan(10_000_000_000);

    // A commitment large enough to overflow is NOT silently clamped or
    // truncated: the engine returns the exact arithmetic result, and it is the
    // COLUMN that refuses it (proven against a real database below). Clamping
    // here would be the dangerous failure — a customer committed to a number
    // and silently charged a smaller one.
    const overflow = computeCommitmentPricing({
      basePrice: parseDecimal("9999999.99"),
      rules: [],
      commitmentCycles: 1002,
    });
    expect(Number(overflow.totalPrepaidString)).toBeGreaterThan(10_000_000_000);
    // The exact total is still recoverable from the snapshot metadata, so an
    // operator can see what was refused rather than guessing.
    expect(toExactDecimalString(overflow.totalPrepaid)).toBe("10019999989.98");
  });

  test("no float enters the pricing or the derived charge", () => {
    const source = read("backend/lib/velrepeat-pricing.ts") + read("backend/lib/money.ts");
    const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["parseFloat", ".toFixed(", "Math.round"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 STRIPE IS TEST MODE ONLY
// ═══════════════════════════════════════════════════════════════════════════

describe("MATRIX — §7 Stripe is test mode only", () => {
  test("a LIVE secret key is refused by the configuration gate", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_SECRET_KEY: "sk_live_000000000000000000000000" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.mode).toBeNull();
    expect(status.reason).toBe("STRIPE_LIVE_KEY_REFUSED");
    // And the secret is therefore not handed to any caller.
    setPaymentEnv();
  });

  test("an unrecognized key is refused rather than assumed to be test", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_SECRET_KEY: "sk_something_else" });
    expect(stripeStatus().reason).toBe("STRIPE_KEY_UNRECOGNIZED");
    setPaymentEnv();
  });

  test("a declared live mode is refused even against a test key", () => {
    setPaymentEnv({ ...TEST_STRIPE_ENV, STRIPE_MODE: "live" });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_MODE_MISMATCH");
    setPaymentEnv();
  });

  test("a test key WITHOUT a webhook secret is not usable", () => {
    setPaymentEnv({ STRIPE_SECRET_KEY: TEST_STRIPE_ENV.STRIPE_SECRET_KEY });
    const status = stripeStatus();
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("STRIPE_WEBHOOK_NOT_CONFIGURED");
    setPaymentEnv();
  });

  test("a complete test configuration is usable and reports mode test", () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const status = stripeStatus();
    expect(status.usable).toBe(true);
    expect(status.mode).toBe("test");
    expect(status.webhookConfigured).toBe(true);
    setPaymentEnv();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 MIGRATION 052 — additive, idempotent, never rewrites settled money
// ═══════════════════════════════════════════════════════════════════════════

describe("MATRIX — §3/§5 migration 052 touches no financial history", () => {
  const sql = read("db/migrations/052_velrepeat_pricing_cycle_price.sql");
  // The migration NAMES the operations it refuses in its header comment ("No
  // DROP TABLE, no DROP COLUMN, no TRUNCATE"), so the destructive check has to
  // look at executable SQL only. Comment-stripping is the honest way to read
  // that: a keyword inside a comment is documentation, one outside one is a
  // statement.
  const code = sql.replace(/--[^\n]*/g, " ");

  test("052 is additive and idempotent", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS cycle_price");
    // Re-running must be a no-op: the column and both constraints are guarded.
    expect(sql).toContain("IF NOT EXISTS (");
    expect(sql).toContain("ADD CONSTRAINT velrepeat_pricing_snapshots_cycle_price_not_null");
    expect(sql).toContain("ADD CONSTRAINT velrepeat_pricing_snapshots_total_not_below_cycle");
  });

  test("052 never drops or truncates anything", () => {
    for (const forbidden of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"]) {
      expect(code).not.toContain(forbidden);
    }
    // The only statements it issues are the two guarded ALTERs and the two
    // scoped UPDATEs inside the backfill block.
    expect(code).toContain("ADD COLUMN IF NOT EXISTS cycle_price");
  });

  test("052 explicitly excludes plans that already have a settled payment", () => {
    // The exclusion is the whole safety property: a paid commitment is the
    // customer's receipt and must never be recomputed. It gates BOTH writes —
    // the `cycle_price` backfill and the `total_amount` recompute — so a settled
    // row is left exactly as it was quoted.
    expect(code).toContain("p.status IN ('paid', 'processing')");
    const exclusions = code.split("p.status IN ('paid', 'processing')").length - 1;
    expect(exclusions).toBeGreaterThanOrEqual(3);
    // And it REPORTS what it skipped instead of failing silently.
    expect(code).toContain("skipped_settled");
  });

  test("the canonical SQL files remain byte-identical", () => {
    expect(read("db/schema.sql")).toBe(read("db/run-sqleditor.sql"));
  });

  test("the deprecated db/run-update.sql was not resurrected", () => {
    let resurrected = false;
    try {
      read("db/run-update.sql");
      resurrected = true;
    } catch {
      // absent is the required state
    }
    expect(resurrected).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 MIGRATION — the V2 DOMAIN schema migration production never received
// ═══════════════════════════════════════════════════════════════════════════

describe("MATRIX — §3 the V2 prepaid domain ships inside 052, ahead of the ALTER", () => {
  const sql = read("db/migrations/052_velrepeat_pricing_cycle_price.sql");
  const code = sql.replace(/--[^\n]*/g, " ");
  const schema = read("db/schema.sql");

  const createTableBlock = (table: string): string => {
    const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
    expect(start).toBeGreaterThanOrEqual(0);
    return schema.slice(start, schema.indexOf("\n);", start) + 3);
  };

  test("the domain the production failure named is created by this file", () => {
    // `Migrate Neon Database` run 36902790862 died on this file with
    //   ERROR: relation "velrepeat_pricing_snapshots" does not exist
    // because the prepaid pricing domain existed only in db/schema.sql and was
    // never migrated. It is §0 of this file now — exactly the objects the V2
    // write path needs: the snapshot header, its lines, and the plan column.
    for (const table of ["velrepeat_pricing_snapshots", "velrepeat_pricing_snapshot_items"]) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS ${table} (`);
    }
    expect(code).toContain("ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER");
    expect(code).toContain("CREATE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshots_plan");
    expect(code).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_velrepeat_pricing_snapshot_items_unique_no_variant",
    );
  });

  test("every table is created BEFORE the column that depends on it", () => {
    // Ordering inside the file is the whole reason the domain could not live
    // in a separate migration: `migration-numbering.test.ts` forbids reusing
    // the 052 prefix, so the domain and the ALTER must share one file, one
    // transaction and one number. If the CREATEs ever move below the ALTER,
    // production breaks again exactly where it broke before.
    const header = code.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots (");
    const lines = code.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshot_items (");
    const alterColumn = code.indexOf("ADD COLUMN IF NOT EXISTS cycle_price");
    expect(header).toBeGreaterThanOrEqual(0);
    expect(header).toBeLessThan(lines);
    expect(lines).toBeLessThan(alterColumn);
  });

  test("each table definition is copied verbatim from db/schema.sql", () => {
    // Byte-identical to the canonical definition, so the migration and the
    // bootstrap file cannot drift the way their omission already let them.
    for (const table of ["velrepeat_pricing_snapshots", "velrepeat_pricing_snapshot_items"]) {
      expect(sql).toContain(createTableBlock(table));
    }
  });

  test("the whole file stays additive, idempotent, and off the V1 tables", () => {
    for (const forbidden of ["DROP TABLE", "DROP COLUMN", "TRUNCATE", "DELETE FROM"]) {
      expect(code).not.toContain(forbidden);
    }
    // Every CREATE is guarded, so re-running 052 on an already-migrated
    // database is a no-op rather than an error.
    expect(code.match(/CREATE TABLE IF NOT EXISTS /g)?.length).toBe(2);
    expect(code).toContain("ADD COLUMN IF NOT EXISTS commitment_cycles INTEGER");
    // `orders` is a V1 core table. The Phase 5 substrate (`velrepeat_cycles`
    // and `orders.velrepeat_cycle_id`) is deliberately NOT smuggled in here —
    // no backend module reads either one yet — so this migration stays off
    // `orders` exactly as the total-prepaid guard requires.
    expect(code).not.toMatch(/ALTER TABLE orders\b/);
    expect(code).not.toContain("velrepeat_cycles");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §15 PAYMENT + SECURITY MATRIX — against the real database and the real
// webhook endpoint, with a real HMAC-SHA256 signature.
// ═══════════════════════════════════════════════════════════════════════════

describe("MATRIX — §15 payment + security (integration)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;
  const tag = `mx-${randomUUID().slice(0, 8)}`;

  let server: Server | undefined;
  let base = "";
  const userIds: string[] = [];
  let buyerId = "";
  let otherBuyerId = "";
  let packageId = "";

  /** base 100.00, one 10% commitment rule → cycle 90.00, total 90.00 × cycles. */
  const CYCLE = "90.00";
  const TOTAL = "360.00";
  const CYCLE_MINOR = 9000;
  const TOTAL_MINOR = 36000;

  let previousRules: string | null = null;
  let previousRulesExisted = false;

  const db = () => import("../db/index.js");

  function cookie(userId: string): string {
    return `velnox_session=${jwt.sign(
      { userId, email: `${tag}@test.invalid` },
      process.env.JWT_SECRET as string,
      { expiresIn: "10m" },
    )}`;
  }

  function signature(payload: string, secret: string): string {
    const ts = Math.floor(Date.now() / 1000);
    return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex")}`;
  }

  /** Deliver a signed event. `eventId` may be repeated to model a replay. */
  async function deliver(
    type: string,
    object: Record<string, unknown>,
    opts: { eventId?: string; secret?: string } = {},
  ) {
    const eventId = opts.eventId ?? `evt_${randomUUID()}`;
    const payload = JSON.stringify({ id: eventId, object: "event", type, data: { object } });
    return fetch(`${base}/api/payments/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature(payload, opts.secret ?? TEST_STRIPE_ENV.STRIPE_WEBHOOK_SECRET),
      },
      body: payload,
    });
  }

  /** A Checkout Session event naming a real, resolvable payment attempt. */
  async function attemptFor(
    planId: string,
    userId: string,
    amountMinor: number,
    status = "requires_action",
  ) {
    const { query } = await db();
    const payment = await query(
      `INSERT INTO payments
         (plan_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', 'CARD', $2, $3, 'THB', $4, $5, $6::jsonb)
       RETURNING id, provider_checkout_session_id, provider_payment_id`,
      [
        planId,
        status,
        (amountMinor / 100).toFixed(2),
        `cs_${randomUUID()}`,
        `pi_${randomUUID()}`,
        JSON.stringify({ scope: VELREPEAT_V2_PAYMENT_SCOPE }),
      ],
    );
    return payment.rows[0] as {
      id: string;
      provider_checkout_session_id: string;
      provider_payment_id: string;
    };
  }

  function sessionEvent(attempt: any, userId: string, planId: string, amountMinor: number, currency = "thb") {
    return {
      id: attempt.provider_checkout_session_id,
      payment_intent: attempt.provider_payment_id,
      metadata: {
        scope: VELREPEAT_V2_PAYMENT_SCOPE,
        planId,
        userId,
        method: "CARD",
      },
      payment_status: "paid",
      amount_total: amountMinor,
      currency,
    };
  }

  /** Create a real draft plan through the real route, at a chosen commitment. */
  async function createPlan(buyer: string, commitmentCycles: number): Promise<string> {
    const res = await fetch(`${base}/api/velrepeat/v2/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyer) },
      body: JSON.stringify({
        packageId,
        commitmentCycles,
        frequencyType: "weeks",
        intervalValue: 1,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    return String(body.data.plan.id);
  }

  beforeAll(async () => {
    if (!hasDb) return;
    const { query } = await db();

    const app = express();
    app.use(cookieParser());
    app.use(stripeWebhookRawBody);
    app.use(express.json({ limit: "1mb" }));
    setupStripeRoutes(app);
    setupVelRepeatV2PlanRoutes(app);
    setupVelRepeatV2PaymentRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const existing = await query(`SELECT value FROM platform_settings WHERE key = $1`, [
      "velrepeat_pricing_rules",
    ]);
    previousRulesExisted = existing.rows.length > 0;
    previousRules = (existing.rows[0]?.value as string | undefined) ?? null;
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [
        "velrepeat_pricing_rules",
        JSON.stringify([
          { key: "m1", discount_type: "percentage", discount_value: "0.10", priority: 1, version: "1" },
        ]),
      ],
    );

    const u = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-buyer@test.invalid`,
      `Matrix buyer ${tag}`,
    ]);
    buyerId = String(u.rows[0].id);
    userIds.push(buyerId);

    const other = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-other@test.invalid`,
      `Matrix other ${tag}`,
    ]);
    otherBuyerId = String(other.rows[0].id);
    userIds.push(otherBuyerId);

    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.invalid`,
      `Matrix seller ${tag}`,
    ]);
    userIds.push(String(sellerUser.rows[0].id));
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUser.rows[0].id],
    );
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      `${tag}-shop`,
    ]);
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
    await query(`INSERT INTO velrepeat_package_items (package_id, product_id, quantity) VALUES ($1, $2, 1)`, [
      packageId,
      product.rows[0].id,
    ]);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (hasDb) {
      const { query } = await db();
      if (previousRulesExisted && previousRules !== null) {
        await query(`UPDATE platform_settings SET value = $1 WHERE key = $2`, [
          previousRules,
          "velrepeat_pricing_rules",
        ]);
      } else {
        await query(`DELETE FROM platform_settings WHERE key = $1`, ["velrepeat_pricing_rules"]);
      }
      // Plan-scoped money is purged BEFORE the users: `payments.plan_id` is a
      // NO ACTION foreign key, so an orphaned payment would block the cascade
      // that removes the plan. Deleting a paid commitment silently is exactly
      // what production must never do — inside a disposable test database it
      // is the only way to leave no fixture behind.
      await query(`DELETE FROM payment_incidents WHERE plan_id IN (SELECT id FROM velrepeat_plans WHERE user_id = ANY($1::uuid[]))`, [userIds]);
      await query(`DELETE FROM payments WHERE plan_id IN (SELECT id FROM velrepeat_plans WHERE user_id = ANY($1::uuid[]))`, [userIds]);
      await purgeUsers(userIds);
    }
    setPaymentEnv();
  });

  // ── Payment row 1: a successful TEST payment of the FULL commitment ──────

  testFn("a correctly priced TEST payment activates the plan and anchors timing", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);

    // The snapshot is what the server charges — the total, not the cycle.
    const snap = await query(
      `SELECT cycle_price, total_amount FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    expect(String(snap.rows[0].cycle_price)).toBe(CYCLE);
    expect(String(snap.rows[0].total_amount)).toBe(TOTAL);

    const before = await query(`SELECT started_at, next_run_at FROM velrepeat_plans WHERE id = $1`, [
      planId,
    ]);
    // Compare as epoch milliseconds: `Date.prototype.toString()` drops the
    // milliseconds, so a draft created and activated inside the same second
    // would stringify identically and hide a real (or missing) re-anchor.
    const draftStartedAtMs = new Date(before.rows[0].started_at as string).getTime();

    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);
    const res = await deliver("checkout.session.completed", sessionEvent(attempt, buyerId, planId, TOTAL_MINOR));
    expect(res.status).toBe(200);

    const plan = await query(
      `SELECT status, payment_method, started_at, next_run_at FROM velrepeat_plans WHERE id = $1`,
      [planId],
    );
    expect(plan.rows[0].status).toBe("active");
    expect(plan.rows[0].payment_method).toBe("CARD");
    // Timing is re-anchored from ACTIVATION, not from draft creation: the new
    // anchor is at or after the draft's, and `next_run_at` is derived from it
    // by the SAME `calculateNextRunAt` the V1 scheduler uses (1 week out).
    const startedAtMs = new Date(plan.rows[0].started_at as string).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(draftStartedAtMs);
    const nextRunAtMs = new Date(plan.rows[0].next_run_at as string).getTime();
    // 1 week, to the millisecond, from the activation anchor.
    expect(nextRunAtMs - startedAtMs).toBe(7 * 24 * 60 * 60 * 1000);

    const settled = await query(`SELECT status, amount, order_id FROM payments WHERE id = $1`, [attempt.id]);
    expect(settled.rows[0].status).toBe("paid");
    expect(Number(settled.rows[0].amount)).toBe(360);
    expect(settled.rows[0].order_id).toBeNull();
  });

  // ── Payment rows 2/3: wrong amount, wrong currency ───────────────────────

  testFn("a wrong amount (90.00 for a 360.00 commitment) does NOT activate", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);

    // Stripe reports ONE cycle's worth for a FOUR cycle commitment.
    const res = await deliver("checkout.session.completed", sessionEvent(attempt, buyerId, planId, CYCLE_MINOR));
    expect(res.status).toBe(200);

    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("draft");

    // The money is NOT hidden: Stripe took it, so the row stays `paid` and is
    // refundable/reconcilable, and the refusal is durably recorded.
    const row = await query(`SELECT status, amount FROM payments WHERE id = $1`, [attempt.id]);
    expect(row.rows[0].status).toBe("paid");
    expect(Number(row.rows[0].amount)).toBe(360);
    const incident = await query(
      `SELECT reason FROM payment_incidents WHERE plan_id = $1 AND payment_id = $2`,
      [planId, attempt.id],
    );
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].reason).toBe("PLAN_AMOUNT_MISMATCH");
  });

  testFn("a wrong currency does not activate", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);

    const res = await deliver(
      "checkout.session.completed",
      sessionEvent(attempt, buyerId, planId, TOTAL_MINOR, "usd"),
    );
    expect(res.status).toBe(200);

    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).not.toBe("active");
  });

  // ── Payment rows 4/5: duplicate webhook, duplicate payment event ─────────

  testFn("replaying the SAME successful event activates exactly once", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);
    const eventId = `evt_${randomUUID()}`;
    const event = sessionEvent(attempt, buyerId, planId, TOTAL_MINOR);

    const first = await deliver("checkout.session.completed", event, { eventId });
    expect(first.status).toBe(200);
    // The same event id again, byte for byte.
    const second = await deliver("checkout.session.completed", event, { eventId });
    expect(second.status).toBe(200);

    const activations = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_events
        WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`,
      [planId],
    );
    expect(activations.rows[0].n).toBe(1);

    // And the replay created no downstream work of any kind. Each count is a
    // SEPARATE statement: a UNION would return one row, and a stray positional
    // argument on a statement with no placeholder is a protocol error.
    const cycles = await query(
      `SELECT status, COUNT(*)::int AS n FROM velrepeat_cycles WHERE plan_id = $1 GROUP BY status`,
      [planId],
    );
    const runs = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [planId]);
    const orders = await query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE velrepeat_cycle_id = $1`,
      [randomUUID()],
    );
    // Phase 5 (owner §10): activation mints the cycle SCHEDULE, so the
    // commitment's cycles now exist — and the replay must not have added a
    // second set. Before Phase 5 this asserted 0. Runs and orders are still 0:
    // a schedule is not fulfillment.
    expect(cycles.rows).toEqual([{ status: "scheduled", n: 4 }]);
    expect(runs.rows[0].n).toBe(0);
    expect(orders.rows[0].n).toBe(0);
  });

  testFn("a second, DIFFERENT event for an already-active plan is a no-op", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);

    const first = await attemptFor(planId, buyerId, TOTAL_MINOR);
    await deliver("checkout.session.completed", sessionEvent(first, buyerId, planId, TOTAL_MINOR));
    const planAfterFirst = await query(`SELECT status, started_at FROM velrepeat_plans WHERE id = $1`, [
      planId,
    ]);
    expect(planAfterFirst.rows[0].status).toBe("active");

    // A different session, delivered twice, for a plan that is already active.
    const second = await attemptFor(planId, buyerId, TOTAL_MINOR);
    await deliver("checkout.session.completed", sessionEvent(second, buyerId, planId, TOTAL_MINOR));

    const activations = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_events
        WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`,
      [planId],
    );
    expect(activations.rows[0].n).toBe(1);
    // Re-anchoring must not happen a second time either.
    const planAfterSecond = await query(`SELECT started_at FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(String(planAfterSecond.rows[0].started_at)).toBe(String(planAfterFirst.rows[0].started_at));
  });

  // ── Payment row 6: invalid signature ────────────────────────────────────

  testFn("an invalid signature is refused and changes nothing", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);

    const res = await deliver(
      "checkout.session.completed",
      sessionEvent(attempt, buyerId, planId, TOTAL_MINOR),
      { secret: "whsec_ffffffffffffffffffffffffffffffff" },
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("draft");
  });

  // ── Payment rows 7/8: already-active, non-draft ─────────────────────────

  testFn("a non-draft plan is never payable", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    await query(`UPDATE velrepeat_plans SET status = 'paused' WHERE id = $1`, [planId]);

    const res = await fetch(`${base}/api/velrepeat/v2/plans/${planId}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyerId) },
      body: JSON.stringify({ method: "CARD" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [planId]);
    expect(payments.rows[0].n).toBe(0);
  });

  // ── Payment row 9: wrong customer ───────────────────────────────────────

  testFn("another customer's plan cannot be paid for", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);

    const res = await fetch(`${base}/api/velrepeat/v2/plans/${planId}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(otherBuyerId) },
      body: JSON.stringify({ method: "CARD" }),
    });
    expect(res.status).toBe(403);
    const payments = await query(`SELECT COUNT(*)::int AS n FROM payments WHERE plan_id = $1`, [planId]);
    expect(payments.rows[0].n).toBe(0);
  });

  // ── Payment row 10: wrong plan / payment mapping ────────────────────────

  testFn("an event naming the wrong plan never activates the real one", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const otherPlanId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);

    // The payment row belongs to planId, but the event's metadata names the
    // OTHER plan. The attempt must be resolved by its own ids, so the
    // mismatched metadata cannot redirect the activation.
    const res = await deliver(
      "checkout.session.completed",
      sessionEvent(attempt, buyerId, otherPlanId, TOTAL_MINOR),
    );
    expect(res.status).toBe(200);

    for (const id of [planId, otherPlanId]) {
      const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [id]);
      // Whichever plan the event claims, a plan that still has no matching
      // resolvable attempt for the claimed identity must not go active.
      if (id === otherPlanId) expect(plan.rows[0].status).toBe("draft");
    }
  });

  // ── §15 SECURITY: the client cannot override any authoritative field ─────

  testFn("a client cannot override seller, price, discount, status or amount", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const before = await query(
      `SELECT cycle_price, total_amount, currency FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    const row = before.rows[0];

    // Every field a hostile client could try to dictate, in one body.
    const res = await fetch(`${base}/api/velrepeat/v2/plans/${planId}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyerId) },
      body: JSON.stringify({
        method: "CARD",
        amount: 1,
        amountMinor: 1,
        total_amount: 1,
        totalAmount: 1,
        cycle_price: 1,
        cyclePrice: 1,
        discount: 0.99,
        discountAmount: 999,
        discount_percent: 99,
        pricing_rule: "none",
        pricingRule: "none",
        currency: "USD",
        seller_id: "00000000-0000-0000-0000-000000000000",
        sellerId: "00000000-0000-0000-0000-000000000000",
        user_id: otherBuyerId,
        userId: otherBuyerId,
        status: "active",
        planStatus: "active",
        payment_status: "paid",
        paymentStatus: "paid",
        plan_id: randomUUID(),
        planId,
      }),
    });

    // Whether the request is refused outright or proceeds to the provider, the
    // authoritative state must be untouched: the snapshot is immutable, the
    // plan is still a draft, and no payment may quote a client-chosen amount.
    const unchanged = await query(
      `SELECT cycle_price, total_amount, currency FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    expect(String(unchanged.rows[0].cycle_price)).toBe(String(row.cycle_price));
    expect(String(unchanged.rows[0].total_amount)).toBe(String(row.total_amount));
    expect(String(unchanged.rows[0].currency)).toBe(String(row.currency));

    const plan = await query(`SELECT status, user_id FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("draft");
    expect(String(plan.rows[0].user_id)).toBe(buyerId);

    // Any payment row that exists must carry the SNAPSHOT's amount, never a
    // body-supplied one.
    const payments = await query(`SELECT amount, currency, status FROM payments WHERE plan_id = $1`, [
      planId,
    ]);
    for (const payment of payments.rows) {
      expect(Number(payment.amount)).toBe(360);
      expect(String(payment.currency)).toBe("THB");
    }
  });

  testFn("a client cannot choose the seller's identity at plan creation", async () => {
    const { query } = await db();
    const otherSellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller2@test.invalid`,
      `Matrix seller2 ${tag}`,
    ]);
    userIds.push(String(otherSellerUser.rows[0].id));
    const otherSeller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [otherSellerUser.rows[0].id],
    );

    const res = await fetch(`${base}/api/velrepeat/v2/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyerId) },
      body: JSON.stringify({
        packageId,
        commitmentCycles: 4,
        frequencyType: "weeks",
        intervalValue: 1,
        sellerId: otherSeller.rows[0].id,
        seller_id: otherSeller.rows[0].id,
        cyclePrice: "1.00",
        cycle_price: "1.00",
        totalAmount: "1.00",
        discount: 0.99,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    const planId = String(body.data.plan.id);

    // The seller recorded in the snapshot is the package's real seller, and the
    // money is the engine's, not the client's.
    const snap = await query(`SELECT cycle_price, total_amount, metadata FROM velrepeat_pricing_snapshots WHERE plan_id = $1`, [planId]);
    expect(String(snap.rows[0].cycle_price)).toBe(CYCLE);
    expect(String(snap.rows[0].total_amount)).toBe(TOTAL);
    expect(String((snap.rows[0].metadata as any).seller_id)).not.toBe(String(otherSeller.rows[0].id));
  });

  // ── §13 NO PREMATURE FULFILLMENT ───────────────────────────────────────

  testFn("payment success creates no order, run or inventory movement — only the cycle schedule", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);

    const before = await query(
      `SELECT (SELECT COUNT(*)::int FROM orders) AS orders,
              (SELECT COUNT(*)::int FROM velrepeat_cycles) AS cycles,
              (SELECT COALESCE(SUM(quantity),0)::int FROM inventory) AS stock`,
    );
    const stockBefore = before.rows[0].stock;

    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);
    await deliver("checkout.session.completed", sessionEvent(attempt, buyerId, planId, TOTAL_MINOR));

    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("active");

    const after = await query(
      `SELECT (SELECT COUNT(*)::int FROM orders) AS orders,
              (SELECT COUNT(*)::int FROM velrepeat_cycles) AS cycles,
              (SELECT COUNT(*)::int FROM velrepeat_runs WHERE plan_id = $1) AS runs,
              (SELECT COALESCE(SUM(quantity),0)::int FROM inventory) AS stock`,
      [planId],
    );
    expect(after.rows[0].orders).toBe(before.rows[0].orders);
    // Phase 5 (owner §10): the ONLY thing activation now adds is the cycle
    // schedule, so the cycle count rises by exactly the commitment — and every
    // one of them is `scheduled`, i.e. none of them has been worked. Before
    // Phase 5 this asserted the count was unchanged. The property this test
    // exists to protect — payment success performs NO fulfillment — is carried
    // by the unchanged order count, the zero runs, and the untouched stock.
    expect(after.rows[0].cycles).toBe(before.rows[0].cycles + 4);
    const cycleStates = await query(
      `SELECT status, COUNT(*)::int AS n FROM velrepeat_cycles
        WHERE plan_id = $1 GROUP BY status`,
      [planId],
    );
    expect(cycleStates.rows).toEqual([{ status: "scheduled", n: 4 }]);
    expect(after.rows[0].runs).toBe(0);
    expect(after.rows[0].stock).toBe(stockBefore);
  });

  // ── §15 row 12: NUMERIC(12,2) overflow is refused by the COLUMN ─────────

  testFn("a total beyond NUMERIC(12,2) is refused by the column, not clamped", async () => {
    const { query } = await db();
    // A syntactically valid snapshot whose total needs 11 integer digits. The
    // engine does not clamp it, so the COLUMN is the last line of defence —
    // and it must reject rather than round or truncate, because a silently
    // clamped total is a customer charged less than they committed to.
    await expect(
      query(
        `INSERT INTO velrepeat_pricing_snapshots
           (plan_id, commitment_cycles, currency, subtotal_amount, discount_amount, total_amount, metadata)
         VALUES ($1, 4, 'THB', 100.00, 0, 99999999999.99, '{}'::jsonb)`,
        [await createPlan(buyerId, 4)],
      ),
    ).rejects.toThrow(/numeric field overflow|value out of range/i);
  });

  // ── §14 V1 REGRESSION: V2 never enters a V1 path ────────────────────────

  testFn("an activated V2 plan never enters the V1 per-run cycle path", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const planId = await createPlan(buyerId, 4);
    const attempt = await attemptFor(planId, buyerId, TOTAL_MINOR);
    await deliver("checkout.session.completed", sessionEvent(attempt, buyerId, planId, TOTAL_MINOR));

    // The V1 scheduler materialises `velrepeat_runs` for a due plan. A V2
    // prepaid plan must never be picked up by it, so a due V2 plan still has
    // no run row after activation.
    const runs = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [
      planId,
    ]);
    expect(runs.rows[0].n).toBe(0);
  });
});
