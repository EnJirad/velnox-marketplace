/**
 * P1 Security Hardening — rate limiting, CSRF/origin validation, abuse controls.
 *
 * Unit tests (always run, no DB):
 *   • Rate limiter: under-limit passes, over-limit → 429 + Retry-After,
 *     window expiry, per-user vs per-IP keying, bounded store + cleanup.
 *   • Route-class registry: checkout/chat/review floods → 429 at their
 *     configured thresholds.
 *   • Origin guard: trusted origin allowed, untrusted → 403, no origin
 *     allowed (non-browser clients), safe methods never checked.
 *   • Oversized JSON body → 413 (mirrors server.ts 1mb limit).
 */
import { describe, expect, test, beforeEach } from "bun:test";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
  createRateLimiter,
  ipKey,
  rateLimitSecurity,
  rateLimitStoreSize,
  resetRateLimitStore,
  sweep,
} from "../middleware/rate-limit.js";
import { createOriginGuard } from "../middleware/origin-guard.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";
const JWT_SECRET = process.env.JWT_SECRET;

function makeToken(userId: string): string {
  return jwt.sign({ userId, email: `${userId}@test.local`, jti: `jti-${userId}` }, JWT_SECRET, { expiresIn: "1h" });
}

function fakeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "POST",
    path: "/",
    cookies: {},
    ip: "203.0.113.7",
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function fakeRes(): { res: Response; statusCode: number; headers: Record<string, string>; body: any } {
  const state = { statusCode: 200, headers: {} as Record<string, string>, body: null as any };
  const res = {
    status(code: number) { state.statusCode = code; return res; },
    json(body: any) { state.body = body; return res; },
    setHeader(k: string, v: string) { state.headers[k] = v; return res; },
  } as unknown as Response;
  return {
    res,
    get statusCode() { return state.statusCode; },
    get headers() { return state.headers; },
    get body() { return state.body; },
  };
}

beforeEach(() => {
  resetRateLimitStore();
});

// ─── Rate limiter core ──────────────────────────────────────────────────────

describe("rate limiter", () => {
  test("allows requests under the limit", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-under", windowMs: 60_000, max: 3, now: () => now });
    for (let i = 0; i < 3; i++) {
      let called = false;
      limiter(fakeReq(), {} as Response, () => { called = true; });
      expect(called).toBe(true);
    }
  });

  test("returns 429 with Retry-After over the limit", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-over", windowMs: 60_000, max: 2, now: () => now });
    const calls: Array<{ status: number; retry?: string }> = [];
    for (let i = 0; i < 3; i++) {
      const r = fakeRes();
      limiter(fakeReq(), r.res, () => {});
      calls.push({ status: r.statusCode, retry: r.headers["Retry-After"] });
    }
    expect(calls[0].status).toBe(200);
    expect(calls[1].status).toBe(200);
    expect(calls[2].status).toBe(429);
    expect(calls[2].retry).toBe("60");
    expect(calls[2].retry).toBeDefined();
  });

  test("429 body uses the frontend-compatible error envelope", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-env", windowMs: 60_000, max: 0, now: () => now });
    const r = fakeRes();
    limiter(fakeReq(), r.res, () => {});
    expect(r.body).toEqual({
      success: false,
      error: { code: "RATE_LIMITED", message: expect.any(String) },
    });
  });

  test("window expiry resets the counter", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-window", windowMs: 60_000, max: 2, now: () => now });
    let blocked = 0;
    for (let i = 0; i < 3; i++) {
      const r = fakeRes();
      limiter(fakeReq(), r.res, () => {});
      if (r.statusCode === 429) blocked++;
    }
    expect(blocked).toBe(1);
    // Advance past the window — traffic flows again.
    now += 61_000;
    let called = false;
    limiter(fakeReq(), {} as Response, () => { called = true; });
    expect(called).toBe(true);
  });

  test("authenticated users are keyed by userId, not IP", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-user", windowMs: 60_000, max: 2, now: () => now });
    // user-A consumes its 2/2 budget
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-A") } }), {} as Response, () => {});
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-A") } }), {} as Response, () => {});
    // user-B shares the same IP but gets a fresh per-user bucket
    let bAllowed = false;
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-B") } }), {} as Response, () => { bAllowed = true; });
    expect(bAllowed).toBe(true);
    // user-A's 3rd request is blocked even though the IP is untouched
    const r = fakeRes();
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-A") } }), r.res, () => {});
    expect(r.statusCode).toBe(429);
  });

  test("ipKey ignores the session cookie (public routes)", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-ip", windowMs: 60_000, max: 1, key: ipKey, now: () => now });
    let called = false;
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-A") } }), {} as Response, () => { called = true; });
    expect(called).toBe(true);
    // Same IP, different user — still shares the IP bucket → blocked.
    let called2 = true;
    limiter(fakeReq({ cookies: { velnox_session: makeToken("user-B") } }), fakeRes().res, () => { called2 = false; });
    expect(called2).toBe(true);
  });

  test("sweep removes expired buckets and the store stays bounded", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-sweep", windowMs: 60_000, max: 1, now: () => now });
    // 500 distinct IPs
    for (let i = 0; i < 500; i++) {
      limiter(fakeReq({ ip: `10.0.0.${i}` }), {} as Response, () => {});
    }
    expect(rateLimitStoreSize()).toBe(500);
    now += 61_000;
    sweep(now); // all buckets expired → store empty
    expect(rateLimitStoreSize()).toBe(0);
  });

  test("store is capped at MAX_BUCKETS under a unique-key flood", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({ name: "t-flood", windowMs: 60_000, max: 1, key: ipKey, now: () => now });
    // 20_500 distinct keys — must not grow unbounded
    for (let i = 0; i < 20_500; i++) {
      limiter(fakeReq({ ip: `flood-${i}` }), {} as Response, () => {});
    }
    expect(rateLimitStoreSize()).toBeLessThanOrEqual(20_000);
    // All buckets were created in the same window → sweeping after expiry clears all
    now += 61_000;
    sweep(now);
    expect(rateLimitStoreSize()).toBe(0);
  });
});

