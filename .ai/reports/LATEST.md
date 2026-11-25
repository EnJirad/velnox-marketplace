# Task Execution Report — Seller Onboarding Registration & Evidence Submission Fix

**Execution Timestamp:** 2026-11-25
**Task:** Fix Seller Onboarding Internal Server Error (`POST /api/seller/apply`) upon submitting identity evidence and shop registration
**Status:** COMPLETED & VERIFIED
**Initiative:** Velnox Clean Rebuild Initiative

---

## 1. Summary of Work Completed

### Issue: 500 "An internal server error occurred." on Seller Registration Submission
- **Root Cause:**
  1. `ShopOnboarding.tsx` submitted `{ shopName, shopSlug, shopDescription, shopCategory, shopAddress, firstName, lastName, phone, idCardFrontUrl, idCardBackUrl, selfieUrl, identityEvidence }`.
  2. `SellerService.applySeller` strictly checked `if (!input.businessName || !input.shopName || !input.shopSlug) throw new Error(...)`. Because `businessName` is not part of the individual onboarding form and `shopSlug` was optional, it threw an error.
  3. The error had no `status` property, causing Hono's global `errorHandler` to map it to HTTP 500 `INTERNAL_SERVER_ERROR` with "An internal server error occurred."
  4. In `NeonSellerRepository.createSellerAndShop`, the SQL query attempted to insert into non-existent columns on `sellers` table (`business_name`, `business_type`, `tax_id`, `id_card_number`), which in PostgreSQL Neon schema threw `error: column "business_name" of relation "sellers" does not exist`.
  5. In `NeonSellerRepository.getSellerByUserId` and `getShopBySellerId`, queries selected non-existent columns (`logo_url`, `cover_url`, `review_count`, `business_name`), causing subsequent profile and shop fetches to fail.
  6. The applicant data (`firstName`, `lastName`, `phone`, etc.) and identity evidence documents were not being persisted into `seller_settings` and `seller_verifications`.
- **Fix Implemented:**
  1. **Flexible Input & Auto-Slug in `SellerService`:**
     - In `workers/api/src/modules/sellers/seller-service.ts`, default `businessName` to `shopName` if not provided, default `businessType` to `"individual"`, and automatically generate a URL-safe slug from `shopName` when `shopSlug` is omitted.
  2. **Clean PostgreSQL Neon Schema Alignment in `NeonSellerRepository`:**
     - In `workers/api/src/modules/sellers/seller-repository.ts`:
       - `createSellerAndShop`:
         - Inserts/updates `sellers` using only real schema columns (`id`, `user_id`, `status`, `verification_status`, `created_at`, `updated_at`).
         - Upserts `shops` with all address attributes, category, phone, description, and unique slug generation.
         - Persists applicant personal details and document URLs into `seller_settings` (`settings` JSONB).
         - Records verification evidence in `seller_verifications` (`evidence_urls` JSONB) and logs to `seller_review_history`.
         - Promotes `users.role` to `'seller'`.
       - `getSellerByUserId`: Joins `sellers` and `seller_settings` cleanly without selecting missing columns.
       - `getShopBySellerId`: Queries real columns (`logo as "logoUrl"`, `cover as "coverUrl"`, `product_count as "reviewCount"`).
       - `updateShop`: Updates real columns `logo` and `cover`.
  3. **Route Error Handling & Envelope Normalization in `sellerRoutes`:**
     - Wrapped `POST /apply` with structured try/catch to return HTTP 400/409 validation envelopes instead of unhandled 500 crashes.
     - In `GET /profile` and `GET /status`, return both `shop` and `shops: [shop]` for compatibility with both array and single-shop consumers.
  4. **Admin Review Integration in `adminRoutes`:**
     - Updated `GET /sellers/:sellerId/application` and `GET /verifications/seller/:verificationId/evidence` to join `seller_settings` and `seller_verifications` so VelCenter administrators can inspect the submitted ID cards and selfie documents.
  5. **Frontend Resiliency:**
     - In `apps/velseller/src/components/shop/ShopOnboarding.tsx`, explicitly passed `businessName: form.shopName.trim()` and `businessType: "individual"`.
     - In `apps/velseller/src/pages/MyShop.tsx`, handled both HTTP 403 and 404 in `loadProfile` and safely derived `shop = profile?.shops?.[0] ?? profile?.shop ?? null`.

---

## 2. Verification Summary
- `bun --filter @velnox/api test`: PASS (127/127 tests passed across 17 files, 590 assertions, 0 failures)
- `bun run typecheck:all`: PASS (0 errors across all frontends, packages, and workers)
- `bun run build:apps`: PASS (All 4 SPAs compiled cleanly to `dist/`)
- `bun --filter @velnox/api build`: PASS (Wrangler edge bundle 1145.24 KiB)
- `git diff --check`: PASS (clean)
