# Velnox Production E-Commerce Gap Report

**GitHub SHA:** `04f9707c8fe3a8c06d6e1183ff2598d4c36a10db` — **the code revision this audit examined** (branch `main`; local == `origin/main`; working tree clean at the time of examination). The audit documents themselves are the only thing added afterwards, so this SHA stays the reference for every finding below.
**Date:** 2026-10-06
**Scope:** AUDIT ONLY. No code, schema, dependency or migration was changed by this audit (§41). The only files created are the four documents under `.ai/audit/`.
**Companion documents:** `ECOMMERCE_BENCHMARK.md`, `CURRENT_SYSTEM_MAP.md`, `DOMAIN_COMPARISON.md`

---

## Executive Summary

Velnox has a **sound and unusually careful commerce core**. Cart → checkout → payment →
settlement → refund is coherent, server-authoritative, idempotent and race-safe, and it
is backed by 2,035 passing tests, a rerunnable schema reconciler with its own proof
harness, contract tests that pin the two canonical SQL files against each other, and a
test-database guard that **refuses to run against production**. Several things here are
better than a naive implementation of the same feature (see §40) and must not be
dismantled.

The problems are not in the *design* of the core. They are in three places:

1. **One column still carries three lifecycles.** `orders.status` holds payment, order
   and fulfilment values in a single 12-value CHECK. Migration 056 provisioned the real
   axes (`order_state`, `fulfillment_status`) and **no code writes them** — a verified
   search returns zero non-test references. So the schema describes one model and the
   runtime uses another. This is a REAL DEFECT (P0-1), and it is the one that can destroy
   a recorded fact: a full refund writes `refunded` over a `shipped` order.
2. **The marketplace's money side does not exist at runtime.** `commissions` and
   `settlements` have zero writers, `ledger_entries` (056) has zero writers, and three
   different commission rates (0.03, 0.03, 0, default 0.05) disagree with each other. The
   platform cannot answer "what do we owe this seller?" (P0-2). Customer payment and
   seller settlement are separated in the **schema** and nowhere else.
3. **Nothing reconciles Velnox against its provider.** There is no payment, refund,
   inventory, fulfilment or settlement reconciler. A webhook that is never delivered
   leaves a payment `pending` forever and **nothing notices** (P0-3).

Migration 056 is the most important fact about the current state, and it cuts both ways.
It raised the **schema** to production foundation for nine domains — and changed **no
runtime behaviour at all**. `.ai/audit/CURRENT_SYSTEM_MAP.md` §0 documents that
explicitly, and §39 answers the question in full. Treating 056's presence as evidence that
returns, fulfilment orders, the ledger or the outbox *work* would be exactly the
"structural verification mistaken for runtime proof" error this audit was asked to find.

**Verdict: B — ARCHITECTURE IS SOUND BUT HAS PRODUCTION GAPS** (§44).

---

## Overall Score

Mean **2.2 / 5** across 16 domains (35/16). Per-domain scores and reasoning are in
`DOMAIN_COMPARISON.md` §8.

| Strongest | Score | Weakest | Score |
|---|---|---|---|
| Webhook | 4 | Settlement | 0 |
| Security | 4 | Shipping / Returns / Events / Reconciliation | 1 |
| Checkout / Payment / Inventory / Refunds | 3 | Order / Fulfillment / Marketplace / Observability | 2 |

The distribution is the finding: **the transaction path scores 3–4 while the
post-purchase and money-movement paths score 0–2.** Velnox takes money correctly and
cannot yet account for it.

---

## P0 Gaps

### P0-1 — `orders.status` carries payment, order and fulfilment in one column

- **Domain:** Order
- **Type:** REAL DEFECT
- **Severity:** P0
- **Velnox evidence:**
  - DB constraint (`db/schema.sql`, `orders_status_check`): `CHECK (status IN ('pending','confirmed','packing','shipped','delivered','completed','cancelled','pending_payment','paid','payment_failed','refunded','expired'))`
  - 12 writer sites: `cart.ts:1501`, `center.ts:532`, `seller-orders.ts:627`, `stripe.ts:1011/1067/1266/1442/1489/1637/1643/2449`, `checkout-group-lifecycle.ts:168`
  - Concrete data loss: `stripe.ts:1637` and `:1643` write `UPDATE orders SET status = 'refunded'` for a full refund, **overwriting** a `shipped`/`delivered` value
  - `orders.order_state`, `orders.fulfillment_status` (056): **zero non-test references** (verified by search)
- **Benchmark evidence:** Shopify separates Order / FulfillmentOrder / Fulfillment and `Fulfillment` *"tracks which LineItem objects ship, their quantities, and the shipment's tracking information"* (`shopify.dev/docs/api/admin-graphql/latest/objects/Fulfillment`). Amazon separates Order, OrderItem and Fulfillment. Lazada's seller workflow separates the seller's fulfilment progress from the platform's payment state.
- **Difference:** three independent facts are stored in one field, so the DB validates the *set* of values and never the *legality of a move*. `paid → pending_payment` is accepted by the database.
- **Risk:** a refunded-then-inspected order cannot be shown to have shipped; a support agent cannot distinguish "paid, not yet picked" from "packing, unpaid"; every new writer is a new chance to overwrite another axis.
- **Recommendation:** write the axes that already exist. Add one `projectOrderStatus(orderState, fulfillmentStatus, paymentState)` function and make the 12 writers set the axes instead of `status`; keep `status` as a derived, DB-compatible projection so no frontend breaks. **No CHECK change, no column removal, no frontend change required.**
- **Confidence:** HIGH

### P0-2 — No seller payable, no platform ledger, no settlement (customer payment ≠ seller settlement is true only in the schema)

