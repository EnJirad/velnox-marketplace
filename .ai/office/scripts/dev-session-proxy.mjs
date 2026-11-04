#!/usr/bin/env bun
/**
 * Local authenticated preview — SAFE MODE by default.
 *
 * Serves a built SPA on loopback and forwards `/api/*` to the real backend with
 * the session cookie from `.ai/secrets/browser-cookies.json` added server-side.
 * The browser therefore talks to ONE origin, exactly like the deployed site, and
 * no backend authentication or authorization check is disabled.
 *
 * Security model (enforced here, not documented here):
 *   • loopback only — bound to 127.0.0.1
 *   • SAFE MODE: only GET and HEAD reach the API; every other method is 405 and
 *     never forwarded. Writes need BOTH `PROXY_ALLOW_WRITES=1` and a non-default
 *     API base, i.e. an isolated test backend — never production.
 *   • per-run access gate: `/api/*` requires a random token, delivered once as
 *     `?access=<token>` and then held in an httpOnly, SameSite=Strict cookie.
 *     The token is written to `.ai/secrets/proxy-access-token` (0600), never
 *     printed.
 *   • Host and Origin allowlist, plus `Sec-Fetch-Site` — a page on another origin
 *     cannot drive this proxy even if it guesses the port.
 *   • no header pass-through: the client's cookies, Origin, Referer and
 *     Authorization are dropped; only the stored session cookie is added.
 *   • upstream `Set-Cookie` is stripped, API responses are `no-store`.
 *   • logs carry method, path (no query string), status and duration only.
 *
 * Usage
 *   VITE_API_URL= bun run build:velseller
 *   bun .ai/office/scripts/dev-session-proxy.mjs seller 3001
 *   open http://127.0.0.1:3001/?access=<token from .ai/secrets/proxy-access-token>
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const SECRETS = join(repoRoot, ".ai", "secrets");
const STORE = join(SECRETS, "browser-cookies.json");
const TOKEN_FILE = join(SECRETS, "proxy-access-token");

const SAFE_METHODS = new Set(["GET", "HEAD"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const GATE_COOKIE = "velnox_proxy_gate";
const DEFAULT_API_BASE = "https://velnox-api.onrender.com";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Constant-time compare that never throws on length mismatch. */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function readCookie(header, name) {
  for (const part of String(header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

/**
 * The single authorization decision for one request. Pure: no I/O, no logging.
 * Returns `{ ok: true }` or `{ ok: false, status, code }`.
 */
export function authorizeRequest({
  method,
  host,
  origin,
  secFetchSite,
  cookies,
  accessToken,
  port,
  allowWrites = false,
  writeMode = null,
  gateToken,
}) {
  const loopback = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!loopback.has(String(host ?? ""))) return { ok: false, status: 403, code: "BAD_HOST" };

  const localOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (origin && !localOrigins.has(origin)) return { ok: false, status: 403, code: "BAD_ORIGIN" };
  // Only a genuinely cross-site caller is refused. `same-site`/`none` happen on
  // the very first paint and on same-origin navigations; they are not CSRF.
  if (secFetchSite === "cross-site") {
    return { ok: false, status: 403, code: "CROSS_SITE" };
  }

  const allowed = SAFE_METHODS.has(method) || (allowWrites && WRITE_METHODS.has(method));
  if (!allowed) return { ok: false, status: 405, code: "METHOD_NOT_ALLOWED" };

  const presented = safeEqual(readCookie(cookies, GATE_COOKIE), gateToken) || safeEqual(accessToken, gateToken);
  if (!presented) return { ok: false, status: 401, code: "GATE_REQUIRED" };

  return { ok: true };
}


const PRODUCTION_HOST_DENYLIST = [
  "velnox-api.onrender.com",
  "velnox.com",
  "www.velnox.com",
  "shop.velnox.com",
  "seller.velnox.com",
  "velcenter.velnox.com",
];
const PRODUCTION_SUFFIXES = [".onrender.com", ".vercel.app", ".velnox.com"];

/** A loopback API base is the only proof of isolation this device can verify. */
function parseLoopbackBase(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return { ok: false, code: "BAD_API_URL" };
  }
  if (url.username || url.password) return { ok: false, code: "CREDENTIALS_IN_URL" };

  const hostname = url.hostname;
  // Production is named before protocol/locality so a deployed URL reports as
  // production, not as a generic protocol error.
  if (PRODUCTION_HOST_DENYLIST.includes(hostname)) return { ok: false, code: "PRODUCTION_HOST" };
  if (PRODUCTION_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return { ok: false, code: "PRODUCTION_HOST" };
  if (url.protocol !== "http:") return { ok: false, code: "BAD_PROTOCOL" };
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return { ok: false, code: "NOT_LOOPBACK" };

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, code: "BAD_PORT" };
  if (url.pathname !== "/" && url.pathname !== "") return { ok: false, code: "BAD_PATH" };
  return { ok: true, base: `${url.protocol}//${hostname}:${port}` };
}

/**
 * Fail-closed write-mode gate. Returns `{ ok:true, apiBase, envId }` only when
 * every isolation claim is present AND self-consistent; otherwise a refusal
 * code. Nothing here writes, and no partial credit is given.
 */
export function validateWriteMode({ env = process.env, readFile = readFileSync, stat = statSync } = {}) {
  if (env.PROXY_ALLOW_WRITES !== "1") return { ok: false, code: "WRITES_DISABLED" };

  const envId = String(env.PROXY_TEST_ENV_ID ?? "");
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(envId) || envId.includes("prod")) {
    return { ok: false, code: "BAD_ENV_ID" };
  }

  const rawBase = env.PROXY_TEST_API_BASE;
  if (!rawBase) return { ok: false, code: "NO_TEST_API_BASE" };
  const parsed = parseLoopbackBase(rawBase);
  if (!parsed.ok) return { ok: false, code: parsed.code };

  const proofPath = env.PROXY_TEST_DB_PROOF;
  if (!proofPath) return { ok: false, code: "NO_PROOF" };

  let mode;
  try {
    mode = stat(proofPath).mode & 0o777;
  } catch {
    return { ok: false, code: "PROOF_UNREADABLE" };
  }
  if (mode !== 0o600) return { ok: false, code: "PROOF_PERMISSIONS" };

  let proof;
  try {
    proof = JSON.parse(readFile(proofPath, "utf8"));
  } catch {
    return { ok: false, code: "PROOF_MALFORMED" };
  }

  if (proof.environment !== "test") return { ok: false, code: "NOT_TEST_ENV" };
  if (proof.writesApproved !== true) return { ok: false, code: "WRITES_NOT_APPROVED" };
  if (proof.disposable !== true) return { ok: false, code: "DB_NOT_DISPOSABLE" };
  if (String(proof.envId ?? "") !== envId) return { ok: false, code: "ENV_ID_MISMATCH" };
  if (String(proof.apiBase ?? "") !== parsed.base) return { ok: false, code: "API_BASE_MISMATCH" };

  const dbHost = String(proof.databaseUrlHost ?? "");
  if (dbHost !== "127.0.0.1" && dbHost !== "localhost") return { ok: false, code: "DB_NOT_ISOLATED" };
  if (PRODUCTION_HOST_DENYLIST.includes(dbHost) || PRODUCTION_SUFFIXES.some((suffix) => dbHost.endsWith(suffix))) {
    return { ok: false, code: "DB_PRODUCTION" };
  }

  const expires = Date.parse(String(proof.expiresAt ?? ""));
  if (!Number.isFinite(expires) || expires < Date.now()) return { ok: false, code: "PROOF_EXPIRED" };

  return { ok: true, apiBase: parsed.base, envId };
}

