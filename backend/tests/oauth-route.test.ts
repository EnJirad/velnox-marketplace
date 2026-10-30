/**
 * OAuth callback gate — route-level proof for Phase 2H (Phase 2G finding H-1).
 *
 * These tests exercise the REAL Express handlers mounted by `setupGoogleAuth`:
 *
 *   • `/auth/google` mints an opaque random state and a bound httpOnly cookie;
 *   • the callback refuses a missing / mismatched / forged / expired state
 *     BEFORE it ever contacts Google;
 *   • a valid Google authorization code with invalid state creates no session;
 *   • the state cookie is consumed (cleared) by every callback;
 *   • a replayed callback (state without its cookie) is rejected.
 *
 * The token endpoint is stubbed, so no real Google call, credential or
 * production account is used. Rejection paths never touch the database; the
 * positive session-creation path is covered by `oauth-callback-session.test.ts`
 * and skips without a disposable PostgreSQL.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_MS, createOAuthState } from "../lib/oauth-state.js";

// The route module reads these at import time — set them before the dynamic
// import below. No real credential: the token endpoint is always stubbed.
// These are test-only values and stay set for the process (restoring shared
// env mid-run would break a sibling OAuth test file that loaded later).
const TEST_GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "https://api.velnox.test/auth/google/callback";
process.env.JWT_SECRET ||= "test-secret-for-oauth-route-tests-only-32chars";
process.env.OAUTH_STATE_SECRET ||= process.env.JWT_SECRET;
process.env.VITE_VELSHOP_URL = "https://shop.velnox.test";
process.env.VITE_VELSELLER_URL = "https://seller.velnox.test";
process.env.VITE_VELCENTER_URL = "https://center.velnox.test";

/** Direct reference so the local HTTP client survives a `fetch` stub. */
const httpFetch = globalThis.fetch;

let server: Server;
let base = "";

