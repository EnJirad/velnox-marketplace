/**
 * VelRepeat V2 — pricing engine (owner decisions G1, G1.1, G2, E).
 * ═══════════════════════════════════════════════════════════════════════════
 * Implements, exactly and only, the locked owner decisions:
 *
 *   G1    B — rules combine SEQUENTIALLY / MULTIPLICATIVELY. Each rule is
 *               applied to the price produced by the previous rule. A 7% and
 *               a 5% rule on a 1,000 base give 1,000 → 930 → 883.50, never
 *               880 (which is what an additive 12% would produce).
 *   G1.1      — the TOTAL effective discount may never exceed 30%. Effective
 *               discount is `1 - (final_price / base_price)`, so the customer
 *               never receives a final price below 70% of the base.
 *   G2        — full precision through the whole pipeline; EXACTLY ONE round to
 *               2 decimal places, at the final price. No intermediate rounding.
 *   E         — the purchase-time snapshot records what was applied.
 *
 * Money is exact throughout via `backend/lib/money.ts` (bigint rationals). No
 * step here creates an IEEE-754 value.
 *
 * ── WHY THE CAP FAILS CLOSED INSTEAD OF CLAMPING ────────────────────────────
 * When the sequential rules would exceed 30%, this engine THROWS. It does not
 * trim the last rule, does not scale the rules down, does not keep only the
 * highest-priority rule, and does not silently clamp the result to the floor.
 *
 * Each of those would be a business policy the owner has not decided: they
 * differ in what the customer is charged AND in what the snapshot records as
 * applied. The owner's instruction for exactly this situation is to "create
 * validation/error that fails closed", so the invariant is enforced as a hard
 * refusal and the resolution is recorded as a blocker. See
 * `.ai/tasks/audits/velrepeat-v2-g1-g3-implementation-2026-09-30.md`.
 *
 * ── WHAT IS DELIBERATELY NOT DECIDED HERE ──────────────────────────────────
 *   • Fixed-amount (absolute) discount rules. Only percentage rules are
 *     accepted. Mixing an absolute rule into a multiplicative chain makes the
 *     ordering of the chain change the result, and the 30% cap is defined
 *     relative to the base price — so absolute rules are rejected rather than
 *     guessed at. Fixed-amount rules are an open owner decision.
 *   • WHICH rules apply to which package. This module receives the applicable
 *     rule set as an argument and never decides scope itself; see
 *     `loadPricingRuleSet()`.
 *   • Refunds, skip/pause/out-of-stock money, and how a prepaid commitment is
 *     drawn down across its cycles. None of those are decided; see the G1/G2
 *     audit.
 *
 * ── WHAT IS DECIDED HERE: CYCLE PRICE vs TOTAL PREPAID ──────────────────────
 * A V2 plan is PREPAID. The rule chain above produces the price of ONE
 * delivery cycle; the customer owes that price for EVERY cycle they committed
 * to. So this module produces and persists BOTH, and never conflates them:
 *
 *   cycle_price   = the discounted price of one cycle
 *   total_amount  = cycle_price × commitment_cycles  ← what is charged
 *
 * See `computeTotalPrepaid()`. The cycle price is kept UNROUNDED through the
 * chain and the total is rounded EXACTLY ONCE at the end (G2).
 */
import type { PoolClient } from "pg";

import {
  ONE,
  ZERO,
  type Rational,
  add,
  compare,
  divide,
  formatScaled,
  isNegative,
  makeRational,
  multiply,
  parseDecimal,
  parseDecimalInput,
  roundHalfUp,
  subtract,
  toExactDecimalString,
  toMoneyString,
} from "./money.js";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The one business constant this module owns
// ═══════════════════════════════════════════════════════════════════════════

/**
 * G1.1 — maximum total effective discount, as an exact rational.
 *
 * Stated as a single named constant rather than a ladder of tiers because the
 * owner fixed the CAP, not any particular discount: no 3% / 7% / 10% / 15% style
 * table is encoded anywhere in this repository's V2 path. Discount percentages
 * arrive as data (see `loadPricingRuleSet`), never as source constants.
 */
export const MAX_EFFECTIVE_DISCOUNT: Rational = parseDecimal("0.30");

