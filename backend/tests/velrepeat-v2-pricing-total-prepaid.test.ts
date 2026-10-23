/**
 * VelRepeat V2 — the TOTAL PREPAID commitment amount.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE PROVES
 * ─────────────────────
 *   1. THE INVARIANT — `total_prepaid = cycle_price × commitment_cycles`, on
 *      the examples the owner specified (A–F), including a fractional cycle
 *      price that must round ONCE and a commitment count that must fail
 *      closed.
 *   2. CYCLE PRICE ≠ TOTAL PREPAID whenever the commitment covers more than one
 *      cycle — the two are separate, explicitly named values and never aliases.
 *   3. The persisted snapshot carries BOTH, so a reader can prove the
 *      relationship from the row alone.
 *   4. The Stripe amount is the TOTAL, never the cycle price (except for a
 *      one-cycle commitment, where they are equal by definition).
 *   5. The webhook REJECTS a Stripe amount equal to the cycle price when the
 *      commitment total is cycle price × N.
 *   6. NO FLOATING POINT anywhere in the authoritative path.
 *   7. V1 is untouched.
 *
 * The pure half runs everywhere. The database half needs a disposable
 * PostgreSQL (`TEST_DATABASE_URL`) and skips without one — exactly like every
 * other DB-gated suite in this repository.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";

import { hasTestDatabase } from "./helpers/test-db.js";
import { NO_CANONICAL_DRIFT, canonicalParity } from "./helpers/canonical-schema.js";
import { purgeUsers } from "./helpers/purge.js";
import { withTransaction } from "../db/index.js";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { createHmac } from "crypto";
import {
  InvalidPricingInputError,
  computeCommitmentPricing,
  computeCommitmentPricingWithLines,
  computeTotalPrepaid,
  MAX_EFFECTIVE_DISCOUNT,
  parsePricingRuleSet,
  type PricingRule,
} from "../lib/velrepeat-pricing.js";
import { parseDecimal, toExactDecimalString, toMoneyString } from "../lib/money.js";
import { setupStripeRoutes, toStripeMinor } from "../routes/stripe.js";
import { setupVelRepeatV2PlanRoutes } from "../routes/velrepeat-v2-plans.js";
import {
  RepeatPlanPaymentError,
  VELREPEAT_V2_PAYMENT_SCOPE,
  assertCommitmentCoversEveryCycle,
  planTotalToStripeMinor,
  setupVelRepeatV2PaymentRoutes,
} from "../routes/velrepeat-v2-payments.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PAYMENT_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_MODE",
  "COD_ENABLED",
  "COD_CUSTOMER_SELECTABLE",
] as const;

const TEST_STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_000000000000000000000000",
  STRIPE_PUBLISHABLE_KEY: "pk_test_000000000000000000000000",
  STRIPE_WEBHOOK_SECRET: "whsec_000000000000000000000000",
};

function setPaymentEnv(values: Record<string, string> = {}): void {
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function rule(discount: string, priority = 1): PricingRule {
  return {
    key: `r${priority}`,
    version: "1",
    discountType: "percentage",
    discountValue: parseDecimal(discount),
    priority,
  };
}

/** Price one cycle and return the pair the whole model turns on. */
function price(cycleBase: string, cycles: number, rules: PricingRule[] = []) {
  const priced = computeCommitmentPricing({
    basePrice: parseDecimal(cycleBase),
    rules,
    commitmentCycles: cycles,
  });
  return { cycle: priced.cyclePrice, total: priced.totalPrepaidString };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE INVARIANT — the owner's examples, exactly
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — the invariant, example by example", () => {
  test("Example A — cycle 100, commitment 1 → total 100", () => {
    const { cycle, total } = price("100", 1);
    expect(cycle).toBe("100.00");
    expect(total).toBe("100.00");
    // With one cycle the two are the same number BY DEFINITION — which is the
    // only case in which a system may charge the cycle price.
    expect(cycle).toBe(total);
  });

  test("Example B — cycle 90, commitment 4 → total 360", () => {
    const { cycle, total } = price("90", 4);
    expect(cycle).toBe("90.00");
    expect(total).toBe("360.00");
    expect(total).not.toBe(cycle);
  });

  test("Example C — cycle 93, commitment 4 → total 372", () => {
    const { cycle, total } = price("93", 4);
    expect(cycle).toBe("93.00");
    expect(total).toBe("372.00");
  });

  test("Example D — a fractional cycle price rounds ONCE, at the end", () => {
    // 93.4444… × 3 = 280.3333… → 280.33.
    const exactCycle = parseDecimal("93.4444");
    expect(toMoneyString(computeTotalPrepaid(exactCycle, 3))).toBe("280.33");

    // The trap this rule exists to avoid: rounding the cycle price FIRST and
    // then multiplying would give 93.44 × 3 = 280.32 — a different charge.
    const roundedFirst = parseDecimal("93.44");
    expect(toMoneyString(roundedFirst)).toBe("93.44");
    expect(toMoneyString(computeTotalPrepaid(roundedFirst, 3))).toBe("280.32");
    expect(toMoneyString(computeTotalPrepaid(exactCycle, 3))).not.toBe(
      toMoneyString(computeTotalPrepaid(roundedFirst, 3)),
    );

    // Through the full pipeline the cycle price displays at 2dp while the total
    // is still the correctly rounded 280.33.
    const priced = computeCommitmentPricing({
      basePrice: exactCycle,
      rules: [],
      commitmentCycles: 3,
    });
    expect(priced.cyclePrice).toBe("93.44");
    expect(priced.totalPrepaidString).toBe("280.33");
    expect(toExactDecimalString(priced.totalPrepaid)).toBe("280.33");
  });

  test("Example E — a large valid commitment stays inside NUMERIC(12, 2)", () => {
    // 9_999_999.99 × 4 = 39_999_999.96 — the largest the column can hold.
    const { cycle, total } = price("9999999.99", 4);
    expect(cycle).toBe("9999999.99");
    expect(total).toBe("39999999.96");
    expect(Number(total)).toBeLessThan(10_000_000_000);

    // …and a commitment large enough would overflow the column, which the engine
    // does not silently clamp: the caller gets a number PostgreSQL will refuse,
    // and the whole purchase transaction rolls back.
    const over = computeCommitmentPricing({
      basePrice: parseDecimal("9999999.99"),
      rules: [],
      commitmentCycles: 1002,
    });
    expect(Number(over.totalPrepaidString)).toBeGreaterThan(10_000_000_000);
  });

  test("Example F — an impossible commitment count fails CLOSED", () => {
    for (const bad of [0, -1, -4, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 1.0000001]) {
      expect(() => computeTotalPrepaid(parseDecimal("90"), bad)).toThrow(
        InvalidPricingInputError,
      );
      // The whole engine refuses too, before any rule is applied.
      expect(() =>
        computeCommitmentPricing({ basePrice: parseDecimal("90"), rules: [], commitmentCycles: bad }),
      ).toThrow(InvalidPricingInputError);
    }
  });

  test("a non-integer commitment is refused by the lines entry point as well", () => {
    expect(() =>
      computeCommitmentPricingWithLines({
        planId: "11111111-1111-4111-8111-111111111111",
        commitmentCycles: 0,
        lines: [
          {
            productId: "22222222-2222-4222-8222-222222222222",
            variantId: null,
            quantity: 1,
            unitPrice: parseDecimal("90"),
          },
        ],
        rules: [],
        sellerId: "33333333-3333-4333-8333-333333333333",
        packageId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow(InvalidPricingInputError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CYCLE PRICE ≠ TOTAL PREPAID
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — the two prices are different numbers", () => {
  test("they are equal at one cycle and different at every larger commitment", () => {
    // One cycle: the two are the same number, which is the only case in which
    // a system may legitimately charge the cycle price.
    const single = price("90", 1);
    expect(single.cycle).toBe(single.total);

    for (const cycles of [2, 3, 4, 6, 12]) {
      const { cycle, total } = price("90", cycles);
      expect(total).not.toBe(cycle);
      expect(Number(total)).toBeCloseTo(90 * cycles, 6);
      expect(Number(total)).toBe(Number(cycle) * cycles);
    }
  });

  test("the discount chain applies to the CYCLE price; the total inherits it", () => {
    // 1,000 → 7% → 5% = 883.50 per cycle; × 4 = 3,534.00 prepaid.
    const { cycle, total } = price("1000", 4, [rule("0.07", 1), rule("0.05", 2)]);
    expect(cycle).toBe("883.50");
    expect(total).toBe("3534.00");
  });

  test("the 30% cap is unchanged: it is judged on the cycle price, once", () => {
    // Exactly 30% is legal and the total is simply 70% of base × cycles.
    const legal = computeCommitmentPricing({
      basePrice: parseDecimal("320"),
      rules: [rule("0.30")],
      commitmentCycles: 4,
    });
    expect(legal.cyclePrice).toBe("224.00");
    expect(legal.totalPrepaidString).toBe("896.00");
    expect(legal.effectiveDiscountPercentString).toBe("30.00");

    // A 36% chain still fails CLOSED, and does so before any total is computed.
    expect(() =>
      computeCommitmentPricing({
        basePrice: parseDecimal("100"),
        rules: [rule("0.20", 1), rule("0.20", 2)],
        commitmentCycles: 4,
      }),
    ).toThrow();
  });

  test("the cap constant is untouched by this change", () => {
    expect(toExactDecimalString(MAX_EFFECTIVE_DISCOUNT)).toBe("0.3");
  });

  test("the rule parser is untouched: snake_case, fractions", () => {
    const rules = parsePricingRuleSet(
      JSON.stringify([
        { key: "commitment", discount_type: "percentage", discount_value: "0.10", priority: 1, version: "1" },
      ]),
    );
    expect(rules).toHaveLength(1);
    const { cycle, total } = price("100", 4, rules);
    expect(cycle).toBe("90.00");
    expect(total).toBe("360.00");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE STRIPE AMOUNT IS THE TOTAL
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — what Stripe is asked to charge", () => {
  test("the derived charge is the commitment total in minor units", () => {
    // 360.00 THB → 36000 minor units. THB is a two-decimal Stripe currency.
    expect(planTotalToStripeMinor("360.00")).toBe(36000);
    expect(planTotalToStripeMinor("372.00")).toBe(37200);
    expect(planTotalToStripeMinor("100.00")).toBe(10000);
    // One cycle → the cycle price IS the total, so 100.00 is correct there.
    expect(planTotalToStripeMinor("93.00")).toBe(9300);
  });

  test("the charge agrees with the ONE minor-unit rule the order path uses", () => {
    for (const total of ["360.00", "372.00", "280.33", "1130.88", "0.01"]) {
      expect(planTotalToStripeMinor(total)).toBe(toStripeMinor(total));
    }
  });

  /** A refusal is asserted by its typed code, never by message text. */
function coverageRefusalFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof RepeatPlanPaymentError) return error.code;
    throw error;
  }
  throw new Error("expected a RepeatPlanPaymentError, but nothing was refused");
}

  test("a commitment whose total does not cover its cycles cannot be charged", () => {
    // The safety net that survives the fix: whatever wrote the row, a snapshot
    // whose total is the bare cycle price is still refused.
    expect(
      coverageRefusalFrom(() =>
        assertCommitmentCoversEveryCycle({
          totalAmount: "90.00",
          commitmentCycles: 4,
          finalPriceExact: "90",
        }),
      ),
    ).toBe("COMMITMENT_TOTAL_UNVERIFIED");

    expect(() =>
      assertCommitmentCoversEveryCycle({
        totalAmount: "360.00",
        commitmentCycles: 4,
        finalPriceExact: "90",
      }),
    ).not.toThrow();

    expect(() =>
      assertCommitmentCoversEveryCycle({
        totalAmount: "280.33",
        commitmentCycles: 3,
        finalPriceExact: "93.4444",
      }),
    ).not.toThrow();

    // A one-cycle commitment is exactly satisfied by its own cycle price.
    expect(() =>
      assertCommitmentCoversEveryCycle({
        totalAmount: "100.00",
        commitmentCycles: 1,
        finalPriceExact: "100",
      }),
    ).not.toThrow();
  });

  test("an unverifiable snapshot is refused rather than assumed", () => {
    for (const bad of [
      { totalAmount: "360.00", commitmentCycles: 0, finalPriceExact: "90" },
      { totalAmount: "360.00", commitmentCycles: 4, finalPriceExact: null },
      { totalAmount: "360.00", commitmentCycles: 4.5, finalPriceExact: "90" },
    ]) {
      expect(coverageRefusalFrom(() => assertCommitmentCoversEveryCycle(bad))).toBe(
        "COMMITMENT_TOTAL_UNVERIFIED",
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NO FLOATING POINT IN THE AUTHORITATIVE PATH (structural)
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — exact money, structurally", () => {
  const pricing = stripComments(read("backend/lib/velrepeat-pricing.ts"));
  const plans = stripComments(read("backend/routes/velrepeat-v2-plans.ts"));
  const payments = stripComments(read("backend/routes/velrepeat-v2-payments.ts"));
  const totalPath = `${pricing}\n${plans}\n${payments}`;

  test("no parseFloat / toFixed / raw Number() in the pricing path", () => {
    expect(pricing).not.toMatch(/\bparseFloat\s*\(/);
    expect(pricing).not.toMatch(/\.toFixed\s*\(/);
    expect(totalPath).not.toMatch(/\bparseFloat\s*\(/);
    expect(totalPath).not.toMatch(/\.toFixed\s*\(/);
  });

  test("Number() appears only where it is not money", () => {
    // `Number(row.cycles)` and `Number(x)` on identifiers are integers, not
    // money. What must never happen is a monetary value crossing a float.
    const moneyFloats = pricing.match(/Number\((?!row\.|plan\.|cycle|interval|subtotal)[^)]*\)/g) ?? [];
    for (const found of moneyFloats) {
      expect(found).not.toMatch(/amount|price|total|discount|subtotal/i);
    }
    // The authoritative conversion uses the rational module only.
    expect(pricing).toContain("roundHalfUp(");
    expect(pricing).toContain("makeRational(BigInt(commitmentCycles), 1n)");
    expect(pricing).not.toMatch(/\*\s*commitmentCycles\b/);
  });

  test("the total is computed from the UNROUNDED cycle price, not the 2dp one", () => {
    const fn = pricing.slice(
      pricing.indexOf("export function computeTotalPrepaid"),
      pricing.indexOf("export function computeTotalPrepaid") + 900,
    );
    // It takes the exact rational and rounds once at the end.
    expect(fn).toContain("multiply(cyclePrice");
    expect(fn).toContain("roundHalfUp(");
    expect(fn).not.toContain("toMoneyString(cyclePrice)");
    // …and it is fed `running`, the exact chain result, not `finalPriceString`.
    const callerStart = pricing.indexOf("const cyclePrice = toMoneyString(running)");
    expect(callerStart).toBeGreaterThan(-1);
    const caller = pricing.slice(callerStart, callerStart + 900);
    expect(caller).toContain("computeTotalPrepaid(running, commitmentCycles)");
  });

  test("the snapshot persists cycle price and total as SEPARATE columns", () => {
    expect(pricing).toMatch(
      /discount_amount, cycle_price, total_amount, pricing_rule_key/,
    );
    // …and writes the two different values into them.
    const insertStart = pricing.indexOf("INSERT INTO velrepeat_pricing_snapshots");
    expect(insertStart).toBeGreaterThan(-1);
    const insert = pricing.slice(insertStart, insertStart + 1400);
    expect(insert).toContain("pricing.cyclePrice,");
    expect(insert).toContain("pricing.totalPrepaidString,");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — schema", () => {
  const schema = read("db/schema.sql");

  test("the reconciler still declares everything the snapshot declares", () => {
    expect(canonicalParity(schema, read("db/run-sqleditor.sql"))).toEqual(
      NO_CANONICAL_DRIFT,
    );
  });

  test("cycle_price exists beside total_amount, and the total can never be less", () => {
    expect(schema).toMatch(
      /cycle_price NUMERIC\(12, 2\)[\s\S]{0,80}total_amount NUMERIC\(12, 2\) NOT NULL CHECK \(total_amount >= 0\)/,
    );
    expect(schema).toContain("velrepeat_pricing_snapshots_total_not_below_cycle");
    expect(schema).toContain("velrepeat_pricing_snapshots_cycle_price_not_null");
  });

  test("the migration is additive and never rewrites settled financial history", () => {
    const migration = stripSqlComments(
      read("db/migrations/052_velrepeat_pricing_cycle_price.sql"),
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS cycle_price");
    // Settled plans are excluded from the backfill by an explicit gate.
    expect(migration).toMatch(/status IN \('paid', 'processing'\)/);
    // It never writes to a financial ledger.
    for (const forbidden of [
      /INSERT INTO payments/,
      /UPDATE payments/,
      /INSERT INTO refunds/,
      /UPDATE refunds/,
      /UPDATE payment_incidents/,
      /DROP TABLE/,
      /DROP COLUMN/,
      /TRUNCATE/,
      /DELETE FROM/,
    ]) {
      expect(migration).not.toMatch(forbidden);
    }
  });

  test("the migration backfills the total from the EXACT cycle price", () => {
    const migration = stripSqlComments(
      read("db/migrations/052_velrepeat_pricing_cycle_price.sql"),
    );
    // `final_price_exact × commitment_cycles`, rounded once — not the 2dp
    // `cycle_price × commitment_cycles`.
    expect(migration).toMatch(/final_price_exact/);
    expect(migration).toMatch(/\*\s*s\.commitment_cycles/);
    expect(migration).toMatch(/ROUND\(/);
  });
});

function stripSqlComments(source: string): string {
  return source.replace(/--[^\n]*/g, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. V1 PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — V1 is untouched", () => {
  test("no V1 module, route or scheduler was changed by this correction", () => {
    for (const file of [
      "backend/routes/velrepeat-plans.ts",
      "backend/routes/velrepeat.ts",
      "backend/jobs/velrepeat-scheduler.ts",
      "backend/lib/velrepeat-scheduler.ts",
      "backend/routes/cart.ts",
      "backend/lib/inventory.ts",
      "backend/lib/order-fulfillment.ts",
    ]) {
      let source = "";
      try {
        source = read(file);
      } catch {
        continue;
      }
      expect(source).not.toContain("cycle_price");
      expect(source).not.toContain("computeTotalPrepaid");
      expect(source).not.toContain(VELREPEAT_V2_PAYMENT_SCOPE);
    }
  });

  test("V1 order checkout still derives its amount from the ORDER, untouched", () => {
    const stripe = read("backend/routes/stripe.ts");
    expect(stripe).toContain("const expectedMinor = toStripeMinor(order.total_amount);");
  });

  test("only additive migrations were added — 051 and 052 change no V1 table", () => {
    const v51 = stripSqlComments(read("db/migrations/051_payments_velrepeat_v2_plan_parent.sql"));
    const v52 = stripSqlComments(read("db/migrations/052_velrepeat_pricing_cycle_price.sql"));
    expect(v51).toContain("ALTER TABLE payments");
    expect(v51).not.toMatch(/ALTER TABLE orders/);
    expect(v52).toContain("ALTER TABLE velrepeat_pricing_snapshots");
    expect(v52).not.toMatch(/ALTER TABLE orders\b/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE WHOLE PATH, OVER HTTP + A REAL DATABASE
// ═══════════════════════════════════════════════════════════════════════════

describe("TOTAL PREPAID — create → pay → verify → activate (integration)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;
  const tag = `tp-${randomUUID().slice(0, 8)}`;

  let server: Server | undefined;
  let base = "";
  const userIds: string[] = [];
  let buyerId = "";
  let planId = "";

  const CYCLE = "90.00";
  const TOTAL = "360.00";
  const TOTAL_MINOR = 36000;
  const CYCLE_MINOR = 9000;

  let previousRules: string | null = null;
  let previousRulesExisted = false;

  async function db() {
    return import("../db/index.js");
  }

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

  async function deliver(type: string, object: Record<string, unknown>) {
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      type,
      data: { object },
    });
    return fetch(`${base}/api/payments/stripe/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature(payload, TEST_STRIPE_ENV.STRIPE_WEBHOOK_SECRET),
      },
      body: payload,
    });
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
          {
            key: "commitment10",
            discount_type: "percentage",
            discount_value: "0.10",
            priority: 1,
            version: "1",
          },
        ]),
      ],
    );

    const u = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-buyer@test.invalid`,
      `VelRepeat TP ${tag}`,
    ]);
    buyerId = String(u.rows[0].id);
    userIds.push(buyerId);

    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.invalid`,
      `VelRepeat TP seller ${tag}`,
    ]);
    userIds.push(String(sellerUser.rows[0].id));
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUser.rows[0].id],
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
    await query(
      `INSERT INTO velrepeat_package_items (package_id, product_id, quantity) VALUES ($1, $2, 1)`,
      [pkg.rows[0].id, product.rows[0].id],
    );

    const created = await fetch(`${base}/api/velrepeat/v2/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(buyerId) },
      body: JSON.stringify({
        packageId: pkg.rows[0].id,
        commitmentCycles: 4,
        frequencyType: "weeks",
        intervalValue: 1,
      }),
    });
    const body = (await created.json()) as any;
    expect(created.status).toBe(201);
    planId = body.data.plan.id;
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
        await query(`DELETE FROM platform_settings WHERE key = $1`, [
          "velrepeat_pricing_rules",
        ]);
      }
      // Plan-scoped money is purged HERE, before the users, and this fixture
      // owns its own cleanup rather than borrowing the shared order-scoped
      // helper: `payments.plan_id` is a NO ACTION foreign key, so a payment that
      // outlives its plan would block the cascade that removes the plan. That
      // is deliberate — a paid commitment must never be silently deleted by a
      // test. Leaving these rows behind would also make another suite's
      // "a refused payment writes nothing" count wrong, which is exactly the
      // kind of cross-file leak this comment exists to prevent.
      if (planId) {
        await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [planId]);
        await query(`DELETE FROM payments WHERE plan_id = $1`, [planId]);
      }
      await purgeUsers(userIds);
    }
    setPaymentEnv();
  });

  testFn("the persisted snapshot proves cycle price ≠ total prepaid", async () => {
    const { query } = await db();
    const snapshot = await query(
      `SELECT cycle_price, total_amount, commitment_cycles, metadata
         FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    const row = snapshot.rows[0];
    // 100.00 → 10% commitment discount = 90.00 per cycle …
    expect(row.cycle_price).toBe(CYCLE);
    // … × 4 cycles = 360.00 prepaid. The row itself makes the distinction.
    expect(row.total_amount).toBe(TOTAL);
    expect(row.commitment_cycles).toBe(4);
    expect(row.total_amount).not.toBe(row.cycle_price);

    // The exact relationship is re-derivable from the row alone.
    const metadata = row.metadata as Record<string, any>;
    expect(metadata.cycle_price).toBe(CYCLE);
    expect(metadata.commitment_cycles).toBe(4);
    expect(metadata.total_prepaid).toBe(TOTAL);
    // The exact total is stored as an exact decimal, not as a 2dp money string:
    // 90 × 4 is exactly 360, so there is nothing to round and nothing to pad.
    expect(metadata.total_prepaid_exact).toBe("360");
    expect(metadata.final_price_exact).toBe("90");

    // And it satisfies the settlement guard by construction.
    expect(() =>
      assertCommitmentCoversEveryCycle({
        totalAmount: String(row.total_amount),
        commitmentCycles: Number(row.commitment_cycles),
        finalPriceExact: metadata.final_price_exact,
      }),
    ).not.toThrow();
  });

  testFn("the amount derived for Stripe is the TOTAL, not the cycle price", async () => {
    const { query } = await db();
    const snapshot = await query(
      `SELECT cycle_price, total_amount FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
      [planId],
    );
    const { cycle_price, total_amount } = snapshot.rows[0];
    expect(planTotalToStripeMinor(total_amount)).toBe(TOTAL_MINOR);
    expect(planTotalToStripeMinor(cycle_price)).toBe(CYCLE_MINOR);
    // The charge is four times the cycle price, because four cycles were bought.
    expect(planTotalToStripeMinor(total_amount)).toBe(CYCLE_MINOR * 4);
  });

  testFn("a webhook carrying the CYCLE price is REJECTED for a 4-cycle commitment", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    // The identifiers the settlement path will look the attempt up by. It
    // resolves on `object.id` (the Checkout Session id) and on
    // `object.payment_intent`, so the delivered event must carry THESE ids —
    // an event naming ids the row does not have resolves nothing and would
    // prove nothing about amount verification.
    const sessionId = `cs_${randomUUID()}`;
    const intentId = `pi_${randomUUID()}`;
    const payment = await query(
      `INSERT INTO payments
         (plan_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', 'CARD', 'requires_action', $2, 'THB', $3, $4, $5::jsonb)
       RETURNING id`,
      [
        planId,
        TOTAL,
        sessionId,
        intentId,
        JSON.stringify({ scope: VELREPEAT_V2_PAYMENT_SCOPE }),
      ],
    );
    const paymentId = String(payment.rows[0].id);

    // Stripe reports ONE cycle's worth of money for a FOUR cycle commitment.
    const res = await deliver("checkout.session.completed", {
      id: sessionId,
      payment_intent: intentId,
      metadata: {
        scope: VELREPEAT_V2_PAYMENT_SCOPE,
        planId,
        userId: buyerId,
        method: "CARD",
      },
      payment_status: "paid",
      amount_total: CYCLE_MINOR,
      currency: "thb",
    });
    expect(res.status).toBe(200);

    const plan = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe("draft");
    // The money IS recorded as paid — Stripe really took it, and pretending
    // otherwise would hide it from the operator. What is refused is the
    // ACTIVATION, and it is refused durably so the money is visible and
    // refundable. This is the same contract Phase 4 pins for an under-charged
    // session.
    const row = await query(`SELECT status, amount FROM payments WHERE id = $1`, [paymentId]);
    expect(row.rows[0].status).toBe("paid");
    expect(Number(row.rows[0].amount)).toBe(360);
    const incident = await query(
      `SELECT reason FROM payment_incidents WHERE plan_id = $1 AND payment_id = $2`,
      [planId, paymentId],
    );
    expect(incident.rows).toHaveLength(1);
    expect(incident.rows[0].reason).toBe("PLAN_AMOUNT_MISMATCH");

    await query(`DELETE FROM payment_incidents WHERE plan_id = $1`, [planId]);
    await query(`DELETE FROM payments WHERE id = $1`, [paymentId]);
  });

  testFn("the same plan activates on the correct TOTAL, exactly once", async () => {
    setPaymentEnv(TEST_STRIPE_ENV);
    const { query } = await db();
    const payment = await query(
      `INSERT INTO payments
         (plan_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, metadata)
       VALUES ($1, 'stripe', 'CARD', 'requires_action', $2, 'THB', $3, $4, $5::jsonb)
       RETURNING id`,
      [
        planId,
        TOTAL,
        `cs_${randomUUID()}`,
        `pi_${randomUUID()}`,
        JSON.stringify({ scope: VELREPEAT_V2_PAYMENT_SCOPE }),
      ],
    );
    const paymentId = String(payment.rows[0].id);
    const attempt = await query(`SELECT * FROM payments WHERE id = $1`, [paymentId]);

    const res = await deliver("checkout.session.completed", {
      id: attempt.rows[0].provider_checkout_session_id,
      payment_intent: attempt.rows[0].provider_payment_id,
      metadata: {
        scope: VELREPEAT_V2_PAYMENT_SCOPE,
        planId,
        userId: buyerId,
        method: "CARD",
      },
      payment_status: "paid",
      amount_total: TOTAL_MINOR,
      currency: "thb",
    });
    expect(res.status).toBe(200);

    const plan = await query(
      `SELECT status, payment_method, started_at, next_run_at FROM velrepeat_plans WHERE id = $1`,
      [planId],
    );
    expect(plan.rows[0].status).toBe("active");
    expect(plan.rows[0].payment_method).toBe("CARD");

    // The canonical payment records the WHOLE commitment, parented by the plan.
    const settled = await query(`SELECT status, amount, order_id FROM payments WHERE id = $1`, [
      paymentId,
    ]);
    expect(settled.rows[0].status).toBe("paid");
    expect(Number(settled.rows[0].amount)).toBe(360);
    expect(settled.rows[0].order_id).toBeNull();

    // One activation, and nothing downstream was created.
    const activations = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_events
        WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`,
      [planId],
    );
    expect(activations.rows[0].n).toBe(1);
    // Phase 5 (owner §10): activation now mints the cycle SCHEDULE, so the
    // commitment's cycles exist and are all `scheduled`. Before Phase 5 this
    // asserted 0. The properties this test exists to protect are untouched and
    // still asserted below: no run, and therefore no order.
    const cycles = await query(
      `SELECT status, COUNT(*)::int AS n FROM velrepeat_cycles
        WHERE plan_id = $1 GROUP BY status`,
      [planId],
    );
    expect(cycles.rows).toEqual([{ status: "scheduled", n: 4 }]);
    const runs = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [
      planId,
    ]);
    expect(runs.rows[0].n).toBe(0);

    // A duplicate delivery changes nothing.
    await deliver("payment_intent.succeeded", {
      id: attempt.rows[0].provider_payment_id,
      metadata: {
        scope: VELREPEAT_V2_PAYMENT_SCOPE,
        planId,
        userId: buyerId,
        method: "CARD",
      },
      amount_received: TOTAL_MINOR,
      currency: "thb",
    });
    const again = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_events
        WHERE plan_id = $1 AND event_type = 'PLAN_ACTIVATED'`,
      [planId],
    );
    expect(again.rows[0].n).toBe(1);
  });
});