beforeAll(async () => {
  const { setupGoogleAuth } = await import("../routes/auth.js");
  const app = express();
  app.use(cookieParser());
  setupGoogleAuth(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string, cookie?: string): Promise<Response> {
  return httpFetch(`${base}${path}`, {
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      connection: "close",
    },
  });
}

function setCookieHeaders(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function cookieHeader(pairAndAttributes: string): string {
  return pairAndAttributes.split(";")[0];
}

function cookieValue(pairAndAttributes: string): string {
  const pair = cookieHeader(pairAndAttributes);
  return pair.slice(pair.indexOf("=") + 1);
}

function stateCookie(res: Response): string | undefined {
  return setCookieHeaders(res).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
}

function sessionCookie(res: Response): string | undefined {
  return setCookieHeaders(res).find((c) => c.startsWith("velnox_session=") && !c.startsWith("velnox_session=;"));
}

function stateCookieWasCleared(res: Response): boolean {
  return setCookieHeaders(res).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=;`));
}

interface FlowStart {
  state: string;
  cookie: string;
  cookieValue: string;
}

async function startFlow(returnTo: string): Promise<FlowStart> {
  const res = await get(`/auth/google?returnTo=${encodeURIComponent(returnTo)}`);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location") ?? "");
  expect(location.origin).toBe("https://accounts.google.com");
  const state = location.searchParams.get("state") ?? "";
  const cookie = stateCookie(res);
  expect(cookie).toBeDefined();
  return { state, cookie: cookieHeader(cookie!), cookieValue: cookieValue(cookie!) };
}

/**
 * Stub the token endpoint with Google's real failure shape. Counts calls so a
 * test can prove a rejected callback never exchanges the code. Requests to the
 * local test server bypass the stub.
 */
function stubGoogleTokenExchange(): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    if (parsed.origin === "https://oauth2.googleapis.com" && parsed.pathname === "/token") {
      calls++;
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  }) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calls: () => calls,
  };
}

describe("oauth start", () => {
  test("mints an opaque state and a browser-bound httpOnly cookie", async () => {
    const res = await get("/auth/google?returnTo=%2Fcart");
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(TEST_GOOGLE_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(process.env.GOOGLE_REDIRECT_URI);

    const state = location.searchParams.get("state") ?? "";
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Not the pre-2H user-controlled payload:
    const legacy = Buffer.from(JSON.stringify({ returnTo: "/cart" })).toString("base64url");
    expect(state).not.toBe(legacy);

    const cookie = stateCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie!).toContain("HttpOnly");
    expect(cookie!).toMatch(/SameSite=Lax/i);
    expect(cookie!).toMatch(/Path=\/auth/i);
    expect(cookie!).toMatch(/Max-Age=600/i);
  });

  test("two starts produce different states and cookies", async () => {
    const a = await startFlow("/cart");
    const b = await startFlow("/cart");
    expect(a.state).not.toBe(b.state);
    expect(a.cookieValue).not.toBe(b.cookieValue);
  });

  test("the state does not carry the returnTo path", async () => {
    const start = await startFlow("/seller/goals");
    const decoded = Buffer.from(start.state, "base64url").toString("utf8");
    expect(decoded).not.toContain("returnTo");
    expect(decoded).not.toContain("/seller/goals");
  });
});

describe("oauth callback — state gate", () => {
  test("missing state is rejected without exchanging the code", async () => {
    const start = await startFlow("/cart");
    const google = stubGoogleTokenExchange();
    try {
      const res = await get("/auth/google/callback?code=fake-authorization-code", start.cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
      expect(stateCookieWasCleared(res)).toBe(true);
    } finally {
      google.restore();
    }
  });

  test("state from another flow (mismatch) is rejected", async () => {
    const browserA = await startFlow("/cart");
    const browserB = await startFlow("/cart");
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(browserB.state)}`,
        browserA.cookie,
      );
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
    } finally {
      google.restore();
    }
  });

  test("state without its cookie (another browser) is rejected", async () => {
    const start = await startFlow("/cart");
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(start.state)}`,
      );
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
    } finally {
      google.restore();
    }
  });

  test("expired state is rejected without exchanging the code", async () => {
    const expired = createOAuthState("/cart", Date.now() - OAUTH_STATE_TTL_MS - 1_000);
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(expired.state)}`,
        `${OAUTH_STATE_COOKIE}=${expired.cookieValue}`,
      );
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
    } finally {
      google.restore();
    }
  });

  test("a forged state cookie is rejected", async () => {
    const start = await startFlow("/cart");
    const [payload, signature] = start.cookieValue.split(".");
    const forged = `${(payload[0] === "A" ? "B" : "A") + payload.slice(1)}.${signature}`;
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(start.state)}`,
        `${OAUTH_STATE_COOKIE}=${forged}`,
      );
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
    } finally {
      google.restore();
    }
  });

  test("repeated code query params are treated as missing (400)", async () => {
    const start = await startFlow("/cart");
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=a&code=b&state=${encodeURIComponent(start.state)}`,
        start.cookie,
      );
      expect(res.status).toBe(400);
      expect(google.calls()).toBe(0);
      expect(sessionCookie(res)).toBeUndefined();
      expect(stateCookieWasCleared(res)).toBe(true);
    } finally {
      google.restore();
    }
  });
});

describe("oauth callback — valid state", () => {
  test("a valid state reaches the token exchange exactly once, still creating no session when Google fails", async () => {
    const start = await startFlow("/cart");
    const google = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(start.state)}`,
        start.cookie,
      );
      expect(google.calls()).toBe(1);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_failed");
      expect(sessionCookie(res)).toBeUndefined();
      expect(stateCookieWasCleared(res)).toBe(true);
    } finally {
      google.restore();
    }
  });

  test("a replayed callback (state without its consumed cookie) is rejected", async () => {
    const start = await startFlow("/cart");
    const first = stubGoogleTokenExchange();
    try {
      await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(start.state)}`,
        start.cookie,
      );
      expect(first.calls()).toBe(1);
    } finally {
      first.restore();
    }

    // The browser no longer holds the cookie (the route cleared it above).
    const replay = stubGoogleTokenExchange();
    try {
      const res = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(start.state)}`,
      );
      expect(replay.calls()).toBe(0);
      expect(res.headers.get("location")).toBe("https://shop.velnox.test/auth?error=google_state_invalid");
      expect(sessionCookie(res)).toBeUndefined();
    } finally {
      replay.restore();
    }
  });
});