/** G2 — the currency VelRepeat V2 prices in. */
export const VELREPEAT_CURRENCY = "THB";

// ═══════════════════════════════════════════════════════════════════════════
// 2. Errors — every one fails closed
// ═══════════════════════════════════════════════════════════════════════════

/** Base price / quantity / currency is not usable. */
export class InvalidPricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPricingInputError";
  }
}

/**
 * G1.1 — the applicable rules would take the effective discount above the cap.
 *
 * Raised INSTEAD of producing a price, so no caller can accidentally charge a
 * customer more than 30% off. It carries the numbers needed to diagnose, and
 * nothing that would let a caller silently "fix" it by clamping.
 */
export class PricingCapExceededError extends Error {
  readonly basePrice: string;
  readonly wouldBePrice: string;
  readonly effectiveDiscount: string;

  constructor(basePrice: string, wouldBePrice: string, effectiveDiscount: string) {
    super(
      `Effective discount ${effectiveDiscount} exceeds the maximum ${toExactDecimalString(
        MAX_EFFECTIVE_DISCOUNT,
      )}: base ${basePrice} would be priced at ${wouldBePrice}. ` +
        `No rule was trimmed, scaled or dropped — resolving this is an owner decision.`,
    );
    this.name = "PricingCapExceededError";
    this.basePrice = basePrice;
    this.wouldBePrice = wouldBePrice;
    this.effectiveDiscount = effectiveDiscount;
  }
}

/** The persisted rule set is malformed. Never partially applied. */
export class PricingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingConfigurationError";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Rules
// ═══════════════════════════════════════════════════════════════════════════

/** One platform pricing rule, after validation. */
export interface PricingRule {
  /** Stable identifier, e.g. `commitment_4_cycles`. */
  readonly key: string;
  /** Version of that rule, recorded on the snapshot. */
  readonly version: string;
  /** Only `percentage` is supported — see the header note on absolute rules. */
  readonly discountType: "percentage";
  /** The discount as an exact rational: `0.07` means 7%. */
  readonly discountValue: Rational;
  /**
   * Explicit, persisted ordering key. ASCENDING — the lowest priority number is
   * applied FIRST, so it is the base the later rules discount.
   *
   * This is the canonical ordering authority. Object key order and database row
   * order are never consulted; `orderPricingRules()` makes the order total.
   */
  readonly priority: number;
}

/** A rule as it was actually applied, kept for the snapshot audit trail. */
export interface AppliedRule {
  readonly key: string;
  readonly version: string;
  readonly discountType: "percentage";
  /** Exact, unrounded discount — e.g. "0.07". */
  readonly discountValue: string;
  readonly priority: number;
  /** Exact multiplier this rule applied to the running price — e.g. "0.93". */
  readonly factor: string;
}

/**
 * Total, deterministic ordering.
 *
 * `priority` ascending, then `key` ascending as the tie-break. The tie-break is
 * what makes the ordering TOTAL: two rules sharing a priority would otherwise
 * have an order that depends on array construction, which is exactly the
 * "don't rely on object iteration order" failure this replaces.
 */
