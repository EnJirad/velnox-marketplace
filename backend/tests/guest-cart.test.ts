import { describe, it, expect } from "bun:test";
import {
  GUEST_CART_KEY,
  parseGuestCart,
  readGuestCart,
  writeGuestCart,
  clearGuestCart,
  type GuestCartRecord,
  type StorageLike,
} from "../../packages/shared/src/lib/guest-cart.ts";

/**
 * The guest cart is user-editable storage: it can be corrupted, stale, or
 * written by an older build. These tests pin the two things that would cost a
 * customer their cart or the shop an oversell:
 *   • a bad entry is DROPPED, never repaired into something unexpected
 *   • quantity can never exceed the stock recorded alongside it
 */

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()],
  } satisfies StorageLike & { keys: () => string[] };
}

const valid: GuestCartRecord = {
  productId: "p-1",
  variantId: null,
  name: "หูฟัง",
  unit: "ชิ้น",
  price: 599,
  qty: 2,
  stock: 10,
};

describe("guest cart storage", () => {
  it("treats absent, malformed and non-array payloads as empty", () => {
    expect(parseGuestCart(null)).toEqual([]);
    expect(parseGuestCart("")).toEqual([]);
    expect(parseGuestCart("not json at all")).toEqual([]);
    expect(parseGuestCart('{"productId":"p-1"}')).toEqual([]);
    expect(parseGuestCart("null")).toEqual([]);
  });

  it("drops entries that could not be re-ordered safely", () => {
    const raw = JSON.stringify([
      valid,
      { ...valid, productId: "" }, // no product
      { ...valid, productId: undefined },
      { ...valid, qty: 0 }, // nothing to buy
      { ...valid, qty: -3 },
      { ...valid, price: -1 }, // impossible price
      { ...valid, price: "free" },
      null,
      "junk",
    ]);
    const out = parseGuestCart(raw);
    expect(out).toHaveLength(1);
    expect(out[0].productId).toBe("p-1");
  });

  it("clamps quantity to the stock recorded with the line", () => {
    // A line saved when 10 were in stock must not still ask for 10 later.
    const out = parseGuestCart(JSON.stringify([{ ...valid, qty: 10, stock: 3 }]));
    expect(out[0].qty).toBe(3);
  });

  it("drops a line whose recorded stock is zero", () => {
    expect(parseGuestCart(JSON.stringify([{ ...valid, stock: 0 }]))).toEqual([]);
  });

  it("keeps the quantity when stock was never recorded", () => {
    // The server is the final authority on stock; do not silently zero the cart.
    const out = parseGuestCart(JSON.stringify([{ ...valid, stock: undefined, qty: 4 }]));
    expect(out[0].qty).toBe(4);
  });

  it("fills display defaults instead of rendering undefined", () => {
    const out = parseGuestCart(JSON.stringify([{ productId: "p-2", price: 10, qty: 1 }]));
    expect(out[0].name).toBe("สินค้า");
    expect(out[0].unit).toBe("ชิ้น");
    expect(out[0].variantId).toBeNull();
  });

  it("normalises an empty-string variantId to null", () => {
    const out = parseGuestCart(JSON.stringify([{ ...valid, variantId: "" }]));
    expect(out[0].variantId).toBeNull();
  });

  it("round-trips through storage", () => {
    const storage = fakeStorage();
    writeGuestCart(storage, [valid]);
    expect(readGuestCart(storage)).toEqual([valid]);
  });

  it("removes the key instead of storing an empty array", () => {
    const storage = fakeStorage({ [GUEST_CART_KEY]: JSON.stringify([valid]) });
    writeGuestCart(storage, []);
    expect(storage.keys()).not.toContain(GUEST_CART_KEY);
    expect(readGuestCart(storage)).toEqual([]);
  });

  it("clears the stored cart", () => {
    const storage = fakeStorage({ [GUEST_CART_KEY]: JSON.stringify([valid]) });
    clearGuestCart(storage);
    expect(readGuestCart(storage)).toEqual([]);
  });

  it("survives a storage that throws (private mode / locked-down WebView)", () => {
    const throwing: StorageLike = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(readGuestCart(throwing)).toEqual([]);
    expect(() => writeGuestCart(throwing, [valid])).not.toThrow();
    expect(() => clearGuestCart(throwing)).not.toThrow();
  });

  it("treats missing storage as empty rather than crashing the app", () => {
    expect(readGuestCart(null)).toEqual([]);
    expect(readGuestCart(undefined)).toEqual([]);
    expect(() => writeGuestCart(null, [valid])).not.toThrow();
  });
});
