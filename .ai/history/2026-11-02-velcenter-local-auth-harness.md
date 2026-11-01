# VelCenter: local authenticated harness proves the switcher is positioned correctly (2026-11-02)

**SHA:** `a8a8266` → this docs commit. **No application code changed.**

## How the login wall was solved (legitimately, no auth bypass)

The deployed app authenticates against `velnox-api.onrender.com` (different origin), so a browser could not
carry the session cookie. Built VelCenter locally with the API pointed at a same-site proxy instead:

1. `VITE_API_URL=http://localhost:8899 bun --filter '@velnox/velcenter' build`
2. Scratch proxy (`/files/.harness-scratch/proxy.ts`, **outside the repo**) → forwards to the real API, adds
   CORS for the local origin and passes the `Cookie` header through untouched.
3. `bunx vite preview --port 5173` serving `apps/velcenter/dist`.
4. In the browser: set the owner's real `velnox_session` cookie **on `localhost`** (same site as the proxy) →
   reload → **authenticated**: `/`, "ศูนย์ควบคุม Velnox", owner role, KPI cards rendered.

No mock API, no fake data, no auth change — the same production API answered.

## Measurements (real browser, viewport 492 CSS px → mobile layout active)

`#center-nav` computed `position: fixed` (drawer mode), `transform: none`.

**LanguageSwitcher** (open, three options rendered):

| Element | Rect (x, y, w, h) | computed |
|---|---|---|
| trigger | `380, 14, 36, 36` | — |
| panel `ul[role=listbox]` | `256, 54, 160, 123` | `position: absolute`, `z-index: 50` |

- panel is anchored to the trigger (below-left), **not** at `(0,0)`;
- right edge 416 < 492 → no horizontal overflow, no clipping;
- options rendered and selectable in the DOM.

## Findings

| Item | Result |
|---|---|
| LanguageSwitcher positioning at mobile width | **PASS** (measured) |
| LanguageSwitcher opens with a click | **PASS** |
| Drawer mode active below `md` (`position: fixed`) | **PASS** (computed style) |
| UserMenu (Radix) open | **NOT TESTED** — the click did not open it while the switcher panel was still open |
| Employee / order-ship / chat menus, form `Select`, menus inside dialogs | **NOT TESTED** |
| Viewports 360 / 390 / 430 / 768+ | **NOT TESTED** — the in-app WebView is fixed at 492 px; Chrome DevTools MCP cannot start on android/arm64 |
| Console errors | **NOT TESTED** |

The reported "menus clustered at the top-left" was **not reproduced** for the one menu that could be measured;
the other menus were not reached within this session, so no root cause and **no code change** is claimed.

## Harness left running (local only)

Background jobs `8` (proxy :8899) and `9` (preview :5173) from this session. Stop them when done; both are
scratch processes and were never committed.

## Next step

Reuse this harness to measure the remaining menus: open each at 492 px, read
`getBoundingClientRect()` of `[role="menu"]`/`[role="listbox"]` next to the trigger, and only then fix.