- **Domain:** Settlement / Marketplace
- **Type:** MISSING CAPABILITY
- **Severity:** P0
- **Velnox evidence:** `commissions` and `settlements` exist with **zero writers** (verified by search); `ledger_entries` (056) has the account vocabulary `platform_cash | platform_revenue | seller_payable | refund_clearing` and an append-only trigger (`trg_prevent_ledger_mutation`) and **zero writers**; three contradictory rates — `SELLER_COMMISSION_RATE = 0.03` (`lib/seller-stats.ts:7`, used at `routes/admin.ts:190`), `commissionRate: 0.03` (`routes/products.ts:2608`), `commissionRate: 0` (`routes/seller-orders.ts:249`), column default `0.05`
- **Benchmark evidence:** Lazada publishes payout/statement APIs (`/finance/payout/status/get`); Amazon SP-API exposes financial events and settlement periods (`developer-docs.amazon.com/sp-api/reference/listsummary`: *"the financial summary for the specified time period or settlement period"*); Shopify has payouts.
- **Difference:** the provider tells Velnox what the **customer** paid. Nothing records what the platform **owes the seller**.
- **Risk:** no auditable answer to "what do we owe this seller"; a refund after a payout has nowhere to be accounted; whichever of the four rates a future settlement writer happens to read determines whether sellers are paid correctly.
- **Recommendation:** before the first real seller payout (not before the first order): pick **one** rate as a named constant and delete the other three, write `ledger_entries` rows in the same transaction as settlement and refund, and derive the payable from the ledger rather than from a `SUM` over orders. Do **not** build a configurable rule engine — that is not the gap (§34, `ECOMMERCE_BENCHMARK.md` §7).
- **When required:** before any seller receives money. Until then it is a recorded liability, not a live defect.
- **Confidence:** HIGH

### P0-3 — No reconciliation of Velnox against any provider or against itself

- **Domain:** Reconciliation
- **Type:** MISSING CAPABILITY
- **Severity:** P0
- **Velnox evidence:** `reconciliation_runs` and `reconciliation_findings` (056) have `kind`, `severity`, a unique `fingerprint` per kind and `expected`/`observed` JSONB — **no runner, no reader, zero references** (verified by search). Every `reconcil` match in the codebase is an amount-reconciliation *comment*; `db/verify-reconciler.sh` is a **schema-shape** verifier and does not compare business data.
- **Benchmark evidence:** Amazon's settlement/report model is explicitly reconciliation-shaped; Shopify and Lazada both publish payout/statement surfaces whose purpose is to be compared against the platform's own record.
- **Difference:** Velnox has no way to ask "does my database agree with Stripe / with itself?"
- **Risk:** a webhook that is never delivered leaves `payments.status = 'pending'` permanently while the customer has paid. No job, alert or incident fires. The same silence covers a missed refund event, stock that drifted from its movement history, and a settlement that never booked.
- **Recommendation:** implement reconcilers in `reconciliation_runs` order of value: (1) **payment** — provider charges vs `payments` vs `orders`; (2) **refund** — `SUM(refunds) <= captured`; (3) **inventory** — counters vs `inventory_movements`; (4) **fulfilment**; (5) **ledger**. A reconciler **reports**; it never repairs business state. Add a scheduled trigger and a finding-severity alert.
- **Confidence:** HIGH

---

## P1 Gaps

### P1-1 — The seller's absolute stock-set can now be rejected by the database, and the route answers 500

- **Domain:** Inventory
- **Type:** REAL DEFECT — **introduced by migration 056**, and found by auditing this audit's own prior work
- **Severity:** P1
- **Velnox evidence:** `routes/products.ts:1487` — `INSERT INTO inventory (product_id, quantity, …) … ON CONFLICT (product_id) DO UPDATE SET quantity = $2` with `qty = Math.max(0, Number(quantity) || 0)` clamped **only at 0**. The new constraint `inventory_availability_check` is `CHECK (reserved + committed <= quantity)`. The route's `catch` (`:1498-1501`) returns `500 { code: "STOCK_FAILED" }`.
- **Why it is new:** before 056 the same update silently succeeded. It could set `quantity` to 0 while 3 units were **reserved by an in-flight checkout**, i.e. the shelf was oversold. The constraint now refuses — correctly — but nothing handles the refusal.
- **Risk:** a seller restocking or correcting stock during an active checkout gets an opaque 500. There is no message, no partial success, and no way to discover that the cause is an outstanding reservation. The seller concludes the product page is broken.
- **Recommendation:** catch `23514` on this route specifically and return the domain error the rest of the system already uses — `409 INVENTORY_UNAVAILABLE`-class with the reserved count — or clamp the write to `GREATEST($2, reserved + committed)` and report the adjustment. **Do not remove the constraint**; it is preventing real oversell. Same treatment for the variant path (`products.ts:2046`), which is currently **latent** only because variant `reserved`/`committed` are never written.
- **Confidence:** HIGH

### P1-2 — Shipment creation is the one non-idempotent write in the codebase

- **Domain:** Shipment
- **Type:** REAL DEFECT
- **Severity:** P1
- **Velnox evidence:** `backend/lib/order-fulfillment.ts:396` `ensureShipmentForShipping` — `SELECT … LIMIT 1` then `INSERT INTO shipments (order_id, carrier, tracking_number, status) VALUES ($1,$2,$3,'created')`. There is **no unique constraint on `shipments.order_id`** and no idempotency key. `shipment_items_shipment_item_unique` (056) constrains the items table, not the shipment.
- **Benchmark evidence:** Shopify's `Fulfillment` is a first-class object created deliberately; Amazon's Fulfillment Outbound submissions carry idempotency semantics; all three treat a shipment as a distinct, once-created artefact.
- **Difference:** every other money/stock/order write in Velnox is DB-keyed; this one is not.
- **Risk:** two concurrent "mark shipped" requests from the same seller produce **two shipment rows** for one order. An operator reading the shipping queue may book two parcels, and the tracking number shown depends on which row a query happens to pick.
- **Recommendation:** make it a single keyed statement — `INSERT … ON CONFLICT (order_id) DO UPDATE SET carrier = COALESCE(EXCLUDED.carrier, shipments.carrier), tracking_number = COALESCE(EXCLUDED.tracking_number, shipments.tracking_number)` — backed by a unique index on `shipments.order_id` while one shipment per order is the model, and a partial unique index later if split shipments arrive.
- **Confidence:** HIGH

