/**
 * WHOLESALE TIER VALIDATION — the seller's input contract, pinned.
 *
 * Runs with no database: `parseWholesaleTiers` is pure, and every rule the
 * route enforces lives here so a route test and a UI cannot disagree about what
 * "valid" means.
 *
 * The property that matters: an INVALID tier list is refused whole. There is no
 * clamping, no "fix the pack size for you", and no partially-saved table — a
 * buyer is either priced against the previous list or the new one.
 */
import { describe, expect, test } from "bun:test";
import { parseWholesaleTiers } from "../routes/wholesale.js";
import { BUSINESS_EVIDENCE_PURPOSES } from "../routes/business-verification.js";

const P = "11111111-1111-4111-8111-111111111111";
const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";

const variants = new Set([V1, V2]);
const tier = (over: Record<string, unknown> = {}) => ({
  variantId: null,
  packSize: 6,
  minPacks: 1,
  pricePerPack: "300.00",
  ...over,
});

describe("valid tier lists", () => {
  test("an empty list means retail only", () => {
    const res = take(parseTiers([], [V1]));
    expect(res.ok).toBe(true);
    expect(res.tiers).toEqual([]);
  });

  test("a single tier is normalised to 2 decimals", () => {
    const res = take(parseTiers([tier({ pricePerPack: "99.9" })], [V1]));
    expect(res.ok).toBe(true);
    expect(res.tiers).toEqual([{ variantId: null, packSize: 6, minPacks: 1, pricePerPack: "99.90" }]);
  });

  test("multiple tiers of one scope share the pack size", () => {
    const res = take(
      parseTiers([tier({ minPacks: 1, pricePerPack: "300" }), tier({ minPacks: 10, pricePerPack: "250" })], [V1]),
    );
    expect(res.ok).toBe(true);
    expect(res.tiers.map((t) => t.minPacks)).toEqual([1, 10]);
  });

  test("a product tier list and a variant tier list may use different pack sizes", () => {
    // Scope is (product, variant): the product's own packs and variant A's packs
    // are different scopes, so they do not have to agree.
    const res = take(
      parseTiers([tier({ variantId: null, packSize: 6 }), tier({ variantId: V1, packSize: 12 })], [V1]),
    );
    expect(res.ok).toBe(true);
    expect(res.tiers.map((t) => t.packSize)).toEqual([6, 12]);
  });
});

describe("invalid tier lists are refused whole", () => {
  test("pack size below 2", () => {
    expect(take(parseTiers([tier({ packSize: 1 })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ packSize: 0 })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ packSize: 2.5 })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ packSize: 2000 })], [V1])).ok).toBe(false);
  });

  test("minimum packs below 1", () => {
    expect(take(parseTiers([tier({ minPacks: 0 })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ minPacks: -3 })], [V1])).ok).toBe(false);
  });

  test("a price of zero or below is not an offer", () => {
    expect(take(parseTiers([tier({ pricePerPack: "0" })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ pricePerPack: "-10.00" })], [V1])).ok).toBe(false);
    expect(take(parseTiers([tier({ pricePerPack: "free" })], [V1])).ok).toBe(false);
  });

  test("more than 2 decimals of money is refused, not rounded", () => {
    expect(take(parseTiers([tier({ pricePerPack: "99.999" })], [V1])).ok).toBe(false);
  });

  test("two different pack sizes in ONE scope", () => {
    const res = take(parseTiers([tier({ packSize: 6 }), tier({ packSize: 12, minPacks: 5 })], [V1]));
    expect(res.ok).toBe(false);
    expect(res.message).toContain("one pack size");
  });

  test("two tiers claiming the same min_packs in one scope", () => {
    const res = take(parseTiers([tier({ minPacks: 5 }), tier({ minPacks: 5, pricePerPack: "280" })], [V1]));
    expect(res.ok).toBe(false);
    expect(res.message).toContain("minPacks = 5");
  });

  test("a variant that does not belong to this product", () => {
    const res = take(parseTiers([tier({ variantId: "44444444-4444-4444-8444-444444444444" })], [V1]));
    expect(res.ok).toBe(false);
    expect(res.message).toContain("does not belong");
  });

  test("more than 20 tiers", () => {
    const many = Array.from({ length: 21 }, (_, i) => tier({ minPacks: i + 1 }));
    expect(take(parseTiers(many, [V1])).ok).toBe(false);
  });

  test("a non-array payload", () => {
    expect(take(parseTiers("nope" as unknown, [V1])).ok).toBe(false);
  });

  test("an entry that is not an object", () => {
    expect(take(parseTiers([42], [V1])).ok).toBe(false);
  });
});

describe("business evidence purposes stay in sync with the gate", () => {
  test("the four required purposes are the documented ones", () => {
    expect([...BUSINESS_EVIDENCE_PURPOSES]).toEqual([
      "business_registration",
      "storefront_photo",
      "business_id",
      "bank_book",
    ]);
  });
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

function parseTiers(raw: unknown, variantIds: string[]) {
  void P;
  return parseWholesaleTiers(raw, new Set(variantIds));
}

function take(result: ReturnType<typeof parseWholesaleTiers>) {
  return result.ok ? { ok: true as const, tiers: result.tiers } : { ok: false as const, message: result.message };
}
