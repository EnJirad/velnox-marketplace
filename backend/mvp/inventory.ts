/**
 * MVP inventory — the ONE stock authority.
 *
 * `db/schema.sql` has exactly one stock table, keyed
 * `(product_id, variant_id)` with `variant_id IS NULL` for a base product. This
 * module is the only code that writes it. There is no second `stock` column
 * anywhere, so "reserved" and "on hand" can never disagree:
 *
 *     on hand = inventory.quantity
 *     held    = inventory.reserved      (CHECK reserved <= quantity)
 *     sellable now = quantity - reserved
 *
 * RESERVATION IS A GUARDED ATOMIC UPDATE, NOT A READ-THEN-WRITE.
 * The `WHERE quantity - reserved >= $n` predicate is evaluated by PostgreSQL
 * while holding the row lock, so two concurrent checkouts for the last unit
 * cannot both succeed: the second statement re-evaluates the predicate against
 * the committed value and updates zero rows. A `SELECT` followed by an `UPDATE`
 * would have exactly that race, which is why it is not written that way.
 *
 * Every function here takes the caller's transaction client. Reserving inside
 * the checkout transaction is what makes "roll back stock reservations and
 * partial order writes if checkout creation fails" true: an error later in the
 * transaction releases the reservations automatically, with no compensating
 * write that could itself fail.
 */
import type pg from "pg";
import { conflict } from "./http.js";

export interface StockLine {
  productId: string;
  /** `null` = the base product (no variant). */
  variantId: string | null;
  quantity: number;
}

type Client = Pick<pg.PoolClient, "query">;

/**
 * Move `quantity` units from sellable to reserved for every line.
 *
 * All or nothing: the first line that cannot be satisfied throws, and the
 * caller's transaction rolls back every reservation already taken.
 */
export async function reserveStock(client: Client, lines: StockLine[]): Promise<void> {
  for (const line of lines) {
    const result = await client.query(
      `UPDATE inventory
          SET reserved = reserved + $3,
              updated_at = NOW()
        WHERE product_id = $1
          AND variant_id IS NOT DISTINCT FROM $2::uuid
          AND quantity - reserved >= $3
        RETURNING id`,
      [line.productId, line.variantId, line.quantity],
    );
    if (result.rowCount === 0) {
      const exists = await client.query(
        `SELECT 1 FROM inventory
          WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::uuid`,
        [line.productId, line.variantId],
      );
      if (exists.rowCount === 0) {
        throw conflict("STOCK_NOT_CONFIGURED", "This product is not available for sale");
      }
      throw conflict("OUT_OF_STOCK", "Not enough stock for one of the items in this cart");
    }
  }
}

/**
 * Turn a reservation into a sale: the units leave `quantity` AND `reserved` in
 * one statement, so the `reserved <= quantity` CHECK can never be transiently
 * violated and a successful payment can never leave units held forever.
 *
 * Guarded on `reserved >= n` as well: a settlement that would consume units it
 * never reserved is a bug, not something to absorb silently.
 */
export async function commitStock(client: Client, lines: StockLine[]): Promise<void> {
  for (const line of lines) {
    const result = await client.query(
      `UPDATE inventory
          SET quantity = quantity - $3,
              reserved = reserved - $3,
              updated_at = NOW()
        WHERE product_id = $1
          AND variant_id IS NOT DISTINCT FROM $2::uuid
          AND reserved >= $3
          AND quantity >= $3`,
      [line.productId, line.variantId, line.quantity],
    );
    if (result.rowCount === 0) {
      throw conflict("STOCK_RESERVATION_LOST", "The stock reservation for this order is no longer valid");
    }
  }
}

/** Give a reservation back without selling it (order cancelled / payment expired). */
export async function releaseStock(client: Client, lines: StockLine[]): Promise<void> {
  for (const line of lines) {
    await client.query(
      `UPDATE inventory
          SET reserved = reserved - $3,
              updated_at = NOW()
        WHERE product_id = $1
          AND variant_id IS NOT DISTINCT FROM $2::uuid
          AND reserved >= $3`,
      [line.productId, line.variantId, line.quantity],
    );
  }
}

/**
 * Seller-authoritative stock level (not a delta).
 *
 * Setting `quantity` below what is currently reserved is refused by
 * `inventory_reserved_within_stock`; this pre-checks to return a 409 naming the
 * reason instead of a raw constraint message. `quantity` and `reserved` are
 * touched in one statement so an UPDATE can never break the CHECK mid-way.
 */
export async function setStockLevel(
  client: Client,
  productId: string,
  variantId: string | null,
  quantity: number,
): Promise<{ quantity: number; reserved: number }> {
  const updated = await client.query(
    `UPDATE inventory
        SET quantity = $3,
            updated_at = NOW()
      WHERE product_id = $1
        AND variant_id IS NOT DISTINCT FROM $2::uuid
        AND $3 >= reserved
      RETURNING quantity, reserved`,
    [productId, variantId, quantity],
  );
  if (updated.rowCount === 1) {
    return updated.rows[0] as { quantity: number; reserved: number };
  }

  const current = await client.query(
    `SELECT reserved FROM inventory
      WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::uuid`,
    [productId, variantId],
  );
  if (current.rowCount === 0) {
    await client.query(
      `INSERT INTO inventory (product_id, variant_id, quantity)
       VALUES ($1, $2::uuid, $3)`,
      [productId, variantId, quantity],
    );
    return { quantity, reserved: 0 };
  }

  const reserved = (current.rows[0] as { reserved: number }).reserved;
  throw conflict(
    "STOCK_BELOW_RESERVED",
    `Cannot set stock to ${quantity}: ${reserved} unit(s) are already reserved by open orders`,
  );
}

/** Read the current stock row for one scope (used by catalog/product responses). */
export async function stockFor(
  client: Client,
  productId: string,
  variantId: string | null,
): Promise<{ quantity: number; reserved: number } | null> {
  const result = await client.query(
    `SELECT quantity, reserved FROM inventory
      WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::uuid`,
    [productId, variantId],
  );
  return (result.rows[0] as { quantity: number; reserved: number } | undefined) ?? null;
}
