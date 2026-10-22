/**
 * MVP API — HTTP plumbing shared by every MVP route module.
 *
 * WHERE IT SITS
 * `backend/mvp/` is the ONLY API tree and is mounted at `/api/mvp` (see
 * `backend/mvp/index.ts`). It reads only the tables declared by `db/schema.sql`;
 * that boundary is asserted by `backend/mvp/tests/isolation.test.ts`, not by a
 * flag or a convention.
 *
 * This file owns the things that must behave identically in every MVP domain:
 *
 *   • the response envelope (`{ success, data }` / `{ success:false, error }`),
 *     matching the existing API so a frontend needs no new error handling;
 *   • turning a thrown `ApiError` — or a PostgreSQL constraint violation — into
 *     an HTTP status instead of a 500;
 *   • input validation that never lets an unvalidated value reach SQL;
 *   • the ONE server-side identity decision every MVP route shares.
 *
 * Authorization rules deliberately live here and not in the handlers: a route
 * that forgets `requireAdmin` must be a missing middleware (visible in review),
 * not a forgotten `if` inside a handler body.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { query } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { parseDecimal, roundHalfUp, formatScaled, MONEY_DECIMALS } from "../lib/money.js";

// ─── Response envelope + errors ─────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

export function badRequest(code: string, message: string): ApiError {
  return new ApiError(400, code, message);
}

export function notFound(code = "NOT_FOUND", message = "Not found"): ApiError {
  return new ApiError(404, code, message);
}

export function conflict(code: string, message: string): ApiError {
  return new ApiError(409, code, message);
}

export function forbidden(code: string, message: string): ApiError {
  return new ApiError(403, code, message);
}

/** PostgreSQL error codes this API maps, with the meaning used in responses. */
const PG_ERROR_MAP: Record<string, { status: number; code: string }> = {
  // unique_violation — a duplicate e-mail, slug, order number or idempotency key
  "23505": { status: 409, code: "DUPLICATE" },
  // foreign_key_violation — a referenced row does not exist / is still referenced
  "23503": { status: 409, code: "REFERENCE_VIOLATION" },
  // check_violation — includes every lifecycle CHECK and trigger RAISE in db/schema.sql
  "23514": { status: 409, code: "CONSTRAINT_VIOLATION" },
  // invalid_text_representation — a malformed uuid / numeric literal
  "22P02": { status: 400, code: "INVALID_INPUT" },
  // raise_exception — a plpgsql trigger RAISE without an explicit ERRCODE.
  // The MVP schema raises this for business rules the constraint engine cannot
  // express (category cycles, product ownership immutability, illegal lifecycle
  // transitions), so it is a 409 like any other refused state change.
  P0001: { status: 409, code: "CONSTRAINT_VIOLATION" },
};

/**
 * Map a database error onto an HTTP response.
 *
 * The schema is the ONE definition of the lifecycle machines (product status,
 * order status, seller approval), so a forbidden transition arrives here as a
 * `23514` raised by a trigger — not as a duplicated state machine in this
 * process. That is why the trigger's own message is safe to return: every RAISE
 * in `db/schema.sql` is authored for an operator, never derived from data.
 */
export function toApiError(err: unknown): ApiError | null {
  if (err instanceof ApiError) return err;
  if (typeof err !== "object" || err === null) return null;
  const pg = err as { code?: unknown; message?: unknown; constraint?: unknown };
  if (typeof pg.code !== "string") return null;
  const mapped = PG_ERROR_MAP[pg.code];
  if (!mapped) return null;
  const detail = typeof pg.message === "string" && pg.message.trim() ? pg.message.trim() : mapped.code;
  return new ApiError(mapped.status, mapped.code, detail);
}

/**
 * Wrap an async handler so a rejected promise becomes a JSON error, never an
 * unhandled rejection that leaves the request hanging.
 */
export function route(
  handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((err: unknown) => {
      const api = toApiError(err);
      if (!api) {
        // Never echo a raw driver error: it can carry SQL, parameters or a
        // connection detail. The log keeps the diagnostic, the client does not.
        console.error("[mvp] unhandled route error:", {
          path: req.path,
          message: err instanceof Error ? err.message : String(err),
        });
        res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
        });
        return;
      }
      res.status(api.status).json({
        success: false,
        error: { code: api.code, message: api.message },
      });
    });
  };
}

