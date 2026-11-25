# 2026-11-25 — Marketing Banners Sync, Chat Runtime Fix & Mobile Tab Bar Viewport Pinning

**Execution Timestamp:** 2026-11-25
**Task:** Fix VelCenter banner sync, Shop chat crash, and mobile bottom tab bar pinning
**Status:** COMPLETED & VERIFIED

---

## 1. Summary of Work Completed
- **VelCenter Banners Sync to VelShop:**
  - Normalized `PUT /api/admin/announcements` and `GET /api/admin/announcements` in `workers/api/src/routes/admin.ts` to unwrap both `items` array and envelope format `{ items: [...] }`.
  - Updated `GET /api/catalog/announcements` in `workers/api/src/routes/catalog.ts` to extract `Array.isArray(raw) ? raw : raw?.items ?? []` safely.
  - Updated `apps/velshop/src/pages/ShopHome.tsx` to safely extract banners from both array and envelope shapes, derived `stripBanners` (`placement === 'home_strip'`), and mounted `<HomePromoStrip banners={stripBanners} />` right below `CategoryStrip`.
- **VelShop Chat Runtime Crash (`p.filter is not a function`):**
  - In `workers/api/src/routes/chat.ts`, returned `c.json({ success: true, data: items, items })` so `data` is an array of conversations directly while preserving `items` envelope alias.
  - In `apps/velshop/src/pages/ShopChat.tsx` and `apps/velseller/src/pages/SellerChat.tsx`, added defensive normalization:
    `const items = Array.isArray(res) ? res : Array.isArray((res as any)?.items) ? (res as any).items : [];`
    and guarded all `.filter()` invocations (`safeConvs.filter(...)`, `visibleConversations`).
  - Updated `workers/api/tests/chat.test.ts` to assert compatibility with both array and envelope shapes.
- **Mobile Bottom Tab Bar Pushed Down on Scroll:**
  - Switched `overflow-x: hidden` to modern `overflow-x: clip` in `packages/shared/src/index.css` and removed `overflow-x` from `#root` to prevent accidental scroll container creation.
  - Added `transform: translateZ(0)` and `WebkitTransform: translateZ(0)` to `packages/shared/src/components/MobileTabBar.tsx` for GPU hardware compositing and added `,0px` fallback to `env(safe-area-inset-bottom)`.
  - Moved `<ShopTabBar />` in `apps/velshop/src/main.tsx` outside of `.site-app` so it is permanently anchored to the viewport.

---

## 2. Verification Summary
- `bun run typecheck:all`: PASS (0 errors across monorepo)
- `bun --filter @velnox/api test`: 126/126 PASS (17 test files, 585 assertions, 0 failures)
- `bun run build:apps`: PASS (All 4 SPAs compiled cleanly to `dist/`)
- `bun --filter @velnox/api build`: PASS (Wrangler edge bundle 1135.21 KiB)
- `git diff --check`: PASS (clean)
