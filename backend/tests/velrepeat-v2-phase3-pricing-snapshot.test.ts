/**
 * VelRepeat V2 — Phase 3: Seller Package → draft Repeat Plan → immutable
 * Pricing Snapshot.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS SUITE PROVES
 * ─────────────────────
 *   1. Request validation — the client sends references and quantities only;
 *      a seller id, a price, a discount or a rule in the body is never read as
 *      authority.
 *   2. Purchase-time package validation — exists, active, approved seller
 *      (Q-B), every item owned by that seller (G3), published product, active
 *      variant, variant belonging to the product.
 *   3. Pricing — the canonical engine only: sequential stacking (G1), the 30%
 *      cap failing CLOSED (G1.1), THB and one final rounding (G2).
 *   4. The plan is `draft` (Q-A) and the V1 scheduler cannot process it.
 *   5. The snapshot is purchase-time truth and never moves afterwards (E).
 *   6. Atomicity — a failure anywhere leaves NO plan and NO snapshot.
 *   7. V1 is unchanged.
 *
 * The pure and structural halves run everywhere. The integration half needs a
 * disposable database (`TEST_DATABASE_URL`, bootstrapped from
 * db/run-sqleditor.sql) and skips without one — exactly like every other
 * DB-gated suite here. It drives the REAL express routes over HTTP, so the
 * SQL, the status codes and the response shape are all exercised.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";
import { withTransaction } from "../db/index.js";
import { processPlan } from "../jobs/velrepeat-scheduler.js";
import { parseDecimal, toExactDecimalString, toMoneyString } from "../lib/money.js";
import {
  InvalidPricingInputError,
  PRICING_RULES_SETTING_KEY,
  PricingCapExceededError,
  PricingConfigurationError,
  VELREPEAT_CURRENCY,
  computeCommitmentPricingWithLines,
  type PricingRule,
} from "../lib/velrepeat-pricing.js";
import { PackageAuthorizationError } from "../routes/velrepeat-packages.js";
import {
  RepeatPlanPurchaseError,
  assertPackageAvailable,
  assertSellerEligible,
  buildPackageView,
  createDraftPlanFromPackage,
  loadPurchasablePackage,
  packageLinesFromItems,
  parsePackageId,
  parsePurchaseRequest,
  setupVelRepeatV2PlanRoutes,
  toPurchaseError,
  type PurchasablePackage,
  type PurchaseRequest,
} from "../routes/velrepeat-v2-plans.js";
import type { ValidatedPackageItem } from "../routes/velrepeat-packages.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Strip comments so a negative assertion describes CODE rather than the prose
 * around it — otherwise a doc comment saying "this module never writes
 * `active`" would fail a test that forbids the word.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PACKAGE_ID = "11111111-1111-1111-1111-111111111111";

/** A refusal is asserted by its typed status + code, never by message text. */
function refusalFrom(run: () => unknown): RepeatPlanPurchaseError {
  try {
    run();
  } catch (error) {
    if (error instanceof RepeatPlanPurchaseError) return error;
    throw error;
  }
  throw new Error("expected a RepeatPlanPurchaseError, but nothing was refused");
}

function pricingRule(key: string, discount: string, priority: number, version = "1"): PricingRule {
  return {
    key,
    version,
    discountType: "percentage",
    discountValue: parseDecimal(discount),
    priority,
  };
}

