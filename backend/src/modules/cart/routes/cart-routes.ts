import type { DbQueryable } from "../../../../database/src/types.ts";
import { CartService } from "../services/cart-service.ts";
import { authenticateRequest } from "../../../core/middleware/auth-middleware.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import type { HttpResponse } from "../../identity/routes/auth-routes.ts";
import type { Cart } from "../domain/cart.ts";

export class CartController {
  public static async getCart(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const cart = await CartService.getCart(db, user.userId);
      return { status: 200, body: { success: true, data: this.formatCartResponse(cart) } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async addItem(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body: any,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const cart = await CartService.addItem(db, user.userId, {
        productId: String(body?.productId),
        variantId: body?.variantId ? String(body.variantId) : undefined,
        quantity: Number(body?.quantity ?? 1),
      });
      return { status: 200, body: { success: true, data: this.formatCartResponse(cart) } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async updateItem(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    itemId: string,
    body: any,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const cart = await CartService.updateItem(
        db,
        user.userId,
        itemId,
        Number(body?.quantity ?? 0),
      );
      return { status: 200, body: { success: true, data: this.formatCartResponse(cart) } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async removeItem(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    itemId: string,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const cart = await CartService.removeItem(db, user.userId, itemId);
      return { status: 200, body: { success: true, data: this.formatCartResponse(cart) } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  private static formatCartResponse(cart: Cart): any {
    return {
      ...cart,
      grandTotalMinor: cart.grandTotalMinor.toString(),
      groups: cart.groups.map((g) => ({
        ...g,
        subtotalMinor: g.subtotalMinor.toString(),
        items: g.items.map((i) => ({
          ...i,
          priceMinor: i.priceMinor.toString(),
          totalMinor: i.totalMinor.toString(),
        })),
      })),
    };
  }

  private static handleError(err: any): HttpResponse {
    if (err instanceof AppError) {
      return {
        status: err.statusCode,
        body: { success: false, error: { code: err.code, message: err.message } },
      };
    }
    return {
      status: 500,
      body: { success: false, error: { code: "INTERNAL_ERROR", message: "Cart error" } },
    };
  }
}
