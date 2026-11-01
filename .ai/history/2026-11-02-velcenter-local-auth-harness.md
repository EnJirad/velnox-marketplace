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

---

## 12. Continuation attempt — remaining menus (2026-11-02, after `ad26d7f`)

**Result: NOT COMPLETED (harness degraded mid-run).**

- `bg_list` confirms the two harness jobs are still alive: `[8] proxy on :8899` and `[9] vite preview on
  :5173` (both ~14 min old, started by this chat).
- Re-navigating to `http://localhost:5173/` returned a document with **no `<body>`** (`document.body` was
  `null`, `document.querySelectorAll("button").length` unreachable) — the preview answered before the SPA
  rendered, and the next read hit the same half-loaded document. Repeating the navigation would have been a
  retry of an unchanged failing step, so it was stopped rather than looped.
- Consequence: **UserMenu, employee dropdowns, order-ship dialog, chat actions, shared `Select`/`Popover`,
  menus inside dialogs and the mobile drawer, edge-of-viewport cases, console logs, and all viewports except
  492 px remain NOT TESTED.**

No new measurement, no root cause, and **no code change** resulted from this continuation. The only measured
menu remains the LanguageSwitcher (trigger `380,14` → panel `256,54 160×123`, `absolute`, `z-50`, no overflow),
which is **correct**.

### What the next session should do first

1. Confirm `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/` returns 200 before navigating; if
   not, restart job `[9]` (`cd apps/velcenter && bunx vite preview --port 5173 --host 127.0.0.1`).
2. Open each menu with `browser_click` (real pointer events, not `.click()`): header user menu, employee role
   menu, order-ship select, chat actions.
3. For each: `[menu.getBoundingClientRect(), getComputedStyle(menu).position, getComputedStyle(menu).zIndex]`
   plus the trigger rect; flag any `x==0 && y==0`.
4. Only then decide between migrating `LanguageSwitcher` (still unproven) or fixing a Radix menu.

---

## 13. Root cause found from the owner's screenshot (2026-11-02)

The screenshot (`18:32`, VelCenter mobile) shows the real defect, and it is **not a dropdown**:

> the navigation strip ("ภาพรวม แชท …") renders as a **white bar overlapping the header at the top-left**, and
> page content is pushed/scrolled underneath it.

That is the mobile drawer markup from §118: the `<TabsList>` carries `max-md:fixed … -translate-x-full`, but on
the device it is **in normal flow at the top of the page**, i.e. the `max-md:*` + arbitrary-value classes
(`max-md:pt-[max(0.75rem,env(safe-area-inset-top))]`, …) are not being generated, so no drawer behaviour is
applied at all. The menu items then sit at the page's top-left — exactly what the owner described as "menus
piled at the top-left". The LanguageSwitcher measurement (§11) already showed the switcher itself is fine.

### Attempted fix (unverified, reverted)

Wrapped the `<TabsList>` in a plain wrapper `<div>` whose classes are ordinary (`fixed inset-y-0 left-0 z-50
w-72 …` / `hidden md:block`) so the drawer no longer depends on `max-md:` arbitrary variants, and simplified the
list to `flex flex-col`.

- `tsc` passed.
- `vite build` passed.
- **Runtime check failed:** after rebuilding and reloading the local preview the document was blank
  (`document.body.innerText === ""`, `#center-nav` absent), so the change could not be verified as safe.
- Per the rule "never ship unverified UI", the file was **reverted** (`git checkout -- …/Center.tsx`), tree
  clean, `tsc` re-run → pass.

### What to do next (concrete)

1. Apply the same wrapper idea **plus** keep the list mounted only when `navOpen` on mobile; verify with
   `browser_eval` that `#center-nav` exists and its wrapper computes `display: none` when closed, `position:
   fixed` when open.
2. If the blank page persists, capture the console error first (`browser_get_logs`) — the Radix `TabsList` may
   not tolerate being wrapped, in which case move the wrapper **outside** `<Tabs>` and render the nav buttons
   from the existing tab metadata without duplicating definitions.
3. Only then rebuild, measure, and commit.

No code change remains in the repository from this attempt.