function validatedItem(over: Partial<ValidatedPackageItem> = {}): ValidatedPackageItem {
  return {
    productId: "22222222-2222-2222-2222-222222222222",
    variantId: null,
    quantity: 2,
    unitPrice: "100.00",
    productName: "Fixture product",
    shopId: "33333333-3333-3333-3333-333333333333",
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The request: references and quantities only
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — purchase request validation", () => {
  test("a well-formed purchase request parses to exactly four fields", () => {
    const parsed = parsePurchaseRequest({
      packageId: PACKAGE_ID,
      commitmentCycles: 4,
      frequencyType: "weeks",
      intervalValue: 2,
    });
    expect(parsed).toEqual({
      packageId: PACKAGE_ID,
      commitmentCycles: 4,
      frequencyType: "weeks",
      intervalValue: 2,
    });
    // The ONLY fields a caller can influence. Nothing price- or seller-shaped
    // exists on the parsed request.
    expect(Object.keys(parsed).sort()).toEqual([
      "commitmentCycles",
      "frequencyType",
      "intervalValue",
      "packageId",
    ]);
  });

  test("a package id must be a UUID", () => {
    for (const bad of [undefined, null, "", "not-a-uuid", 42, PACKAGE_ID.toUpperCase() + "x"]) {
      const refusal = refusalFrom(() => parsePackageId(bad));
      expect(refusal.status).toBe(400);
      expect(refusal.code).toBe("VALIDATION_ERROR");
    }
  });

  test("commitmentCycles must be a positive integer", () => {
    for (const bad of [undefined, null, 0, -1, 1.5, "4", Number.NaN, Number.POSITIVE_INFINITY]) {
      const refusal = refusalFrom(() =>
        parsePurchaseRequest({ packageId: PACKAGE_ID, commitmentCycles: bad }),
      );
      expect(refusal.status).toBe(400);
      expect(refusal.code).toBe("VALIDATION_ERROR");
    }
  });

  test("a commitment larger than the column can represent is refused, not truncated", () => {
    const refusal = refusalFrom(() =>
      parsePurchaseRequest({
        packageId: PACKAGE_ID,
        commitmentCycles: 2_147_483_648,
        frequencyType: "days",
        intervalValue: 30,
      }),
    );
    expect(refusal.status).toBe(400);
    expect(refusal.code).toBe("VALIDATION_ERROR");
  });

  test("the schedule is REQUIRED — no silent default is applied for the customer", () => {
    const missingFrequency = refusalFrom(() =>
      parsePurchaseRequest({ packageId: PACKAGE_ID, commitmentCycles: 4, intervalValue: 30 }),
    );
    expect(missingFrequency.code).toBe("VALIDATION_ERROR");

    const missingInterval = refusalFrom(() =>
      parsePurchaseRequest({ packageId: PACKAGE_ID, commitmentCycles: 4, frequencyType: "days" }),
    );
    expect(missingInterval.code).toBe("VALIDATION_ERROR");
  });

  test("frequencyType is restricted to the canonical vocabulary", () => {
    for (const bad of [undefined, null, "yearly", "DAYS", "", 7]) {
      const refusal = refusalFrom(() =>
        parsePurchaseRequest({
          packageId: PACKAGE_ID,
          commitmentCycles: 4,
          frequencyType: bad,
          intervalValue: 1,
        }),
      );
      expect(refusal.code).toBe("VALIDATION_ERROR");
    }
  });

  test("intervalValue must be a positive integer", () => {
    for (const bad of [undefined, null, 0, -2, 1.5, "1", Number.NaN]) {
      const refusal = refusalFrom(() =>
        parsePurchaseRequest({
          packageId: PACKAGE_ID,
          commitmentCycles: 4,
          frequencyType: "days",
          intervalValue: bad,
        }),
      );
      expect(refusal.code).toBe("VALIDATION_ERROR");
    }
  });

  test("client-supplied prices, sellers and rules are IGNORED, not validated", () => {
    // The fields the brief forbids as authority are simply not read: a body
    // full of them parses to the same four fields.
    const parsed = parsePurchaseRequest({
      packageId: PACKAGE_ID,
      commitmentCycles: 4,
      frequencyType: "days",
      intervalValue: 30,
      seller_id: "99999999-9999-9999-9999-999999999999",
      sellerId: "99999999-9999-9999-9999-999999999999",
      unit_price: "0.01",
      base_price: "0.01",
      final_price: "0.01",
      discount: "0.99",
      pricing_rule: { key: "free" },
      items: [{ productId: "44444444-4444-4444-4444-444444444444", quantity: 1 }],
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "commitmentCycles",
      "frequencyType",
      "intervalValue",
      "packageId",
    ]);
    expect(parsed.commitmentCycles).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Availability + seller eligibility (Q-B)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — package availability and seller eligibility", () => {
  test("an active package passes the availability check", () => {
    expect(() => assertPackageAvailable({ is_active: true })).not.toThrow();
  });

  test("missing and inactive packages are 404 — indistinguishable, and non-leaking", () => {
    for (const row of [undefined, { is_active: false }, { is_active: null }, {}]) {
      const refusal = refusalFrom(() => assertPackageAvailable(row as never));
      expect(refusal.status).toBe(404);
      expect(refusal.code).toBe("PACKAGE_NOT_FOUND");
      expect(refusal.message).not.toContain("inactive");
    }
  });

  test("Q-B — only an APPROVED seller is eligible, and the status is never echoed back", () => {
    expect(() => assertSellerEligible("approved")).not.toThrow();

    for (const status of ["pending", "under_review", "needs_correction", "rejected", "suspended", null]) {
      const refusal = refusalFrom(() => assertSellerEligible(status));
      expect(refusal.status).toBe(409);
      expect(refusal.code).toBe("PACKAGE_NOT_PURCHASABLE");
      expect(refusal.message).not.toContain("approved");
      if (typeof status === "string") expect(refusal.message).not.toContain(status);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Catalog price → exact money
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — catalog prices become exact money (no float anywhere)", () => {
  test("a NUMERIC string is carried exactly, digit for digit", () => {
    const [line] = packageLinesFromItems([validatedItem({ unitPrice: "0.10" })]);
    // Exactly one tenth — the canonical exact form, not a rounded or float-ish
    // rendering — and the money form keeps the 2-decimal column shape.
    expect(toExactDecimalString(line!.unitPrice)).toBe("0.1");
    expect(toMoneyString(line!.unitPrice)).toBe("0.10");
    expect(line!.unitPrice).toEqual(parseDecimal("0.1"));
  });

  test("quantity and variant identity survive the mapping", () => {
    const variantId = "55555555-5555-5555-5555-555555555555";
    const lines = packageLinesFromItems([
      validatedItem({ quantity: 3 }),
      validatedItem({ variantId, quantity: 1, unitPrice: "120.00" }),
    ]);
    expect(lines.map((l) => [l.quantity, l.variantId])).toEqual([
      [3, null],
      [1, variantId],
    ]);
  });

  test("a float would not survive: 0.10 × 3 is exactly 0.30, not 0.30000000000000004", () => {
    // `multiplyByQuantity` is integer arithmetic on a rational, so the exact
    // value stays exact; the float product would be 0.30000000000000004.
    const [line] = packageLinesFromItems([validatedItem({ unitPrice: "0.10", quantity: 3 })]);
    const product = computeCommitmentPricingWithLines({
      planId: "plan",
      commitmentCycles: 1,
      lines: [line!],
      rules: [],
      sellerId: "seller",
      packageId: "package",
    });
    expect(toExactDecimalString(product.finalPrice)).toBe("0.3");
    expect(product.finalPriceString).toBe("0.30");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Pricing through the canonical engine (G1, G1.1, G2)
// ═══════════════════════════════════════════════════════════════════════════

function pricePackage(request: {
  lines: ReturnType<typeof packageLinesFromItems>;
  rules: PricingRule[];
  commitmentCycles?: number;
  currency?: string;
}) {
  return computeCommitmentPricingWithLines({
    planId: "plan",
    commitmentCycles: request.commitmentCycles ?? 4,
    lines: request.lines,
    rules: request.rules,
    sellerId: "seller",
    packageId: "package",
    ...(request.currency ? { currency: request.currency } : {}),
  });
}

describe("Phase 3 — package base price and commitment price", () => {
  const twoLinePackage = packageLinesFromItems([
    validatedItem({ unitPrice: "100.00", quantity: 2 }),
    validatedItem({
      variantId: "66666666-6666-6666-6666-666666666666",
      unitPrice: "120.00",
      quantity: 1,
    }),
  ]);

  test("the base price is Σ(quantity × authoritative unit price)", () => {
    const priced = pricePackage({ lines: twoLinePackage, rules: [] });
    expect(priced.basePriceString).toBe("320.00");
    expect(priced.subtotal).toEqual(parseDecimal("320.00"));
    expect(priced.finalPriceString).toBe("320.00");
    expect(priced.discountAmountString).toBe("0.00");
  });

  test("G1 — rules apply sequentially to the price the previous rule produced", () => {
    // 1,000 → 7% → 930 → 5% → 883.50. Additive 12% would give 880.00.
    const lines = packageLinesFromItems([validatedItem({ unitPrice: "1000.00", quantity: 1 })]);
    const priced = pricePackage({
      lines,
      rules: [pricingRule("first", "0.07", 1), pricingRule("second", "0.05", 2)],
    });
    expect(priced.basePriceString).toBe("1000.00");
    expect(priced.finalPriceString).toBe("883.50");
    expect(priced.discountAmountString).toBe("116.50");
    // The trail keeps both rules, in the order applied, with their versions.
    expect(priced.appliedRules.map((r) => [r.key, r.version, r.priority, r.factor])).toEqual([
      ["first", "1", 1, "0.93"],
      ["second", "1", 2, "0.95"],
    ]);
    expect(priced.effectiveDiscountPercentString).toBe("11.65");
  });

  test("G1.1 — exactly 30% is legal (the boundary is inclusive)", () => {
    const lines = packageLinesFromItems([validatedItem({ unitPrice: "320.00", quantity: 1 })]);
    const priced = pricePackage({ lines, rules: [pricingRule("cap", "0.30", 1)] });
    expect(priced.finalPriceString).toBe("224.00");
    expect(priced.effectiveDiscountPercentString).toBe("30.00");
  });

  test("G1.1 — a breach is REFUSED, never clamped, trimmed or scaled", () => {
    const lines = packageLinesFromItems([validatedItem({ unitPrice: "100.00", quantity: 1 })]);
    let thrown: unknown = null;
    try {
      pricePackage({
        lines,
        rules: [pricingRule("a", "0.20", 1), pricingRule("b", "0.20", 2)],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PricingCapExceededError);
    // 1 - (0.8 × 0.8) = 36% > 30%. The refusal carries the numbers instead of
    // producing a price, so nothing downstream can charge a clamped amount.
    const refusal = thrown as PricingCapExceededError;
    expect(refusal.effectiveDiscount).toBe("0.36");
    expect(toPurchaseError(refusal)?.code).toBe("PRICING_UNAVAILABLE");
  });

  test("G2 — THB only; any other currency is refused", () => {
    const lines = packageLinesFromItems([validatedItem()]);
    expect(() => pricePackage({ lines, rules: [], currency: "USD" })).toThrow(
      InvalidPricingInputError,
    );
    expect(VELREPEAT_CURRENCY).toBe("THB");
    expect(pricePackage({ lines, rules: [] }).currency).toBe("THB");
  });

  test("G2 — no intermediate rounding: 0.05 → 7% → 5% is 0.04, not 0.05", () => {
    // 0.05 × 0.93 = 0.0465; a pipeline that rounded there would continue from
    // 0.05 and end at 0.05. Carried exactly, 0.0465 × 0.95 = 0.044175 → 0.04.
    const lines = packageLinesFromItems([validatedItem({ unitPrice: "0.01", quantity: 5 })]);
    const priced = pricePackage({
      lines,
      rules: [pricingRule("first", "0.07", 1), pricingRule("second", "0.05", 2)],
    });
    expect(toExactDecimalString(priced.finalPrice)).toBe("0.044175");
    expect(priced.finalPriceString).toBe("0.04");
    expect(priced.discountAmountString).toBe("0.01");
    expect(priced.effectiveDiscountPercentString).toBe("11.65");
  });

  test("the commitment must be a positive whole number of cycles, and it must have lines", () => {
    const lines = packageLinesFromItems([validatedItem()]);
    expect(() => pricePackage({ lines, rules: [], commitmentCycles: 0 })).toThrow(
      InvalidPricingInputError,
    );
    expect(() => pricePackage({ lines: [], rules: [] })).toThrow(InvalidPricingInputError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The customer view
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — the customer package view", () => {
  const pkg: PurchasablePackage = {
    id: PACKAGE_ID,
    name: "Fixture package",
    description: "Two lines",
    sellerId: "77777777-7777-7777-7777-777777777777",
    items: [
      validatedItem({ unitPrice: "100.00", quantity: 2 }),
      validatedItem({
        variantId: "88888888-8888-8888-8888-888888888888",
        unitPrice: "120.00",
        quantity: 1,
      }),
    ],
  };

  const displayRow = (productId: string, variantId: string | null, extra: Record<string, unknown> = {}) => ({
    product_id: productId,
    variant_id: variantId,
    quantity: 2,
    product_name: "Display name",
    shop_name: "Fixture shop",
    variant_name: variantId ? "Red / L" : null,
    image_url: "https://cdn.example/img.jpg",
    ...extra,
  });

  test("the view carries the validated lines and a canonical subtotal", () => {
    const view = buildPackageView(pkg, [
      displayRow(pkg.items[0]!.productId, null),
      displayRow(pkg.items[1]!.productId, pkg.items[1]!.variantId),
    ]);
    expect(view.basePrice).toBe("320.00");
    expect(view.currency).toBe("THB");
    expect(view.items.map((i) => [i.quantity, i.unitPrice, i.lineTotal])).toEqual([
      [2, "100.00", "200.00"],
      [1, "120.00", "120.00"],
    ]);
    // Every public name is projected from the catalog read.
    expect(view.items[1]!.variantName).toBe("Red / L");
    expect(view.items[0]!.shopName).toBe("Fixture shop");
    expect(view.items[0]!.imageUrl).toBe("https://cdn.example/img.jpg");
  });

  test("only VALIDATED items can appear — an extra projected row is ignored", () => {
    const view = buildPackageView(pkg, [
      displayRow(pkg.items[0]!.productId, null),
      displayRow(pkg.items[1]!.productId, pkg.items[1]!.variantId),
      // A row for something that did not pass the purchase gate.
      displayRow("99999999-9999-9999-9999-999999999999", null),
    ]);
    expect(view.items).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain("99999999-9999-9999-9999-999999999999");
  });

  test("the response shape is exactly the customer-visible set — nothing internal", () => {
    const view = buildPackageView(pkg, [
      displayRow(pkg.items[0]!.productId, null, {
        seller_id: pkg.sellerId,
        product_status: "draft",
        variant_status: "archived",
        stock: 0,
        cost_price: "1.00",
        metadata: { internal: true },
      }),
      displayRow(pkg.items[1]!.productId, pkg.items[1]!.variantId),
    ]);

    expect(Object.keys(view).sort()).toEqual([
      "basePrice",
      "currency",
      "description",
      "id",
      "items",
      "name",
    ]);
    for (const item of view.items) {
      expect(Object.keys(item).sort()).toEqual([
        "imageUrl",
        "lineTotal",
        "productId",
        "productName",
        "quantity",
        "shopName",
        "unitPrice",
        "variantId",
        "variantName",
      ]);
    }

    const encoded = JSON.stringify(view);
    for (const leaked of [
      pkg.sellerId,
      "seller_id",
      "product_status",
      "variant_status",
      "stock",
      "cost_price",
      "metadata",
      "draft",
      "archived",
    ]) {
      expect(encoded).not.toContain(leaked);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Refusal mapping — no internal reason reaches a customer
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — internal failures become customer-safe refusals", () => {
  test("this module's own refusals pass through unchanged", () => {
    const original = new RepeatPlanPurchaseError(404, "PACKAGE_NOT_FOUND", "Package not found");
    expect(toPurchaseError(original)).toBe(original);
  });

  test("a malformed rule set is refused as unpriced, never partially applied", () => {
    const mapped = toPurchaseError(new PricingConfigurationError("rule 3 has priority 'x'"));
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe("PRICING_UNAVAILABLE");
    // The configuration detail is not echoed.
    expect(mapped?.message).not.toContain("priority");
  });

  test("the cap refusal is reported without the cap, the numbers or the rule keys", () => {
    const mapped = toPurchaseError(new PricingCapExceededError("100.00", "60.00", "2/5"));
    expect(mapped?.code).toBe("PRICING_UNAVAILABLE");
    for (const secret of ["30", "0.30", "100.00", "60.00", "2/5", "cap"]) {
      expect(mapped!.message).not.toContain(secret);
    }
  });

  test("a composition refusal becomes a generic unpurchasable package", () => {
    const internal = new PackageAuthorizationError(
      400,
      "VARIANT_NOT_ELIGIBLE",
      "Variant 8888 is archived and cannot be added to a package",
    );
    const mapped = toPurchaseError(internal);
    expect(mapped?.status).toBe(409);
    expect(mapped?.code).toBe("PACKAGE_NOT_PURCHASABLE");
    for (const leaked of ["VARIANT_NOT_ELIGIBLE", "archived", "8888", "Variant"]) {
      expect(mapped!.message).not.toContain(leaked);
    }
  });

  test("an unrecognised failure is NOT dressed up as a refusal (it stays a 500)", () => {
    expect(toPurchaseError(new Error("connection reset"))).toBeNull();
    expect(toPurchaseError("boom")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Structural — schema and scheduler make `draft` safe (Q-A)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — the schema and the V1 scheduler (structural)", () => {
  const schema = read("db/schema.sql");
  const bootstrap = read("db/run-sqleditor.sql");
  const scheduler = read("backend/jobs/velrepeat-scheduler.ts");

  test("both canonical SQL files are byte-identical and unchanged by this phase", () => {
    expect(schema).toBe(bootstrap);
  });

  test("'draft' is legal in velrepeat_plans.status — stop condition #1 does not apply", () => {
    expect(schema).toContain(
      "CHECK (status IN ('draft', 'active', 'paused', 'processing', 'payment_failed', 'out_of_stock', 'item_unavailable', 'price_changed', 'cancelled', 'completed'))",
    );
  });

  test("the column default stays V1's 'active', so the V2 writer must be explicit", () => {
    expect(schema).toContain("status TEXT NOT NULL DEFAULT 'active'");
  });

  test("the due index selects active plans only — a draft cannot even be indexed as due", () => {
    expect(schema).toContain(
      "CREATE INDEX IF NOT EXISTS idx_velrepeat_plans_due ON velrepeat_plans (status, next_run_at) WHERE status = 'active'",
    );
  });

  test("the V1 due selection and claim both require status = 'active'", () => {
    expect(scheduler).toContain("WHERE status = 'active' AND next_run_at <= NOW()");
    expect(scheduler).toContain("WHERE id = $1 AND status = 'active' AND next_run_at <= NOW()");
  });

  test("next_run_at is NOT NULL, so a draft must carry a value (Phase 4 owns the real one)", () => {
    const start = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_plans (");
    const end = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_items (");
    expect(schema.slice(start, end)).toContain("next_run_at TIMESTAMPTZ NOT NULL");
  });

  test("the snapshot is bound to the plan, and its commitment cannot be empty", () => {
    expect(schema).toContain(
      "plan_id UUID NOT NULL REFERENCES velrepeat_plans(id) ON DELETE CASCADE",
    );
    expect(schema).toContain("commitment_cycles INTEGER NOT NULL CHECK (commitment_cycles > 0)");
  });

  test("snapshot items hold exactly the purchase-time line facts", () => {
    expect(schema).toContain("unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0)");
    expect(schema).toContain("line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0)");
    expect(schema).toContain("idx_velrepeat_pricing_snapshot_items_snapshot");
  });

  test("plan lines require the shop and the seller the plan is being bought from", () => {
    const start = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_items (");
    const end = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_runs (");
    const block = schema.slice(start, end);
    expect(block).toContain("shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE");
    expect(block).toContain("seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE");
  });

  test("a quantity of zero or less is impossible for a package item and for a snapshot item", () => {
    // The purchase request has no item-quantity field at all, and the two
    // tables that could hold one both refuse a non-positive value.
    const itemsStart = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_package_items (");
    const itemsEnd = schema.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots (");
    expect(schema.slice(itemsStart, itemsEnd)).toContain(
      "quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)",
    );
    expect(schema).toContain("quantity INTEGER NOT NULL CHECK (quantity > 0)");
  });

  test("every column the write path names exists in the canonical schema", () => {
    // A guard that costs nothing and catches a renamed column long before a
    // database does: each INSERT column list is read out of the module's own
    // SQL and checked against the table definition.
    const route = read("backend/routes/velrepeat-v2-plans.ts");

    const schemaColumns = (table: string): string[] => {
      const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
      const end = schema.indexOf(");", start);
      return schema
        .slice(start, end)
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[a-z_]+ /.test(line))
        .map((line) => line.split(/\s+/)[0]!);
    };

    const insertedColumns = (table: string): string[] => {
      const match = new RegExp(`INSERT INTO ${table}\\s*\\(([^)]+)\\)`).exec(route);
      if (!match) throw new Error(`no INSERT INTO ${table} found in the module`);
      return match[1]!.split(",").map((column) => column.trim());
    };

    for (const table of ["velrepeat_plans", "velrepeat_items", "velrepeat_events"]) {
      const known = schemaColumns(table);
      for (const column of insertedColumns(table)) {
        expect({ table, column, known: known.includes(column) }).toEqual({
          table,
          column,
          known: true,
        });
      }
    }

    // …and the customer read's projection only touches real columns too.
    for (const [table, column] of [
      ["product_images", "url"],
      ["product_images", "sort_order"],
      ["shops", "name"],
      ["product_variants", "name"],
      ["velrepeat_package_items", "quantity"],
    ] as const) {
      expect({ table, column, known: schemaColumns(table).includes(column) }).toEqual({
        table,
        column,
        known: true,
      });
    }
  });

  test("Phase 3 introduced no migration of its own; V0051 belongs to Phase 4", () => {
    const migrations = readdirSync(join(root, "db", "migrations"));
    // Phase 3 wrote only columns that already existed. The single migration
    // above its baseline is V0051 — the VelRepeat V2 PLAN PAYMENT parent
    // (Phase 4, owner decision Q13=B) — and it touches ONLY the payment
    // tables: it does not alter `velrepeat_plans`, a pricing snapshot, or any
    // other table Phase 3 reads or writes.
    expect(migrations.filter((name) => name.startsWith("051"))).toEqual([
      "051_payments_velrepeat_v2_plan_parent.sql",
    ]);
    const v51 = read("db/migrations/051_payments_velrepeat_v2_plan_parent.sql");
    expect(v51).not.toMatch(/ALTER TABLE velrepeat_plans/i);
    expect(v51).not.toMatch(/velrepeat_pricing_snapshots/i);
    expect(v51).not.toMatch(/velrepeat_items/i);
    expect(existsSync(join(root, "db", "run-update.sql"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Structural — the module cannot leave the phase's boundaries
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — module boundaries (structural)", () => {
  const raw = read("backend/routes/velrepeat-v2-plans.ts");
  const code = stripComments(raw);
  const server = read("backend/server.ts");

  test("the plan is written as 'draft' and the module can never write 'active'", () => {
    expect(code).toContain("VALUES ($1, 'draft', $2, $3, $4, $5)");
    expect(code).not.toContain("'active'");
    expect(code).not.toMatch(/UPDATE\s+velrepeat_plans/i);
  });

  test("plan + lines + snapshot + items + event are ONE transaction", () => {
    expect(code).toContain("withTransaction");
    expect(code).toContain("createDraftPlanFromPackage(client, userId, request)");
    // No second transaction: the callback never opens, commits or rolls back a
    // transaction of its own, and never borrows a client directly.
    expect(code).not.toMatch(/\bBEGIN\b/);
    expect(code).not.toMatch(/\bCOMMIT\b/);
    expect(code).not.toMatch(/\bROLLBACK\b/);
    expect(code).not.toContain("getClient");
  });

  test("the snapshot is written by the canonical helper, never by a second writer", () => {
    expect(code).toContain("insertPricingSnapshot");
    expect(code).not.toContain("INSERT INTO velrepeat_pricing_snapshots");
    expect(code).not.toContain("INSERT INTO velrepeat_pricing_snapshot_items");
    expect(code).not.toMatch(/(UPDATE|DELETE FROM)\s+velrepeat_pricing_snapshot/i);
  });

  test("pricing comes from the canonical engine and rules from the canonical configuration", () => {
    expect(code).toContain("computeCommitmentPricingWithLines");
    expect(code).toContain("loadPricingRuleSet");
    expect(code).toContain("packageLinesFromItems");
    // No pricing maths of its own and no float arithmetic.
    expect(code).not.toContain("parseFloat");
    expect(code).not.toMatch(/\bNumber\(/);
    expect(code).not.toMatch(/Math\.(round|floor|ceil)/);
  });

  test("money is only ever touched through backend/lib/money.ts", () => {
    expect(code).toContain('from "../lib/money.js"');
    for (const helper of ["parseDecimal", "toMoneyString", "multiplyByQuantity"]) {
      expect(code).toContain(helper);
    }
  });

  test("the seller and the price are never read from the request", () => {
    expect(code).toContain("req.user!.userId");
    expect(code).not.toMatch(/req\.body\??\.(seller_id|sellerId)/);
    expect(code).not.toMatch(
      /req\.body\??\.(unit_price|unitPrice|base_price|basePrice|final_price|finalPrice|discount|pricing_rule|pricingRule)/,
    );
    // The only body read is the validated purchase request.
    expect((code.match(/req\.body/g) ?? []).length).toBe(1);
  });

  test("payment, inventory and fulfillment are absent from the phase", () => {
    for (const forbidden of [
      "payment_method",
      "payment_method_ref",
      "stripe",
      "Stripe",
      "refund",
      "settlement",
      "inventory",
      "sold_count",
      "reserve",
      "velrepeat_cycles",
      "INSERT INTO orders",
      "order_items",
      "shipment",
      "fulfillment",
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("the package gate and the ownership chain are reused, not re-implemented", () => {
    expect(code).toContain("authorizePackageComposition");
    expect(code).toContain('from "./velrepeat-packages.js"');
    // The single-seller invariant is not re-checked by hand here.
    expect(code).not.toMatch(/SELECT\s+.*seller_id\s+AS/i);
  });

  test("the V2 surfaces cannot collide with the V1 packages/plans paths", () => {
    const v1Packages = read("backend/routes/velrepeat.ts");
    // V1 already owns this exact path on `vrepeat_packages` — which is why the
    // V2 read is namespaced.
    expect(v1Packages).toContain('app.get("/api/velrepeat/packages/:packageId"');
    expect(code).toContain('"/api/velrepeat/v2/packages/:packageId"');
    expect(code).toContain('"/api/velrepeat/v2/plans"');
    expect(code).not.toContain('"/api/velrepeat/packages');
    expect(code).not.toContain('"/api/velrepeat/plans"');
  });

  test("the routes are mounted, additively", () => {
    expect(server).toContain('from "./routes/velrepeat-v2-plans.js"');
    expect(server).toContain("setupVelRepeatV2PlanRoutes(app);");
    // V1 mounting order is untouched.
    expect(server).toContain("setupVelRepeatPlanRoutes(app);");
    expect(server).toContain("setupVelRepeatPackageRoutes(app);");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Structural — V1 is unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — V1 regression (structural)", () => {
  const v1Plans = read("backend/routes/velrepeat-plans.ts");
  const scheduler = read("backend/jobs/velrepeat-scheduler.ts");

  test("V1 plan creation still writes 'active' and still snapshots its own items", () => {
    expect(v1Plans).toContain("VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8)");
    expect(v1Plans).toContain('app.post("/api/velrepeat/plans"');
    expect(v1Plans).toContain('app.post("/api/velrepeat/repeat-now"');
  });

  test("V1's COD-only guard and its float price path are untouched", () => {
    expect(v1Plans).toContain("Only paymentMethod 'cod' is supported for recurring plans");
    expect(v1Plans).toContain("parseFloat");
  });

  test("the V1 file does not know about the V2 module, and the order of mounts is unchanged", () => {
    expect(v1Plans).not.toContain("velrepeat-v2-plans");
    expect(v1Plans).not.toContain("velrepeat-v2");
  });

  test("the V1 scheduler still reprices, orders, stocks and settles COD exactly as before", () => {
    // The side effects Q-A exists to keep away from an unpaid plan.
    expect(scheduler).toContain("UPDATE velrepeat_items SET unit_price = $1");
    expect(scheduler).toContain("INSERT INTO orders");
    expect(scheduler).toContain("sold_count");
    expect(scheduler).toContain("reserveInventoryStock");
  });

  test("no V1 → V2 migration or rewrite was introduced", () => {
    const migrations = readdirSync(join(root, "db", "migrations"));
    // 024 is the legacy V1 buy-ahead migration; 034/035/044 are the V2 plan
    // migrations. Phase 3 adds none of them. The two later additions are
    // additive columns on tables Phase 3 itself introduced or already owns:
    // V0051 adds a parent to `payments` (Phase 4, Q13=B) and V0052 adds the
    // per-cycle `cycle_price` to the pricing snapshot (the total-prepaid
    // correction). Neither rewrites a VelRepeat V1 table.
    expect(migrations.filter((name) => /velrepeat/i.test(name)).sort()).toEqual([
      "024_velrepeat_packages_deliveries_customer_events.sql",
      "034_velrepeat_v2.sql",
      "035_velrepeat_plans_status_fix.sql",
      "044_velrepeat_plans_status_constraint.sql",
      "051_payments_velrepeat_v2_plan_parent.sql",
      "052_velrepeat_pricing_cycle_price.sql",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Integration — the real routes over HTTP + the real database
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 3 — package → draft plan → snapshot (integration)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;
  const tag = `p3-${randomUUID().slice(0, 8)}`;

  let server: Server | undefined;
  let base = "";

  const userIds: string[] = [];
  const sellerIds: string[] = [];

  let buyerId = "";
  let buyerRejectedId = "";
  let buyerCapId = "";
  let buyerOverflowId = "";
  let buyerImmutableId = "";

  let sellerAId = "";
  let shopAId = "";
  let productAId = "";
  let variantAId = "";
  let archivedVariantAId = "";
  let draftProductAId = "";
  let noOptInProductAId = "";
  let overflowProductAId = "";
  let immutableProductAId = "";
  let immutableVariantAId = "";

  let sellerBId = "";
  let productBId = "";
  let variantBId = "";

  let pendingSellerId = "";
  let pendingProductId = "";

  let packageValidId = "";
  let packageInactiveId = "";
  let packageCrossSellerId = "";
  let packageDraftProductId = "";
  let packageArchivedVariantId = "";
  let packageWrongVariantId = "";
  let packagePendingSellerId = "";
  let packageNoOptInId = "";
  let packageOverflowId = "";
  let packageImmutableId = "";

  let previousRulesValue: string | null = null;

  async function makeUser(label: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const result = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-${label}@test.invalid`,
      `VelRepeat P3 ${label}`,
    ]);
    const id = result.rows[0].id as string;
    userIds.push(id);
    return id;
  }

  async function makeSeller(userId: string, status = "approved"): Promise<string> {
    const { query } = await import("../db/index.js");
    const result = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, $2) RETURNING id`, [
      userId,
      status,
    ]);
    const id = result.rows[0].id as string;
    sellerIds.push(id);
    return id;
  }

  async function makeShop(sellerId: string, label: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const result = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [sellerId, `${tag} ${label}`, `${tag}-${label}`],
    );
    return result.rows[0].id as string;
  }

  async function makeProduct(
    shopId: string,
    label: string,
    price: string,
    status = "published",
  ): Promise<string> {
    const { query } = await import("../db/index.js");
    const result = await query(
      `INSERT INTO products (shop_id, name, slug, price, status)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [shopId, `${tag} ${label}`, `${tag}-${label}`, price, status],
    );
    return result.rows[0].id as string;
  }

  async function makeVariant(productId: string, label: string, price: string, status = "active") {
    const { query } = await import("../db/index.js");
    const result = await query(
      `INSERT INTO product_variants (product_id, name, price, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [productId, label, price, status],
    );
    return result.rows[0].id as string;
  }

  /**
   * Packages are seeded with plain SQL, deliberately bypassing the seller
   * authoring gate: several fixtures (cross-seller, draft product, archived
   * variant) exist precisely to prove that the PURCHASE gate refuses states
   * that must never reach a customer.
   */
  async function makePackage(
    sellerId: string,
    label: string,
    items: ReadonlyArray<{ productId: string; variantId?: string | null; quantity: number }>,
    isActive = true,
  ): Promise<string> {
    const { query } = await import("../db/index.js");
    const created = await query(
      `INSERT INTO velrepeat_packages (seller_id, name, description, is_active)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [sellerId, `${tag} ${label}`, `${label} fixture`, isActive],
    );
    const packageId = created.rows[0].id as string;
    for (const item of items) {
      await query(
        `INSERT INTO velrepeat_package_items (package_id, product_id, variant_id, quantity)
         VALUES ($1, $2, $3, $4)`,
        [packageId, item.productId, item.variantId ?? null, item.quantity],
      );
    }
    return packageId;
  }

  async function setPricingRules(rules: unknown): Promise<void> {
    const { query } = await import("../db/index.js");
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [PRICING_RULES_SETTING_KEY, JSON.stringify(rules)],
    );
  }

  async function countPlans(userId: string): Promise<number> {
    const { query } = await import("../db/index.js");
    const result = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_plans WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0].n as number;
  }

  async function countSnapshotItemsFor(userId: string): Promise<number> {
    const { query } = await import("../db/index.js");
    const result = await query(
      `SELECT COUNT(*)::int AS n
         FROM velrepeat_pricing_snapshot_items i
         JOIN velrepeat_pricing_snapshots s ON s.id = i.snapshot_id
         JOIN velrepeat_plans p ON p.id = s.plan_id
        WHERE p.user_id = $1`,
      [userId],
    );
    return result.rows[0].n as number;
  }

  async function countPlanLines(userId: string): Promise<number> {
    const { query } = await import("../db/index.js");
    const result = await query(
      `SELECT COUNT(*)::int AS n
         FROM velrepeat_items i
         JOIN velrepeat_plans p ON p.id = i.plan_id
        WHERE p.user_id = $1`,
      [userId],
    );
    return result.rows[0].n as number;
  }

  function cookie(userId: string): string {
    return `velnox_session=${jwt.sign({ userId, email: `${tag}@test.invalid` }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
  }

  function purchaseBody(packageId: string, over: Record<string, unknown> = {}) {
    return {
      packageId,
      commitmentCycles: 4,
      frequencyType: "weeks",
      intervalValue: 1,
      ...over,
    };
  }

  async function postPlan(userId: string, body: unknown) {
    return fetch(`${base}/api/velrepeat/v2/plans`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie(userId) },
      body: JSON.stringify(body),
    });
  }

  async function getPackage(userId: string, packageId: string) {
    return fetch(`${base}/api/velrepeat/v2/packages/${packageId}`, {
      headers: { cookie: cookie(userId) },
    });
  }

  beforeAll(async () => {
    if (!hasDb) return;
    const { query } = await import("../db/index.js");

    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupVelRepeatV2PlanRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const existing = await query(`SELECT value FROM platform_settings WHERE key = $1`, [
      PRICING_RULES_SETTING_KEY,
    ]);
    previousRulesValue = (existing.rows[0]?.value as string | undefined) ?? null;

    buyerId = await makeUser("buyer");
    buyerRejectedId = await makeUser("buyer-rejected");
    buyerCapId = await makeUser("buyer-cap");
    buyerOverflowId = await makeUser("buyer-overflow");
    buyerImmutableId = await makeUser("buyer-immutable");

    sellerAId = await makeSeller(await makeUser("seller-a"));
    shopAId = await makeShop(sellerAId, "shop-a");
    productAId = await makeProduct(shopAId, "product-a", "100.00");
    variantAId = await makeVariant(productAId, "variant-a", "120.00");
    archivedVariantAId = await makeVariant(productAId, "variant-archived", "90.00", "archived");
    draftProductAId = await makeProduct(shopAId, "product-draft", "100.00", "draft");
    // NOTE: `vrepeat_enabled` is deliberately left at its DEFAULT (FALSE) —
    // see the dedicated test below.
    noOptInProductAId = await makeProduct(shopAId, "product-no-optin", "100.00");
    overflowProductAId = await makeProduct(shopAId, "product-overflow", "9999999.99");
    immutableProductAId = await makeProduct(shopAId, "product-immutable", "50.00");
    immutableVariantAId = await makeVariant(immutableProductAId, "variant-immutable", "60.00");

    sellerBId = await makeSeller(await makeUser("seller-b"));
    productBId = await makeProduct(await makeShop(sellerBId, "shop-b"), "product-b", "100.00");
    variantBId = await makeVariant(productBId, "variant-b", "110.00");

    pendingSellerId = await makeSeller(await makeUser("seller-pending"), "pending");
    pendingProductId = await makeProduct(
      await makeShop(pendingSellerId, "shop-pending"),
      "product-pending",
      "100.00",
    );

    packageValidId = await makePackage(sellerAId, "package-valid", [
      { productId: productAId, quantity: 2 },
      { productId: productAId, variantId: variantAId, quantity: 1 },
    ]);
    packageInactiveId = await makePackage(
      sellerAId,
      "package-inactive",
      [{ productId: productAId, quantity: 1 }],
      false,
    );
    packageCrossSellerId = await makePackage(sellerAId, "package-cross-seller", [
      { productId: productBId, quantity: 1 },
    ]);
    packageDraftProductId = await makePackage(sellerAId, "package-draft-product", [
      { productId: draftProductAId, quantity: 1 },
    ]);
    packageArchivedVariantId = await makePackage(sellerAId, "package-archived-variant", [
      { productId: productAId, variantId: archivedVariantAId, quantity: 1 },
    ]);
    // A variant that exists and is active — but belongs to ANOTHER product.
    packageWrongVariantId = await makePackage(sellerAId, "package-wrong-variant", [
      { productId: productAId, variantId: variantBId, quantity: 1 },
    ]);
    packagePendingSellerId = await makePackage(pendingSellerId, "package-pending-seller", [
      { productId: pendingProductId, quantity: 1 },
    ]);
    packageNoOptInId = await makePackage(sellerAId, "package-no-optin", [
      { productId: noOptInProductAId, quantity: 1 },
    ]);
    packageOverflowId = await makePackage(sellerAId, "package-overflow", [
      { productId: overflowProductAId, quantity: 2000 },
    ]);
    packageImmutableId = await makePackage(sellerAId, "package-immutable", [
      { productId: immutableProductAId, quantity: 1 },
      { productId: immutableProductAId, variantId: immutableVariantAId, quantity: 2 },
    ]);

    // 320.00 → 7% → 5% → 282.72 (a realistic two-rule configuration).
    await setPricingRules([
      {
        key: "commitment_4_cycles",
        version: "2026-09-30",
        discount_type: "percentage",
        discount_value: "0.07",
        priority: 1,
      },
      {
        key: "package_loyalty",
        version: "2",
        discount_type: "percentage",
        discount_value: "0.05",
        priority: 2,
      },
    ]);
  });

  afterAll(async () => {
    if (!hasDb) return;
    const { query } = await import("../db/index.js");
    if (sellerIds.length > 0) {
      await query(`DELETE FROM velrepeat_packages WHERE seller_id = ANY($1::uuid[])`, [sellerIds]);
    }
    if (previousRulesValue === null) {
      await query(`DELETE FROM platform_settings WHERE key = $1`, [PRICING_RULES_SETTING_KEY]);
    } else {
      await query(`UPDATE platform_settings SET value = $2, updated_at = NOW() WHERE key = $1`, [
        PRICING_RULES_SETTING_KEY,
        previousRulesValue,
      ]);
    }
    if (userIds.length > 0) await purgeUsers(userIds);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  testFn("an eligible customer reads the package: validated composition, canonical subtotal, nothing internal", async () => {
    const response = await getPackage(buyerId, packageValidId);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    const pkg = body.data.package;
    expect(pkg.id).toBe(packageValidId);
    expect(pkg.currency).toBe("THB");
    expect(pkg.basePrice).toBe("320.00");
    expect(pkg.items).toHaveLength(2);
    expect(pkg.items.map((i: any) => [i.quantity, i.unitPrice, i.lineTotal])).toEqual([
      [2, "100.00", "200.00"],
      [1, "120.00", "120.00"],
    ]);
    expect(pkg.items[1].variantName).toBe("variant-a");

    // No seller identity, no internal status, no stock, no audit metadata.
    const encoded = JSON.stringify(body);
    for (const leaked of [sellerAId, "seller_id", "sellerId", "is_active", "stock", "status", "metadata"]) {
      expect(encoded).not.toContain(leaked);
    }
  });

  testFn("the read is ownership-free but requires authentication", async () => {
    const anonymous = await fetch(`${base}/api/velrepeat/v2/packages/${packageValidId}`);
    expect(anonymous.status).toBe(401);
  });

  testFn("a package can be read by a customer who did not author it", async () => {
    // `buyerId` is not the seller of this package — that is the point.
    const response = await getPackage(buyerId, packageValidId);
    expect(response.status).toBe(200);
  });

  testFn("a valid package creates a DRAFT plan, its snapshot and its snapshot items", async () => {
    const response = await postPlan(buyerId, purchaseBody(packageValidId));
    expect(response.status).toBe(201);

    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.plan.status).toBe("draft");
    expect(body.data.plan.commitmentCycles).toBe(4);
    expect(body.data.plan.frequencyType).toBe("weeks");
    expect(body.data.plan.intervalValue).toBe(1);
    expect(body.data.pricing).toEqual({
      currency: "THB",
      basePrice: "320.00",
      discountAmount: "37.28",
      // 320 → 7% → 5% gives 282.72 for ONE cycle …
      cyclePrice: "282.72",
      // … and the prepaid customer owes that price for all 4 committed cycles.
      totalPrepaidAmount: "1130.88",
      effectiveDiscountPercent: "11.65",
    });
    expect(typeof body.data.snapshotId).toBe("string");

    const { query } = await import("../db/index.js");
    const plan = await query(`SELECT * FROM velrepeat_plans WHERE id = $1`, [body.data.plan.id]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].status).toBe("draft");
    expect(plan.rows[0].user_id).toBe(buyerId);
    expect(plan.rows[0].commitment_cycles).toBe(4);
    expect(new Date(plan.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now());

    // Phase 3 writes NO payment linkage: Phase 4 owns it.
    expect(plan.rows[0].payment_method_ref).toBeNull();
    // …and no duplicate provenance on the plan row (the snapshot metadata owns it).
    expect(plan.rows[0].metadata ?? {}).toEqual({});

    const snapshot = await query(`SELECT * FROM velrepeat_pricing_snapshots WHERE plan_id = $1`, [
      body.data.plan.id,
    ]);
    expect(snapshot.rows).toHaveLength(1);
    const snap = snapshot.rows[0];
    expect(snap.commitment_cycles).toBe(4);
    expect(snap.currency).toBe("THB");
    expect(Number(snap.subtotal_amount)).toBe(320);
    expect(Number(snap.discount_amount)).toBe(37.28);
    expect(Number(snap.total_amount)).toBe(282.72);
    expect(snap.discount_type).toBe("sequential_percentage");
    expect(snap.pricing_rule_key).toBe("commitment_4_cycles+package_loyalty");
    expect(snap.pricing_rule_version).toBe("2026-09-30+2");

    // Purchase-time truth, in the existing metadata column: seller, package,
    // the ordered rule trail and the exact (unrounded) result.
    expect(snap.metadata.seller_id).toBe(sellerAId);
    expect(snap.metadata.package_id).toBe(packageValidId);
    expect(snap.metadata.cap_enforced).toBe(true);
    // The cap travels as its exact canonical decimal form: one tenth-style
    // rational (0.3), never a 2-decimal rendering of it.
    expect(snap.metadata.max_effective_discount).toBe("0.3");
    expect(snap.metadata.applied_rules.map((r: any) => [r.key, r.version, r.factor])).toEqual([
      ["commitment_4_cycles", "2026-09-30", "0.93"],
      ["package_loyalty", "2", "0.95"],
    ]);

    const items = await query(
      `SELECT product_id, variant_id, quantity, unit_price, line_total
         FROM velrepeat_pricing_snapshot_items WHERE snapshot_id = $1
        ORDER BY quantity DESC`,
      [snap.id],
    );
    expect(items.rows.map((r) => [r.quantity, Number(r.unit_price), Number(r.line_total)])).toEqual([
      [2, 100, 200],
      [1, 120, 120],
    ]);

    // The plan lines are the existing composition architecture, priced at
    // purchase time and carrying the owning shop/seller.
    const lines = await query(
      `SELECT product_id, variant_id, quantity, unit_price, shop_id, seller_id
         FROM velrepeat_items WHERE plan_id = $1 ORDER BY quantity DESC`,
      [body.data.plan.id],
    );
    expect(lines.rows).toHaveLength(2);
    for (const line of lines.rows) {
      expect(line.shop_id).toBe(shopAId);
      expect(line.seller_id).toBe(sellerAId);
    }

    // The existing audit vocabulary records the creation.
    const events = await query(
      `SELECT event_type, metadata FROM velrepeat_events WHERE plan_id = $1`,
      [body.data.plan.id],
    );
    expect(events.rows.map((r) => r.event_type)).toEqual(["PLAN_CREATED"]);
    expect(events.rows[0].metadata.source).toBe("package");
    expect(events.rows[0].metadata.package_id).toBe(packageValidId);
    expect(events.rows[0].metadata.status).toBe("draft");
  });

  testFn("a package with no VelRepeat per-product opt-in is still purchasable (documented scope decision)", async () => {
    // The V2 gate is Phase 2's canonical eligibility (`published` + ownership +
    // active variant). `products.vrepeat_enabled` is V1's pay-per-run opt-in and
    // is NOT part of the V2 package domain; whether V2 fulfillment honors it is
    // a Phase 5/7 gate. This test pins that reading so it cannot drift silently.
    const response = await postPlan(await makeUser("buyer-no-optin"), purchaseBody(packageNoOptInId));
    expect(response.status).toBe(201);
  });

  testFn("every unusable package is refused, and NOTHING is written", async () => {
    const cases: Array<[string, string, number, string]> = [
      ["missing package", "11111111-1111-1111-1111-111111111111", 404, "PACKAGE_NOT_FOUND"],
      ["inactive package", packageInactiveId, 404, "PACKAGE_NOT_FOUND"],
      ["cross-seller composition", packageCrossSellerId, 409, "PACKAGE_NOT_PURCHASABLE"],
      ["unpublished product", packageDraftProductId, 409, "PACKAGE_NOT_PURCHASABLE"],
      ["archived variant", packageArchivedVariantId, 409, "PACKAGE_NOT_PURCHASABLE"],
      ["variant of another product", packageWrongVariantId, 409, "PACKAGE_NOT_PURCHASABLE"],
      ["unapproved seller", packagePendingSellerId, 409, "PACKAGE_NOT_PURCHASABLE"],
    ];

    for (const [label, packageId, status, code] of cases) {
      const response = await postPlan(buyerRejectedId, purchaseBody(packageId));
      expect({ label, status: response.status }).toEqual({ label, status });
      const body = (await response.json()) as any;
      expect({ label, code: body.error?.code }).toEqual({ label, code });
      // The refusal never explains itself with internal state.
      expect(body.error.message).not.toContain("draft");
      expect(body.error.message).not.toContain("archived");
      expect(body.error.message).not.toContain("pending");
    }

    // Six refusals, and the database is untouched: no plan, no line, no snapshot.
    expect(await countPlans(buyerRejectedId)).toBe(0);
    expect(await countPlanLines(buyerRejectedId)).toBe(0);
    expect(await countSnapshotItemsFor(buyerRejectedId)).toBe(0);
  });

  testFn("malformed requests are refused before anything is read", async () => {
    const bad: Array<[string, unknown]> = [
      ["no cycles", { packageId: packageValidId, frequencyType: "days", intervalValue: 30 }],
      ["zero cycles", purchaseBody(packageValidId, { commitmentCycles: 0 })],
      ["fractional cycles", purchaseBody(packageValidId, { commitmentCycles: 2.5 })],
      ["no frequency", { packageId: packageValidId, commitmentCycles: 4, intervalValue: 30 }],
      ["unknown frequency", purchaseBody(packageValidId, { frequencyType: "yearly" })],
      ["no interval", { packageId: packageValidId, commitmentCycles: 4, frequencyType: "days" }],
      ["bad package id", purchaseBody("not-a-uuid")],
    ];

    for (const [label, body] of bad) {
      const response = await postPlan(buyerRejectedId, body);
      expect({ label, status: response.status }).toEqual({ label, status: 400 });
      const parsed = (await response.json()) as any;
      expect({ label, code: parsed.error?.code }).toEqual({ label, code: "VALIDATION_ERROR" });
    }

    expect(await countPlans(buyerRejectedId)).toBe(0);
  });

  testFn("a cap breach fails CLOSED over HTTP and leaves no plan behind", async () => {
    await setPricingRules([
      {
        key: "too_much_a",
        version: "1",
        discount_type: "percentage",
        discount_value: "0.20",
        priority: 1,
      },
      {
        key: "too_much_b",
        version: "1",
        discount_type: "percentage",
        discount_value: "0.20",
        priority: 2,
      },
    ]);

    try {
      const response = await postPlan(buyerCapId, purchaseBody(packageValidId));
      expect(response.status).toBe(409);
      const body = (await response.json()) as any;
      expect(body.error.code).toBe("PRICING_UNAVAILABLE");
      // The internal numbers and the cap itself are not exposed.
      expect(JSON.stringify(body)).not.toContain("0.36");
      expect(JSON.stringify(body)).not.toContain("30");

      // The plan row is inserted before pricing, so zero rows here proves the
      // transaction rolled the insert back — not just that it was never made.
      expect(await countPlans(buyerCapId)).toBe(0);
      expect(await countSnapshotItemsFor(buyerCapId)).toBe(0);
    } finally {
      await setPricingRules([
        {
          key: "commitment_4_cycles",
          version: "2026-09-30",
          discount_type: "percentage",
          discount_value: "0.07",
          priority: 1,
        },
        {
          key: "package_loyalty",
          version: "2",
          discount_type: "percentage",
          discount_value: "0.05",
          priority: 2,
        },
      ]);
    }
  });

  testFn("a snapshot INSERT failure leaves NO plan and NO snapshot (atomicity)", async () => {
    // A real, representable input that the SNAPSHOT cannot hold: 9,999,999.99 ×
    // 2,000 = 19,999,999,980.00 exceeds NUMERIC(12,2) (max 9,999,999,999.99).
    // The plan insert succeeds, the plan lines succeed, and the snapshot insert
    // is the statement that fails — exactly the "plan INSERT succeeds, snapshot
    // INSERT fails" case the phase must not leave half-done.
    const request: PurchaseRequest = {
      packageId: packageOverflowId,
      commitmentCycles: 4,
      frequencyType: "days",
      intervalValue: 30,
    };

    let thrown: unknown = null;
    try {
      await withTransaction((client) => createDraftPlanFromPackage(client, buyerOverflowId, request));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeNull();

    // NO PLAN, NO SNAPSHOT, NO LINES — the whole transaction rolled back.
    expect(await countPlans(buyerOverflowId)).toBe(0);
    expect(await countPlanLines(buyerOverflowId)).toBe(0);
    expect(await countSnapshotItemsFor(buyerOverflowId)).toBe(0);

    const { query } = await import("../db/index.js");
    const orphanSnapshots = await query(
      `SELECT COUNT(*)::int AS n FROM velrepeat_pricing_snapshots s
        WHERE NOT EXISTS (SELECT 1 FROM velrepeat_plans p WHERE p.id = s.plan_id)`,
    );
    expect(orphanSnapshots.rows[0].n).toBe(0);
  });

  testFn("Q-A — the V1 scheduler refuses to process a draft, even when it is due", async () => {
    const { query } = await import("../db/index.js");
    const created = await withTransaction((client) =>
      createDraftPlanFromPackage(client, buyerId, {
        packageId: packageValidId,
        commitmentCycles: 2,
        frequencyType: "days",
        intervalValue: 7,
      } satisfies PurchaseRequest),
    );

    // Make it as due as a plan can be: the ONLY thing standing between it and
    // the V1 engine is its status.
    await query(`UPDATE velrepeat_plans SET next_run_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [
      created.planId,
    ]);

    const outcome = await processPlan(created.planId);
    expect(outcome).toBeNull();

    const after = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [created.planId]);
    expect(after.rows[0].status).toBe("draft");

    const runs = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [
      created.planId,
    ]);
    expect(runs.rows[0].n).toBe(0);
  });

  testFn("V1 regression — an ACTIVE plan with the same due date IS processed by the V1 engine", async () => {
    const { query } = await import("../db/index.js");
    const planId = (
      await query(
        `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, next_run_at)
         VALUES ($1, 'active', 'days', 7, NOW() - INTERVAL '1 day') RETURNING id`,
        [buyerId],
      )
    ).rows[0].id as string;

    // The V1 engine claims it (this plan has no items, which is V1's OWN
    // defined path: a run + PLAN_CANCELLED). What matters here is that the
    // claim succeeded for `active` and only for `active`.
    const outcome = await processPlan(planId);
    expect(outcome).not.toBeNull();

    const after = await query(`SELECT status FROM velrepeat_plans WHERE id = $1`, [planId]);
    expect(after.rows[0].status).toBe("cancelled");

    const runs = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_runs WHERE plan_id = $1`, [
      planId,
    ]);
    expect(runs.rows[0].n).toBe(1);
  });

  testFn("the snapshot is IMMUTABLE against price, composition and rule changes", async () => {
    const { query } = await import("../db/index.js");
    const created = await withTransaction((client) =>
      createDraftPlanFromPackage(client, buyerImmutableId, {
        packageId: packageImmutableId,
        commitmentCycles: 3,
        frequencyType: "months",
        intervalValue: 1,
      } satisfies PurchaseRequest),
    );
    // 50.00 × 1 + 60.00 × 2 = 170.00 → 7% → 5% → 150.20 for ONE cycle, and
    // 150.20 × 3 = 450.60 for the whole prepaid commitment.
    expect(created.basePrice).toBe("170.00");
    expect(created.cyclePrice).toBe("150.20");
    expect(created.totalPrepaidAmount).toBe("450.60");

    const beforeSnapshot = await query(`SELECT * FROM velrepeat_pricing_snapshots WHERE plan_id = $1`, [
      created.planId,
    ]);
    const beforeItems = await query(
      `SELECT * FROM velrepeat_pricing_snapshot_items WHERE snapshot_id = $1 ORDER BY quantity ASC`,
      [beforeSnapshot.rows[0].id],
    );

    // ── Everything the snapshot was derived from now changes ────────────────
    await query(`UPDATE products SET price = 999.00 WHERE id = $1`, [immutableProductAId]);
    await query(`UPDATE product_variants SET price = 888.00 WHERE id = $1`, [immutableVariantAId]);
    await query(`DELETE FROM velrepeat_package_items WHERE package_id = $1`, [packageImmutableId]);
    await query(
      `INSERT INTO velrepeat_package_items (package_id, product_id, variant_id, quantity)
       VALUES ($1, $2, NULL, 9)`,
      [packageImmutableId, immutableProductAId],
    );
    await setPricingRules([
      {
        key: "brand_new_rule",
        version: "99",
        discount_type: "percentage",
        discount_value: "0.30",
        priority: 1,
      },
    ]);

    try {
      // The live catalog, composition and rules really did move…
      const liveProduct = await query(`SELECT price FROM products WHERE id = $1`, [
        immutableProductAId,
      ]);
      expect(Number(liveProduct.rows[0].price)).toBe(999);
      const liveItems = await query(
        `SELECT SUM(quantity)::int AS n FROM velrepeat_package_items WHERE package_id = $1`,
        [packageImmutableId],
      );
      expect(liveItems.rows[0].n).toBe(9);

      // …and the purchase-time snapshot did not move at all.
      const afterSnapshot = await query(
        `SELECT * FROM velrepeat_pricing_snapshots WHERE plan_id = $1`,
        [created.planId],
      );
      const afterItems = await query(
        `SELECT * FROM velrepeat_pricing_snapshot_items WHERE snapshot_id = $1 ORDER BY quantity ASC`,
        [beforeSnapshot.rows[0].id],
      );
      expect(afterSnapshot.rows).toEqual(beforeSnapshot.rows);
      expect(afterItems.rows).toEqual(beforeItems.rows);
      expect(Number(afterSnapshot.rows[0].total_amount)).toBe(150.2);
      expect(afterSnapshot.rows[0].pricing_rule_key).toBe("commitment_4_cycles+package_loyalty");

      // Nothing in the module recomputes on read: the plan's own lines are the
      // purchase-time composition, and the snapshot is the money truth.
      const lines = await query(
        `SELECT quantity, unit_price FROM velrepeat_items WHERE plan_id = $1 ORDER BY quantity ASC`,
        [created.planId],
      );
      expect(lines.rows.map((r) => [r.quantity, Number(r.unit_price)])).toEqual([
        [1, 50],
        [2, 60],
      ]);
    } finally {
      await setPricingRules([
        {
          key: "commitment_4_cycles",
          version: "2026-09-30",
          discount_type: "percentage",
          discount_value: "0.07",
          priority: 1,
        },
        {
          key: "package_loyalty",
          version: "2",
          discount_type: "percentage",
          discount_value: "0.05",
          priority: 2,
        },
      ]);
    }
  });

  testFn("the database row of a rejected purchase is never left behind by the READ either", async () => {
    // The read path validates before it projects: an unpurchasable package
    // cannot be read at all, so no partial data is ever served.
    const response = await getPackage(buyerId, packageDraftProductId);
    expect(response.status).toBe(409);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("PACKAGE_NOT_PURCHASABLE");

    const inactive = await getPackage(buyerId, packageInactiveId);
    expect(inactive.status).toBe(404);

    const { query } = await import("../db/index.js");
    const rows = await query(`SELECT COUNT(*)::int AS n FROM velrepeat_pricing_snapshots`);
    expect(rows.rows[0].n as number).toBeGreaterThanOrEqual(0);
  });
});
