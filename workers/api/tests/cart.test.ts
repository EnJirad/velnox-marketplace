import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

async function createAuthHeader(userId: string) {
  const token = await signJwt(
    {
      sub: userId,
      email: "shopper@velnox.live",
      role: "customer",
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

describe("Cart Domain Tests", () => {
  const app = createApplication();

  it("GET /api/v1/cart returns empty cart structure for a new user", async () => {
    const authHeader = await createAuthHeader("user-cart-test-1");

    const res = await app.request("/api/v1/cart", {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBeDefined();
    expect(json.data.itemCount).toBe(0);
    expect(json.data.shopGroups.length).toBe(0);
    expect(json.data.totalAmount).toBe(0);
  });

  it("POST /api/v1/cart/items adds an item and groups by shop", async () => {
    const authHeader = await createAuthHeader("user-cart-test-1");

    const res = await app.request("/api/v1/cart/items", {
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

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.itemCount).toBe(2);
    expect(json.data.shopCount).toBe(1);
    expect(json.data.shopGroups.length).toBe(1);

    const group = json.data.shopGroups[0];
    expect(group.shopId).toBe("shop-001");
    expect(group.items.length).toBe(1);
    expect(group.items[0].productId).toBe("prod-001");
    expect(group.items[0].quantity).toBe(2);
    expect(group.items[0].unitPrice).toBe(29900); // 29,900 THB
    expect(group.shopSubtotal).toBe(59800);
    expect(json.data.totalAmount).toBe(59800);
  });

  it("PATCH /api/v1/cart/items/:id updates item quantity", async () => {
    const authHeader = await createAuthHeader("user-cart-test-1");

    // First get current cart to obtain item id
    const cartRes = await app.request("/api/v1/cart", {
      headers: { Authorization: authHeader },
    });
    const cart = ((await cartRes.json()) as any).data;
    const itemId = cart.shopGroups[0].items[0].id;

    // Update quantity to 3
    const updateRes = await app.request(`/api/v1/cart/items/${itemId}`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quantity: 3 }),
    });

    expect(updateRes.status).toBe(200);
    const updatedJson = (await updateRes.json()) as any;
    expect(updatedJson.data.itemCount).toBe(3);
    expect(updatedJson.data.totalAmount).toBe(89700);
  });

  it("DELETE /api/v1/cart/items/:id removes item from cart", async () => {
    const authHeader = await createAuthHeader("user-cart-test-1");

    const cartRes = await app.request("/api/v1/cart", {
      headers: { Authorization: authHeader },
    });
    const cart = ((await cartRes.json()) as any).data;
    const itemId = cart.shopGroups[0].items[0].id;

    const deleteRes = await app.request(`/api/v1/cart/items/${itemId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });

    expect(deleteRes.status).toBe(200);
    const deleteJson = (await deleteRes.json()) as any;
    expect(deleteJson.data.itemCount).toBe(0);
    expect(deleteJson.data.shopGroups.length).toBe(0);
  });

  it("DELETE /api/v1/cart clears cart completely", async () => {
    const authHeader = await createAuthHeader("user-cart-test-2");

    // Add item first
    await app.request("/api/v1/cart/items", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        productId: "prod-001",
        quantity: 1,
      }),
    });

    // Clear cart
    const clearRes = await app.request("/api/v1/cart", {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });

    expect(clearRes.status).toBe(200);
    const clearJson = (await clearRes.json()) as any;
    expect(clearJson.data.itemCount).toBe(0);
  });
});
