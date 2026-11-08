# TRACKING — Multi-Carrier Integrated Tracking

## Purpose

Integrated parcel tracking for VelShop (customer), Velseller (seller) and
Velcenter (admin). The backend is the only component that talks to a carrier —
frontends never call a carrier API and never hold carrier credentials.

This EXTENDS the existing shipment lifecycle (`shipments` + `tracking_events` +
`order-shipment.ts`). It never creates a second shipment system and never moves
`shipments.status` outside `transitionShipment`.

## Source Locations

- `backend/lib/tracking/types.ts` — unified vocabulary + adapter contract
- `backend/lib/tracking/carrier-adapter.ts` — carrier registry + aliases + health
- `backend/lib/tracking/normalizer.ts` — raw status → unified + PII-safe strings
- `backend/lib/tracking/safe-fetch.ts` — the ONE place a carrier HTTP call
  leaves the process (non-zero timeout, masked logs, capped bodies)
- `backend/lib/tracking/carriers/{jt,flash,spx,tnt}.ts` + `parse-utils.ts`
- `backend/lib/tracking/shipment-repo.ts` — DB reads/writes (dedupe)
- `backend/lib/tracking/tracking-service.ts` — cache / dedup / cooldown / machine advance
- `backend/routes/tracking.ts` — `setupTrackingRoutes(app)` (customer/seller/admin)
- `apps/velshop/src/pages/ShopTracking.tsx`, `apps/velseller/src/pages/SellerOrderDetail.tsx`,
  `apps/velcenter/src/components/TrackingTab.tsx` — frontends
- `packages/shared/src/lib/api-routes.ts` (`api.*.orderTracking*`, `api.tracking.*`),
  `packages/shared/src/lib/commerce.ts` (`StoreOrder.shipments` types),
  `packages/shared/src/lib/i18n/locales/{th,en,my}.ts` (`trackingLabels.*`, `tracking.*`)

## Data Flow

```
seller/admin mark shipped (existing PATCH …/shipment) → shipments row (carrier + tracking_number)
  → user clicks Refresh → POST /{customer|seller|admin}/…/tracking/refresh
  → service: cooldown check → in-flight dedup → carrier adapter (safe-fetch, timeout)
  → normalize events → persist (dedupe) → advance shipment machine stepwise
    (transitionShipment, the ONE legal mover) → publish shipment:updated + notify customer
  → GET order detail / tracking returns shipments[] with events[]
```

## Unified status vocabulary (`tracking_events.status`)

`info · created · picked_up · arrived_at_hub · in_transit · out_for_delivery ·
delivered · failed · returning · returned · cancelled · lost · unknown`
(pins `trackingLabels.*` in all three locales).

This is an EXTENSION of the label set that already existed; `shipments.status`
(the shipment MACHINE, `order-shipment-states.ts`) is unchanged and stays the
fulfilment authority. `tracking_events.carrier_status` always keeps the raw
original string so normalization changes never rewrite history.

## Carrier integration status (verified 2026-11-08)

| Carrier | Public endpoint | Result | Our status |
|---------|-----------------|--------|------------|
| J&T TH | `websiteapi.jtexpress.co.th/…/track/orderTrack` | HTTP 200, captcha-gated (code 20005) | **BLOCKED** — needs official merchant API |
| Flash | `www.flashexpress.com/webApi/tools/tracking` | 5-second anti-bot HTML shield | **BLOCKED** — needs official B2B API |
| SPX | `spx.co.th/shipment/order/open/order/get_order_info` | HTTP 200, always backend error (retcode 2); CORS-locked to Shopee portal | **UNSUPPORTED** — internal portal API |
| TNT | `www.tnt.com/api/v3/shipment` | HTTP 200 structured JSON; not-found handled | **PARTIAL** — verified endpoint, no live CON tested |

No adapter fabricates tracking data. A blocked/unreachable carrier returns a
normalized safe error code and leaves the stored events untouched. The admin
health surface (`GET /api/admin/tracking/health`) reports these statuses per
carrier honestly.

## Security rules

