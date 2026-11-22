import type { DbQueryable } from "../../../../database/src/types.ts";
import type { LedgerAccount } from "./ledger.ts";

export interface AccountBalanceSummary {
  readonly account: LedgerAccount;
  readonly currency: string;
  readonly totalDebitMinor: bigint;
  readonly totalCreditMinor: bigint;
  readonly netBalanceMinor: bigint; // Natural balance: Assets (cash) = Debit - Credit; Liabilities/Revenue = Credit - Debit
}

export interface LedgerAuditReport {
  readonly isBalanced: boolean;
  readonly totalDebitsMinor: bigint;
  readonly totalCreditsMinor: bigint;
  readonly discrepancyMinor: bigint;
  readonly totalEntriesCount: number;
  readonly invalidNegativeEntriesCount: number;
}

export class LedgerDomainService {
  /**
   * Calculates the current balance for a ledger account.
   */
  public static async getAccountBalance(
    db: DbQueryable,
    account: LedgerAccount,
    currency = "THB",
  ): Promise<AccountBalanceSummary> {
    const res = await db.query(
      `SELECT
         direction,
         COALESCE(SUM(amount_minor), 0) AS total
       FROM ledger_entries
       WHERE account = $1 AND currency = $2
       GROUP BY direction;`,
      [account, currency],
    );

    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const row of res.rows) {
      if (row.direction === "debit") {
        totalDebit = BigInt(row.total);
      } else if (row.direction === "credit") {
        totalCredit = BigInt(row.total);
      }
    }

    // Natural balance definition:
    // Assets (platform_cash, refund_clearing): Debit normal (Debit - Credit)
    // Liabilities / Revenue (seller_payable, platform_revenue): Credit normal (Credit - Debit)
    const isDebitNormal = account === "platform_cash" || account === "refund_clearing";
    const netBalance = isDebitNormal
      ? totalDebit - totalCredit
      : totalCredit - totalDebit;

    return {
      account,
      currency,
      totalDebitMinor: totalDebit,
      totalCreditMinor: totalCredit,
      netBalanceMinor: netBalance,
    };
  }

  /**
   * Calculates the accrued payable balance owed to a specific seller.
   */
  public static async getSellerPayableBalance(
    db: DbQueryable,
    sellerId: string,
    currency = "THB",
  ): Promise<bigint> {
    const res = await db.query(
      `SELECT
         direction,
         COALESCE(SUM(amount_minor), 0) AS total
       FROM ledger_entries
       WHERE account = 'seller_payable' AND seller_id = $1 AND currency = $2
       GROUP BY direction;`,
      [sellerId, currency],
    );

    let credits = 0n;
    let debits = 0n;

    for (const row of res.rows) {
      if (row.direction === "credit") {
        credits = BigInt(row.total);
      } else if (row.direction === "debit") {
        debits = BigInt(row.total);
      }
    }

    return credits - debits;
  }

  /**
   * Mathematically audits the double-entry invariant across all ledger entries in the database.
   * Total Debits MUST equal Total Credits.
   */
  public static async verifyLedgerIntegrity(
    db: DbQueryable,
  ): Promise<LedgerAuditReport> {
    const totalsRes = await db.query(
      `SELECT
         direction,
         COALESCE(SUM(amount_minor), 0) AS total,
         COUNT(*) as count
       FROM ledger_entries
       GROUP BY direction;`,
    );

    let totalDebits = 0n;
    let totalCredits = 0n;
    let totalCount = 0;

    for (const row of totalsRes.rows) {
      const amount = BigInt(row.total);
      const count = Number(row.count);
      totalCount += count;

      if (row.direction === "debit") {
        totalDebits = amount;
      } else if (row.direction === "credit") {
        totalCredits = amount;
      }
    }

    const negativeRes = await db.query(
      `SELECT COUNT(*) AS count FROM ledger_entries WHERE amount_minor <= 0;`,
    );
    const invalidNegativeCount = Number(negativeRes.rows[0]?.count ?? 0);

    const discrepancy = totalDebits > totalCredits ? totalDebits - totalCredits : totalCredits - totalDebits;
    const isBalanced = discrepancy === 0n && invalidNegativeCount === 0;

    return {
      isBalanced,
      totalDebitsMinor: totalDebits,
      totalCreditsMinor: totalCredits,
      discrepancyMinor: discrepancy,
      totalEntriesCount: totalCount,
      invalidNegativeEntriesCount: invalidNegativeCount,
    };
  }
}
