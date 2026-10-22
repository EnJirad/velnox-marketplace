/**
 * Google sign-in — restored on the MVP schema.
 *
 * The pre-MVP flow was a server-side authorization-code exchange that resolved
 * ONE person to ONE account and minted the same `velnox_session` cookie the
 * password login uses. That shape is kept; what changed is where the linkage
 * lives: `user_identities` (provider, provider_user_id → user) replaces the
 * removed `auth_identities` table.
 *
 * Security decisions:
 *   • `state` is an HMAC-signed, httpOnly, 10-minute cookie — not a value echoed
 *     from the query string. A callback without the matching cookie is refused,
 *     so the flow cannot be started by a third party (login CSRF).
 *   • the ID token signature is verified against Google's published JWKS, then
 *     `iss`, `aud`, `exp` and `email_verified` are checked. The token is never
 *     decoded-and-trusted.
 *   • `returnTo` must be a same-origin path; the redirect origin is chosen from
 *     a server-side allowlist, never from the request, so this cannot become an
 *     open redirect.
 *   • a suspended/deleted account is refused AFTER authentication, exactly like
 *     the password path — a valid Google identity is not a permission.
 *   • no credential ever reaches the browser: only the client id (public) is
 *     exposed, and the secret is read from the environment.
 */
import crypto, { type JsonWebKey as NodeJsonWebKey } from "node:crypto";
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { ApiError, ok, route } from "./http.js";
import { createSessionToken, sessionCookieSecure, setSessionCookie } from "./session.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/** Cookie that carries the signed `state`. Scoped to the auth routes only. */
const STATE_COOKIE = "velnox_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_PATH = "/api/mvp/auth";

/** Apps allowed to start the flow, and the env var that holds each origin. */
const APP_ORIGINS: Record<string, string | undefined> = {
  velshop: process.env.VITE_VELSHOP_URL,
  velseller: process.env.VITE_VELSELLER_URL,
  velcenter: process.env.VITE_VELCENTER_URL,
  velnox: process.env.VITE_CORPORATE_URL,
};

function googleConfig() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID ?? "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
    redirectUri: (process.env.GOOGLE_REDIRECT_URI ?? "").trim(),
  };
}

function isConfigured(config = googleConfig()): boolean {
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

/**
 * Frontend origin for a callback redirect. Server-side allowlist only: the
 * request's `app` names a key, it never supplies a URL.
 */
function frontendOrigin(app: string | null | undefined): string {
  const named = app ? APP_ORIGINS[app] : undefined;
  const fallback =
    (process.env.OAUTH_FRONTEND_URL ?? "").trim() ||
    (process.env.VITE_VELSHOP_URL ?? "").trim() ||
    "http://localhost:5173";
  return (named?.trim() || fallback).replace(/\/+$/, "");
}

/** A same-origin path, or `/`. Never an absolute URL, never protocol-relative. */
function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  if (path.length > 512) return "/";
  return path;
}

function stateSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured on this server");
  }
  return secret;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
}

interface StatePayload {
  n: string;
  r: string;
  a: string;
  t: number;
}

