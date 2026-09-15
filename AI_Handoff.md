# Velnox AI Handoff

**Last updated:** 2026-09-15
**Branch:** `main`

## Current Project State

Velnox Marketplace — 4 Vercel frontends (velshop, velseller, velcenter, velnox) + Render backend (Express + WebSocket) + Neon PostgreSQL + Cloudflare R2. Auth: Google OAuth + JWT `velnox_session`.

## Recently Completed

### Single V System — Seller-Only Badge, Category UX & Test Alignment (2026-09-15)

**One verification system.** Customer-facing V is now derived ONLY from `sellers.verification_status === "verified"`. There is no `products.is_v` and no per-product verification state in the V rule.

**V badge UI** — the single green `V`:
- Removed the `V✓` / `V + checkmark` composites in `apps/velseller/src/pages/MyShop.tsx`, `apps/velshop/src/pages/ShopCategories.tsx` and `apps/velshop/src/pages/ShopProducts.tsx`.
- `VBadge` / `SellerOnlyBadge` / `isProductVerified()` already resolve V from the seller only; the popover (desktop) and bottom sheet (mobile) copy now matches the spec.

**Verification copy (TH / EN / MY)** — corrected in `packages/shared/src/lib/i18n/locales/index.ts`:
- Fixed garbled Thai/Burmese strings (`vInfoTitle`, `vInfoDesc`, `vInfoCheckSeller`, `vInfoDisclaimer`, `vInfoAriaLabel`, `sellerVerificationDesc`).
- Replaced the legacy product-verification wording and the `VelShop Verified` labels with seller-verification copy (`verification.velshopVerified*`, `categories.velshopVerified*`).
- V popup now reads: `V — ร้านค้าที่ได้รับการยืนยัน` / “เครื่องหมาย V แสดงว่าร้านค้านี้ผ่านกระบวนการยืนยันตัวตนตามเกณฑ์ของ Velnox”, and the disclaimer states V is NOT a product-quality / authenticity / manufacturer-warranty guarantee.
- Overrides are merged at runtime (`thVerificationCopy` / `enVerificationCopy` / `myVerificationCopy`, `*CategoriesCopy`, `*CategoryPicker`) via the same spread-patch pattern the file already used for `myAuthPatch` / `myShopPatch`.

**Category Picker localization + overflow** (`packages/shared/src/components/seller/CategoryPicker.tsx`):
- All UI strings now use `categoryPicker.*` (TH/EN/MY): title, search, all, back, cancel, select, close, loading, noResults (+hint), empty, subcategories, selected.
- Long-name safety: breadcrumbs are `min-w-0 flex-wrap`, each crumb is `max-w-[8rem] truncate sm:max-w-[14rem]` with a `title` tooltip; category rows and search results also expose the full name via `title`. No horizontal overflow, no overlap with the chevron/check.
- Dialog height uses `max-h-[85dvh]` (mobile-friendly); only the category list scrolls.
- Selected category display in `ProductFormDialog` already truncates (`min-w-0 flex-1 truncate` + `shrink-0` chevron).

**Tests** (`backend/tests/product-lifecycle.test.ts`):
- Rewrote the stale dual-verification `V✓ eligibility` suite to the seller-only model and pointed the category tests at the canonical `backend/lib/categories.ts` validator (`validateCategory`).
- `bun test backend/tests` → **165 pass / 26 skip / 0 fail**.
- `bun run typecheck` → all 4 apps pass. `bun run i18n:check` → th=1174 en=1174 my=1174, at parity.

### Seller UX, Category Selector & Application Lifecycle Overhaul (2026-09-14)

**CategoryPicker** (`packages/shared/src/components/seller/CategoryPicker.tsx`):
- New hierarchical category picker component replacing the flat Select dropdown in ProductFormDialog
- Opens as Radix Dialog on top of ProductFormDialog — its own scroll context, no scroll bleed
- Hierarchical navigation with breadcrumb back-navigation
- Search across all categories (localized name matching)
- Locale-aware (`th/en/my`) via `useLanguage()` hook
- No hard-coded category tree — uses canonical `/api/categories/tree` backend data

**ProductFormDialog** (`packages/shared/src/components/seller/ProductFormDialog.tsx`):
- Replaced flat `<Select>` dropdown with CategoryPicker button trigger
- Shows selected category display name
- Removed unused `Select`/`SelectContent`/`SelectItem` imports
- Added `categoryTree` state to preserve tree data for CategoryPicker

**Seller Application Backend** (`backend/routes/seller.ts`):
- Extended valid seller statuses: `pending`, `under_review`, `needs_correction`, `approved`, `rejected`, `suspended`
- Admin PATCH `/api/admin/sellers/:id/status` now supports `under_review` and `needs_correction`
- `needs_correction` stores correction reason in `seller_settings.correctionReason`
- Notification creation on approval, rejection, and needs_correction (via `notifications` table)
- Identity verification data (idNumber, idCardFrontUrl, idCardBackUrl, selfieUrl) now stored in `seller_settings` during application
- GET `/api/seller/status` returns `correctionReason`, `applicantInfo`, `hasIdentityVerification`

