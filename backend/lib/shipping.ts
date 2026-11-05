/**
 * Server-authoritative shipping pricing.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *
 * Before this module every order in the marketplace was written with
 * `shipping_fee = 0` (the column default) and the checkout UI printed a
 * hard-coded "ส่งฟรี / free shipping" row, so the customer was shown a total
 * that omitted delivery and the seller was paid for goods only. That is a
 * money defect, not a display defect: the amount the customer saw, the amount
 * persisted on `orders.total_amount`, and the amount sent to the payment
 * provider all have to be the SAME number, and that number has to be computed
 * where the client cannot reach it.
 *
 * THE CONTRACT (single source of truth for every shipping number in the app)
 *
 *   per shop shipment (one `orders` row, one `shipments` row):
 *       subtotal      = Σ(current unit price × quantity)          exact decimal
 *       shipping_fee  = fee of the shop's shipping rule           exact decimal
 *       discount      = 0 (no shop-level discount system exists)
 *       total_amount  = subtotal − discount + shipping_fee
 *
 *   per purchase (`checkout_groups` row):
 *       total_amount  = Σ per-shop total_amount
 *
 *   All money is carried as a decimal STRING and computed through
 *   `lib/money.ts` (exact rationals over bigint, ONE round-half-up at the end).
 *   No float ever participates, so `19.99 × 3 + 50.00` cannot drift by a minor
 *   unit and `NUMERIC(12,2)` receives the exact literal it will store.
 *
 * WHY A FLAT PER-SHOP RATE
 *
 * There is no carrier API in this repository and no weight/dimension data on
 * any product, so a real rate engine cannot be implemented without inventing
 * numbers. What the large Thai marketplaces do — Shopee, Lazada, TikTok Shop —
 * is charge ONE delivery per seller, because each seller ships their own
 * parcel, and let the seller choose the fee for their own shipping channel.
 * This module implements exactly that shape, with the numbers explicitly
 * configurable:
 *
 *   • `shops.shipping_fee`             — the seller's flat fee for one parcel.
 *                                        NULL = "use the platform default".
 *   • `shops.free_shipping_threshold`  — optional per-shop "free over X".
 *                                        NULL = no automatic free shipping.
 *   • `SHIPPING_FLAT_FEE_THB` env      — platform default used when the seller
 *                                        has not configured a fee.
 *
 * Free shipping is therefore never implied: it happens ONLY when the shop's
 * stored fee is exactly 0 or the shop's own threshold is reached, and the
 * reason is returned to the caller so the UI can say why.
 *
 * DELIBERATELY NOT HERE
 *   • Carrier/zone/weight rates. No provider is integrated and no product has
 *     the data, so nothing here pretends to know one.
 *   • Discounts. `orders.discount` stays 0 because no shop-level discount
 *     system exists in checkout; this module keeps the term in the contract so
 *     adding one later cannot silently break the invariant.
 */
import { createHash } from "node:crypto";
import {
  add,
  compare,
  isZero,
  multiplyByQuantity,
  parseDecimal,
  toMoneyString,
  ZERO,
  type Rational,
} from "./money.js";

/** The one implemented shipping method. Named, never inferred. */
export const SHIPPING_METHOD = "shop_flat_rate" as const;

/** How long a quote may be redeemed. Short on purpose: fees are re-read at checkout. */
export const SHIPPING_QUOTE_TTL_MINUTES = 15;

/**
 * Platform default flat fee per shop shipment, in THB, used when the shop has
 * no configured fee. Owner-approved business value; overridable per deployment
 * with `SHIPPING_FLAT_FEE_THB` and per shop in `shops.shipping_fee`.
 */
export const PLATFORM_DEFAULT_FLAT_FEE = "50.00";

/** Destinations the flat-rate rule can price. Anything else is refused. */
export const SUPPORTED_DESTINATIONS = ["TH"] as const;

export type ShippingReason =
  | "shop_flat_rate"
  | "seller_free_shipping"
  | "free_shipping_threshold"
  | "platform_default";

/** The shipping columns of one shop row. */
export interface ShopShippingConfig {
  shopId: string | null;
  shopName: string | null;
  /** `shops.shipping_fee` — NULL means "platform default". */
  shippingFee: string | null;
  /** `shops.free_shipping_threshold` — NULL means "no automatic free shipping". */
  freeShippingThreshold: string | null;
}

