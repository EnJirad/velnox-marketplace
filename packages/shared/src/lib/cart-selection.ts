/**
 * Cart selection + summary — pure, UI-agnostic helpers.
 *
 * Why this module exists: the VelShop cart needs three nested checkboxes
 * (select-all / select-shop / select-item) that must always agree with each
 * other, plus a summary whose money is derived from the CURRENT selection.
 * Keeping that as one pure, tested source means the invariants hold by
 * construction instead of by hand-maintained derived state in the component.
 *
 * Deliberately NOT a cart subsystem: no state store, no API calls, no React,
 * no persistence. It only reads the cart lines the existing backend already
 * returns (`GET /api/customer/cart`) and derives view state from them. It can
 * never mutate the database — there is no I/O here at all.
 *
 * Identity: a line is identified by its **cart item id** (`line.id`), which is
 * exactly what the existing checkout flow already sends as `selectedCartItems`.
 */

/** The fields these helpers need — structurally satisfied by `CartLine`. */
export interface CartSelectionLine {
  /** cart_items.id — the same id the checkout payload consumes. */
  id: string;
  /** units of this line */
  qty: number;
  /** unit price snapshot from the backend (never a client-supplied price) */
  price: number;
  /** products.shop_id, as the order-creation path groups by it */
  shopId?: string | null;
  shopName?: string | null;
}

export type SelectionState = "none" | "some" | "all";

export interface CartShopGroup<L extends CartSelectionLine = CartSelectionLine> {
  /** Stable React key: the shop id when known, otherwise the shop name. */
  key: string;
  shopId: string | null;
  shopName: string;
  lines: L[];
}

/**
 * Group lines by `shop_id`, preserving first-appearance order (the backend
 * returns the cart newest-first, so groups appear in the same order as the
 * rows). Lines without a shop id — guest carts built locally — fall back to
 * their shop name so they still group together instead of one row per line.
 *
 * Two different shops that happen to share a display name stay separate
 * groups, which is exactly why grouping uses the id and not the name.
 */
export function groupLinesByShop<L extends CartSelectionLine>(
  lines: readonly L[],
  fallbackShopName: string,
): CartShopGroup<L>[] {
  const groups: CartShopGroup<L>[] = [];
  const indexByKey = new Map<string, number>();

  for (const line of lines) {
    const shopName = line.shopName?.trim() || fallbackShopName;
    const key = line.shopId ?? `name:${shopName}`;
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ key, shopId: line.shopId ?? null, shopName, lines: [line] });
    } else {
      groups[existing]!.lines.push(line);
    }
  }
  return groups;
}

/**
 * Add a line id to the selection. Returns the SAME reference when nothing
 * changes, so a no-op update can never cause a re-render.
 */
export function selectLine(selected: ReadonlySet<string>, lineId: string): ReadonlySet<string> {
  if (selected.has(lineId)) return selected;
  const next = new Set(selected);
  next.add(lineId);
  return next;
}

/** Remove a line id from the selection. Same same-reference rule as `selectLine`. */
export function deselectLine(selected: ReadonlySet<string>, lineId: string): ReadonlySet<string> {
  if (!selected.has(lineId)) return selected;
  const next = new Set(selected);
  next.delete(lineId);
  return next;
}

/** Toggle exactly one line. */
export function toggleLine(
  selected: ReadonlySet<string>,
  lineId: string,
): ReadonlySet<string> {
  return selected.has(lineId) ? deselectLine(selected, lineId) : selectLine(selected, lineId);
}

/**
 * Toggle every line of one shop: all selected → deselect them all, otherwise
 * select them all. Requirement: deselecting a single item must flip the shop
 * checkbox, and selecting every item must flip it back — which follows from
 * both being *derived* from the same set rather than stored separately.
 */
export function toggleShop<L extends CartSelectionLine>(
  selected: ReadonlySet<string>,
  shopLines: readonly L[],
): Set<string> {
  return selectionState(shopLines, selected) === "all"
    ? deselectMany(selected, shopLines)
    : selectMany(selected, shopLines);
}

/** Toggle every line in the cart. Same rule as `toggleShop`. */
export function toggleAll<L extends CartSelectionLine>(
  selected: ReadonlySet<string>,
  lines: readonly L[],
): Set<string> {
  return selectionState(lines, selected) === "all"
    ? deselectMany(selected, lines)
    : selectMany(selected, lines);
}

function selectMany<L extends CartSelectionLine>(
  selected: ReadonlySet<string>,
  lines: readonly L[],
): Set<string> {
  const next = new Set(selected);
  for (const line of lines) next.add(line.id);
  return next;
}

