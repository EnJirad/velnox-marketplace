/**
 * Cloudflare Turnstile — server-side verification contract.
 *
 * Every case here is a real call to `verifyTurnstile()` with `fetch` replaced
 * by a scripted responder. Nothing is asserted about the network itself; what
 * is asserted is the DECISION the server makes for each answer Cloudflare (or
 * the network) can give it.
 *
 * The rule under test throughout: every failure path is closed. There is no
 * branch that turns "we could not verify" into "let them in".
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  resetTurnstileReplayCache,
  trustedHostnames,
  turnstileStatusFor,
  verifyTurnstile,
} from "../lib/turnstile.js";

const REAL_TOKEN = "0.abcdefghijklmnopqrstuvwxyz1234567890-TURNSTILE-TOKEN";
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = { ...process.env };

interface FetchCall {
  url: string;
  body: string;
}

let calls: FetchCall[] = [];

/** Replace fetch with a scripted responder for the duration of one test. */
function respondWith(
  handler: (body: URLSearchParams) => Response | Promise<Response> | never,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body instanceof URLSearchParams
        ? init.body.toString()
        : "";
    calls.push({ url, body });
    return handler(new URLSearchParams(body));
  }) as typeof fetch;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Every source `trustedHostnames()` reads. Sibling test files set the VITE_*
 * URLs for the whole process, so a case that needs an empty allowlist has to
 * clear all of them — otherwise it silently passes for the wrong reason when
 * run alone and fails in the full suite.
 */
function clearHostSources() {
  setEnv({
    TURNSTILE_HOSTNAMES: undefined,
    CORS_ORIGINS: undefined,
    VITE_VELSHOP_URL: undefined,
    VITE_VELSELLER_URL: undefined,
    VITE_VELCENTER_URL: undefined,
    VITE_VELNOX_URL: undefined,
  });
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  calls = [];
  resetTurnstileReplayCache();
  setEnv({
    TURNSTILE_SECRET_KEY: "test-secret",
    TURNSTILE_HOSTNAMES: "velshop.example.com,velseller.example.com,velcenter.example.com",
    TURNSTILE_TIMEOUT_MS: undefined,
    NODE_ENV: "test",
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe("valid token", () => {
  test("Cloudflare success on a trusted host passes", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "auth" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("challenges.cloudflare.com/turnstile/v0/siteverify");
  });

  test("the secret is sent in the body and never in the URL", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "auth" }));
    await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(calls[0].body).toContain("secret=test-secret");
    expect(calls[0].url).not.toContain("test-secret");
  });

  test("a matching action passes; the token is echoed back to Cloudflare", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "auth" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(true);
    expect(calls[0].body).toContain("response=");
  });
});

