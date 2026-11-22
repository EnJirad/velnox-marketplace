import type { DbQueryable } from "../../../../database/src/types.ts";
import { CartRepository } from "../repository/cart-repository.ts";
import { ProductRepository } from "../../catalog/repository/product-repository.ts";
import type { Cart } from "../domain/cart.ts";
import { NotFoundError, ValidationError } from "../../../core/errors/app-error.ts";

export interface AddToCartInput {
  readonly productId: string;
  readonly variantId?: string;
  readonly quantity: number;
}

export class CartService {
  public static async getCart(db: DbQueryable, userId: string): Promise<Cart> {
    return CartRepository.getCart(db, userId);
  }

  public static async addItem(
    db: DbQueryable,
    userId: string,
    input: AddToCartInput,
  ): Promise<Cart> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new ValidationError("Quantity must be a positive integer");
    }
    if (input.quantity > 999) {
      throw new ValidationError("Quantity cannot exceed 999 units");
    }

    const product = await ProductRepository.findById(db, input.productId);
    if (!product || product.status !== "published") {
      throw new NotFoundError("Product not found or is no longer available");
    }

    if (input.variantId) {
      const variant = product.variants.find((v) => v.id === input.variantId);
      if (!variant) {
        throw new NotFoundError("Product variant not found");
      }
    }

    const cartId = await CartRepository.getOrCreateCartId(db, userId);
    await CartRepository.addItem(db, cartId, {
      productId: input.productId,
      variantId: input.variantId,
      quantity: input.quantity,
    });

    return CartRepository.getCart(db, userId);
  }

  public static async updateItem(
    db: DbQueryable,
    userId: string,
    itemId: string,
    quantity: number,
  ): Promise<Cart> {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new ValidationError("Quantity must be a non-negative integer");
    }
    if (quantity > 999) {
      throw new ValidationError("Quantity cannot exceed 999 units");
    }

    const cartId = await CartRepository.getOrCreateCartId(db, userId);
    await CartRepository.updateItemQuantity(db, cartId, itemId, quantity);
    return CartRepository.getCart(db, userId);
  }

  public static async removeItem(
    db: DbQueryable,
    userId: string,
    itemId: string,
  ): Promise<Cart> {
    const cartId = await CartRepository.getOrCreateCartId(db, userId);
    await CartRepository.removeItem(db, cartId, itemId);
    return CartRepository.getCart(db, userId);
  }
}
