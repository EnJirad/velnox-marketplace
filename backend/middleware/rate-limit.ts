import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";

/**
 * Bounded in-memory fixed-window rate limiter.
 *
 * DEPLOYMENT NOTE (single-instance):
 *   The backend runs on Render with no shared store (no Redis). This limiter
 *   is therefore a *per-process* guard: it is correct for a single instance
 *   and still raises the bar on multi-instance deployments, but a determined
 *   attacker could spread requests across instances. If the API is scaled to
 *   multiple instances, move the store to a shared backend (Upstash Redis)
 *   without changing the rule configuration.
 *
 * The store is deliberately bounded to avoid unbounded memory growth:
 *   • fixed windows expire and are lazily reaped on access,
 *   • a periodic sweep (60s) removes expired buckets,
 *   • a hard cap evicts the soonest-expiring buckets when exceeded.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

/** Hard cap on live buckets. Prevents memory abuse from unique-IP floods. */
const MAX_BUCKETS = 20_000;
/** Sweep expired buckets at most once per interval. */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweep = 0;

let sweepTimer: ReturnType<typeof setInterval> | null = null;
function ensureSweepTimer(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweep(Date.now()), SWEEP_INTERVAL_MS);
  sweepTimer.unref();
}

/** Remove expired buckets; if still over the cap, evict soonest-expiring. */
export function sweep(now: number): void {
  for (const [k, b] of store) {
    if (b.resetAt <= now) store.delete(k);
  }
  if (store.size <= MAX_BUCKETS) return;
  const victims = [...store.entries()]
    .sort((a, b) => a[1].resetAt - b[1].resetAt)
    .slice(0, store.size - MAX_BUCKETS);
  for (const [k] of victims) store.delete(k);
}

/** Test/ops hook: clear all buckets (used by unit tests). */
export function resetRateLimitStore(): void {
  store.clear();
}

/** Test/ops hook: current number of live buckets (bounded-store assertions). */
export function rateLimitStoreSize(): number {
  return store.size;
}

export interface RateLimitOptions {
  /** Label for the store key (per rule). */
  name: string;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests per window per key. */
  max: number;
  /** Key selector. Defaults to session userId when valid, else client IP. */
  key?: (req: Request) => string;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/** Per-key identity: authenticated userId when a valid session is present, else IP. */
function defaultKey(req: Request): string {
  const token = req.cookies?.velnox_session;
  if (typeof token === "string" && token) {
    try {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        const payload = jwt.verify(token, secret) as { userId?: string };
        if (payload?.userId) return `u:${payload.userId}`;
      }
    } catch {
      /* invalid/expired — fall through to IP */
    }
  }
  return `ip:${req.ip ?? "unknown"}`;
}

/** Key by client IP regardless of session (used for unauthenticated/public routes). */
export function ipKey(req: Request): string {
  return `ip:${req.ip ?? "unknown"}`;
}

export function createRateLimiter(opts: RateLimitOptions): RequestHandler {
  const { name, windowMs, max } = opts;
  const keyFn = opts.key ?? defaultKey;
  const nowFn = opts.now ?? Date.now;

  return (req: Request, res: Response, next: NextFunction) => {
    ensureSweepTimer();
    const now = nowFn();
    if (now - lastSweep > SWEEP_INTERVAL_MS) {
      sweep(now);
      lastSweep = now;
    }

    const bucketKey = `${name}::${keyFn(req)}`;
    let bucket = store.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      store.set(bucketKey, bucket);
      // Guard against a flood of brand-new unique keys (spoofed IPs / user ids).
      if (store.size > MAX_BUCKETS) sweep(now);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        success: false,
        error: { code: "RATE_LIMITED", message: "Too many requests. Please try again shortly." },
      });
      return;
    }
    next();
  };
}

