/**
 * Wholesale pack pricing — the ONE rule.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *
 * A seller sells a product by the pack (pack size N units) at a pack price that
 * may depend on how many packs are bought. Two things have to stay true while
 * that is introduced:
 *
 *   • the money stays EXACT — `100.00 per pack of 3` must charge 100.00, not
 *     33.33 × 3 = 99.99;
 *   • the rest of the marketplace keeps ONE shape — a line is units, a price is
 *     per unit, inventory is units.
 *
 * So the pack price is kept as an EXACT RATIONAL (`price_per_pack / pack_size`)
 * and the only place it is rounded is the final 2-decimal line amount. That is
 * what the large Thai marketplaces do too: tiers are published per pack, the
 * line is charged on its unit quantity.
 *
 * APPROVED RULES (owner decision, see .ai/reports/LATEST.md)
 *
 *   1. Per-unit price of record. Retail price and tier pack price become a
 *      per-unit rational; nothing downstream learns about packs except the
 *      order-line snapshot.
 *   2. PARTIAL PACKS ARE RETAIL. Wholesale applies only when
 *      `units % pack_size === 0` AND `packs >= the seller's minimum`. Below
 *      that the line is retail — never a refusal, never a blended price the
 *      customer would have to reverse-engineer.
 *   3. Gate: only a VERIFIED business account is priced wholesale. Resolved
 *      server-side on every request; a customer or a rejected account gets
 *      retail.
 *   4. Tier = the greatest `min_packs <= packs`.
 *   5. Inventory is UNITS (`quantity`), never packs.
 *
 * WHY `order_items.price` IS 2dp AND MAY NOT MULTIPLY BACK
 *
 * `order_items.price` is `NUMERIC(12,2)`. A per-unit price of 100/3 cannot be
 * stored there, so for a wholesale line the column holds the same per-unit
 * value ROUNDED (display/legacy readers), while `order_items.subtotal` holds the
 * EXACT line amount (`packs × price_per_pack`) and `wholesale_*` columns hold
 * the pack identity that produced it. `subtotal = price × quantity` therefore
 * holds exactly for retail lines and for wholesale lines is replaced by the
 * documented, audit-replayable identity:
 *
 *     subtotal = wholesale_packs × wholesale_tier_price
 *
 * A test asserts both halves of that statement, so a future "cleanup" that
 * starts trusting `price × quantity` fails immediately.
 */
import {
  ONE,
  ZERO,
  compare,
  divide,
  isZero,
  makeRational,
  multiplyByQuantity,
  parseDecimal,
  roundHalfUp,
  toMoneyString,
  type Rational,
} from "./money.js";

/** Monetary precision of every stored money column (`NUMERIC(12,2)`). */
const MONEY_SCALE = 2;

/** A seller's pack configuration for ONE (product, variant) pair. */
export interface WholesaleTier {
  packSize: number;
  minPacks: number;
  /** Decimal string, per PACK (not per unit). */
  pricePerPack: string;
}

/** The result of pricing one cart line. */
export interface PricedLine {
  /** Units actually charged (the cart quantity). */
  units: number;
  /** Per-unit price as an exact rational (retail price or pack price / pack size). */
  unitPrice: Rational;
  /** Exact line amount. */
  lineTotal: Rational;
  /** `lineTotal` rounded to 2 decimals — the NUMERIC(12,2) value to store. */
  lineTotalMoney: string;
  /** Per-unit price rounded to 2 decimals — the NUMERIC(12,2) `order_items.price`. */
  unitPriceMoney: string;
  /** True when the wholesale tier applied. */
  wholesale: boolean;
  /** The applied pack identity, or nulls for a retail line. */
  packSize: number | null;
  packs: number | null;
  tierPricePerPack: string | null;
  /** Why wholesale did or did not apply (wire-visible, so the UI can explain). */
  reason: WholesaleReason;
}

export type WholesaleReason =
  | "retail_not_verified"
  | "retail_no_tiers"
  | "retail_partial_pack"
  | "retail_below_minimum"
  | "wholesale_tier";

/**
 * Price ONE line.
 *
 * `retailPrice` is the current server price of the product (or its variant).
 * `tiers` is every tier the seller configured for exactly that (product,
 * variant) pair, in any order. `verified` is the RESOLVED business status of
 * the buyer — never something the client sent.
 */
