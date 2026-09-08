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

// ─── Order inventory release ───────────────────────────────────────────────

/**
 * Cancellex order statuses whose inventory may still be reserved.
 * Paid / shipped / delivered / completed orders must never have their
 * inventory released — the stock has already been consumed.
 */
const RELEASABLE_STATUSES = [
  "pending",
  "pending_payment",
  "cancelled",
  "payment_failed",
  "expired",
  "failed",
];

/**
 * Atomically release (or restore) the inventory reserved by an order.
 *
 * This is the single authoritative function for returning stock to
 * availability. Every cancellation, expiry, and payment-failure path must
 * converge here so that inventory release is always:
 *
 *   • Correct — variant and non-variant items restored with the right
 *     quantities.
 *   • Idempotent — called twice on the same order restores stock at
 *     most once, enforced by the `inventory_released` flag on the order
 *     row (set atomically inside the same transaction).
 *   • Transactional — the flag update and the stock mutations happen
 *     inside the caller's transaction; if the caller rolls back, the
 *     flag is never set and stock is never restored.
 *
 * MUST be called inside an existing `withTransaction` block.
 *
 * Returns `true` when inventory was actually released, `false` when the
 * order was already released or was in a non-releasable state (e.g. a
 * late webhook for an already-paid order).
 */
export async function releaseOrderInventory(
  client: pg.PoolClient,
  orderId: string,
): Promise<boolean> {
  // 1. Read order status + current released flag (no lock yet).
  const orderRes = await client.query(
    `SELECT status, inventory_released FROM orders WHERE id = $1`,
    [orderId],
  );
  if (orderRes.rows.length === 0) return false;
  const order = orderRes.rows[0];

  // 2. Already released → idempotent no-op.
  if (order.inventory_released) {
    console.log(`[inventory] releaseOrderInventory: order ${orderId} already released — skipping`);
    return false;
  }

  // 3. Status guard — must not release for paid/completed orders.
  if (!RELEASABLE_STATUSES.includes(order.status)) {
    console.log(`[inventory] releaseOrderInventory: order ${orderId} status '${order.status}' not releasable — skipping`);
    return false;
  }

  // 4. Mark as released (atomic with stock updates below).
  await client.query(
    `UPDATE orders SET inventory_released = true, updated_at = NOW() WHERE id = $1`,
    [orderId],
  );

  // 5. Release stock for every item in the order.
  const items = await client.query(
    `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  for (const item of items.rows) {
    if (item.variant_id) {
      // Variant products: restore variant stock directly.
      await client.query(
        `UPDATE product_variants SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
        [item.quantity, item.variant_id],
      );
    } else {
      // Non-variant products: release the reservation (never go below 0).
      await client.query(
        `UPDATE inventory SET reserved = GREATEST(0, reserved - $1), updated_at = NOW()
         WHERE product_id = $2`,
        [item.quantity, item.product_id],
      );
    }
  }

  console.log(`[inventory] releaseOrderInventory: order ${orderId} — released ${items.rows.length} item(s)`);
  return true;
}