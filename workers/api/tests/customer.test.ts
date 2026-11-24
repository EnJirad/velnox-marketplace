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

describe("Ecosystem Cross-App Integration Tests (Customer, Seller, Storefront)", () => {
  const app = createApplication();

  it("Customer Profile: GET /api/customer/profile and PUT /api/customer/profile", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const getRes = await app.request("/api/customer/profile", {
      headers: { Authorization: authHeader },
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as any;
    expect(getJson.success).toBe(true);
    expect(getJson.data.user.id).toBe("user-cust-1");

    const putRes = await app.request("/api/customer/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ name: "Updated Name", phone: "0812345678" }),
    });
    expect(putRes.status).toBe(200);
  });

  it("Customer Account Summary: GET /api/customer/account-summary returns badge counts", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const res = await app.request("/api/customer/account-summary", {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.unreadNotifications).toBeDefined();
    expect(json.data.unreadMessages).toBeDefined();
    expect(json.data.pendingOrders).toBeDefined();
    expect(json.data.wishlistCount).toBeDefined();
  });

  it("Customer Profile Image: upload-intent and save flows", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const intentRes = await app.request("/api/customer/profile-image/upload-intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ kind: "avatar", filename: "my-avatar.webp", mimeType: "image/webp" }),
    });
    expect(intentRes.status).toBe(200);
    const intentJson = (await intentRes.json()) as any;
    expect(intentJson.success).toBe(true);
    expect(intentJson.data.uploadUrl).toBeDefined();
    expect(intentJson.data.objectKey).toContain("user-cust-1");

    const saveRes = await app.request("/api/customer/profile-image/save", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ objectKey: intentJson.data.objectKey }),
    });
    expect(saveRes.status).toBe(200);
    const saveJson = (await saveRes.json()) as any;
    expect(saveJson.success).toBe(true);
    expect(saveJson.data.url).toContain("https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev");
  });

  it("Customer Addresses: GET, POST, DELETE /api/customer/addresses", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const postRes = await app.request("/api/customer/addresses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        label: "Home",
        recipientName: "Test User",
        phone: "0812345678",
        line1: "123 Sukhumvit Road",
        city: "Bangkok",
        postalCode: "10110",
        isDefault: true,
      }),
    });
    expect(postRes.status).toBe(201);
    const postJson = (await postRes.json()) as any;
    expect(postJson.success).toBe(true);
    const addressId = postJson.data.id;

    const getRes = await app.request("/api/customer/addresses", {
      headers: { Authorization: authHeader },
    });
    expect(getRes.status).toBe(200);

    const delRes = await app.request(`/api/customer/addresses/${addressId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });
    expect(delRes.status).toBe(200);
  });

  it("Customer Cart & Shipping Quote: GET /api/customer/cart and POST /api/customer/shipping/quote", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const cartRes = await app.request("/api/customer/cart", {
      headers: { Authorization: authHeader },
    });
    expect(cartRes.status).toBe(200);
    const cartJson = (await cartRes.json()) as any;
    expect(cartJson.success).toBe(true);

    const quoteRes = await app.request("/api/customer/shipping/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ items: [] }),
    });
    expect(quoteRes.status).toBe(200);
    const quoteJson = (await quoteRes.json()) as any;
    expect(quoteJson.success).toBe(true);
    expect(quoteJson.data.shippingFeeSatang).toBeDefined();
  });

  it("Customer Wishlist: toggle and list", async () => {
    const authHeader = await createAuthHeader("user-cust-1");

    const listRes = await app.request("/api/customer/wishlist", {
      headers: { Authorization: authHeader },
    });
    expect(listRes.status).toBe(200);

    const toggleRes = await app.request("/api/customer/wishlist/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ productId: "00000000-0000-0000-0000-000000000001" }),
    });
    expect(toggleRes.status).toBe(200);
    const toggleJson = (await toggleRes.json()) as any;
    expect(toggleJson.success).toBe(true);
    expect(toggleJson.data.wished).toBeDefined();
  });

  it("Seller Hub: GET /api/seller/status, GET /api/seller/orders, GET /api/seller/income", async () => {
    const authHeader = await createAuthHeader("user-seller-1", "seller");

    const statusRes = await app.request("/api/seller/status", {
      headers: { Authorization: authHeader },
    });
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as any;
    expect(statusJson.success).toBe(true);
    expect(statusJson.data.status).toBeDefined();

    const ordersRes = await app.request("/api/seller/orders", {
      headers: { Authorization: authHeader },
    });
    expect(ordersRes.status).toBe(200);

    const incomeRes = await app.request("/api/seller/income", {
      headers: { Authorization: authHeader },
    });
    expect(incomeRes.status).toBe(200);
    const incomeJson = (await incomeRes.json()) as any;
    expect(incomeJson.success).toBe(true);
    expect(incomeJson.data.totalSalesSatang).toBeDefined();
  });

  it("Seller Verification: GET /api/seller/verification, upload-intent, confirm", async () => {
    const authHeader = await createAuthHeader("user-seller-1", "seller");

    const verRes = await app.request("/api/seller/verification", {
      headers: { Authorization: authHeader },
    });
    expect(verRes.status).toBe(200);

    const intentRes = await app.request("/api/seller/evidence/upload-intent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ filename: "id-card.webp", mimeType: "image/webp" }),
    });
    expect(intentRes.status).toBe(200);
    const intentJson = (await intentRes.json()) as any;
    expect(intentJson.success).toBe(true);
    expect(intentJson.data.objectKey).toContain("user-seller-1");

    const confirmRes = await app.request("/api/seller/evidence/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ objectKey: intentJson.data.objectKey }),
    });
    expect(confirmRes.status).toBe(200);
  });

  it("Public Storefront: categories/tree, shops, announcements, payments/methods", async () => {
    const treeRes = await app.request("/api/categories/tree");
    expect(treeRes.status).toBe(200);
    const treeJson = (await treeRes.json()) as any;
    expect(treeJson.success).toBe(true);

    const shopsRes = await app.request("/api/shops");
    expect(shopsRes.status).toBe(200);

    const bannerRes = await app.request("/api/announcements");
    expect(bannerRes.status).toBe(200);
    const bannerJson = (await bannerRes.json()) as any;
    expect(bannerJson.success).toBe(true);
    expect(bannerJson.data.length).toBeGreaterThan(0);

    const methodsRes = await app.request("/api/payments/methods");
    expect(methodsRes.status).toBe(200);
    const methodsJson = (await methodsRes.json()) as any;
    expect(methodsJson.success).toBe(true);
    expect(methodsJson.data.length).toBeGreaterThan(0);

    const stripeRes = await app.request("/api/stripe/configured");
    expect(stripeRes.status).toBe(200);
  });
});
