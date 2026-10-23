/**
 * Public order numbers — 18 numeric digits, e.g. `586322973946053945`.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The customer-facing order number is quoted to support, so it must stay short,
 * un-guessable in volume, and survive being read aloud:
 *
 *   • it is NUMERIC ONLY — no letters, no prefix, no separator — because it is
 *     quoted, typed into support forms and used as a lookup key on every
 *     surface (customer, seller, center, tracking). A prefix such as
 *     `VNX-20260929-7K4P2M` forces every reader to strip decoration before
 *     matching, and every writer to know the decoration rules;
 *   • the first 14 digits are a MILLISECOND timestamp — this is the single
 *     source of time-ordering, keeps the number roughly sortable by creation
 *     time, and is the same guarantee the previous date-half `VNX-YYYYMMDD-`
 *     format offered (searchable by day) without spending 8 digits on a label;
 *   • the last 4 digits are a `crypto.randomInt()` disambiguator. A timestamp
 *     alone collides whenever two orders are created inside the same
 *     millisecond (concurrent workers, a cycle processing several shops at
 *     once), so the timestamp is never the whole number;
 *   • the alphabet is the ten decimal digits only, so the value is exactly
 *     `^[0-9]{18}$`.
 *
 * WHY NOT A SEQUENCE
 * ------------------
 * A sequence is predictable: the order count, and therefore the daily order
 * volume, would become public information. The random suffix costs 10^4
 * attempts' worth of collision pressure per millisecond against a partial
 * UNIQUE index — collisions are retried, not assumed away, so correctness does
 * not depend on the guess being lucky.
 *
 * WHY NOT `Math.random()`
 * -----------------------
 * It is a predictable PRNG, so the suffix was guessable from a handful of
 * samples. It comes from `crypto.randomInt()` instead.
 *
 * WHY 18 DIGITS AND NOT A BIGINT COLUMN
 * --------------------------------------
 * `Number` is a double: it silently loses precision above 2^53 - 1 = 9007199254740991
 * (16 digits), so an 18-digit value cannot survive a JSON round trip as a
 * JavaScript number. `orders.order_number` therefore stays `TEXT` and every
 * API, type and UI surface treats it as an opaque STRING. The digit count is a
 * format promise, not a numeric range, so nothing depends on the value being
 * a valid 64-bit integer.
 *
 * LEGACY NUMBERS
 * --------------
 * Orders created before this change keep their `VNX-…` value verbatim: the
 * column is nullable and the unique index is partial, so no rewriting of
 * production data is required and every historical order number still
 * resolves. `isLegacyOrderNumber()` identifies them so a lookup can try both
 * the numeric and the legacy shape instead of failing on the first miss.
 *
 * `orders.order_number` is guarded by the partial UNIQUE index
 * `idx_orders_number_unique` (`db/schema.sql`), so a collision is a DATABASE
 * decision, never an assumption: `isOrderNumberCollision()` lets the creating
 * transaction retry on that one error instead of failing somebody's checkout.
 */
import { randomInt } from "node:crypto";

/** The timestamp occupies the first 14 digits (YYYYMMDDHHMMSS is 14 as ms). */
const TIMESTAMP_LENGTH = 14;
/** Digits chosen uniformly from the random suffix. */
const SUFFIX_LENGTH = 4;
/** The published length of a public order number. `^[0-9]{18}$`. */
export const ORDER_NUMBER_LENGTH = TIMESTAMP_LENGTH + SUFFIX_LENGTH;

/** Ten decimal digits — nothing else can appear in a modern order number. */
const DIGITS = "0123456789";

/** The unique index that makes a collision detectable rather than silent. */
export const ORDER_NUMBER_UNIQUE_INDEX = "idx_orders_number_unique";

/** The shape every NEW order number must satisfy. Pinned by the test suite. */
export const ORDER_NUMBER_PATTERN = /^[0-9]{18}$/;

/**
 * Build a fresh order number, e.g. `586322973946053945`.
 *
 * `now` is injectable so the timestamp half is testable; production callers
 * pass nothing and get the current time (the number's date half is a label for
 * the order's `created_at` day — the order row's own timestamp remains the
 * authority).
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const timestamp = now.getTime().toString().padStart(TIMESTAMP_LENGTH, "0");
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
    suffix += DIGITS[randomInt(DIGITS.length)];
  }
  return `${timestamp.slice(-TIMESTAMP_LENGTH)}${suffix}`;
}

/**
 * Is this a legacy pre-numeric order number (`VNX-20260929-7K4P2M`)?
 *
 * Historical orders keep their original value, so a customer can still quote
 * one to support. This is a recognition helper for lookup paths, never a
 * generator input.
 */
export function isLegacyOrderNumber(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  if (ORDER_NUMBER_PATTERN.test(value)) return false;
  return /^VNX-\d{8}-[0-9A-Z]{6}$/.test(value);
}

/**
 * Is this error the UNIQUE violation of `orders.order_number` (and nothing else)?
 *
 * Deliberately narrow: a duplicate on any OTHER unique index — the checkout
 * idempotency key, a cart row, a payment slot, the checkout group — must keep
 * propagating, because retrying it is not what the caller wants and would hide
 * a real bug.
 */
export function isOrderNumberCollision(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown; detail?: unknown };
  if (e.code !== "23505") return false;
  if (e.constraint === ORDER_NUMBER_UNIQUE_INDEX) return true;
  // Some driver paths report the code without the constraint name; Postgres'
  // detail line then still names the column ("Key (order_number)=(5863…) already
  // exists").
  return typeof e.detail === "string" && e.detail.includes("order_number");
}