### P1-3 — Shipment transit is unrepresentable at runtime

- **Domain:** Shipping
- **Type:** MISSING CAPABILITY
- **Severity:** P1
- **Velnox evidence:** `shipments.status` now has the 056 vocabulary `pending, created, picked_up, in_transit, out_for_delivery, delivered, returned, lost, cancelled` — but the **only** values ever written are `created` (`order-fulfillment.ts:438`) and a one-way `pending → created` migration (`:418`). `shipments.shipped_at` and `shipments.delivered_at` (056) have **no writer**.
- **Benchmark evidence:** all three benchmarks attach tracking and transit events to the shipment; Lazada's seller workflow exposes shipped/delivered as shipment facts.
- **Difference:** the vocabulary is a promise the code does not keep.
- **Risk:** "delivered" exists only as an `orders.status` value set by a human, with no evidence attached; a lost parcel and a delivered parcel look identical to the database; no delivery timestamp can be reported.
- **Recommendation:** a single shipment-status transition (carrier/tracking entry → `created`; operator or carrier webhook → the transit states) writing `shipped_at`/`delivered_at`. Carrier API integration is **out of scope** (§7) — operator-entered transit is sufficient and honest.
- **Confidence:** HIGH

### P1-4 — No return / RMA lifecycle

- **Domain:** Returns
- **Type:** MISSING CAPABILITY
- **Severity:** P1
- **Velnox evidence:** no route, no service. `order_returns` (056) declares `requested, approved, rejected, in_transit, received, restocked, completed, cancelled` with `requested_by`, `decided_by`, `received_at`, `restocked_quantity` — **zero references** (verified by search). Tests prove only that the TABLE refuses bad rows.
- **Benchmark evidence:** Lazada publishes reverse-order APIs; Shopify has a Returns API; Amazon exposes returns in SP-API.
- **Difference:** `cancel` and `refund` exist and are not returns.
- **Risk:** an operator refunds a returned item with no record that anything came back, who approved it, whether it was inspected, or whether it was restocked. Restocking is therefore manual and unauditable, and `inventory.returned` can never be correct.
- **Recommendation:** implement the declared lifecycle as a small state machine, and make the **restock** an explicit `return` movement rather than a side effect of the refund. Keep `order_returns` as the physical record and `refunds` as the money record — never merge them.
- **Confidence:** HIGH

### P1-5 — No fulfilment work unit: one order → one shipment, permanently

- **Domain:** Fulfillment
- **Type:** MISSING CAPABILITY
- **Severity:** P1
- **Velnox evidence:** `lib/order-fulfillment.ts` has a real 7-state machine (`pending, confirmed, packing, shipped, delivered, completed, cancelled`) with `FULFILLMENT_TRANSITIONS`, `paymentAllowsConfirmation` and `assertNoSettledPaymentForCancellation`. It is enforced **in code only** — no DB constraint — and its result is stored in the shared `orders.status`. `fulfillment_orders` (056) and `order_items.fulfilled_quantity` (056) have **zero references**.
- **Benchmark evidence:** Shopify's `FulfillmentOrder` is *"either an item or a group of items in an order that are to be fulfilled from the same location"* and `Fulfillment` *"tracks which LineItem objects ship, their quantities"*. Amazon splits Order / OrderItem / Fulfillment similarly.
- **Difference:** Velnox's machine models *an order* moving through stages; the benchmark models *work* that can be split, partially completed and repeated.
- **Risk:** a 5-item order shipped in 3 parcels cannot be expressed; a partial shipment cannot be recorded; "which lines have shipped?" is unanswerable, which in turn makes a partial refund harder to justify and a return impossible to scope.
- **Recommendation:** create one `fulfillment_orders` row per (order, location) inside the settlement transaction, hang `shipments` off it, and record per-line quantities in `shipment_items`. Do this **after** P0-1, because the fulfilment axis is what makes the work unit meaningful.
- **Confidence:** HIGH

---

## P2 Gaps

