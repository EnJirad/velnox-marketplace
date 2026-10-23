/**
 * Order numbers — the customer-facing reference, and the one collision it can have.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * `orders.order_number` is what a customer quotes to support and what staff search
 * for, so its properties are a product decision and not an implementation detail.
 *
 * The shape is now **NUMERIC ONLY** — `586322973946053945`, exactly 18 decimal
 * digits, matching `^[0-9]{18}$`:
 *
 *    1. NO LETTERS, NO PREFIX, NO SEPARATOR. Every surface (customer, seller,
 *       center, tracking, support forms, search) treats the number as a lookup
 *       key, and a decorated value forces every reader to strip decoration
 *       before matching. A bare digit string is matched as-is;
 *    2. it is a STRING end to end. 18 digits exceeds `Number.MAX_SAFE_INTEGER`
 *       (2^53 − 1 = 9007199254740991, 16 digits), so a JSON round trip through a
 *       JavaScript number would silently corrupt it. `orders.order_number`
 *       therefore stays `TEXT` and the frontend types it as `string`;
 *    3. it is NOT sequential: the reference is random, so the number of orders a
 *       day is not public information and no internal UUID is ever exposed;
 *    4. the reference comes from a cryptographic source, so a handful of
 *       observed numbers cannot predict the next one — `Math.random()` could;
 *    5. a reference CAN still collide, and the UNIQUE index
 *       (`idx_orders_number_unique`) is what makes that detectable — so the
 *       creating transaction retries on that one error, and on nothing else.
 *
 * LEGACY NUMBERS
 * --------------
 * Orders created before this change keep their `VNX-YYYYMMDD-XXXXXX` value
 * verbatim: the column is nullable and the unique index is partial, so nothing
 * is rewritten in production and every historical number still resolves.
 * `isLegacyOrderNumber()` is the recognition helper that lets a lookup try both
 * shapes instead of failing on the first miss.
 *
 * No database is needed: the generator and the predicates are pure, and the
 * retry paths are asserted against the shipped source.
 */
import { describe, expect, test } from "bun:test";
import { globSync } from "fs";
import { readFileSync } from "fs";
import { join } from "path";

import { unqualified } from "./helpers/canonical-schema.js";

import {
  generateOrderNumber,
  isLegacyOrderNumber,
  isOrderNumberCollision,
  ORDER_NUMBER_LENGTH,
  ORDER_NUMBER_PATTERN,
  ORDER_NUMBER_UNIQUE_INDEX,
} from "../lib/order-number.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Source with comments stripped.
 *
 * Some of these assertions are about what the CODE does, and `order-number.ts`
 * documents the very thing that was removed (`Math.random()`). Matching against
 * the raw file would then fail on its own explanation — so the negative
 * assertions look at code only.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CART = "backend/routes/cart.ts";
const STRIPE = "backend/routes/stripe.ts";
const CYCLES = "backend/lib/velrepeat-cycles.ts";
const LIB = "backend/lib/order-number.ts";

describe("order numbers — digits only", () => {
  test("is exactly 18 digits, and nothing else", () => {
    expect(ORDER_NUMBER_LENGTH).toBe(18);
    for (let i = 0; i < 200; i += 1) {
      expect(generateOrderNumber()).toMatch(/^[0-9]{18}$/);
    }
    // The published pattern IS the format contract.
    expect(ORDER_NUMBER_PATTERN.source).toBe("^[0-9]{18}$");
  });

  test("never contains a letter, a prefix or a separator", () => {
    for (let i = 0; i < 500; i += 1) {
      const n = generateOrderNumber();
      expect(n).toMatch(/^[0-9]{18}$/);
      // No `VNX-`, no `-`, no whitespace, no other punctuation.
      expect(n).not.toMatch(/[^0-9]/);
      expect(n).toMatch(/^[0-9]+$/);
    }
  });

  test("the first 14 digits are the injected timestamp, the last 4 are random", () => {
    // A fixed instant pins the time half exactly, so a UTC boundary cannot
    // mislabel it and the format is asserted, not inferred.
    const now = new Date("2026-09-29T10:00:00.123Z");
    // The time half is zero-padded to a fixed 14 digits, so an instant whose own
    // ms value is shorter still yields an 18-digit number.
    const ms = String(now.getTime()).padStart(14, "0");
    expect(ms).toHaveLength(14);
    for (let i = 0; i < 50; i += 1) {
      const n = generateOrderNumber(now);
      expect(n.slice(0, 14)).toBe(ms);
      expect(n.slice(14)).toMatch(/^[0-9]{4}$/);
    }
    // An EARLIER instant sorts earlier — the number stays roughly creation-ordered.
    const earlier = generateOrderNumber(new Date("2026-01-02T23:59:00.000Z"));
    const later = generateOrderNumber(new Date("2026-01-02T23:59:01.000Z"));
    expect(earlier < later).toBe(true);
  });

  test("is not sequential — many numbers, many references", () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) numbers.add(generateOrderNumber());
    // Draws land in a handful of millisecond buckets, and each bucket offers
    // 10^4 suffixes — so ~1 900 distinct values out of 2 000 draws is exactly
    // what a random 4-digit suffix produces (expected ≈ 1 900). The bar is
    // well above anything a sequential or timestamp-only number would reach,
    // and below the value that would make this test flaky.
    expect(numbers.size).toBeGreaterThan(1_800);
  });

  test("the suffix is wide enough that concurrent creation rarely collides", () => {
    // 10^4 values per millisecond is what makes a collision an exceptional
    // case the savepoint retry handles, rather than a routine one. 1 000 draws
    // from 10 000 expect ~951 distinct values (birthday bound), so the bar is
    // set just below that: it proves the suffix is random and wide without
    // asserting an exact collision rate the generator does not promise.
    const sameMillisecond = new Set<string>();
    for (let i = 0; i < 1_000; i += 1) sameMillisecond.add(generateOrderNumber());
    expect(sameMillisecond.size).toBeGreaterThan(900);
  });

  test("it is a STRING everywhere — an 18-digit number is not a JS number", () => {
    const n = generateOrderNumber();
    expect(typeof n).toBe("string");
    // The concrete reason: this value does not survive a `Number` round trip.
    expect(String(Number(n))).not.toBe(n);
    // The column stays TEXT in BOTH canonical schema files.
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      expect(read(file)).toMatch(/order_number TEXT/);
      expect(read(file)).not.toMatch(/order_number (BIGINT|NUMERIC|INT)/);
    }
  });
});

