/**
 * Velnox Double-Entry Ledger Core Types
 *
 * All amounts are strictly BIGINT minor units (Satang for THB).
 * Floating-point numbers are prohibited to prevent rounding discrepancies.
 */

export type LedgerAccount =
  | "platform_cash"
  | "platform_revenue"
  | "seller_payable"
  | "refund_clearing";

export type LedgerEntryType =
  | "charge"
  | "refund"
  | "platform_fee"
  | "seller_payable"
  | "settlement"
  | "adjustment";

export type LedgerDirection = "debit" | "credit";

export interface LedgerPosting {
  readonly account: LedgerAccount;
  readonly entryType: LedgerEntryType;
  readonly direction: LedgerDirection;
  /** Amount in minor units (e.g., Satang). Must be strictly > 0n. */
  readonly amountMinor: bigint;
  readonly currency?: string;
  readonly purchaseId?: string;
  readonly orderId?: string;
  readonly paymentId?: string;
  readonly refundId?: string;
  readonly settlementId?: string;
  readonly sellerId?: string;
  readonly rate?: string;
}

export interface LedgerTransaction {
  /** Deterministic idempotency key ensuring duplicate calls are safe no-ops. */
  readonly idempotencyKey: string;
  readonly correlationId?: string;
  readonly postings: readonly LedgerPosting[];
  readonly occurredAt?: Date;
}

export interface LedgerValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly totalDebitMinor: bigint;
  readonly totalCreditMinor: bigint;
}
