/**
 * Cart response shape — one place that knows what the API returns.
 *
 * Every cart route answers `{ success: true, data: { items: [...] } }`:
 *
 *   GET    /api/customer/cart
 *   POST   /api/customer/cart/add
 *   PUT    /api/customer/cart/item/:cartItemId
 *   DELETE /api/customer/cart/item/:cartItemId
 *
 * The provider used to type this as a bare array and call `items.map(...)`.
 * That threw a TypeError on the envelope, and the caller's `.catch()` turned
 * the throw into `reload()` — a full cart refetch on every +/- press, which is
 * why the cart appeared to "reload every time" someone changed a quantity.
 *
 * Keeping the unwrapping here (pure, no React) makes the shape testable.
 */

/** The `items` array from a cart response, or null when it carries none. */
export function cartItemsFromResponse(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const items = (payload as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return null;
}
