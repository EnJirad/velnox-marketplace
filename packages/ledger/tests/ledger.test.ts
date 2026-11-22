import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateTransaction,
  assertBalancedTransaction,
  LedgerInvariantViolationError,
  createCustomerPaymentTransaction,
  createSellerSettlementTransaction,
  createRefundTransaction,
} from "../src/index.ts";
import type { LedgerTransaction } from "../src/types.ts";

describe("@velnox/ledger Invariant Rules", () => {
  it("approves a perfectly balanced double-entry transaction", () => {
    const tx: LedgerTransaction = {
      idempotencyKey: "test-valid-001",
      postings: [
        {
          account: "platform_cash",
          entryType: "charge",
          direction: "debit",
          amountMinor: 10000n, // 100.00 THB
        },
        {
          account: "seller_payable",
          entryType: "seller_payable",
          direction: "credit",
          amountMinor: 9500n, // 95.00 THB
        },
        {
          account: "platform_revenue",
          entryType: "platform_fee",
          direction: "credit",
          amountMinor: 500n, // 5.00 THB
        },
      ],
    };

    const result = validateTransaction(tx);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.totalDebitMinor, 10000n);
    assert.equal(result.totalCreditMinor, 10000n);
    assert.doesNotThrow(() => assertBalancedTransaction(tx));
  });

  it("rejects an unbalanced transaction where debits != credits", () => {
    const tx: LedgerTransaction = {
      idempotencyKey: "test-unbalanced-001",
      postings: [
        {
          account: "platform_cash",
          entryType: "charge",
          direction: "debit",
          amountMinor: 10000n,
        },
        {
          account: "seller_payable",
          entryType: "seller_payable",
          direction: "credit",
          amountMinor: 9000n, // Missing 1000n credit
        },
      ],
    };

    const result = validateTransaction(tx);
    assert.equal(result.isValid, false);
    assert.match(result.errors[0], /Double-entry imbalance/);
    assert.throws(
      () => assertBalancedTransaction(tx),
      LedgerInvariantViolationError,
    );
  });

  it("rejects zero or negative amounts", () => {
    const tx: LedgerTransaction = {
      idempotencyKey: "test-zero-amount",
      postings: [
        {
          account: "platform_cash",
          entryType: "charge",
          direction: "debit",
          amountMinor: 0n,
        },
        {
          account: "seller_payable",
          entryType: "seller_payable",
          direction: "credit",
          amountMinor: 0n,
        },
      ],
    };

    const result = validateTransaction(tx);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("must be strictly greater than 0n")));
  });

  it("rejects floating-point numbers or non-bigint types", () => {
    const tx: any = {
      idempotencyKey: "test-float",
      postings: [
        {
          account: "platform_cash",
          entryType: "charge",
          direction: "debit",
          amountMinor: 100.5, // float is forbidden
        },
        {
          account: "seller_payable",
          entryType: "seller_payable",
          direction: "credit",
          amountMinor: 100.5,
        },
      ],
    };

    const result = validateTransaction(tx);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("must be a bigint")));
  });

  it("rejects empty idempotency keys", () => {
    const tx: LedgerTransaction = {
      idempotencyKey: "",
      postings: [
        {
          account: "platform_cash",
          entryType: "settlement",
          direction: "debit",
          amountMinor: 5000n,
        },
        {
          account: "seller_payable",
          entryType: "settlement",
          direction: "credit",
          amountMinor: 5000n,
        },
      ],
    };

    const result = validateTransaction(tx);
    assert.equal(result.isValid, false);
    assert.ok(result.errors.some((e) => e.includes("non-empty idempotencyKey")));
  });

  it("constructs customer payment transactions correctly", () => {
    const tx = createCustomerPaymentTransaction({
      idempotencyKey: "ch_payment_123",
      paymentId: "00000000-0000-0000-0000-000000000001",
      sellerId: "00000000-0000-0000-0000-000000000002",
      grossAmountMinor: 150000n, // 1,500.00 THB
      platformFeeMinor: 7500n,   // 75.00 THB (5%)
    });

    assert.equal(tx.postings.length, 3);
    assert.equal(tx.postings[0].account, "platform_cash");
    assert.equal(tx.postings[0].direction, "debit");
    assert.equal(tx.postings[0].amountMinor, 150000n);

    assert.equal(tx.postings[1].account, "seller_payable");
    assert.equal(tx.postings[1].direction, "credit");
    assert.equal(tx.postings[1].amountMinor, 142500n);

    assert.equal(tx.postings[2].account, "platform_revenue");
    assert.equal(tx.postings[2].direction, "credit");
    assert.equal(tx.postings[2].amountMinor, 7500n);
  });

  it("constructs seller settlement transactions correctly", () => {
    const tx = createSellerSettlementTransaction({
      idempotencyKey: "settle_001",
      settlementId: "00000000-0000-0000-0000-000000000003",
      sellerId: "00000000-0000-0000-0000-000000000002",
      amountMinor: 142500n,
    });

    assert.equal(tx.postings.length, 2);
    assert.equal(tx.postings[0].account, "seller_payable");
    assert.equal(tx.postings[0].direction, "debit");
    assert.equal(tx.postings[0].amountMinor, 142500n);

    assert.equal(tx.postings[1].account, "platform_cash");
    assert.equal(tx.postings[1].direction, "credit");
    assert.equal(tx.postings[1].amountMinor, 142500n);
  });

  it("constructs customer refund transactions correctly", () => {
    const tx = createRefundTransaction({
      idempotencyKey: "ref_001",
      refundId: "00000000-0000-0000-0000-000000000004",
      refundAmountMinor: 50000n, // 500.00 THB
    });

    assert.equal(tx.postings.length, 2);
    assert.equal(tx.postings[0].account, "refund_clearing");
    assert.equal(tx.postings[0].direction, "debit");
    assert.equal(tx.postings[0].amountMinor, 50000n);

    assert.equal(tx.postings[1].account, "platform_cash");
    assert.equal(tx.postings[1].direction, "credit");
    assert.equal(tx.postings[1].amountMinor, 50000n);
  });
});