- Customer: refresh only `orders.user_id = me` (404, never a 403 that leaks).
- Seller: only orders whose items belong to the caller’s shops
  (`order_items.shop_id → shops.seller_id`), seller must be approved.
- Admin: `isCenterMember` + `userHasPermission(userId, "orders.view" | "orders.manage")`.
- J&T `phoneVerify` is read SERVER-side from the order’s own address snapshot
  only — never from the client — and is never logged, stored or returned.
- Carrier errors are normalized codes; no raw carrier text / phone / PII in
  responses or logs (tracking numbers are masked in logs).

## DB changes (additive, both `db/schema.sql` + `db/run-sqleditor.sql`)

- `shipments`: `carrier_code TEXT`, `original_status TEXT`, `last_checked_at TIMESTAMPTZ`,
  `last_error TEXT`, `last_error_at TIMESTAMPTZ`, `tracking_confirmed BOOLEAN NOT NULL DEFAULT FALSE`
- `tracking_events`: `carrier_status TEXT`
- indexes: `idx_shipments_carrier_code`, `idx_shipments_tracking_number`, `idx_shipments_last_checked_at`
- One canonical shipment per order is unchanged (`shipments_order_id_unique`).
- Reconciler contract (canonical parity) is preserved — verified by
  `db-run-sqleditor-reconciler.test.ts` + `schema-drift.test.ts`.

## API endpoints

- `GET  /api/customer/orders/:orderId/tracking` — customer’s own order (cache-first)
- `POST /api/customer/orders/:orderId/tracking/refresh` — force carrier check
- `GET  /api/seller/orders/:id/tracking` · `POST /api/seller/orders/:id/tracking/refresh`
- `GET  /api/admin/tracking/search?q=&carrier=&status=&limit=&offset=`
- `GET  /api/admin/tracking/shipments/:shipmentId`
- `POST /api/admin/orders/:orderId/tracking/refresh`
- `GET  /api/admin/tracking/health`

Unified response view: `shipmentId, orderId, carrier, carrierCode, carrierName,
trackingNumber, status, shipmentStatus, originalStatus, estimatedDeliveryDate,
lastCheckedAt, lastError, trackingConfirmed, refreshed, message, events[]`.

## Performance & reliability (Phase 6)

- In-memory cache (per shipment): TTL 15 min (6 h for terminal), 60 s for errors.
- Cooldown 60 s per shipment — a re-click returns `RECENTLY_CHECKED`, never a
  second carrier call.
- In-flight dedup: concurrent refreshes share ONE promise.
- Non-zero timeout per request (default 10 s, `TRACKING_CARRIER_TIMEOUT_MS`).
- Retry only for network-level (timeout/5xx) — never for captcha/anti-bot 4xx.
- Rate limit rules in `rate-limit.ts`: `tracking-refresh` (20/min user-keyed),
  `tracking-admin-read` (120/min).

## Environment variables (none required, all optional with safe defaults)

```
TRACKING_CACHE_TTL_MS=900000        # 15 min read cache
TRACKING_REFRESH_COOLDOWN_MS=60000  # min gap between forced refreshes per shipment
TRACKING_CARRIER_TIMEOUT_MS=10000   # non-zero carrier timeout (0 is forbidden)
```
Official carrier access (J&T / Flash / SPX) will need per-provider tokens/keys —
record presence only, never values.

## Verification

- `cd backend && bunx tsc --noEmit` (pre-existing `routes/auth.ts` errors only)
- `bun test tests/tracking-*.test.ts` — normalizer + adapters (stubbed fetch) + safe-fetch: all pass
- Reconciler / schema-drift / sql-reference-coverage tests pass.
- DB-gated integration (real Neon via TEST_DATABASE_URL) is NOT configured in
  this environment — those paths are untested end-to-end (see AI_HANDOFF).
- Pre-existing full-suite failures (Phase 2 UI overhaul in progress) are not
  caused by this change and were confirmed present before it (baseline stash run).

Related: `checkout.md`, `database.md`, `backend.md`, `security.md`, `realtime.md`.
