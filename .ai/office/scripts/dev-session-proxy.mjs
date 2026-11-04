#!/usr/bin/env bun
/**
 * Local authenticated preview for a Velnox app.
 *
 * Why this exists: seller/customer sessions are `httpOnly` cookies, so a page
 * cannot set them from JavaScript and the in-app browser cannot be handed one.
 * This proxy serves a built SPA on http://localhost and forwards `/api/*` to the
 * real backend with the session cookie from `.ai/secrets/browser-cookies.json`
 * added server-side. The browser therefore talks to ONE origin, exactly like the
 * deployed site, and no authentication check is disabled or reimplemented —
 * every request still gets its answer from the production API.
 *
 * NOT a mock: responses are the real backend's. Nothing is written.
 *
 * Usage
 *   VITE_API_URL= bun run build:velseller          # API calls become relative
 *   bun .ai/office/scripts/dev-session-proxy.mjs seller 5190
 *   → http://localhost:5190/seller/shop
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const storePath = join(repoRoot, ".ai", "secrets", "browser-cookies.json");

const accountKey = process.argv[2] ?? "seller";
const port = Number(process.argv[3] ?? 5190);
const appDir = process.argv[4] ?? "apps/velseller";
const distDir = join(repoRoot, appDir, "dist");

if (!existsSync(distDir)) {
  console.error(`dev-session-proxy: ${distDir} missing — build first: VITE_API_URL= bun run build:velseller`);
  process.exit(1);
}

let store;
try {
  store = JSON.parse(readFileSync(storePath, "utf8"));
} catch {
  console.error("dev-session-proxy: no cookie store at .ai/secrets/browser-cookies.json (see ESSENTIAL_RULES §11)");
  process.exit(1);
}

const account = store.accounts?.[accountKey];
if (!account) {
  console.error(`dev-session-proxy: unknown account "${accountKey}"`);
  process.exit(1);
}

const cookieName = store.cookieName ?? "velnox_session";
const token = account.cookies?.[cookieName];
if (!token) {
  console.error(`dev-session-proxy: account "${accountKey}" has no ${cookieName}`);
  process.exit(1);
}
if (account.expiresAt && Date.parse(account.expiresAt) < Date.now()) {
  console.error(`dev-session-proxy: cookie expired at ${account.expiresAt}`);
  process.exit(1);
}

const apiBase = store.apiBase ?? "https://velnox-api.onrender.com";
// The backend's origin guard allowlists the deployed frontends.
const spoofOrigin = account.origins?.[0] ?? "https://velseller.vercel.app";

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

Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      const headers = new Headers(req.headers);
      headers.set("cookie", `${cookieName}=${token}`);
      headers.set("origin", spoofOrigin);
      headers.set("referer", `${spoofOrigin}/`);
      headers.delete("host");
      headers.delete("content-length");

      const upstream = await fetch(`${apiBase}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        redirect: "manual",
      });

      const out = new Headers(upstream.headers);
      out.delete("content-encoding");
      out.delete("content-length");
      // Same-origin from the browser's point of view; keep CORS out of the way.
      out.delete("access-control-allow-origin");
      out.delete("access-control-allow-credentials");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }

    // Static assets with SPA fallback.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(distDir, rel);
    if (rel === "/" || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(distDir, "index.html");
    }
    const ext = file.slice(file.lastIndexOf("."));
    return new Response(Bun.file(file), {
      headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
    });
  },
});

console.log(`dev-session-proxy: http://127.0.0.1:${port}  (account=${accountKey}, api=${apiBase})`);
