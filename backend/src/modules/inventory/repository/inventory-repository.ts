import type { DbQueryable } from "../../../../database/src/types.ts";
import type { StockMovement } from "../domain/inventory.ts";
import { ConflictError } from "../../../core/errors/app-error.ts";

export class InventoryRepository {
  /**
   * Atomically reserves stock for a product or variant.
   * Concurrency Guard: Uses conditional UPDATE which locks the row and serializes concurrent checkouts.
   * If stock is insufficient, 0 rows are updated and ConflictError is thrown.
   */
  public static async reserveStock(
    db: DbQueryable,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    if (variantId) {
      const res = await db.query(
        `UPDATE product_variants
         SET stock = stock - $1
         WHERE id = $2 AND stock >= $1
         RETURNING id;`,
        [quantity, variantId],
      );
      if (!res.rows || res.rows.length === 0) {
        throw new ConflictError(
          `Insufficient stock for variant '${variantId}' (requested: ${quantity})`,
          "INSUFFICIENT_STOCK",
        );
      }
    } else {
      const res = await db.query(
        `UPDATE inventory
         SET reserved = reserved + $1, updated_at = NOW()
         WHERE product_id = $2 AND quantity - reserved >= $1
         RETURNING id;`,
        [quantity, productId],
      );
      if (!res.rows || res.rows.length === 0) {
        throw new ConflictError(
          `Insufficient stock for product '${productId}' (requested: ${quantity})`,
          "INSUFFICIENT_STOCK",
        );
      }
    }
  }

  /**
   * Releases previously reserved stock (e.g., when checkout is cancelled or payment expired).
   */
  public static async releaseStock(
    db: DbQueryable,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    if (variantId) {
      await db.query(
        `UPDATE product_variants SET stock = stock + $1 WHERE id = $2;`,
        [quantity, variantId],
      );
    } else {
      await db.query(
        `UPDATE inventory
         SET reserved = GREATEST(0, reserved - $1), updated_at = NOW()
         WHERE product_id = $2;`,
        [quantity, productId],
      );
    }
  }

  /**
   * Commits reserved stock upon successful payment (converts hold to permanent reduction).
   */
  public static async commitStock(
    db: DbQueryable,
    productId: string,
    quantity: number,
    variantId?: string,
  ): Promise<void> {
    if (quantity <= 0) return;

    if (variantId) {
      // Stock was already deducted at reservation time
      return;
    }

    await db.query(
      `UPDATE inventory
       SET quantity = GREATEST(0, quantity - $1),
           reserved = GREATEST(0, reserved - $1),
           updated_at = NOW()
       WHERE product_id = $2;`,
      [quantity, productId],
    );
  }

  /**
   * Records an audited stock movement in the inventory_movements table.
   */
  public static async recordMovement(
    db: DbQueryable,
    movement: StockMovement,
  ): Promise<void> {
    const change = movement.type === "inbound" ? movement.quantity : -movement.quantity;
    await db.query(
      `INSERT INTO inventory_movements (
        id, product_id, variant_id, change, reason, reference_id, notes, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW()
      );`,
      [
        movement.productId,
        movement.variantId ?? null,
        change,
        movement.reason,
        movement.referenceId ?? null,
        movement.notes ?? null,
      ],
    );
  }
}
