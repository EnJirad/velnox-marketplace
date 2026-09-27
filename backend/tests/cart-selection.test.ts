/**
 * VelShop cart selection + summary — regression tests.
 *
 * Covers the marketplace cart requirements: per-shop grouping on `shop_id`,
 * item / shop / select-all checkboxes that must always agree with each other,
 * and a summary whose money is derived from the CURRENT selection only.
 *
 * No API is mocked: these are pure functions over the line shape the real
 * `GET /api/customer/cart` returns (see `formatCartRow` in
 * `backend/routes/cart.ts`), so the assertions hold against the production
 * contract rather than a stand-in for it.
 *
 * Selection is view state — nothing here can change a quantity, a stock level,
 * an order or a payment, and the "no mutation" tests below prove the inputs
 * come back untouched.
 */
import { describe, expect, test } from "bun:test";

import {
  CART_SUMMARY_ADJUSTMENTS,
  checkboxChecked,
  computeCartSummary,
  computeShopSummaries,
  deselectLine,
  groupLinesByShop,
  selectLine,
  selectionState,
  toggleAll,
  toggleLine,
  toggleShop,
  type CartSelectionLine,
} from "../../packages/shared/src/lib/cart-selection.ts";

/** A cart line shaped exactly like the backend's `formatCartRow` output. */
function line(overrides: Partial<CartSelectionLine> & { id: string }): CartSelectionLine {
  return { qty: 1, price: 100, shopId: "shop-1", shopName: "Shop A", ...overrides };
}

const SHOP_A = { shopId: "shop-1", shopName: "Shop A" };
const SHOP_B = { shopId: "shop-2", shopName: "Shop B" };

/** Two shops, two lines each — the standard multi-shop cart. */
const twoShops: CartSelectionLine[] = [
  line({ id: "a1", qty: 2, price: 120.5, ...SHOP_A }),
  line({ id: "a2", qty: 1, price: 45, ...SHOP_A }),
  line({ id: "b1", qty: 3, price: 60, ...SHOP_B }),
  line({ id: "b2", qty: 1, price: 250, ...SHOP_B }),
];

const allIds = twoShops.map((l) => l.id);
const setOf = (...ids: string[]) => new Set(ids);

// ─── grouping by shop_id ─────────────────────────────────────────────────────

describe("grouping by shop_id", () => {
  test("separates shops and keeps first-appearance order", () => {
    const groups = groupLinesByShop(twoShops, "Shop");
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.shopId)).toEqual(["shop-1", "shop-2"]);
    expect(groups.map((g) => g.shopName)).toEqual(["Shop A", "Shop B"]);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["a1", "a2"]);
    expect(groups[1]!.lines.map((l) => l.id)).toEqual(["b1", "b2"]);
  });

  test("two different shops sharing a display name stay separate groups", () => {
    const sameName = [
      line({ id: "x1", shopId: "shop-x", shopName: "7-Eleven" }),
      line({ id: "y1", shopId: "shop-y", shopName: "7-Eleven" }),
    ];
    const groups = groupLinesByShop(sameName, "Shop");
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.shopId)).toEqual(["shop-x", "shop-y"]);
  });

  test("lines without a shop id fall back to the shop name instead of one group per row", () => {
    const guest = [
      line({ id: "g1", shopId: null, shopName: "Local Shop" }),
      line({ id: "g2", shopId: null, shopName: "Local Shop" }),
      line({ id: "g3", shopId: null, shopName: null }),
    ];
    const groups = groupLinesByShop(guest, "Default Shop");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.lines.map((l) => l.id)).toEqual(["g1", "g2"]);
    expect(groups[1]!.lines.map((l) => l.id)).toEqual(["g3"]);
    expect(groups[1]!.shopName).toBe("Default Shop");
  });

  test("an empty cart produces no groups", () => {
    expect(groupLinesByShop([], "Shop")).toEqual([]);
  });
});

// ─── select / deselect an item ───────────────────────────────────────────────