/** One purchasable line, priced by the server. */
export interface QuotedLine {
  productId: string;
  variantId: string | null;
  shopId: string | null;
  shopName?: string | null;
  quantity: number;
  /** Decimal string, already resolved from `products.price` / variant price. */
  unitPrice: string;
}

export interface ShopShippingQuote {
  shopId: string | null;
  shopName: string | null;
  subtotal: string;
  shippingFee: string;
  freeShipping: boolean;
  reason: ShippingReason;
  method: typeof SHIPPING_METHOD;
  itemCount: number;
}

export interface ShippingQuote {
  currency: string;
  method: typeof SHIPPING_METHOD;
  subtotal: string;
  shippingTotal: string;
  discount: string;
  total: string;
  itemCount: number;
  shops: ShopShippingQuote[];
}

/** Raised for anything the caller must turn into a 4xx, never a priced order. */
export class ShippingError extends Error {
  constructor(
    readonly code:
      | "SHIPPING_EMPTY_CART"
      | "SHIPPING_DESTINATION_UNSUPPORTED"
      | "SHIPPING_LINE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ShippingError";
  }
}

/**
 * The platform default fee as an exact decimal string.
 *
 * Read at CALL time, not module load, so a test (or a redeploy with a different
 * `SHIPPING_FLAT_FEE_THB`) always sees the current configuration. An invalid or
 * missing value falls back to the documented default rather than to 0 — a
 * misconfiguration must never look like free shipping.
 */
export function platformDefaultFee(): string {
  const raw = process.env.SHIPPING_FLAT_FEE_THB;
  if (raw === undefined || raw.trim() === "") return PLATFORM_DEFAULT_FLAT_FEE;
  const trimmed = raw.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return PLATFORM_DEFAULT_FLAT_FEE;
  try {
    return toMoneyString(parseDecimal(trimmed));
  } catch {
    return PLATFORM_DEFAULT_FLAT_FEE;
  }
}

/** Decimal string of a rational, for the wire and for `NUMERIC(12,2)`. */
export function money(value: Rational): string {
  return toMoneyString(value);
}

/**
 * Parse a nullable money column. A NULL/blank value means "not configured" and
 * is reported as such instead of being silently treated as 0.
 */
function optionalMoney(value: string | null | undefined): Rational | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  return parseDecimal(text);
}

/**
 * The ONE shipping rule.
 *
 *   fee = 0 (seller configured)        → free, reason `seller_free_shipping`
 *   subtotal ≥ free_shipping_threshold → free, reason `free_shipping_threshold`
 *   fee configured (> 0)               → that fee, reason `shop_flat_rate`
 *   fee NULL                           → platform default, reason `platform_default`
 *
 * The seller's explicit 0 wins over a threshold because a shop that ships free
 * must not start charging once a threshold is (re)set; the threshold only ever
 * grants free shipping, never removes it.
 */
export function computeShopShipping(
  config: ShopShippingConfig,
  subtotal: Rational,
): { fee: Rational; reason: ShippingReason } {
  const configured = optionalMoney(config.shippingFee);
  if (configured && isZero(configured)) {
    return { fee: ZERO, reason: "seller_free_shipping" };
  }
  if (configured && configured.num < 0n) {
    // A negative stored fee is corrupt configuration: refuse to price it as a
    // discount. Fall through to the platform default instead.
    return { fee: parseDecimal(platformDefaultFee()), reason: "platform_default" };
  }
  const threshold = optionalMoney(config.freeShippingThreshold);
  if (threshold && threshold.num > 0n && compare(subtotal, threshold) >= 0) {
    return { fee: ZERO, reason: "free_shipping_threshold" };
  }
  if (configured) {
    return { fee: configured, reason: "shop_flat_rate" };
  }
  return { fee: parseDecimal(platformDefaultFee()), reason: "platform_default" };
}

/** True when the destination country can be priced by the implemented rule. */
export function isSupportedDestination(country: string | null | undefined): boolean {
  const normalized = String(country ?? "").trim().toUpperCase();
  return (SUPPORTED_DESTINATIONS as readonly string[]).includes(normalized);
}

/**
 * Build the complete quote from server-priced lines and shop configurations.
 *
 * Pure: no I/O, no clock. The caller persists the result and attaches an
 * expiry. Throws `ShippingError` for an empty cart or an unpriceable line so a
 * caller can never turn a broken cart into a 0 THB order.
 */
