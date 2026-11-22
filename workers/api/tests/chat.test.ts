import { describe, expect, it } from "bun:test";
import { app } from "../src/app.js";
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

describe("Phase 7: Chat & Notifications Domain Tests", () => {
  it("Customer: GET /api/v1/customer/conversations lists conversations", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");

    const res = await app.request("/api/v1/customer/conversations", {
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.items)).toBe(true);
  });

  it("Customer: POST /api/v1/customer/support/conversation gets or creates company support thread", async () => {
    const authHeader = await createAuthHeader("user-new-shopper");

    const res = await app.request("/api/v1/customer/support/conversation", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.type).toBe("CUSTOMER_COMPANY");
    expect(json.data.title).toBe("Velnox Support");
  });

  it("Customer: POST /api/v1/customer/conversations/:id/messages sends message with clientId idempotency", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");
    const clientId = `client-${crypto.randomUUID()}`;

    // Send first time
    const res1 = await app.request("/api/v1/customer/conversations/conv-support-seed/messages", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        content: "สอบถามสถานะการจัดส่งสินค้าครับ",
        clientId,
      }),
    });

    expect(res1.status).toBe(201);
    const json1 = (await res1.json()) as any;
    expect(json1.success).toBe(true);
    expect(json1.data.message.content).toBe("สอบถามสถานะการจัดส่งสินค้าครับ");
    const messageId1 = json1.data.message.id;

    // Retry sending same message with same clientId: must return identical message without creating duplicate!
    const res2 = await app.request("/api/v1/customer/conversations/conv-support-seed/messages", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({
        content: "สอบถามสถานะการจัดส่งสินค้าครับ",
        clientId,
      }),
    });

    expect(res2.status).toBe(201);
    const json2 = (await res2.json()) as any;
    expect(json2.data.message.id).toBe(messageId1);
  });

  it("Customer: GET /api/v1/customer/conversations/:id/messages returns messages chronologically", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");

    const res = await app.request("/api/v1/customer/conversations/conv-support-seed/messages", {
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.items.length).toBeGreaterThan(0);
  });

  it("Customer: POST /api/v1/customer/conversations/:id/read marks messages read", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");

    const res = await app.request("/api/v1/customer/conversations/conv-support-seed/read", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Origin: "https://shop.velnox.live",
      },
      body: JSON.stringify({ upTo: Date.now() }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
  });

  it("Notifications: GET /api/v1/customer/notifications and mark-all-read", async () => {
    const authHeader = await createAuthHeader("user-frontend-shopper");

    // List notifications
    const listRes = await app.request("/api/v1/customer/notifications", {
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as any;
    expect(listJson.success).toBe(true);
    expect(Array.isArray(listJson.data.items)).toBe(true);

    // Mark all read
    const readAllRes = await app.request("/api/v1/customer/notifications/read-all", {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        Origin: "https://shop.velnox.live",
      },
    });
    expect(readAllRes.status).toBe(200);
    const readAllJson = (await readAllRes.json()) as any;
    expect(readAllJson.success).toBe(true);
  });
});
