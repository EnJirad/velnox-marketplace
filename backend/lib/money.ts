/**
 * Canonical decimal-safe money arithmetic.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * Owner decision G2 (VelRepeat V2): prices are computed at FULL precision
 * through the pricing pipeline and rounded to 2 decimal places ONCE, at the
 * final price. No intermediate step may round, and money must never be a
 * JavaScript float.
 *
 * A float cannot satisfy that. `1000 * 0.93 * 0.95` in binary floating point
 * is not 883.5 — it is 883.4999999999999 — and the same expression re-evaluated
 * in a different order is not bit-identical. That is why every "just use a
 * number" implementation of a discount pipeline eventually disagrees with the
 * invoice by one minor unit.
 *
 * So this module represents money as an EXACT RATIONAL over `bigint`:
 *
 *     Rational = { num: bigint, den: bigint }
 *
 * Nothing is ever rounded, truncated or approximated until the single explicit
 * `roundHalfUp()` call at the pricing boundary. Because the numerator and
 * denominator are integers, the result is:
 *
 *   • deterministic   — the same inputs always produce bit-identical output,
 *                       independent of evaluation order or platform;
 *   • exact           — no value is lost between rules;
 *   • float-free      — no IEEE-754 value is ever created, so nothing here can
 *                       drift by a ULP.
 *
 * The repository already stores every money column as `NUMERIC(12, 2)`
 * (db/schema.sql) and hands node-postgres values as STRINGS precisely to avoid
 * float round-trips, so this module speaks decimal strings on both edges:
 * `parseDecimal("19.99")` in, `"19.99"` out.
 *
 * DELIBERATELY NOT HERE
 * ─────────────────────
 *   • Any FX conversion. G2 fixes the V2 currency to THB.
 *   • Any currency table. `currency` is a plain TEXT column with a 'THB'
 *     default and no exponent metadata anywhere in the schema.
 *   • Any Stripe-boundary conversion. `backend/routes/stripe.ts` owns
 *     `toStripeMinor()` (and the VelRepeat V2 plan payment derives its charge
 *     through the exact rational arithmetic of THIS module before handing the
 *     result to that one rule) — this module does not replace it, because
 *     payment-boundary code belongs to the payment architecture. See the G1/G2
 *     audit for the note.
 *
 * @see .ai/tasks/audits/velrepeat-v2-g1-g3-implementation-2026-09-30.md
 */

/** An exact non-negative-or-negative fraction. `den` is always > 0. */
export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

/** The number of decimal places every money column in this repository stores. */
export const MONEY_DECIMALS = 2;

export const ZERO: Rational = { num: 0n, den: 1n };
export const ONE: Rational = { num: 1n, den: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Build a rational in lowest terms with a positive denominator.
 *
 * Reducing by GCD keeps the integers small: a pipeline of a handful of
 * percentage rules produces numerators and denominators that stay far below
 * 128 bits, so this is never a performance concern.
 */
export function makeRational(num: bigint, den: bigint): Rational {
  if (den === 0n) throw new RangeError("makeRational: denominator must not be zero");
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return { num: 0n, den: 1n };
  const g = gcd(n, d);
  return { num: n / g, den: d / g };
}

export function multiply(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.num, a.den * b.den);
}

export function divide(a: Rational, b: Rational): Rational {
  if (b.num === 0n) throw new RangeError("divide: division by zero");
  return makeRational(a.num * b.den, a.den * b.num);
}

export function subtract(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function add(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function compare(a: Rational, b: Rational): -1 | 0 | 1 {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isZero(a: Rational): boolean {
  return a.num === 0n;
}

export function isNegative(a: Rational): boolean {
  return a.num < 0n;
}

/**
 * Parse an exact decimal STRING into a rational. No rounding occurs: every
 * digit after the point becomes part of the denominator.
 *
 * Accepts an optional leading `-`, an optional integer part, and up to any
 * number of fraction digits. Deliberately rejects exponent notation, hex,
 * `Infinity`, `NaN` and empty input — every one of those is a sign that a
 * float has leaked in from somewhere upstream.
 */
export function parseDecimal(input: string): Rational {
  const text = input.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new TypeError(`parseDecimal: not an exact decimal literal: ${JSON.stringify(input)}`);
  }
  const [, sign, whole, fraction = ""] = match;
  const digits = `${whole}${fraction}`;
  const num = BigInt(digits);
  const den = 10n ** BigInt(fraction.length);
  return makeRational(sign === "-" ? -num : num, den);
}

/**
 * The single boundary between untrusted JSON and exact arithmetic.
 *
 * A JSON payload can legitimately carry a price as a NUMBER, and rejecting
 * that would be unusable — but a float must never survive past this line. So
 * the number is rendered to its shortest round-trip decimal string ONCE and
 * immediately parsed exactly; everything downstream is integer arithmetic.
 *
 * Callers that want stricter input validation should validate the *shape*
 * (sign, magnitude, decimal places) before calling this.
 */
export function parseDecimalInput(value: unknown): Rational {
  if (typeof value === "bigint") return makeRational(value, 1n);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("parseDecimalInput: number must be finite");
    }
    return parseDecimal(String(value));
  }
  if (typeof value === "string") return parseDecimal(value);
  throw new TypeError(`parseDecimalInput: unsupported monetary input ${typeof value}`);
}

