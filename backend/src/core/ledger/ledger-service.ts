import {
  assertBalancedTransaction,
  type LedgerTransaction,
  type LedgerPosting,
} from "../../../../packages/ledger/src/index.ts";

export interface Queryable {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface LedgerRecordResult {
  readonly status: "inserted" | "already_recorded";
  readonly idempotencyKey: string;
  readonly entries: readonly any[];
}

/**
 * Service to execute balanced double-entry transactions against the Neon PostgreSQL ledger.
 *
 * Guarantees:
 * 1. Double-entry balance is mathematically proven before touching the database.
 * 2. Atomic multi-row insert within a single database transaction.
 * 3. Idempotency: Retrying with the same idempotencyKey returns existing entries rather than failing.
 * 4. Append-only: The database trigger `trg_prevent_ledger_mutation` guarantees entries cannot be mutated.
 */
export class LedgerService {
  /**
   * Persists a balanced ledger transaction to the `ledger_entries` table.
   */
  public static async recordTransaction(
    db: Queryable,
    transaction: LedgerTransaction,
  ): Promise<LedgerRecordResult> {
    // 1. Enforce accounting invariants before touching DB
    assertBalancedTransaction(transaction);

    const baseKey = transaction.idempotencyKey;
    const insertedEntries: any[] = [];

    try {
      await db.query("BEGIN");

      for (let i = 0; i < transaction.postings.length; i++) {
        const posting = transaction.postings[i];
        if (!posting) continue;
        // Unique key per leg of the transaction
        const entryKey =
          transaction.postings.length === 1
            ? baseKey
            : `${baseKey}:leg_${i}_${posting.direction}_${posting.account}`;

        const insertSql = `
          INSERT INTO ledger_entries (
            idempotency_key,
            entry_type,
            account,
            direction,
            amount_minor,
            currency,
            purchase_id,
            order_id,
            payment_id,
            refund_id,
            settlement_id,
            seller_id,
            rate,
            correlation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING *;
        `;

        const res = await db.query(insertSql, [
          entryKey,
          posting.entryType,
          posting.account,
          posting.direction,
          posting.amountMinor.toString(), // node-postgres bigint representation
          posting.currency ?? "THB",
          posting.purchaseId ?? null,
          posting.orderId ?? null,
          posting.paymentId ?? null,
          posting.refundId ?? null,
          posting.settlementId ?? null,
          posting.sellerId ?? null,
          posting.rate ?? null,
          transaction.correlationId ?? null,
        ]);

        insertedEntries.push(res.rows[0]);
      }

      await db.query("COMMIT");

      return {
        status: "inserted",
        idempotencyKey: baseKey,
        entries: insertedEntries,
      };
    } catch (err: any) {
      await db.query("ROLLBACK").catch(() => {});

      // Unique constraint violation (23505) indicates duplicate attempt of existing transaction
      if (err?.code === "23505") {
        const existing = await db.query(
          `SELECT * FROM ledger_entries WHERE idempotency_key LIKE $1 ORDER BY created_at ASC`,
          [`${baseKey}%`],
        );

        return {
          status: "already_recorded",
          idempotencyKey: baseKey,
          entries: existing.rows,
        };
      }

      throw err;
    }
  }
}