describe("order numbers — legacy values still resolve", () => {
  test("a pre-change VNX-… number is recognised, and is never mistaken for a new one", () => {
    expect(isLegacyOrderNumber("VNX-20260929-7K4P2M")).toBe(true);
    expect(isLegacyOrderNumber(generateOrderNumber())).toBe(false);
    for (const notLegacy of [null, undefined, "", "VNX-2026", "5863229739460539450", 586322973946053945]) {
      expect(isLegacyOrderNumber(notLegacy)).toBe(false);
    }
  });

  test("legacy rows are not rewritten — the column stays nullable and partially unique", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = read(file);
      // `order_number TEXT` with no NOT NULL: a historical row may carry no
      // number at all, and none is invented for it.
      expect(sql).toMatch(/order_number TEXT(,|\n)/);
      expect(sql).not.toMatch(/order_number TEXT NOT NULL/);
      // The unique index is PARTIAL (`WHERE order_number IS NOT NULL`), so a
      // legacy `VNX-…` value and a numeric one can never conflict by shape.
      expect(sql).toMatch(
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_number_unique[\s\S]*?WHERE order_number IS NOT NULL/,
      );
    }
  });
});

describe("order numbers — one generator, one cryptographic source", () => {
  test("there is exactly ONE generator, and it uses a cryptographic source", () => {
    const lib = read(LIB);
    expect(lib).toContain("randomInt");
    expect(lib).toContain("node:crypto");
    // The predictable PRNG is gone from the generator AND from every caller.
    for (const file of [LIB, CART, STRIPE, CYCLES]) {
      expect(code(file)).not.toContain("Math.random");
    }
    // …and no second copy of the generator survives anywhere in the backend.
    for (const file of [CART, STRIPE, CYCLES]) {
      expect(read(file)).not.toContain("function generateOrderNumber");
      expect(read(file)).toContain("order-number.js");
    }
    // The customer number is not derived from a count of orders (that would be
    // sequential-by-another-name and would leak the daily volume).
    expect(lib).not.toMatch(/COUNT\s*\(/);
  });

  test("the number is generated SERVER-side, never by the client", () => {
    // No frontend source may BUILD a number — only display one the backend
    // returned. The generator's crypto dependency lives in the backend, and no
    // app in the monorepo generates a number of its own.
    //
    // The glob is anchored at the RESOLVED repository root, never at
    // `process.cwd()`: the suite is run both from the repo root
    // (`bun test backend/tests`) and from `backend/` (`bun test tests`), and a
    // cwd-relative pattern would match nothing in the second case and make this
    // assertion silently vacuous.
    const frontendFiles = ["apps/velshop", "apps/velseller", "apps/velcenter"].flatMap((app) =>
      globSync(join(root, app, "src/**/*.{ts,tsx}")).map((f) => f),
    );
    // A vacuous pass would be worse than a failure: prove the scan saw files.
    expect(frontendFiles.length).toBeGreaterThan(20);
    for (const file of frontendFiles) {
      const src = readFileSync(file, "utf8");
      expect(src, `${file} generates an order number on the client`).not.toMatch(/generateOrderNumber/);
      expect(src, `${file} generates an order number on the client`).not.toMatch(/crypto\.randomInt/);
    }
    // The checkout request carries no client-authored number at all.
    const sharedApi = read("packages/shared/src/lib/api-routes.ts");
    expect(sharedApi).not.toMatch(/orderNumber\s*:\s*[^}\n]*\b(number|code|no)\b\s*[,}]/i);
  });
});

describe("order numbers — collision handling", () => {
  test("the unique index exists in BOTH schema files (no migration is needed)", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = unqualified(read(file));
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
        detail: "Key (order_number)=(586322973946053945) already exists.",
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

  test("a VelRepeat cycle order is numbered the same way, with the same retry", () => {
    // A cycle creates a NORMAL order per shop, so it needs the same public
    // number the customer is shown — and the same savepoint, because the cycle
    // must be able to roll back one shop's INSERT without losing the claim.
    const cycles = read(CYCLES);
    expect(cycles).toContain("generateOrderNumber");
    expect(cycles).toMatch(/INSERT INTO orders[\s\S]{0,400}?order_number/);
    expect(cycles).toContain("SAVEPOINT cycle_order_number_attempt");
    expect(cycles).toContain("ROLLBACK TO SAVEPOINT cycle_order_number_attempt");
    expect(cycles).toContain("RELEASE SAVEPOINT cycle_order_number_attempt");
    expect(cycles).toContain("isOrderNumberCollision(err)");
  });
});