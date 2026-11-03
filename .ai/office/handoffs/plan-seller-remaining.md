# Master execution plan — remaining Seller work

Status of this document: **living plan**, authored by AI 01 (see the AI 02 note
below). Updated as phases complete.

> **AI 02 delegation status: BLOCKED.** The subagent fails before producing
> output with `context_length_exceeded` (`max supported context is 272000
> tokens`) on a self-contained prompt. Harness guidance: *"Do the research
> yourself with read-only tools."* Phase A and the independent verification
> pass are therefore performed by AI 01 and labelled as such — never claimed as
> independent QA.

## Already delivered

| Slice | Delivered | Evidence |
|---|---|---|
| P0 repair | `my.ts` restored (HEAD was red), th/en duplicate keys removed, greeting emoji removed, MyShop import restored | `bun run i18n:check` exit 0; 4-app typecheck exit 0 |
| P1-A Goals/Performance | real `/api/seller/goals` + `/api/seller/income`, real loading/error/empty, i18n `sellerPerf`, 44px, no emoji | `backend/tests/seller-goals-surface.test.ts` 10 pass |
| P1-C (data correctness) | **order address/phone root cause fixed**: JSONB returns an object, the readers accepted only strings → every snapshot was `null` | `backend/tests/order-address-snapshot.test.ts` 13 pass |
| P1-F V badge (visual) | badge removed from seller + shop surfaces; verification/approval untouched | `backend/tests/verification-badge-visual.test.ts` 8 pass |

## Remaining phases

### P1-B — My Shop
- Files: `apps/velseller/src/pages/MyShop.tsx` (1138 lines), shared `ProductFormDialog`.
- APIs: `/api/seller/products*`, `/api/seller/profile` (existing).
- Work: split store identity / product stats / product list into a clearer
  hierarchy; move onboarding + verification-wizard branches to their own view;
  i18n all remaining Thai literals; 44px; table→card on mobile.
- DB: none. Risk: the page is one 1100-line component; splitting must not change
  behaviour of the approval gate.

### P1-C — Orders + shipment UX
- Files: `SellerOrders.tsx`, `SellerOrderDetail.tsx`.
- APIs: `/api/seller/orders`, `/api/seller/orders/:id`, `/api/seller/orders/:id/status`.
- Work: status chips already exist; add search, clearer grouping, package step
  entry point; render the now-working address snapshot (subdistrict/district/
  province/postal code) — already wired, now fed by real data.
- DB: none for the UX slice; package/shipment persistence is P1-C2.

### P1-C2 — Shipping engine (server-authoritative)
- New tables: `shipping_packages` (seller-owned templates), `shipping_rates`
  (carrier × zone × weight band), `shipping_quotes` (snapshot),
  `shipment_events`. Both `db/schema.sql` and `db/run-sqleditor.sql`.
- New endpoints: `POST /api/seller/shipping/quote`, `POST /api/seller/shipments`,
  `PATCH /api/seller/shipments/:id`, `GET /api/seller/shipping/rates`.
- Logic: `volumetric = L×W×H / divisor` (per carrier), `chargeable = max(actual,
  volumetric)`, zone by destination, snapshot persisted at creation.
- Carrier abstraction: `backend/lib/carriers/*` with `createShipment`,
  `track`, `label`; **no fake carriers** — unconfigured carrier ⇒ manual tracking
  fallback (`carrier`, `trackingNumber` typed by the seller).
- Tests: weight maths, zone selection, quote snapshot immutability, cross-seller
  ownership on packages/shipments.
- **This is the largest remaining slice and needs a real DB for the DB-gated
  tests (`TEST_DATABASE_URL`); without it those tests skip, they do not pass.**

### P1-D — Income + returns
- APIs: `/api/seller/income` (exists) — extend with shipping cost, return
  shipping cost, payouts by period.
- Return rate definition: returned eligible shipments ÷ eligible shipped
  shipments, **not** value-based. Threshold 10% configurable, small-sample flag.
- Depends on P1-C2 (needs shipment rows); cannot be honest before it.

### P1-E — Profile / Settings
- `SellerProfile.tsx` sections: store, contact, address, shipping, financial,
  performance, policies. Reuse `/api/seller/profile`; add fields only where the
  backend persists them.

### P1-G / P1-H — Integration + final QA
- Cross-page consistency pass, responsive sweep at 360/390/768/1024/1440,
  ownership probes, full suite, build matrix.

## Guard rails

- No mock data, no fake carriers, no invented schema.
- Ownership enforced server-side; never trust a client-supplied seller id.
- Every PASS carries a command and its real exit code.
