/**
 * TASK 1 — Product creation: variant ↔ option-value resolution.
 *
 * These unit tests pin the behaviour that makes a created product usable on
 * the storefront: a variant must be linked to the real `product_option_values`
 * rows of its product, and an unknown/id-shaped-later string must NEVER be
 * handed to the database (that used to abort the whole create transaction with
 * `invalid input syntax for type uuid`).
 * Pure helpers only — no database required.
 */
import { describe, expect, test } from "bun:test";
import {
  buildOptionValueIndex,
  normalizeVariantOptions,
  resolveVariantOptionValueIds,
} from "../lib/variant-options.js";

describe("normalizeVariantOptions", () => {
  test("keeps plain non-empty group → value pairs", () => {
    expect(normalizeVariantOptions({ สี: "ดำ", ขนาด: "M" })).toEqual({ สี: "ดำ", ขนาด: "M" });
  });

  test("trims keys and values", () => {
    expect(normalizeVariantOptions({ " สี ": " ดำ " })).toEqual({ สี: "ดำ" });
  });

  test("drops non-string, empty and non-object input", () => {
    expect(normalizeVariantOptions({ สี: "", ขนาด: "   ", ราคา: 19, ok: "ดี" })).toEqual({ ok: "ดี" });
    expect(normalizeVariantOptions(null)).toEqual({});
    expect(normalizeVariantOptions("สี=ดำ")).toEqual({});
    expect(normalizeVariantOptions(["สี", "ดำ"])).toEqual({});
    expect(normalizeVariantOptions(undefined)).toEqual({});
  });
});

describe("buildOptionValueIndex", () => {
  test("indexes inserted option values by group name → value text", () => {
    const index = buildOptionValueIndex([
      { groupName: "สี", valueText: "ดำ", valueId: "11111111-1111-1111-1111-111111111111" },
      { groupName: "สี", valueText: "ขาว", valueId: "22222222-2222-2222-2222-222222222222" },
      { groupName: "ขนาด", valueText: "M", valueId: "33333333-3333-3333-3333-333333333333" },
    ]);
    expect(index["สี"]?.["ดำ"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(index["สี"]?.["ขาว"]).toBe("22222222-2222-2222-2222-222222222222");
    expect(index["ขนาด"]?.["M"]).toBe("33333333-3333-3333-3333-333333333333");
  });

  test("skips incomplete rows", () => {
    const index = buildOptionValueIndex([
      { groupName: "", valueText: "ดำ", valueId: "a" },
      { groupName: "สี", valueText: "", valueId: "b" },
      { groupName: "สี", valueText: "ดำ", valueId: "" },
    ]);
    expect(Object.keys(index)).toEqual([]);
  });
});

describe("resolveVariantOptionValueIds", () => {
  const valueIdsByName = buildOptionValueIndex([
    { groupName: "สี", valueText: "ดำ", valueId: "11111111-1111-1111-1111-111111111111" },
    { groupName: "สี", valueText: "ขาว", valueId: "22222222-2222-2222-2222-222222222222" },
    { groupName: "ขนาด", valueText: "M", valueId: "33333333-3333-3333-3333-333333333333" },
  ]);

  test("resolves a multi-group selection to both option values", () => {
    const r = resolveVariantOptionValueIds({
      variantOptions: { สี: "ดำ", ขนาด: "M" },
      valueIdsByName,
    });
    expect(r.optionValueIds.sort()).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "33333333-3333-3333-3333-333333333333",
    ]);
    expect(r.unresolved).toEqual([]);
  });

  test("reports a selection the product does not have instead of guessing", () => {
    const r = resolveVariantOptionValueIds({
      variantOptions: { สี: "แดง" },
      valueIdsByName,
    });
    expect(r.optionValueIds).toEqual([]);
    expect(r.unresolved).toEqual(["สี = แดง"]);
  });

  test("regression: a stale index-shaped legacy key is never used as an id", () => {
    // The seller form used to send keys like "value-1-0" that did not exist in
    // the transaction map when a group index shifted. That raw string reached
    // the INSERT and aborted the transaction (uuid cast error).
    const r = resolveVariantOptionValueIds({
      variantOptions: {},
      valueIdsByName,
      legacyValueKeys: ["value-1-0"],
      legacyValueIdMap: { "value-0-0": "11111111-1111-1111-1111-111111111111" },
    });
    expect(r.optionValueIds).toEqual([]);
  });

  test("legacy keys still resolve when the map contains them", () => {
    const r = resolveVariantOptionValueIds({
      variantOptions: {},
      valueIdsByName,
      legacyValueKeys: ["value-0-0"],
      legacyValueIdMap: { "value-0-0": "11111111-1111-1111-1111-111111111111" },
    });
    expect(r.optionValueIds).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  test("deduplicates when the same value arrives twice", () => {
    const r = resolveVariantOptionValueIds({
      variantOptions: { สี: "ดำ" },
      valueIdsByName,
      legacyValueKeys: ["value-0-0"],
      legacyValueIdMap: { "value-0-0": "11111111-1111-1111-1111-111111111111" },
    });
    expect(r.optionValueIds).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  test("no selection → no ids, no errors (single default variant)", () => {
    const r = resolveVariantOptionValueIds({ variantOptions: {}, valueIdsByName });
    expect(r.optionValueIds).toEqual([]);
    expect(r.unresolved).toEqual([]);
  });
});