function mintState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifyState(value: unknown): StatePayload | null {
  if (typeof value !== "string") return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as StatePayload;
    if (typeof payload.n !== "string" || typeof payload.t !== "number") return null;
    if (Date.now() - payload.t > STATE_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Google ID token verification ───────────────────────────────────────────

interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
}

interface Jwk {
  kty?: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

let jwksCache: { keys: Jwk[]; expiresAt: number } | null = null;

async function googleKeys(): Promise<Jwk[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new ApiError(502, "GOOGLE_UNAVAILABLE", "Google's signing keys are unavailable");
  const data = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (keys.length === 0) throw new ApiError(502, "GOOGLE_UNAVAILABLE", "Google returned no signing keys");
  jwksCache = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

/**
 * Verify a Google ID token. Exported so the verification rules can be tested
 * against a locally minted keypair instead of a live Google round trip.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  args: { clientId: string; now?: number; keys?: Jwk[] } = { clientId: googleConfig().clientId },
): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Malformed ID token");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString());
  } catch {
    throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Unreadable ID token");
  }
  if (header.alg !== "RS256") {
    throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Unexpected signing algorithm");
  }

  const keys = args.keys ?? (await googleKeys());
  const candidates = header.kid ? keys.filter((key) => key.kid === header.kid) : keys;
  if (candidates.length === 0) {
    throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Unknown signing key");
  }

  const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, "base64url");
  const valid = candidates.some((jwk) => {
    try {
      const key = crypto.createPublicKey({
        key: jwk as unknown as NodeJsonWebKey,
        format: "jwk",
      });
      return crypto.verify("RSA-SHA256", signingInput, key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Invalid ID token signature");

  const now = Math.floor((args.now ?? Date.now()) / 1000);
  const iss = payload.iss;
  if (iss !== "accounts.google.com" && iss !== "https://accounts.google.com") {
    throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Unexpected token issuer");
  }
  if (payload.aud !== args.clientId) {
    throw new ApiError(401, "GOOGLE_TOKEN_INVALID", "Token audience mismatch");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new ApiError(401, "GOOGLE_TOKEN_EXPIRED", "The Google token has expired");
  }
  const verified = payload.email_verified === true || payload.email_verified === "true";
  if (!verified || typeof payload.email !== "string" || !payload.email.includes("@")) {
    throw new ApiError(403, "GOOGLE_EMAIL_UNVERIFIED", "Google did not verify this email address");
  }

  return {
    sub: String(payload.sub ?? ""),
    email: payload.email.trim().toLowerCase(),
    email_verified: true,
    name: typeof payload.name === "string" ? payload.name : "",
    picture: typeof payload.picture === "string" ? payload.picture : "",
  };
}

async function exchangeCode(code: string): Promise<{ id_token: string }> {
  const config = googleConfig();
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new ApiError(401, "GOOGLE_EXCHANGE_FAILED", "Google rejected the authorization code");
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) {
    throw new ApiError(502, "GOOGLE_EXCHANGE_FAILED", "Google returned no identity token");
  }
  return { id_token: data.id_token };
}

// ─── Account resolution ─────────────────────────────────────────────────────

export interface ResolvedGoogleUser {
  userId: string;
  email: string;
  status: string;
  created: boolean;
  linked: boolean;
}

/**
 * Resolve ONE Google identity to ONE account, without creating duplicates.
 *
 * Order: existing identity → existing account with the same (case-insensitive)
 * e-mail → new account. Linking by verified e-mail is what makes a shopper who
 * already signed up with a password keep their orders when they later use
 * Google. A display name/photo from Google only ever FILLS a blank field, so a
 * custom profile is never overwritten.
 */
export async function resolveGoogleUser(profile: {
  sub: string;
  email: string;
  name: string;
  picture: string;
}): Promise<ResolvedGoogleUser> {
  if (!profile.sub || !profile.email) {
    throw new ApiError(400, "GOOGLE_PROFILE_INCOMPLETE", "Google did not return an account id");
  }
  const email = profile.email.trim().toLowerCase();

  const linkedRow = await query(
    `SELECT u.id, u.email, u.status
       FROM user_identities i
       JOIN users u ON u.id = i.user_id
      WHERE i.provider = 'google' AND i.provider_user_id = $1`,
    [profile.sub],
  );
  if ((linkedRow.rowCount ?? 0) > 0) {
    const user = linkedRow.rows[0] as { id: string; email: string; status: string };
    await query(
      `UPDATE users
          SET name = CASE WHEN btrim(name) = '' THEN $2 ELSE name END,
              avatar_url = COALESCE(avatar_url, NULLIF($3, '')),
              updated_at = NOW()
        WHERE id = $1`,
      [user.id, profile.name, profile.picture],
    );
    return { userId: user.id, email: user.email, status: user.status, created: false, linked: false };
  }

  const existing = await query(
    `SELECT id, email, status FROM users WHERE lower(email) = $1`,
    [email],
  );
  if ((existing.rowCount ?? 0) > 0) {
    const user = existing.rows[0] as { id: string; email: string; status: string };
    await query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'google', $2, $3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [user.id, profile.sub, email],
    );
    await query(
      `UPDATE users
          SET name = CASE WHEN btrim(name) = '' THEN $2 ELSE name END,
              avatar_url = COALESCE(avatar_url, NULLIF($3, '')),
              updated_at = NOW()
        WHERE id = $1`,
      [user.id, profile.name, profile.picture],
    );
    return { userId: user.id, email: user.email, status: user.status, created: false, linked: true };
  }

  const created = await query(
    `INSERT INTO users (email, name, avatar_url, role, status)
     VALUES ($1, $2, NULLIF($3, ''), 'customer', 'active')
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id, email, status`,
    [email, profile.name.trim() || email.split("@")[0], profile.picture],
  );
  const row = created.rows[0] as { id: string; email: string; status: string } | undefined;
  if (!row) {
    // Lost a race with a concurrent signup for the same e-mail: link to it.
    const raced = await query(`SELECT id, email, status FROM users WHERE lower(email) = $1`, [email]);
    const user = raced.rows[0] as { id: string; email: string; status: string } | undefined;
    if (!user) throw new ApiError(500, "GOOGLE_ACCOUNT_FAILED", "Could not create the account");
    await query(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
       VALUES ($1, 'google', $2, $3) ON CONFLICT (provider, provider_user_id) DO NOTHING`,
      [user.id, profile.sub, email],
    );
    return { userId: user.id, email: user.email, status: user.status, created: false, linked: true };
  }

  await query(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, email)
     VALUES ($1, 'google', $2, $3)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [row.id, profile.sub, email],
  );
  return { userId: row.id, email: row.email, status: row.status, created: true, linked: false };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

function clearState(res: Response): void {
  res.clearCookie(STATE_COOKIE, {
    path: STATE_PATH,
    httpOnly: true,
    secure: sessionCookieSecure(),
    sameSite: "lax",
  });
}

export function setupMvpOAuthRoutes(app: Express): void {
  // The sign-in page asks this before rendering the Google button.
  app.get(
    "/api/mvp/auth/providers",
    route(async (_req: Request, res: Response) => {
      ok(res, {
        providers: {
          google: {
            enabled: isConfigured(),
            startUrl: "/api/mvp/auth/google/start",
          },
        },
      });
    }),
  );

  // The pre-MVP entry point stays a redirect, never a 501.
  app.get("/api/mvp/auth/oauth", (req: Request, res: Response) => {
    const params = new URLSearchParams();
    for (const key of ["returnTo", "app"]) {
      const value = req.query[key];
      if (typeof value === "string") params.set(key, value);
    }
    res.redirect(307, `/api/mvp/auth/google/start${params.toString() ? `?${params}` : ""}`);
  });

  // ── Step 1: leave for Google's consent screen ────────────────────────────
  app.get("/api/mvp/auth/google/start", (req: Request, res: Response) => {
    const config = googleConfig();
    if (!isConfigured(config)) {
      res.status(503).json({
        success: false,
        error: {
          code: "GOOGLE_NOT_CONFIGURED",
          message:
            "Google sign-in is not configured on this server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI are required)",
        },
      });
      return;
    }

    const requestedApp = typeof req.query.app === "string" ? req.query.app : "velshop";
    const appKey = Object.prototype.hasOwnProperty.call(APP_ORIGINS, requestedApp)
      ? requestedApp
      : "velshop";
    const nonce = crypto.randomUUID();
    const payload: StatePayload = {
      n: nonce,
      r: safeReturnTo(req.query.returnTo),
      a: appKey,
      t: Date.now(),
    };

    res.cookie(STATE_COOKIE, mintState(payload), {
      httpOnly: true,
      secure: sessionCookieSecure(),
      sameSite: "lax",
      maxAge: STATE_TTL_MS,
      path: STATE_PATH,
    });

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state: nonce,
    });
    res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
  });

  // ── Step 2: Google returns here ─────────────────────────────────────────
  app.get("/api/mvp/auth/google/callback", async (req: Request, res: Response) => {
    const config = googleConfig();
    const cookieState = verifyState(req.cookies?.[STATE_COOKIE]);
    const origin = frontendOrigin(cookieState?.a);
    const returnTo = cookieState?.r ?? "/";

    try {
      if (!isConfigured(config)) {
        throw new ApiError(503, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
      }

      const googleError = typeof req.query.error === "string" ? req.query.error : null;
      if (googleError) {
        clearState(res);
        res.redirect(`${origin}/auth?error=google_denied`);
        return;
      }

      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";
      if (!code) throw new ApiError(400, "GOOGLE_CODE_MISSING", "Authorization code is missing");
      // The cookie is the authority: a state that merely LOOKS right is refused.
      if (!cookieState || !state || cookieState.n !== state) {
        throw new ApiError(403, "GOOGLE_STATE_INVALID", "This sign-in attempt could not be verified");
      }

      const tokens = await exchangeCode(code);
      const profile = await verifyGoogleIdToken(tokens.id_token, { clientId: config.clientId });
      const resolved = await resolveGoogleUser(profile);

      if (resolved.status !== "active") {
        clearState(res);
        res.redirect(`${origin}/auth?error=google_account_inactive`);
        return;
      }

      setSessionCookie(res, createSessionToken(resolved.userId, resolved.email));
      clearState(res);
      res.redirect(`${origin}${returnTo}`);
    } catch (err) {
      clearState(res);
      const code = err instanceof ApiError ? err.code : "GOOGLE_FAILED";
      console.error("[mvp] google sign-in failed:", code);
      const reason =
        code === "GOOGLE_NOT_CONFIGURED"
          ? "google_not_configured"
          : code === "GOOGLE_EMAIL_UNVERIFIED"
            ? "google_email_unverified"
            : "google_failed";
      res.redirect(`${origin}/auth?error=${reason}`);
    }
  });
}
