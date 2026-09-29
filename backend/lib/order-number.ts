/**
 * Human-readable order numbers — `VNX-YYYYMMDD-XXXXXX`.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The customer-facing order number is quoted to support, so it must stay short,
 * unambiguous and un-guessable in volume:
 *
 *   • the BRAND PREFIX + DATE make it readable and easy to search for;
 *   • a RANDOM 6-symbol reference keeps it from being sequential — the count of
 *     orders a day is therefore not public information (unlike `VNX-000001`), and
 *     no internal UUID ever has to be shown to a customer;
 *   • the alphabet omits the glyphs that get misread aloud or in print
 *     (`0/O`, `1/I/L`, `U/V`), so a number dictated to a call centre survives.
 *
 * The reference used to come from `Math.random()`. That is a predictable PRNG, so
 * the reference was guessable from a handful of samples — the wrong property for
 * something a customer can quote and a staff member can look up. It now comes from
 * `crypto.randomInt()`, and the two duplicate copies of this function (one in
 * `routes/cart.ts`, one dead one in `routes/stripe.ts`) collapse into this single
 * definition.
 *
 * `orders.order_number` is already guarded by the partial UNIQUE index
 * `idx_orders_number_unique` (`db/schema.sql`), so a collision is a DATABASE
 * decision, never an assumption: `isOrderNumberCollision()` lets the creating
 * transaction retry on that one error instead of failing somebody's checkout.
 */
import { randomInt } from "node:crypto";

/** No `0`, `1`, `I`, `L`, `O`, `U`: every symbol survives being read aloud. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Reference symbols after the date. 31^6 ≈ 8.9e8 combinations per day. */
const REFERENCE_LENGTH = 6;

/** The unique index that makes a collision detectable rather than silent. */
export const ORDER_NUMBER_UNIQUE_INDEX = "idx_orders_number_unique";

/**
 * Build a fresh order number, e.g. `VNX-20260929-7K4P2M`.
 *
 * `now` is injectable so the date half is testable; production callers pass
 * nothing and get the current UTC date (the date is the order's `created_at` day,
 * which the order row's own timestamp is the authority for — this is a label).
 */
export function generateOrderNumber(now: Date = new Date()): string {
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  let reference = "";
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    reference += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `VNX-${dateStr}-${reference}`;
}

/**
 * Is this error the UNIQUE violation of `orders.order_number` (and nothing else)?
 *
 * Deliberately narrow: a duplicate on any OTHER unique index — the checkout
 * idempotency key, a cart row, a payment slot — must keep propagating, because
 * retrying it is not what the caller wants and would hide a real bug.
 */
export function isOrderNumberCollision(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown; detail?: unknown };
  if (e.code !== "23505") return false;
  if (e.constraint === ORDER_NUMBER_UNIQUE_INDEX) return true;
  // Some driver paths report the code without the constraint name; Postgres'
  // detail line then still names the column ("Key (order_number)=(VNX-…) already exists").
  return typeof e.detail === "string" && e.detail.includes("order_number");
}
