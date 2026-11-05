/**
 * WHOLESALE PACK PRICING — the rule, pinned.
 *
 * Runs with NO database: every case here is pure pricing arithmetic plus the
 * route-level refusals that happen before any query.
 *
 * The property that matters most is stated once and tested everywhere:
 *
 *     wholesale line: subtotal = packs × price_per_pack   (exact)
 *                     subtotal = round(unit_price × units) (same money)
 *     retail line:    subtotal = price × units            (exact)
 *
 * so `order_items.subtotal` is always the amount the customer pays for the line,
 * whatever the 2-decimal `order_items.price` column can hold.
 */
import { describe, expect, test } from "bun:test";
import {
  cheapestUnitPrice,
  moneyString,
  priceLine,
  wholesaleFingerprintPart,
  type WholesaleTier,
} from "../lib/wholesale.js";
import { multiplyByQuantity, parseDecimal, toMoneyString } from "../lib/money.js";

const tier = (packSize: number, minPacks: number, pricePerPack: string): WholesaleTier => ({
  packSize,
  minPacks,
  pricePerPack,
});

describe("retail-only products are untouched", () => {
  test("no tiers → retail price per unit, exact line total", () => {
    const line = priceLine(7, "19.99", [], true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_no_tiers");
    expect(line.unitPriceMoney).toBe("19.99");
    expect(line.lineTotalMoney).toBe("139.93");
    expect(line.packSize).toBeNull();
  });

  test("a customer without a verified business account always pays retail", () => {
    const tiers = [tier(6, 1, "300.00")];
    const line = priceLine(12, "60.00", tiers, false);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_not_verified");
    expect(line.lineTotalMoney).toBe("720.00");
  });
});

describe("the pack price is exact", () => {
  test("one pack of 3 at 100.00 charges 100.00, not 33.33 × 3", () => {
    const line = priceLine(3, "40.00", [tier(3, 1, "100.00")], true);
    expect(line.wholesale).toBe(true);
    expect(line.packs).toBe(1);
    expect(line.packSize).toBe(3);
    expect(line.lineTotalMoney).toBe("100.00");
    // The 2-dp display column cannot hold 33.333…; it rounds, and the line
    // amount is still the exact pack price.
    expect(line.unitPriceMoney).toBe("33.33");
    expect(toMoneyString(line.lineTotal)).toBe("100.00");
  });

  test("the enforceable identity holds: subtotal = units × unit_price (rounded once)", () => {
    const line = priceLine(9, "40.00", [tier(3, 1, "100.00")], true);
    const fromUnits = multiplyByQuantity(line.unitPrice, line.units);
    expect(moneyString(fromUnits)).toBe(line.lineTotalMoney);
    expect(line.lineTotalMoney).toBe("300.00");
  });

  test("decimal precision survives: 99.99 per pack of 7", () => {
    const line = priceLine(21, "20.00", [tier(7, 1, "99.99")], true);
    expect(line.packs).toBe(3);
    expect(line.lineTotalMoney).toBe("299.97");
  });
});

describe("tier boundaries", () => {
  const tiers = [tier(1, 1, "500.00"), tier(1, 5, "450.00"), tier(1, 10, "400.00")];
  // pack size 1 is invalid (packs must contain >= 2 units) — the engine refuses
  // to price it wholesale, so the tier table below uses packs of 10 units.
  const packs10 = [tier(10, 1, "500.00"), tier(10, 5, "450.00"), tier(10, 10, "400.00")];

  test("a pack size below 2 never prices wholesale", () => {
    const line = priceLine(5, "60.00", tiers, true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_no_tiers");
  });

  for (const [packs, expected] of [
    [1, "500.00"],
    [4, "500.00"],
    [5, "450.00"],
    [9, "450.00"],
    [10, "400.00"],
    [25, "400.00"],
  ] as Array<[number, string]>) {
    test(`${packs} packs uses the tier whose min_packs = ${expected === "500.00" ? 1 : expected === "450.00" ? 5 : 10}`, () => {
      const line = priceLine(packs * 10, "60.00", packs10, true);
      expect(line.wholesale).toBe(true);
      expect(line.packs).toBe(packs);
      expect(line.tierPricePerPack).toBe(expected);
      expect(line.lineTotalMoney).toBe(
        toMoneyString(multiplyByQuantity(parseDecimal(expected), packs)),
      );
    });
  }

  test("one unit below the minimum stays retail", () => {
    const line = priceLine(39, "60.00", [tier(10, 4, "500.00")], true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_partial_pack");
  });

  test("complete packs below the seller minimum stay retail", () => {
    const line = priceLine(10, "60.00", [tier(10, 2, "500.00")], true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_below_minimum");
    expect(line.lineTotalMoney).toBe("600.00");
  });
});

describe("partial packs are retail (approved rule A)", () => {
  test("11 units of a 5-pack product is priced retail", () => {
    const line = priceLine(11, "20.00", [tier(5, 1, "90.00")], true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_partial_pack");
    expect(line.lineTotalMoney).toBe("220.00");
  });
});

describe("fingerprint part", () => {
  test("retail lines contribute nothing", () => {
    expect(wholesaleFingerprintPart(priceLine(3, "10.00", [], true))).toBe("");
  });

  test("a tier edit changes the fingerprint even at an unchanged rounded unit price", () => {
    const a = priceLine(3, "40.00", [tier(3, 1, "100.00")], true);
    const b = priceLine(3, "40.00", [tier(3, 1, "100.02")], true);
    expect(a.unitPriceMoney).toBe("33.33");
    expect(b.unitPriceMoney).toBe("33.34");
    expect(wholesaleFingerprintPart(a)).not.toBe(wholesaleFingerprintPart(b));
    expect(wholesaleFingerprintPart(a)).toBe("3|100.00|1");
  });
});

describe("cheapest unit price for the storefront", () => {
  test("returns the best pack when it is cheaper than retail", () => {
    const best = cheapestUnitPrice([tier(6, 1, "300.00"), tier(6, 10, "240.00")], "60.00");
    expect(best).not.toBeNull();
    expect(best!.perUnit).toEqual(parseDecimal("40"));
    expect(best!.packSize).toBe(6);
  });

  test("is null when wholesale is not cheaper than retail", () => {
    expect(cheapestUnitPrice([tier(6, 1, "600.00")], "60.00")).toBeNull();
    expect(cheapestUnitPrice([], "60.00")).toBeNull();
  });
});

describe("invalid input is refused, not guessed", () => {
  test("non-integer and non-positive quantities", () => {
    expect(() => priceLine(0, "10.00", [], true)).toThrow();
    expect(() => priceLine(1.5 as unknown as number, "10.00", [], true)).toThrow();
    expect(() => priceLine(-3 as unknown as number, "10.00", [], true)).toThrow();
  });

  test("mixed pack sizes in one tier list is treated as corrupt config (retail)", () => {
    const line = priceLine(12, "50.00", [tier(6, 1, "300.00"), tier(4, 2, "200.00")], true);
    expect(line.wholesale).toBe(false);
    expect(line.reason).toBe("retail_no_tiers");
  });
});
