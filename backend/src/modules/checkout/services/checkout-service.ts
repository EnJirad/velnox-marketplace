import type { DbQueryable } from "../../../../database/src/types.ts";
import { CheckoutRepository } from "../repository/checkout-repository.ts";
import { CartRepository } from "../../cart/repository/cart-repository.ts";
import { InventoryService } from "../../inventory/services/inventory-service.ts";
import type { CheckoutOrder, CheckoutOrderItem, CheckoutResult } from "../domain/checkout.ts";
import { ValidationError } from "../../../core/errors/app-error.ts";

export class CheckoutService {
  public static readonly PAYMENT_RESERVATION_MINUTES = 30;

  /**
   * Executes multi-shop checkout atomically with inventory reservation and idempotency guards.
   */
  public static async checkout(
    db: DbQueryable,
    userId: string,
    idempotencyKey: string,
  ): Promise<CheckoutResult> {
    if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
      throw new ValidationError("An idempotencyKey is required for checkout");
    }

    // 1. Idempotency Check: Return existing orders if duplicate request
    const existing = await CheckoutRepository.findByGroupKey(db, idempotencyKey);
    if (existing) {
      const expiresMs = existing.orders[0]?.paymentExpiresAt.getTime() ?? Date.now();
      return {
        checkoutGroup: existing.group,
        orders: existing.orders,
        paymentExpiresAtMs: expiresMs,
      };
    }

    // 2. Fetch current user cart
    const cart = await CartRepository.getCart(db, userId);
    if (!cart.groups || cart.groups.length === 0 || cart.totalItems === 0) {
      throw new ValidationError("Your cart is empty. Please add items before checking out.");
    }

    // 3. Prepare inventory reservation items
    const itemsToReserve = cart.groups.flatMap((g) =>
      g.items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId ?? undefined,
        quantity: i.quantity,
      })),
    );

    const paymentExpiresAt = new Date(Date.now() + this.PAYMENT_RESERVATION_MINUTES * 60 * 1000);
    const createdOrders: CheckoutOrder[] = [];

    try {
      await db.query("BEGIN;");

      // 4. Atomic Inventory Reservation (guards against overselling)
      await InventoryService.reserveBatch(db, itemsToReserve);

      // 5. Create Checkout Group
      const group = await CheckoutRepository.createCheckoutGroup(db, {
        userId,
        idempotencyKey,
        totalAmountMinor: cart.grandTotalMinor,
        currency: "THB",
      });

      // 6. Multi-shop order split
      for (const groupItem of cart.groups) {
        const orderId = await CheckoutRepository.createOrder(db, {
          checkoutGroupId: group.id,
          userId,
          shopId: groupItem.shopId,
          totalAmountMinor: groupItem.subtotalMinor,
          paymentExpiresAt,
        });

        const orderItems: CheckoutOrderItem[] = [];
        for (const item of groupItem.items) {
          const itemId = await CheckoutRepository.createOrderItem(db, {
            orderId,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            priceMinor: item.priceMinor,
          });

          orderItems.push({
            id: itemId,
            orderId,
            productId: item.productId,
            variantId: item.variantId,
            productTitle: item.productTitle,
            quantity: item.quantity,
            priceMinor: item.priceMinor,
            totalMinor: item.totalMinor,
          });
        }

        createdOrders.push({
          id: orderId,
          checkoutGroupId: group.id,
          shopId: groupItem.shopId,
          status: "pending",
          totalAmountMinor: groupItem.subtotalMinor,
          paymentExpiresAt,
          items: orderItems,
        });
      }

      // 7. Clear user cart
      await CartRepository.clearCart(db, cart.id);

      await db.query("COMMIT;");

      return {
        checkoutGroup: group,
        orders: createdOrders,
        paymentExpiresAtMs: paymentExpiresAt.getTime(),
      };
    } catch (err) {
      await db.query("ROLLBACK;").catch(() => {});
      throw err;
    }
  }
}
