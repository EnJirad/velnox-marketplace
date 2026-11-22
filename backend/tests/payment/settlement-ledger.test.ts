import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentService } from "../../src/modules/payment/services/payment-service.ts";
import { LedgerDomainService } from "../../src/modules/ledger/services/ledger-domain-service.ts";
import type { DbQueryable } from "../../../database/src/types.ts";
import { ConflictError, ValidationError } from "../../src/core/errors/app-error.ts";

describe("Payment Domain — Automated Settlement Engine & Ledger Auditing", () => {
  it("executes seller settlement: debits seller_payable and credits platform_cash", async () => {
    let settlementCreated = false;
    let settlementCompleted = false;
    const ledgerEntries: any[] = [];

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("BEGIN") || q.includes("COMMIT") || q.includes("ROLLBACK")) {
          return { rows: [] };
        }
        // Seller payable balance query
        if (q.includes("account = 'seller_payable' AND seller_id = $1")) {
          return {
            rows: [
              { direction: "credit", total: "150000" }, // 1,500.00 THB earned
              { direction: "debit", total: "50000" },   // 500.00 THB already settled
            ],
          }; // Net available: 100,000 Satang (1,000.00 THB)
        }
        if (q.includes("INSERT INTO settlements")) {
          settlementCreated = true;
          return { rows: [{ id: "stl_001" }] };
        }
        if (q.includes("INSERT INTO ledger_entries")) {
          ledgerEntries.push({
            id: `le_${ledgerEntries.length + 1}`,
            idempotency_key: params?.[0],
            account: params?.[2],
            direction: params?.[3],
            amount_minor: params?.[4],
          });
          return { rows: [ledgerEntries[ledgerEntries.length - 1]] };
        }
        if (q.includes("UPDATE settlements SET status = $2")) {
          settlementCompleted = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    // Attempt to settle 80,000 Satang (800.00 THB) - should succeed
    const result = await PaymentService.executeSellerSettlement(
      mockDb,
      "seller_uuid_123",
      80000n,
      "corr_payout_001",
    );

    assert.equal(result.settlementId, "stl_001");
    assert.equal(result.amountMinor, 80000n);
    assert.equal(result.status, "completed");
    assert.equal(settlementCreated, true);
    assert.equal(settlementCompleted, true);

    // Verify double-entry:
    // Debit seller_payable: 80,000 Satang
    // Credit platform_cash: 80,000 Satang
    assert.equal(ledgerEntries.length, 2);
    const debitSeller = ledgerEntries.find((e) => e.account === "seller_payable");
    const creditCash = ledgerEntries.find((e) => e.account === "platform_cash");

    assert.ok(debitSeller);
    assert.ok(creditCash);
    assert.equal(debitSeller.direction, "debit");
    assert.equal(debitSeller.amount_minor, "80000");
    assert.equal(creditCash.direction, "credit");
    assert.equal(creditCash.amount_minor, "80000");
  });

  it("refuses seller settlement if requested amount exceeds accrued payable balance", async () => {
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("account = 'seller_payable'")) {
          return {
            rows: [
              { direction: "credit", total: "50000" }, // 500.00 THB
              { direction: "debit", total: "40000" },  // 400.00 THB
            ],
          }; // Net available = 10,000 Satang (100.00 THB)
        }
        return { rows: [] };
      },
    };

    // Try to settle 20,000 Satang when only 10,000 is available
    await assert.rejects(
      async () => {
        await PaymentService.executeSellerSettlement(mockDb, "seller_uuid_123", 20000n);
      },
      (err: any) => {
        assert.ok(err instanceof ConflictError);
        assert.equal(err.code, "INSUFFICIENT_PAYABLE_BALANCE");
        return true;
      },
    );
  });

  it("calculates account balances according to natural accounting signs", async () => {
    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const account = params?.[0];
        if (account === "platform_cash") {
          // Cash is an Asset: Debit normal (Debit - Credit)
          return {
            rows: [
              { direction: "debit", total: "1000000" }, // 10,000 THB received
              { direction: "credit", total: "200000" },  // 2,000 THB paid out
            ],
          };
        }
        if (account === "platform_revenue") {
          // Revenue is Credit normal (Credit - Debit)
          return {
            rows: [
              { direction: "credit", total: "50000" }, // 500 THB commission earned
            ],
          };
        }
        return { rows: [] };
      },
    };

    const cashBalance = await LedgerDomainService.getAccountBalance(
      mockDb,
      "platform_cash",
    );
    assert.equal(cashBalance.totalDebitMinor, 1000000n);
    assert.equal(cashBalance.totalCreditMinor, 200000n);
    assert.equal(cashBalance.netBalanceMinor, 800000n); // 8,000 THB in vault

    const revenueBalance = await LedgerDomainService.getAccountBalance(
      mockDb,
      "platform_revenue",
    );
    assert.equal(revenueBalance.netBalanceMinor, 50000n); // 500 THB revenue
  });

  it("verifies mathematical integrity across all ledger entries in database", async () => {
    const mockDbBalanced: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("GROUP BY direction")) {
          return {
            rows: [
              { direction: "debit", total: "5000000", count: 50 },
              { direction: "credit", total: "5000000", count: 75 },
            ],
          };
        }
        if (sql.includes("WHERE amount_minor <= 0")) {
          return { rows: [{ count: 0 }] };
        }
        return { rows: [] };
      },
    };

    const audit = await LedgerDomainService.verifyLedgerIntegrity(mockDbBalanced);
    assert.equal(audit.isBalanced, true);
    assert.equal(audit.totalDebitsMinor, 5000000n);
    assert.equal(audit.totalCreditsMinor, 5000000n);
    assert.equal(audit.discrepancyMinor, 0n);
    assert.equal(audit.totalEntriesCount, 125);
    assert.equal(audit.invalidNegativeEntriesCount, 0);
  });
});