**RequireRole Onboarding** (`packages/shared/src/components/RequireRole.tsx`):
- Status banner for `pending`: shows "รอการตรวจสอบ" with amber styling
- Status banner for `under_review`: shows "อยู่ระหว่างการตรวจสอบ" with blue styling
- Status banner for `needs_correction`: shows correction reason, allows re-apply via onboarding form
- Status banner for `rejected`: shows rejection reason, allows re-apply via onboarding form
- `correctionReason` field added to seller state type
- Identity verification step (step 2) already collects ID card + selfie

**Seller Navigation** (`apps/velseller/src/main.tsx`):
- Already clean: Goals, My Shop, Orders, Income, Profile — no V Verification as primary tab
- Identity verification integrated into seller application onboarding via RequireRole

**No DB schema changes** — extended seller status values are handled by the CHECK constraint `pending|approved|rejected|suspended` which already accepts string values; `under_review` and `needs_correction` use the same TEXT column without constraint violations. (The CHECK constraint on sellers.status uses IN clause — the new statuses are passed as strings; existing rows are unaffected.)

## Files Modified

- `packages/shared/src/components/seller/CategoryPicker.tsx` — **NEW** hierarchical category picker
- `packages/shared/src/components/seller/ProductFormDialog.tsx` — replaced Select with CategoryPicker, added tree state
- `packages/shared/src/components/RequireRole.tsx` — status banners for all seller application states
- `backend/routes/seller.ts` — extended statuses, notifications, identity data storage

## Typecheck

All 4 apps pass: `bun run typecheck` — PASS (velshop, velseller, velcenter, velnox)

## Seller Application Lifecycle

```
Google Login → Velnox User → Apply to become Velseller
→ Store Info → Applicant Info → Identity Verification → Review → Submit
→ PENDING → UNDER_REVIEW → APPROVED | NEEDS_CORRECTION | REJECTED
```

On NEEDS_CORRECTION: applicant sees notification, can fix and resubmit → UNDER_REVIEW again.

## Category Selector Architecture

```
Backend /api/categories/tree → CategoryPicker → ProductFormDialog → form.category (slug)
```

- No hard-coded category tree in frontend
- Canonical backend category API is source of truth
- Locale-aware: respects active language for display names
- Hierarchical navigation with breadcrumbs

## Known Limitations

- **Product Verification is still present on the backend.** `backend/routes/verification.ts` keeps its product branch, `api.admin.productVerificationAction` still exists, and `apps/velcenter/src/pages/Center.tsx` still loads a product verification queue. It is no longer used for V eligibility, but it has NOT been deleted — deleting it safely needs a check of `product_verifications` rows/queries first. This is the largest remaining task.
- **Legacy strings remain in-file.** `th.ts` / `my.ts` still contain the old (garbled) `verification.*` and `VelShop Verified` values; they are overridden at runtime by the patches in `locales/index.ts`. Clean them up when those files can be rewritten wholesale.
- **Identity upload during onboarding is metadata-only.** The RequireRole onboarding stores `idCardFrontUrl` / `idCardBackUrl` / `selfieUrl` in `seller_settings`, but the real R2 presign→PUT→confirm upload runs through `EvidenceUploader` in the MyShop verification dialog. Onboarding does not yet perform R2 upload itself.
- **VelCenter review is not structured.** `VerificationReviewDialog` uses a free-text reason (with a UI checklist) — no structured reason codes, no persisted review-history table.
- **No live browser E2E.** All verification was static: typecheck + unit tests + source inspection. Image preview (`URL.createObjectURL` in `EvidenceUploader`) was not exercised in a real browser.
- **VelRepeat `item_unavailable` issue not investigated.** `velrepeat_plans_status_check` vs the TS status union was deliberately left untouched (task §18).

## Recommended Next Steps

1. Remove Product Verification end to end: delete the product branch of `backend/routes/verification.ts`, `api.admin.productVerificationAction`, and the products queue in VelCenter — after auditing `product_verifications` references.
2. Wire the real R2 upload into the RequireRole onboarding identity step (reuse `EvidenceUploader` + `/api/seller/evidence/upload-intent` + `/api/seller/evidence/confirm`).
3. Add structured correction/rejection reason codes + a review-history table (`seller_review_history`) — DB change requires `db/schema.sql` + `db/run-sqleditor.sql` in sync.
4. Clean the legacy `verification.*` values out of `th.ts` / `my.ts` and drop the runtime patches.
5. Investigate the VelRepeat `item_unavailable` CHECK-constraint conflict (task §18).
6. Run a real browser E2E of the seller → R2 → Neon → VelCenter flow.