/** `{ success: true, data }` — the envelope every existing VelShop route uses. */
export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

// ─── Input validation ───────────────────────────────────────────────────────

function label(field: string): string {
  return field;
}

export function requireString(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): string {
  if (typeof value !== "string") throw badRequest("INVALID_INPUT", `${label(field)} must be a string`);
  const text = value.trim();
  const min = opts.min ?? 1;
  const max = opts.max ?? 500;
  if (text.length < min) throw badRequest("INVALID_INPUT", `${label(field)} must be at least ${min} characters`);
  if (text.length > max) throw badRequest("INVALID_INPUT", `${label(field)} must be at most ${max} characters`);
  return text;
}

/** Optional text field: absent, null, "" and whitespace all mean "not provided". */
export function optionalString(
  value: unknown,
  field: string,
  opts: { max?: number } = {},
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw badRequest("INVALID_INPUT", `${label(field)} must be a string`);
  const text = value.trim();
  if (text.length === 0) return null;
  const max = opts.max ?? 5000;
  if (text.length > max) throw badRequest("INVALID_INPUT", `${label(field)} must be at most ${max} characters`);
  return text;
}

export function requireInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw badRequest("INVALID_INPUT", `${label(field)} must be an integer`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw badRequest("INVALID_INPUT", `${label(field)} must be at least ${opts.min}`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw badRequest("INVALID_INPUT", `${label(field)} must be at most ${opts.max}`);
  }
  return n;
}

/** `NUMERIC(12,2)` upper bound: 10 integer digits, 2 decimals. */
const MONEY_INPUT = /^\d{1,10}(?:\.\d{1,2})?$/;

/**
 * Validate untrusted money and return the canonical 2-decimal STRING that
 * PostgreSQL's `NUMERIC(12,2)` will store.
 *
 * A JSON number is accepted (clients send one) but converted to its decimal
 * text once, here, and never used in arithmetic — `lib/money.ts` owns exact
 * arithmetic. `1e3`, `0x10`, `NaN` and friends are rejected rather than
 * coerced. Money never becomes a JavaScript float anywhere in this tree.
 */
export function requireMoney(
  value: unknown,
  field: string,
  opts: { allowZero?: boolean } = {},
): string {
  const allowZero = opts.allowZero ?? true;
  if (typeof value !== "string" && typeof value !== "number") {
    throw badRequest("INVALID_INPUT", `${label(field)} must be a decimal string or number`);
  }
  const text = String(value).trim();
  if (!MONEY_INPUT.test(text)) {
    throw badRequest("INVALID_INPUT", `${label(field)} must be a non-negative amount with at most 2 decimals`);
  }
  const exact = parseDecimal(text);
  const canonical = formatScaled(roundHalfUp(exact, MONEY_DECIMALS), MONEY_DECIMALS);
  if (!allowZero && canonical === "0.00") {
    throw badRequest("INVALID_INPUT", `${label(field)} must be greater than zero`);
  }
  return canonical;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw badRequest("INVALID_INPUT", `${label(field)} must be a UUID`);
  }
  return value.trim().toLowerCase();
}

/** A uuid path parameter: malformed input is a 400, not a 500 from PostgreSQL. */
export function pathUuid(value: unknown, field = "id"): string {
  return requireUuid(value, field);
}

// ─── Query helpers ──────────────────────────────────────────────────────────

export async function queryOne<T>(
  sql: string,
  params: unknown[],
): Promise<T | null> {
  const result = await query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

// ─── Identity + authorization ───────────────────────────────────────────────

export type UserRole = "customer" | "seller" | "admin" | "owner";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: "active" | "suspended" | "deleted";
}

