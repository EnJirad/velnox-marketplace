import type pg from "pg";

import { PAYMENT_SETTLED_STATUSES } from "./order-lock.js";

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

// ─── Order inventory settlement (the COMMIT path) ──────────────────────────

/**
 * Atomically COMMIT the inventory reserved by an order: the hold becomes a
 * completed sale. This is the SETTLEMENT authority — the mirror image of
 * `releaseOrderInventory` and the only place an order's stock is consumed:
 *
 *   reserve (checkout) → commit (payment settled)  xor  release (order ended)
 *
 * EXACTLY-ONCE. The caller's status claim (`orders.status → 'paid'`, taken
 * under `lockOrderRow`, requiring `inventory_released = FALSE`) is the gate: a
 * repeated or concurrent settlement moves no row and never reaches this
 * function, so `quantity` / `reserved` / `sold_count` change at most once. The
 * other half of the invariant is enforced in `releaseOrderInventory`, which
 * refuses to release an order whose money settled — so COMMIT+RELEASE and
 * RELEASE+COMMIT are both impossible for one reservation.
 *
 * WHAT THE FIELDS MEAN (`db/schema.sql`) — non-variant product:
 *
 *   quantity   on-hand units; units held by an open order are still counted
 *   reserved   units currently held by open orders
 *   available  = quantity - reserved   ← what checkout guards on
 *
 * So a completed sale drops BOTH: the units leave the shelf (`quantity`) and
 * stop being held (`reserved`). Neither alone is enough — only `reserved` and
 * availability returns the sold units to every other customer; only
 * `quantity` and the hold never ends. `GREATEST(0, …)` keeps stock at zero
 * rather than negative when a seller has meanwhile edited `quantity` by hand.
 *
 * A VARIANT has no inventory columns of its own — `product_variants.stock`
 * already IS that product's availability, and checkout decremented it for this
 * order (`stock = stock - $1 … WHERE stock >= $1`). Leaving it decremented IS
 * the consumption, so settlement deliberately does not touch it, and above all
 * must not touch the PARENT product's `inventory` row, which never held these
 * units (the pre-fix code did exactly that, releasing someone else's hold).
 *
 * `products.sold_count` is a sales counter: +quantity here, once.
 *
 * MUST be called inside an existing `withTransaction` block, in the SAME
 * transaction as the caller's order claim, so a settlement can never be half
 * applied (money recorded with stock untouched, or stock consumed with the
 * order still unpaid).
 *
 * Returns the number of order lines settled.
 */
export async function commitOrderInventory(
  client: pg.PoolClient,
  orderId: string,
): Promise<number> {
  const items = await client.query(
    `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
    [orderId],
  );

  for (const item of items.rows) {
    if (!item.variant_id) {
      // Non-variant: convert this order's hold into a completed sale.
      await client.query(
        `UPDATE inventory
            SET quantity = GREATEST(0, quantity - $1),
                reserved = GREATEST(0, reserved - $1),
                updated_at = NOW()
          WHERE product_id = $2`,
        [item.quantity, item.product_id],
      );
    }
    // Variant: `product_variants.stock` was decremented at reserve time and
    // stays decremented — see the header. Never fall back to the parent's
    // `inventory` row: that row never held this order's units.

    await client.query(
      `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2`,
      [item.quantity, item.product_id],
    );
  }

  console.log(
    `[inventory] commitOrderInventory: order ${orderId} — settled ${items.rows.length} item(s)`,
  );
  return items.rows.length;
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
 *     most once, enforced by an atomic guarded UPDATE that CLAIMS the
 *     `inventory_released` flag inside the caller's transaction. A
 *     read-then-write check is not enough: two concurrent callers (e.g. two
 *     racing Stripe webhooks) could both read the flag as false and both
 *     restore the stock.
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
  // 1. Atomically CLAIM the release: one guarded UPDATE carries the
  //    already-released check, the status guard, and the flag write.
  //    Under READ COMMITTED a concurrent caller blocks on the row lock and
  //    then re-evaluates the WHERE clause against the committed row, where
  //    `inventory_released = FALSE` no longer matches — so exactly one
  //    transaction wins and the loser becomes an idempotent no-op. The
  //    previous read-then-write check let both callers read false and both
  //    restore the stock.
  const claim = await client.query(
    `UPDATE orders
        SET inventory_released = true, updated_at = NOW()
      WHERE id = $1
        AND inventory_released = FALSE
        AND status = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.order_id = orders.id
             AND p.status = ANY($3::text[])
        )
      RETURNING id`,
    [orderId, RELEASABLE_STATUSES, [...PAYMENT_SETTLED_STATUSES]],
  );

  if (claim.rows.length === 0) {
    // The claim lost. Report WHY for the log (best effort — this read happens
    // after the deciding UPDATE, so it can never change the outcome).
    const orderRes = await client.query(
      `SELECT o.status, o.inventory_released,
              EXISTS (SELECT 1 FROM payments p
                       WHERE p.order_id = o.id AND p.status = ANY($2::text[])) AS settled
         FROM orders o
        WHERE o.id = $1`,
      [orderId, [...PAYMENT_SETTLED_STATUSES]],
    );
    const order = orderRes.rows[0];
    if (!order) return false;
    if (order.inventory_released) {
      console.log(`[inventory] releaseOrderInventory: order ${orderId} already released — skipping`);
    } else if (order.settled) {
      // A settled payment outranks a cancellation: those units were already
      // COMMITTED by commitOrderInventory, so restoring them would be a SECOND
      // terminal transition on one reservation (COMMIT + RELEASE) and would
      // hand sold stock back to the shelf. Refund is the operator's flow; the
      // stock is never returned by a status change.
      console.log(
        `[inventory] releaseOrderInventory: order ${orderId} has a settled payment — stock already committed, refusing a second terminal transition`,
      );
    } else {
      console.log(`[inventory] releaseOrderInventory: order ${orderId} status '${order.status}' not releasable — skipping`);
    }
    return false;
  }

  // 2. Release stock for every item in the order — only the claim winner
  //    reaches this point.
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