function loadStore() {
  const store = JSON.parse(readFileSync(STORE, "utf8"));
  const mode = statSync(STORE).mode & 0o777;
  if (mode & 0o077) throw new Error(`cookie store must be 0600 (is ${mode.toString(8)}) — chmod 600 ${STORE}`);
  return store;
}

export function createProxyServer({
  port = 3001,
  accountKey = "seller",
  appDir = "apps/velseller",
  distDir: distOverride = null,
  allowWrites = false,
  writeMode = null,
  gateToken = randomBytes(32).toString("hex"),
  store = null,
  fetchImpl = fetch,
} = {}) {
  const data = store ?? loadStore();
  const account = data.accounts?.[accountKey];
  if (!account) throw new Error(`unknown account "${accountKey}"`);

  const cookieName = data.cookieName ?? "velnox_session";
  const token = account.cookies?.[cookieName];
  if (!token) throw new Error(`account "${accountKey}" has no ${cookieName}`);
  if (account.expiresAt && Date.parse(account.expiresAt) < Date.now()) {
    throw new Error(`cookie for "${accountKey}" expired at ${account.expiresAt}`);
  }

  // Fail closed: writes exist only when a verified isolated environment was
  // proven by validateWriteMode(). A bare boolean is never enough.
  if (allowWrites && !writeMode?.ok) throw new Error("write mode refused: NO_VERIFIED_TEST_ENVIRONMENT");
  const apiBase = writeMode?.apiBase ?? data.apiBase ?? DEFAULT_API_BASE;

  const distDir = distOverride ?? resolve(repoRoot, appDir, "dist");
  if (!existsSync(distDir)) throw new Error(`missing ${distDir} — build the app first`);

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 60,
    async fetch(req) {
      const started = Date.now();
      const url = new URL(req.url);
      const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

      // One-time entry: a valid ?access= token becomes an httpOnly gate cookie
      // and is removed from the URL, so the SPA's own fetches carry it.
      const presented = url.searchParams.get("access");
      if (presented) {
        if (!safeEqual(presented, gateToken)) {
          return new Response(JSON.stringify({ success: false, error: { code: "GATE_REQUIRED" } }), {
            status: 401,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });
        }
        const clean = new URL(url);
        clean.searchParams.delete("access");
        return new Response(null, {
          status: 302,
          headers: {
            location: `${clean.pathname}${clean.search}`,
            "set-cookie": `${GATE_COOKIE}=${gateToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`,
            "cache-control": "no-store",
          },
        });
      }

      if (!isApi) {
        const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
        let file = join(distDir, rel);
        if (rel === "/" || !existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
        const ext = file.slice(file.lastIndexOf("."));
        return new Response(Bun.file(file), {
          headers: {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "x-content-type-options": "nosniff",
            "cache-control": "no-store",
          },
        });
      }

      const decision = authorizeRequest({
        method: req.method,
        host: url.host,
        origin: req.headers.get("origin") ?? "",
        secFetchSite: req.headers.get("sec-fetch-site") ?? "",
        cookies: req.headers.get("cookie") ?? "",
        accessToken: url.searchParams.get("access") ?? "",
        gateToken,
        port,
        allowWrites,
      });

      if (!decision.ok) {
        console.error(`proxy: ${req.method} ${url.pathname} -> ${decision.status} ${decision.code}`);
        return new Response(JSON.stringify({ success: false, error: { code: decision.code } }), {
          status: decision.status,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }

      // Drop access from the forwarded URL — it is not part of the API contract.
      const search = new URLSearchParams(url.search);
      search.delete("access");

      const headers = new Headers();
      headers.set("cookie", `${cookieName}=${token}`);
      headers.set("accept", req.headers.get("accept") ?? "application/json");
      const contentType = req.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);
      // Origin/Referer/Authorization from the local client are deliberately not
      // forwarded: GET/HEAD never need them, and impersonating a deployed origin
      // would be a trust bypass.

      const upstream = await fetchImpl(`${apiBase}${url.pathname}${search.size ? `?${search}` : ""}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        redirect: "manual",
      });

      const out = new Headers(upstream.headers);
      out.delete("set-cookie");
      out.delete("content-encoding");
      out.delete("content-length");
      out.delete("location");
      out.delete("access-control-allow-origin");
      out.delete("access-control-allow-credentials");
      out.set("cache-control", "no-store");
      out.set("x-content-type-options", "nosniff");

      console.log(`${req.method} ${url.pathname} -> ${upstream.status} (${Date.now() - started}ms)`);
      return new Response(upstream.body, { status: upstream.status, headers: out });
    },
  });

  return { server, port, gateToken, apiBase };
}

function main() {
  const accountKey = process.argv[2] ?? "seller";
  const port = Number(process.argv[3] ?? 3001);
  const appDir = process.argv[4] ?? "apps/velseller";
  const requestedWrites = process.env.PROXY_ALLOW_WRITES === "1";
  const writeMode = requestedWrites ? validateWriteMode() : null;
  if (requestedWrites && !writeMode.ok) {
    console.error(`proxy: write mode refused (${writeMode.code}) — staying in SAFE MODE`);
  }
  const allowWrites = Boolean(writeMode?.ok);

  const gateToken = process.env.PROXY_ACCESS_TOKEN || randomBytes(32).toString("hex");
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, gateToken + "\n", { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);

  const { server, apiBase } = createProxyServer({
    port,
    accountKey,
    appDir,
    allowWrites,
    gateToken,
    writeMode: writeMode?.ok ? writeMode : null,
  });

  console.log(`proxy: http://127.0.0.1:${port}  account=${accountKey}  api=${apiBase}  mode=${allowWrites ? "WRITE-TEST" : "SAFE (GET/HEAD)"}`);
  console.log(`proxy: access token file ${TOKEN_FILE} (0600) — open /?access=<token>`);

  const stop = () => {
    console.log("proxy: shutting down");
    server.stop(true);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) main();