| ID | Domain | Finding | Type | Evidence | Recommendation | Confidence |
|---|---|---|---|---|---|---|
| **P2-1** | Observability | No correlation id anywhere; `correlation_id` columns (056) have no writer | MISSING CAPABILITY | Verified search: zero `correlationId`/`request_id` generation. The only ids are a client-supplied checkout `requestId` (`cart.ts:694`) and `provider_request_id` (`stripe.ts:482`) | Generate a request id at the edge, thread it through checkout → payment → webhook → fulfilment, and write it to the 056 columns. This is the fix for §27's "customer says they paid, seller sees no order" | HIGH |
| **P2-2** | Marketplace | Three commission rates contradict each other (0.03 / 0.03 / 0 / default 0.05) | REAL DEFECT | `lib/seller-stats.ts:7`, `routes/products.ts:2608`, `routes/seller-orders.ts:249`, column default | No money moves yet, so severity is P2 — it escalates to P0 the moment a settlement writer exists. Collapse to one named constant **before** P0-2 | HIGH |
| **P2-3** | Events | No durable event record; a lost realtime notification is undetectable | MISSING CAPABILITY | Broadcast happens after COMMIT inside `try{}catch{}` (`seller-orders.ts:657-666`); `outbox_events` unused; `cart:updated`/`order:created`/`inventory:updated` are allowlisted with **no publisher** | **§22 answer: the outbox is NOT required for correctness today.** Events are notifications; the DB is the source of truth and the client refetches, so eventual consistency is correct. It becomes required when an event carries a *business obligation* (a third-party webhook, a settlement trigger). Until then, the real gap is only that loss is invisible — log it | MEDIUM-HIGH |
| **P2-4** | Webhook | No retry budget, no dead-letter, no visibility into a repeatedly failing webhook | MISSING CAPABILITY | `payment_events` claim + 500-on-failure is correct, but `attempt_count` / `next_retry_at` / `last_error` (056) have no writer; retry is delegated entirely to Stripe | Add the retry bookkeeping and a visible failed backlog. Do **not** add a second delivery mechanism — the 500 is already right | HIGH |
| **P2-5** | Payment | No attempt layer; `authorized` and `expired` are unreachable | MISSING CAPABILITY | `payment_attempts` (056) has **zero references**; `payments` still stores attempt + session + result in one row | Write `payment_attempts` rows on session creation and update them from the webhook, so a timed-out session is a first-class recoverable record instead of an inference from timestamps | HIGH |
| **P2-6** | Inventory | No movement journal: "why is this number 3?" is unanswerable | MISSING CAPABILITY | `inventory_movements` (056) has **zero references** | Write one movement per counter mutation in the same transaction — reserve, release, commit, fulfil, return, adjust. This is what makes the inventory reconciler (P0-3) possible at all | HIGH |
| **P2-7** | Cancellation | Cancellation is race-safe but unrecorded: no reason, no actor, no partial cancellation | MISSING CAPABILITY | Cancellation is inline in the order lifecycle; no entity records it | Record the cancellation (actor, reason, timestamp) and support partial cancellation per line | MEDIUM |
| **P2-8** | Inventory | The six-quantity stock model is half-implemented | MISSING CAPABILITY | `inventory.committed/fulfilled/returned` and the same four variant counters (056) are never written; only `quantity`/`reserved` (product) and `stock` (variant) move | Write `committed` at settlement and `fulfilled` at shipment so "sold but not shipped" is distinguishable from "sold and shipped" | MEDIUM |

---

## P3 Gaps

| ID | Domain | Finding | Type | Recommendation | Confidence |
|---|---|---|---|---|---|
| **P3-1** | Settlement | `commissions` is a parallel authority to `ledger_entries` and will compete with it | FUTURE SCALE GAP | When P0-2 is built, decide deliberately which is the record of a fee. Two tables that can both answer "what was the fee" is a duplicate-authority risk, not a feature | MEDIUM |
| **P3-2** | Scalability | Correlated per-row subqueries on the seller order list | FUTURE SCALE GAP | `seller-orders.ts:197` (per-row primary image) and `:353` (latest shipment status). These are subqueries inside one statement, not N+1 round trips, and the list is paginated (cap 100). Unprofiled — **no performance claim is made**. Measure before changing | LOW-MEDIUM |
| **P3-3** | Inventory | Multi-location stock is not modelled | FUTURE SCALE GAP | **Not required today** (§34). One stock row per product/variant matches Velnox's seller model; revisit only if a real seller needs two stocking points | MEDIUM |
| **P3-4** | Notifications | No email or push sender | FUTURE SCALE GAP | Out of scope until a business requirement names a channel; the WebSocket path is sufficient for in-app awareness | HIGH |
| **P3-5** | Events | `center.ts` admin lists were not profiled for unbounded queries | FUTURE SCALE GAP | **Unverified, not a finding.** Recorded so a later pass does not mistake silence for cleanliness | LOW |

---

## Real Defects

A defect means **the current system is wrong** (§33).

1. **P0-1** `orders.status` holds three lifecycles; a full refund destroys the record that an order shipped.
2. **P1-1** The seller's absolute stock-set path can raise an unhandled `23514` → opaque `500 STOCK_FAILED`. Introduced by 056; the constraint is right, the handling is missing.
3. **P1-2** Shipment creation is `SELECT`-then-`INSERT`, uniquely among Velnox's writes.
4. **P2-2** Four contradictory commission rates in one codebase.

**That is the complete list.** Four defects, no more. Everything else this audit found is a missing capability or a future-scale gap, and the distinction is deliberate.

## Missing Capabilities

The system is not wrong; it lacks a thing. Nine, in severity order:
**P0-2** seller payable / ledger / settlement · **P0-3** reconciliation ·
**P1-3** shipment transit · **P1-4** returns · **P1-5** fulfilment work unit ·
**P2-1** correlation id · **P2-3** durable event record · **P2-4** webhook retry budget ·
**P2-5** payment attempts · **P2-6** inventory movements · **P2-7** cancellation record ·
**P2-8** committed/fulfilled counters.

## Future Scale Gaps

**P3-1** competing fee authorities · **P3-2** unprofiled list-query shape ·
**P3-3** multi-location stock · **P3-4** no external notification channel.

## False Positives / Not Applicable

Recorded so these are not "fixed" later (§34, §40):

