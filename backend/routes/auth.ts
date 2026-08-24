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
  const client = await query("SELECT 1").then(() =>
    (query as any).client ||
    // Get a client from the pool for transactions
    import("../db/index.js").then((m) => m.getClient())
  );

  // Use a transaction for identity resolution
  const { getClient } = await import("../db/index.js");
  const poolClient = await getClient();

  try {
    await poolClient.query("BEGIN");

    // 1. Check existing Google provider identity
    const providerResult = await poolClient.query(
      `SELECT u.id FROM users u
       JOIN provider_identities pi ON pi.user_id = u.id
       WHERE pi.provider = 'google' AND pi.provider_subject = $1`,
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
        `INSERT INTO provider_identities (id, user_id, provider, provider_subject, email, display_name, avatar_url, created_at)
         VALUES (gen_random_uuid(), $1, 'google', $2, $3, $4, $5, NOW())
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [userId, google.sub, google.email, google.name, google.picture]
      );
      // Update name/avatar
      await poolClient.query(
        `UPDATE users SET name = COALESCE(NULLIF($2, ''), name),
         avatar = NULLIF($3, ''), updated_at = NOW() WHERE id = $1`,
        [userId, google.name, google.picture]
      );
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
      `INSERT INTO provider_identities (id, user_id, provider, provider_subject, email, display_name, avatar_url, created_at)
       VALUES (gen_random_uuid(), $1, 'google', $2, $3, $4, $5, NOW())`,
      [userId, google.sub, google.email, google.name, google.picture]
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

/** Create a JWT session token. */
function createSessionToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: "7d" });
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
      const frontendUrl = getFrontendUrl(req);
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

      // Redirect back to frontend
      const frontendUrl = getFrontendUrl(req);
      res.redirect(`${frontendUrl}${returnTo}`);
    } catch (err) {
      console.error("Google OAuth callback error:", err);
      const frontendUrl = getFrontendUrl(req);
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
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
      const result = await query(
        "SELECT id, email, name, avatar, cover_url, role, status, created_at, updated_at FROM users WHERE id = $1",
        [payload.userId]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      const u = result.rows[0];
      res.json({
        success: true,
        data: {
          user: {
            id: u.id,
            email: u.email,
            name: u.name,
            avatar: u.avatar,
            coverUrl: u.cover_url || null,
            role: u.role,
            status: u.status,
            createdAt: u.created_at,
            updatedAt: u.updated_at,
          },
        },
      });
    } catch {
      res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Invalid session" } });
    }
  });

  // Logout
  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ success: true, data: { success: true } });
  });
}

/** Determine the frontend URL from the request origin or env. */
function getFrontendUrl(req: Request): string {
  const origins = process.env.CORS_ORIGINS?.split(",").map((s) => s.trim()) || [];
  if (origins.length > 0 && origins[0]) return origins[0];
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const url = new URL(origin);
      return `${url.protocol}//${url.host}`;
    } catch { /* ignore */ }
  }
  return "http://localhost:5173";
}