/**
 * Route-class rate-limit registry. First matching rule wins.
 *
 * Justification for the chosen limits:
 *   • Auth endpoints are unauthenticated → IP-keyed and tight (redirect/consent spam).
 *   • Money/order mutations are user-keyed and low (10/min) — they already have
 *     server-side idempotency (checkout_requests) as the primary guard; the limiter
 *     only caps obvious abuse and payment-session spam.
 *   • Chat is user-keyed 30/min (≈90 KB/min at the 4,000-char cap) to stop flooding
 *     without hurting real conversations.
 *   • Reviews are user-keyed 10/min — one-review-per-user-per-product is enforced by
 *     the DB logic; this stops create/delete churn spam.
 *   • Upload intents are user-keyed 20/min — presigned URL generation is the abuse
 *     surface (files themselves go straight to R2).
 *   • Public reads are IP-keyed and generous (300/min) so normal browsing is never
 *     affected while simple flood attacks are capped.
 *   • A 600/min per-IP catch-all raises the floor for everything else.
 */

const ip = ipKey;

/** Route-class rules. First match wins; limiters are created once at module load. */
const RULES: Array<{ match: (req: Request) => boolean; limiter: RequestHandler }> = [
  // ── Authentication (unauthenticated, IP-keyed) ───────────────────────────
  { match: (req) => req.method === "GET" && req.path === "/auth/google", limiter: createRateLimiter({ name: "auth-init", windowMs: 60_000, max: 30, key: ip }) },
  { match: (req) => req.method === "GET" && req.path === "/auth/google/callback", limiter: createRateLimiter({ name: "auth-callback", windowMs: 60_000, max: 120, key: ip }) },
  { match: (req) => req.method === "POST" && req.path === "/api/auth/logout", limiter: createRateLimiter({ name: "logout", windowMs: 60_000, max: 60 }) },
  { match: (req) => req.method === "POST" && req.path === "/api/admin/claim-owner", limiter: createRateLimiter({ name: "claim-owner", windowMs: 60_000, max: 10, key: ip }) },

  // ── Money / order mutations (user-keyed — idempotency is the primary guard) ──
  { match: (req) => req.method === "POST" && req.path === "/api/customer/checkout", limiter: createRateLimiter({ name: "checkout", windowMs: 60_000, max: 10 }) },
  { match: (req) => req.method === "POST" && req.path === "/api/stripe/checkout", limiter: createRateLimiter({ name: "stripe-checkout", windowMs: 60_000, max: 10 }) },
  { match: (req) => req.method === "PATCH" && /^\/api\/customer\/orders\/[^/]+\/cancel$/.test(req.path), limiter: createRateLimiter({ name: "order-cancel", windowMs: 60_000, max: 10 }) },
  { match: (req) => req.method === "POST" && req.path === "/api/customer/reorder", limiter: createRateLimiter({ name: "reorder", windowMs: 60_000, max: 10 }) },
  { match: (req) => req.method === "POST" && /^\/api\/velrepeat\/(plans\/[^/]+\/run-now|repeat-now)$/.test(req.path), limiter: createRateLimiter({ name: "velrepeat-run", windowMs: 60_000, max: 5 }) },

  // ── Reviews (user-keyed) ─────────────────────────────────────────────────
  { match: (req) => req.method === "POST" && /^\/api\/products\/[^/]+\/reviews$/.test(req.path), limiter: createRateLimiter({ name: "review-create", windowMs: 60_000, max: 10 }) },
  { match: (req) => (req.method === "PATCH" || req.method === "DELETE") && /^\/api\/reviews\/[^/]+$/.test(req.path), limiter: createRateLimiter({ name: "review-mutate", windowMs: 60_000, max: 10 }) },

  // ── Chat (user-keyed — flooding stops at the server) ────────────────────
  { match: (req) => req.method === "POST" && /^\/api\/(customer|seller)\/conversations\/[^/]+\/messages$/.test(req.path), limiter: createRateLimiter({ name: "chat-send", windowMs: 60_000, max: 30 }) },
  { match: (req) => (req.method === "PATCH" || req.method === "PUT") && /^\/api\/customer\/notifications/.test(req.path), limiter: createRateLimiter({ name: "notify-read", windowMs: 60_000, max: 120 }) },

  // ── Verification submissions (user-keyed — evidence spam guard) ─────────
  { match: (req) => req.method === "POST" && /^\/api\/seller\/verification$/.test(req.path), limiter: createRateLimiter({ name: "seller-verification", windowMs: 60_000, max: 5 }) },
  { match: (req) => req.method === "POST" && /^\/api\/seller\/products\/[^/]+\/verification$/.test(req.path), limiter: createRateLimiter({ name: "product-verification", windowMs: 60_000, max: 5 }) },

  // ── Seller product images (user-keyed — presign generation is the surface) ─
  { match: (req) => req.method === "POST" && /^\/api\/seller\/products\/(draft-upload-intent|image-upload-intent)$/.test(req.path), limiter: createRateLimiter({ name: "seller-upload-intent", windowMs: 60_000, max: 30 }) },
  { match: (req) => req.method === "POST" && /^\/api\/seller\/products\/save-image$/.test(req.path), limiter: createRateLimiter({ name: "seller-upload-confirm", windowMs: 60_000, max: 60 }) },

  // ── Uploads (user-keyed — presign generation is the abuse surface) ───────
  { match: (req) => req.method === "POST" && (req.path === "/api/upload/presign" || req.path === "/api/customer/profile-image/upload-intent"), limiter: createRateLimiter({ name: "upload-intent", windowMs: 60_000, max: 20 }) },
  { match: (req) => req.method === "POST" && (req.path === "/api/upload/confirm" || req.path === "/api/customer/profile-image/save"), limiter: createRateLimiter({ name: "upload-confirm", windowMs: 60_000, max: 40 }) },

  // ── Cart / addresses / wishlist / profile (user-keyed, generous) ─────────
  { match: (req) => (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") && /^\/api\/customer\/(cart|addresses|wishlist)/.test(req.path), limiter: createRateLimiter({ name: "customer-mutations", windowMs: 60_000, max: 60 }) },
  { match: (req) => req.method === "PUT" && req.path === "/api/customer/profile", limiter: createRateLimiter({ name: "profile-update", windowMs: 60_000, max: 30 }) },

  // ── Seller (user-keyed) ──────────────────────────────────────────────────
  { match: (req) => (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") && /^\/api\/seller\/(products|orders|shipments|returns|goals|subscriptions|velrepeat)/.test(req.path), limiter: createRateLimiter({ name: "seller-mutations", windowMs: 60_000, max: 60 }) },

  // ── Admin (user-keyed) ───────────────────────────────────────────────────
  { match: (req) => (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") && /^\/api\/admin\//.test(req.path), limiter: createRateLimiter({ name: "admin-mutations", windowMs: 60_000, max: 60 }) },

  // ── Public reads (IP-keyed, generous) ────────────────────────────────────
  { match: (req) => req.method === "GET" && /^\/api\/products\/[^/]+\/reviews$/.test(req.path), limiter: createRateLimiter({ name: "reviews-read", windowMs: 60_000, max: 300, key: ip }) },
  { match: (req) => req.method === "GET" && /^\/api\/(products|categories|shops|memory|auth\/me)/.test(req.path), limiter: createRateLimiter({ name: "public-read", windowMs: 60_000, max: 300, key: ip }) },

  // ── Catch-all floor ──────────────────────────────────────────────────────
  { match: () => true, limiter: createRateLimiter({ name: "global", windowMs: 60_000, max: 600, key: ip }) },
];

export const rateLimitSecurity: RequestHandler = (req, res, next) => {
  for (const rule of RULES) {
    if (rule.match(req)) {
      rule.limiter(req, res, next);
      return;
    }
  }
  next();
};