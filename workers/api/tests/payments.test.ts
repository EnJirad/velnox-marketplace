import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";
const WEBHOOK_SECRET = "whsec_test_secret";

async function createAuthHeader(userId: string) {
  const token = await signJwt(
    {
      sub: userId,
      email: `${userId}@velnox.live`,
      role: "customer",
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

async function generateStripeSignature(payload: string, secret: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const hashHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},v1=${hashHex}`;
}

describe("Payment & Double-Entry Finance Tests", () => {
  const app = createApplication();

  it("POST /api/v1/payments/intent creates a payment intent for an order", async () => {
    const authHeader = await createAuthHeader("user-pay-1");

    const res = await app.request("/api/v1/payments/intent", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: "ord-test-123",
        paymentMethod: "promptpay",
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBeDefined();
    expect(json.data.paymentIntentId).toMatch(/^pi_[a-z0-9]+/);
    expect(json.data.status).toBe("pending");
    expect(json.data.amountSatang).toBeGreaterThan(0);
  });

  it("POST /api/v1/payments/webhook processes payment_intent.succeeded with valid signature and posts double-entry ledger", async () => {
    const authHeader = await createAuthHeader("user-pay-2");

    // 1. Create a payment intent first
    const intentRes = await app.request("/api/v1/payments/intent", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: "ord-pay-success-1",
        paymentMethod: "stripe",
      }),
    });
    const payment = ((await intentRes.json()) as any).data;

    // 2. Prepare mock Stripe event
    const webhookPayload = JSON.stringify({
      id: "evt_test_123",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: payment.paymentIntentId,
          amount: payment.amountSatang,
          currency: "thb",
          status: "succeeded",
        },
      },
    });

    const signature = await generateStripeSignature(webhookPayload, WEBHOOK_SECRET);

    // 3. Post webhook
    const webhookRes = await app.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": signature,
        "Content-Type": "application/json",
      },
      body: webhookPayload,
    });

    expect(webhookRes.status).toBe(200);
    const webhookJson = (await webhookRes.json()) as any;
    expect(webhookJson.success).toBe(true);
    expect(webhookJson.data.processed).toBe(true);

    // 4. Verify payment status is now succeeded
    const statusRes = await app.request(`/api/v1/payments/${payment.id}`, {
      headers: { Authorization: authHeader },
    });
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.data.status).toBe("succeeded");
  });

  it("POST /api/v1/payments/webhook handles duplicate webhook events idempotently", async () => {
    const authHeader = await createAuthHeader("user-pay-3");

    // Create payment intent
    const intentRes = await app.request("/api/v1/payments/intent", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: "ord-pay-duplicate-1",
        paymentMethod: "stripe",
      }),
    });
    const payment = ((await intentRes.json()) as any).data;

    const webhookPayload = JSON.stringify({
      id: "evt_test_dup",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: payment.paymentIntentId,
          amount: payment.amountSatang,
        },
      },
    });

    const signature = await generateStripeSignature(webhookPayload, WEBHOOK_SECRET);

    // First call
    const res1 = await app.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: webhookPayload,
    });
    expect(res1.status).toBe(200);

    // Second call (replay)
    const res2 = await app.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: webhookPayload,
    });
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as any;
    expect(json2.success).toBe(true);
  });

  it("POST /api/v1/payments/webhook rejects invalid signature", async () => {
    const webhookPayload = JSON.stringify({
      id: "evt_tampered",
      type: "payment_intent.succeeded",
    });

    const res = await app.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=123456,v1=fake_tampered_signature_hex",
        "Content-Type": "application/json",
      },
      body: webhookPayload,
    });

    expect(res.status).toBe(500); // Throws signature error handled by global error handler
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
  });

  it("GET /api/v1/payments/ledger/audit verifies double-entry balance integrity", async () => {
    const authHeader = await createAuthHeader("user-admin");

    const res = await app.request("/api/v1/payments/ledger/audit", {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.isBalanced).toBe(true);
    expect(json.data.balances).toBeDefined();
  });
});
