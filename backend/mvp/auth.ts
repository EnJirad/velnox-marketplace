/**
 * MVP auth — email + password, plus Google sign-in (`oauth.ts`).
 *
 * Both credential paths end in the same `velnox_session` cookie and the same
 * `users` row; a Google identity is linked through `user_identities`, so a
 * shopper who signed up with a password keeps their orders when they later use
 * the Google button.
 *
 * Security decisions:
 *   • passwords are hashed with the existing scrypt helper (`lib/password.ts`);
 *     no new hashing scheme is introduced;
 *   • `role` is NEVER read from the request — every signup is a `customer`, and
 *     seller status is a separate, admin-approved row;
 *   • the login response is identical for an unknown e-mail and a wrong
 *     password, and a dummy hash verification runs for an unknown e-mail so the
 *     response time does not reveal which accounts exist;
 *   • a suspended/deleted account cannot sign in even with the right password.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ApiError,
  badRequest,
  ok,
  optionalString,
  queryOne,
  requireActiveUser,
  requireString,
  route,
  type SessionUser,
} from "./http.js";
import { setupMvpOAuthRoutes } from "./oauth.js";
import { createSessionToken, setSessionCookie } from "./session.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A syntactically valid hash used only to equalise timing for unknown e-mails. */
const DUMMY_HASH =
  "$scrypt$16384$8$1$0000000000000000000000000000000000000000000000000000000000000000$" +
  "0".repeat(128);

function normalizeEmail(value: unknown): string {
  const email = requireString(value, "email", { max: 254 }).toLowerCase();
  if (!EMAIL.test(email)) throw badRequest("INVALID_EMAIL", "A valid email address is required");
  return email;
}

function requirePassword(value: unknown): string {
  if (typeof value !== "string") throw badRequest("INVALID_INPUT", "password must be a string");
  if (value.length < 8) throw badRequest("WEAK_PASSWORD", "Password must be at least 8 characters");
  if (value.length > 200) throw badRequest("WEAK_PASSWORD", "Password must be at most 200 characters");
  return value;
}

function publicUser(user: SessionUser): Record<string, unknown> {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function issueSession(res: Response, user: { id: string; email: string }): void {
  setSessionCookie(res, createSessionToken(user.id, user.email));
}

/** Constant-time comparison for the owner bootstrap secret. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setupMvpAuthRoutes(app: Express): void {
  // ── Sign up ───────────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/auth/signup",
    route(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeEmail(body.email);
      const password = requirePassword(body.password);
      const name = optionalString(body.name, "name", { max: 120 }) ?? "";

      const passwordHash = await hashPassword(password);
      const inserted = await query(
        `INSERT INTO users (email, name, password_hash, role, status)
         VALUES ($1, $2, $3, 'customer', 'active')
         ON CONFLICT (lower(email)) DO NOTHING
         RETURNING id, email, name, role, status`,
        [email, name, passwordHash],
      );
      const user = inserted.rows[0] as SessionUser | undefined;
      if (!user) {
        throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists");
      }

      issueSession(res, user);
      ok(res, { user: publicUser(user) }, 201);
    }),
  );

  // ── Sign in ───────────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/auth/login",
    route(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const email = normalizeEmail(body.email);
      if (typeof body.password !== "string" || body.password.length === 0) {
        throw badRequest("INVALID_INPUT", "password is required");
      }

      const row = await queryOne<SessionUser & { password_hash: string | null }>(
        `SELECT id, email, name, role, status, password_hash
           FROM users
          WHERE lower(email) = $1`,
        [email],
      );

      if (!row || !row.password_hash) {
        await verifyPassword(body.password, DUMMY_HASH);
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      }

      const matches = await verifyPassword(body.password, row.password_hash);
      if (!matches) {
        throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
      }
      if (row.status !== "active") {
        throw new ApiError(403, "ACCOUNT_NOT_ACTIVE", "This account is not active");
      }

      const user: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        status: row.status,
      };
      issueSession(res, user);
      ok(res, { user: publicUser(user) });
    }),
  );

  // ── Sign out ──────────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/auth/logout",
    route(async (req: Request, res: Response) => {
      const { revokeSessionCookie } = await import("./session.js");
      const revoked = await revokeSessionCookie(res);
      ok(res, { revoked });
    }),
  );

  // ── Current session ───────────────────────────────────────────────────────
  app.get(
    "/api/mvp/auth/me",
    requireAuth,
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const profile = await queryOne<{
        id: string;
        email: string;
        name: string;
        phone: string | null;
        avatar_url: string | null;
        cover_url: string | null;
        role: string;
        created_at: string;
      }>(
        `SELECT id, email, name, phone, avatar_url, cover_url, role, created_at
           FROM users WHERE id = $1`,
        [user.id],
      );
      if (!profile) throw new ApiError(401, "UNAUTHORIZED", "Session user no longer exists");

      const seller = await queryOne<{ id: string; status: string; store_name: string; slug: string }>(
        `SELECT id, status, store_name, slug FROM seller_profiles WHERE user_id = $1`,
        [user.id],
      );
      ok(res, {
        user: {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          phone: profile.phone,
          avatarUrl: profile.avatar_url,
          coverUrl: profile.cover_url,
          role: profile.role,
          createdAt: profile.created_at,
        },
        seller: seller
          ? { id: seller.id, status: seller.status, storeName: seller.store_name, slug: seller.slug }
          : null,
      });
    }),
  );

  // ── Owner bootstrap ───────────────────────────────────────────────────────
  // A brand-new MVP database has no admin. This creates the FIRST owner only,
  // requires BOOTSTRAP_OWNER_SECRET (fail closed when unset), and refuses once
  // any owner exists. It mirrors the pre-MVP `POST /api/admin/claim-owner`
  // contract instead of inventing a second back door.
  app.post(
    "/api/mvp/auth/bootstrap-owner",
    route(async (req: Request, res: Response) => {
      const expected = process.env.BOOTSTRAP_OWNER_SECRET;
      if (!expected) {
        throw new ApiError(
          503,
          "BOOTSTRAP_DISABLED",
          "Owner bootstrap is disabled: BOOTSTRAP_OWNER_SECRET is not configured",
        );
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const secret = requireString(body.secret, "secret", { max: 200 });
      if (!secretMatches(secret, expected)) {
        throw new ApiError(403, "FORBIDDEN", "Invalid bootstrap secret");
      }

      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE role IN ('owner', 'admin') LIMIT 1`,
        [],
      );
      if (existing) {
        throw new ApiError(409, "OWNER_EXISTS", "An owner/admin account already exists");
      }

      const email = normalizeEmail(body.email);
      const password = requirePassword(body.password);
      const name = optionalString(body.name, "name", { max: 120 }) ?? "Owner";
      const passwordHash = await hashPassword(password);

      const inserted = await query(
        `INSERT INTO users (email, name, password_hash, role, status)
         VALUES ($1, $2, $3, 'owner', 'active')
         ON CONFLICT (lower(email)) DO NOTHING
         RETURNING id, email, name, role, status`,
        [email, name, passwordHash],
      );
      const user = inserted.rows[0] as SessionUser | undefined;
      if (!user) throw new ApiError(409, "EMAIL_IN_USE", "An account with this email already exists");

      issueSession(res, user);
      ok(res, { user: publicUser(user) }, 201);
    }),
  );

  setupMvpOAuthRoutes(app);
}
