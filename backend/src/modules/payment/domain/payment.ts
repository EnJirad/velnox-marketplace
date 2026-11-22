import crypto from "node:crypto";
import { ValidationError } from "../../../core/errors/app-error.ts";

export type PaymentMethodId = "CARD" | "PROMPTPAY" | "COD" | "TRUEMONEY" | "LINEPAY";
export type PaymentStatus =
  | "pending"
  | "requires_action"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";

export type RefundStatus = "pending" | "partially_refunded" | "refunded" | "failed";
export type PaymentProvider = "stripe" | "cod" | "carrier";

export interface PaymentAttempt {
  readonly id: string;
  readonly orderId?: string | null;
  readonly checkoutGroupId?: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly method: PaymentMethodId;
  readonly status: PaymentStatus;
  readonly provider: PaymentProvider;
  readonly providerPaymentId?: string | null;
  readonly providerCheckoutSessionId?: string | null;
  readonly paidAt?: string | null;
  readonly refundedAmount?: string;
  readonly refundStatus?: RefundStatus | null;
  readonly failureCode?: string | null;
  readonly failureMessage?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentEventRecord {
  readonly id: string;
  readonly provider: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly status: "processing" | "processed" | "failed";
  readonly error?: string | null;
  readonly payload: any;
  readonly processedAt: string;
}

export interface WebhookEvent<T = any> {
  readonly id: string;
  readonly type: string;
  readonly data: {
    readonly object: T;
  };
}

export interface CreatePaymentInput {
  readonly orderId?: string;
  readonly checkoutGroupId?: string;
  readonly method: PaymentMethodId;
  readonly amount: string;
  readonly currency?: string;
  readonly idempotencyKey?: string;
}

/**
 * Standard platform commission calculation (e.g. 5% / 0.05 default).
 * Strict minor unit satang math (BigInt, zero float).
 */
export function calculatePlatformFeeMinor(
  grossAmountMinor: bigint,
  commissionRate: number = 0.05,
): bigint {
  if (grossAmountMinor < 0n) {
    throw new ValidationError("Gross amount minor cannot be negative");
  }
  if (commissionRate < 0 || commissionRate > 1) {
    throw new ValidationError("Commission rate must be between 0.00 and 1.00");
  }

  // Multiply by basis points (e.g. 0.05 * 10000 = 500 bps)
  const basisPoints = BigInt(Math.round(commissionRate * 10000));
  const feeMinor = (grossAmountMinor * basisPoints) / 10000n;

  if (feeMinor > grossAmountMinor) {
    return grossAmountMinor;
  }
  return feeMinor;
}

/**
 * Seller payable calculation: Gross Satang - Platform Fee Satang.
 */
export function calculateSellerPayableMinor(
  grossAmountMinor: bigint,
  feeMinor: bigint,
): bigint {
  if (feeMinor > grossAmountMinor) {
    throw new ValidationError("Fee minor cannot exceed gross amount minor");
  }
  return grossAmountMinor - feeMinor;
}

/**
 * Pure HMAC-SHA256 Stripe Webhook Signature Verification.
 * Works seamlessly in Edge / Workers / Node without external dependencies.
 *
 * Header format: t=timestamp,v1=signature,v0=...
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !webhookSecret) return false;

  const elements = signatureHeader.split(",");
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const element of elements) {
    const [key, value] = element.trim().split("=");
    if (!key || !value) continue;

    if (key === "t") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        timestamp = parsed;
      }
    } else if (key === "v1") {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return false;
  }

  // Anti-replay attack timestamp tolerance check
  if (toleranceSeconds > 0) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
      return false;
    }
  }

  const payloadString = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  const signedPayload = `${timestamp}.${payloadString}`;

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");

  for (const sig of signatures) {
    try {
      const sigBuffer = Buffer.from(sig, "hex");
      if (sigBuffer.length === expectedBuffer.length) {
        if (crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          return true;
        }
      }
    } catch {
      // Continue to next signature if hex decoding fails
    }
  }

  return false;
}
