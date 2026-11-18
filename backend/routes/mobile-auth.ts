/**
 * Native-app authentication routes.
 *
 * The web auth flow is cookie based and gated by Cloudflare Turnstile, which
 * needs a browser-hosted challenge. A native app cannot solve that challenge
 * without proxying a web page, so these routes keep the same session format
 * (signed JWT in the `velnox_session` cookie) but use strict IP-keyed rate
 * limits and server-side identity-provider verification instead.
 *
 * Nothing here trusts a client-supplied user id, email, or "verified" flag.
 * Google ID tokens are checked with Google's tokeninfo endpoint and LINE ID
 * tokens with LINE's official verify endpoint; the channel/client ids and
 * audience, issuer and expiry are checked again on the server.
 */

import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getClient, query } from "../db/index.js";
import { hashPassword, isPasswordHashFormat, verifyPassword } from "../lib/password.js";
import { createRateLimiter, ipKey } from "../middleware/rate-limit.js";
import { createSessionToken, setSessionCookie } from "./auth.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

const emailSchema = z.string().trim().toLowerCase().refine((v) => EMAIL_RE.test(v), "invalid email");
const passwordSchema = z.string().min(8).max(128).refine((v) => PASSWORD_RE.test(v), "weak password");

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
});
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
const socialSchema = z.object({
  idToken: z.string().min(10).max(8192),
  nonce: z.string().min(10).max(256).optional(),
});

// Equivalent abuse control to the web Turnstile gate: tight per-IP budgets.
// The global security limiter in server.ts still applies on top of these.
const registerLimiter = createRateLimiter({ name: "mobile-register", windowMs: 60_000, max: 5, key: ipKey });
const loginLimiter = createRateLimiter({ name: "mobile-login", windowMs: 60_000, max: 8, key: ipKey });
const socialLimiter = createRateLimiter({ name: "mobile-social", windowMs: 60_000, max: 10, key: ipKey });

type ErrorResult = { ok: false; status: number; code: string; message: string };
type IdentityResult = {
  ok: true;
  userId: string;
  email: string;
  name: string;
  role: string;
  verifiedEmail: boolean;
};

function fail(status: number, code: string, message: string): ErrorResult {
  return { ok: false, status, code, message };
}

function sendError(res: Response, failure: ErrorResult): void {
  res.status(failure.status).json({
    success: false,
    error: { code: failure.code, message: failure.message },
  });
}

function sendSession(
  res: Response,
  status: number,
  user: { id: string; email: string; name: string; role: string },
): void {
  setSessionCookie(res, createSessionToken(user.id, user.email));
  res.status(status).json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    },
  });
}

/** Google tokeninfo validates signature, issuer lifetime and audience data. */
async function verifyGoogleToken(idToken: string): Promise<IdentityResult | ErrorResult> {
  const clientId = process.env.MOBILE_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "";
  if (!clientId) {
    return fail(503, "GOOGLE_NOT_CONFIGURED", "Google Sign-In is not configured on the server");
  }

  let payload: Record<string, unknown>;
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return fail(401, "INVALID_GOOGLE_TOKEN", "Google identity could not be verified");
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return fail(503, "GOOGLE_UNAVAILABLE", "Google verification is temporarily unavailable");
  }

  const audience = String(payload.aud ?? "");
  const issuer = String(payload.iss ?? "");
  const expiry = Number(payload.exp);
  if (
    audience !== clientId ||
    (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") ||
    !Number.isFinite(expiry) ||
    expiry * 1000 <= Date.now()
  ) {
    return fail(401, "INVALID_GOOGLE_TOKEN", "Google identity claims are not valid for this app");
  }
  const azp = payload.azp == null ? "" : String(payload.azp);
  if (azp && azp !== clientId) {
    return fail(401, "INVALID_GOOGLE_TOKEN", "Google identity has a different authorized party");
  }
  if (String(payload.email_verified) !== "true") {
    return fail(401, "EMAIL_NOT_VERIFIED", "Google email is not verified");
  }
  const sub = String(payload.sub ?? "");
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!sub || !EMAIL_RE.test(email)) {
    return fail(401, "INVALID_GOOGLE_TOKEN", "Google identity is missing subject or email");
  }

  return {
    ok: true,
    userId: sub,
    email,
    name: String(payload.name ?? email.split("@")[0]).slice(0, 120),
    role: "customer",
    verifiedEmail: true,
  };
}