describe("invalid token", () => {
  test("success:false is rejected with Cloudflare's own error codes", async () => {
    respondWith(() => jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_INVALID");
    expect(verdict.reason).toContain("invalid-input-response");
  });

  test("a non-2xx siteverify answer is rejected, not retried into success", async () => {
    respondWith(() => jsonResponse({ success: true }, 500));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_UNAVAILABLE");
  });
});

describe("empty and forged tokens", () => {
  test("an empty token never reaches Cloudflare", async () => {
    respondWith(() => jsonResponse({ success: true }));
    const verdict = await verifyTurnstile({ token: "", action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_REQUIRED");
    expect(calls).toHaveLength(0);
  });

  test("a missing token field is rejected", async () => {
    respondWith(() => jsonResponse({ success: true }));
    const verdict = await verifyTurnstile({ token: undefined, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_REQUIRED");
  });

  test('the old frontend bypass literal "bypass" is rejected', async () => {
    respondWith(() => jsonResponse({ success: true }));
    const verdict = await verifyTurnstile({ token: "bypass", action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_REQUIRED");
    expect(calls).toHaveLength(0);
  });

  test('"null" and "undefined" strings are rejected', async () => {
    respondWith(() => jsonResponse({ success: true }));
    expect((await verifyTurnstile({ token: "null" })).ok).toBe(false);
    expect((await verifyTurnstile({ token: "undefined" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("missing secret", () => {
  test("production without a secret FAILS CLOSED", async () => {
    setEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: "production" });
    respondWith(() => jsonResponse({ success: true }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_NOT_CONFIGURED");
    expect(calls).toHaveLength(0);
  });

  test("non-production without a secret skips, and says it skipped", async () => {
    setEnv({ TURNSTILE_SECRET_KEY: undefined, NODE_ENV: "development" });
    const verdict = await verifyTurnstile({ token: "", action: "auth" });
    expect(verdict.ok).toBe(true);
    expect(verdict.skipped).toBe(true);
  });

  test("a whitespace-only secret counts as missing", async () => {
    setEnv({ TURNSTILE_SECRET_KEY: "   ", NODE_ENV: "production" });
    const verdict = await verifyTurnstile({ token: REAL_TOKEN });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_NOT_CONFIGURED");
  });
});

describe("expired token", () => {
  test("Cloudflare's timeout-or-duplicate code maps to EXPIRED", async () => {
    respondWith(() => jsonResponse({ success: false, "error-codes": ["timeout-or-duplicate"] }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_EXPIRED");
  });
});

describe("reused token", () => {
  test("the same token is accepted once and rejected the second time", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "auth" }));
    expect((await verifyTurnstile({ token: REAL_TOKEN, action: "auth" })).ok).toBe(true);
    const second = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(second.ok).toBe(false);
    expect(second.code).toBe("TURNSTILE_REPLAYED");
    // The replay was refused locally — Cloudflare was not asked again.
    expect(calls).toHaveLength(1);
  });
});

describe("wrong hostname", () => {
  test("a challenge solved on an untrusted host is rejected", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "evil.example.net", action: "auth" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_HOSTNAME_MISMATCH");
  });

  test("each of the three Velnox hosts is accepted", async () => {
    for (const host of ["velshop.example.com", "velseller.example.com", "velcenter.example.com"]) {
      resetTurnstileReplayCache();
      respondWith(() => jsonResponse({ success: true, hostname: host, action: "auth" }));
      const verdict = await verifyTurnstile({ token: `${REAL_TOKEN}-${host}`, action: "auth" });
      expect(verdict.ok).toBe(true);
    }
  });

  test("production with no configured hostnames fails closed", async () => {
    clearHostSources();
    setEnv({ NODE_ENV: "production" });
    expect(trustedHostnames()).toHaveLength(0);
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "auth" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_NOT_CONFIGURED");
  });

  test("hostnames are derived from server config, never from a request header", () => {
    clearHostSources();
    setEnv({ CORS_ORIGINS: "https://a.example.com,https://b.example.com" });
    expect(trustedHostnames()).toEqual(["a.example.com", "b.example.com"]);
  });
});

describe("action mismatch", () => {
  test("a token minted for another form is rejected", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com", action: "something_else" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_ACTION_MISMATCH");
  });

  test("a response with no action at all still passes (older widget config)", async () => {
    respondWith(() => jsonResponse({ success: true, hostname: "velshop.example.com" }));
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(true);
  });
});

describe("Cloudflare timeout", () => {
  test("a hanging siteverify aborts and fails closed", async () => {
    setEnv({ TURNSTILE_TIMEOUT_MS: "40" });
    // A fetch that respects the abort signal and never resolves otherwise.
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as typeof fetch;

    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_TIMEOUT");
    expect(turnstileStatusFor("TURNSTILE_TIMEOUT")).toBe(503);
  });
});

describe("Cloudflare network error", () => {
  test("a thrown fetch fails closed", async () => {
    globalThis.fetch = (() => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_UNAVAILABLE");
    expect(turnstileStatusFor("TURNSTILE_UNAVAILABLE")).toBe(503);
  });

  test("a malformed JSON body fails closed instead of crashing", async () => {
    globalThis.fetch = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    const verdict = await verifyTurnstile({ token: REAL_TOKEN, action: "auth" });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe("TURNSTILE_UNAVAILABLE");
  });
});

describe("status mapping", () => {
  test("client faults are 400, infrastructure faults are 503", () => {
    expect(turnstileStatusFor("TURNSTILE_REQUIRED")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_INVALID")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_EXPIRED")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_REPLAYED")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_HOSTNAME_MISMATCH")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_ACTION_MISMATCH")).toBe(400);
    expect(turnstileStatusFor("TURNSTILE_TIMEOUT")).toBe(503);
    expect(turnstileStatusFor("TURNSTILE_UNAVAILABLE")).toBe(503);
    expect(turnstileStatusFor("TURNSTILE_NOT_CONFIGURED")).toBe(503);
  });
});
