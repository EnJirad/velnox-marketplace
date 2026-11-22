import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

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

const testShippingAddress = {
  recipientName: "Somchai Jaidee",
  phone: "0812345678",
  addressLine1: "123 Sukhumvit Road, Soi 55",
  subdistrict: "Khlong Tan Nuea",
  district: "Watthana",
  province: "Bangkok",
  postalCode: "10110",
  isDefault: true,
};

describe("Order & Checkout Domain Tests", () => {
  const app = createApplication();

  it("POST /api/v1/orders/checkout rejects checkout on empty cart", async () => {
    const authHeader = await createAuthHeader("user-order-empty-cart");

    const res = await app.request("/api/v1/orders/checkout", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shippingAddress: testShippingAddress,
        paymentMethod: "promptpay",
      }),
    });

    expect(res.status).toBe(500); // Throws error handled by errorHandler
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
  });

  it("POST /api/v1/orders/checkout successfully places multi-vendor order from cart", async () => {
    const authHeader = await createAuthHeader("user-order-happy-path");

    // 1. Add item to cart
    await app.request("/api/v1/cart/items", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId: "prod-001",
        quantity: 2,
      }),
    });

    // 2. Checkout
    const checkoutRes = await app.request("/api/v1/orders/checkout", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shippingAddress: testShippingAddress,
        paymentMethod: "promptpay",
        notes: "Please call upon arrival",
      }),
    });

    expect(checkoutRes.status).toBe(201);
    const json = (await checkoutRes.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.orders)).toBe(true);
    expect(json.data.orders.length).toBe(1);

    const order = json.data.orders[0];
    expect(order.orderNumber).toMatch(/^ORD-\d{8}-[A-Z0-9]{6}$/);
    expect(order.status).toBe("pending_payment");
    expect(order.paymentStatus).toBe("unpaid");
    expect(order.totalAmount).toBe(59800); // 29,900 x 2
    expect(json.data.totalSatang).toBe(5980000); // 59,800.00 THB in satang
    expect(order.items.length).toBe(1);
    expect(order.items[0].quantity).toBe(2);

    // 3. Verify cart was cleared after checkout
    const cartRes = await app.request("/api/v1/cart", {
      headers: { Authorization: authHeader },
    });
    const cartJson = (await cartRes.json()) as any;
    expect(cartJson.data.itemCount).toBe(0);
  });

  it("GET /api/v1/orders lists orders for authenticated customer", async () => {
    const authHeader = await createAuthHeader("user-order-happy-path");

    const res = await app.request("/api/v1/orders", {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);
    expect(json.pagination).toBeDefined();
  });

  it("GET /api/v1/orders/:id retrieves order and enforces authorization", async () => {
    const authHeaderOwner = await createAuthHeader("user-order-happy-path");

    // Fetch order ID
    const listRes = await app.request("/api/v1/orders", {
      headers: { Authorization: authHeaderOwner },
    });
    const orders = ((await listRes.json()) as any).data;
    const orderId = orders[0].id;

    // Owner can view order
    const res = await app.request(`/api/v1/orders/${orderId}`, {
      headers: { Authorization: authHeaderOwner },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.id).toBe(orderId);
    expect(json.data.items).toBeDefined();

    // Another customer is forbidden
    const authHeaderStranger = await createAuthHeader("user-stranger-customer");
    const forbiddenRes = await app.request(`/api/v1/orders/${orderId}`, {
      headers: { Authorization: authHeaderStranger },
    });
    expect(forbiddenRes.status).toBe(500); // Throws forbidden error handled by error handler
  });

  it("POST /api/v1/orders/:id/cancel cancels an unpaid pending order", async () => {
    const authHeader = await createAuthHeader("user-order-happy-path");

    // Fetch order ID
    const listRes = await app.request("/api/v1/orders", {
      headers: { Authorization: authHeader },
    });
    const orderId = ((await listRes.json()) as any).data[0].id;

    const cancelRes = await app.request(`/api/v1/orders/${orderId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reason: "Changed mind" }),
    });

    expect(cancelRes.status).toBe(200);
    const cancelJson = (await cancelRes.json()) as any;
    expect(cancelJson.success).toBe(true);
    expect(cancelJson.data.status).toBe("cancelled");
    expect(cancelJson.data.cancellationReason).toBe("Changed mind");
  });

  it("PATCH /api/v1/orders/:id/status transitions state machine accurately", async () => {
    const authHeader = await createAuthHeader("user-order-state-machine");

    // Setup: add item and checkout
    await app.request("/api/v1/cart/items", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ productId: "prod-001", quantity: 1 }),
    });

    const checkoutRes = await app.request("/api/v1/orders/checkout", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shippingAddress: testShippingAddress,
        paymentMethod: "promptpay",
      }),
    });
    const orderId = ((await checkoutRes.json()) as any).data.orders[0].id;

    // Transition: pending_payment -> paid
    const paidRes = await app.request(`/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "paid" }),
    });
    expect(paidRes.status).toBe(200);
    expect(((await paidRes.json()) as any).data.status).toBe("paid");

    // Transition: paid -> processing
    const procRes = await app.request(`/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "processing" }),
    });
    expect(procRes.status).toBe(200);
    expect(((await procRes.json()) as any).data.status).toBe("processing");

    // Transition: processing -> shipped
    const shipRes = await app.request(`/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "shipped" }),
    });
    expect(shipRes.status).toBe(200);
    expect(((await shipRes.json()) as any).data.status).toBe("shipped");

    // Transition: shipped -> delivered
    const delivRes = await app.request(`/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "delivered" }),
    });
    expect(delivRes.status).toBe(200);
    expect(((await delivRes.json()) as any).data.status).toBe("delivered");

    // Invalid transition: delivered -> processing (should be rejected)
    const invalidRes = await app.request(`/api/v1/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "processing" }),
    });
    expect(invalidRes.status).toBe(500); // Throws invalid state transition error
  });
});
