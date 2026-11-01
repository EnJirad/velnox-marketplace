# Local UI Testing Workflow (Velnox Marketplace)

Evidence-based procedure using the Android Harness tools that already exist. No Playwright, no new browser, no
production URLs, no external Chrome.

## 1. Tools (only these; do not invent others)

`shell_background` · `bg_list` · `bg_kill` · `browser_navigate` · `browser_refresh` · `browser_get_dom` ·
`browser_click` · `browser_type` · `browser_scroll` · `browser_screenshot` · `browser_eval` · `browser_get_url` ·
`browser_get_logs`

## 2. Start a server — **must** use `shell_background`

```
shell_background: cd apps/velshop && bunx vite preview --port 5173 --host 127.0.0.1
```
- Preview needs a build first: `VITE_API_URL=… bun --filter '@velnox/velshop' build`, or use `bun run dev`.
- **Never** start it with `nohup … &` inside `shell`: the child is reaped when that call returns. Verified
  2026-11-02 — `curl` answered 200 inside the same call, then `ERR_CONNECTION_REFUSED` in the browser and
  `after=000` afterwards. `shell_background` survives (job id + log path must be recorded).

## 3. Readiness check (before opening the browser)

```
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/   → must be 200
```
Poll a few times; a 200 from the shell proves the server, not the WebView (see §8).

## 4. Navigate + confirm render

1. `browser_navigate("http://127.0.0.1:5173/")`
2. `browser_eval` → `{ title, vw: innerWidth, text: document.body.innerText.length }`
   A SPA can serve HTML before hydration, so *rendered* means `innerText.length > 0` **and** an expected element
   exists.

## 5. Inspect

- Structure: `browser_get_dom` (ids, roles, labels).
- Geometry: `browser_eval` → `el.getBoundingClientRect()` and `document.documentElement.scrollWidth` vs
  `innerWidth` (overflow check).
- Console: `browser_get_logs(level="ERROR")` — filter by `source` when several pages were visited.
- Network: **not available**. Only console is exposed; never claim request-level evidence.

## 6. Screenshot

`browser_screenshot` writes a JPEG under `.harness/screenshots/` **only while the browser preview is visible**.
Verified 2026-11-02: with the preview hidden it returns `Browser preview is hidden or detached` and no image is
captured — record that as NOT CAPTURED, never as a pass.

## 7. Interact

`browser_click` (element id or CSS selector) · `browser_type` (selector + `clear_first`) · `browser_scroll`.
Re-run the geometry eval afterwards and, when the preview is visible, a second screenshot.

## 8. Stop and clean up

`bg_kill(<job id>)`, then `curl` again → expect non-200. Record the job id, the port and the final curl result.

## 8. Security

1. Only `localhost` / `127.0.0.1`. The tool has **no origin allow-list** — compliance is the agent's job.
2. Never navigate to production domains during UI verification (the tools would allow it; this rule forbids it).
3. Do not reuse production cookies/tokens. If a page needs a real session, stop and report the limitation.
   A manually set cookie on `localhost` is acceptable only for an isolated test account.
4. No real payments or production mutations.
5. `localhost` and `127.0.0.1` are **different cookie hosts** — pick one and stay on it.

## 9. Known limitations (verified)

| Limitation | Evidence |
|---|---|
| Viewport fixed at **492 CSS px**; no viewport control | `innerWidth === 492` every run |
| No network request log | only `browser_get_logs` exists |
| No explicit `browser_close` | navigation only |
| Screenshot needs the visible preview | hidden → "Browser preview is hidden or detached" |
| `nohup` servers die with the shell call | `after=000` |
| WebView and shell may disagree | a shell-200 server was refused once until started via `shell_background` |

Therefore: **never claim mobile/tablet/desktop responsiveness from this harness**, and never claim network
verification.

## 10. Required evidence for a UI task

1. Server command + port + readiness `200`.
2. Navigation URL (exactly as opened).
3. `browser_eval` render proof (`title`, `innerText.length`, `innerWidth`, `scrollWidth`).
4. DOM facts used in the claim (selector → what was found).
5. Screenshot path (or an explicit NOT CAPTURED).
6. Console output (or "no errors observed"; say which filter was used).
7. Cleanup: `bg_kill` id + post-kill curl.
8. Separate statements for: source-code inspection · DOM inspection · screenshot inspection · interaction ·
   responsive · network. Never merge them into one "verified".

## 11. Skills

- **Impeccable**: use `references/critique.md` + `references/audit.md` for judgement; it may cite only the evidence
  collected above. Its CLI is unavailable, so every run is `⚠️ DEGRADED`.
- **Superpowers**: `writing-plans` before multi-step work, `verification-before-completion` before any "done" claim,
  `systematic-debugging` when a UI check fails.

## 12. Validation performed when this file was written (2026-11-02)

| Step | Result |
|---|---|
| `shell_background` python http.server on `127.0.0.1:4180` (fixture in `.harness-scratch/ui-probe/`) | job 14 started |
| Readiness | `200` |
| `browser_navigate` | loaded, title **VelNox UI Probe**, 1 button + 1 input enumerated |
| `browser_eval` | `{title:"VelNox UI Probe", vw:492, scrollWidth:492, buttons:1}` |
| `browser_screenshot` | **NOT CAPTURED** — preview hidden |
| Console | not inspected in this run (fixture emits no error) |
| Cleanup | `bg_kill(14)` + post-kill curl → non-200 |

The fixture is scratch-only (outside the repo) and is not part of the suite.
