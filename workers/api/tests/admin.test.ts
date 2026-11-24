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
});
