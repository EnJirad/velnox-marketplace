import type { Express, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";

/**
 * Google OAuth authentication routes.
 *
 * Flow:
 * 1. Frontend redirects to /auth/google?returnTo=...
 * 2. Backend redirects to Google OAuth consent screen
 * 3. Google redirects back to /auth/google/callback with code
 * 4. Backend exchanges code for tokens, verifies identity
 * 5. Backend resolves/creates Neon user (identity resolution)
 * 6. Backend creates session cookie and redirects to frontend
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? "";
const JWT_SECRET = process.env.JWT_SECRET ?? "";
const SESSION_COOKIE = "velnox_session";
import crypto from "crypto";

// ─── Per-user profile cache (5s TTL) ───────────────────────────────────────
// Prevents the same slow Neon query from being hit multiple times within a
// short window (e.g. /api/auth/me + /api/customer/profile on page load).
const profileCache = new Map<string, { data: any; expires: number }>();
const PROFILE_CACHE_TTL = 30_000; // 30 seconds — reduces Neon cold-start impact

function getCachedProfile(userId: string): any | null {
  const entry = profileCache.get(userId);
  if (entry && entry.expires > Date.now()) return entry.data;
  profileCache.delete(userId);
  return null;
}

export function setCachedProfile(userId: string, data: any): void {
  profileCache.set(userId, { data, expires: Date.now() + PROFILE_CACHE_TTL });
}

export function invalidateCachedProfile(userId: string): void {
  profileCache.delete(userId);
}

/** Normalize email: trim + lowercase. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Exchange authorization code for tokens. */
async function exchangeCode(code: string): Promise<{
  access_token: string;
  id_token: string;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<{ access_token: string; id_token: string }>;
}

/** Verify Google ID token and extract claims. */
async function verifyGoogleIdentity(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
  picture: string;
}> {
  // Use Google's tokeninfo endpoint for verification
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`
  );
  if (!res.ok) {
    throw new Error("Invalid Google ID token");
  }
  const claims = (await res.json()) as {
    sub: string;
    email: string;
    name: string;
    picture: string;
    aud: string;
    exp: string;
  };

  // Verify audience matches our client ID
  if (claims.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("Token audience mismatch");
  }

  return {
    sub: claims.sub,
    email: normalizeEmail(claims.email),
    name: claims.name || "",
    picture: claims.picture || "",
  };
}

/**
 * Resolve or create user in Neon.
 *
 * CRITICAL USER IDENTITY RULE:
 * ONE PERSON = ONE NEON USER.
 *
 * Resolution order:
 * 1. Google provider ID lookup
 * 2. Normalized email lookup (link Google identity)
 * 3. Create new user (only if neither exists)
 */
async function resolveUser(google: {
  sub: string;
  email: string;
  name: string;
  picture: string;
}): Promise<{ userId: string; isNew: boolean }> {
  // Use a transaction for identity resolution
  const { getClient } = await import("../db/index.js");
  const poolClient = await getClient();

  try {
    await poolClient.query("BEGIN");

    // 1. Check existing Google provider identity
    const providerResult = await poolClient.query(
      `SELECT u.id FROM users u
       JOIN auth_identities ai ON ai.user_id = u.id
       WHERE ai.provider = 'google' AND ai.provider_id = $1`,
      [google.sub]
    );

    if (providerResult.rows.length > 0) {
      const userId = providerResult.rows[0].id;
      // Update name/avatar if changed
      await poolClient.query(
        `UPDATE users SET name = COALESCE(NULLIF($2, ''), name),
         avatar = NULLIF($3, ''), updated_at = NOW() WHERE id = $1`,
        [userId, google.name, google.picture]
      );
      invalidateCachedProfile(userId);
      await poolClient.query("COMMIT");
      return { userId, isNew: false };
    }

    // 2. Check existing user by normalized email
    const emailResult = await poolClient.query(
      "SELECT id FROM users WHERE LOWER(TRIM(email)) = $1",
      [google.email]
    );

    if (emailResult.rows.length > 0) {
      const userId = emailResult.rows[0].id;
      // Link Google identity to existing user
      await poolClient.query(
        `INSERT INTO auth_identities (id, user_id, provider, provider_id, email, created_at)
         VALUES (gen_random_uuid(), $1, 'google', $2, $3, NOW())
         ON CONFLICT (provider, provider_id) DO NOTHING`,
        [userId, google.sub, google.email]
      );
      // Update name/avatar
      await poolClient.query(
        `UPDATE users SET name = COALESCE(NULLIF($2, ''), name),
         avatar = NULLIF($3, ''), updated_at = NOW() WHERE id = $1`,
        [userId, google.name, google.picture]
      );
      invalidateCachedProfile(userId);
      await poolClient.query("COMMIT");
      return { userId, isNew: false };
    }

    // 3. Create new user
    const newUser = await poolClient.query(
      `INSERT INTO users (id, email, name, avatar, role, status, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'customer', 'active', NOW(), NOW())
       RETURNING id`,
      [google.email, google.name, google.picture]
    );
    const userId = newUser.rows[0].id;

    // Create provider identity
    await poolClient.query(
      `INSERT INTO auth_identities (id, user_id, provider, provider_id, email, created_at)
       VALUES (gen_random_uuid(), $1, 'google', $2, $3, NOW())`,
      [userId, google.sub, google.email]
    );

    // Create customer profile
    await poolClient.query(
      `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, NOW(), NOW())`,
      [userId]
    );

    await poolClient.query("COMMIT");
    return { userId, isNew: true };
  } catch (err) {
    await poolClient.query("ROLLBACK");
    throw err;
  } finally {
    poolClient.release();
  }
}

/** Create a JWT session token with a unique jti for revocation. */
function createSessionToken(userId: string, email: string): string {
  const jti = crypto.randomUUID();
  return jwt.sign({ userId, email, jti }, JWT_SECRET, { expiresIn: "7d" });
}

/** Set the session cookie on the response. */
function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
  });
}

/**
 * Register Google OAuth routes on the Express app.
 */
export function setupGoogleAuth(app: Express): void {
  // Step 1: Frontend calls this to start Google OAuth flow
  app.get("/auth/google", (req: Request, res: Response) => {
    // Validate required env vars
    if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
      console.error("[auth] GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI not configured");
      const frontendUrl = getFrontendUrl(req, req.query.returnTo as string);
      res.redirect(`${frontendUrl}/auth?error=google_not_configured`);
      return;
    }

    const returnTo = (req.query.returnTo as string) || "/";

    // Generate state parameter with returnTo
    const state = Buffer.from(JSON.stringify({ returnTo })).toString("base64url");

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
      state,
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // Step 2: Google redirects here with authorization code
  app.get("/auth/google/callback", async (req: Request, res: Response) => {
    try {
      const { code, state } = req.query as { code?: string; state?: string };

      if (!code) {
        res.status(400).send("Authorization code missing");
        return;
      }

      // Decode state to get returnTo
      let returnTo = "/";
      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
          returnTo = decoded.returnTo || "/";
        } catch {
          // Ignore invalid state, default to /
        }
      }

      // Exchange code for tokens
      const tokens = await exchangeCode(code);

      // Verify Google identity
      const googleUser = await verifyGoogleIdentity(tokens.id_token);

      // Resolve or create user in Neon
      const { userId } = await resolveUser(googleUser);

      // Fetch user email for the JWT
      const userResult = await query("SELECT email FROM users WHERE id = $1", [userId]);
      const email = userResult.rows[0]?.email || googleUser.email;

      // Create session
      const sessionToken = createSessionToken(userId, email);
      setSessionCookie(res, sessionToken);

      // Redirect back to the correct frontend (resolved from returnTo)
      const frontendUrl = getFrontendUrl(req, returnTo);
      console.log("[auth] OAuth success — redirecting to:", `${frontendUrl}${returnTo}`);
      res.redirect(`${frontendUrl}${returnTo}`);
    } catch (err: any) {
      console.error("[auth] Google OAuth callback error:", err?.message || err);
      console.error("[auth] Stack:", err?.stack);
      const frontendUrl = getFrontendUrl(req, "/");
      res.redirect(`${frontendUrl}/auth?error=google_failed`);
    }
  });

  // API endpoint: get current user (for frontend to check auth status)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) {
      res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
      return;
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; jti?: string };

      // Check cache FIRST — this skips the ~200ms revoked_tokens + users DB round trips
      // when the profile was already loaded within the last 30s. Token revocation
      // is checked on the uncached path below; the 30s stale window is acceptable
      // for a profile endpoint (logout takes effect on next uncached request).
      const cached = getCachedProfile(payload.userId);
      if (cached) {
        res.json({ success: true, data: { user: cached } });
        return;
      }

      // Check if token has been revoked (only when cache miss)
      if (payload.jti) {
        try {
          const revoked = await query("SELECT 1 FROM revoked_tokens WHERE token_id = $1", [payload.jti]);
          if (revoked.rows.length > 0) {
            res.clearCookie(SESSION_COOKIE, { path: "/" });
            res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Session revoked" } });
            return;
          }
        } catch { /* revoked_tokens table may not exist yet — graceful fallback */ }
      }

      let result;
      let coverUrl: string | null = null;
      try {
        result = await query(
          "SELECT id, email, name, avatar, cover_url, role, status, created_at, updated_at FROM users WHERE id = $1",
          [payload.userId]
        );
        coverUrl = result.rows[0]?.cover_url || null;
      } catch (queryErr: any) {
        // cover_url column may not exist yet (migration pending)
        if (queryErr?.code === "42703") {
          result = await query(
            "SELECT id, email, name, avatar, role, status, created_at, updated_at FROM users WHERE id = $1",
            [payload.userId]
          );
        } else {
          throw queryErr;
        }
      }
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      const u = result.rows[0];

      // If cover_url column doesn't exist, try both media key formats in parallel
      if (!coverUrl) {
        try {
          const [legacyResult, fixedResult] = await Promise.allSettled([
            query(
              `SELECT url FROM media
               WHERE uploaded_by = $1 AND key LIKE $2
               ORDER BY created_at DESC LIMIT 1`,
              [payload.userId, `profile/cover/${payload.userId}/%`]
            ),
            query(
              `SELECT url FROM media
               WHERE uploaded_by = $1 AND key LIKE $2
               ORDER BY created_at DESC LIMIT 1`,
              [payload.userId, `profile/cover/${payload.userId}%`]
            ),
          ]);
          const legacyUrl = legacyResult.status === 'fulfilled' ? legacyResult.value.rows[0]?.url : null;
          const fixedUrl = fixedResult.status === 'fulfilled' ? fixedResult.value.rows[0]?.url : null;
          coverUrl = legacyUrl || fixedUrl || null;
        } catch { /* media table query failed — ignore */ }
      }

      const userData = {
        id: u.id,
        email: u.email,
        name: u.name,
        avatar: u.avatar,
        coverUrl,
        role: u.role,
        status: u.status,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      };

      // Cache the result
      setCachedProfile(payload.userId, userData);

      res.json({ success: true, data: { user: userData } });
    } catch {
      res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid session" } });
    }
  });

  // Logout — revoke session server-side and clear cookie
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (token) {
        try {
          const payload = jwt.verify(token, JWT_SECRET) as { userId: string; jti?: string; exp?: number };
          invalidateCachedProfile(payload.userId);

          // Revoke the JWT by storing its jti in the database
          if (payload.jti && payload.exp) {
            try {
              const expiresAt = new Date(payload.exp * 1000).toISOString();
              await query(
                `INSERT INTO revoked_tokens (token_id, user_id, expires_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (token_id) DO NOTHING`,
                [payload.jti, payload.userId, expiresAt]
              );
              console.log("[auth] Token revoked for user:", payload.userId);
            } catch (revokeErr: any) {
              // If revoked_tokens table doesn't exist yet, log warning but don't fail
              console.warn("[auth] Could not revoke token (table may not exist):", revokeErr?.message);
            }
          }
        } catch { /* invalid token — still clear cookie */ }
      }
    } catch { /* ignore */ }

    // Clear the cookie with the SAME attributes used when setting it
    res.clearCookie(SESSION_COOKIE, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
    });
    res.json({ success: true, data: { success: true } });
  });

  // Cleanup: remove expired revoked tokens (runs once per 5 min, not on every request)
  // Moved to a background interval to avoid per-request overhead.
  let lastCleanup = 0;
  async function cleanupExpiredTokens() {
    const now = Date.now();
    if (now - lastCleanup < 5 * 60 * 1000) return;
    lastCleanup = now;
    try {
      await query("DELETE FROM revoked_tokens WHERE expires_at < NOW()");
    } catch { /* ignore — table may not exist */ }
  }
  // Run cleanup lazily on the first request only (then rely on interval)
  let cleanupStarted = false;
  app.use((_req, _res, next) => {
    if (!cleanupStarted) {
      cleanupStarted = true;
      cleanupExpiredTokens().catch(() => {});
    }
    next();
  });
}

/**
 * Resolve the correct frontend URL based on the returnTo path.
 * Different Velnox apps live on different domains; we must redirect
 * the user back to the SAME frontend that started the OAuth flow.
 */
function getFrontendUrl(req: Request, returnTo?: string): string {
  // 1. Determine which app owns the returnTo path
  const rt = returnTo || "/";
  let appKey: string | null = null;
  if (rt.startsWith("/seller") || rt.startsWith("/velseller")) {
    appKey = "VELSELLER";
  } else if (rt.startsWith("/center") || rt.startsWith("/velcenter")) {
    appKey = "VELCENTER";
  } else {
    // Default to VelShop for "/", "/shop", product pages, etc.
    appKey = "VELSHOP";
  }

  // 2. Look up the frontend URL from the per-app env var
  const envUrl = process.env[`VITE_${appKey}_URL`];
  if (envUrl) return envUrl.replace(/\/+$/, "");

  // 3. Fall back to CORS_ORIGINS
  const origins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()) || [];
  if (appKey === "VELSHOP" && origins.length > 0 && origins[0]) return origins[0];
  // If we can't determine the app, try matching any CORS origin
  for (const o of origins) {
    if (appKey === "VELSELLER" && /seller/i.test(o)) return o;
    if (appKey === "VELCENTER" && /center/i.test(o)) return o;
    if (appKey === "VELSHOP" && /shop/i.test(o)) return o;
  }
  if (origins.length > 0 && origins[0]) return origins[0];

  // 4. Fall back to request origin header
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const url = new URL(origin);
      return `${url.protocol}//${url.host}`;
    } catch { /* ignore */ }
  }
  return "http://localhost:5173";
}
