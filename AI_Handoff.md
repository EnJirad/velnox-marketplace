# Velnox AI Handoff

**Last updated:** 2026-09-14
**Branch:** `main`

## Current Project State

Velnox Marketplace — 4 Vercel frontends (velshop, velseller, velcenter, velnox) + Render backend (Express + WebSocket) + Neon PostgreSQL + Cloudflare R2. Auth: Google OAuth + JWT `velnox_session`.

## Recently Completed

### Seller UX, Category Selector & Application Lifecycle Overhaul

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

- Identity document upload during onboarding collects File objects but actual R2 upload uses EvidenceUploader in MyShop — the onboarding stores file metadata only. Full R2 upload during onboarding requires wiring EvidenceUploader into the RequireRole flow (future enhancement).
- VelCenter seller application review UI exists as VerificationReviewDialog but full review checklist (structured reasons, checklists) was not implemented in this pass — the existing approve/reject flow was enhanced with new statuses and notifications.
- Live browser E2E testing not performed in sandbox; verified via static analysis + typecheck.

## Recommended Next Steps

- Wire EvidenceUploader into RequireRole onboarding step 2 for actual R2 upload during application
- Build full VelCenter seller application review detail page with structured checklist
- Add review history table for audit trail of status transitions
- Remove deprecated `PRODUCT_CATEGORY_META` fallback labels
- Remove V Verification from MyShop verification dialog (integrated into application lifecycle)
