/**
 * Order numbers — the customer-facing reference, and the one collision it can have.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * `orders.order_number` is what a customer quotes to support and what staff search
 * for, so its properties are a product decision and not an implementation detail:
 *
 *    1. the SHAPE stays `VNX-YYYYMMDD-XXXXXX` — readable, dated, branded;
 *    2. it is NOT sequential: the reference is random, so the number of orders a
 *       day is not public information and no internal UUID is ever exposed
 *       (`VNX-000001` would leak both);
 *    3. the reference comes from a cryptographic source, so a handful of observed
 *       numbers cannot predict the next one — `Math.random()` could;
 *    4. the alphabet excludes the glyphs that get misread aloud (`0/O`, `1/I/L`,
 *       `U/V`), because the number is dictated over the phone;
 *    5. a reference CAN still collide, and the UNIQUE index
 *       (`idx_orders_number_unique`) is what makes that detectable — so the
 *       creating transaction retries on that one error, and on nothing else.
 *
 * No database is needed: the generator and the predicate are pure, and the retry
 * path is asserted against the shipped source.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  generateOrderNumber,
  isOrderNumberCollision,
  ORDER_NUMBER_UNIQUE_INDEX,
} from "../lib/order-number.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Source with comments stripped.
 *
 * Some of these assertions are about what the CODE does, and `order-number.ts`
 * documents the very thing that was removed ("the reference used to come from
 * Math.random()"). Matching against the raw file would then fail on its own
 * explanation — so the negative assertions look at code only.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CART = "backend/routes/cart.ts";
const STRIPE = "backend/routes/stripe.ts";
const LIB = "backend/lib/order-number.ts";

/** The symbols the number may use, and the ones it deliberately may not. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const AMBIGUOUS = ["0", "1", "I", "L", "O", "U"];

describe("order numbers — the human-readable reference", () => {
  test("keeps the VNX-YYYYMMDD-XXXXXX shape", () => {
    const pattern = new RegExp(`^VNX-\\d{8}-[${ALPHABET}]{6}$`);
    for (let i = 0; i < 200; i += 1) {
      const n = generateOrderNumber(new Date("2026-09-29T10:00:00Z"));
      expect(n).toMatch(pattern);
      expect(n.startsWith("VNX-20260929-")).toBe(true);
    }
    // The date half follows the injected day, so a UTC boundary cannot mislabel it.
    expect(generateOrderNumber(new Date("2026-01-02T23:59:00Z"))).toMatch(/^VNX-20260102-/);
  });

  test("never uses a glyph that is misread aloud", () => {
    const reference = () => generateOrderNumber().split("-")[2];
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const char of reference()) seen.add(char);
    }
    for (const bad of AMBIGUOUS) {
      expect(seen.has(bad)).toBe(false);
    }
    for (const char of seen) {
      expect(ALPHABET).toContain(char);
    }
  });

  test("is not sequential — many numbers, many references", () => {
    const references = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) references.add(generateOrderNumber().split("-")[2]);
    // Birthday-bound collisions in 2 000 draws from 31^6 are astronomically
    // unlikely; anything near "sequential" would produce almost no unique values.
    expect(references.size).toBeGreaterThan(1_990);
  });

  test("there is exactly ONE generator, and it uses a cryptographic source", () => {
    const lib = read(LIB);
    expect(lib).toContain("randomInt");
    expect(lib).toContain("node:crypto");
    // The predictable PRNG is gone from the generator AND from both callers.
    for (const file of [LIB, CART, STRIPE]) {
      expect(code(file)).not.toContain("Math.random");
    }
    // …and no second copy of the generator survives anywhere in the backend.
    for (const file of [CART, STRIPE]) {
      expect(read(file)).not.toContain("function generateOrderNumber");
      expect(read(file)).toContain("order-number.js");
    }
    // The customer number is not derived from a count of orders (that would be
    // sequential-by-another-name and would leak the daily volume).
    expect(lib).not.toMatch(/COUNT\s*\(/);
  });
});

describe("order numbers — collision handling", () => {
  test("the unique index exists in BOTH schema files (no migration is needed)", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = read(file);
      expect(sql).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${ORDER_NUMBER_UNIQUE_INDEX}`);
      expect(sql).toContain("ON orders (order_number)");
    }
    // The index this predicate names is the one the database actually has.
    expect(read("db/schema.sql")).toContain(ORDER_NUMBER_UNIQUE_INDEX);
  });

  test("only the order_number unique violation is treated as a collision", () => {
    const collision = { code: "23505", constraint: ORDER_NUMBER_UNIQUE_INDEX };
    expect(isOrderNumberCollision(collision)).toBe(true);
    // The detail line alone is enough when the driver omits the constraint name.
    expect(
      isOrderNumberCollision({
        code: "23505",
        detail: "Key (order_number)=(VNX-20260929-7K4P2M) already exists.",
      }),
    ).toBe(true);

    // A duplicate on ANY other unique index keeps propagating — retrying those
    // would replay an unrelated INSERT and hide the real bug.
    expect(isOrderNumberCollision({ code: "23505", constraint: "payments_active_slot_idx" })).toBe(false);
    expect(isOrderNumberCollision({ code: "23505", detail: "Key (request_key)=(abc) already exists." })).toBe(false);
    // Anything that is not a unique violation at all.
    expect(isOrderNumberCollision({ code: "23503" })).toBe(false);
    expect(isOrderNumberCollision({ code: "42P01", constraint: ORDER_NUMBER_UNIQUE_INDEX })).toBe(false);
    for (const notAnError of [null, undefined, "23505", 23505, {}, new Error("boom")]) {
      expect(isOrderNumberCollision(notAnError)).toBe(false);
    }
  });

  test("checkout retries the collision under a savepoint, and stops trying", () => {
    const cart = read(CART);
    // The retry is what makes a collision survivable inside a transaction…
    expect(cart).toContain("SAVEPOINT order_number_attempt");
    expect(cart).toContain("ROLLBACK TO SAVEPOINT order_number_attempt");
    expect(cart).toContain("RELEASE SAVEPOINT order_number_attempt");
    expect(cart).toContain("isOrderNumberCollision(err)");
    // …bounded, so a misbehaving database cannot spin forever…
    expect(cart).toMatch(/ORDER_NUMBER_ATTEMPTS = \d+/);
    expect(cart).toContain("attempt >= ORDER_NUMBER_ATTEMPTS");
    // …and the order INSERT is the only one inside the guard.
    expect(cart).toContain("insertOrderWithUniqueNumber(client, {");
    expect(cart).not.toMatch(/INSERT INTO orders[\s\S]{0,2000}INSERT INTO orders/);
  });
});
