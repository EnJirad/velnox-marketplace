/**
 * VelRepeat V2 — pricing engine (owner decisions G1, G1.1, G2, E).
 * ═══════════════════════════════════════════════════════════════════════════
 * Pure unit tests: no database, so these run in every environment.
 *
 * What is pinned here:
 *   G1    — rules combine SEQUENTIALLY. 1,000 with 7% then 5% is 883.50, and
 *           explicitly NOT the 880.00 an additive 12% would give.
 *   G1.1  — the total effective discount may never exceed 30%, and the engine
 *           enforces that by REFUSING rather than by trimming, scaling or
 *           silently clamping (see the header of the engine).
 *   G2    — full precision throughout, one rounding at the end.
 *   E     — the snapshot records the base, the ordered applied rules, the
 *           effective discount and the final price.
 */
import { describe, expect, test } from "bun:test";

import { compare, isNegative, multiply, parseDecimal, toExactDecimalString } from "../lib/money.js";
import {
  InvalidPricingInputError,
  MAX_EFFECTIVE_DISCOUNT,
  PricingCapExceededError,
  PricingConfigurationError,
  computeCommitmentPricing,
  computeCommitmentPricingWithLines,
  orderPricingRules,
  parsePricingRuleSet,
  PRICING_RULES_SETTING_KEY,
} from "../lib/velrepeat-pricing.js";

/** Build a rule set from `[key, discount, priority]` triples. */
function rules(...spec: [string, string, number][]) {
  return parsePricingRuleSet(
    spec.map(([key, discount, priority]) => ({
      key,
      version: "1",
      discount_type: "percentage",
      discount_value: discount,
      priority,
    })),
  );
}

const price = (base: string, ...spec: [string, string, number][]) =>
  computeCommitmentPricing({ basePrice: parseDecimal(base), rules: rules(...spec) });

// ═══════════════════════════════════════════════════════════════════════════
// G1 — sequential / multiplicative combination
// ═══════════════════════════════════════════════════════════════════════════

describe("G1 — pricing rules combine sequentially, not additively", () => {
  test("the owner's worked example: 1,000 → 7% → 930 → 5% → 883.50", () => {
    const result = price("1000", ["tier", "0.07", 10], ["quantity", "0.05", 20]);
    expect(result.finalPriceString).toBe("883.50");
  });

  test("sequential is NOT additive — 7% + 5% is 11.65%, not 12%", () => {
    expect(price("1000", ["a", "0.07", 10], ["b", "0.05", 20]).finalPriceString).toBe("883.50");
    expect(price("1000", ["a", "0.12", 10]).finalPriceString).toBe("880.00");
    expect(price("1000", ["a", "0.07", 10], ["b", "0.05", 20]).finalPriceString).not.toBe(
      price("1000", ["a", "0.12", 10]).finalPriceString,
    );
  });

  test("each rule discounts the price the previous rule produced", () => {
    expect(price("1000", ["only", "0.07", 10]).finalPriceString).toBe("930.00");
    expect(price("1000", ["a", "0.10", 10], ["b", "0.10", 20], ["c", "0.10", 30]).finalPriceString).toBe(
      "729.00",
    );
  });

  test("no rule means the base is the price", () => {
    expect(price("1000").finalPriceString).toBe("1000.00");
    expect(price("1000").appliedRules).toHaveLength(0);
  });

  test("a zero discount rule is a no-op, not an error", () => {
    expect(price("1000", ["noop", "0", 10], ["real", "0.10", 20]).finalPriceString).toBe("900.00");
  });
});