export function buildShippingQuote(
  lines: readonly QuotedLine[],
  shops: readonly ShopShippingConfig[],
  currency = "THB",
): ShippingQuote {
  if (lines.length === 0) {
    throw new ShippingError("SHIPPING_EMPTY_CART", "Your cart has no items to ship.");
  }

  const configByShop = new Map<string, ShopShippingConfig>();
  for (const shop of shops) configByShop.set(shop.shopId ?? "", shop);

  // Preserve first-appearance order: the customer sees shops in cart order.
  const order: string[] = [];
  const subtotalByShop = new Map<string, Rational>();
  const countByShop = new Map<string, number>();
  const nameByShop = new Map<string, string | null>();

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ShippingError("SHIPPING_LINE_INVALID", "A cart line has an invalid quantity.");
    }
    const unit = parseDecimal(String(line.unitPrice));
    if (unit.num < 0n) {
      throw new ShippingError("SHIPPING_LINE_INVALID", "A cart line has an invalid price.");
    }
    const key = line.shopId ?? "";
    if (!subtotalByShop.has(key)) {
      order.push(key);
      subtotalByShop.set(key, ZERO);
      countByShop.set(key, 0);
      nameByShop.set(key, line.shopName ?? configByShop.get(key)?.shopName ?? null);
    }
    subtotalByShop.set(
      key,
      add(subtotalByShop.get(key) ?? ZERO, multiplyByQuantity(unit, line.quantity)),
    );
    countByShop.set(key, (countByShop.get(key) ?? 0) + line.quantity);
  }

  let subtotalTotal = ZERO;
  let shippingTotal = ZERO;
  const shopQuotes: ShopShippingQuote[] = [];

  for (const key of order) {
    const subtotal = subtotalByShop.get(key) ?? ZERO;
    // One rounding step per shop subtotal, exactly like the order row will store.
    const subtotalString = toMoneyString(subtotal);
    const roundedSubtotal = parseDecimal(subtotalString);

    const config: ShopShippingConfig = configByShop.get(key) ?? {
      shopId: key === "" ? null : key,
      shopName: nameByShop.get(key) ?? null,
      shippingFee: null,
      freeShippingThreshold: null,
    };
    const { fee, reason } = computeShopShipping(config, roundedSubtotal);
    const feeString = toMoneyString(fee);

    subtotalTotal = add(subtotalTotal, roundedSubtotal);
    shippingTotal = add(shippingTotal, parseDecimal(feeString));

    shopQuotes.push({
      shopId: config.shopId,
      shopName: nameByShop.get(key) ?? config.shopName ?? null,
      subtotal: subtotalString,
      shippingFee: feeString,
      freeShipping: isZero(parseDecimal(feeString)),
      reason,
      method: SHIPPING_METHOD,
      itemCount: countByShop.get(key) ?? 0,
    });
  }

  const total = add(subtotalTotal, shippingTotal);

  return {
    currency,
    method: SHIPPING_METHOD,
    subtotal: toMoneyString(subtotalTotal),
    shippingTotal: toMoneyString(shippingTotal),
    // No shop-level discount system exists; the term is part of the contract so
    // it cannot be silently dropped when one is added.
    discount: "0.00",
    total: toMoneyString(total),
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    shops: shopQuotes,
  };
}

/**
 * Fingerprint of everything a quote must agree with: the exact lines (product,
 * variant, quantity, server price, shop), the destination address row, and the
 * currency. Sorted, so the same cart always hashes the same regardless of row
 * order coming back from PostgreSQL.
 *
 * Checkout recomputes this from the rows it is about to insert and compares it
 * with the stored quote. Any change — quantity, price, added/removed line,
 * different address — changes the hash and the stale quote is refused.
 */
export function shippingFingerprint(
  lines: readonly QuotedLine[],
  addressId: string | null,
  currency = "THB",
): string {
  const normalized = lines
    .map((line) => [
      line.productId,
      line.variantId ?? "",
      String(line.quantity),
      toMoneyString(parseDecimal(String(line.unitPrice))),
      line.shopId ?? "",
    ].join("|"))
    .sort();
  const payload = JSON.stringify({
    v: 1,
    currency,
    addressId: addressId ?? "",
    lines: normalized,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** Quote expiry timestamp (server clock, never client-supplied). */
export function shippingQuoteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SHIPPING_QUOTE_TTL_MINUTES * 60_000);
}
