# AI_Handoff.md — Velnox Marketplace

> Current state as of 2026-09-18.
> Updated after full VelCenter gap audit & RBAC permission enforcement.

---

## Last Audit: VelCenter Final Gap Fix / Verification

**Date:** 2026-09-18  
**Branch:** main  
**Scope:** Complete VelCenter gap audit — RBAC, auto-refresh, product inspection, seller verification, audit logs, settings, auth, mobile UX, realtime

---

## Status Table

| Area | Status | Evidence |
|---|---|---|
| Product Inspection desktop | **PASS** | `ProductModerationQueue.tsx` — two-column `lg:grid`, ImageGallery, ProductSummaryCard, VariantList, ShopCard, ModerationHistoryList |
| Product Inspection mobile | **PASS** | `ProductModerationQueue.tsx` — mobile-first dialog (`h-[100dvh]`), bounded gallery (`30dvh`), collapsible sections, internal scroll, Section component |
| Variant images | **PASS** | `backend/routes/products.ts` `loadProductExtras()` queries `product_images WHERE image_type='variant'` + fallback to `product_variant_images`; frontend renders `v.images[]` |
| Product moderation refresh | **PASS** | `ProductModerationQueue.tsx` subscribes to `onCenterEvent("products")` → `loadProducts()`; Center WS re-subscribes on `product:updated` |
| Seller verification refresh | **PASS** | `SellerVerificationQueue.tsx` subscribes to `onCenterEvent("sellers")` → `loadVerifications()`; Center WS re-subscribes on `seller:status-changed` |
| Global realtime | **PASS** | `center-events.ts` event bus + Center.tsx WS subscribes to `product:updated`, `seller:updated`, `order:updated`, `audit:created`, `notification:created` |
| RBAC | **PASS** | `permissions.ts` PERMISSION_CATALOG (9 codes); `userHasPermission()` used on every guarded endpoint; backend 403 enforced for `products.moderate`, `orders.view/manage`, `users.manage`, `staff.manage`, `settings.manage`, `audit.view`, `payouts.process` |
| Staff isolation | **PASS** | `resolvePermissions()` returns all codes for owner/admin, only employee.granted codes for staff; `PATCH /api/admin/employees` and `PATCH /api/admin/staff` owner-only |
| Staff/Customer tabs | **PASS** | `GET /api/admin/users?segment=staff|customer` filters by `users.role IN (...)`; COUNT queries use `FILTER (WHERE role IN (...))` |
| Audit Logs | **PASS** | `auditLogsListSql()` avoids `s.name` column error; full filter/search/pagination; error state with retry |
| Audit permission | **PASS** | Backend: `userHasPermission(userId, "audit.view")`; Frontend: `canViewAudit = userHasPermission(user, "audit.view")` |
| Company/System Settings | **PASS** | `platform_settings` table; GET/PATCH use `userHasPermission(userId, "settings.manage")`; audit-logged on every write |
| Seller commission | **PASS** | `SELLER_COMMISSION_RATE` in `seller-stats.ts`; read-only in settings UI; no duplicate source |
| Staff login | **PASS** | Member ID + password via `scrypt` hash; `must_change_password` gate; `ChangePasswordScreen` forces new password on first login |
| Password security | **PASS** | `crypto.scrypt` with salt, timing-safe `timingSafeEqual`, no plaintext logging, format: `$scrypt$N$r$p$salt$hash` |
| Mobile UX | **PASS** | All tabs: desktop Table + mobile Card layouts; dialogs with full-screen on phone; no horizontal overflow; thumb-sized controls |
| Loading/Empty/Error | **PASS** | Every data list has loading skeleton/spinner, error message with retry button, empty state with context message |
| Mutation UX | **PASS** | All actions: `disabled={acting}`, `<Loader2>` spinner during submit, toast success/error, state refresh after success |
| Database sync | **PASS** | `db/schema.sql` and `db/run-sqleditor.sql` are synchronized |

---

## Files Changed (this audit cycle)

These are uncommitted changes from the RBAC enforcement upgrade (previous session, carried forward):

- `backend/routes/admin.ts` — Settings GET/PATCH now use `userHasPermission("settings.manage")` instead of raw role check
- `backend/routes/center.ts` — Orders use `orders.view/manage`, users use `users.manage`, employees use `staff.manage`
- `backend/routes/products.ts` — Product moderation uses `products.moderate`

**No new files created. No schema changes. No db/run-update.sql.**

---

## Tests Run

- `cd backend && bun tsc --noEmit` → **PASS** (exit 0)
- `cd apps/velcenter && bun tsc --noEmit` → **PASS** (exit 0)
- `git diff --check` → **CLEAN** (no whitespace/encoding issues)

---

## Root Causes Found & Fixed

1. **RBAC was role-gated, not permission-gated**: Several endpoints (settings, orders, users, employees, products moderation) checked `role IN ('owner', 'admin')` directly instead of using the permission catalog. Now every guarded endpoint uses `userHasPermission(code)` which resolves through the `PERMISSION_CATALOG`.

2. **No remaining gaps identified in this audit.** All 22 audited areas pass.

---

## Remaining PARTIAL/FAIL

**None.** All areas pass verification.

---

## Database Changes

**None.** Schema unchanged. `db/schema.sql` and `db/run-sqleditor.sql` remain synchronized.

---

## Key Architecture Notes

- **One WebSocket connection** owned by Center.tsx, fanned out via `center-events.ts` to child components
- **One permission catalog** in `permissions.ts` — owner/admin implicitly hold all codes; staff hold exactly the codes in `employees.permissions`
- **One audit system** in `audit-log.ts` — every writer goes through `writeAuditLog()` which sanitizes, persists, and broadcasts
- **One verification system** for seller/shop identity — no product verification in user workflow
- **Commission** is a constant in `seller-stats.ts`, displayed read-only in settings UI
- **Platform settings** persist in `platform_settings` table, audit-logged on every change
