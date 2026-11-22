import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LedgerService, type Queryable } from "../src/core/ledger/ledger-service.ts";
import { createCustomerPaymentTransaction } from "../../packages/ledger/src/index.ts";

describe("LedgerService Unit Tests", () => {
  it("records customer payment transaction atomically", async () => {
    const executedQueries: { sql: string; params?: any[] }[] = [];

    const mockDb: Queryable = {
      async query(sql: string, params?: any[]) {
        executedQueries.push({ sql: sql.trim(), params });
        if (sql.includes("BEGIN") || sql.includes("COMMIT")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO ledger_entries")) {
          return {
            rows: [
              {
                id: "uuid-123",
                idempotency_key: params?.[0],
                account: params?.[2],
                direction: params?.[3],
                amount_minor: params?.[4],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const tx = createCustomerPaymentTransaction({
      idempotencyKey: "pay_test_001",
      paymentId: "00000000-0000-0000-0000-000000000001",
      sellerId: "00000000-0000-0000-0000-000000000002",
      grossAmountMinor: 10000n,
      platformFeeMinor: 500n,
    });

    const result = await LedgerService.recordTransaction(mockDb, tx);

    assert.equal(result.status, "inserted");
    assert.equal(result.idempotencyKey, "pay_test_001");
    assert.equal(result.entries.length, 3);
    assert.equal(executedQueries[0].sql, "BEGIN");
    assert.equal(executedQueries[executedQueries.length - 1].sql, "COMMIT");
  });

  it("handles duplicate key violation (23505) idempotently without throwing", async () => {
    const mockDb: Queryable = {
      async query(sql: string) {
        if (sql.includes("BEGIN")) return { rows: [] };
        if (sql.includes("INSERT INTO ledger_entries")) {
          const err: any = new Error("duplicate key value violates unique constraint");
          err.code = "23505";
          throw err;
        }
        if (sql.includes("ROLLBACK")) return { rows: [] };
        if (sql.includes("SELECT * FROM ledger_entries")) {
          return {
            rows: [
              { id: "existing-1", idempotency_key: "pay_test_dup:leg_0" },
              { id: "existing-2", idempotency_key: "pay_test_dup:leg_1" },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const tx = createCustomerPaymentTransaction({
      idempotencyKey: "pay_test_dup",
      paymentId: "00000000-0000-0000-0000-000000000001",
      sellerId: "00000000-0000-0000-0000-000000000002",
      grossAmountMinor: 10000n,
      platformFeeMinor: 500n,
    });

    const result = await LedgerService.recordTransaction(mockDb, tx);
    assert.equal(result.status, "already_recorded");
    assert.equal(result.idempotencyKey, "pay_test_dup");
    assert.equal(result.entries.length, 2);
  });

  it("rolls back and rethrows unexpected database errors", async () => {
    let rolledBack = false;

    const mockDb: Queryable = {
      async query(sql: string) {
        if (sql.includes("BEGIN")) return { rows: [] };
        if (sql.includes("INSERT INTO ledger_entries")) {
          throw new Error("Connection terminated unexpectedly");
        }
        if (sql.includes("ROLLBACK")) {
          rolledBack = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const tx = createCustomerPaymentTransaction({
      idempotencyKey: "pay_fail_001",
      paymentId: "00000000-0000-0000-0000-000000000001",
      sellerId: "00000000-0000-0000-0000-000000000002",
      grossAmountMinor: 10000n,
      platformFeeMinor: 500n,
    });

    await assert.rejects(
      () => LedgerService.recordTransaction(mockDb, tx),
      /Connection terminated unexpectedly/,
    );
    assert.equal(rolledBack, true);
  });
});
