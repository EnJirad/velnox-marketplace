# 2026-11-25 — Seller Onboarding Registration & Evidence Submission Fix

**Execution Timestamp:** 2026-11-25
**Task:** Fix Seller Onboarding Internal Server Error (`POST /api/seller/apply`) upon submitting identity evidence and shop registration
**Status:** COMPLETED & VERIFIED

---

## 1. Summary of Work Completed
- **Seller Application & Schema Fix:**
  - Aligned `NeonSellerRepository.createSellerAndShop`, `getSellerByUserId`, `getShopBySellerId`, and `updateShop` with PostgreSQL Neon schema.
  - Persisted applicant info and evidence documents into `seller_settings` and `seller_verifications`.
  - Added auto-slug generation and sensible defaults in `SellerService.applySeller`.
  - Added structured error handling in `POST /api/seller/apply` and enriched `GET /api/seller/profile`.
  - Connected VelCenter Admin review endpoints to display submitted evidence documents.
  - Enhanced `ShopOnboarding.tsx` and `MyShop.tsx` to handle shop profiles gracefully.

---

## 2. Verification Summary
- `bun --filter @velnox/api test`: PASS (127/127 tests passed across 17 files, 590 assertions, 0 failures)
- `bun run typecheck:all`: PASS (0 errors across monorepo)
- `bun run build:apps`: PASS (All 4 SPAs compiled cleanly)
- `bun --filter @velnox/api build`: PASS (Wrangler bundle 1145.24 KiB)
- `git diff --check`: PASS (clean)
