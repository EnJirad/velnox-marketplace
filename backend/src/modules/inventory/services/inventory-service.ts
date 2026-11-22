import type { DbQueryable } from "../../../../database/src/types.ts";
import { InventoryRepository } from "../repository/inventory-repository.ts";
import { ValidationError } from "../../../core/errors/app-error.ts";

export interface ReservationItem {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
}

export class InventoryService {
  public static readonly MAX_ORDER_QUANTITY = 999;

  /**
   * Validates and atomically reserves a batch of items inside an ongoing database transaction.
   */
  public static async reserveBatch(
    db: DbQueryable,
    items: readonly ReservationItem[],
  ): Promise<void> {
    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        throw new ValidationError(`Invalid reservation quantity for product '${item.productId}'`);
      }
      if (item.quantity > this.MAX_ORDER_QUANTITY) {
        throw new ValidationError(`Quantity exceeds limit of ${this.MAX_ORDER_QUANTITY} per item`);
      }

      await InventoryRepository.reserveStock(
        db,
        item.productId,
        item.quantity,
        item.variantId,
      );

      await InventoryRepository.recordMovement(db, {
        productId: item.productId,
        variantId: item.variantId,
        type: "outbound",
        reason: "reservation",
        quantity: item.quantity,
        notes: "Checkout stock reservation hold",
      });
    }
  }

  /**
   * Releases previously reserved items.
   */
  public static async releaseBatch(
    db: DbQueryable,
    items: readonly ReservationItem[],
  ): Promise<void> {
    for (const item of items) {
      await InventoryRepository.releaseStock(
        db,
        item.productId,
        item.quantity,
        item.variantId,
      );

      await InventoryRepository.recordMovement(db, {
        productId: item.productId,
        variantId: item.variantId,
        type: "inbound",
        reason: "release",
        quantity: item.quantity,
        notes: "Checkout reservation released",
      });
    }
  }
}
