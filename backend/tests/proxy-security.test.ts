/**
 * Security contract for the local authenticated preview proxy.
 *
 * The proxy injects a real production session cookie into `/api/*` requests, so
 * every restriction here is load-bearing: a caller that reaches it without the
 * gate, or with a state-changing method, is exercising someone's account.
 *
 * Tests run against a LOCAL echo upstream, never the production API.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { statSync } from "node:fs";
import { createProxyServer, authorizeRequest, safeEqual } from "../../.ai/office/scripts/dev-session-proxy.mjs";

const root = join(import.meta.dir, "..", "..");

// ── local echo upstream ────────────────────────────────────────────────────
let upstream;
let upstreamPort;
const seen = [];

const SECRET_COOKIE = "TEST-SESSION-VALUE-NOT-REAL";

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ method: req.method, path: url.pathname, url: `${url.pathname}${url.search}`, cookie: req.headers.get("cookie") });
      return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          // A hostile upstream header the proxy must never forward.
          "set-cookie": "leak=1; Path=/",
        },
      });
    },
  });
  upstreamPort = upstream.port;
});

afterAll(() => upstream?.stop(true));

const testStore = {
  cookieName: "velnox_session",
  apiBase: `http://127.0.0.1:0`, // replaced per-server below
  accounts: {
    seller: {
      role: "seller",
      cookies: { velnox_session: SECRET_COOKIE },
      expiresAt: "2999-01-01T00:00:00Z",
    },
    stale: {
      role: "seller",
      cookies: { velnox_session: SECRET_COOKIE },
      expiresAt: "2000-01-01T00:00:00Z",
    },
  },
};

const PORT = 4111;
const GATE = "test-gate-token-0123456789";
let proxy;

beforeAll(() => {
  proxy = createProxyServer({
    port: PORT,
    accountKey: "seller",
    gateToken: GATE,
    store: { ...testStore, apiBase: `http://127.0.0.1:${upstreamPort}` },
    distDir: join(root, "apps", "velseller", "dist"),
  });
});

afterAll(() => proxy?.server.stop(true));

const gateHeaders = { cookie: `velnox_proxy_gate=${GATE}` };
const base = `http://127.0.0.1:${PORT}`;

describe("safe mode — method allowlist", () => {
  for (const method of ["GET", "HEAD"]) {
    test(`${method} reaches the upstream`, async () => {
      const before = seen.length;
      const res = await fetch(`${base}/api/auth/me`, { method, headers: gateHeaders });
      expect(res.status).toBe(200);
      expect(seen.length).toBe(before + 1);
    });
  }

  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    test(`${method} is refused and never forwarded`, async () => {
      const before = seen.length;
      const res = await fetch(`${base}/api/seller/shop`, {
        method,
        headers: { ...gateHeaders, "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : "{}",
      });
      expect(res.status).toBe(405);
      expect(await res.json()).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
      expect(seen.length).toBe(before); // the upstream never saw it
    });
  }
});

describe("safe mode — unusual methods over a raw socket", () => {
  test("TRACE is answered 405 and never reaches the upstream", async () => {
    const before = seen.length;
    const raw = `TRACE /api/auth/me HTTP/1.1\r\nHost: localhost:${PORT}\r\nCookie: velnox_proxy_gate=${GATE}\r\nConnection: close\r\n\r\n`;
    const response = await new Promise((resolve, reject) => {
      let data = "";
      const socket = Bun.connect({
        hostname: "127.0.0.1",
        port: PORT,
        socket: {
          open(s) {
            s.write(raw);
          },
          data(_s, chunk) {
            data += new TextDecoder().decode(chunk);
          },
          close() {
            resolve(data);
          },
          error(_s, err) {
            reject(err);
          },
        },
      });
      setTimeout(() => resolve(data), 3000);
      void socket;
    });
    expect(String(response)).toContain("HTTP/1.1 405");
    expect(seen.length).toBe(before);
  });
});

describe("safe mode — unusual methods (decision only)", () => {
  // fetch() refuses to send TRACE/CONNECT, so the decision function is asserted.
  for (const method of ["TRACE", "CONNECT", "PROPFIND"]) {
    test(`${method} is not an allowed method`, () => {
      const decision = authorizeRequest({
        method,
        host: `127.0.0.1:${PORT}`,
        origin: "",
        secFetchSite: "",
        cookies: `velnox_proxy_gate=${GATE}`,
        accessToken: "",
        gateToken: GATE,
        port: PORT,
      });
      expect(decision).toEqual({ ok: false, status: 405, code: "METHOD_NOT_ALLOWED" });
    });
  }
});

describe("safe mode — local access gate", () => {
  test("no gate cookie and no token → 401, upstream untouched", async () => {
    const before = seen.length;
    const res = await fetch(`${base}/api/auth/me`);
    expect(res.status).toBe(401);
    expect(seen.length).toBe(before);
  });

  test("a wrong gate cookie → 401", async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: { cookie: "velnox_proxy_gate=nope" } });
    expect(res.status).toBe(401);
  });

  test("a valid ?access= token sets the gate cookie and strips itself", async () => {
    const res = await fetch(`${base}/?access=${GATE}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("velnox_proxy_gate=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  test("a wrong ?access= token is refused without a cookie", async () => {
    const res = await fetch(`${base}/?access=wrong`, { redirect: "manual" });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("a valid ?access= token never reaches the upstream (cookie only)", async () => {
    const before = seen.length;
    const res = await fetch(`${base}/?access=${GATE}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location") ?? "").not.toContain("access");
    expect(seen.length).toBe(before); // the redirect is answered locally
    expect(seen.some((entry) => entry.url.includes("access"))).toBe(false);
  });
});

describe("safe mode — host, origin and cross-site", () => {
  test("a foreign Origin is refused", async () => {
    const before = seen.length;
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { ...gateHeaders, origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
    expect(seen.length).toBe(before);
  });

  test("a cross-site fetch is refused", async () => {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { ...gateHeaders, "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  test("a same-origin fetch is accepted", async () => {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { ...gateHeaders, origin: base, "sec-fetch-site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  test("a non-loopback Host is refused (pure decision)", () => {
    const decision = authorizeRequest({
      method: "GET",
      host: "example.com:443",
      origin: "",
      secFetchSite: "",
      cookies: `velnox_proxy_gate=${GATE}`,
      accessToken: "",
      gateToken: GATE,
      port: PORT,
    });
    expect(decision).toEqual({ ok: false, status: 403, code: "BAD_HOST" });
  });
});

describe("safe mode — response hygiene", () => {
  test("upstream Set-Cookie never reaches the browser", async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: gateHeaders });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("an /api response body never contains the session value", async () => {
    const res = await fetch(`${base}/api/auth/me`, { headers: gateHeaders });
    const body = await res.text();
    expect(body).not.toContain(SECRET_COOKIE);
  });

  test("the upstream receives exactly the stored session cookie", async () => {
    await fetch(`${base}/api/auth/me`, { headers: { ...gateHeaders, cookie: `${gateHeaders.cookie}; evil=1` } });
    const last = seen[seen.length - 1];
    expect(last.cookie).toBe(`velnox_session=${SECRET_COOKIE}`);
  });
});

describe("session validity", () => {
  test("an expired account is refused before the server starts", () => {
    expect(() =>
      createProxyServer({
        port: 4112,
        accountKey: "stale",
        gateToken: GATE,
        store: { ...testStore, apiBase: `http://127.0.0.1:${upstreamPort}` },
        distDir: join(root, "apps", "velseller", "dist"),
      }),
    ).toThrow(/expired/);
  });

  test("a bare write flag is refused without a verified environment", () => {
    expect(() =>
      createProxyServer({
        port: 4113,
        accountKey: "seller",
        allowWrites: true, // a boolean alone must never enable writes
        gateToken: GATE,
        store: { ...testStore, apiBase: "https://velnox-api.onrender.com" },
        distDir: join(root, "apps", "velseller", "dist"),
      }),
    ).toThrow(/NO_VERIFIED_TEST_ENVIRONMENT/);
  });

  test("constant-time compare rejects length and empty mismatches", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual(undefined, "x")).toBe(false);
  });
});

describe("storage and lifecycle", () => {
  test("the cookie store is excluded from git", () => {
    const out = execFileSync("git", ["check-ignore", "-v", ".ai/secrets/browser-cookies.json"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain(".ai/secrets/");
  });

  test("the proxy access-token file is excluded from git", () => {
    const out = execFileSync("git", ["check-ignore", "-v", ".ai/secrets/proxy-access-token"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(out).toContain(".ai/secrets/");
  });

  test("the cookie store must be 0600", () => {
    const mode = statSync(join(root, ".ai", "secrets", "browser-cookies.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("stopping the proxy closes the port", async () => {
    const temp = createProxyServer({
      port: 4114,
      accountKey: "seller",
      gateToken: GATE,
      store: { ...testStore, apiBase: `http://127.0.0.1:${upstreamPort}` },
      distDir: join(root, "apps", "velseller", "dist"),
    });
    temp.server.stop(true);
    let failed = false;
    try {
      await fetch("http://127.0.0.1:4114/api/auth/me", { headers: gateHeaders });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
