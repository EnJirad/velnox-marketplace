/**
 * Cart response shape — the bug behind "the cart reloads on every +/-".
 *
 * Every cart route answers `{ items: [...] }`. The provider typed that as a
 * bare array, so `items.map(...)` threw a TypeError inside the `.then()`, the
 * `.catch()` fired `reload()`, and the cart page swapped its whole list for a
 * skeleton — on every single quantity change.
 *
 * These tests pin both halves: the unwrapping, and the wiring that must not
 * fall back to a refetch.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cartItemsFromResponse } from "../../apps/velshop/src/lib/cart-response.js";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const CART = "apps/velshop/src/lib/cart.tsx";
const ROUTES = "backend/routes/cart.ts";

describe("cartItemsFromResponse", () => {
  test("unwraps the envelope every cart route actually returns", () => {
    expect(cartItemsFromResponse({ items: [{ id: "a" }] })).toEqual([{ id: "a" }]);
    expect(cartItemsFromResponse({ items: [] })).toEqual([]);
  });

  test("still accepts a bare array (older callers)", () => {
    expect(cartItemsFromResponse([{ id: "a" }])).toEqual([{ id: "a" }]);
  });

  test("returns null — never throws — for anything else", () => {
    expect(cartItemsFromResponse(null)).toBeNull();
    expect(cartItemsFromResponse(undefined)).toBeNull();
    expect(cartItemsFromResponse({})).toBeNull();
    expect(cartItemsFromResponse({ removed: true })).toBeNull();
    expect(cartItemsFromResponse("nope")).toBeNull();
    expect(cartItemsFromResponse({ items: "nope" })).toBeNull();
  });
});

describe("the API really answers with the envelope", () => {
  test("all four cart routes return `{ items }`", () => {
    const src = read(ROUTES);
    const envelopes = src.split("res.json({ success: true, data: { items } })").length - 1;
    // GET cart, add, update, remove
    expect(envelopes).toBeGreaterThanOrEqual(4);
  });
});

describe("the provider must not refetch on a successful mutation", () => {
  const cart = read(CART);

  test("it unwraps through the shared helper instead of mapping the payload", () => {
    expect(cart).toContain('import { cartItemsFromResponse } from "@/lib/cart-response"');
    expect(cart).toContain("const items = cartItemsFromResponse(payload);");
    // The old shape assumption must be gone: nothing maps the raw payload.
    expect(cart).not.toContain("payload.map(");
    // …and the response is never assumed to be an array before unwrapping.
    expect(cart).not.toContain("Array.isArray(payload) ? payload");
  });

  test("applyServer never triggers a reload", () => {
    const apply = cart.slice(
      cart.indexOf("const applyServer = useCallback("),
      cart.indexOf("/** Reserve the next request slot"),
    );
    expect(apply.length).toBeGreaterThan(0);
    expect(apply).not.toContain("reload(");
    expect(apply).toContain("if (items === null) return;");
  });

  test("every mutation applies the server cart, and only an ERROR reloads", () => {
    // add / setQty / remove each end with `.then(apply…).catch(… reload())`
    const mutations = cart.slice(cart.indexOf("const add = useCallback("));
    const thenApply = mutations.split(".then(apply").length - 1;
    expect(thenApply).toBeGreaterThanOrEqual(3);
    // A reload must never sit on the success path.
    expect(mutations).not.toMatch(/\.then\(reload\)/);
  });

  test("rapid clicks cannot be overwritten by an older response", () => {
    // A per-line sequence reserves the slot before the request is sent.
    expect(cart).toContain("lineRequestSeq");
    expect(cart).toContain("const beginLineRequest = useCallback(");
    expect(cart).toContain("if (lineRequestSeq.current.get(key) !== seq) return;");
  });
});
