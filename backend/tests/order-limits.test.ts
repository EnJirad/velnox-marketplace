/**
 * Order size limits — the 100-unit rule (product decision).
 *
 * Pure functions only: no DB, no network. The checkout route and the cart use
 * the SAME module, so the UI and the authoritative check cannot disagree.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_LINE_UNITS,
  MAX_ORDER_UNITS,
  checkLineQuantity,
  checkOrderUnits,
  totalUnits,
} from "../lib/order-limits.js";

describe("the cap itself", () => {
  test("100 units per order / per line", () => {
    expect(MAX_ORDER_UNITS).toBe(100);
    expect(MAX_LINE_UNITS).toBe(100);
  });
});

describe("checkLineQuantity", () => {
  test("accepts 1..100", () => {
    expect(checkLineQuantity(1)).toBeNull();
    expect(checkLineQuantity(50)).toBeNull();
    expect(checkLineQuantity(100)).toBeNull();
  });

  test("refuses 101 on a single line", () => {
    const failure = checkLineQuantity(101, "เสื้อยืด");
    expect(failure?.code).toBe("LINE_LIMIT_EXCEEDED");
    expect(failure?.limit).toBe(100);
    expect(failure?.message).toContain("100");
  });

  test("refuses zero, negative, fractional and non-numbers", () => {
    for (const bad of [0, -1, 1.5, "3", null, undefined, NaN]) {
      expect(checkLineQuantity(bad as unknown)?.code).toBe("INVALID_QUANTITY");
    }
  });
});

describe("checkOrderUnits — total across ALL shops", () => {
  test("exactly 100 units across several shops is allowed", () => {
    expect(
      checkOrderUnits([
        { quantity: 40 },
        { quantity: 30 },
        { quantity: 30 },
      ]),
    ).toBeNull();
  });

  test("101 units is refused with the exact overflow count", () => {
    const failure = checkOrderUnits([{ quantity: 60 }, { quantity: 41 }]);
    expect(failure?.code).toBe("ORDER_LIMIT_EXCEEDED");
    expect(failure?.requested).toBe(101);
    expect(failure?.limit).toBe(100);
    expect(failure?.message).toContain("1");
  });

  test("many small lines still hit the same total cap", () => {
    const lines = Array.from({ length: 40 }, () => ({ quantity: 3 }));
    const failure = checkOrderUnits(lines);
    expect(totalUnits(lines)).toBe(120);
    expect(failure?.code).toBe("ORDER_LIMIT_EXCEEDED");
  });

  test("an empty selection is refused rather than ordering nothing", () => {
    expect(checkOrderUnits([])?.code).toBe("INVALID_QUANTITY");
  });

  test("a single over-limit line fails fast before the total is computed", () => {
    const failure = checkOrderUnits([{ quantity: 101, product_name: "กระเป๋า" }]);
    expect(failure?.code).toBe("LINE_LIMIT_EXCEEDED");
  });
});

describe("totalUnits", () => {
  test("sums and ignores junk quantities", () => {
    expect(totalUnits([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
    expect(totalUnits([{ quantity: 2 }, { quantity: Number.NaN }])).toBe(2);
  });
});
