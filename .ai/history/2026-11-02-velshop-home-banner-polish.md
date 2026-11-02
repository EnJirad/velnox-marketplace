# 2026-11-02 — Home storefront polish: image banner + density (step 4)

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 09:09 +07 (02:09Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `b3b23154811ad6e830d9db5adec6ea0453e4dc94` |
| 5 | Commit SHA after | `04e5081a1a02b5968ffe45bcf7c0e02f7346bbe4` (pushed; `LOCAL == REMOTE`) |
| 6 | Purpose | Make Home read as a polished storefront: image-led real-data banner, tighter category/rail density, desktop column response — without touching the IA from §143 |
| 7 | Inspected before changing | `ShopHome.tsx` (banner, categories, rails, memory rails), `ShopHeader.tsx`, `ProductCard.tsx`, `packages/shared/src/lib/commerce.ts` (`StoreProduct.primaryImage`, `displayUrl`), `backend/routes/products.ts` (catalog query/sort), `.ai/AI_HANDOFF.md` §140–143, history `2026-11-02-velshop-home-marketplace-ia.md` |
| 8 | Files touched | `apps/velshop/src/pages/ShopHome.tsx`; `.ai/AI_HANDOFF.md`; `.ai/tasks/active/thaimart-reference-analysis.md`; this record |
| 9 | Added | `bannerProduct` memo (real image lookup); image column + gradient seam + CTA chip in the banner; `h-[150px] md:h-[240px]`; rail grids `sm:grid-cols-3 lg:grid-cols-4`; category padding `py-4 sm:py-5` |
| 10 | Removed | Icon-tile-only banner layout (replaced); `md:grid-cols-3 xl:grid-cols-4` on Home rails |
| 11 | What changed | Banner is now image-led from a real product photo (`primaryImage.displayUrl ?? url`, Cloudflare R2 CDN); desktop/tablet grid breakpoints moved to `sm`/`lg`; category section spacing tightened |
| 12 | Why it changed | Owner asked for a storefront that feels like the reference (density, banner prominence); previous banner had no imagery, and Home rails only reached 4 columns at `xl` |
| 13 | Systems affected | VelShop Home presentation only (one page component + docs) |
| 14 | Confirmed unaffected, how | Header/mobile bar, five-tab `MobileTabBar`, route-aware search, Marketplace filters/sort/pagination, cart drawer, `ProductCard` component, backend, DB, auth/RBAC, payment — none of their files were edited (`git diff --stat`: one app file + 3 docs); typecheck of all four apps passed |
| 15 | Checks run (real commands) | `bun run typecheck` · `bun run build:velshop` · `bun packages/shared/scripts/i18n-check.ts` · `timeout 200 bun test backend/tests` · `git diff --check` · live dev server `VITE_API_URL=http://127.0.0.1:5186 bun run dev:velshop -- --port 5188` with a temporary read-only proxy (`.harness/proxy.py`, untracked) |
| 16 | Result of each check | typecheck **PASS** (4/4 apps exit 0) · build **PASS** (8.26 s) · i18n **PASS** (th/en/my = 1310 each) · tests **1139 pass / 382 skip / 8 FAIL** (all 8 in `test-database-isolation.test.ts` "a real test process fails closed" — subprocess probes, sandbox limitation, no backend file touched) · `diff --check` **PASS** · DOM measurement **PASS** · screenshots **BLOCKED** |
| 17 | Problems found | Harness injected script still breaks documents intermittently (§137); preview surface hidden so no screenshots; iframes stall at `readyState: loading` and CDP resize is unavailable on android/arm64; production catalogue holds only **1** published product, so Home honestly renders one category chip and one card per rail |
| 18 | Limitations / not checked | **VISUAL VERIFICATION: NOT VERIFIED** — no pixel comparison with the reference screenshot. 768/1024/1440 **NOT MEASURED**; desktop evidenced only at rule level (`.md\:h-\[240px\]` in `@media(min-width:48rem)`, `.sm\:grid-cols-3` in `40rem`, `.lg\:grid-cols-4` in `64rem`) |
| 19 | Work still open | Profile token alignment; the long tail of screens (PDP/cart/checkout/orders/account/help); re-run §137 to unblock screenshots |
| 20 | Next agent must know | Banner data source = top published category + its live count + first product image in that category (no campaign system exists — never invent campaign/discount copy). Home fetch is one catalog call (`limit=100`) and renders at most 16 cards. Do not "fill" the empty state with mock data; the catalogue really is nearly empty |

## Measured (492 CSS px, real catalogue through the read-only proxy)

| Element | Measurement |
|---|---|
| header | 56 px, search pill present on `/` |
| banner | 460 × 150 px, y = 68 (below the header, no overlap) |
| banner image | 174 × 148, `object-fit: cover`, natural 1280 × 1810, `alt` = real product name |
| banner text | `หมวดหมู่ยอดนิยม · หูฟังและลำโพง · 1 สินค้า · เลือกดู` — locale keys + real count only |
| category chips | rendered from real categories (one exists in this catalogue) |
| horizontal overflow | 0 |

## Post-push addendum

Rulebook compliance pass after the push: this record was rebuilt into the §18 twenty-field format, and
`04e5081` is verified on the remote (`git fetch` → `LOCAL == REMOTE`, working tree clean).
