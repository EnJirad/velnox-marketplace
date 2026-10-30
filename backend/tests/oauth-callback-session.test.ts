/**
 * OAuth callback — positive session creation (Phase 2H).
 *
 * The rejection paths live in `oauth-route.test.ts` and need no database. This
 * file proves the complementary property: when the state cookie is valid and
 * matches, a (stubbed) Google identity is resolved and a real `velnox_session`
 * is issued, with the internal `returnTo` preserved.
 *
 * DB-gated (`TEST_DATABASE_URL` only): it inserts a unique test customer and
 * deletes it afterwards. Without a disposable PostgreSQL the case SKIPS — it is
 * never pointed at production (`helpers/test-db.ts` refuses that). Google is
 * stubbed; no real OAuth service, credential or account is used.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { OAUTH_STATE_COOKIE } from "../lib/oauth-state.js";
import { hasTestDatabase } from "./helpers/test-db.js";

// Test-only values, set before the dynamic route import. They stay set for
// the process so a sibling OAuth test file is not affected by restoration.
const TEST_GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_ID = TEST_GOOGLE_CLIENT_ID;
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "https://api.velnox.test/auth/google/callback";
process.env.JWT_SECRET ||= "test-secret-for-oauth-session-tests-only-32chars";
process.env.OAUTH_STATE_SECRET ||= process.env.JWT_SECRET;
process.env.VITE_VELSHOP_URL = "https://shop.velnox.test";
process.env.VITE_VELSELLER_URL = "https://seller.velnox.test";
process.env.VITE_VELCENTER_URL = "https://center.velnox.test";

const httpFetch = globalThis.fetch;
const testIfDb = hasTestDatabase() ? test : test.skip;

let server: Server;
let base = "";
let createdUserId: string | null = null;
const googleSub = `oauth-state-test-${crypto.randomUUID()}`;
const googleEmail = `oauth-state-${crypto.randomUUID()}@test.local`;

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
  if (createdUserId) {
    const { query } = await import("../db/index.js");
    // auth_identities and customer_profiles cascade from users.
    await query("DELETE FROM users WHERE id = $1", [createdUserId]).catch(() => {});
  }
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string, cookie?: string): Promise<Response> {
  return httpFetch(`${base}${path}`, {
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), connection: "close" },
  });
}

function setCookieHeaders(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function findCookie(res: Response, name: string): string | undefined {
  const prefix = `${name}=`;
  const found = setCookieHeaders(res).find((c) => c.startsWith(prefix));
  return found ? found.split(";")[0] : undefined;
}

function cookieValue(pair: string | undefined): string {
  if (!pair) return "";
  return pair.slice(pair.indexOf("=") + 1);
}

/** Stub the two Google endpoints the callback uses. Local requests bypass it. */
function stubGoogle(claims: { sub: string; email: string; name: string; picture: string }) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    if (parsed.origin === "https://oauth2.googleapis.com" && parsed.pathname === "/token") {
      return new Response(JSON.stringify({ access_token: "test-access-token", id_token: "test-id-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (parsed.origin === "https://oauth2.googleapis.com" && parsed.pathname === "/tokeninfo") {
      return new Response(
        JSON.stringify({
          ...claims,
          aud: TEST_GOOGLE_CLIENT_ID,
          exp: String(Math.floor(Date.now() / 1000) + 300),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return original(input, init);
  }) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("oauth callback — valid state creates a session", () => {
  testIfDb("issues a real session and preserves an internal returnTo", async () => {
    const startRes = await get("/auth/google?returnTo=%2Fseller%2Fgoals");
    const startLocation = new URL(startRes.headers.get("location") ?? "");
    const state = startLocation.searchParams.get("state") ?? "";
    const stateCookie = findCookie(startRes, OAUTH_STATE_COOKIE);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stateCookie).toBeDefined();

    const google = stubGoogle({
      sub: googleSub,
      email: googleEmail,
      name: "OAuth State Test",
      picture: "",
    });
    let callback: Response;
    try {
      callback = await get(
        `/auth/google/callback?code=fake-authorization-code&state=${encodeURIComponent(state)}`,
        stateCookie!,
      );
    } finally {
      google.restore();
    }

    // Internal returnTo is preserved; no external redirect is possible.
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://seller.velnox.test/seller/goals");

    // A real session cookie, signed with the configured secret and carrying jti.
    const sessionPair = findCookie(callback, "velnox_session");
    expect(sessionPair).toBeDefined();
    const sessionToken = cookieValue(sessionPair);
    expect(sessionToken.length).toBeGreaterThan(20);
    const payload = jwt.verify(sessionToken, process.env.JWT_SECRET!) as {
      userId: string;
      email: string;
      jti?: string;
    };
    expect(payload.email).toBe(googleEmail);
    expect(payload.jti).toBeTruthy();
    createdUserId = payload.userId;

    // The state cookie is consumed in the same response.
    const cleared = setCookieHeaders(callback).some((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=;`));
    expect(cleared).toBe(true);

    // The identity was resolved server-side, exactly once.
    const { query } = await import("../db/index.js");
    const user = await query("SELECT id, email, role FROM users WHERE id = $1", [payload.userId]);
    expect(user.rows[0]?.email).toBe(googleEmail);
    expect(user.rows[0]?.role).toBe("customer");
    const identity = await query(
      "SELECT provider FROM auth_identities WHERE provider_id = $1 AND user_id = $2",
      [googleSub, payload.userId],
    );
    expect(identity.rows[0]?.provider).toBe("google");
  });
});