| Item | Why it is not a gap |
|---|---|
| **Rate limiting** | **CORRECTION to this audit's own first draft.** `backend/middleware/rate-limit.ts`, wired at `server.ts:96`, implements per-route-class limits with documented justification (auth IP-keyed, money mutations user-keyed 10/min with idempotency as the primary guard, chat 30/min, uploads 20/min, public reads 300/min, 600/min per-IP catch-all), returning `429 RATE_LIMITED` with `Retry-After`, plus bucket sweeping and a `MAX_BUCKETS` guard against spoofed-key floods. |
| **CSRF** | **CORRECTION to this audit's own first draft.** `backend/middleware/origin-guard.ts`, wired at `server.ts:88`, defends state-changing requests by Origin allowlist — chosen over a double-submit cookie with the reasoning and the non-breakage analysis for OAuth, WebSocket, webhook and dev written out in the file. |
| Oversell through the guarded paths | The reservation is a single SQL predicate (`WHERE quantity - reserved >= $1`), so it is a real guarantee, not a test claim. |
| Duplicate charge | Webhook event claim + `checkout_requests` stored-response replay + provider authority. |
| Duplicate refund | `refunds.provider_refund_id` UNIQUE + totals **recomputed**, never incremented. |
| Float money | `NUMERIC(12,2)` throughout. |
| Multi-location inventory | Not required for Velnox's seller model (see §7 of the benchmark). |
| Carrier API booking | Already declared an operator action. |
| Microservice split | Would *remove* the single-transaction guarantee that currently prevents oversell. |
| Third-party developer API | No ecosystem exists; a product decision, not a gap. |

---

## Recommended Fix Order

Ordered by risk reduction → financial correctness → security → data integrity →
production reliability → customer impact → seller impact → scalability (§43).

| # | Action | Fixes | Why first |
|---|---|---|---|
| 1 | Handle `23514` on the seller stock path (return a domain error, or clamp and report) | P1-1 | A one-route change removes a live, seller-visible 500 introduced by 056. Cheapest risk reduction available. |
| 2 | Make shipment creation a single keyed statement + unique index | P1-2 | Closes the last non-idempotent write in the system; small, contained, prevents duplicate parcels. |
| 3 | Write `payment_attempts` from session creation and the webhook | P2-5 | Live sessions become recoverable records; prerequisite for trustworthy reconciliation. |
| 4 | Write `inventory_movements` on every counter mutation | P2-6 | Makes "why is this number 3?" answerable; prerequisite for the inventory reconciler. |
| 5 | Add a correlation id end-to-end and write the 056 columns | P2-1 | Turns "customer paid, seller sees nothing" from a manual SQL investigation into a trace. |
| 6 | Implement the payment + refund reconcilers (report only) | P0-3 | Detects silent money drift — the failure mode nothing currently notices. |
| 7 | Collapse the four commission rates to one constant | P2-2 | Trivial, and it must precede any settlement work. |
| 8 | Write the order axes and add `projectOrderStatus`; keep `status` as a derived projection | P0-1 | The largest integrity win in the list. Ordered after 3–6 because it touches 12 writers and should land with the reconcilers already available to verify it. |
| 9 | Build the ledger writer + one settlement period, deriving the seller payable from the ledger | P0-2, P0-1(for fees) | Completes the marketplace: customer payment finally becomes seller payment. |
| 10 | Shipment transit states + the return/RMA lifecycle | P1-3, P1-4, P1-5 | Post-purchase completeness. Deliberately last: it is the most product-shaped work and nothing above depends on it. |

Explicitly **not** recommended: any schema rewrite, any second payment or order system,
any removal of the constraints or checks added by 056, and any replacement of the rate
limiter, the Origin guard, the webhook verification, the idempotency claims or the schema
reconciler.

---

## Architecture Risks

1. **Two models, one runtime.** The schema now describes a three-axis order with a
   ledger, an outbox and reconcilers. The code uses none of it. Every day that gap stays
   open, a new writer is added against the *old* model — and each one makes step 8 above
   harder. This is the single largest architectural risk in the repository.
2. **`backend/routes/products.ts` is 3,895 lines and exceeds ~55 KB**, so this workspace's
   file tools cannot edit it in place; P1-1 lives in that file. Any change there must be
   scripted against unique anchors, which raises the cost and the risk of the fix.
3. **Money is mutated in `routes/stripe.ts` (3,034 lines) by a webhook handler** whose
   correctness rests on the claim table. It is correct today; it is also a large surface
   with no correlation id, so a failure is hard to reconstruct.
4. **`commissions` vs `ledger_entries`** will both be able to answer "what was the fee"
   (P3-1). Decide before, not after.

## Production Blockers

**BLOCKED — not PASS, not FAIL, not attempted.** Each names what would unblock it.

| Blocker | Would be unblocked by |
|---|---|
| **No real Stripe TEST-mode round trip.** No `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` (`freebuff-env list` → `{"files":{}}`), no browser, and Checkout is provider-hosted. Every payment, webhook, refund and idempotency claim in this system is proven at **DB/contract level only** | adding the three keys to the backend environment and registering `POST /api/payments/stripe/webhook` |
| **Migration 056 has never been applied to production.** No `NEON_PRODUCTION_DATABASE_URL`; GitHub App token returns 403 on secrets and workflow dispatch | making the canonical production URL available to the migration workflow, or pasting the migration into the Neon SQL Editor |
| **R2 file storage was not exercised in this pass** | credentials plus an upload round trip — recorded as unverified, not as working |
| **No browser executed any frontend.** All four apps typecheck and build (4/4, exit 0); none was run | a browser session, which also unblocks the checkout E2E |
| **No load test was run.** No query timing, no concurrency measurement beyond reading the SQL | a load harness against a disposable database |

**No production-readiness claim is made.** Per §42: unit tests are not a Stripe E2E, a
mock provider is not a production integration, and a green `db:verify` proves the schema
shape, not the business behaviour.

---

## §37 — FINAL GAP TABLE

