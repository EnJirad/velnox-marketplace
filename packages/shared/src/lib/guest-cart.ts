/**
 * Guest cart persistence.
 *
 * A visitor who is not signed in has no server cart, so their selections used
 * to live only in React state: a refresh emptied the cart, and the round-trip
 * through `/auth` that checkout forces replaced it with the (empty) server cart
 * without telling them. This module owns the storage half of the fix:
 *
 *   • the on-disk shape is validated on read, never trusted
 *   • a corrupt or hand-edited entry is dropped instead of crashing the app
 *   • quantity is clamped to the stock we recorded, so a stale stored line
 *     cannot ask for more units than the product had
 *
 * It is deliberately React-free and takes an injected `StorageLike`, so the
 * rules can be tested without a DOM (see `backend/tests/guest-cart.test.ts`).
 */

/** Versioned so a future shape change can migrate instead of mis-reading old data. */
export const GUEST_CART_KEY = "velnox.guest-cart.v1";

/** The subset of a cart line that is worth persisting for a guest. */
export interface GuestCartRecord {
  productId: string;
  variantId: string | null;
  name: string;
  unit: string;
  price: number;
  qty: number;
  stock: number;
  imageUrl?: string;
  shopId?: string | null;
}

/** The two methods we need from `localStorage`; narrowed for injectability. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Turn an arbitrary parsed value into the records we are willing to use.
 * Anything that fails a rule is dropped rather than repaired — a half-trusted
 * cart is worse than a smaller one.
 */
export function parseGuestCart(raw: string | null): GuestCartRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: GuestCartRecord[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Partial<GuestCartRecord>;

    if (typeof e.productId !== "string" || e.productId.length === 0) continue;
    const price = Number(e.price);
    if (!Number.isFinite(price) || price < 0) continue;
    const qty = Math.floor(Number(e.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const stock = Number(e.stock);

    // A stale line must never exceed the stock recorded with it. When stock was
    // never recorded, keep the quantity and let the server reject it on merge.
    const cappedQty = Number.isFinite(stock) && stock >= 0 ? Math.min(qty, Math.floor(stock)) : qty;
    if (cappedQty <= 0) continue;

    out.push({
      productId: e.productId,
      variantId: typeof e.variantId === "string" && e.variantId.length > 0 ? e.variantId : null,
      name: typeof e.name === "string" && e.name.length > 0 ? e.name : "สินค้า",
      unit: typeof e.unit === "string" && e.unit.length > 0 ? e.unit : "ชิ้น",
      price,
      qty: cappedQty,
      stock: Number.isFinite(stock) ? stock : cappedQty,
      ...(typeof e.imageUrl === "string" && e.imageUrl.length > 0 ? { imageUrl: e.imageUrl } : {}),
      ...(typeof e.shopId === "string" && e.shopId.length > 0 ? { shopId: e.shopId } : {}),
    });
  }
  return out;
}

/** Read the stored guest cart. A missing/blocked/unavailable storage reads as empty. */
export function readGuestCart(storage: StorageLike | null | undefined): GuestCartRecord[] {
  if (!storage) return [];
  try {
    return parseGuestCart(storage.getItem(GUEST_CART_KEY));
  } catch {
    // Safari private mode and some WebViews throw on access rather than returning null.
    return [];
  }
}

/** Persist the guest cart. An empty cart removes the key instead of storing `[]`. */
export function writeGuestCart(storage: StorageLike | null | undefined, records: GuestCartRecord[]): void {
  if (!storage) return;
  try {
    if (records.length === 0) storage.removeItem(GUEST_CART_KEY);
    else storage.setItem(GUEST_CART_KEY, JSON.stringify(records));
  } catch {
    // Quota exceeded or storage disabled — the in-memory cart still works.
  }
}

/** Drop the stored guest cart (after a successful merge, or on explicit clear). */
export function clearGuestCart(storage: StorageLike | null | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(GUEST_CART_KEY);
  } catch {
    // Nothing to do; stale data is dropped by validation on the next read.
  }
}
