# Task Execution Report — Marketing Banners Sync, Chat Runtime Fix & Mobile Tab Bar Viewport Pinning

**Execution Timestamp:** 2026-11-25
**Task:** Fix VelCenter banner sync, Shop chat crash, and mobile bottom tab bar pinning
**Status:** COMPLETED & VERIFIED
**Initiative:** Velnox Clean Rebuild Initiative

---

## 1. Summary of Work Completed

### Issue 1: VelCenter Banners Sync to VelShop
- **Root Cause:**
  - VelCenter `MarketingBanners.tsx` sends `{ items: payload }` to `PUT /api/admin/announcements`.
  - In `workers/api/src/routes/admin.ts`, the handler stringified the raw payload object into `platform_settings` table (`shop_announcements`).
  - When `workers/api/src/routes/catalog.ts` and `admin.ts` read back `rows[0].value`, it checked `Array.isArray(items)`. Because `items` was an object `{ items: [...] }`, `Array.isArray` returned `false`, discarding uploaded banners and falling back to default hardcoded banners in VelShop and empty array in VelCenter.
  - Furthermore, `apps/velshop/src/pages/ShopHome.tsx` was only reading `home_hero` banners and never mounted `HomePromoStrip` for `home_strip` promotional banners.
- **Fix:**
  - Normalized `PUT /api/admin/announcements` and `GET /api/admin/announcements` in `workers/api/src/routes/admin.ts` to unwrap both `items` array and envelope format `{ items: [...] }`.
  - Updated `GET /api/catalog/announcements` in `workers/api/src/routes/catalog.ts` to extract `Array.isArray(raw) ? raw : raw?.items ?? []` safely.
  - Updated `apps/velshop/src/pages/ShopHome.tsx` to safely extract banners from both array and envelope shapes, derived `stripBanners` (`placement === 'home_strip'`), and mounted `<HomePromoStrip banners={stripBanners} />` right below `CategoryStrip`.

### Issue 2: VelShop Chat Runtime Crash (`p.filter is not a function`)
- **Root Cause:**
  - `workers/api/src/routes/chat.ts` returned `c.json({ success: true, data: { items } })` for `GET /customer/conversations` and `GET /seller/conversations`.
  - The API client returns `json.data`. In `ShopChat.tsx`, `res` was set directly into `conversations` state as `{ items: [...] }` (an object, not an array).
  - Later in the render pipeline, `conversations?.filter(...)` or `(conversations ?? []).filter(...)` failed with `TypeError: p.filter is not a function`.
- **Fix:**
  - In `workers/api/src/routes/chat.ts`, returned `c.json({ success: true, data: items, items })` so `data` is an array of conversations directly while preserving `items` envelope alias.
  - In `apps/velshop/src/pages/ShopChat.tsx` and `apps/velseller/src/pages/SellerChat.tsx`, added defensive normalization:
    `const items = Array.isArray(res) ? res : Array.isArray((res as any)?.items) ? (res as any).items : [];`
    and guarded all `.filter()` invocations (`safeConvs.filter(...)`, `visibleConversations`).
  - Updated `workers/api/tests/chat.test.ts` to assert compatibility with both array and envelope shapes.

### Issue 3: Mobile Bottom Tab Bar Pushed Down on Scroll
- **Root Cause:**
  - In `packages/shared/src/index.css`, `body` and `#root` had `overflow-x: hidden;`. According to CSS Overflow Level 3 specifications, specifying `overflow-x: hidden` with `overflow-y: visible` causes `overflow-y` to compute to `auto`, creating an implicit nested scroll container on `#root` that traps `position: fixed` elements and breaks viewport-anchored bottom navigation.
  - In `packages/shared/src/components/MobileTabBar.tsx`, `pb-[calc(0.75rem+env(safe-area-inset-bottom))]` lacked fallback `,0px` for browsers without CSS env support, and lacked hardware acceleration compositing (`transform: translateZ(0)`), causing jitter/misalignment during mobile momentum scrolling.
  - In `apps/velshop/src/main.tsx`, `<ShopTabBar />` was nested inside `<div className="site-app">` rather than anchored cleanly at the viewport root.
- **Fix:**
  - Switched `overflow-x: hidden` to modern `overflow-x: clip` in `packages/shared/src/index.css` and removed `overflow-x` from `#root` to prevent accidental scroll container creation.
  - Added `transform: translateZ(0)` and `WebkitTransform: translateZ(0)` to `packages/shared/src/components/MobileTabBar.tsx` for GPU hardware compositing and added `,0px` fallback to `env(safe-area-inset-bottom)`.
  - Moved `<ShopTabBar />` in `apps/velshop/src/main.tsx` outside of `.site-app` so it is permanently anchored to the viewport.

---

## 2. Verification Summary
- `bun run typecheck:all`: PASS (0 errors across `@velnox/velshop`, `@velnox/velseller`, `@velnox/velcenter`, `@velnox/velnox`, `@velnox/validation`, `@velnox/api-contract`, `@velnox/api-client`, `@velnox/ledger`, `@velnox/api`).
- `bun --filter @velnox/api test`: 126/126 PASS (17 test files, 585 assertions, 0 failures).
- `bun run build:apps`: PASS (All 4 SPAs compiled cleanly to `dist/`).
- `bun --filter @velnox/api build`: PASS (Wrangler edge bundle 1135.21 KiB).
- `git diff --check`: PASS (0 whitespace / syntax issues).
