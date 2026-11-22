import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PaymentService } from "../../src/modules/payment/services/payment-service.ts";
import {
  verifyStripeSignature,
  calculatePlatformFeeMinor,
  calculateSellerPayableMinor,
} from "../../src/modules/payment/domain/payment.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Payment Domain — Webhook, Idempotency & Financial Accuracy", () => {
  const webhookSecret = "whsec_test_secret_key_1234567890abcdef";

  function createSignedPayload(payload: any, timestamp = Math.floor(Date.now() / 1000)) {
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const signatureHeader = `t=${timestamp},v1=${signature}`;
    return { rawBody, signatureHeader };
  }

  it("calculates platform fee satang with exact minor precision (zero-float)", () => {
    // 500.00 THB = 50,000 Satang. At 5% fee = 2,500 Satang (25.00 THB)
    const gross = 50000n;
    const fee = calculatePlatformFeeMinor(gross, 0.05);
    const sellerPayable = calculateSellerPayableMinor(gross, fee);

    assert.equal(fee, 2500n);
    assert.equal(sellerPayable, 47500n);
    assert.equal(gross, fee + sellerPayable);
  });

  it("verifies genuine Stripe webhook signatures and rejects tampered or expired ones", () => {
    const payload = { id: "evt_123", type: "checkout.session.completed" };
    const { rawBody, signatureHeader } = createSignedPayload(payload);

    // 1. Valid signature passes
    assert.equal(verifyStripeSignature(rawBody, signatureHeader, webhookSecret), true);

    // 2. Tampered body fails
    assert.equal(
      verifyStripeSignature(rawBody + "tamper", signatureHeader, webhookSecret),
      false,
    );

    // 3. Wrong secret fails
    assert.equal(
      verifyStripeSignature(rawBody, signatureHeader, "whsec_wrong_secret"),
      false,
    );

    // 4. Replay attack with expired timestamp (> 300s) fails
    const oldTimestamp = Math.floor(Date.now() / 1000) - 500;
    const old = createSignedPayload(payload, oldTimestamp);
    assert.equal(
      verifyStripeSignature(old.rawBody, old.signatureHeader, webhookSecret, 300),
      false,
    );
  });

  it("claims webhook events idempotently and returns duplicate flag on redelivery", async () => {
    const claimedEvents = new Set<string>();

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("INSERT INTO payment_events")) {
          const eventId = params?.[1];
          if (claimedEvents.has(eventId)) {
            return { rows: [] }; // Conflict
          }
          claimedEvents.add(eventId);
          return { rows: [{ id: "pe_001", status: "processing" }] };
        }
        if (q.includes("SELECT id, status FROM payment_events")) {
          return { rows: [{ id: "pe_001", status: "processed" }] };
        }
        if (q.includes("UPDATE payment_events SET status = 'processed'")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const payload = {
      id: "evt_duplicate_check_001",
      type: "unhandled.event.audit",
      data: { object: { id: "obj_1" } },
    };
    const { rawBody, signatureHeader } = createSignedPayload(payload);

    // First delivery -> processed
    const res1 = await PaymentService.handleStripeWebhook(
      mockDb,
      rawBody,
      signatureHeader,
      webhookSecret,
    );
    assert.equal(res1.received, true);
    assert.equal(res1.duplicate, false);

    // Second delivery of same event -> duplicate acknowledged without re-running
    const res2 = await PaymentService.handleStripeWebhook(
      mockDb,
      rawBody,
      signatureHeader,
      webhookSecret,
    );
    assert.equal(res2.received, true);
    assert.equal(res2.duplicate, true);
  });

  it("settles single-order payment: commits inventory and posts balanced ledger entries", async () => {
    let orderPaid = false;
    let paymentPaid = false;
    let stockCommitted = false;
    let commissionCreated = false;
    const ledgerEntriesInserted: any[] = [];

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("BEGIN") || q.includes("COMMIT") || q.includes("ROLLBACK")) {
          return { rows: [] };
        }
        if (q.includes("INSERT INTO payment_events")) {
          return { rows: [{ id: "pe_1", status: "processing" }] };
        }
        if (q.includes("SELECT * FROM payments WHERE provider_checkout_session_id")) {
          return {
            rows: [
              {
                id: "pay_001",
                order_id: "ord_100",
                checkout_group_id: null,
                amount: "1000.00",
                currency: "THB",
                method: "card",
                status: "requires_action",
                provider: "stripe",
              },
            ],
          };
        }
        if (q.includes("SELECT id, shop_id, status, total_amount, checkout_group_id")) {
          return {
            rows: [
              {
                id: "ord_100",
                shop_id: "shop_alpha",
                status: "pending_payment",
                total_amount: "1000.00",
                checkout_group_id: null,
                inventory_released: false,
              },
            ],
          };
        }
        if (q.includes("UPDATE orders") && q.includes("SET status = 'paid'")) {
          orderPaid = true;
          return {
            rows: [
              {
                id: "ord_100",
                shop_id: "shop_alpha",
                status: "paid",
                total_amount: "1000.00",
                checkout_group_id: null,
              },
            ],
          };
        }
        if (q.includes("UPDATE payments") && q.includes("SET status = $2")) {
          paymentPaid = true;
          return { rows: [{ id: "pay_001", status: "paid" }] };
        }
        if (q.includes("FROM order_items")) {
          return {
            rows: [
              { id: "oi_1", order_id: "ord_100", product_id: "prod_1", variant_id: null, quantity: 2 },
            ],
          };
        }
        if (q.includes("UPDATE inventory") && q.includes("quantity = GREATEST(0, quantity - $1)")) {
          stockCommitted = true;
          return { rows: [{ id: "inv_1" }] };
        }
        if (q.includes("SELECT seller_id FROM shops WHERE id = $1")) {
          return { rows: [{ seller_id: "seller_alpha" }] };
        }
        if (q.includes("INSERT INTO ledger_entries")) {
          ledgerEntriesInserted.push({
            id: `le_${ledgerEntriesInserted.length + 1}`,
            idempotency_key: params?.[0],
            account: params?.[2],
            direction: params?.[3],
            amount_minor: params?.[4],
          });
          return { rows: [ledgerEntriesInserted[ledgerEntriesInserted.length - 1]] };
        }
        if (q.includes("INSERT INTO commissions")) {
          commissionCreated = true;
          return { rows: [{ id: "comm_1" }] };
        }
        if (q.includes("UPDATE payment_events SET status = $2")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const payload = {
      id: "evt_checkout_completed_001",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_stripe_session_123",
          payment_status: "paid",
          payment_intent: "pi_stripe_intent_123",
          metadata: { orderId: "ord_100" },
        },
      },
    };
    const { rawBody, signatureHeader } = createSignedPayload(payload);

    const result = await PaymentService.handleStripeWebhook(
      mockDb,
      rawBody,
      signatureHeader,
      webhookSecret,
    );

    assert.equal(result.received, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.settledOrdersCount, 1);
    assert.equal(orderPaid, true);
    assert.equal(paymentPaid, true);
    assert.equal(stockCommitted, true);
    assert.equal(commissionCreated, true);

    // Verify double-entry ledger postings:
    // Order amount = 1,000.00 THB = 100,000 Satang
    // Platform fee (5%) = 5,000 Satang
    // Seller payable = 95,000 Satang
    assert.equal(ledgerEntriesInserted.length, 3);
    const debitCash = ledgerEntriesInserted.find((e) => e.account === "platform_cash");
    const creditSeller = ledgerEntriesInserted.find((e) => e.account === "seller_payable");
    const creditRevenue = ledgerEntriesInserted.find((e) => e.account === "platform_revenue");

    assert.ok(debitCash);
    assert.ok(creditSeller);
    assert.ok(creditRevenue);

    assert.equal(debitCash.direction, "debit");
    assert.equal(debitCash.amount_minor, "100000");

    assert.equal(creditSeller.direction, "credit");
    assert.equal(creditSeller.amount_minor, "95000");

    assert.equal(creditRevenue.direction, "credit");
    assert.equal(creditRevenue.amount_minor, "5000");

    // Exact double-entry balance check: Total Debits == Total Credits
    assert.equal(
      BigInt(debitCash.amount_minor),
      BigInt(creditSeller.amount_minor) + BigInt(creditRevenue.amount_minor),
    );
  });

  it("handles payment expiration by releasing reserved stock and marking order cancelled", async () => {
    let orderCancelled = false;
    let stockReleased = false;

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("INSERT INTO payment_events")) {
          return { rows: [{ id: "pe_exp_1", status: "processing" }] };
        }
        if (q.includes("SELECT * FROM payments WHERE provider_checkout_session_id")) {
          return {
            rows: [
              {
                id: "pay_exp_001",
                order_id: "ord_exp_100",
                checkout_group_id: null,
                status: "requires_action",
              },
            ],
          };
        }
        if (q.includes("SELECT id, shop_id, status, total_amount, checkout_group_id")) {
          return {
            rows: [
              {
                id: "ord_exp_100",
                status: "pending_payment",
                total_amount: "500.00",
                inventory_released: false,
              },
            ],
          };
        }
        if (q.includes("UPDATE orders") && q.includes("status = $2")) {
          orderCancelled = true;
          return { rows: [{ id: "ord_exp_100", status: "cancelled" }] };
        }
        if (q.includes("UPDATE payments SET status = $2")) {
          return { rows: [{ id: "pay_exp_001", status: "cancelled" }] };
        }
        if (q.includes("FROM order_items")) {
          return {
            rows: [
              { id: "oi_exp_1", order_id: "ord_exp_100", product_id: "prod_1", variant_id: null, quantity: 1 },
            ],
          };
        }
        if (q.includes("UPDATE inventory") && q.includes("reserved = GREATEST(0, reserved - $1)")) {
          stockReleased = true;
          return { rows: [{ id: "inv_1" }] };
        }
        if (q.includes("UPDATE payment_events SET status = $2")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const payload = {
      id: "evt_session_expired_001",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_expired_session_123",
          metadata: { orderId: "ord_exp_100" },
        },
      },
    };
    const { rawBody, signatureHeader } = createSignedPayload(payload);

    const result = await PaymentService.handleStripeWebhook(
      mockDb,
      rawBody,
      signatureHeader,
      webhookSecret,
    );

    assert.equal(result.received, true);
    assert.equal(orderCancelled, true);
    assert.equal(stockReleased, true);
  });
});
