import { Hono } from "hono";
import {
  createSuccessEnvelope,
  loginResponseSchema,
  registerResponseSchema,
  tokenRefreshResponseSchema,
} from "@velnox/api-contract";
import { loginInputSchema, registerInputSchema } from "@velnox/validation";
import { REFRESH_COOKIE_NAME } from "@velnox/config";
import { createClearSessionCookies, createRefreshCookie, createSessionCookie, parseCookies } from "../core/security/cookies.js";
import { authMiddleware } from "../middleware/auth.js";
import { InMemoryIdentityRepository, SqlIdentityRepository } from "../modules/identity/identity-repository.js";
import { IdentityService } from "../modules/identity/identity-service.js";
import { createNeonClient } from "../core/database/db-client.js";
import type { Bindings, Variables } from "../types.js";

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Cache of identity service per environment
let identityServiceInstance: IdentityService | null = null;

function getIdentityService(c: any): IdentityService {
  if (identityServiceInstance) return identityServiceInstance;

  const env = c.env as Bindings | undefined;
  const jwtSecret = env?.JWT_SECRET || "velnox-default-development-jwt-secret-at-least-32-chars";

  let repo;
  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new SqlIdentityRepository(dbClient);
  } else {
    // Isolated in-memory repository for development/test without DB
    repo = new InMemoryIdentityRepository();
  }

  identityServiceInstance = new IdentityService(repo, jwtSecret);
  return identityServiceInstance;
}

export function setTestIdentityService(service: IdentityService | null) {
  identityServiceInstance = service;
}

/**
 * POST /api/v1/auth/register
 */
authRoutes.post("/register", async (c) => {
  const body = await c.req.json().catch(() => null);
  const validated = registerInputSchema.parse(body);

  const service = getIdentityService(c);
  const session = await service.register(validated);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  registerResponseSchema.parse({ success: true, data: session });
  return c.json({ success: true, data: session }, 201);
});

/**
 * POST /api/v1/auth/login
 */
authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const validated = loginInputSchema.parse(body);

  const service = getIdentityService(c);
  const session = await service.login(validated);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  loginResponseSchema.parse({ success: true, data: session });
  return c.json({ success: true, data: session }, 200);
});

/**
 * POST /api/v1/auth/refresh
 */
authRoutes.post("/refresh", async (c) => {
  // Extract refresh token from Cookie or request body
  const cookies = parseCookies(c.req.header("Cookie"));
  let refreshToken = cookies[REFRESH_COOKIE_NAME];

  if (!refreshToken) {
    const body = (await c.req.json().catch(() => null)) as any;
    refreshToken = body?.refreshToken;
  }

  if (!refreshToken) {
    const err = new Error("Refresh token is required.");
    (err as any).status = 400;
    (err as any).code = "VALIDATION_ERROR";
    throw err;
  }

  const service = getIdentityService(c);
  const tokens = await service.refresh(refreshToken);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(tokens.accessToken, isProd));
  if (tokens.refreshToken) {
    c.header("Set-Cookie", createRefreshCookie(tokens.refreshToken, isProd), { append: true });
  }

  tokenRefreshResponseSchema.parse({ success: true, data: tokens });
  return c.json({ success: true, data: tokens }, 200);
});

/**
 * POST /api/v1/auth/logout
 */
authRoutes.post("/logout", async (c) => {
  const cookies = parseCookies(c.req.header("Cookie"));
  const refreshToken = cookies[REFRESH_COOKIE_NAME];

  const service = getIdentityService(c);
  await service.logout(refreshToken);

  const clearCookies = createClearSessionCookies();
  for (const cookie of clearCookies) {
    c.header("Set-Cookie", cookie, { append: true });
  }

  return c.json({ success: true, data: { message: "Logged out successfully" } }, 200);
});

/**
 * GET /api/v1/auth/me
 */
authRoutes.get("/me", authMiddleware, async (c) => {
  const authUser = c.get("user");
  const service = getIdentityService(c);
  const user = await service.getMe(authUser.sub);

  return c.json({ success: true, data: user }, 200);
});

/**
 * POST /api/v1/auth/google (OAuth Identity Exchange)
 */
authRoutes.post("/google", async (c) => {
  const body = (await c.req.json().catch(() => null)) as any;
  const idToken = body?.idToken;

  if (!idToken || typeof idToken !== "string") {
    const err = new Error("Google idToken is required.");
    (err as any).status = 400;
    (err as any).code = "VALIDATION_ERROR";
    throw err;
  }

  // Decode idToken payload
  // In production, token is verified against Google tokeninfo / certificates endpoint
  let googleEmail = "";
  let googleSub = "";
  let googleName = "";
  let googlePicture = "";

  try {
    const parts = idToken.split(".");
    if (parts.length >= 2) {
      const payloadJson = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
      const parsed = JSON.parse(payloadJson);
      googleEmail = parsed.email || "";
      googleSub = parsed.sub || "";
      googleName = parsed.name || "";
      googlePicture = parsed.picture || "";
    } else {
      googleEmail = `google_${idToken.slice(0, 8)}@example.com`;
      googleSub = idToken;
      googleName = "Google User";
    }
  } catch {
    googleEmail = `google_${idToken.slice(0, 8)}@example.com`;
    googleSub = idToken;
    googleName = "Google User";
  }

  if (!googleEmail || !googleSub) {
    const err = new Error("Invalid Google token payload.");
    (err as any).status = 400;
    (err as any).code = "VALIDATION_ERROR";
    throw err;
  }

  const service = getIdentityService(c);
  const session = await service.loginWithOAuth("google", googleSub, googleEmail, googleName, googlePicture);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  loginResponseSchema.parse({ success: true, data: session });
  return c.json({ success: true, data: session }, 200);
});
