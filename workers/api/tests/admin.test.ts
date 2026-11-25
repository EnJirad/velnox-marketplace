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

  it("GET & PATCH /api/admin/settings returns settings rows and platform meta", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");
    const getRes = await app.request("/api/admin/settings", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as any;
    expect(getJson.success).toBe(true);
    expect(Array.isArray(getJson.data.settings)).toBe(true);
    expect(getJson.data.meta).toBeDefined();
    expect(getJson.data.meta.moderation).toBeDefined();

    const patchRes = await app.request("/api/admin/settings", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key: "product_approval_mode", value: "auto" }),
    });
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as any;
    expect(patchJson.success).toBe(true);
  });

  it("PATCH /api/admin/users/:userId/access updates user role and department", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");
    const res = await app.request("/api/admin/users/target-user-123/access", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "staff", department: "operations" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.role).toBe("staff");
  });

  it("PATCH /api/admin/staff updates staff profile", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");
    const res = await app.request("/api/admin/staff", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "staff-user-123", department: "marketing" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.updated).toBe(true);
  });

  it("GET, POST, reset-password, active /api/admin/employees handles employee lifecycle", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");
    // GET employees
    const listRes = await app.request("/api/admin/employees", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    expect(listJson.success).toBe(true);
    expect(Array.isArray(listJson.data)).toBe(true);

    // POST create employee
    const createRes = await app.request("/api/admin/employees", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Staff",
        email: "staff.test@velnox.com",
        department: "operations",
        role: "staff",
      }),
    });
    expect(createRes.status).toBe(201);
    const createJson = (await createRes.json()) as any;
    expect(createJson.success).toBe(true);
    expect(createJson.data.tempPassword).toBeDefined();

    // POST reset password
    const resetRes = await app.request("/api/admin/employees/staff-test-id/reset-password", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: "newpassword123" }),
    });
    expect(resetRes.status).toBe(200);
    const resetJson = (await resetRes.json()) as any;
    expect(resetJson.success).toBe(true);
    expect(resetJson.data.tempPassword).toBe("newpassword123");

    // PATCH active toggle
    const activeRes = await app.request("/api/admin/employees/staff-test-id/active", {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ active: false }),
    });
    expect(activeRes.status).toBe(200);
    const activeJson = (await activeRes.json()) as any;
    expect(activeJson.success).toBe(true);
    expect(activeJson.data.active).toBe(false);
  });

  it("VelCenter Chat Endpoints: /api/center/chat/* handles company chat lifecycle", async () => {
    const authHeader = await createAuthHeader("user-admin-1", "admin", "admin@velnox.live");

    // Unread counts
    const unreadRes = await app.request("/api/center/chat/unread", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(unreadRes.status).toBe(200);
    const unreadJson = (await unreadRes.json()) as any;
    expect(unreadJson.success).toBe(true);
    expect(unreadJson.data.support).toBeDefined();

    // Staff list
    const staffRes = await app.request("/api/center/chat/staff", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(staffRes.status).toBe(200);
    const staffJson = (await staffRes.json()) as any;
    expect(staffJson.success).toBe(true);
    expect(Array.isArray(staffJson.data.items)).toBe(true);

    // Conversations list
    const convRes = await app.request("/api/center/chat/conversations?type=support", {
      method: "GET",
      headers: { Authorization: authHeader },
    });
    expect(convRes.status).toBe(200);
    const convJson = (await convRes.json()) as any;
    expect(convJson.success).toBe(true);
    expect(Array.isArray(convJson.data.items)).toBe(true);

    // Send company message
    const sendRes = await app.request("/api/center/chat/conversations/conv-test-123/messages", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "Hello from support" }),
    });
    expect(sendRes.status).toBe(201);
    const sendJson = (await sendRes.json()) as any;
    expect(sendJson.success).toBe(true);
    expect(sendJson.data.message).toBeDefined();

    // Create internal conversation
    const roomRes = await app.request("/api/center/chat/internal/conversations", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Operations Room" }),
    });
    expect(roomRes.status).toBe(201);
    const roomJson = (await roomRes.json()) as any;
    expect(roomJson.success).toBe(true);
    expect(roomJson.data.title).toBe("Operations Room");
  });
});