| ID | Domain | Finding | Type | Severity | Evidence | Benchmark | Recommendation | Confidence |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Order | `orders.status` carries 3 lifecycles; refund overwrites the shipped record | REAL DEFECT | P0 | `orders_status_check` (12 values); 12 writers; `stripe.ts:1637/1643`; axes have 0 references | Shopify Order/FulfillmentOrder/Fulfillment; Amazon Order/OrderItem/Fulfillment | Write the axes; one `projectOrderStatus()`; keep `status` as a derived projection | HIGH |
| P0-2 | Settlement | No seller payable / ledger / settlement; 4 disagreeing fee rates | MISSING CAPABILITY | P0 | `commissions`/`settlements`/`ledger_entries` 0 writers; `seller-stats.ts:7`, `products.ts:2608`, `seller-orders.ts:249`, default 0.05 | Lazada payout APIs; Amazon financial events; Shopify payouts | One rate constant; ledger written in the settlement/refund transaction; payable derived from the ledger | HIGH |
| P0-3 | Reconciliation | Nothing compares Velnox to the provider or to itself | MISSING CAPABILITY | P0 | `reconciliation_*` 0 refs; every `reconcil` hit is a comment; `verify-reconciler.sh` is schema-only | Amazon report-based settlement; Shopify/Lazada payouts | Payment → refund → inventory → fulfilment → ledger reconcilers; report, never repair | HIGH |
| P1-1 | Inventory | Absolute stock-set can raise unhandled `23514` → `500 STOCK_FAILED` | REAL DEFECT (new in 056) | P1 | `products.ts:1487` clamps only at 0; `inventory_availability_check`; catch at `:1498` | — | Catch `23514`, return a domain error naming the reserved count, or clamp and report | HIGH |
| P1-2 | Shipment | Shipment creation is `SELECT`-then-`INSERT`; no unique constraint | REAL DEFECT | P1 | `order-fulfillment.ts:396` and `:438` | Shopify `Fulfillment`; Amazon Fulfillment Outbound | One keyed statement + unique index on `shipments.order_id` | HIGH |
| P1-3 | Shipping | Transit/delivery unreachable; timestamps never written | MISSING CAPABILITY | P1 | only `created` is written (`:418`, `:438`); `shipped_at`/`delivered_at` 0 refs | All three attach transit to the shipment | One shipment-status transition writing the timestamps; operator-entered is enough | HIGH |
| P1-4 | Returns | No return/RMA lifecycle at runtime | MISSING CAPABILITY | P1 | `order_returns` (056) 0 refs; no route | Lazada reverse-order; Shopify Returns; Amazon returns | Implement the declared lifecycle; restock as an explicit `return` movement | HIGH |
| P1-5 | Fulfillment | No work unit; one order → one shipment permanently | MISSING CAPABILITY | P1 | `fulfillment_orders`, `order_items.fulfilled_quantity` 0 refs; machine is code-only | Shopify `FulfillmentOrder`; Amazon split | One work unit per (order, location) inside settlement; `shipment_items` for lines | HIGH |
| P2-1 | Observability | No correlation id; cross-domain tracing impossible | MISSING CAPABILITY | P2 | `correlation_id` (056) 0 refs; only a client `requestId` (`cart.ts:694`) | Amazon request ids per operation | One request id threaded checkout → payment → webhook → fulfilment | HIGH |
| P2-2 | Marketplace | 4 contradictory commission rates | REAL DEFECT | P2 | `seller-stats.ts:7`, `products.ts:2608`, `seller-orders.ts:249`, default 0.05 | — | Collapse to one constant before settlement work | HIGH |
| P2-3 | Events | Lost realtime notification is undetectable | MISSING CAPABILITY | P2 | broadcast after COMMIT inside `try{}catch{}` (`seller-orders.ts:657-666`); `outbox_events` 0 refs; 3 topics with no publisher | Shopify/Amazon durable event records | **Not required today** — events are notifications. Log loss; adopt the outbox when an event carries an obligation | MEDIUM-HIGH |
| P2-4 | Webhook | No retry budget or dead-letter visibility | MISSING CAPABILITY | P2 | retry metadata (056) 0 refs; 500-on-failure is the only mechanism | Shopify delivery retries; Amazon retry policy | Write the retry bookkeeping; surface a failed backlog | HIGH |
| P2-5 | Payment | No attempt layer; `authorized`/`expired` unreachable | MISSING CAPABILITY | P2 | `payment_attempts` 0 refs; `payments` holds attempt+session+result | Shopify payment/attempt separation | Write attempts on session creation; update from the webhook | HIGH |
| P2-6 | Inventory | No movement journal | MISSING CAPABILITY | P2 | `inventory_movements` 0 refs | Auditability implied by all three | One movement per mutation, same transaction | HIGH |
| P2-7 | Cancellation | Race-safe but unrecorded; no reason, no partial cancel | MISSING CAPABILITY | P2 | inline cancellation; no entity | Shopify/Amazon cancel semantics | Record actor/reason/time; support per-line cancellation | MEDIUM |
| P2-8 | Inventory | Six-quantity model half-implemented | MISSING CAPABILITY | P2 | `committed`/`fulfilled`/`returned` (both axes) 0 refs | Shopify InventoryLevel semantics | Write `committed` at settlement, `fulfilled` at shipment | MEDIUM |
| P3-1 | Settlement | `commissions` competes with `ledger_entries` | FUTURE SCALE GAP | P3 | both can answer "what was the fee" | — | Decide authority before building P0-2 | MEDIUM |
| P3-2 | Scalability | Per-row correlated subqueries on the seller list | FUTURE SCALE GAP | P3 | `seller-orders.ts:197`, `:353`; list is paginated (cap 100) | Amazon token pagination | Unprofiled — measure before changing | LOW-MEDIUM |
| P3-3 | Inventory | Multi-location stock not modelled | FUTURE SCALE GAP | P3 | one stock row per product/variant | Shopify `InventoryLevel` per `Location` | Not required today; revisit on a real need | MEDIUM |
| P3-4 | Notifications | No email/push channel | FUTURE SCALE GAP | P3 | WebSocket only | — | Out of scope until a channel is required | HIGH |
| P3-5 | Scalability | `center.ts` admin lists unprofiled | FUTURE SCALE GAP | P3 | not examined in this pass | Amazon bounded lists | **Unverified, not a finding** | LOW |

