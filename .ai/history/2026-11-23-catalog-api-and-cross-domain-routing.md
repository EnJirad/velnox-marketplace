# Catalog API Fix, Cross-Domain Link Normalization & Neon Showcase Seeding

**Execution Date:** 2026-11-23
**Branch:** `main`
**Task:**
1. Resolve PostgreSQL `22P02` (invalid_text_representation) on `/api/products/catalog` and `/products/:id` by adding dedicated `/products/catalog` routing and UUID validation guards.
2. Resolve relative cross-app link behavior (e.g. `velnox-shop-3mh.pages.dev/velnox-seller.pages.dev`) by normalizing `SITE_URLS` and `apiUrl` to enforce `https://` protocol and replacing client-side router `<Link>` with native `<a>` for external cross-app banners.
3. Seeded 5 official showcase products across Electronics, Fashion, Home & Living, and Health & Beauty into Neon PostgreSQL.

---

## 1. Modifications
- **`workers/api/src/routes/catalog.ts`:**
  - Added dedicated `/products/catalog` endpoint for frontend compatibility.
  - Added query param normalization (`q`, `categoryId`, `categorySlug`, `minPrice`, `maxPrice`, `sort`, `sortBy`, `page`, `limit`, `offset`, `shopId`).
- **`workers/api/src/modules/catalog/catalog-repository.ts`:**
  - Guarded `getProductById` to return `null` immediately when non-UUID string is provided.
  - Enhanced `listProducts` to dynamically resolve category by UUID or slug without PostgreSQL cast errors.
- **`packages/shared/src/lib/sites.ts`:**
  - Added `normalizeSiteUrl` to guarantee that all `SITE_URLS` and `apiUrl` have `https://` protocol even if configured without protocol in environment variables.
- **`apps/velshop/src/components/shop/TopBanner.tsx`:**
  - Replaced `<Link>` with native `<a>` for cross-application external navigation to VelSeller.
- **`database/seed-demo.ts`:**
  - Showcase seeding script establishing official Velnox flagship store and 5 published products.

## 2. Verification
- `git diff --check`: PASS (clean)
- `bun --filter @velnox/api test`: 94/94 PASS (391 expect calls)
- `bun --filter @velnox/api typecheck`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors)
- `bun --filter @velnox/velshop typecheck`: PASS (0 errors)
- `bun run build:velshop`: PASS (built in 37.35s)
- `Neon PostgreSQL`: Verified 5 published products active in live database.
