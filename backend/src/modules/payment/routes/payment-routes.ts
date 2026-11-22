import type { DbQueryable } from "../../../../database/src/types.ts";
import { PaymentService } from "../services/payment-service.ts";
import { authenticateRequest, assertUserRole } from "../../../core/middleware/auth-middleware.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import type { HttpResponse } from "../../identity/routes/auth-routes.ts";
import type { CreatePaymentInput } from "../domain/payment.ts";
import { PaymentRepository } from "../repository/payment-repository.ts";

export class PaymentController {
  public static async getMethods(): Promise<HttpResponse> {
    const data = PaymentService.getAvailablePaymentMethods();
    return { status: 200, body: { success: true, data } };
  }

  public static async createPayment(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body: any,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      const input: CreatePaymentInput = {
        orderId: body?.orderId,
        checkoutGroupId: body?.checkoutGroupId,
        method: body?.method,
        amount: String(body?.amount ?? ""),
        currency: body?.currency ?? "THB",
        idempotencyKey: headers["idempotency-key"] ?? headers["x-idempotency-key"] ?? body?.idempotencyKey,
      };

      const result = await PaymentService.createPaymentAttempt(db, input, user.userId);
      return { status: 201, body: { success: true, data: result } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async handleWebhook(
    db: DbQueryable,
    rawBody: string | Buffer,
    headers: Record<string, string | undefined>,
    webhookSecret: string,
  ): Promise<HttpResponse> {
    try {
      const signature = headers["stripe-signature"] ?? "";
      const result = await PaymentService.handleStripeWebhook(
        db,
        rawBody,
        signature,
        webhookSecret,
      );
      return { status: 200, body: result };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async getPaymentStatusForOrder(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    orderId: string,
  ): Promise<HttpResponse> {
    try {
      await authenticateRequest(db, headers, jwtSecret);
      const payment = await PaymentRepository.findPaymentForOrder(db, orderId);
      if (!payment) {
        return {
          status: 200,
          body: {
            success: true,
            data: { status: "pending", method: null, paidAt: null },
          },
        };
      }
      return { status: 200, body: { success: true, data: payment } };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async executeSellerSettlement(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body: any,
  ): Promise<HttpResponse> {
    try {
      const user = await authenticateRequest(db, headers, jwtSecret);
      assertUserRole(user, ["admin"]);
      const sellerId = String(body?.sellerId ?? "");
      const amountMinor = BigInt(String(body?.amountMinor ?? "0"));

      const result = await PaymentService.executeSellerSettlement(
        db,
        sellerId,
        amountMinor,
        body?.correlationId,
      );

      return {
        status: 200,
        body: {
          success: true,
          data: {
            ...result,
            amountMinor: result.amountMinor.toString(),
          },
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
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
      body: {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : "Internal payment error",
        },
      },
    };
  }
}