---

## §38 — What can go wrong the day real customers arrive, with concurrency?

Answered from code, not assumption. **Both directions are reported**, because a
"not found" is as useful as a "found".

**Can go wrong:**

| Failure | Mechanism | Severity |
|---|---|---|
| **Shipment wrong** | two concurrent "mark shipped" → two `shipments` rows (P1-2) | P1 |
| **Order wrong** | a full refund overwrites a `shipped` order's status; the shipped fact is destroyed (P0-1) | P0 |
| **Money / two systems disagree, silently** | a webhook never delivered leaves `payments.status='pending'` while the customer has paid; no reconciler notices (P0-3) | P0 |
| **Seller sees a failure they cannot resolve** | restock during an active checkout → `23514` → `500 STOCK_FAILED` (P1-1) | P1 |
| **Customer/seller sees wrong status** | `orders.status` is the only authority and it is written from 12 sites, each of which can overwrite another axis (P0-1) | P0 |
| **Sellers paid wrong** | when settlement is built, one of four contradictory rates decides it (P0-2, P2-2) | P0 on implementation |
| **Seller never learns of an order** | a crash between COMMIT and broadcast loses the notification, and nothing records that it was owed (P2-3) | P2 |
| **Stock shown as available is not** | because the seller's correction failed with a 500, the page keeps displaying the pre-edit number (P1-1) | P1 |

**Cannot go wrong — verified, and worth stating plainly:**

- **Oversell through the reservation paths.** `reserveInventoryStock` is one statement
  with the availability test in its `WHERE` clause, so PostgreSQL's row lock serialises
  competing checkouts. The variant path is the same shape. This is a real guarantee, not
  a test claim.
- **Duplicate charge.** The webhook event id is claimed, checkout carries a stored-response
  idempotency key, and the provider is the authority for settlement.
- **Duplicate refund.** `provider_refund_id` is unique and the refunded total is
  **recomputed** from `SUM(refunds.amount)`, so a replayed webhook cannot double-count.
  `total_refunded <= total_captured` is now a DB CHECK.
- **Cross-shop order visibility.** Seller routes resolve the seller from the session and
  scope by `shops.seller_id`; `verifyProductOwnership` guards product mutations. No
  cross-seller leak was found in this pass.
- **Stock going negative through a decrement.** Every variant decrement is guarded
  (`cart.ts:1003`, `velrepeat-cycles.ts:602`, `velrepeat-scheduler.ts:328`) and the new
  non-negativity CHECK now backstops it in the database.

---

## §39 — What *looks* production-ready but is only structural or test-verified?

This is the most important honesty section in the report, and it describes work done
in this repository as well as pre-existing code.

| Surface | Appears | Actually |
|---|---|---|
| **All nine migration-056 tables** (`payment_attempts`, `fulfillment_orders`, `shipment_items`, `inventory_movements`, `ledger_entries`, `order_returns`, `outbox_events`, `reconciliation_runs`, `reconciliation_findings`) | present, constrained, tested | **Structure only.** Verified by search: **zero non-test references**. `commerce-core-invariants.test.ts` (23 cases) proves the *database refuses bad rows*; it proves nothing about any workflow. |
| **`orders.order_state` / `fulfillment_status`, `inventory.committed`, `order_items.fulfilled_quantity`, `correlation_id`** | declared with vocabularies and CHECKs | **Unwritten and unread.** Zero non-test references. |
| **`shipments.status` transit vocabulary** | a 9-value lifecycle | Only `created` is ever written; `shipped_at`/`delivered_at` never set. |
| **`payments.status` `authorized`/`expired`** | in the constraint | No writer. (`refunded`/`partially_refunded` do appear, but on `payments.refund_status`, a different column.) |
| **Stripe integration** | a 3,034-line verified webhook, refunds, incidents | Every test is DB/contract-level against locally constructed payloads. **No live TEST-mode round trip** — no keys. BLOCKED. |
| **Webhook authenticity** | raw-body HMAC + `constructEventAsync` + claim table | Proven against a locally signed payload. **No real Stripe delivery has ever been processed here.** |
| **Realtime** | broadcast call sites, an allowlist, tests | Delivery has **never been observed**; failures are swallowed. |
| **Neon production** | a migration and a reconciler | The migration has **never been applied to production**; the production database is unreachable from this workspace. |
| **R2** | upload routes and intent endpoints | **Not exercised in this pass.** Unverified, not working. |
| **Authentication** | JWT issuance/verification tested | **No browser session was ever minted.** |
| **Checkout** | proven at DB level, multi-shop cases pass | Never run end to end from a browser through the provider-hosted page. |
| **Inventory concurrency** | — | **This one IS a real guarantee** (see §38). It rests on a SQL predicate, not on a test. |
| **`db:verify` (51 PASS)** | a green reconciler proof | Proves the **schema shape**, not business data. It is not a data reconciler. |

---

## §40 — What Velnox does better than a naive implementation, and must not be dismantled

Ranked by how much would be lost by "simplifying" it.

1. **Provider-authoritative payment with a verified raw body.** Signature checked over the
   unparsed `Buffer` (`stripe.ts:2541`, `:2528`) before anything is parsed, and a
   processing failure returns **500** so the provider retries instead of the event being
   silently dropped. A naive version parses first, returns 200, and loses money events.
