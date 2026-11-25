import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

async function createAuthHeader(userId: string, role = "owner", email = "owner@velnox.live") {
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

describe("Admin & VelCenter Domain Tests", () => {
  const app = createApplication();

  it("GET /api/admin/dashboard/counts rejects unauthenticated requests with 401", async () => {
    const res = await app.request("/api/admin/dashboard/counts", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/dashboard/counts rejects customer role with 403", async () => {
    const authHeader = await createAuthHeader("user-cust-1", "customer", "cust@example.com");
    const res = await app.request("/api/admin/dashboard/counts", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/dashboard/counts returns 200 and counts structure for owner", async () => {
    const authHeader = await createAuthHeader("user-owner-1", "owner", "owner@velnox.live");
    const res = await app.request("/api/admin/dashboard/counts", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(typeof json.data.pendingSellers).toBe("number");
    expect(typeof json.data.pendingReviewSellers).toBe("number");
    expect(typeof json.data.pendingProducts).toBe("number");
    expect(typeof json.data.totalShops).toBe("number");
    expect(typeof json.data.verifiedShops).toBe("number");
    expect(typeof json.data.suspendedShops).toBe("number");
    expect(typeof json.data.pendingVerifications).toBe("number");
  });

  it("GET /api/v1/admin/dashboard/counts unversioned and versioned routes both work", async () => {
    const authHeader = await createAuthHeader("user-owner-1", "owner", "owner@velnox.live");
    const res = await app.request("/api/v1/admin/dashboard/counts", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
  });

  it("GET /api/admin/overview returns 200 and KPI data for owner", async () => {
    const authHeader = await createAuthHeader("user-owner-1", "owner", "owner@velnox.live");
    const res = await app.request("/api/admin/overview", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.goalsAchieved).toBeDefined();
  });

  it("GET /api/admin/market-overview returns 200 for owner", async () => {
    const authHeader = await createAuthHeader("user-owner-1", "owner", "owner@velnox.live");
    const res = await app.request("/api/admin/market-overview", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.commissionRate).toBe(0.03);
  });

  it("GET /api/admin/permissions returns permissions catalog for owner", async () => {
    const authHeader = await createAuthHeader("user-owner-1", "owner", "owner@velnox.live");
    const res = await app.request("/api/admin/permissions", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
  });

  it("POST, PATCH, DELETE /api/admin/categories handles full CRUD for admin", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");

    // 1. Create Category
    const createRes = await app.request("/api/admin/categories", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Smart Gadgets",
        slug: "test-smart-gadgets",
        icon: "smartphone",
        image_url: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/categories/icon.svg",
        description: "Innovative smart gadgets for everyone",
        sort_order: 10,
        is_active: true,
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = (await createRes.json()) as any;
    expect(createJson.success).toBe(true);
    expect(createJson.data.name).toBe("Test Smart Gadgets");
    const categoryId = createJson.data.id;
    expect(categoryId).toBeDefined();

    // 2. Patch Category
    const patchRes = await app.request(`/api/admin/categories/${categoryId}`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Smart Gadgets",
        sort_order: 12,
      }),
    });

    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as any;
    expect(patchJson.success).toBe(true);
    expect(patchJson.data.name).toBe("Updated Smart Gadgets");

    // 3. Delete Category
    const deleteRes = await app.request(`/api/admin/categories/${categoryId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader },
    });

    expect(deleteRes.status).toBe(200);
    const deleteJson = (await deleteRes.json()) as any;
    expect(deleteJson.success).toBe(true);
    expect(deleteJson.data.deleted).toBe(true);
  });

  it("GET & PUT /api/admin/announcements persists marketing banners", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");

    const bannersPayload = [
      {
        id: "banner-test-1",
        type: "promotion",
        zone: "home",
        placement: "home_hero",
        slot: 1,
        title: "Flash Sale Velnox",
        subtitle: "Up to 50% discount",
        imageUrl: "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/banners/sale.webp",
        ctaLabel: "Shop Now",
        ctaUrl: "/products?sale=true",
        active: true,
        sortOrder: 1,
      },
    ];

    const putRes = await app.request("/api/admin/announcements", {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bannersPayload),
    });

    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as any;
    expect(putJson.success).toBe(true);

    const getRes = await app.request("/api/admin/announcements", {
      method: "GET",
      headers: { Authorization: authHeader },
    });

    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as any;
    expect(getJson.success).toBe(true);
    expect(Array.isArray(getJson.data)).toBe(true);
  });

  it("PATCH /api/admin/products/:productId/moderation sets approved product status to published", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");
    const res = await app.request("/api/admin/products/prod-test-123/moderation", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "approved" }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.status).toBe("published");
  });
});
