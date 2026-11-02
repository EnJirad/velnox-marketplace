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