2. **Refund totals are recomputed, never incremented.** `SUM(refunds.amount)` on every
   sync means a replayed webhook is arithmetically incapable of double-counting. This is
   strictly stronger than the common `refunded_amount = refunded_amount + x`.
3. **`checkout_requests` stores the response and replays it.** A duplicate checkout
   returns the *original* purchase rather than a second one — stronger than a bare
   "already exists" guard.
4. **`orders.inventory_released` exactly-once claim.** Stock release is claimed in the
   database, so a cancelled order cannot return its stock twice.
5. **Guarded atomic stock reservation.** One statement, predicate in the `WHERE` clause.
   The oversell race is closed by the database, not by application sequencing.
6. **`lib/order-lock.ts` one-lock-order contract.** All per-order mutations go through a
   single lock path, which is why the money paths do not interleave badly.
7. **A rerunnable, self-asserting schema reconciler** (`db/run-sqleditor.sql`) with a
   **PART 8 assertion that fails the run** rather than only printing, plus
   `db/verify-reconciler.sh` — a harness that builds the *reported production shapes*,
   proves the reconciler converges, proves `search_path` cannot redirect it, and proves
   the assertion is **not vacuous** (it drops a column, retypes it, and checks PART 8
   catches it). Very few codebases test their migration tooling this way.
8. **Contract tests that pin the two canonical files against each other** — every declared
   column must have its `ADD COLUMN` pass, every index must come after the column pass, no
   `ADD CONSTRAINT` may be unguarded, the file may not contain `DROP TABLE`/`DROP COLUMN`/
   `TRUNCATE`/`DELETE`/`EXCEPTION WHEN`. These tests **caught two real defects during this
   session's own work**; they are the reason the mirror was fixed properly instead of
   shipped.
9. **`backend/db/test-database.ts` refuses to run against production**, fail-closed, with
   no fallback path — and `test-database-isolation.test.ts` proves it refuses.
10. **Route-class rate limiting with written justification** (`middleware/rate-limit.ts`),
    returning `429` with `Retry-After`, sweeping buckets and guarding `MAX_BUCKETS`
    against spoofed-key floods.
11. **Origin-guard CSRF defense** (`middleware/origin-guard.ts`) chosen and *argued* for
    this cross-site architecture, with the non-breakage analysis written down.
12. **Provider idempotency derived deterministically** for operator refunds
    (`velnox-refund-${payment.id}-${alreadyRefundedMinor}-${requestedMinor}`), with
    `requestedMinor > 0` and `<= refundableMinor` validated first.
13. **`NUMERIC(12,2)` everywhere** with the string-handling rationale documented in
    `lib/money.ts`.
14. **2,035 passing tests** including a multi-shop purchase test suite that asserts against
    **the production query constants themselves**, so a drift between test and production
    is impossible.
15. **Checkout revalidates the price per item and reassigns it in place.**
    `cart.ts:843-847` and `:861-865` re-read `product_variants.price` /
    `products.price`, compare against the cart snapshot with a 0.005 tolerance, and
    overwrite `item.price` before the order lines are written — so the charged amount is
    always the current server price, and `priceChanged` is surfaced so neither side is
    silently surprised. The add-to-cart price is a display snapshot, never the price
    charged. Most implementations trust the cart row here.

**Recommendation for all fifteen: leave them alone.** Keeping them is what makes the
incremental path in "Recommended Fix Order" safe. Replacing any of them would be a
regression, not a modernization.

---

## §44 — Final decision

# **B — ARCHITECTURE IS SOUND BUT HAS PRODUCTION GAPS**

**Why not A.** Three P0 gaps are open: a lifecycle-carrying status column that can
destroy a recorded fact, a marketplace money side that does not exist at runtime, and no
reconciliation at all. Calling that "sound with no gaps" would be false.

**Why not C.** The test for C is that the current architecture *cannot be fixed by
incremental migration*. Every P0 fails that test:

- **P0-1** needs a projection function and updated writers. Migration 056 already added the
  destination columns with vocabularies and CHECKs; the `orders.status` CHECK is unchanged,
  so nothing downstream breaks while the writers move. This is additive by construction.
- **P0-2** needs a writer for a table that already exists with its ledger accounts and its
  append-only trigger already enforced.
- **P0-3** needs a reader for tables that already exist with their fingerprint uniqueness,
  severity vocabulary and `expected`/`observed` shapes already declared.

Not one of them requires a new database, a new service, a rewritten payment path, or a
second order system. And the incremental path is not theoretical: migration 056 took a
pre-056 database from `66|244|258|653` to `75|296|339|807` and landed **definitionally
identical** to a fresh bootstrap — an empty diff across 807 columns, 339 constraints, 296
indexes and both triggers, rerun-stable. That is a demonstrated, reversible, additive
migration capability, which is the exact evidence C would require to be ruled out.

**Direction, in the brief's terms.** Velnox should not become Lazada. It should keep its
provider-authoritative payment correctness and its database-enforced invariants, add
**Shopify-like separation** of the order, the fulfilment work unit and the shipment, add
**Amazon-like financial events and reconciliation**, and add the **Lazada-like
separation of customer payment from seller settlement** — each only where this report's
§33 classification says a real gap exists, and each without touching the fourteen items
in §40.

---

## What this audit did NOT do

- No code, schema, migration, dependency or configuration was modified (§41). Only
  `.ai/audit/*.md` was created.
- No live provider, browser, production database or load test was used; those are
  BLOCKED above, and no claim rests on them.
- No secret scanning was performed; no leaked-secret finding is made.
- `center.ts` admin lists and R2 were not exercised and are recorded as **unverified**,
  not as clean.
