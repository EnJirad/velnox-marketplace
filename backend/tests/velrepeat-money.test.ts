/**
 * VelRepeat V2 — canonical money arithmetic (owner decision G2).
 * ═══════════════════════════════════════════════════════════════════════════
 * Pure unit tests: no database, so these run in every environment.
 *
 * G2 requires FULL precision through the pricing pipeline and EXACTLY ONE
 * rounding to 2 decimal places at the final price. These tests are what hold
 * that line, and they are deliberately written against exact values rather than
 * "close enough" tolerances — a money test that allows epsilon is a money test
 * that has already admitted a float.
 */
import { describe, expect, test } from "bun:test";

import {
  MONEY_DECIMALS,
  add,
  compare,
  divide,
  formatScaled,
  isNegative,
  isZero,
  makeRational,
  multiply,
  multiplyByQuantity,
  parseDecimal,
  parseDecimalInput,
  roundHalfUp,
  subtract,
  toExactDecimalString,
  toMoneyString,
  ZERO,
} from "../lib/money.js";

describe("money — parsing is exact and rejects float shapes", () => {
  test("a decimal literal becomes an exact fraction", () => {
    expect(parseDecimal("0.07")).toEqual({ num: 7n, den: 100n });
    expect(parseDecimal("1000")).toEqual({ num: 1000n, den: 1n });
    expect(parseDecimal("-19.99")).toEqual({ num: -1999n, den: 100n });
  });

  test("trailing zeros are insignificant to the value but not lost", () => {
    expect(compare(parseDecimal("1.50"), parseDecimal("1.5"))).toBe(0);
    expect(toMoneyString(parseDecimal("1.5"))).toBe("1.50");
  });

  test("exponent, NaN, Infinity, hex and empty input are all refused", () => {
    for (const bad of ["1e3", "NaN", "Infinity", "-Infinity", "", "   ", "0x10", "1.2.3", "1,000"]) {
      expect(() => parseDecimal(bad)).toThrow();
    }
  });

  test("a JSON number is converted once at the boundary, then stays exact", () => {
    // 0.1 has no exact binary representation; the boundary stringifies it once
    // and everything after that is integer arithmetic.
    expect(toMoneyString(parseDecimalInput(0.1))).toBe("0.10");
    expect(parseDecimalInput(0.1)).toEqual({ num: 1n, den: 10n });
    expect(compare(parseDecimalInput(19.99), parseDecimal("19.99"))).toBe(0);
  });

  test("non-finite numbers and unsupported types are refused", () => {
    expect(() => parseDecimalInput(Number.NaN)).toThrow();
    expect(() => parseDecimalInput(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => parseDecimalInput(null)).toThrow();
    expect(() => parseDecimalInput({})).toThrow();
  });
});

describe("money — exact arithmetic", () => {
  test("the owner's G1 worked example is exact, not approximately right", () => {
    // 1,000 → 7% off → 930 → 5% off → 883.50
    const afterSeven = multiply(parseDecimal("1000"), subtract({ num: 1n, den: 1n }, parseDecimal("0.07")));
    expect(afterSeven).toEqual({ num: 930n, den: 1n });
    const afterFive = multiply(afterSeven, subtract({ num: 1n, den: 1n }, parseDecimal("0.05")));
    expect(afterFive).toEqual({ num: 1767n, den: 2n });
    expect(toMoneyString(afterFive)).toBe("883.50");
  });

  test("binary floating point would get these wrong; exact arithmetic does not", () => {
    // Real THB-shaped quantities that IEEE-754 cannot represent exactly. These
    // are not contrived: each is a price × an integer quantity.
    expect(999.99 * 0.93).not.toBe(929.99); // 929.9907000000001
    expect(2450.35 * 3).not.toBe(7351.05); // 7351.049999999999
    expect(1.15 * 3).not.toBe(3.45); // 3.4499999999999997

    // The same operations, exactly:
    expect(toMoneyString(multiply(parseDecimal("999.99"), parseDecimal("0.93")))).toBe("929.99");
    expect(toMoneyString(multiplyByQuantity(parseDecimal("2450.35"), 3))).toBe("7351.05");
    expect(toMoneyString(multiplyByQuantity(parseDecimal("1.15"), 3))).toBe("3.45");
  });

  test("no value is lost between operations", () => {
    // 1/3 keeps repeating in decimal but must never be approximated mid-chain.
    const third = divide(parseDecimal("1"), parseDecimal("3"));
    expect(third.num * 3n).toBe(third.den);
    expect(toMoneyString(third)).toBe("0.33");
  });

  test("zero and identity behave", () => {
    expect(isZero(ZERO)).toBe(true);
    expect(toMoneyString(multiply(ZERO, parseDecimal("0.5")))).toBe("0.00");
    expect(compare(parseDecimal("5"), parseDecimal("5"))).toBe(0);
    expect(isNegative(parseDecimal("-0.01"))).toBe(true);
  });

  test("add, subtract and multiplyByQuantity are exact", () => {
    expect(toMoneyString(add(parseDecimal("0.10"), parseDecimal("0.20")))).toBe("0.30");
    expect(toMoneyString(subtract(parseDecimal("1000"), parseDecimal("116.50")))).toBe("883.50");
    expect(toMoneyString(multiplyByQuantity(parseDecimal("19.99"), 3))).toBe("59.97");
  });

  test("quantity must be a non-negative integer — it is an INTEGER column", () => {
    expect(() => multiplyByQuantity(parseDecimal("1"), 1.5)).toThrow();
    expect(() => multiplyByQuantity(parseDecimal("1"), -1)).toThrow();
  });

  test("division by zero is refused rather than producing Infinity", () => {
    expect(() => divide(parseDecimal("1"), ZERO)).toThrow();
    expect(() => makeRational(1n, 0n)).toThrow();
  });
});

describe("money — G2: exactly one rounding, half-up, at 2 decimals", () => {
  test("half-up at the midpoint, in both directions", () => {
    expect(toMoneyString(parseDecimal("0.125"))).toBe("0.13"); // half up
    expect(toMoneyString(parseDecimal("0.135"))).toBe("0.14"); // half up
    expect(toMoneyString(parseDecimal("0.124"))).toBe("0.12"); // below midpoint
  });

  test("negative amounts round away from zero on a tie, like round(numeric)", () => {
    expect(toMoneyString(parseDecimal("-0.125"))).toBe("-0.13");
    expect(toMoneyString(parseDecimal("-0.126"))).toBe("-0.13");
    expect(toMoneyString(parseDecimal("-0.124"))).toBe("-0.12");
  });

  test("the sign is never lost or flipped, and no negative zero appears", () => {
    for (const [input, want] of [
      ["-0.01", "-0.01"],
      ["-1.005", "-1.01"],
      ["-1000.00", "-1000.00"],
      // Rounds to zero: "0.00", never "-0.00" (which is a formatting artefact,
      // not a monetary value).
      ["-0.001", "0.00"],
    ] as const) {
      expect(toMoneyString(parseDecimal(input))).toBe(want);
    }
    expect(toMoneyString(parseDecimal("-0.001"))).not.toBe("-0.00");
  });

  test("output always carries exactly 2 decimals", () => {
    expect(MONEY_DECIMALS).toBe(2);
    for (const input of ["0", "1", "1.5", "1.555", "12345.6789", "1000"]) {
      expect(toMoneyString(parseDecimal(input))).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  test("roundHalfUp and formatScaled agree at every supported scale", () => {
    expect(formatScaled(roundHalfUp(parseDecimal("883.5")), 2)).toBe("883.50");
    expect(formatScaled(roundHalfUp(parseDecimal("1.5"), 0), 0)).toBe("2");
    expect(formatScaled(roundHalfUp(parseDecimal("-1.5"), 0), 0)).toBe("-2");
  });

  test("an invalid scale is refused", () => {
    expect(() => roundHalfUp(parseDecimal("1"), -1)).toThrow();
    expect(() => roundHalfUp(parseDecimal("1"), 1.5)).toThrow();
    expect(() => formatScaled(1n, -1)).toThrow();
  });
});

describe("money — exact expansion proves no intermediate rounding", () => {
  test("a value needing six decimals keeps all six", () => {
    // 1000.01 × 0.8766 = 876.608766 — exactly representable, not rounded to 876.61.
    expect(toExactDecimalString(multiply(parseDecimal("1000.01"), parseDecimal("0.8766")))).toBe(
      "876.608766",
    );
  });

  test("the full sequential chain keeps every digit", () => {
    const priced = multiply(
      multiply(parseDecimal("1000.01"), parseDecimal("0.8766")),
      parseDecimal("0.95"),
    );
    expect(toExactDecimalString(priced)).toBe("832.7783277");
    // And only at the very end does it become money.
    expect(toMoneyString(priced)).toBe("832.78");
  });

  test("a genuinely non-terminating expansion is refused, never truncated", () => {
    expect(() => toExactDecimalString(divide(parseDecimal("1"), parseDecimal("7")))).toThrow();
  });
});
