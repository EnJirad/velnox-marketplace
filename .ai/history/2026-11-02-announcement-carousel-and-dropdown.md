# 2026-11-02 — Announcement carousel + dropdown positioning fix

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 09:40–10:25 +07 (02:40–03:25Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `5f9bacdba9dec35981fb8841a9c06ab230e341bc` |
| 5 | Commit SHA after | see `git log -1` for this commit (handoff §146 repeats it) |
| 6 | Purpose | Replace the product-illustrated Home banner with a real announcement carousel, and fix the shared dropdown/select positioning so long menus cannot escape the viewport |
| 7 | Inspected before changing | `.ai/AI_HANDOFF.md`, `.ai/AI_RULES.md`, `db/schema.sql` (no announcement/campaign table), `backend/routes/*` (`platform_settings`, `store_announcement` is per-shop only), `ShopHome.tsx`, `ui/select.tsx`, `ui/dropdown-menu.tsx`, every VelCenter call site of `SelectContent`/`DropdownMenuContent` |
| 8 | Files touched | `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` (new), `apps/velshop/src/pages/ShopHome.tsx`, `packages/shared/src/components/ui/select.tsx`, `packages/shared/src/components/ui/dropdown-menu.tsx`, `packages/shared/src/lib/i18n/locales/{th,en,my}.ts`, `.ai/AI_HANDOFF.md`, this report |
| 9 | Added | `AnnouncementCarousel` (autoplay, swipe, dots, arrows, keyboard, reduced motion); `announce.*` locale namespace (12 keys ×3); popper positioning defaults + height cap in the shared primitives |
| 10 | Removed | The category/product-image banner and its `bannerProduct` memo on Home |
| 11 | What changed | Home now renders an announcement carousel (fixed 136/168 px, no layout jump). Select and dropdown content default to `position="popper"`, `align="start"`, `sideOffset=4`, `collisionPadding=8`, and `max-h-[min(320px,available)]` / `min(360px,available)` with internal scrolling |
| 12 | Why it changed | The banner was a product showcase, not platform communication; and Select defaulted to Radix `item-aligned` + `align="center"`, which anchors the menu to the selected row and can push a long menu out of the viewport |
| 13 | Systems affected | VelShop Home presentation; shared UI primitives used by all four apps (visual positioning only) |
| 14 | Confirmed unaffected, how | No API, schema, auth, payment, cart, order or filter logic touched (`git diff --stat`); search route behaviour, five-tab nav, Marketplace query contract untouched; typecheck passed for all four apps |
| 15 | Checks run (real commands) | `bun run typecheck` · `bun run build:velshop` · `bun run build:velcenter` · `bun packages/shared/scripts/i18n-check.ts` · `timeout 200 bun test backend/tests` · `git diff --check` · in-app DOM probes on `http://127.0.0.1:5189/` at 492 px |
| 16 | Result of each check | typecheck **PASS** (4/4) · builds **PASS** (8.28 s / 6.11 s) · i18n **PASS** (1322 ×3) · `diff --check` **PASS** · tests 1139 pass / 382 skip / **8 FAIL** (`test-database-isolation.test.ts` subprocess probes, unchanged from previous sessions) · carousel DOM **PASS** |
| 17 | Problems found | (a) no announcement/content table exists — `store_announcement` is a per-shop field, so platform announcements have no real source; (b) `SelectContent` defaulted to `item-aligned` + centre alignment; (c) harness documents intermittently die (§137), so VelCenter and Marketplace could not be rendered for the dropdown check |
| 18 | Limitations / not checked | **VelCenter dropdown runtime: BLOCKED** (VelCenter requires an authorized account; `/products` and `/` refused to render under the injected-script break). **360/390/430/1440 carousel renders: NOT VERIFIED** (no viewport control; `image.thum.io` needs a public URL and the change is not deployed). Swipe verified only with synthetic pointer events |
| 19 | Work still open | Add a real announcement source (a `platform_settings`-backed or dedicated announcements API) once the owner approves a content contract; unblock §137; re-check VelCenter dropdown with a test account |
| 20 | Next agent must know | The carousel consumes `Announcement[]` and renders nothing when the list is empty — it must never be given invented campaigns. Its current items are derived from real storefront data (welcome, live listing count, live verified count). The dropdown fix lives in the shared primitives, so it applies to VelShop, VelSeller and VelCenter at once |

## Carousel verification detail (492 CSS px, Vite dev + real catalogue via read-only proxy)

| Observation | Value |
|---|---|
| container | 460 × 138 px, `role="region"`, `aria-roledescription="carousel"` |
| slides | 3 — welcome, "สินค้าในตลาดวันนี้ · มีสินค้าพร้อมจำหน่าย 1 รายการ", "สินค้าที่ผ่านการยืนยัน · 1 รายการ" |
| indicator | 3 dot buttons with `aria-label="ไปที่ประกาศที่ N"`, active uses `#10B981` |
| autoplay | observed index advancing (5 s timeout, re-armed per slide) |
| manual | dot click → index 0; synthetic swipe −130 px → index 1, live text "ประกาศที่ 2 จาก 3", transform applied |
| overflow | `scrollWidth - clientWidth = 0` |

## Dropdown root cause and fix

Radix `Select` ships two positioning modes. `item-aligned` (the shadcn default this repo used) anchors the
menu over the selected row and relies on the "selected item" for placement; a long list opened from a
control near the top can therefore extend above the viewport/header. Switch to `popper` (portal + collision
aware, flips to the top when space below is short), align to the trigger start, keep 8 px collision padding,
and cap height so the list scrolls internally instead of stretching the page.
