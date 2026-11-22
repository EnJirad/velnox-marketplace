import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

async function createAuthHeader(userId: string, role = "seller", email = "seller@velnox.live") {
  const token = await signJwt(
    {
      sub: userId,
      email,
      role: role as any,
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

describe("Seller Operations Domain Tests", () => {
  const app = createApplication();

  it("POST /api/v1/seller/apply creates seller profile and shop", async () => {
    const authHeader = await createAuthHeader("user-new-seller-1", "customer", "newseller@velnox.live");

    const payload = {
      businessName: "Siam Gadgets Co., Ltd.",
      businessType: "juristic",
      taxId: "0105560000000",
      shopName: "Siam Gadgets",
      shopSlug: "siam-gadgets",
      shopDescription: "Leading importer of smart home and gadgets in Thailand.",
    };

    const res = await app.request("/api/v1/seller/apply", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.seller.businessName).toBe(payload.businessName);
    expect(json.data.seller.verificationStatus).toBe("unverified");
    expect(json.data.shop.name).toBe(payload.shopName);
    expect(json.data.shop.slug).toBe(payload.shopSlug);
  });

  it("POST /api/v1/seller/apply rejects duplicate application for same user", async () => {
    const authHeader = await createAuthHeader("user-new-seller-1");

    const payload = {
      businessName: "Duplicate Store",
      businessType: "individual",
      shopName: "Duplicate",
      shopSlug: "duplicate-shop",
    };

    const res = await app.request("/api/v1/seller/apply", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(500); // throws error handled by global error handler
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
  });

  it("GET /api/v1/seller/profile returns seller profile and shop", async () => {
    const authHeader = await createAuthHeader("user-new-seller-1");

    const res = await app.request("/api/v1/seller/profile", {
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.seller.businessName).toBe("Siam Gadgets Co., Ltd.");
    expect(json.data.shop.name).toBe("Siam Gadgets");
  });

  it("PATCH /api/v1/seller/shop updates shop profile", async () => {
    const authHeader = await createAuthHeader("user-new-seller-1");

    const res = await app.request("/api/v1/seller/shop", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: "Updated description for Siam Gadgets Store.",
        logoUrl: "https://media.velnox.live/logos/siam.png",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.description).toBe("Updated description for Siam Gadgets Store.");
    expect(json.data.logoUrl).toBe("https://media.velnox.live/logos/siam.png");
  });

  it("POST /api/v1/seller/products creates product with variants", async () => {
    const authHeader = await createAuthHeader("user-new-seller-1");

    const newProduct = {
      name: "Wireless ANC Headphones X1",
      categoryId: "00000000-0000-0000-0000-000000000001",
      price: 2490.0, // 2,490 THB
      originalPrice: 2990.0,
      totalQuantity: 80,
      description: "Active noise cancellation wireless headphones with 40-hour battery.",
      images: ["https://media.velnox.live/products/headphones-1.webp"],
      variants: [
        { name: "Matte Black", sku: "X1-BLK", price: 2490.0, stock: 50 },
        { name: "Silver White", sku: "X1-SLV", price: 2490.0, stock: 30 },
      ],
    };

    const res = await app.request("/api/v1/seller/products", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(newProduct),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBeDefined();
    expect(json.data.name).toBe("Wireless ANC Headphones X1");
    expect(json.data.price).toBe(249000); // satang
    expect(json.data.variants.length).toBe(2);
  });

  it("PUT /api/v1/seller/products/:id prevents editing products owned by other sellers", async () => {
    // Seller 2 tries to update Seller 1's product
    const authHeaderSeller2 = await createAuthHeader("user-different-seller-2");

    // First seller 2 registers
    await app.request("/api/v1/seller/apply", {
      method: "POST",
      headers: {
        Authorization: authHeaderSeller2,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        businessName: "Seller 2 Shop",
        businessType: "individual",
        shopName: "Shop Two",
        shopSlug: "shop-two",
      }),
    });

    // Seller 1 creates a product
    const authHeaderSeller1 = await createAuthHeader("user-new-seller-1");
    const createRes = await app.request("/api/v1/seller/products", {
      method: "POST",
      headers: {
        Authorization: authHeaderSeller1,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Exclusive Seller 1 Item",
        categoryId: "00000000-0000-0000-0000-000000000001",
        price: 990.0,
        totalQuantity: 10,
      }),
    });
    const created = ((await createRes.json()) as any).data;

    // Seller 2 attempts to update Seller 1's product
    const updateRes = await app.request(`/api/v1/seller/products/${created.id}`, {
      method: "PUT",
      headers: {
        Authorization: authHeaderSeller2,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Hacked Item Name",
      }),
    });

    expect(updateRes.status).toBe(500); // Throws forbidden error handled by error handler
    const updateJson = (await updateRes.json()) as any;
    expect(updateJson.success).toBe(false);
  });
});
