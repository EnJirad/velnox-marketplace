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

describe("Phase 6: Frontend Pages -> Workers API Integration Tests", () => {
  const app = createApplication();

  it("handles CORS preflight and credentials for all Cloudflare Pages frontends", async () => {
    const frontendOrigins = [
      "https://shop.velnox.live",
      "https://seller.velnox.live",
      "https://center.velnox.live",
      "https://velnox.live",
      "http://localhost:5173",
    ];

    for (const origin of frontendOrigins) {
      const res = await app.request("/api/products", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "Content-Type,Authorization",
        },
      });

      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  it("VelShop Catalog: GET /api/products and /api/categories return real structured envelopes", async () => {
    // 1. Fetch categories
    const catRes = await app.request("/api/categories", {
      headers: { Origin: "https://shop.velnox.live" },
    });
    expect(catRes.status).toBe(200);
    const catJson = (await catRes.json()) as any;
    expect(catJson.success).toBe(true);
    expect(Array.isArray(catJson.data)).toBe(true);

    // 2. Fetch products
    const prodRes = await app.request("/api/products?limit=10", {
      headers: { Origin: "https://shop.velnox.live" },
    });
    expect(prodRes.status).toBe(200);
    const prodJson = (await prodRes.json()) as any;
    expect(prodJson.success).toBe(true);
    expect(Array.isArray(prodJson.data)).toBe(true);
    expect(prodJson.pagination).toBeDefined();

    // 3. Fetch product detail
    const prodId = prodJson.data[0].id;
    const detailRes = await app.request(`/api/products/${prodId}`, {
      headers: { Origin: "https://shop.velnox.live" },
    });
    expect(detailRes.status).toBe(200);
    const detailJson = (await detailRes.json()) as any;
    expect(detailJson.success).toBe(true);
    expect(detailJson.data.id).toBe(prodId);
  });

  it("VelShop Cart & Checkout Journey: Full unversioned /api/* flow works seamlessly", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");

    // 1. Get initial cart
    const cartRes = await app.request("/api/cart", {
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });
    expect(cartRes.status).toBe(200);

    // 2. Add product to cart
    const addRes = await app.request("/api/cart/items", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        productId: "prod-001",
        quantity: 1,
      }),
    });
    expect(addRes.status).toBe(201);
    const addJson = (await addRes.json()) as any;
    expect(addJson.data.itemCount).toBe(1);

    // 3. Checkout from cart
    const checkoutRes = await app.request("/api/orders/checkout", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        shippingAddress: {
          recipientName: "Customer Frontend",
          phone: "0891234567",
          addressLine1: "99 Rama 9 Road",
          subdistrict: "Huai Khwang",
          district: "Huai Khwang",
          province: "Bangkok",
          postalCode: "10310",
        },
        paymentMethod: "promptpay",
      }),
    });
    expect(checkoutRes.status).toBe(201);
    const checkoutJson = (await checkoutRes.json()) as any;
    expect(checkoutJson.success).toBe(true);
    expect(checkoutJson.data.orders.length).toBeGreaterThanOrEqual(1);

    // 4. List orders
    const ordersRes = await app.request("/api/orders", {
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });
    expect(ordersRes.status).toBe(200);
    const ordersJson = (await ordersRes.json()) as any;
    expect(ordersJson.data.length).toBeGreaterThanOrEqual(1);
  });

  it("VelSeller Dashboard: Seller endpoints are reachable via unversioned /api/seller/*", async () => {
    const authHeader = await createAuthHeader("user-frontend-seller");

    // Apply as seller
    const applyRes = await app.request("/api/seller/apply", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://seller.velnox.live",
      },
      body: JSON.stringify({
        businessName: "Frontend Seller Shop Co.",
        businessType: "individual",
        shopName: "Frontend Seller Shop",
        shopSlug: "frontend-seller-shop",
      }),
    });
    expect(applyRes.status).toBe(201);

    // Get seller profile
    const profileRes = await app.request("/api/seller/profile", {
      headers: {
        Authorization: authHeader,
        Origin: "https://seller.velnox.live",
      },
    });
    expect(profileRes.status).toBe(200);
    const profileJson = (await profileRes.json()) as any;
    expect(profileJson.data.seller.businessName).toBe("Frontend Seller Shop Co.");
  });

  it("Auth Handshake: /api/auth/me returns authenticated user envelope", async () => {
    // 1. Register a real user first via unversioned /api/auth/register
    const regRes = await app.request("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        email: "frontend-user@velnox.live",
        password: "Password123!",
        name: "Frontend User",
      }),
    });
    expect(regRes.status).toBe(201);
    const regJson = (await regRes.json()) as any;
    const accessToken = regJson.data.tokens.accessToken;

    // 2. Fetch /api/auth/me with Bearer token
    const res = await app.request("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: "https://shop.velnox.live",
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.email).toBe("frontend-user@velnox.live");
    expect(json.data.name).toBe("Frontend User");
  });
});