export function priceLine(
  units: number,
  retailPrice: string,
  tiers: readonly WholesaleTier[],
  verified: boolean,
): PricedLine {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError(`priceLine: units must be a positive integer, got ${units}`);
  }
  const retail = parseDecimal(retailPrice);

  const retailLine = (reason: WholesaleReason): PricedLine => {
    const lineTotal = multiplyByQuantity(retail, units);
    return {
      units,
      unitPrice: retail,
      lineTotal,
      lineTotalMoney: toMoneyString(lineTotal),
      unitPriceMoney: toMoneyString(retail),
      wholesale: false,
      packSize: null,
      packs: null,
      tierPricePerPack: null,
      reason,
    };
  };

  if (!verified) return retailLine("retail_not_verified");
  if (tiers.length === 0) return retailLine("retail_no_tiers");

  // The pack size belongs to the (product, variant) pair, so every tier of that
  // pair carries the same one; a mismatch is corrupt configuration and must not
  // be guessed at.
  const packSize = tiers[0]!.packSize;
  if (!Number.isInteger(packSize) || packSize < 2) return retailLine("retail_no_tiers");
  if (tiers.some((t) => t.packSize !== packSize)) return retailLine("retail_no_tiers");

  if (units % packSize !== 0) return retailLine("retail_partial_pack");
  const packs = units / packSize;

  const minimum = Math.min(...tiers.map((t) => t.minPacks));
  if (packs < minimum) return retailLine("retail_below_minimum");

  // Tier = greatest minPacks <= packs.
  const tier = tiers
    .filter((t) => t.minPacks <= packs)
    .sort((a, b) => b.minPacks - a.minPacks)[0]!;

  const pricePerPack = parseDecimal(tier.pricePerPack);
  // Exact rational per unit — never rounded here.
  const unitPrice = divide(pricePerPack, makeRational(BigInt(packSize), 1n));
  // `packs × price_per_pack` is the authoritative line amount; it is exact and
  // telescopes with the per-unit rational (asserted by tests).
  const lineTotal = multiplyByQuantity(pricePerPack, packs);

  return {
    units,
    unitPrice,
    lineTotal,
    lineTotalMoney: toMoneyString(lineTotal),
    // Display/legacy column value: the per-unit price rounded to cents. It is
    // NOT used to recompute the line — `lineTotal` is.
    unitPriceMoney: moneyString(unitPrice),
    wholesale: true,
    packSize,
    packs,
    tierPricePerPack: toMoneyString(pricePerPack),
    reason: "wholesale_tier",
  };
}

/**
 * A rational rendered at 2 decimals (half-up) — the value a `NUMERIC(12,2)`
 * column will hold. Used only for the per-unit DISPLAY column of a wholesale
 * line; the authoritative amount is always the exact `lineTotal`.
 */
export function moneyString(value: Rational): string {
  const scaled = roundHalfUp(value, MONEY_SCALE);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${negative ? "-" : ""}${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * The exact identity of a wholesale line, used by the shipping fingerprint so a
 * tier edit (or a verification change) invalidates an outstanding quote even if
 * the rounded per-unit price happens to be unchanged.
 */
export function wholesaleFingerprintPart(line: PricedLine): string {
  if (!line.wholesale) return "";
  return `${line.packSize}|${line.tierPricePerPack}|${line.packs}`;
}

/** The smallest achievable per-unit price, for "from X" display. */
export function cheapestUnitPrice(tiers: readonly WholesaleTier[], retailPrice: string): {
  perUnit: Rational;
  pricePerPack: string;
  packSize: number;
} | null {
  if (tiers.length === 0) return null;
  const best = tiers.reduce((a, b) => (compare(parseDecimal(b.pricePerPack), parseDecimal(a.pricePerPack)) < 0 ? b : a));
  const perUnit = divide(parseDecimal(best.pricePerPack), makeRational(BigInt(best.packSize), 1n));
  // A "wholesale" tier that is not cheaper than retail is not an offer.
  if (compare(multiplyByQuantity(perUnit, 1), parseDecimal(retailPrice)) >= 0) return null;
  return { perUnit, pricePerPack: best.pricePerPack, packSize: best.packSize };
}

export { ONE, ZERO, isZero };