describe("select item / deselect item", () => {
  test("selecting adds exactly that line id", () => {
    const next = selectLine(new Set(), "a1");
    expect([...next]).toEqual(["a1"]);
  });

  test("selecting an already-selected line is a no-op that keeps the same reference", () => {
    const selected = setOf("a1");
    expect(selectLine(selected, "a1")).toBe(selected);
    expect(toggleLine(selected, "a1")).not.toBe(selected);
  });

  test("deselecting removes only that line", () => {
    const selected = setOf("a1", "a2");
    const next = deselectLine(selected, "a1");
    expect([...next]).toEqual(["a2"]);
    expect(deselectLine(next, "missing")).toBe(next);
  });

  test("toggling twice returns to the original selection", () => {
    const once = toggleLine(new Set(), "a1");
    const twice = toggleLine(once, "a1");
    expect(twice.size).toBe(0);
  });

  test("selection never mutates the lines it was given", () => {
    const snapshot = JSON.stringify(twoShops);
    const next = setOf("a1", "b1");
    toggleShop(next, twoShops.slice(0, 2));
    toggleAll(next, twoShops);
    computeCartSummary(twoShops, next);
    computeShopSummaries(twoShops, next, "Shop");
    expect(JSON.stringify(twoShops)).toBe(snapshot);
  });
});

// ─── select / deselect a shop ────────────────────────────────────────────────

describe("select shop / deselect shop", () => {
  const shopA = twoShops.filter((l) => l.shopId === "shop-1");
  const shopB = twoShops.filter((l) => l.shopId === "shop-2");

  test("selecting a shop ticks every line of that shop", () => {
    const next = toggleShop(new Set(), shopA);
    expect([...next].sort()).toEqual(["a1", "a2"]);
  });

  test("deselecting a shop unticks every line of that shop", () => {
    const next = toggleShop(setOf(...allIds), shopA);
    expect([...next].sort()).toEqual(["b1", "b2"]);
  });

  test("a partial shop selection becomes fully selected on the next tap", () => {
    const next = toggleShop(setOf("a1"), shopA);
    expect([...next].sort()).toEqual(["a1", "a2"]);
  });

  test("toggling one shop never touches another shop's lines", () => {
    const next = toggleShop(setOf("b1"), shopA);
    expect(next.has("b1")).toBe(true);
    expect(next.has("b2")).toBe(false);
    expect(next.has("a1")).toBe(true);
    expect(next.has("a2")).toBe(true);
  });
});

// ─── select all ──────────────────────────────────────────────────────────────

describe("select all", () => {
  test("selects every line across every shop", () => {
    const next = toggleAll(new Set(), twoShops);
    expect([...next].sort()).toEqual([...allIds].sort());
  });

  test("select-all on a full selection clears everything", () => {
    const next = toggleAll(setOf(...allIds), twoShops);
    expect(next.size).toBe(0);
  });

  test("select-all from a partial selection completes it without dropping anything", () => {
    const next = toggleAll(setOf("b2"), twoShops);
    expect([...next].sort()).toEqual([...allIds].sort());
  });

  test("select-all on an empty cart stays empty", () => {
    expect(toggleAll(new Set(), []).size).toBe(0);
  });
});

// ─── the three checkboxes must always agree ──────────────────────────────────

