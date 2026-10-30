/**
 * OAuth state — CSRF nonce + browser binding (Phase 2H, Phase 2G finding H-1).
 *
 * The old implementation used `base64url(JSON.stringify({ returnTo }))` as the
 * OAuth `state` and never compared it, so any valid Google authorization code
 * was accepted with any `state`. These unit tests pin the replacement:
 *
 *   • the state is a 256-bit CSPRNG value, never user data or a timestamp;
 *   • it is bound to a signed, expiring cookie rather than being self-describing;
 *   • mismatched / missing / forged / expired state is rejected;
 *   • returnTo is a separate, independently sanitized internal path.
 *
 * No network, no database, no Google call.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_PATH,
  OAUTH_STATE_TTL_MS,
  createOAuthState,
  isOAuthStateConfigured,
  sanitizeReturnTo,
  validateOAuthState,
} from "../lib/oauth-state.js";

const FALLBACK_SECRET = "test-secret-for-oauth-state-tests-only-32chars!!";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = FALLBACK_SECRET;
process.env.OAUTH_STATE_SECRET ||= FALLBACK_SECRET;

const BASE_NOW = 1_700_000_000_000;

/** Flip the first character of a base64url segment to a different valid one. */
function flipFirst(segment: string): string {
  return (segment[0] === "A" ? "B" : "A") + segment.slice(1);
}

const read = (rel: string) => readFileSync(join(import.meta.dir, "..", rel), "utf-8");