/**
 * Round an exact rational to `decimals` places, HALF UP — away from zero.
 *
 * Half-up is the repository's existing behaviour, not a new choice:
 *   • `backend/routes/stripe.ts` → `Math.round(n * 100)` rounds half away from
 *     zero toward +∞, which for non-negative money is identical;
 *   • PostgreSQL's `round(numeric, int)` is half-up away from zero.
 *
 * Implemented on integers only: the quotient is taken with truncation toward
 * zero and the remainder decides the bump, so no float ever participates.
 */
export function roundHalfUp(value: Rational, decimals: number = MONEY_DECIMALS): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`roundHalfUp: decimals must be a non-negative integer, got ${decimals}`);
  }
  // Shift the rational left by `decimals` places, entirely in integers:
  //     scaled = num * 10^decimals / den
  // BigInt division truncates toward zero, so `whole` is the magnitude already
  // truncated (and already carries the sign of `shifted`) and `rest` is the
  // discarded remainder.
  const shifted = value.num * 10n ** BigInt(decimals);
  const whole = shifted / value.den;
  const rest = shifted % value.den;

  // Half-up: compare twice the remainder against the divisor. `==` is a genuine
  // tie and rounds AWAY from zero, which is what `Math.round(n * 100)` and
  // PostgreSQL's `round(numeric, int)` both do.
  //
  // `whole` already holds the sign (truncation is toward zero), so a tie moves
  // by exactly one step IN THE SIGN DIRECTION; the sign must not be applied a
  // second time here.
  const twice = (rest < 0n ? -rest : rest) * 2n;
  if (twice < value.den) return whole;
  return whole + (shifted < 0n ? -1n : 1n);
}

/**
 * Render a scaled integer as a plain decimal string, e.g.
 * `formatScaled(88350n, 2)` → `"883.50"`.
 *
 * A string (never a number) is returned so node-postgres hands PostgreSQL the
 * exact literal; `NUMERIC(12,2)` then stores precisely these digits.
 */
export function formatScaled(scaled: bigint, decimals: number = MONEY_DECIMALS): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`formatScaled: decimals must be a non-negative integer, got ${decimals}`);
  }
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const factor = 10n ** BigInt(decimals);
  const whole = magnitude / factor;
  const fraction = magnitude % factor;
  const fractionText = fraction.toString().padStart(decimals, "0");
  const sign = negative ? "-" : "";
  return decimals === 0 ? `${sign}${whole}` : `${sign}${whole}.${fractionText}`;
}

/** The single G2 rounding step: exact rational → 2-decimal decimal string. */
export function toMoneyString(value: Rational): string {
  return formatScaled(roundHalfUp(value, MONEY_DECIMALS), MONEY_DECIMALS);
}

/**
 * Render an exact rational as its FULL decimal expansion, without rounding.
 *
 * Every value the VelRepeat pricing pipeline produces is a product of finite
 * decimals, so its reduced denominator is always of the form 2^a·5^b and the
 * expansion terminates. That makes "the exact value" a finite string, which is
 * what lets the audit trail prove that no intermediate step was rounded — the
 * snapshot stores this string next to the 2-decimal charge.
 *
 * Throws if the denominator has a prime factor other than 2 or 5 (i.e. the
 * value is genuinely non-terminating), because silently truncating here would
 * reintroduce exactly the rounding this module exists to prevent.
 */
export function toExactDecimalString(value: Rational): string {
  let den = value.den;
  let twos = 0;
  let fives = 0;
  while (den % 2n === 0n) {
    den /= 2n;
    twos++;
  }
  while (den % 5n === 0n) {
    den /= 5n;
    fives++;
  }
  if (den !== 1n) {
    throw new RangeError(`toExactDecimalString: non-terminating expansion for ${value.num}/${value.den}`);
  }
  const scale = Math.max(twos, fives);
  // `den` divides `10^scale` by construction, so this division is exact — the
  // shift is what makes the terminating expansion representable as an integer.
  const scaled = (value.num * 10n ** BigInt(scale)) / value.den;
  return formatScaled(scaled, scale);
}

/**
 * `subtotal * quantity` for an integer quantity. Quantity is an INTEGER column
 * in every money-bearing line table, so it multiplies without a rounding step.
 */
export function multiplyByQuantity(unitPrice: Rational, quantity: number): Rational {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`multiplyByQuantity: quantity must be a non-negative integer, got ${quantity}`);
  }
  return multiply(unitPrice, makeRational(BigInt(quantity), 1n));
}