describe("selection state invariants across item / shop / select-all", () => {
  const shopA = twoShops.filter((l) => l.shopId === "shop-1");

  test("every item of a shop selected makes the shop checkbox 'all'", () => {
    const selected = setOf("a1", "a2");
    expect(selectionState(shopA, selected)).toBe("all");
    expect(selectionState(twoShops, selected)).toBe("some");
  });

  test("deselecting ONE item flips its shop from 'all' to 'some' and the global to 'some'", () => {
    const afterDeselect = toggleLine(setOf(...allIds), "a1");
    expect(selectionState(shopA, afterDeselect)).toBe("some");
    expect(selectionState(twoShops, afterDeselect)).toBe("some");
    expect(checkboxChecked(selectionState(shopA, afterDeselect))).toBe("indeterminate");
  });

  test("deselecting the last selected item of a shop flips it to 'none'", () => {
    const afterDeselect = toggleLine(setOf("a1"), "a1");
    expect(selectionState(shopA, afterDeselect)).toBe("none");
    expect(checkboxChecked(selectionState(shopA, afterDeselect))).toBe(false);
  });

  test("selecting the last missing item of a shop flips it back to 'all'", () => {
    const afterSelect = toggleLine(setOf("a1"), "a2");
    expect(selectionState(shopA, afterSelect)).toBe("all");
    expect(checkboxChecked(selectionState(shopA, afterSelect))).toBe(true);
  });

  test("all items of all shops selected makes the select-all checkbox 'all'", () => {
    const selected = setOf(...allIds);
    expect(selectionState(twoShops, selected)).toBe("all");
    expect(checkboxChecked(selectionState(twoShops, selected))).toBe(true);
  });

  test("one item deselected anywhere makes select-all 'some', never 'all'", () => {
    const afterDeselect = toggleLine(setOf(...allIds), "a1");
    expect(selectionState(twoShops, afterDeselect)).toBe("some");
    expect(checkboxChecked(selectionState(twoShops, afterDeselect))).toBe("indeterminate");
    // …while the shop it did NOT touch stays fully selected, and the shop that
    // lost an item goes partial — the two checkboxes disagree on purpose.
    const shopB = twoShops.filter((l) => l.shopId === "shop-2");
    expect(selectionState(shopA, afterDeselect)).toBe("some");
    expect(selectionState(shopB, afterDeselect)).toBe("all");
  });

  test("nothing selected reads 'none' everywhere", () => {
    expect(selectionState(twoShops, new Set())).toBe("none");
    expect(selectionState(shopA, new Set())).toBe("none");
  });

  test("an empty group is never 'all' (an empty shop is not fully selected)", () => {
    expect(selectionState([], setOf(...allIds))).toBe("none");
  });

  test("state survives the full select-all round trip", () => {
    let selected: ReadonlySet<string> = new Set();
    selected = toggleAll(selected, twoShops);
    expect(selectionState(twoShops, selected)).toBe("all");
    selected = toggleAll(selected, twoShops);
    expect(selectionState(twoShops, selected)).toBe("none");
  });
});

// ─── variants ────────────────────────────────────────────────────────────────

describe("cart items with variants", () => {
  // Two variants of the same product, sold by the same shop: distinct cart
  // rows with distinct cart-item ids.
  const lines: CartSelectionLine[] = [
    line({ id: "black-m", qty: 1, price: 500, ...SHOP_A }),
    line({ id: "black-l", qty: 2, price: 500, ...SHOP_A }),
  ];

  test("two variants of the same product are independent selections", () => {
    let selected: ReadonlySet<string> = new Set();
    selected = toggleLine(selected, lines[0]!.id);
    expect(selectionState(lines, selected)).toBe("some");
    expect(selected.has(lines[1]!.id)).toBe(false);
    selected = toggleLine(selected, lines[1]!.id);
    expect(selectionState(lines, selected)).toBe("all");
  });

  test("each variant line contributes its own quantity to the summary", () => {
    const summary = computeCartSummary(lines, setOf("black-m", "black-l"));
    expect(summary.lineCount).toBe(2);
    expect(summary.itemCount).toBe(3); // 1 + 2
    expect(summary.subtotal).toBe(1500); // 500 + 1000
  });
});

// ─── summary totals ──────────────────────────────────────────────────────────

