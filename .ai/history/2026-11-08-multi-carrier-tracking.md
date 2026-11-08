# 2026-11-08 — Integrated Multi-Carrier Tracking (Velnox)

**Type:** IMPLEMENTATION · **Carriers:** J&T / Flash / SPX / TNT · **Status:** backend implemented; carriers 1 PARTIAL + 3 gated; NOT pushed (rule: no commit/push without permission)

## What was done

Extended the EXISTING shipment lifecycle (never a second shipment system):

- **DB (additive, both canonical files in sync, reconciler tests pass):**
  `shipments` += `carrier_code`, `original_status`, `last_checked_at`, `last_error`,
  `last_error_at`, `tracking_confirmed`; `tracking_events` += `carrier_status`;
  indexes `idx_shipments_carrier_code|tracking_number|last_checked_at`.
- **Backend `lib/tracking/`:** adapter contract (`types.ts`), registry+health
  (`carrier-adapter.ts`), normalizer (`normalizer.ts` — raw→unified + PII-safe
  strings), the ONE http path (`safe-fetch.ts` — non-zero timeout, masked logs),
  adapters J&T/Flash/SPX/TNT (`carriers/`), repo (`shipment-repo.ts` — event
  dedupe), service (`tracking-service.ts` — cache 15min/6h, cooldown 60s, in-flight
  dedup, stepwise machine advance through `transitionShipment`, publish +
  notify only on real change).
- **Backend routes (`routes/tracking.ts`):** customer + seller view/refresh (404 on
  non-owner — no existence leak), admin search/detail/refresh/health gated by
  `orders.view` / `orders.manage`. Rate-limit rules added.
- **Frontend:** VelShop `ShopTracking` (refresh UI + carrier badge + last-checked +
  error + new statuses), Velseller ship dialog carrier Select + parcel refresh,
  VelCenter `TrackingTab` (health cards, search/filter, timeline dialog, refresh).
- **i18n:** `trackingLabels.returning|lost|unknown` + `tracking.refresh*` added to
  th/en/my at parity (2215 × 3).

## Carrier verification (empirical, 2026-11-08)

- **J&T TH** `websiteapi.jtexpress.co.th/…/orderTrack` → HTTP 200, captcha code
  20005 → **BLOCKED**, official merchant API required.
- **Flash** `flashexpress.com/webApi/tools/tracking` → 5s anti-bot HTML shield →
  **BLOCKED**, official B2B API required.
- **SPX** `spx.co.th/…/get_order_info` → HTTP 200, always backend error (retcode 2),
  CORS-locked to Shopee portal → **UNSUPPORTED** (internal endpoint).
- **TNT** `tnt.com/api/v3/shipment` → HTTP 200 structured JSON, not-found handled →
  **PARTIAL** (verified endpoint; no live CON to test the full chain; TNT-brand
  now under FedEx).

No adapter fakes data. Gated carriers return safe normalized error codes.

## Verification

- backend `tsc --noEmit` clean (only pre-existing `routes/auth.ts` errors)
- `bun test tests/tracking-*.test.ts` → pass (normalizer / adapters with stubbed
  fetch / safe-fetch)
- reconciler + schema-drift + sql-reference-coverage tests pass
- typecheck all 4 apps pass; i18n parity OK
- Full-suite pre-existing failures (Phase 2 UI overhaul + missing
  `.ai/secrets/browser-cookies.json`) confirmed on baseline via stash run

## Remaining gaps / next

- Official access (keys/partnership) for J&T, Flash, SPX to flip adapters LIVE.
- DB-gated integration tests need a disposable `TEST_DATABASE_URL` (currently
  unset on this device).
- Shipment `shipping` fee is a placeholder 35 THB until a carrier API exists
  (separate workstream).
- Commit + push require owner approval (task rule 13).

Docs: `.ai/context/tracking.md`. Report: `.ai/reports/LATEST.md`.
