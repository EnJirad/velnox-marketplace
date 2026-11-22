import type {
  LedgerAccount,
  LedgerDirection,
  LedgerEntryType,
  LedgerPosting,
  LedgerTransaction,
  LedgerValidationResult,
} from "./types.ts";

const VALID_ACCOUNTS: ReadonlySet<string> = new Set<LedgerAccount>([
  "platform_cash",
  "platform_revenue",
  "seller_payable",
  "refund_clearing",
]);

const VALID_ENTRY_TYPES: ReadonlySet<string> = new Set<LedgerEntryType>([
  "charge",
  "refund",
  "platform_fee",
  "seller_payable",
  "settlement",
  "adjustment",
]);

const VALID_DIRECTIONS: ReadonlySet<string> = new Set<LedgerDirection>([
  "debit",
  "credit",
]);

export class LedgerInvariantViolationError extends Error {
  public readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.name = "LedgerInvariantViolationError";
    this.errors = errors;
  }
}

/**
 * Validates a double-entry ledger transaction against core accounting invariants:
 * 1. Transaction must contain at least 2 postings.
 * 2. Idempotency key must be non-empty.
 * 3. Every posting amount must be a bigint > 0n (strictly positive integer satang).
 * 4. Sum of all debits must EXACTLY EQUAL sum of all credits.
 * 5. Accounts, entry types, and directions must adhere to canonical definitions.
 */
export function validateTransaction(
  transaction: LedgerTransaction,
): LedgerValidationResult {
  const errors: string[] = [];

  if (!transaction.idempotencyKey || typeof transaction.idempotencyKey !== "string" || transaction.idempotencyKey.trim().length === 0) {
    errors.push("Transaction must have a non-empty idempotencyKey");
  }

  if (!transaction.postings || !Array.isArray(transaction.postings) || transaction.postings.length < 2) {
    errors.push("Transaction must contain at least two postings to satisfy double-entry bookkeeping");
    return {
      isValid: false,
      errors,
      totalDebitMinor: 0n,
      totalCreditMinor: 0n,
    };
  }

  let totalDebitMinor = 0n;
  let totalCreditMinor = 0n;
  let hasDebit = false;
  let hasCredit = false;

  for (let i = 0; i < transaction.postings.length; i++) {
    const posting = transaction.postings[i];
    const prefix = `Posting[${i}]`;

    if (!VALID_ACCOUNTS.has(posting.account)) {
      errors.push(`${prefix}: Invalid account '${posting.account}'`);
    }

    if (!VALID_ENTRY_TYPES.has(posting.entryType)) {
      errors.push(`${prefix}: Invalid entryType '${posting.entryType}'`);
    }

    if (!VALID_DIRECTIONS.has(posting.direction)) {
      errors.push(`${prefix}: Invalid direction '${posting.direction}'`);
    }

    if (typeof posting.amountMinor !== "bigint") {
      errors.push(`${prefix}: amountMinor must be a bigint to guarantee decimal safety`);
      continue;
    }

    if (posting.amountMinor <= 0n) {
      errors.push(`${prefix}: amountMinor must be strictly greater than 0n`);
      continue;
    }

    if (posting.direction === "debit") {
      totalDebitMinor += posting.amountMinor;
      hasDebit = true;
    } else if (posting.direction === "credit") {
      totalCreditMinor += posting.amountMinor;
      hasCredit = true;
    }
  }

  if (!hasDebit || !hasCredit) {
    errors.push("Transaction must have at least one debit posting and at least one credit posting");
  }

  if (totalDebitMinor !== totalCreditMinor) {
    errors.push(
      `Double-entry imbalance: total debits (${totalDebitMinor.toString()}) does not equal total credits (${totalCreditMinor.toString()})`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    totalDebitMinor,
    totalCreditMinor,
  };
}

/**
 * Asserts that a transaction satisfies all double-entry invariants, throwing an error if not.
 */
export function assertBalancedTransaction(transaction: LedgerTransaction): void {
  const result = validateTransaction(transaction);
  if (!result.isValid) {
    throw new LedgerInvariantViolationError(
      `Ledger invariant violation: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
}
