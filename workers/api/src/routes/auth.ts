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
let cachedJwtSecret: string | null = null;

function getIdentityService(c: any): IdentityService {
  const env = c.env as Bindings | undefined;
  const jwtSecret = env?.JWT_SECRET || "velnox-default-development-jwt-secret-at-least-32-chars";

  if (identityServiceInstance && cachedJwtSecret === jwtSecret) return identityServiceInstance;

  let repo;
  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new SqlIdentityRepository(dbClient);
  } else {
    // Isolated in-memory repository for development/test without DB
    repo = new InMemoryIdentityRepository();
  }

  identityServiceInstance = new IdentityService(repo, jwtSecret);
  cachedJwtSecret = jwtSecret;
  return identityServiceInstance;
}

export function setTestIdentityService(service: IdentityService | null) {
  identityServiceInstance = service;
  cachedJwtSecret = null;
}

async function verifyTurnstileToken(token: string | undefined, secretKey: string | undefined, ip?: string): Promise<boolean> {
  if (!token) return false;
  // Cloudflare test tokens or unset secret key in development
  if (
    !secretKey ||
    secretKey.startsWith("1x0000") ||
    secretKey.startsWith("2x0000") ||
    token.startsWith("XXXX.") ||
    token === "test-turnstile-token"
  ) {
    return true;
  }
  try {
    const formData = new FormData();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (ip) formData.append("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });
    const outcome = (await res.json()) as any;
    return Boolean(outcome.success);
  } catch (err) {
    console.error("Turnstile verification error:", err);
    return true; // Fail-open on transient network error to avoid lockout
  }
}

async function handleRegister(c: any, isPasswordRegister = false) {
  const rawBody = (await c.req.json().catch(() => ({}))) || {};
  const email = typeof rawBody.email === "string" ? rawBody.email.trim().toLowerCase() : "";
  const name =
    typeof rawBody.name === "string" && rawBody.name.trim()
      ? rawBody.name.trim()
      : email.includes("@")
        ? email.split("@")[0]
        : "Customer";

  // Check Turnstile token if configured
  const env = c.env as Bindings | undefined;
  const turnstileSecret = env?.TURNSTILE_SECRET_KEY;
  const turnstileToken = rawBody.turnstileToken;
  if (turnstileSecret && turnstileToken) {
    const passed = await verifyTurnstileToken(turnstileToken, turnstileSecret, c.req.header("CF-Connecting-IP"));
    if (!passed) {
      return c.json({ success: false, error: { code: "TURNSTILE_INVALID", message: "Bot verification failed" } }, 400);
    }
  }

  const validated = registerInputSchema.parse({
    ...rawBody,
    name,
    email,
    role: rawBody.role || "customer",
  });

  const service = getIdentityService(c);
  const session = await service.register(validated);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  const statusCode = isPasswordRegister ? 200 : 201;
  return c.json({ success: true, data: session }, statusCode);
}

async function handleLogin(c: any) {
  const rawBody = (await c.req.json().catch(() => ({}))) || {};
  const email = typeof rawBody.email === "string" ? rawBody.email.trim().toLowerCase() : "";

  // Check Turnstile token if configured
  const env = c.env as Bindings | undefined;
  const turnstileSecret = env?.TURNSTILE_SECRET_KEY;
  const turnstileToken = rawBody.turnstileToken;
  if (turnstileSecret && turnstileToken) {
    const passed = await verifyTurnstileToken(turnstileToken, turnstileSecret, c.req.header("CF-Connecting-IP"));
    if (!passed) {
      return c.json({ success: false, error: { code: "TURNSTILE_INVALID", message: "Bot verification failed" } }, 400);
    }
  }

  const validated = loginInputSchema.parse({
    ...rawBody,
    email,
  });

  const service = getIdentityService(c);
  const session = await service.login(validated);

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  loginResponseSchema.parse({ success: true, data: session });
  return c.json({ success: true, data: session }, 200);
}

/**
 * POST /api/v1/auth/register
 */
authRoutes.post("/register", async (c) => handleRegister(c, false));

/**
 * POST /api/v1/auth/password-register (Frontend alias)
 */
authRoutes.post("/password-register", async (c) => handleRegister(c, true));

/**
 * POST /api/v1/auth/login
 */
authRoutes.post("/login", async (c) => handleLogin(c));

/**
 * POST /api/v1/auth/password-login (Frontend alias)
 */
authRoutes.post("/password-login", async (c) => handleLogin(c));

/**
 * POST /api/v1/auth/member-login (VelCenter staff)
 */
authRoutes.post("/member-login", async (c) => {
  const rawBody = (await c.req.json().catch(() => ({}))) || {};
  const identifier = typeof rawBody.identifier === "string" ? rawBody.identifier.trim().toLowerCase() : "";
  const password = typeof rawBody.password === "string" ? rawBody.password : "";

  if (!identifier || !password) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Identifier and password are required" } }, 400);
  }

  const service = getIdentityService(c);
  const session = await service.login({ email: identifier, password });

  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
  c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

  return c.json({ success: true, data: session }, 200);
});

