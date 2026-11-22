import type { LedgerPosting, LedgerTransaction } from "./types.ts";
import { assertBalancedTransaction } from "./invariants.ts";

export interface CreatePaymentPostingsParams {
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly purchaseId?: string;
  readonly orderId?: string;
  readonly paymentId: string;
  readonly sellerId: string;
  readonly grossAmountMinor: bigint;
  readonly platformFeeMinor: bigint;
  readonly currency?: string;
  readonly rate?: string;
}

/**
 * Creates a balanced double-entry transaction for a customer payment:
 * - DEBIT:  platform_cash   (gross payment received from customer)
 * - CREDIT: seller_payable  (net earnings allocated to seller)
 * - CREDIT: platform_revenue (marketplace platform fee/commission)
 *
 * Invariant: Gross = Seller Payable + Platform Fee
 */
export function createCustomerPaymentTransaction(
  params: CreatePaymentPostingsParams,
): LedgerTransaction {
  if (params.platformFeeMinor < 0n) {
    throw new RangeError("platformFeeMinor cannot be negative");
  }
  if (params.platformFeeMinor > params.grossAmountMinor) {
    throw new RangeError("platformFeeMinor cannot exceed grossAmountMinor");
  }

  const sellerPayableMinor = params.grossAmountMinor - params.platformFeeMinor;

  const postings: LedgerPosting[] = [
    {
      account: "platform_cash",
      entryType: "charge",
      direction: "debit",
      amountMinor: params.grossAmountMinor,
      currency: params.currency ?? "THB",
      purchaseId: params.purchaseId,
      orderId: params.orderId,
      paymentId: params.paymentId,
      sellerId: params.sellerId,
      rate: params.rate,
    },
  ];

  if (sellerPayableMinor > 0n) {
    postings.push({
      account: "seller_payable",
      entryType: "seller_payable",
      direction: "credit",
      amountMinor: sellerPayableMinor,
      currency: params.currency ?? "THB",
      purchaseId: params.purchaseId,
      orderId: params.orderId,
      paymentId: params.paymentId,
      sellerId: params.sellerId,
      rate: params.rate,
    });
  }

  if (params.platformFeeMinor > 0n) {
    postings.push({
      account: "platform_revenue",
      entryType: "platform_fee",
      direction: "credit",
      amountMinor: params.platformFeeMinor,
      currency: params.currency ?? "THB",
      purchaseId: params.purchaseId,
      orderId: params.orderId,
      paymentId: params.paymentId,
      sellerId: params.sellerId,
      rate: params.rate,
    });
  }

  const transaction: LedgerTransaction = {
    idempotencyKey: params.idempotencyKey,
    correlationId: params.correlationId,
    postings,
    occurredAt: new Date(),
  };

  assertBalancedTransaction(transaction);
  return transaction;
}

export interface CreateSettlementParams {
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly settlementId: string;
  readonly sellerId: string;
  readonly amountMinor: bigint;
  readonly currency?: string;
}

/**
 * Creates a balanced double-entry transaction for a seller payout / settlement:
 * - DEBIT:  seller_payable (reduces platform liability to seller)
 * - CREDIT: platform_cash  (cash leaves platform bank account)
 */
export function createSellerSettlementTransaction(
  params: CreateSettlementParams,
): LedgerTransaction {
  if (params.amountMinor <= 0n) {
    throw new RangeError("Settlement amountMinor must be strictly greater than 0n");
  }

  const transaction: LedgerTransaction = {
    idempotencyKey: params.idempotencyKey,
    correlationId: params.correlationId,
    postings: [
      {
        account: "seller_payable",
        entryType: "settlement",
        direction: "debit",
        amountMinor: params.amountMinor,
        currency: params.currency ?? "THB",
        settlementId: params.settlementId,
        sellerId: params.sellerId,
      },
      {
        account: "platform_cash",
        entryType: "settlement",
        direction: "credit",
        amountMinor: params.amountMinor,
        currency: params.currency ?? "THB",
        settlementId: params.settlementId,
        sellerId: params.sellerId,
      },
    ],
    occurredAt: new Date(),
  };

  assertBalancedTransaction(transaction);
  return transaction;
}

export interface CreateRefundParams {
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly refundId: string;
  readonly paymentId?: string;
  readonly orderId?: string;
  readonly purchaseId?: string;
  readonly sellerId?: string;
  readonly refundAmountMinor: bigint;
  readonly currency?: string;
}

/**
 * Creates a balanced double-entry transaction for a customer refund:
 * - DEBIT:  refund_clearing (clearing account tracking pending refund settlement)
 * - CREDIT: platform_cash   (cash returned to customer via Stripe/payment gateway)
 */
export function createRefundTransaction(
  params: CreateRefundParams,
): LedgerTransaction {
  if (params.refundAmountMinor <= 0n) {
    throw new RangeError("Refund refundAmountMinor must be strictly greater than 0n");
  }

  const transaction: LedgerTransaction = {
    idempotencyKey: params.idempotencyKey,
    correlationId: params.correlationId,
    postings: [
      {
        account: "refund_clearing",
        entryType: "refund",
        direction: "debit",
        amountMinor: params.refundAmountMinor,
        currency: params.currency ?? "THB",
        refundId: params.refundId,
        paymentId: params.paymentId,
        orderId: params.orderId,
        purchaseId: params.purchaseId,
        sellerId: params.sellerId,
      },
      {
        account: "platform_cash",
        entryType: "refund",
        direction: "credit",
        amountMinor: params.refundAmountMinor,
        currency: params.currency ?? "THB",
        refundId: params.refundId,
        paymentId: params.paymentId,
        orderId: params.orderId,
        purchaseId: params.purchaseId,
        sellerId: params.sellerId,
      },
    ],
    occurredAt: new Date(),
  };

  assertBalancedTransaction(transaction);
  return transaction;
}
