# Local UI Testing Harness — architecture assessment (2026-11-02)

**Verdict: BLOCKED for app-level implementation.** The Android Harness application is **not in this workspace**
(`find … -name 'build.gradle*'` returns nothing under the app files; the workspace root is the
`velnox-marketplace` repo only). I cannot add a WebView activity, a tool registry or a Gradle dependency to the
host app from here — and doing so would be modifying the running host, not this repository.

What the task asks for **already exists** in the host app as built-in tools. The table below is the honest
mapping, verified by this session's own usage.

## 1. Existing capability map

| Required operation | Existing tool | Evidence from this session |
|---|---|---|
| `ui_browser_open` / `navigate` | `browser_navigate` | loaded `https://velcenter.vercel.app`, `http://localhost:5173/`, `https://example.com` |
| `ui_browser_reload` | `browser_refresh` | used on local preview |
| `ui_browser_snapshot` (DOM) | `browser_get_dom` | enumerated drawers, tabs, buttons with ids |
| `ui_browser_click` | `browser_click` (id or CSS selector) | clicked `button[aria-haspopup="listbox"]`, menu trigger |
| `ui_browser_type` | `browser_type` (id or CSS selector, `clear_first`) | failed on Stripe (CSP/React), worked elsewhere |
| `ui_browser_scroll` | `browser_scroll` | available |
| `ui_browser_screenshot` | `browser_screenshot` (JPEG under `.harness/screenshots/`) | requires the **visible** preview; fails when hidden |
| `ui_browser_console` | `browser_get_logs` (level/source filter, clear) | captured CSP/`EvalError` evidence |
| `ui_browser_eval` | `browser_eval` | used heavily for `getBoundingClientRect` measurements |
| `ui_browser_url` | `browser_get_url` | available |
| `ui_browser_close` | *(no explicit close; navigation replaces the page)* | gap |
| `ui_browser_set_viewport` | *(no viewport API)* | **gap** — WebView is fixed at 492 CSS px |
| `ui_browser_network` | *(no request log)* | **gap** — only console logs |

## 2. Local server capabilities (already available)

`shell_background` + `bg_list` + `bg_kill` cover the required lifecycle: start (returns id + log path), inspect,
read logs (`bg_list` shows recent output), stop (`bg_kill`). Verified in this session: proxy on `:8899` and
`vite preview` on `:5173` ran, served the app, and were killed/restarted.

**Loopback connectivity is proven**: the WebView reached `http://localhost:5173/?tab=categories` and
`http://127.0.0.1:5173/` (same host, different cookie scope). Note `localhost` vs `127.0.0.1` are *different
cookie hosts* — the session cookie must be set on the exact host used.

Current state at the time of this report: `5173` and `8899` are **down** (`000`) — host background jobs died with
an app restart. Restart commands are recorded in §13 of `2026-11-02-velcenter-local-auth-harness.md`.

## 3. Security posture (as it actually behaves)

| Requirement | Status |
|---|---|
| Restrict to localhost/127.0.0.1 | **not enforced by the tools** — `browser_navigate` will open any URL (this session opened Stripe and example.com) |
| Reject production domains by default | ❌ none |
| Cleartext HTTP only in debug | ◐ `http://localhost` worked; no build-type switch visible from here |
| WebView remote debugging | ◐ Chrome DevTools MCP cannot start on android/arm64 |
| No JS bridge to native APIs | ✅ `browser_eval` runs page JS only; no native bridge exposed |
| No production credentials reused | ◐ nothing automatic, but a cookie set manually for `localhost` worked against the real API |

## 4. Workflow that works today (no new code)

1. `shell_background` → `bunx vite preview --port 5173 --host 127.0.0.1` (or any static server).
2. Poll `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` until `200`.
3. `browser_navigate("http://localhost:5173/")`.
4. `browser_eval` → `document.body.innerText.length` to confirm render (the SPA can answer before hydration).
5. `browser_get_dom` for elements; `browser_eval` for `getBoundingClientRect()` measurements.
6. `browser_screenshot` (open the visible preview first).
7. `browser_get_logs(level="ERROR")`.
8. `bg_kill` the server.

## 5. Gaps to close inside the host app (requires the app's source tree)

1. `set_viewport` (375/390/430/768/1024/1440) — today everything is measured at 492 px.
2. Network request log (status, timing, failed requests).
3. Explicit `ui_browser_close` and a per-session isolation boundary.
4. Origin allow-list enforced by the tool (localhost/127.0.0.1 only) — currently any URL is reachable.
5. Full-page screenshot (beyond the viewport).

## 6. What was NOT done and why

No Android source was modified (not present), no dependency added, no tool registered. The fixture page and
automated loop the task describes can only be built on top of the gaps in §5 once the host app source is available.

## 7. Recommended next step

Point a workspace at the Harness application's own repository (Gradle project). Then implement, in this order:
viewport control → origin allow-list → network log → close/isolation. Everything else is already shipped.