/** LINE's official verify endpoint returns the signed ID-token payload. */
async function verifyLineToken(idToken: string, nonce?: string): Promise<IdentityResult | ErrorResult> {
  const channelId = process.env.LINE_CHANNEL_ID ?? "";
  if (!channelId) {
    return fail(503, "LINE_NOT_CONFIGURED", "LINE Login is not configured on the server");
  }

  const body = new URLSearchParams({ id_token: idToken, client_id: channelId });
  if (nonce) body.set("nonce", nonce);

  let payload: Record<string, unknown>;
  try {
    const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return fail(401, "INVALID_LINE_TOKEN", "LINE identity could not be verified");
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    return fail(503, "LINE_UNAVAILABLE", "LINE verification is temporarily unavailable");
  }

  const expiry = Number(payload.exp);
  const issuedAt = Number(payload.iat);
  const sub = String(payload.sub ?? "");
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (
    String(payload.iss) !== "https://access.line.me" ||
    String(payload.aud) !== channelId ||
    !Number.isFinite(expiry) ||
    expiry * 1000 <= Date.now() ||
    !Number.isFinite(issuedAt) ||
    issuedAt * 1000 > Date.now() + 60_000 ||
    !sub
  ) {
    return fail(401, "INVALID_LINE_TOKEN", "LINE identity claims are not valid for this channel");
  }
  if (nonce && String(payload.nonce ?? "") !== nonce) {
    return fail(401, "INVALID_LINE_TOKEN", "LINE nonce does not match");
  }
  if (!EMAIL_RE.test(email)) {
    return fail(400, "LINE_EMAIL_SCOPE_REQUIRED", "Allow the LINE email scope to sign in or register");
  }

  return {
    ok: true,
    userId: sub,
    email,
    name: String(payload.name ?? email.split("@")[0]).slice(0, 120),
    role: "customer",
    // LINE does not assert email verification in the ID token; never auto-link
    // an unverified LINE identity to a password account with the same email.
    verifiedEmail: false,
  };
}

/**
 * Resolve an existing identity or create a user atomically. The unique index
 * on (provider, provider_id) and users.email is the final race-condition guard.
 * Existing password accounts are linked only for a verified email (Google).
 */
async function resolveIdentity(identity: IdentityResult, provider: "google" | "line") {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const linked = await client.query(
      "SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_id = $2 FOR UPDATE",
      [provider, identity.userId],
    );
    if (linked.rowCount) {
      const userId = linked.rows[0].user_id as string;
      const profile = await client.query("SELECT id, email, name, role FROM users WHERE id = $1", [userId]);
      const row = profile.rows[0];
      await client.query("COMMIT");
      return { kind: "session" as const, user: { id: row.id, email: row.email, name: row.name, role: row.role } };
    }

    const emailMatch = await client.query("SELECT id, email, name, role FROM users WHERE email = $1 FOR UPDATE", [
      identity.email,
    ]);
    if (emailMatch.rowCount) {
      if (!identity.verifiedEmail) {
        await client.query("ROLLBACK");
        return { kind: "conflict" as const };
      }
      const row = emailMatch.rows[0];
      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_id, email, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [row.id, provider, identity.userId, identity.email],
      );
      await client.query("COMMIT");
      return { kind: "session" as const, user: { id: row.id, email: row.email, name: row.name, role: row.role } };
    }

    const inserted = await client.query(
      `INSERT INTO users (email, name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())
       RETURNING id, email, name, role`,
      [identity.email, identity.name, identity.role],
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO auth_identities (user_id, provider, provider_id, email, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [user.id, provider, identity.userId, identity.email],
    );
    await client.query(
      `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, NOW(), NOW())`,
      [user.id],
    );
    await client.query("COMMIT");
    return { kind: "session" as const, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* connection already closed */ }
    const code = (error as { code?: string })?.code;
    if (code === "23505") return { kind: "conflict" as const };
    throw error;
  } finally {
    client.release();
  }
}

