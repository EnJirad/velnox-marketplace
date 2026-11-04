# AI Report — Proxy hardening + VelCenter QA

**Date:** 2026-11-04

## A. Repository state

| | |
|---|---|
| Branch | `main` |
| Starting SHA | `a87f4b53b77222b52dc7022d10b0a15eac954afe` |
| Hardening commit | `502ce94dfd5178da99e1a08adc361e92eea39786` |
| Final SHA | this report's commit (immediately after `502ce94`) |
| Working tree | clean before and after; no unrelated file touched |

## B. Security audit

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Any local caller reaching port 3001 received the production session cookie on every `/api/*` request — no caller auth, no method limit | **Critical** | per-run access gate + `GET`/`HEAD` allowlist |
| 2 | Origin/Referer were rewritten to a deployed frontend, impersonating a trusted origin and defeating the backend origin guard | **High** | no spoofing; the backend accepts `GET`/`HEAD` without Origin (`backend/middleware/origin-guard.ts:12`) |
| 3 | Upstream `Set-Cookie` was forwarded to the browser | **High** | response `set-cookie` stripped |
| 4 | All methods and bodies were proxied | **High** | `405` for anything but `GET`/`HEAD`, never forwarded |
| 5 | No Host/Origin/Sec-Fetch-Site validation | Medium | explicit loopback allowlists |
| 6 | Cookie store permissions unchecked at runtime | Low | refuse to start unless the store is `0600`; expired accounts refuse at startup |

Residual risks (accepted, documented): the gate token is stored in
`.ai/secrets/proxy-access-token` (0600, gitignored) and is only as strong as the
device's file permissions; the proxy still translates a real production session
into local HTTP, so it must only be run on a trusted device.

## C. Cookie store and proxy

**Safe mode is enforced, not described.** `authorizeRequest()` is the single
decision point; `createProxyServer()` calls it before any upstream fetch.

- Methods: `GET`, `HEAD` → forwarded. `POST/PUT/PATCH/DELETE/OPTIONS/CONNECT/
  TRACE/PROPFIND` → `405`, upstream counter unchanged in tests.
- Gate: `/?access=<token>` → `302` + `velnox_proxy_gate` (`HttpOnly`,
  `SameSite=Strict`, 1 h) and the token is removed from the URL. Without it,
  `/api/*` → `401`.
- Host/Origin: only `127.0.0.1:PORT` / `localhost:PORT`; a foreign `Origin` or
  `Sec-Fetch-Site: cross-site` → `403`.
- Cookie handling: client cookies, `Origin`, `Referer`, `Authorization` are
  dropped; exactly one stored cookie is added for `/api/*`.
- Logging: `method path -> status (ms)`, path only, no query string, no headers.
- Writes: `PROXY_ALLOW_WRITES=1` **and** a non-production `apiBase`, else the
  server throws at construction. No isolated backend exists, so write mode was
  never enabled.
- Lifecycle: `SIGINT`/`SIGTERM` stop the server; the test suite proves the port
  is closed after `stop()`.

**Automated tests:** `backend/tests/proxy-security.test.ts` — 30 pass, against a
local echo upstream (never production). TRACE/CONNECT are asserted over a raw
socket because `fetch()` refuses to send them.

**Browser-side session test:** after clearing a stale JS-visible
`velnox_session` from the cookie jar, `document.cookie` is empty and
`/api/auth/me` still answers `200`. The browser holds no session cookie; the
proxy injects it server-side. (The stale entry was produced by the *pre-hardening*
proxy, which had not stripped `Set-Cookie`; that path is now impossible.)

## D. VelCenter browser QA

- **Authenticated role available:** `seller` only (verified via `GET /api/auth/me`).
  No owner/admin/staff session exists in the store.
- **UI:** `http://localhost:3001/` renders the intended company-only screen
  ("velcenter เป็นพื้นที่เฉพาะบริษัท…" + back link). No admin surface leaks.
- **API authorization:** `GET /api/admin/overview` with the seller session →
  `403 FORBIDDEN`. Server-side role enforcement holds; navigation is not the
  control.
- **Dashboard, orders, sellers, verifications, categories, banners, staff,
  audit:** **BLOCKED** — they need an Admin/Owner/Staff account.
- **Responsive 360/390/768/1024/1440:** **NOT VERIFIED** — the in-app WebView has
  no resize control and the Chrome DevTools MCP cannot start here
  (`Cannot download a binary for the provided platform: android (arm64)`).
- No production write was attempted; every call in this task was `GET`.

## E. Test results

| Item | Status |
|---|---|
| Proxy safe mode, gate, origin, hygiene, lifecycle | **AUTOMATED TEST PASSED** (30) |
| Full backend suite | **AUTOMATED TEST PASSED** — 1273 pass / 389 skip / 0 fail |
| Typecheck (4 apps) | exit 0 |
| Builds (`velcenter`, `velseller`, `velshop`, relative-API) | BUILD PASSED |
| VelCenter with Admin session | **BLOCKED** |
| VelCenter seller/unauth behaviour | BROWSER VERIFIED |
| Responsive | **NOT VERIFIED** |
| Impeccable execution | **BLOCKED** (engine is ET_EXEC arm64; bionic rejects it) |

## F. AI Office verification

- **AI 02 plan:** completed and used. It independently ranked the three top risks
  (unauthenticated cookie injection, Origin impersonation, unbounded methods) —
  all three were real and are fixed.
- **AI 01 implementation:** safe-mode rewrite, gate, allowlists, hygiene, tests.
- **AI 02 final review: PASS**, after three rounds. Its first verdict was **FAIL**
  and it was right twice: the method tests carried a duplicate `headers` key (so
  the gate was missing), the "access token never reaches the upstream" test never
  sent a token, the cookie-mode check did not demand exactly `0600`, and one test
  name claimed more than it asserted. All four were fixed (merged headers, a real
  `/?access=` redirect test, exact mode, honest names) and AI 02 then returned
  **PASS**.

## G. Remaining work

1. **VelCenter admin QA** needs an owner/admin/staff session in
   `.ai/secrets/browser-cookies.json` (sign in yourself; never paste the token).
2. **Responsive verification** needs a browser that can resize — unavailable on
   this device (both the in-app WebView and the DevTools MCP are blocked).
3. **Impeccable** needs an arm64 PIE engine build upstream; nothing in this repo
   can execute it.
4. **AI 02 final review** is done (PASS); re-run only if the proxy changes again.
5. Pre-existing product finding, unchanged here: two seller-application UIs
   (`RequireRole.tsx` 4-step vs `ShopOnboarding.tsx` 2-step) — one must go, by
   owner decision.