// ─── Route-class registry ───────────────────────────────────────────────────

describe("rateLimitSecurity route classes", () => {
  test("checkout flood → 429 on the 11th request", () => {
    let blocked = 0;
    for (let i = 0; i < 12; i++) {
      const r = fakeRes();
      rateLimitSecurity(fakeReq({ method: "POST", path: "/api/customer/checkout" }), r.res, () => {});
      if (r.statusCode === 429) blocked++;
    }
    expect(blocked).toBe(2); // requests 11 and 12
  });

  test("chat message flood → 429 on the 31st request", () => {
    let blocked = 0;
    for (let i = 0; i < 32; i++) {
      const r = fakeRes();
      rateLimitSecurity(
        fakeReq({ method: "POST", path: "/api/customer/conversations/conv-1/messages" }),
        r.res,
        () => {},
      );
      if (r.statusCode === 429) blocked++;
    }
    expect(blocked).toBe(2);
  });

  test("review create flood → 429 on the 11th request", () => {
    let blocked = 0;
    for (let i = 0; i < 11; i++) {
      const r = fakeRes();
      rateLimitSecurity(fakeReq({ method: "POST", path: "/api/products/prod-1/reviews" }), r.res, () => {});
      if (r.statusCode === 429) blocked++;
    }
    expect(blocked).toBe(1);
  });

  test("public reads are IP-keyed and generous (no false positives)", () => {
    for (let i = 0; i < 50; i++) {
      let called = false;
      rateLimitSecurity(fakeReq({ method: "GET", path: "/api/products/catalog" }), {} as Response, () => { called = true; });
      expect(called).toBe(true);
    }
  });

  test("normal authenticated mutation traffic passes", () => {
    for (let i = 0; i < 5; i++) {
      let called = false;
      rateLimitSecurity(fakeReq({ method: "PATCH", path: "/api/seller/products/prod-1/status" }), {} as Response, () => { called = true; });
      expect(called).toBe(true);
    }
  });
});

// ─── Origin guard (CSRF) ────────────────────────────────────────────────────

describe("origin guard", () => {
  const guard = createOriginGuard(["https://shop.velnox.com", "https://seller.velnox.com", "http://localhost:5173"]);

  test("trusted origin is allowed", () => {
    let called = false;
    guard(fakeReq({ headers: { origin: "https://shop.velnox.com" } }), {} as Response, () => { called = true; });
    expect(called).toBe(true);
  });

  test("untrusted origin is rejected with 403", () => {
    const r = fakeRes();
    guard(fakeReq({ headers: { origin: "https://evil.example.com" } }), r.res, () => {});
    expect(r.statusCode).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  test("missing Origin (non-browser client, Stripe webhook, curl) is allowed", () => {
    let called = false;
    guard(fakeReq(), {} as Response, () => { called = true; });
    expect(called).toBe(true);
  });

  test("safe methods are never checked", () => {
    let called = false;
    guard(fakeReq({ method: "GET", headers: { origin: "https://evil.example.com" } }), {} as Response, () => { called = true; });
    expect(called).toBe(true);
  });
});

// ─── Oversized request body ─────────────────────────────────────────────────

describe("body size limit", () => {
  test("oversized JSON body is rejected with 413 (mirrors server 1mb limit)", async () => {
    const app = express();
    app.use(express.json({ limit: "1kb" }));
    app.post("/t", (_req: Request, res: Response) => res.json({ ok: true }));

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const bigBody = JSON.stringify({ data: "x".repeat(4096) });
      const res = await fetch(`http://127.0.0.1:${port}/t`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigBody,
      });
      expect(res.status).toBe(413);

      const ok = await fetch(`http://127.0.0.1:${port}/t`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "small" }),
      });
      expect(ok.status).toBe(200);
    } finally {
      server.close();
    }
  });
});