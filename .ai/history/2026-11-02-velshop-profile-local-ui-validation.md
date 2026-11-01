# VelShop /profile local UI validation — server OK, render BLOCKED by harness script (2026-11-02)

Target: `apps/velshop/src/pages/ShopProfile.tsx` (route `/profile`). **Read-only**; no source changed.

## What was executed

| Step | Command / tool | Result |
|---|---|---|
| Build for local | `VITE_API_URL=http://127.0.0.1:9 bun --filter '@velnox/velshop' build` | exit 0 (API deliberately unreachable → no production traffic) |
| Server | `shell_background`: `bunx vite preview --port 5174 --host 127.0.0.1 --strictPort` | **job 15**, log `.harness/bg/15-mvxsbsfp.log` |
| Readiness | `curl 127.0.0.1:5174/` and `/profile` | **200 / 200** |
| Navigate | `browser_navigate("http://127.0.0.1:5174/profile")` | URL correct, **title empty**, no interactive elements, 22 s "still loading" warning |
| Render probe | `browser_eval` | `{path:"/profile", title:"", vw:980, sw:null, textLen:0, buttons:0, links:0}` — `document.documentElement` was null |
| Console | `browser_get_logs(level=ERROR)` | app errors **none**; harness-injected script errors: `Cannot read properties of null (reading 'appendChild')` and repeated `window.__harnessUpdateScroll is not a function` on `127.0.0.1:5174/profile` |
| Screenshot | not attempted (preview hidden and body absent) | **NOT CAPTURED** |
| Cleanup | `bg_kill(15)` then curl | **000** |

## Findings

1. **Local server + loopback work**: both `/` and `/profile` answered 200 from the shell, and the WebView did
   request the URL (its error log is tagged with `http://127.0.0.1:5174/profile`).
2. **The page never rendered**: `document.body` was `null`, `innerText.length = 0`, zero buttons/links, empty
   title. This is **not** proof of a VelShop defect — the only errors on that page come from the Harness's own
   injected instrumentation (`__harnessUpdateScroll`, `appendChild` on a null body).
3. Therefore: **source-code inspection** done; **server verification** pass; **navigation** pass; **render**,
   **DOM**, **interaction**, **screenshot**, **responsive** and **network** verification are **NOT VERIFIED**.

## Auth note (Phase 1)

`/profile` renders a signed-out state without credentials and needs no production session for layout checks;
the signed-in rows (addresses, order tiles) require a test account. No production cookie was used.

## Environment limitations recorded

- Viewport reported 980 px on this load (not the usual 492) — the WebView size is not stable; do not infer
  responsiveness from it.
- No network monitoring in the toolset.
- Screenshot requires the visible preview.

## Follow-up

Re-run the same steps when the injected instrumentation does not fail on the page (check `browser_get_logs`
first). If it still fails, this is a Harness bug to report, not a VelShop change.