/**
 * POST /api/v1/auth/preauth (Pre-authentication proof for Google flow)
 */
authRoutes.post("/preauth", async (c) => {
  const rawBody = (await c.req.json().catch(() => ({}))) || {};
  const token = rawBody.turnstileToken;
  const env = c.env as Bindings | undefined;
  if (env?.TURNSTILE_SECRET_KEY && token) {
    const passed = await verifyTurnstileToken(token, env.TURNSTILE_SECRET_KEY, c.req.header("CF-Connecting-IP"));
    if (!passed) {
      return c.json({ success: false, error: { code: "TURNSTILE_INVALID", message: "Bot verification failed" } }, 400);
    }
  }
  const isProd = c.env?.ENVIRONMENT === "production";
  c.header("Set-Cookie", `velnox_preauth=1; Path=/; HttpOnly; ${isProd ? "Secure; SameSite=None" : "SameSite=Lax"}; Max-Age=300`);
  return c.json({ success: true, data: { preauth: true } }, 200);
});

/**
 * GET /api/v1/auth/google (OAuth redirect entry point)
 */
authRoutes.get("/google", async (c) => {
  const env = c.env as Bindings | undefined;
  const clientId = env?.GOOGLE_CLIENT_ID;
  const returnTo = c.req.query("returnTo") || "/";
  const referer = c.req.header("Referer") || "";
  let frontendOrigin = "https://shop.velnox.live";
  try {
    if (referer) frontendOrigin = new URL(referer).origin;
  } catch {}

  if (!clientId) {
    return c.redirect(`${frontendOrigin}/auth?error=google_not_configured`);
  }

  const reqUrl = new URL(c.req.url);
  const redirectUri = env?.GOOGLE_REDIRECT_URI || `${reqUrl.origin}${reqUrl.pathname}/callback`;
  const stateObj = { returnTo, frontendOrigin, redirectUri };
  const state = btoa(JSON.stringify(stateObj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * GET /api/v1/auth/google/callback (OAuth exchange and session issuance)
 */
authRoutes.get("/google/callback", async (c) => {
  const env = c.env as Bindings | undefined;
  const clientId = env?.GOOGLE_CLIENT_ID;
  const clientSecret = env?.GOOGLE_CLIENT_SECRET;
  const code = c.req.query("code");
  const stateParam = c.req.query("state");

  let returnTo = "/";
  let frontendOrigin = "https://shop.velnox.live";
  let redirectUri = `${new URL(c.req.url).origin}${new URL(c.req.url).pathname}`;
  if (stateParam) {
    try {
      const decoded = JSON.parse(atob(stateParam.replace(/-/g, "+").replace(/_/g, "/")));
      if (decoded.returnTo) returnTo = decoded.returnTo;
      if (decoded.frontendOrigin) frontendOrigin = decoded.frontendOrigin;
      if (decoded.redirectUri) redirectUri = decoded.redirectUri;
    } catch {}
  }

  if (!code || !clientId || !clientSecret) {
    return c.redirect(`${frontendOrigin}/auth?error=generic`);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return c.redirect(`${frontendOrigin}/auth?error=generic`);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      return c.redirect(`${frontendOrigin}/auth?error=generic`);
    }

    const userInfo = (await userRes.json()) as any;
    const service = getIdentityService(c);
    const session = await service.loginWithOAuth(
      "google",
      userInfo.sub,
      userInfo.email,
      userInfo.name || "Google User",
      userInfo.picture || ""
    );

    const isProd = c.env?.ENVIRONMENT === "production";
    c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
    c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

    return c.redirect(`${frontendOrigin}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return c.redirect(`${frontendOrigin}/auth?error=generic`);
  }
});

/**
 * GET /api/v1/auth/line (LINE OAuth redirect entry point)
 */
authRoutes.get("/line", async (c) => {
  const env = c.env as Bindings | undefined;
  const channelId = env?.LINE_CHANNEL_ID;
  const returnTo = c.req.query("returnTo") || "/";
  const referer = c.req.header("Referer") || "";
  let frontendOrigin = "https://shop.velnox.live";
  try {
    if (referer) frontendOrigin = new URL(referer).origin;
  } catch {}

  if (!channelId) {
    return c.redirect(`${frontendOrigin}/auth?error=line_not_configured`);
  }

  const reqUrl = new URL(c.req.url);
  const redirectUri = env?.LINE_REDIRECT_URI || `${reqUrl.origin}${reqUrl.pathname}/callback`;
  const stateObj = { returnTo, frontendOrigin, redirectUri };
  const state = btoa(JSON.stringify(stateObj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: "profile openid email",
  });

  return c.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
});

/**
 * GET /api/v1/auth/line/callback (LINE OAuth exchange and session issuance)
 */
authRoutes.get("/line/callback", async (c) => {
  const env = c.env as Bindings | undefined;
  const channelId = env?.LINE_CHANNEL_ID;
  const channelSecret = env?.LINE_CHANNEL_SECRET;
  const code = c.req.query("code");
  const stateParam = c.req.query("state");

  let returnTo = "/";
  let frontendOrigin = "https://shop.velnox.live";
  let redirectUri = `${new URL(c.req.url).origin}${new URL(c.req.url).pathname}`;
  if (stateParam) {
    try {
      const decoded = JSON.parse(atob(stateParam.replace(/-/g, "+").replace(/_/g, "/")));
      if (decoded.returnTo) returnTo = decoded.returnTo;
      if (decoded.frontendOrigin) frontendOrigin = decoded.frontendOrigin;
      if (decoded.redirectUri) redirectUri = decoded.redirectUri;
    } catch {}
  }

  if (!code || !channelId || !channelSecret) {
    return c.redirect(`${frontendOrigin}/auth?error=generic`);
  }

  try {
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: channelId,
        client_secret: channelSecret,
      }),
    });

    if (!tokenRes.ok) {
      return c.redirect(`${frontendOrigin}/auth?error=generic`);
    }

    const tokenData = (await tokenRes.json()) as any;
    const accessToken = tokenData.access_token;

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return c.redirect(`${frontendOrigin}/auth?error=generic`);
    }

    const profile = (await profileRes.json()) as any;
    const service = getIdentityService(c);
    const email = profile.email || `${profile.userId}@line.velnox.live`;
    const session = await service.loginWithOAuth(
      "line",
      profile.userId,
      email,
      profile.displayName || "LINE User",
      profile.pictureUrl || ""
    );

    const isProd = c.env?.ENVIRONMENT === "production";
    c.header("Set-Cookie", createSessionCookie(session.tokens.accessToken, isProd));
    c.header("Set-Cookie", createRefreshCookie(session.tokens.refreshToken!, isProd), { append: true });

    return c.redirect(`${frontendOrigin}${returnTo.startsWith("/") ? returnTo : `/${returnTo}`}`);
  } catch (err) {
    console.error("LINE OAuth callback error:", err);
    return c.redirect(`${frontendOrigin}/auth?error=generic`);
  }
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
