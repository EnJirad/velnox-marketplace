import { describe, expect, it } from "bun:test";
import { app } from "../src/app.js";
import {
  loginResponseSchema,
  registerResponseSchema,
  tokenRefreshResponseSchema,
} from "@velnox/api-contract";

describe("Cloudflare Workers API — Identity & Authentication Flow", () => {
  const env = {
    ENVIRONMENT: "test",
    JWT_SECRET: "test-jwt-secret-with-minimum-32-characters-for-safety!",
  };

  const testUser = {
    name: "Somchai Rebuild",
    email: `somchai_${Date.now()}@example.com`,
    password: "Password123!",
    phone: "0812345678",
    role: "customer" as const,
  };

  let userTokens: { accessToken: string; refreshToken?: string };
  let sessionCookie: string;
  let refreshCookie: string;

  it("POST /api/v1/auth/register registers user and returns dual tokens + cookies", async () => {
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser),
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(201);

    // Verify Set-Cookie headers
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("velnox_session=");
    expect(setCookie).toContain("HttpOnly");

    const body = (await res.json()) as any;
    const validated = registerResponseSchema.parse(body);

    expect(validated.success).toBe(true);
    expect(validated.data.user.email).toBe(testUser.email.toLowerCase());
    expect(validated.data.user.name).toBe(testUser.name);
    expect(validated.data.tokens.accessToken).toBeDefined();
    expect(validated.data.tokens.refreshToken).toBeDefined();

    userTokens = validated.data.tokens;
    sessionCookie = `velnox_session=${userTokens.accessToken}`;
    refreshCookie = `velnox_refresh=${userTokens.refreshToken}`;
  });

  it("POST /api/v1/auth/register rejects duplicate email with 409 Conflict", async () => {
    const req = new Request("http://localhost/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testUser),
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(409);

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("POST /api/v1/auth/login logs in user and returns tokens", async () => {
    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password,
      }),
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    const validated = loginResponseSchema.parse(body);

    expect(validated.success).toBe(true);
    expect(validated.data.user.email).toBe(testUser.email.toLowerCase());
    expect(validated.data.tokens.accessToken).toBeDefined();
  });

  it("POST /api/v1/auth/login rejects wrong password with 401 Unauthorized", async () => {
    const req = new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testUser.email,
        password: "WrongPassword999!",
      }),
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(401);

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /api/v1/auth/me succeeds with Bearer token header", async () => {
    const req = new Request("http://localhost/api/v1/auth/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userTokens.accessToken}`,
      },
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(testUser.email.toLowerCase());
  });

  it("GET /api/v1/auth/me succeeds with Session Cookie", async () => {
    const req = new Request("http://localhost/api/v1/auth/me", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
      },
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.email).toBe(testUser.email.toLowerCase());
  });

  it("GET /api/v1/auth/me fails without authentication with 401", async () => {
    const req = new Request("http://localhost/api/v1/auth/me", {
      method: "GET",
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(401);

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/v1/auth/refresh rotates refresh token and returns fresh tokens", async () => {
    const req = new Request("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: refreshCookie,
      },
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    const validated = tokenRefreshResponseSchema.parse(body);

    expect(validated.success).toBe(true);
    expect(validated.data.accessToken).toBeDefined();
    expect(validated.data.refreshToken).toBeDefined();
    // Verify refresh token rotation: new refresh token differs from old
    expect(validated.data.refreshToken).not.toBe(userTokens.refreshToken);

    // Update tokens
    userTokens = validated.data as any;
  });

  it("POST /api/v1/auth/refresh rejects reuse of revoked refresh token", async () => {
    // Replay the previous (now rotated and revoked) refresh token
    const req = new Request("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      headers: {
        Cookie: refreshCookie,
      },
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(401);

    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/v1/auth/google logs in or registers user with OAuth", async () => {
    const req = new Request("http://localhost/api/v1/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idToken: `google_oauth_sub_${Date.now()}`,
      }),
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.user).toBeDefined();
    expect(body.data.tokens.accessToken).toBeDefined();
  });

  it("POST /api/v1/auth/logout clears session cookies", async () => {
    const req = new Request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: {
        Cookie: `velnox_refresh=${userTokens.refreshToken}`,
      },
    });

    const res = await app.request(req, {}, env);
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("Max-Age=0");
  });

  it("enforces RBAC role guard: customer is rejected from admin route with 403 Forbidden", async () => {
    const { createApplication } = await import("../src/app.js");
    const { requireRole, authMiddleware } = await import("../src/middleware/auth.js");
    const { signJwt } = await import("../src/core/security/jwt.js");

    const rbacApp = createApplication();
    rbacApp.get("/test-admin", authMiddleware, requireRole("admin", "center_admin"), (c) => {
      return c.json({ success: true, data: "super-secret" });
    });

    // 1. Try with customer token -> Should fail with 403 Forbidden
    const reqForbidden = new Request("http://localhost/test-admin", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userTokens.accessToken}`,
      },
    });

    const resForbidden = await rbacApp.request(reqForbidden, {}, env);
    expect(resForbidden.status).toBe(403);
    const bodyForbidden = (await resForbidden.json()) as any;
    expect(bodyForbidden.success).toBe(false);
    expect(bodyForbidden.error.code).toBe("FORBIDDEN");

    // 2. Try with valid admin token -> Should pass with 200 OK
    const adminToken = await signJwt(
      { sub: "admin-1", email: "admin@velnox.live", role: "center_admin", type: "access" },
      env.JWT_SECRET,
    );

    const reqAdmin = new Request("http://localhost/test-admin", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    const resAdmin = await rbacApp.request(reqAdmin, {}, env);
    expect(resAdmin.status).toBe(200);
    const bodyAdmin = (await resAdmin.json()) as any;
    expect(bodyAdmin.success).toBe(true);
    expect(bodyAdmin.data).toBe("super-secret");
  });
});