export function orderPricingRules(rules: readonly PricingRule[]): PricingRule[] {
  return [...rules].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.version < b.version ? -1 : a.version > b.version ? 1 : 0;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. The pricing computation
// ═══════════════════════════════════════════════════════════════════════════

export interface CommitmentPricingRequest {
  /** Sum of line totals BEFORE any pricing discount. Exact, unrounded. */
  readonly basePrice: Rational;
  readonly rules: readonly PricingRule[];
  readonly currency?: string;
  /**
   * How many delivery cycles the customer committed to.
   *
   * A V2 plan is PREPAID, so this is what turns a per-cycle price into the sum
   * the customer actually owes. It defaults to 1 — the degenerate commitment in
   * which "per cycle" and "total prepaid" are the same number by definition —
   * so a caller that only wants to price one cycle keeps its old meaning and a
   * commitment is never silently priced as a single delivery.
   */
  readonly commitmentCycles?: number;
}

/**
 * THE PREPAID COMMITMENT TOTAL — the invariant this phase exists to establish.
 *
 *   total_prepaid = cycle_price × commitment_cycles
 *
 * `cyclePrice` is the EXACT, still-unrounded price of one delivery cycle (the
 * output of the G1 rule chain). It is multiplied as a bigint rational and
 * rounded EXACTLY ONCE, at the end (G2).
 *
 * Two rules this deliberately does NOT break:
 *
 *   • the cycle price is NOT rounded first. Rounding it to 2dp and then
 *     multiplying would charge a different total whenever the exact cycle price
 *     carries more than two decimals — 93.4444… × 3 is 280.33 once rounded at
 *     the end, but 93.44 × 3 = 280.32. One rounding, on the number that is
 *     actually charged, is the only self-consistent rule;
 *   • no IEEE-754 value participates. `multiply` and `roundHalfUp` are
 *     bigint-rational operations throughout (`backend/lib/money.ts`).
 *
 * @throws InvalidPricingInputError when `commitmentCycles` is not a positive integer
 */
export function computeTotalPrepaid(
  cyclePrice: Rational,
  commitmentCycles: number,
): Rational {
  if (!Number.isInteger(commitmentCycles) || commitmentCycles <= 0) {
    throw new InvalidPricingInputError("Commitment cycles must be a positive integer");
  }
  const scaled = roundHalfUp(
    multiply(cyclePrice, makeRational(BigInt(commitmentCycles), 1n)),
    2,
  );
  return makeRational(scaled, 100n);
}

export interface CommitmentPricing {
  readonly currency: string;
  /** Exact base, before discounts. */
  readonly basePrice: Rational;
  /** Exact price after the full sequential chain, still UNROUNDED. */
  readonly finalPrice: Rational;
  /**
   * The price of ONE delivery cycle, after the rule chain, at 2dp.
   * NOT what the customer pays — see `totalPrepaid`.
   */
  readonly cyclePrice: string;
  /** How many cycles this commitment covers. */
  readonly commitmentCycles: number;
  /**
   * THE amount a prepaid customer owes for the WHOLE commitment: the exact
   * cycle price × the cycle count, rounded once. This is the value the Stripe
   * charge is derived from.
   */
  readonly totalPrepaid: Rational;
  /** `totalPrepaid` at 2dp — the authoritative monetary total. */
  readonly totalPrepaidString: string;
  /** `1 - finalPrice / basePrice`, exact. Zero when the base is zero. */
  readonly effectiveDiscount: Rational;
  /** Ordered, for the snapshot's audit trail. */
  readonly appliedRules: readonly AppliedRule[];
  /** The base at 2dp. */
  readonly basePriceString: string;
  /** THE charge — the single G2 rounding, applied here and nowhere else. */
  readonly finalPriceString: string;
  /** `basePrice - finalPrice` at 2dp. */
  readonly discountAmountString: string;
  /** The effective discount as a percentage at 2dp, e.g. "11.65". */
  readonly effectiveDiscountPercentString: string;
}

/**
 * Price one prepaid commitment: base → rule 1 → rule 2 → … → final.
 *
 * The whole chain runs on exact rationals. `finalPriceString` is produced by a
 * single `toMoneyString()` at the very end, which is the one and only rounding
 * in the pipeline (G2).
 *
 * @throws InvalidPricingInputError  base price is negative or the currency is not THB
 * @throws PricingCapExceededError    the chain would discount more than 30%
 */
export function computeCommitmentPricing(request: CommitmentPricingRequest): CommitmentPricing {
  const { basePrice, rules } = request;
  const currency = request.currency ?? VELREPEAT_CURRENCY;
  const commitmentCycles = request.commitmentCycles ?? 1;

  if (isNegative(basePrice)) {
    throw new InvalidPricingInputError("Base price must not be negative");
  }
  if (currency !== VELREPEAT_CURRENCY) {
    throw new InvalidPricingInputError(
      `VelRepeat V2 prices in ${VELREPEAT_CURRENCY} only; received "${currency}"`,
    );
  }
  // Validated HERE, before any rule runs, so an impossible commitment can never
  // produce a partially priced result.
  if (!Number.isInteger(commitmentCycles) || commitmentCycles <= 0) {
    throw new InvalidPricingInputError("Commitment cycles must be a positive integer");
  }

  const ordered = orderPricingRules(rules);
  const appliedRules: AppliedRule[] = [];

  let running = basePrice;
  for (const rule of ordered) {
    // factor = 1 - discount. A discount of 1 (100%) or more would zero or
    // invert the price and is refused at parse time; re-checked here so a
    // hand-constructed rule object cannot bypass it.
    const factor = subtract(ONE, rule.discountValue);
    if (isNegative(factor)) {
      throw new PricingConfigurationError(
        `Rule "${rule.key}" has a discount of ${toExactDecimalString(
          rule.discountValue,
        )}, which would zero or invert the price`,
      );
    }
    running = multiply(running, factor);
    appliedRules.push({
      key: rule.key,
      version: rule.version,
      discountType: rule.discountType,
      discountValue: toExactDecimalString(rule.discountValue),
      priority: rule.priority,
      factor: toExactDecimalString(factor),
    });
  }

  // effective = 1 - (final / base). A zero base has no meaningful ratio; there
  // is nothing to discount, so it is zero by definition rather than a division
  // by zero.
  const effectiveDiscount = isZeroBase(basePrice) ? ZERO : subtract(ONE, divide(running, basePrice));

  // ── G1.1 — the cap, enforced as a refusal ──────────────────────────────
  if (compare(effectiveDiscount, MAX_EFFECTIVE_DISCOUNT) > 0) {
    throw new PricingCapExceededError(
      toMoneyString(basePrice),
      toMoneyString(running),
      toExactDecimalString(effectiveDiscount),
    );
  }

  const discountAmount = subtract(basePrice, running);

  // ── Cycle price vs TOTAL PREPAID — the distinction this module now owns ───
  // `running` is the price of ONE delivery cycle. Because a V2 plan is prepaid,
  // the customer owes that price for EVERY cycle they committed to.
  const cyclePrice = toMoneyString(running);
  const totalPrepaid = computeTotalPrepaid(running, commitmentCycles);

  return {
    currency,
    basePrice,
    finalPrice: running,
    cyclePrice,
    commitmentCycles,
    totalPrepaid,
    totalPrepaidString: toMoneyString(totalPrepaid),
    effectiveDiscount,
    appliedRules,
    basePriceString: toMoneyString(basePrice),
    finalPriceString: cyclePrice,
    discountAmountString: toMoneyString(discountAmount),
    effectiveDiscountPercentString: toMoneyString(multiply(effectiveDiscount, makeRational(100n, 1n))),
  };
}

function isZeroBase(base: Rational): boolean {
  return base.num === 0n;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. The canonical persisted rule set
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Where the platform's pricing rules live.
 *
 * `platform_settings` is the repository's existing canonical key/value
 * configuration table (db/schema.sql), already carrying platform-owned settings
 * such as `product_approval_mode`. H/Q11 made pricing rules "platform-controlled,
 * data-driven configuration", so they belong there — this adds NO new table and
 * creates no second configuration store.
 */
export const PRICING_RULES_SETTING_KEY = "velrepeat_pricing_rules";

interface RawPricingRule {
  key?: unknown;
  version?: unknown;
  discount_type?: unknown;
  discount_value?: unknown;
  priority?: unknown;
}

/**
 * Parse and validate the stored rule set.
 *
 * Fails closed on anything unexpected: a malformed rule set must never be
 * partially applied, because silently skipping one rule would change the price
 * a customer is charged.
 *
 * `discount_value` is accepted as a decimal STRING or a finite number (JSON has
 * no decimal type) and is immediately converted to an exact rational, so no
 * float survives into the pipeline.
 */
export function parsePricingRuleSet(raw: unknown): PricingRule[] {
  if (raw === null || raw === undefined || raw === "") return [];

  let decoded: unknown = raw;
  if (typeof raw === "string") {
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new PricingConfigurationError(
        `${PRICING_RULES_SETTING_KEY} is not valid JSON — no rule was applied`,
      );
    }
  }

  if (!Array.isArray(decoded)) {
    throw new PricingConfigurationError(`${PRICING_RULES_SETTING_KEY} must be a JSON array`);
  }

  const rules: PricingRule[] = decoded.map((entry: RawPricingRule, index: number) => {
    const at = `${PRICING_RULES_SETTING_KEY}[${index}]`;

    if (typeof entry?.key !== "string" || entry.key.trim() === "") {
      throw new PricingConfigurationError(`${at}.key must be a non-empty string`);
    }
    const version = entry.version === undefined || entry.version === null ? "1" : entry.version;
    if (typeof version !== "string" || version.trim() === "") {
      throw new PricingConfigurationError(`${at}.version must be a non-empty string`);
    }
    if (entry.discount_type !== "percentage") {
      throw new PricingConfigurationError(
        `${at}.discount_type must be "percentage" — absolute discount rules are an open owner decision`,
      );
    }
    if (typeof entry.priority !== "number" || !Number.isInteger(entry.priority)) {
      throw new PricingConfigurationError(`${at}.priority must be an integer`);
    }

    let discountValue: Rational;
    try {
      discountValue = parseDecimalInput(entry.discount_value);
    } catch {
      throw new PricingConfigurationError(
        `${at}.discount_value must be an exact decimal (e.g. "0.07")`,
      );
    }
    if (isNegative(discountValue) || compare(discountValue, ONE) >= 0) {
      throw new PricingConfigurationError(
        `${at}.discount_value must be >= 0 and < 1 (fraction of the price), got ${toExactDecimalString(
          discountValue,
        )}`,
      );
    }

    return {
      key: entry.key.trim(),
      version: version.trim(),
      discountType: "percentage" as const,
      discountValue,
      priority: entry.priority,
    };
  });

  return rules;
}

/**
 * Load the applicable rule set for a commitment.
 *
 * SCOPE IS NOT DECIDED BY THIS FUNCTION. It returns the platform rule set, which
 * is the only thing that exists today. Which rules apply to which package,
 * category or seller is an open owner decision, so nothing here filters, and a
 * future decision changes this one function rather than the engine.
 */
export async function loadPricingRuleSet(client?: PoolClient): Promise<PricingRule[]> {
  const sql = `SELECT value FROM platform_settings WHERE key = $1`;
  const result = client
    ? await client.query(sql, [PRICING_RULES_SETTING_KEY])
    : await (await import("../db/index.js")).query(sql, [PRICING_RULES_SETTING_KEY]);

  const raw = result.rows[0]?.value;
  return parsePricingRuleSet(raw ?? null);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Decision E — the purchase-time pricing snapshot
// ═══════════════════════════════════════════════════════════════════════════

export interface SnapshotLine {
  readonly productId: string;
  readonly variantId: string | null;
  readonly quantity: number;
  /** Unit price already snapshotted for this line. Exact. */
  readonly unitPrice: Rational;
}

/** What the buyer paid for, and whose goods those were. */
export interface CommitmentPricingRequestWithLines {
  readonly planId: string;
  readonly commitmentCycles: number;
  readonly currency?: string;
  readonly lines: readonly SnapshotLine[];
  readonly rules: readonly PricingRule[];
  /** Provenance, recorded in the snapshot's existing `metadata` JSONB column. */
  readonly sellerId: string;
  readonly packageId: string | null;
}

/**
 * Compute the price AND the snapshot rows for one commitment.
 *
 * The snapshot is the frozen truth for everything Phase 4/5 will later read: a
 * later change to a product price, a package composition or a pricing rule must
 * not move an already-purchased plan (decision E / PX).
 */
export function computeCommitmentPricingWithLines(
  request: CommitmentPricingRequestWithLines,
): CommitmentPricing & { readonly subtotal: Rational; readonly lines: readonly SnapshotLine[] } {
  if (request.commitmentCycles <= 0 || !Number.isInteger(request.commitmentCycles)) {
    throw new InvalidPricingInputError("Commitment cycles must be a positive integer");
  }
  if (request.lines.length === 0) {
    throw new InvalidPricingInputError("A commitment must contain at least one line");
  }

  // Base = Σ(unitPrice × quantity), exact and unrounded.
  let subtotal = ZERO;
  for (const line of request.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new InvalidPricingInputError(
        `Line ${line.productId}: quantity must be a positive integer`,
      );
    }
    if (isNegative(line.unitPrice)) {
      throw new InvalidPricingInputError(`Line ${line.productId}: unit price must not be negative`);
    }
    subtotal = add(subtotal, multiply(line.unitPrice, makeRational(BigInt(line.quantity), 1n)));
  }

  return {
    ...computeCommitmentPricing({
      basePrice: subtotal,
      rules: request.rules,
      currency: request.currency,
      commitmentCycles: request.commitmentCycles,
    }),
    subtotal,
    lines: request.lines,
  };
}

/** Stable single-column identity for a set of applied rules. */
function ruleSetIdentity(appliedRules: readonly AppliedRule[]): { key: string; version: string } {
  return {
    key: appliedRules.map((r) => r.key).join("+") || "none",
    version: appliedRules.map((r) => r.version).join("+") || "none",
  };
}

/**
 * Persist the snapshot for a purchased commitment.
 *
 * Writes ONLY the Phase 1 canonical columns
 * (`velrepeat_pricing_snapshots` / `velrepeat_pricing_snapshot_items`); there is
 * no second snapshot table. The full ordered rule trail, the exact unrounded
 * price and the seller/package provenance go into the existing `metadata` JSONB
 * column rather than into invented columns.
 *
 * Must be called inside the caller's transaction so the plan and its snapshot
 * commit together.
 *
 * WHAT THE PERSISTED ROW NOW SAYS, unambiguously:
 *   cycle_price  = the discounted price of ONE delivery cycle
 *   total_amount = cycle_price × commitment_cycles — the TOTAL PREPAID amount,
 *                  which is the number a prepaid customer is charged
 * `metadata.final_price_exact` keeps the exact, unrounded cycle price, and
 * `metadata.total_prepaid_exact` the exact total, so the relationship can be
 * re-proven from the row alone rather than inferred.
 */
export async function insertPricingSnapshot(
  client: PoolClient,
  request: CommitmentPricingRequestWithLines,
  pricing: ReturnType<typeof computeCommitmentPricingWithLines>,
): Promise<string> {
  const identity = ruleSetIdentity(pricing.appliedRules);

  const snapshot = await client.query(
    `INSERT INTO velrepeat_pricing_snapshots
       (plan_id, commitment_cycles, currency, subtotal_amount, discount_type, discount_value,
        discount_amount, cycle_price, total_amount, pricing_rule_key, pricing_rule_version, metadata)
     VALUES ($1, $2, $3, $4, 'sequential_percentage', $5, $6, $7, $8, $9, $10, $11::jsonb)
     RETURNING id`,
    [
      request.planId,
      request.commitmentCycles,
      pricing.currency,
      pricing.basePriceString,
      pricing.effectiveDiscountPercentString,
      pricing.discountAmountString,
      // The price of ONE delivery cycle …
      pricing.cyclePrice,
      // … and the TOTAL the prepaid customer owes for all of them. These are
      // different numbers whenever commitment_cycles > 1, and the Stripe charge
      // is derived from this second one.
      pricing.totalPrepaidString,
      identity.key,
      identity.version,
      JSON.stringify({
        seller_id: request.sellerId,
        package_id: request.packageId,
        applied_rules: pricing.appliedRules,
        base_price: pricing.basePriceString,
        // The exact, unrounded PER-CYCLE price: proof that nothing in the
        // pipeline rounded before the single final 2dp charge, and the value the
        // total is derived from.
        final_price_exact: toExactDecimalString(pricing.finalPrice),
        cycle_price: pricing.cyclePrice,
        commitment_cycles: pricing.commitmentCycles,
        total_prepaid: pricing.totalPrepaidString,
        // The exact, unrounded commitment total.
        total_prepaid_exact: toExactDecimalString(pricing.totalPrepaid),
        effective_discount: toExactDecimalString(pricing.effectiveDiscount),
        max_effective_discount: toExactDecimalString(MAX_EFFECTIVE_DISCOUNT),
        cap_enforced: true,
      }),
    ],
  );

  const snapshotId = snapshot.rows[0].id as string;

  for (const line of pricing.lines) {
    const lineTotal = multiply(line.unitPrice, makeRational(BigInt(line.quantity), 1n));
    await client.query(
      `INSERT INTO velrepeat_pricing_snapshot_items
         (snapshot_id, product_id, variant_id, quantity, unit_price, line_total)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshotId,
        line.productId,
        line.variantId,
        line.quantity,
        toMoneyString(line.unitPrice),
        toMoneyString(lineTotal),
      ],
    );
  }

  return snapshotId;
}