describe("summary is calculated from the real selection only", () => {
  test("an empty selection summarises to zero, not to the cart total", () => {
    const summary = computeCartSummary(twoShops, new Set());
    expect(summary).toEqual({
      lineCount: 0,
      itemCount: 0,
      subtotal: 0,
      discount: 0,
      shipping: 0,
      total: 0,
    });
  });

  test("an empty cart summarises to zero even if a stale id is selected", () => {
    const summary = computeCartSummary([], setOf("ghost"));
    expect(summary.lineCount).toBe(0);
    expect(summary.subtotal).toBe(0);
    expect(summary.total).toBe(0);
  });

  test("only selected lines are counted", () => {
    const summary = computeCartSummary(twoShops, setOf("a1", "b1"));
    expect(summary.lineCount).toBe(2);
    expect(summary.itemCount).toBe(5); // 2 + 3
    expect(summary.subtotal).toBe(241 + 180); // 2×120.5 + 3×60
    expect(summary.total).toBe(421);
  });

  test("subtotal is Σ qty × unit price, exactly as the order path computes it", () => {
    const summary = computeCartSummary(twoShops, setOf(...allIds));
    expect(summary.subtotal).toBe(2 * 120.5 + 45 + 3 * 60 + 250);
    expect(summary.total).toBe(summary.subtotal);
  });

  test("production applies no discount and no shipping (both default to 0)", () => {
    expect(CART_SUMMARY_ADJUSTMENTS).toEqual({ discount: 0, shipping: 0 });
    const summary = computeCartSummary(twoShops, setOf(...allIds));
    expect(summary.discount).toBe(0);
    expect(summary.shipping).toBe(0);
    expect(summary.total).toBe(summary.subtotal - summary.discount + summary.shipping);
  });

  test("the arithmetic honours real adjustments when they are supplied", () => {
    const summary = computeCartSummary(twoShops, setOf(...allIds), {
      discount: 25.5,
      shipping: 40,
    });
    expect(summary.discount).toBe(25.5);
    expect(summary.shipping).toBe(40);
    expect(summary.total).toBe(Math.round((summary.subtotal - 25.5 + 40) * 100) / 100);
  });

  test("totals are rounded to currency precision", () => {
    const odd = [line({ id: "o1", qty: 3, price: 33.333, ...SHOP_A })];
    const summary = computeCartSummary(odd, setOf("o1"));
    // raw Σ is 99.999 — the summary reports currency precision, not float noise
    expect(3 * 33.333).toBe(99.999);
    expect(summary.subtotal).toBe(100);
    expect(summary.total).toBe(100);
    expect(Number.isInteger(summary.total * 100)).toBe(true);
  });

  test("changing the selection changes the total; nothing else can", () => {
    const full = computeCartSummary(twoShops, setOf(...allIds));
    const withoutOne = computeCartSummary(twoShops, setOf("a1", "a2", "b1"));
    expect(withoutOne.total).toBeLessThan(full.total);
    expect(full.total - withoutOne.total).toBe(250); // exactly the dropped line
  });
});

// ─── per-shop summary (what each shop's order will contain) ──────────────────

describe("per-shop summary in the order sheet", () => {
  test("only selected lines appear, grouped under their own shop", () => {
    const shops = computeShopSummaries(twoShops, setOf("a1", "b2"), "Shop");
    expect(shops.map((s) => s.shopName)).toEqual(["Shop A", "Shop B"]);
    expect(shops[0]!.lines.map((l) => l.id)).toEqual(["a1"]);
    expect(shops[1]!.lines.map((l) => l.id)).toEqual(["b2"]);
    expect(shops[0]!.summary.subtotal).toBe(241);
    expect(shops[1]!.summary.subtotal).toBe(250);
  });

  test("a shop with nothing selected is omitted from the sheet", () => {
    const shops = computeShopSummaries(twoShops, setOf("a1"), "Shop");
    expect(shops).toHaveLength(1);
    expect(shops[0]!.shopId).toBe("shop-1");
  });

  test("nothing selected produces an empty sheet, not a full one", () => {
    expect(computeShopSummaries(twoShops, new Set(), "Shop")).toEqual([]);
  });

  test("shop subtotals add up to the grand total", () => {
    const selected = setOf(...allIds);
    const grand = computeCartSummary(twoShops, selected);
    const perShop = computeShopSummaries(twoShops, selected, "Shop");
    const sum = perShop.reduce((s, shop) => s + shop.summary.total, 0);
    expect(perShop).toHaveLength(2);
    expect(Math.round(sum * 100) / 100).toBe(grand.total);
  });
});
