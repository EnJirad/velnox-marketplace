import type pg from "pg";

/**
 * Sanity cap for a single order line. Checkout / VelRepeat orders are not
 * allowed to reserve more than this many units of one product per line.
 * The frontend clamps to available stock, this is a server-side backstop.
 */
export const MAX_ORDER_QUANTITY = 999;

/**
 * Validate an order-line quantity server-side. Returns an error message, or
 * null when the quantity is a valid positive integer.
 *
 * The frontend must never be the source of truth for quantities — a crafted
 * request can bypass any client-side clamp.
 */
export function validateCheckoutQuantity(q: unknown): string | null {
  if (typeof q !== "number" || !Number.isInteger(q)) {
    return "quantity must be a whole number";
  }
  if (q <= 0) {
    return "quantity must be greater than zero";
  }
  if (q > MAX_ORDER_QUANTITY) {
    return `quantity must not exceed ${MAX_ORDER_QUANTITY}`;
  }
  return null;
}

/**
 * Atomically reserve `quantity` units of a NON-VARIANT product's inventory.
 *
 * The stock validation and the mutation happen in a single statement:
 *
 *   UPDATE inventory
 *   SET reserved = reserved + $1
 *   WHERE product_id = $2 AND quantity - reserved >= $1
 *
 * A plain `SELECT ... then UPDATE` (time-of-check / time-of-use) allows two
 * concurrent checkouts to both pass the check and then both increment
 * `reserved`, overselling the product. With this guarded UPDATE under
 * READ COMMITTED, concurrent transactions serialize on the row lock and the
 * losing UPDATE re-evaluates the WHERE clause against the committed row,
 * matching 0 rows.
 *
 * This mirrors the existing atomic variant guard
 * (`UPDATE product_variants ... WHERE stock >= $1`).
 *
 * Throws when the requested quantity can no longer be covered — the caller's
 * transaction must roll back (order creation is then aborted as a unit).
 */
export async function reserveInventoryStock(
  client: pg.PoolClient,
  productId: string,
  quantity: number,
): Promise<void> {
  const upd = await client.query(
    `UPDATE inventory SET reserved = reserved + $1, updated_at = NOW()
     WHERE product_id = $2 AND quantity - reserved >= $1
     RETURNING id`,
    [quantity, productId],
  );
  if (upd.rows.length === 0) {
    throw new Error(`INSUFFICIENT_STOCK: product ${productId}`);
  }
}