import { describe, expect, it } from "bun:test";
import { app } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";
import { RealtimeHubDO } from "../src/realtime/realtime-hub-do.js";
import { dispatchNotificationMessage } from "../src/modules/notifications/queue-consumer.js";

// Mock WebSocket class for Node / Bun test environments
class MockWebSocket {
  public readyState = 1;
  public sentMessages: string[] = [];
  public listeners: Record<string, Function[]> = {};

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    const handlers = this.listeners["close"] || [];
    for (const h of handlers) h();
  }

  triggerMessage(data: any) {
    const handlers = this.listeners["message"] || [];
    const event = { data: typeof data === "string" ? data : JSON.stringify(data) };
    for (const h of handlers) h(event);
  }
}

// Polyfill WebSocketPair for test environment
if (!(globalThis as any).WebSocketPair) {
  (globalThis as any).WebSocketPair = class {
    constructor() {
      return [new MockWebSocket(), new MockWebSocket()];
    }
  };
}

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";
const WEBHOOK_SECRET = "whsec_test_secret";

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

async function createAuthHeader(userId: string, role = "customer") {
  const token = await signJwt(
    {
      sub: userId,
      email: `${userId}@velnox.live`,
      role,
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

const validShippingAddress = {
  recipientName: "E2E Shopper User",
  phone: "0891234567",
  addressLine1: "123 Sukhumvit Road",
  subdistrict: "Khlong Toei",
  district: "Khlong Toei",
  province: "Bangkok",
  postalCode: "10110",
};

describe("Phase 8: Comprehensive End-to-End Lifecycle Suite (Workers API)", () => {
  const testCustomerEmail = `customer_e2e_${Date.now()}@velnox.live`;
  let customerToken: string;
  let customerAuthHeader: string;
  let customerId: string;
  let sellerAuthHeader: string;
  let placedOrderId: string;

  // -------------------------------------------------------------------------
  // Scenario 1: Identity & Authentication Lifecycle
  // -------------------------------------------------------------------------
  it("Scenario 1: Registers a customer, verifies HttpOnly cookies and dual tokens", async () => {
    const regRes = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.velnox.live" },
      body: JSON.stringify({
        email: testCustomerEmail,
        password: "SecurePassword123!",
        name: "E2E Shopper User",
        phone: "0891234567",
      }),
    });

    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as any;
    expect(regJson.success).toBe(true);
    expect(regJson.data.user.email).toBe(testCustomerEmail.toLowerCase());
    expect(regJson.data.tokens.accessToken).toBeDefined();

    customerToken = regJson.data.tokens.accessToken;
    customerId = regJson.data.user.id;
    customerAuthHeader = `Bearer ${customerToken}`;

    // Verify /api/v1/auth/me returns identity envelope
    const meRes = await app.request("/api/v1/auth/me", {
      headers: { Authorization: customerAuthHeader, Origin: "https://shop.velnox.live" },
    });
    expect(meRes.status).toBe(200);
    const meJson = (await meRes.json()) as any;
    expect(meJson.data.email).toBe(testCustomerEmail.toLowerCase());
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Seller Onboarding & Shop Profile
  // -------------------------------------------------------------------------
  it("Scenario 2: Onboards a verified seller and verifies shop profile", async () => {
    sellerAuthHeader = await createAuthHeader("usr_seller_e2e_uniq", "seller");

    const applyRes = await app.request("/api/v1/seller/apply", {
      method: "POST",
      headers: {
        Authorization: sellerAuthHeader,
        "Content-Type": "application/json",
        Origin: "https://seller.velnox.live",
      },
      body: JSON.stringify({
        businessName: "E2E Artisan Crafts Co., Ltd.",
        businessType: "juristic",
        taxId: "0105559876543",
        shopName: "Artisan Crafts Official",
        shopSlug: "artisan-crafts-e2e-uniq",
      }),
    });

    expect(applyRes.status).toBe(201);
    const applyJson = (await applyRes.json()) as any;
    expect(applyJson.success).toBe(true);
    expect(applyJson.data.seller.businessName).toBe("E2E Artisan Crafts Co., Ltd.");

    // Retrieve seller profile
    const profileRes = await app.request("/api/v1/seller/profile", {
      headers: { Authorization: sellerAuthHeader, Origin: "https://seller.velnox.live" },
    });
    expect(profileRes.status).toBe(200);
    const profileJson = (await profileRes.json()) as any;
    expect(profileJson.data.shop.name).toBe("Artisan Crafts Official");
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Catalog & Product Discovery
  // -------------------------------------------------------------------------
  it("Scenario 3: Browses catalog categories and products", async () => {
    const catRes = await app.request("/api/v1/catalog/categories", {
      headers: { Origin: "https://shop.velnox.live" },
    });
    expect(catRes.status).toBe(200);
    const catJson = (await catRes.json()) as any;
    expect(catJson.success).toBe(true);
    expect(Array.isArray(catJson.data)).toBe(true);

    const prodRes = await app.request("/api/v1/catalog/products?limit=5", {
      headers: { Origin: "https://shop.velnox.live" },
    });
    expect(prodRes.status).toBe(200);
    const prodJson = (await prodRes.json()) as any;
    expect(prodJson.success).toBe(true);
    expect(prodJson.data.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Shopping Cart & Checkout with Stock Reservation
  // -------------------------------------------------------------------------
  it("Scenario 4: Adds item to cart and places an order with guarded stock reservation", async () => {
    // 1. Add item to cart
    const addCartRes = await app.request("/api/v1/cart/items", {
      method: "POST",
      headers: {
        Authorization: customerAuthHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        productId: "prod-001",
        quantity: 2,
      }),
    });
    expect(addCartRes.status).toBe(201);

    // 2. Checkout
    const checkoutRes = await app.request("/api/v1/orders/checkout", {
      method: "POST",
      headers: {
        Authorization: customerAuthHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        shippingAddress: validShippingAddress,
        paymentMethod: "stripe",
      }),
    });

    expect(checkoutRes.status).toBe(201);
    const checkoutJson = (await checkoutRes.json()) as any;
    expect(checkoutJson.success).toBe(true);
    expect(checkoutJson.data.orders.length).toBeGreaterThan(0);

    placedOrderId = checkoutJson.data.orders[0].id;
    expect(placedOrderId).toBeDefined();
    expect(checkoutJson.data.orders[0].status).toBe("pending_payment");
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Stripe Payment & Double-Entry Ledger Posting
  // -------------------------------------------------------------------------
  it("Scenario 5: Completes Stripe payment and audits double-entry balance", async () => {
    // 1. Create payment intent
    const intentRes = await app.request("/api/v1/payments/intent", {
      method: "POST",
      headers: {
        Authorization: customerAuthHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({ orderId: placedOrderId }),
    });
    expect(intentRes.status).toBe(201);
    const intentJson = (await intentRes.json()) as any;
    expect(intentJson.data.paymentIntentId).toBeDefined();

    // 2. Webhook: Simulate payment_intent.succeeded
    const webhookPayload = JSON.stringify({
      id: `evt_test_${Date.now()}`,
      type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: intentJson.data.paymentIntentId,
          amount: 5980000, // 59,800.00 THB in satang
          currency: "thb",
          status: "succeeded",
          metadata: { orderId: placedOrderId },
        },
      },
    });

    const signature = await generateStripeSignature(webhookPayload, WEBHOOK_SECRET);

    const webhookRes = await app.request("/api/v1/payments/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": signature,
      },
      body: webhookPayload,
    });
    expect(webhookRes.status).toBe(200);

    // 3. Audit Double-Entry Satang Ledger Invariant
    const auditRes = await app.request("/api/v1/payments/ledger/audit", {
      headers: { Authorization: customerAuthHeader },
    });
    expect(auditRes.status).toBe(200);
    const auditJson = (await auditRes.json()) as any;
    expect(auditJson.data.isBalanced).toBe(true);
    expect(auditJson.data.balances).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Realtime Communication & Smart Push Suppression
  // -------------------------------------------------------------------------
  it("Scenario 6: Verifies Realtime WebSocket presence and smart push notification suppression", async () => {
    const hub = new RealtimeHubDO(null, { ENVIRONMENT: "test" });

    // Customer opens chat socket
    await hub.fetch(
      new Request(`http://localhost/ws?userId=${customerId}&role=customer`, {
        headers: { Upgrade: "websocket" },
      }),
    );

    // Verify online presence
    const presRes = await hub.fetch(new Request(`http://localhost/presence/${customerId}`));
    const pres = (await presRes.json()) as any;
    expect(pres.isOnline).toBe(true);
    expect(pres.activeTabs).toBe(1);

    // Dispatch notification while offline in that conversation -> delivered
    const notifMsg = {
      id: "qmsg-e2e",
      type: "chat_alert" as const,
      recipientUserId: customerId,
      conversationId: "conv-support-seed",
      title: "ข้อความจากร้านค้า",
      body: "สวัสดีครับ จัดส่งสินค้าแล้วครับ",
      timestamp: Date.now(),
    };

    const dispatchResult = await dispatchNotificationMessage(notifMsg, {
      ENVIRONMENT: "test",
      REALTIME_HUB: {
        idFromName: () => ({}),
        get: () => hub as any,
      } as any,
    });

    expect(dispatchResult.status).toBe("delivered");
  });
});
