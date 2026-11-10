/**
 * Order quantity limits — the ONE place that decides how many units one
 * checkout may contain.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `inventory.ts` already capped a single LINE at 999, but nothing capped the
 * ORDER: a cart with 40 lines × 30 units was 1,200 pieces checked out in one
 * go, which is far beyond what a marketplace parcel can carry and well past
 * what the large Thai marketplaces allow. The owner's rule is an explicit
 * product decision:
 *
 *   100 units maximum per checkout. Over the cap the customer must remove
 *   lines (or reduce quantities) before ordering.
 *
 * The rule is enforced in TWO places on purpose:
 *   • the cart (add / update) so the customer is told immediately, and
 *   • the checkout (authoritative) because a crafted request can bypass the UI.
 *
 * The split across SHOPS is unaffected: one order per shop is created by
 * `POST /api/customer/checkout`, and the cap applies to the WHOLE purchase
 * (all shops together), which is how Shopee/Lazada count a checkout.
 */

/** Maximum units in ONE checkout, across every selected line and shop. */
export const MAX_ORDER_UNITS = 100;

/** Maximum units on ONE cart line. Cannot exceed the order cap by definition. */
export const MAX_LINE_UNITS = MAX_ORDER_UNITS;

export interface QuantityLine {
  quantity: number;
  product_name?: string | null;
}

export type LimitFailure = {
  code: "ORDER_LIMIT_EXCEEDED" | "LINE_LIMIT_EXCEEDED" | "INVALID_QUANTITY";
  message: string;
  /** Units the request asked for (total, or the offending line's units). */
  requested?: number;
  /** The cap that refused it. */
  limit?: number;
};

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

/**
 * Validate one line's quantity against the LINE cap.
 * Returns a failure, or null when the line is acceptable.
 */
export function checkLineQuantity(quantity: unknown, productName?: string | null): LimitFailure | null {
  if (!isPositiveInt(quantity)) {
    return {
      code: "INVALID_QUANTITY",
      message: "Quantity must be a whole number greater than zero.",
    };
  }
  if (quantity > MAX_LINE_UNITS) {
    return {
      code: "LINE_LIMIT_EXCEEDED",
      message: productName
        ? `"${productName}" can be ordered at most ${MAX_LINE_UNITS} units at a time.`
        : `A line can hold at most ${MAX_LINE_UNITS} units.`,
      requested: quantity,
      limit: MAX_LINE_UNITS,
    };
  }
  return null;
}

/**
 * Validate the WHOLE checkout: every line valid, and the total units within
 * `MAX_ORDER_UNITS`.
 */
export function checkOrderUnits(lines: readonly QuantityLine[]): LimitFailure | null {
  if (lines.length === 0) {
    return { code: "INVALID_QUANTITY", message: "There is nothing to order." };
  }
  for (const line of lines) {
    const lineFailure = checkLineQuantity(line.quantity, line.product_name);
    if (lineFailure) return lineFailure;
  }
  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (total > MAX_ORDER_UNITS) {
    return {
      code: "ORDER_LIMIT_EXCEEDED",
      message: `One order can contain at most ${MAX_ORDER_UNITS} units. This checkout has ${total} — please remove ${total - MAX_ORDER_UNITS} unit(s) to continue.`,
      requested: total,
      limit: MAX_ORDER_UNITS,
    };
  }
  return null;
}

/** Total units across the given lines (helper for UI copy + audit). */
export function totalUnits(lines: readonly QuantityLine[]): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
}