describe("G1 — rule order comes from persisted priority, deterministically", () => {
  test("lower priority number is applied first", () => {
    expect(price("1000", ["first", "0.10", 1], ["second", "0.10", 2]).appliedRules.map((r) => r.key)).toEqual([
      "first",
      "second",
    ]);
  });

  test("a tie on priority is broken by key, so the order is TOTAL", () => {
    const ordered = orderPricingRules(rules(["zeta", "0.10", 5], ["alpha", "0.10", 5], ["mid", "0.10", 5]));
    expect(ordered.map((r) => r.key)).toEqual(["alpha", "mid", "zeta"]);
  });

  test("input order cannot change the result", () => {
    const a = price("1000", ["a", "0.07", 10], ["b", "0.05", 20]).finalPriceString;
    const b = price("1000", ["b", "0.05", 20], ["a", "0.07", 10]).finalPriceString;
    expect(a).toBe(b);
    expect(a).toBe("883.50");
  });

  test("the caller-supplied array is never mutated", () => {
    const original = rules(["b", "0.05", 20], ["a", "0.07", 10]);
    const snapshot = original.map((r) => r.key);
    orderPricingRules(original);
    expect(original.map((r) => r.key)).toEqual(snapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G1.1 — the 30% cap, enforced by refusal
// ═══════════════════════════════════════════════════════════════════════════

describe("G1.1 — the 30% effective discount cap", () => {
  test("exactly 30% is allowed — the boundary is inclusive", () => {
    expect(price("1000", ["max", "0.30", 10]).finalPriceString).toBe("700.00");
  });

  test("just under the cap is allowed", () => {
    expect(price("1000", ["max", "0.299", 10]).finalPriceString).toBe("701.00");
  });

  test("just over the cap is refused", () => {
    expect(() => price("1000", ["over", "0.3001", 10])).toThrow(PricingCapExceededError);
  });

  test("sequential rules that MATERIALLY exceed the cap are refused", () => {
    // 20% then 20% = 36% effective. The owner's worked example.
    expect(() => price("1000", ["a", "0.20", 10], ["b", "0.20", 20])).toThrow(PricingCapExceededError);
  });

  test("the refusal reports the numbers, and never trims or scales a rule", () => {
    try {
      price("1000", ["a", "0.20", 10], ["b", "0.20", 20]);
      throw new Error("should not reach here");
    } catch (error) {
      expect(error).toBeInstanceOf(PricingCapExceededError);
      const refused = error as PricingCapExceededError;
      expect(refused.basePrice).toBe("1000.00");
      expect(refused.wouldBePrice).toBe("640.00");
      expect(refused.effectiveDiscount).toBe("0.36");
      // The message must say the resolution is undecided, not imply a fix.
      expect(refused.message).toContain("owner decision");
    }
  });

  test("a combination that lands exactly on 30% is allowed, not refused", () => {
    expect(price("1000", ["a", "0.20", 10], ["b", "0.125", 20]).finalPriceString).toBe("700.00");
  });

  test("the cap is one constant and equals 0.30 exactly", () => {
    expect(toExactDecimalString(MAX_EFFECTIVE_DISCOUNT)).toBe("0.3");
  });

  test("the cap is relative to the base, not an absolute amount", () => {
    // A 30% rule floors at 70% of whatever the base happens to be.
    expect(price("1000", ["max", "0.30", 10]).finalPriceString).toBe("700.00");
    expect(price("50", ["max", "0.30", 10]).finalPriceString).toBe("35.00");
    expect(price("1234.56", ["max", "0.30", 10]).finalPriceString).toBe("864.19");

    // 20% then 20% is 36% — over the cap at EVERY base, because the cap is a
    // ratio rather than a fixed amount of money.
    expect(() => price("50", ["a", "0.20", 10], ["b", "0.20", 20])).toThrow(PricingCapExceededError);
    expect(() => price("100000", ["a", "0.20", 10], ["b", "0.20", 20])).toThrow(PricingCapExceededError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G2 — precision and the single rounding
// ═══════════════════════════════════════════════════════════════════════════

describe("G2 — full precision, exactly one rounding at the end", () => {
  test("an intermediate with six decimals is carried exactly", () => {
    // 1000.01 × 0.8766 = 876.608766, then × 0.95.
    const result = price("1000.01", ["a", "0.1234", 10], ["b", "0.05", 20]);
    // Rounding after rule 1 would have produced 876.61 × 0.95 = 832.7795.
    expect(toExactDecimalString(result.finalPrice)).toBe("832.7783277");
    expect(result.finalPriceString).toBe("832.78");
  });

  test("the charge always has exactly two decimals", () => {
    for (const base of ["0", "1", "1.5", "1000", "999.99", "12345.678"]) {
      expect(price(base, ["a", "0.07", 10]).finalPriceString).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  test("a zero base prices to zero rather than dividing by zero", () => {
    const result = price("0", ["a", "0.20", 10]);
    expect(result.finalPriceString).toBe("0.00");
    expect(result.effectiveDiscountPercentString).toBe("0.00");
  });

  test("a negative base is refused", () => {
    expect(() => price("-1", ["a", "0.10", 10])).toThrow(InvalidPricingInputError);
  });

  test("currency is THB only", () => {
    expect(() =>
      computeCommitmentPricing({ basePrice: parseDecimal("1000"), rules: [], currency: "USD" }),
    ).toThrow(InvalidPricingInputError);
  });

  test("the reported discount amount is base minus final", () => {
    const result = price("1000", ["a", "0.07", 10], ["b", "0.05", 20]);
    expect(result.basePriceString).toBe("1000.00");
    expect(result.finalPriceString).toBe("883.50");
    expect(result.discountAmountString).toBe("116.50");
    expect(result.effectiveDiscountPercentString).toBe("11.65");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The persisted rule set is validated, and fails closed
// ═══════════════════════════════════════════════════════════════════════════

describe("pricing configuration — malformed rule sets fail closed", () => {
  test("an absent or empty setting means no discounts", () => {
    expect(parsePricingRuleSet(null)).toEqual([]);
    expect(parsePricingRuleSet("")).toEqual([]);
    expect(parsePricingRuleSet("[]")).toEqual([]);
  });

  test("invalid JSON is refused rather than partially applied", () => {
    expect(() => parsePricingRuleSet("{not json")).toThrow(PricingConfigurationError);
    expect(() => parsePricingRuleSet('{"rule": true}')).toThrow(PricingConfigurationError);
  });

  test("a missing or empty key is refused", () => {
    expect(() => parsePricingRuleSet([{ key: "", version: "1", discount_type: "percentage", discount_value: "0.1", priority: 1 }])).toThrow(
      PricingConfigurationError,
    );
    expect(() => parsePricingRuleSet([{ version: "1", discount_type: "percentage", discount_value: "0.1", priority: 1 }])).toThrow(
      PricingConfigurationError,
    );
  });

  test("a non-integer or missing priority is refused", () => {
    for (const priority of [undefined, 1.5, "1", null]) {
      expect(() =>
        parsePricingRuleSet([
          { key: "a", version: "1", discount_type: "percentage", discount_value: "0.1", priority },
        ]),
      ).toThrow(PricingConfigurationError);
    }
  });

  test("ABSOLUTE discount rules are refused — mixing them is an open decision", () => {
    expect(() =>
      parsePricingRuleSet([
        { key: "a", version: "1", discount_type: "fixed", discount_value: "50", priority: 1 },
      ]),
    ).toThrow(PricingConfigurationError);
  });

  test("a discount outside [0, 1) is refused", () => {
    for (const value of ["-0.01", "1", "1.5", "2"]) {
      expect(() =>
        parsePricingRuleSet([
          { key: "a", version: "1", discount_type: "percentage", discount_value: value, priority: 1 },
        ]),
      ).toThrow(PricingConfigurationError);
    }
  });

  test("a non-decimal discount value is refused — no float may enter", () => {
    expect(() =>
      parsePricingRuleSet([
        { key: "a", version: "1", discount_type: "percentage", discount_value: "NaN", priority: 1 },
      ]),
    ).toThrow(PricingConfigurationError);
  });

  test("version defaults to 1 when omitted", () => {
    const parsed = parsePricingRuleSet([
      { key: "a", discount_type: "percentage", discount_value: "0.1", priority: 1 },
    ]);
    expect(parsed[0].version).toBe("1");
  });

  test("the setting key is the repository's existing platform configuration table", () => {
    expect(PRICING_RULES_SETTING_KEY).toBe("velrepeat_pricing_rules");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E — the purchase-time snapshot
// ═══════════════════════════════════════════════════════════════════════════

describe("decision E — the pricing snapshot", () => {
  const lines = [
    { productId: "p1", variantId: null, quantity: 2, unitPrice: parseDecimal("300.00") },
    { productId: "p2", variantId: "v1", quantity: 1, unitPrice: parseDecimal("400.00") },
  ];

  test("base price is the sum of line totals, computed exactly", () => {
    const snapshot = computeCommitmentPricingWithLines({
      planId: "plan",
      commitmentCycles: 4,
      sellerId: "seller",
      packageId: "package",
      lines,
      rules: rules(["tier4", "0.07", 10]),
    });
    expect(snapshot.basePriceString).toBe("1000.00");
    expect(snapshot.finalPriceString).toBe("930.00");
  });

  test("the snapshot keeps the composition it was priced from", () => {
    const snapshot = computeCommitmentPricingWithLines({
      planId: "plan",
      commitmentCycles: 4,
      sellerId: "seller",
      packageId: "package",
      lines,
      rules: rules(["tier4", "0.07", 10]),
    });
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines.map((l) => l.productId)).toEqual(["p1", "p2"]);
    expect(snapshot.lines.map((l) => l.quantity)).toEqual([2, 1]);
  });

  test("every applied rule is recorded in order, with its exact factor", () => {
    const snapshot = computeCommitmentPricingWithLines({
      planId: "plan",
      commitmentCycles: 4,
      sellerId: "seller",
      packageId: null,
      lines,
      rules: rules(["a", "0.07", 10], ["b", "0.05", 20]),
    });
    expect(snapshot.appliedRules).toEqual([
      { key: "a", version: "1", discountType: "percentage", discountValue: "0.07", priority: 10, factor: "0.93" },
      { key: "b", version: "1", discountType: "percentage", discountValue: "0.05", priority: 20, factor: "0.95" },
    ]);
  });

  test("an empty or invalid composition is refused", () => {
    const base = { planId: "p", commitmentCycles: 4, sellerId: "s", packageId: null, rules: [] };
    expect(() => computeCommitmentPricingWithLines({ ...base, lines: [] })).toThrow(
      InvalidPricingInputError,
    );
    expect(() =>
      computeCommitmentPricingWithLines({
        ...base,
        commitmentCycles: 0,
        lines,
      }),
    ).toThrow(InvalidPricingInputError);
    expect(() =>
      computeCommitmentPricingWithLines({
        ...base,
        lines: [{ productId: "p1", variantId: null, quantity: 0, unitPrice: parseDecimal("1") }],
      }),
    ).toThrow(InvalidPricingInputError);
    expect(() =>
      computeCommitmentPricingWithLines({
        ...base,
        lines: [{ productId: "p1", variantId: null, quantity: 1, unitPrice: parseDecimal("-1") }],
      }),
    ).toThrow(InvalidPricingInputError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Invariant tests — the properties that must hold for EVERY valid input
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A seeded LCG — deliberately NOT `Math.random()`, so a failure is reproducible
 * from the seed alone.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("invariants — hold for every generated input", () => {
  const random = makeRandom(20260930);
  const SAMPLES = 400;

  for (let sample = 0; sample < SAMPLES; sample++) {
    // A random commitment: a base price and 0–4 percentage rules.
    const baseCents = 1 + Math.floor(random() * 500_000);
    const ruleCount = Math.floor(random() * 5);
    const spec: [string, string, number][] = [];
    for (let r = 0; r < ruleCount; r++) {
      // Discounts in [0, 30%], written to 4 decimals so the cap boundary is
      // genuinely reachable rather than always missed by a wide margin.
      const permille = Math.floor(random() * 3000);
      spec.push([
        `rule_${r}`,
        (permille / 10000).toFixed(4),
        Math.floor(random() * 10),
      ]);
    }
    const base = (baseCents / 100).toFixed(2);

    test(`sample ${sample}: base ${base} with ${ruleCount} rule(s) is deterministic and within the cap`, () => {
      const input = { basePrice: parseDecimal(base), rules: rules(...spec) };

      // The engine either prices, or refuses. Refusing is a legitimate outcome
      // — it is how G1.1 is enforced — so it is branched on explicitly rather
      // than caught around the assertions (which would swallow a failed expect).
      let priced: ReturnType<typeof computeCommitmentPricing> | null = null;
      let refusal: unknown = null;
      try {
        priced = computeCommitmentPricing(input);
      } catch (error) {
        refusal = error;
      }

      if (refusal !== null) {
        expect(refusal).toBeInstanceOf(PricingCapExceededError);
        const wouldBe = parseDecimal((refusal as PricingCapExceededError).wouldBePrice);
        expect(compare(wouldBe, multiply(parseDecimal(base), parseDecimal("0.70")))).toBeLessThan(0);
        return;
      }

      const first = priced!;

      // Determinism: the same inputs always give the same answer.
      const second = computeCommitmentPricing(input);
      expect(second.finalPriceString).toBe(first.finalPriceString);
      expect(second.effectiveDiscount).toEqual(first.effectiveDiscount);

      // Determinism under input reordering.
      const shuffled = computeCommitmentPricing({
        basePrice: parseDecimal(base),
        rules: rules(...[...spec].reverse()),
      });
      expect(shuffled.finalPriceString).toBe(first.finalPriceString);

      // INVARIANT 1 — 0 <= effective discount <= 0.30
      expect(isNegative(first.effectiveDiscount)).toBe(false);
      expect(compare(first.effectiveDiscount, MAX_EFFECTIVE_DISCOUNT)).toBeLessThanOrEqual(0);

      // INVARIANT 2 — the price is never below 70% of the base.
      expect(compare(first.finalPrice, multiply(parseDecimal(base), parseDecimal("0.70")))).toBeGreaterThanOrEqual(0);

      // INVARIANT 3 — always two decimals, never negative.
      expect(first.finalPriceString).toMatch(/^\d+\.\d{2}$/);

      // INVARIANT 4 — no rule is ever silently dropped: the priced result
      // accounts for every input rule, in ascending priority order.
      expect(first.appliedRules).toHaveLength(spec.length);
      expect(first.appliedRules.map((r) => r.key).sort()).toEqual(spec.map(([key]) => key).sort());
      for (let i = 1; i < first.appliedRules.length; i++) {
        expect(first.appliedRules[i].priority).toBeGreaterThanOrEqual(first.appliedRules[i - 1].priority);
      }
    });
  }

  test("the ONLY permitted failure across those samples is the cap, and it refuses a genuinely sub-70% price", () => {
    // Re-runs the same generator, this time checking the refusal branch.
    const random2 = makeRandom(20260930);
    let refusals = 0;
    for (let sample = 0; sample < SAMPLES; sample++) {
      const baseCents = 1 + Math.floor(random2() * 500_000);
      const ruleCount = Math.floor(random2() * 5);
      const spec: [string, string, number][] = [];
      for (let r = 0; r < ruleCount; r++) {
        spec.push([
          `rule_${r}`,
          (Math.floor(random2() * 3000) / 10000).toFixed(4),
          Math.floor(random2() * 10),
        ]);
      }
      const base = (baseCents / 100).toFixed(2);
      const baseExact = parseDecimal(base);

      let refusal: unknown = null;
      try {
        computeCommitmentPricing({ basePrice: baseExact, rules: rules(...spec) });
      } catch (error) {
        refusal = error;
      }

      if (refusal === null) continue;
      refusals++;
      expect(refusal).toBeInstanceOf(PricingCapExceededError);
      const wouldBe = parseDecimal((refusal as PricingCapExceededError).wouldBePrice);
      expect(compare(wouldBe, multiply(baseExact, parseDecimal("0.70")))).toBeLessThan(0);
    }

    // The generator must actually exercise the refusal path, or this suite
    // would silently stop testing the cap.
    expect(refusals).toBeGreaterThan(0);
  });
});