export interface SellerProfile {
  id: string;
  user_id: string;
  store_name: string;
  slug: string;
  status: "pending" | "approved" | "rejected" | "suspended";
  rejection_reason: string | null;
  suspension_reason: string | null;
}

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireActiveUser`. Never derived from the request body. */
      sessionUser?: SessionUser;
      /** Set by `requireApprovedSeller` for the caller's OWN seller profile. */
      mvpSeller?: SellerProfile;
    }
  }
}

const SESSION_COOKIE = "velnox_session";

export { SESSION_COOKIE };

/**
 * Load the caller's own user row.
 *
 * `requireAuth` (the existing JWT middleware) proves *who* signed the token;
 * this proves the account may still act. A deleted or suspended account keeps a
 * signature-valid token until it expires, so `users.status` is re-read on every
 * authenticated request instead of being trusted from the token.
 */
export async function loadSessionUser(req: Request): Promise<SessionUser> {
  const userId = req.user?.userId;
  if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Not authenticated");
  const row = await queryOne<SessionUser>(
    `SELECT id, email, name, role, status FROM users WHERE id = $1`,
    [userId],
  );
  if (!row) {
    // The token names a user who does not exist in THIS database (e.g. a token
    // minted against another environment). Treat it as unauthenticated.
    throw new ApiError(401, "UNAUTHORIZED", "Session user no longer exists");
  }
  return row;
}

/**
 * The ONE identity decision for the MVP tree: verify the JWT, then load the
 * account row and require it to be active.
 *
 * `requireAuth` (signature + `revoked_tokens`) is invoked HERE rather than
 * listed in every route's middleware array, so a route cannot accidentally run
 * `requireActiveUser` without it — that mistake made every seller/cart/order
 * request answer 401 while `/me` (which listed both) worked. If `requireAuth`
 * has already run, `req.user` is present and this is a no-op.
 *
 * Returns `null` when the caller is anonymous and the 401 response has already
 * been written.
 */
async function authenticateActive(req: Request, res: Response): Promise<SessionUser | null> {
  if (req.sessionUser) return req.sessionUser;
  if (!req.user) {
    await requireAuth(req, res, () => undefined);
    if (!req.user) return null;
  }
  const user = await loadSessionUser(req);
  if (user.status !== "active") {
    throw new ApiError(403, "ACCOUNT_NOT_ACTIVE", "This account is not active");
  }
  req.sessionUser = user;
  return user;
}

/** Middleware: authenticated + active. 401 when anonymous, 403 when suspended. */
export const requireActiveUser: RequestHandler = (req, res, next) => {
  authenticateActive(req, res)
    .then((user) => {
      if (user) next();
    })
    .catch((err: unknown) => next(err));
};

export function isAdminRole(role: string): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Middleware: owner / admin only.
 *
 * There is NO staff permission catalog in the MVP. A role check is the whole
 * rule; adding a second permission axis would be a new feature, not a rewrite.
 */
export const requireAdmin: RequestHandler = (req, res, next) => {
  authenticateActive(req, res)
    .then((user) => {
      if (!user) return;
      if (!isAdminRole(user.role)) {
        next(new ApiError(403, "ADMIN_ONLY", "This action requires an admin account"));
        return;
      }
      next();
    })
    .catch((err: unknown) => next(err));
};

/**
 * Resolve the caller's OWN seller profile. Never accepts a seller id or a
 * `status` claim from the client — the session is the only identity input.
 */
export async function loadSellerProfile(userId: string): Promise<SellerProfile | null> {
  return queryOne<SellerProfile>(
    `SELECT id, user_id, store_name, slug, status, rejection_reason, suspension_reason
       FROM seller_profiles
      WHERE user_id = $1`,
    [userId],
  );
}

/**
 * Middleware: the caller must own an APPROVED seller profile.
 *
 * This is the ONLY seller gate. `pending`, `rejected` and `suspended` are all
 * refusals, so a suspended seller cannot create, edit, submit, publish, price or
 * re-stock anything — and the refusal happens here, before any handler runs, not
 * by hiding a button in a frontend.
 */
export const requireApprovedSeller: RequestHandler = (req, res, next) => {
  authenticateActive(req, res)
    .then(async (user) => {
      if (!user) return;
      const profile = await loadSellerProfile(user.id);
      if (!profile || profile.status !== "approved") {
        next(
          new ApiError(403, "SELLER_NOT_APPROVED", "This action requires an approved seller account"),
        );
        return;
      }
      req.mvpSeller = profile;
      next();
    })
    .catch((err: unknown) => next(err));
};

/** Express error handler for the MVP tree (registered by `setupMvpRoutes`). */
export function mvpErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const api = toApiError(err);
  if (api) {
    res.status(api.status).json({ success: false, error: { code: api.code, message: api.message } });
    return;
  }
  console.error("[mvp] unhandled middleware error:", err instanceof Error ? err.message : String(err));
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
  });
}
