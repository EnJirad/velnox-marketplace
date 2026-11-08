# 2026-11-08 — CRITICAL: Customer order tracking 500 "Failed to fetch order"

**Type:** BUG FIX · **Severity:** CRITICAL (production customer-facing) · **Status:** FIXED (code) — production migration still BLOCKED (owner action)

## Root cause (VERIFIED with production evidence)

The multi-carrier tracking feature (committed `96bbb74 shipping`) extended
`fetchShipmentsForOrder()` to select six new tracking columns on `shipments`
(`carrier_code`, `original_status`, `last_checked_at`, `last_error`,
`last_error_at`, `tracking_confirmed`) and `carrier_status` on
`tracking_events`.

**Production Neon has NOT been reconciled.** Verified read-only against the
`velnox` project, `production` branch `br-frosty-sea-az7kagpe`:
`shipments` has 12 columns only (the legacy set + fulfillment/shipped/delivered/
correlation) — **all six tracking columns are missing**; `tracking_events` has 5
columns only — **`carrier_status` missing**.

Because the shipments SELECT referenced the missing columns OUTSIDE any
try/catch, every `GET /api/customer/orders/:orderId` threw PostgreSQL `42703
undefined_column` → the order-detail endpoint returned `500 DB_ERROR` →
VelShop showed **"ไม่พบออเดอร์ / Failed to fetch order"** for a REAL order.

The pre-existing events SELECT was inside a try/catch (legacy fallback), but the
shipments SELECT was not — that asymmetry is what broke the whole page.

## Fix (minimal, defensive)

Schema-gap-aware fallback in every reader of the new columns — only `42703` /
`42P01` (undefined column/table) trigger the legacy projection; any other DB
error is rethrown (a genuine failure is never masked as an empty order):

- `backend/lib/order-read.ts` — `fetchShipmentsForOrder()`: extended SELECT →
  fallback legacy SELECT; same for events (`carrier_status` present/absent).
- `backend/lib/tracking/shipment-repo.ts` — `getShipmentForOrder()` fallback +
  exported `isSchemaGapError()`.
- `backend/lib/tracking/tracking-service.ts` — `loadEventsView()` fallback.
- `backend/routes/tracking.ts` — admin search (carrier-code term) + admin detail
  events fallback.

Frontend error presentation (`apps/velshop/src/pages/ShopTracking.tsx`):
classifies failures by status — 401 session expired, 403 access denied,
404 not-found, ≥500 server error, network — with a **Retry** button for
temporary failures, and never presents a backend error as a confirmed missing
order. i18n keys added to th/en/my (2235 × 3 parity).

## Verification

- `bun test tests/order-read-schema-fallback.test.ts` → 5 pass (schema-gap
  fallback on shipments SELECT + events SELECT + non-schema error rethrow +
  repo fallback + reconciled-schema happy path).
- tracking + order regression batch → 129 pass / 54 skip / 2 fail (the 2 fail
  are the pre-existing seller-order-ux source tests from the Phase 2 UI
  overhaul — confirmed on baseline before this change).
- backend `tsc --noEmit` clean (pre-existing `routes/auth.ts` errors only).
- all 4 apps typecheck, i18n parity, `git diff --check`, velshop build pass.

## Remaining (BLOCKED — owner action needed)

- Run `db/run-sqleditor.sql` (the additive reconciler) against production Neon
  to add the six `shipments` columns + `tracking_events.carrier_status` +
  indexes. The fixed code is now SAFE before and after that migration, so this
  is not urgent for the customer flow — but the tracking refresh/adapter
  features only become live once it is applied. Following the project's
  approved workflow (paste into Neon SQL Editor); no destructive SQL.
- Render logs for the exact failing request: BLOCKED (no Render access in this
  environment).
