import type { DbQueryable } from "../../../../database/src/types.ts";
import { CheckoutService } from "../services/checkout-service.ts";
import { authenticateRequest } from "../../../core/middleware/auth-middleware.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import type { HttpResponse } from "../../identity/routes/auth-routes.ts";
import type { CheckoutResult } from "../domain/checkout.ts";

export class CheckoutController {
  public static async checkout(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body: any,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const idempotencyKey =
        headers["idempotency-key"] ??
        headers["x-idempotency-key"] ??
        body?.idempotencyKey;

      const result = await CheckoutService.checkout(db, user.userId, String(idempotencyKey ?? ""));
      return { status: 201, body: { success: true, data: this.formatCheckoutResponse(result) } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  private static formatCheckoutResponse(result: CheckoutResult): any {
    return {
      checkoutGroup: {
        ...result.checkoutGroup,
        totalAmountMinor: result.checkoutGroup.totalAmountMinor.toString(),
      },
      orders: result.orders.map((o) => ({
        ...o,
        totalAmountMinor: o.totalAmountMinor.toString(),
        items: o.items.map((i) => ({
          ...i,
          priceMinor: i.priceMinor.toString(),
          totalMinor: i.totalMinor.toString(),
        })),
      })),
      paymentExpiresAtMs: result.paymentExpiresAtMs,
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
      body: { success: false, error: { code: "INTERNAL_ERROR", message: "Checkout error" } },
    };
  }
}