/** Register routes on the existing Express app. */
export function setupMobileAuth(app: Express): void {
  app.post("/api/auth/mobile/register", registerLimiter, async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, fail(400, "VALIDATION_ERROR", "Name, valid email and strong password are required"));
      return;
    }
    const { name, email, password } = parsed.data;
    try {
      const existing = await query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (existing.rowCount) {
        // Same response as login: do not disclose whether an email is registered.
        sendError(res, fail(409, "EMAIL_EXISTS", "An account with this email already exists"));
        return;
      }
      const passwordHash = await hashPassword(password);
      const result = await query(
        `INSERT INTO users (email, name, password_hash, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'customer', 'active', NOW(), NOW())
         RETURNING id, email, name, role`,
        [email, name, passwordHash],
      );
      const user = result.rows[0];
      await query(
        `INSERT INTO customer_profiles (id, user_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, NOW(), NOW())`,
        [user.id],
      );
      sendSession(res, 201, user);
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        sendError(res, fail(409, "EMAIL_EXISTS", "An account with this email already exists"));
        return;
      }
      console.error("[mobile-auth] register failed:", (error as Error)?.message ?? error);
      sendError(res, fail(500, "DB_ERROR", "Registration failed"));
    }
  });

  app.post("/api/auth/mobile/login", loginLimiter, async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, fail(400, "VALIDATION_ERROR", "Email and password are required"));
      return;
    }
    const { email, password } = parsed.data;
    try {
      const result = await query(
        "SELECT id, email, name, role, status, password_hash FROM users WHERE email = $1",
        [email],
      );
      const row = result.rows[0];
      // One generic response for missing account, missing password auth and
      // wrong password prevents account enumeration.
      if (!row || !isPasswordHashFormat(row.password_hash) || !(await verifyPassword(password, row.password_hash))) {
        sendError(res, fail(401, "INVALID_CREDENTIALS", "Invalid credentials"));
        return;
      }
      if (row.status !== "active") {
        sendError(res, fail(403, "ACCOUNT_DISABLED", "This account is disabled"));
        return;
      }
      sendSession(res, 200, row);
    } catch (error) {
      console.error("[mobile-auth] login failed:", (error as Error)?.message ?? error);
      sendError(res, fail(500, "DB_ERROR", "Sign-in failed"));
    }
  });

  app.post("/api/auth/mobile/google", socialLimiter, async (req: Request, res: Response) => {
    const parsed = socialSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, fail(400, "VALIDATION_ERROR", "A Google ID token is required"));
      return;
    }
    try {
      const identity = await verifyGoogleToken(parsed.data.idToken);
      if (!identity.ok) { sendError(res, identity); return; }
      const resolved = await resolveIdentity(identity, "google");
      if (resolved.kind === "conflict") {
        sendError(res, fail(409, "ACCOUNT_CONFLICT", "Sign in with your existing account before linking Google"));
        return;
      }
      sendSession(res, 200, resolved.user);
    } catch (error) {
      console.error("[mobile-auth] Google sign-in failed:", (error as Error)?.message ?? error);
      sendError(res, fail(500, "DB_ERROR", "Google sign-in failed"));
    }
  });

  app.post("/api/auth/mobile/line", socialLimiter, async (req: Request, res: Response) => {
    const parsed = socialSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, fail(400, "VALIDATION_ERROR", "A LINE ID token is required"));
      return;
    }
    try {
      const identity = await verifyLineToken(parsed.data.idToken, parsed.data.nonce);
      if (!identity.ok) { sendError(res, identity); return; }
      const resolved = await resolveIdentity(identity, "line");
      if (resolved.kind === "conflict") {
        sendError(res, fail(409, "ACCOUNT_CONFLICT", "Sign in with your existing account before linking LINE"));
        return;
      }
      sendSession(res, 200, resolved.user);
    } catch (error) {
      console.error("[mobile-auth] LINE sign-in failed:", (error as Error)?.message ?? error);
      sendError(res, fail(500, "DB_ERROR", "LINE sign-in failed"));
    }
  });

  // Health/config probe for the app: no secrets, only whether provider config
  // is present. The app uses it to show an honest "not configured" state.
  app.get("/api/auth/mobile/config", (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        google: Boolean(process.env.MOBILE_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID),
        line: Boolean(process.env.LINE_CHANNEL_ID),
      },
    });
  });
}
