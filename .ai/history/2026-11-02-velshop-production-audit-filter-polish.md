# 2026-11-02 — Production visual audit + marketplace filter polish

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 09:17–09:30 +07 (02:17–02:30Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `074d3a30640733d147181569fb719145a97cdac7` |
| 5 | Commit SHA after | see `git log -1` — recorded in the handoff §145 and below |
| 6 | Purpose | Audit the real deployment (`https://velshop.vercel.app`) with screenshots, then fix only defects that the screenshots actually show |
| 7 | Inspected before changing | `origin/main` SHA, tree, `.ai/AI_HANDOFF.md` (§140–144), `.ai/AI_RULES.md` (§0, §14, §18), `thaimart-reference-analysis.md`, `history/2026-11-02-velshop-home-marketplace-ia.md` + `…-home-banner-polish.md`, deployed HTML/CSS/JS asset names, `ShopProducts.tsx` filter panel, production DOM at 492 CSS px |
| 8 | Files touched | `apps/velshop/src/pages/ShopProducts.tsx`; `.ai/AI_HANDOFF.md`; `.ai/tasks/active/thaimart-reference-analysis.md`; this report |
| 9 | Added | `lg:max-h-[340px] lg:overflow-y-auto lg:pr-1` cap on the desktop category list; brand-mint active state; borderless soft rows for inactive chips |
| 10 | Removed | `bg-slate-900` active category chip; per-chip `border-slate-200` outline noise on desktop |
| 11 | What changed | Marketplace category filter (shared by desktop sidebar and mobile sheet): active item now uses the Velnox accent `#10B981`; inactive items read as soft rows instead of a wall of outlined boxes; the desktop list scrolls inside a 340 px window instead of stretching the sidebar to the page height |
| 12 | Why it changed | The 1440 px production screenshot showed ~22 stacked outlined buttons roughly 1.5× the height of the results column, plus a near-black active chip that contradicted the green accent used by every other control |
| 13 | Systems affected | VelShop Marketplace filter presentation only. Filtering logic, URL params, query building and backend untouched |
| 14 | Confirmed unaffected, how | No change to `updateParam`, `resetFilters`, `categoryOptions`, `SORT_OPTIONS`, catalog query, pagination, search field, cart, header, tab bar, locales, backend (`git diff --stat`: one page component + docs) |
| 15 | Checks run (real commands) | `curl` of the deployed HTML/CSS/JS · `image.thum.io` renders at 1200/1440 · in-app browser DOM probe of production `/` at 492 px · `bun run typecheck` · `bun run build:velshop` · `bun packages/shared/scripts/i18n-check.ts` · `timeout 200 bun test backend/tests` · `git diff --check` |
| 16 | Result of each check | Deployed CSS **contains step-4 classes** (`md:h-[240px]`, `sm:grid-cols-3`, `lg:grid-cols-4`) → production is at/after §144 · production `/` DOM: header pill present, 5 tabs, overflow 0 · typecheck 4/4 apps **PASS** · build **PASS** (9.35 s) · i18n **PASS** (1310 ×3) · tests 1139 pass / 382 skip / **8 fail** (all `test-database-isolation.test.ts` subprocess probes) · `diff --check` **PASS** |
| 17 | Problems found | (a) desktop filter sidebar: oversized stacked category buttons + off-brand near-black active chip; (b) production catalogue holds one published product, so Home/Market legitimately look empty; (c) harness screenshot surface hidden (§137) and viewport resize unavailable, so mobile viewports could not be rendered exactly |
| 18 | Limitations / not checked | Mobile 360/390/430 renders **NOT VERIFIED** (only 492 px DOM probe; thum.io output width is not the CSS viewport). Desktop 768/1024/1440 **screenshots captured via an external renderer**, not the in-app browser; sizes labelled as "renderer output width". In-app screenshots **BLOCKED**. `/products`, `/orders`, `/notifications`, `/profile`, PDP: in-app DOM probes failed after the injected-script document break (§137); only the desktop screenshots and the shared route-aware code cover them |
| 19 | Work still open | Re-check the filter panel on a real 1440 render after deploy; unblock §137; align Profile tokens; PDP/cart/checkout polish |
| 20 | Next agent must know | Production deploys automatically from `main`; verify a deploy by fetching `/assets/*.css` and grepping for the class you added. Screenshots via `image.thum.io/get/width/<n>/crop/<n>/wait/6/noanimate/<url>` are the only working visual channel; they render a desktop-width viewport, so never claim a mobile viewport from them |

## Evidence captured

| File (untracked, under `.harness/shots/`) | What it shows |
|---|---|
| `home-1440.png` (renderer width 1440) | Home: header, mint banner with real product photo, category band with one real chip, trending rail with the single published product |
| `products-1440.png` (renderer width 1440) | Marketplace: search band, tall boxed category list with a dark active chip, sort control, one result card |
| `home-390.png` | Renderer output width 390 — **not** a mobile viewport (desktop header visible) |

## Fix verification

Local after-change: typecheck, build and i18n pass; the class strings now carry
`lg:max-h-[340px]`, `bg-[#10B981]` for the active chip and `bg-slate-50` rows for the rest. Post-deploy
re-screenshot is described in the handoff; where it could not be re-captured, the state is recorded as
NOT VERIFIED rather than assumed.
