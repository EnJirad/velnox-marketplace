# 2026-11-02 — VelCenter mobile nav drawer: stop the first items hiding under the header

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 11:55 +07 (04:55Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `031457405f7df8062be978c0c9275c066e1491d2` |
| 5 | Commit SHA after | recorded in `.ai/AI_HANDOFF.md` §148 |
| 6 | Purpose | The mobile menu in VelCenter opened from the very top of the viewport, so its first entries sat under the page header / status area and could not be tapped |
| 7 | Investigated | `center` page shell in `apps/velcenter/src/pages/Center.tsx` (header `h-16 sticky z-40`, `navOpen` drawer, scrim), the mobile screenshot the owner supplied |
| 8 | Files touched | `apps/velcenter/src/pages/Center.tsx`; this report; `AI_HANDOFF.md` |
| 9 | Added | drawer `top-16` offset + `bottom-0`, `env(safe-area-inset-bottom)` bottom padding, shadow, an in-drawer header row with the section title and an explicit close (X) button |
| 10 | Removed | `inset-y-0` (drawer starting at viewport top) and the bare `p-3` padding that gave no room below the header |
| 11 | What changed | Drawer now starts 64 px down — exactly below the sticky header — ends at the bottom edge with safe-area padding, scrolls internally, and can be closed from inside as well as via the scrim |
| 12 | Why | The first nav rows were physically unreachable; the scrim was also stacking at the same z-index as the header |
| 13 | Systems affected | VelCenter mobile navigation presentation only |
| 14 | Confirmed unaffected | Desktop sidebar keeps `md:static md:overflow-visible md:px-0 md:pt-0 md:shadow-none`; tabs, routes, permissions and data loading untouched (`git diff --stat`: one page file + docs) |
| 15 | Checks run | `bun --filter @velnox/velcenter typecheck` · `bun run build:velcenter` · `git diff --check` · built-CSS class check |
| 16 | Results | typecheck **PASS** · build **PASS** (8.89 s) · `diff --check` **PASS** · built CSS contains `.top-16`, `.z-50`, `.z-30`, `.pb-[calc(1rem+env(safe-area-inset-bottom))]` |
| 17 | Problems found | Scrim and header both used `z-40`, so the scrim could cover the menu button; drawer z-index stays `z-50`, scrim moved to `z-30` so the header stays interactive |
| 18 | Limitations | **Runtime visual check NOT VERIFIED** — VelCenter requires an authorized session and the harness cannot render authenticated pages; no screenshot of the fixed drawer. Layout is confirmed by code + built CSS only |
| 19 | Still open | Re-check on a real phone after deploy (drawer under the header, all tabs reachable, safe area respected) |
| 20 | Next agent must know | Header height is `h-16`; any future fixed overlay in VelCenter must offset by `top-16` and include `env(safe-area-inset-bottom)` padding, and must not share `z-40` with the header |

## Follow-up with a real authenticated session (same day, §150)

The owner supplied session cookies, so the drawer was finally measured on the real authenticated page
(`http://localhost:5191`, 492 px viewport, production API through the cookie-injecting proxy).

**The offset alone was not the whole bug.** Measurement showed the drawer itself correctly starting at
`top: 64` (header bottom 65) — but `#center-nav` was only **36 px tall** and the first tab sat at
`top: -35`, i.e. above the viewport. Root cause: the nav list is the shared Radix `TabsList`, whose
default class carries `h-9`. Our `flex w-full flex-col` never removed that height, so eleven stacked
tabs overflowed a 36 px box in both directions.

Fix: `h-auto` added to the TabsList class (tailwind-merge drops `h-9`).

After the fix, measured on the same page:

| Element | Before | After |
|---|---|---|
| drawer | top 64 → bottom 815 | top 64 → bottom 815 |
| `#center-nav` height | 36 px | **458 px** |
| first tab (`ภาพรวม`) | `top: -35` (off-screen) | `top: 119` (visible) |
| last tab (`ตั้งค่าระบบ`) | 274 | 531 (inside the viewport) |
| tabs / close button | 11 / absent | 11 / present |
| drawer padding | p-3 | `pt 12 px`, `pb 33 px` (safe area) |

Also verified in the same session: the Settings tab renders the **“แบนเนอร์ประกาศหน้าแรก”** card with
add/save controls; `GET /api/announcements` → `[]`, `GET/PUT /api/admin/announcements` → 200, and a
temporary item round-tripped into the VelShop carousel (1 slide, 138 px, no overflow) before being
deleted again. `POST /api/upload/presign` with `purpose: "announcement"` returned a signed
`announcements/{userId}/{uuid}.webp` URL.