function deselectMany<L extends CartSelectionLine>(
  selected: ReadonlySet<string>,
  lines: readonly L[],
): Set<string> {
  const next = new Set(selected);
  for (const line of lines) next.delete(line.id);
  return next;
}

/**
 * Derive a checkbox state from the set — the ONLY place these states are
 * computed, so a shop can never disagree with its items.
 * An empty group is "none" (an empty shop is not "fully selected").
 */
export function selectionState(
  lines: readonly CartSelectionLine[],
  selected: ReadonlySet<string>,
): SelectionState {
  if (lines.length === 0) return "none";
  let picked = 0;
  for (const line of lines) if (selected.has(line.id)) picked += 1;
  if (picked === 0) return "none";
  return picked === lines.length ? "all" : "some";
}

/** Radix Checkbox `checked` value: boolean when settled, "indeterminate" when partial. */
export function checkboxChecked(state: SelectionState): boolean | "indeterminate" {
  if (state === "all") return true;
  if (state === "some") return "indeterminate";
  return false;
}

/** Snapshots of the real cart values the summary is built from. */
export interface CartSummaryAdjustments {
  /** currency units to subtract from the selected subtotal */
  discount: number;
  /** currency units to add for delivery */
  shipping: number;
}

/**
 * The adjustments the production system actually applies today: **none**.
 *
 * `POST /api/customer/checkout` inserts orders with `total_amount` only, so
 * `orders.discount` and `orders.shipping_fee` keep their `0` defaults, the
 * order payload reports `shippingFee: 0`, and the checkout screen renders
 * `checkout.shippingFree` ("0 ฿"). There is no promotion/coupon engine in this
 * repository. Callers pass nothing and must not invent a discount — the field
 * exists so the arithmetic is testable and so a future real engine changes one
 * line instead of the component.
 */
export const CART_SUMMARY_ADJUSTMENTS: CartSummaryAdjustments = { discount: 0, shipping: 0 };

export interface CartSummary {
  /** number of selected cart lines */
  lineCount: number;
  /** number of selected units (Σ qty) */
  itemCount: number;
  subtotal: number;
  discount: number;
  shipping: number;
  /** subtotal − discount + shipping, rounded to currency precision */
  total: number;
}

/** Sum to 2 decimals — prices are `NUMERIC(12,2)`. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Summary of the CURRENT selection. Never sums unselected lines, so the total
 * can only change when the user changes the selection — nothing else can move
 * it.
 */
export function computeCartSummary<L extends CartSelectionLine>(
  lines: readonly L[],
  selected: ReadonlySet<string>,
  adjustments: CartSummaryAdjustments = CART_SUMMARY_ADJUSTMENTS,
): CartSummary {
  let subtotal = 0;
  let itemCount = 0;
  let lineCount = 0;

  for (const line of lines) {
    if (!selected.has(line.id)) continue;
    subtotal += line.qty * line.price;
    itemCount += line.qty;
    lineCount += 1;
  }

  const discount = round2(adjustments.discount ?? 0);
  const shipping = round2(adjustments.shipping ?? 0);
  const roundedSubtotal = round2(subtotal);

  return {
    lineCount,
    itemCount,
    subtotal: roundedSubtotal,
    discount,
    shipping,
    total: round2(roundedSubtotal - discount + shipping),
  };
}

/**
 * Per-shop breakdown of the selection: each entry carries the shop's own
 * subtotal, so it is exactly the amount that shop's order will be created
 * with (one order per `shop_id`, `total_amount` = Σ price×qty).
 */
export interface CartShopSummary<L extends CartSelectionLine = CartSelectionLine> {
  key: string;
  shopId: string | null;
  shopName: string;
  /** only the SELECTED lines of this shop */
  lines: L[];
  summary: CartSummary;
}

export function computeShopSummaries<L extends CartSelectionLine>(
  lines: readonly L[],
  selected: ReadonlySet<string>,
  fallbackShopName: string,
  adjustments: CartSummaryAdjustments = CART_SUMMARY_ADJUSTMENTS,
): CartShopSummary<L>[] {
  return groupLinesByShop(lines, fallbackShopName)
    .map((group) => {
      const chosen = group.lines.filter((line) => selected.has(line.id));
      if (chosen.length === 0) return null;
      return {
        key: group.key,
        shopId: group.shopId,
        shopName: group.shopName,
        lines: chosen,
        summary: computeCartSummary(chosen, selected, adjustments),
      };
    })
    .filter((entry): entry is CartShopSummary<L> => entry !== null);
}