describe("oauth state — generation", () => {
  test("the state is an opaque 256-bit base64url nonce", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    expect(start.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start.returnTo).toBe("/cart");
    expect(start.maxAgeMs).toBe(OAUTH_STATE_TTL_MS);
  });

  test("the state is not the old base64url(JSON({returnTo})) payload", () => {
    const start = createOAuthState("/seller/goals", BASE_NOW);
    const legacy = Buffer.from(JSON.stringify({ returnTo: "/seller/goals" })).toString("base64url");
    expect(start.state).not.toBe(legacy);
    // Decoding the random nonce must not reveal the return path as JSON.
    const decoded = Buffer.from(start.state, "base64url").toString("utf8");
    expect(decoded).not.toContain("returnTo");
    expect(decoded).not.toBe('{"returnTo":"/seller/goals"}');
  });

  test("the return path is carried by the signed cookie, not by the state", () => {
    const start = createOAuthState("/checkout", BASE_NOW);
    const [payload] = start.cookieValue.split(".");
    const envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(envelope.r).toBe("/checkout");
    expect(envelope.n).toBe(start.state);
    expect(start.cookieValue).toContain(".");
  });

  test("two flows with the same returnTo produce different state and cookies", () => {
    const a = createOAuthState("/cart", BASE_NOW);
    const b = createOAuthState("/cart", BASE_NOW);
    expect(a.state).not.toBe(b.state);
    expect(a.cookieValue).not.toBe(b.cookieValue);
  });

  test("500 generated states are unique and unpredictable", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const { state } = createOAuthState("/");
      // 43 base64url characters; a real CSPRNG draw almost always mixes many
      // distinct characters. A timestamp / counter encoding cannot.
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(new Set(state).size).toBeGreaterThan(10);
      seen.add(state);
    }
    expect(seen.size).toBe(500);
  });

  test("no Math.random or timestamp input is used for the nonce", () => {
    const lib = read("lib/oauth-state.ts");
    expect(lib).toContain("crypto.randomBytes");
    expect(lib).not.toContain("Math.random");
    // Same nonce family must not be seeded from wall-clock entropy only.
    expect(lib).toContain("timingSafeEqual");
  });

  test("cookie constants are pinned", () => {
    expect(OAUTH_STATE_COOKIE).toBe("velnox_oauth_state");
    expect(OAUTH_STATE_PATH).toBe("/auth");
    expect(OAUTH_STATE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe("oauth state — validation", () => {
  test("a matching state and cookie are accepted and return the internal path", () => {
    const start = createOAuthState("/seller/goals?tab=orders", BASE_NOW);
    expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, BASE_NOW)).toEqual({
      ok: true,
      returnTo: "/seller/goals?tab=orders",
    });
  });

  test("missing state is rejected", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    expect(validateOAuthState({ returnedState: undefined, cookieValue: start.cookieValue }, BASE_NOW)).toEqual({
      ok: false,
      reason: "missing_state",
    });
    expect(validateOAuthState({ returnedState: "", cookieValue: start.cookieValue }, BASE_NOW)).toEqual({
      ok: false,
      reason: "missing_state",
    });
  });

  test("a state without its cookie is rejected (another browser / consumed flow)", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    expect(validateOAuthState({ returnedState: start.state, cookieValue: undefined }, BASE_NOW)).toEqual({
      ok: false,
      reason: "missing_cookie",
    });
    expect(validateOAuthState({ returnedState: start.state, cookieValue: "" }, BASE_NOW)).toEqual({
      ok: false,
      reason: "missing_cookie",
    });
  });

  test("state from one flow cannot be validated with another flow's cookie", () => {
    const browserA = createOAuthState("/cart", BASE_NOW);
    const browserB = createOAuthState("/cart", BASE_NOW);
    expect(
      validateOAuthState({ returnedState: browserA.state, cookieValue: browserB.cookieValue }, BASE_NOW),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  test("a tampered cookie payload is rejected", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    const [payload, signature] = start.cookieValue.split(".");
    const tampered = `${flipFirst(payload)}.${signature}`;
    expect(validateOAuthState({ returnedState: start.state, cookieValue: tampered }, BASE_NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("a tampered signature is rejected", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    const [payload, signature] = start.cookieValue.split(".");
    const tampered = `${payload}.${flipFirst(signature)}`;
    expect(validateOAuthState({ returnedState: start.state, cookieValue: tampered }, BASE_NOW)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("a structurally malformed cookie is rejected", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    for (const cookieValue of ["", "noseparator", "a.b.c", ".sig", "payload."]) {
      const result = validateOAuthState({ returnedState: start.state, cookieValue }, BASE_NOW);
      expect(result.ok).toBe(false);
    }
  });

  test("a cookie signed with a different secret is rejected", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    const previous = process.env.OAUTH_STATE_SECRET;
    try {
      process.env.OAUTH_STATE_SECRET = "a completely different signing secret";
      expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, BASE_NOW)).toEqual({
        ok: false,
        reason: "bad_signature",
      });
    } finally {
      process.env.OAUTH_STATE_SECRET = previous;
    }
  });

  test("expired state is rejected, and the boundary is exact", () => {
    const start = createOAuthState("/cart", 1_000, 5_000); // expires at 6,000
    expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, 5_999).ok).toBe(true);
    expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, 6_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, 60_000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("a state value is single-use once its cookie is consumed", () => {
    const start = createOAuthState("/cart", BASE_NOW);
    // First callback: the route clears the cookie as part of validation.
    expect(validateOAuthState({ returnedState: start.state, cookieValue: start.cookieValue }, BASE_NOW).ok).toBe(true);
    // Replay of the same callback URL from the same browser: the cookie is gone.
    expect(validateOAuthState({ returnedState: start.state, cookieValue: undefined }, BASE_NOW)).toEqual({
      ok: false,
      reason: "missing_cookie",
    });
  });

  test("validation never throws on hostile input", () => {
    for (const returnedState of ["", "//evil.example", "{}", "a".repeat(5000), null, 42, ["a", "b"]]) {
      expect(() => validateOAuthState({ returnedState, cookieValue: {} as unknown as string }, BASE_NOW)).not.toThrow();
    }
  });
});

describe("oauth state — returnTo sanitization", () => {
  test("legitimate internal paths are preserved", () => {
    const cases: Array<[string, string]> = [
      ["/", "/"],
      ["/cart", "/cart"],
      ["/checkout", "/checkout"],
      ["/seller/goals", "/seller/goals"],
      ["/seller/goals?tab=orders", "/seller/goals?tab=orders"],
      ["/products/123?page=2#reviews", "/products/123?page=2#reviews"],
      ["  /cart  ", "/cart"],
    ];
    for (const [input, expected] of cases) {
      expect(sanitizeReturnTo(input)).toBe(expected);
    }
  });

  test("external, protocol-relative and scheme payloads are normalized to /", () => {
    const cases = [
      "https://evil.example/steal",
      "http://evil.example",
      "//evil.example",
      "//evil.example/seller",
      "/\\evil.example",
      "/%2e%2e//evil.example",
      "/..//evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "evil.example",
      "\u0000/cart",
      "/cart\u0000",
    ];
    for (const input of cases) {
      expect(sanitizeReturnTo(input)).toBe("/");
    }
  });

  test("non-strings and oversized values fall back to /", () => {
    for (const input of [undefined, null, 42, {}, [], true]) {
      expect(sanitizeReturnTo(input)).toBe("/");
    }
    expect(sanitizeReturnTo(`/${"a".repeat(600)}`)).toBe("/");
  });

  test("a forged returnTo cannot escape the origin even if the cookie envelope is edited", () => {
    const start = createOAuthState("//evil.example", BASE_NOW);
    // The entry point sanitizes before signing...
    expect(start.returnTo).toBe("/");
    const [payload] = start.cookieValue.split(".");
    const envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(envelope.r).toBe("/");
  });
});

describe("oauth state — configuration", () => {
  test("without any signing secret the mechanism fails closed", () => {
    const jwt = process.env.JWT_SECRET;
    const dedicated = process.env.OAUTH_STATE_SECRET;
    try {
      delete process.env.JWT_SECRET;
      delete process.env.OAUTH_STATE_SECRET;
      expect(isOAuthStateConfigured()).toBe(false);
      expect(() => createOAuthState("/cart", BASE_NOW)).toThrow();
    } finally {
      process.env.JWT_SECRET = jwt;
      process.env.OAUTH_STATE_SECRET = dedicated;
    }
  });

  test("the OAuth route no longer derives state from returnTo", () => {
    const route = read("routes/auth.ts");
    expect(route).not.toContain("Buffer.from(JSON.stringify({ returnTo }))");
    expect(route).toContain("createOAuthState(req.query.returnTo)");
    expect(route).toContain("validateOAuthState({ returnedState, cookieValue: stateCookie })");
  });
});
