# PHASE 3 — Shipment Lifecycle (`P1-3`)

**Status:** PASS (with two BLOCKED items listed at the end — production-database
verification and real Stripe E2E, neither of which this phase can run from here)

**Starting HEAD:** `6e24bd546e37e4db65a578cf90bdc9f407c0cd24` (Phase 2 — shipment
canonical uniqueness; `git rev-parse HEAD` == `git rev-parse origin/main` at start)

**Final HEAD (implementation commit):** `b9824fec170926af6cbc7e03890b61d361a58adc`
— `feat(shipping): implement shipment lifecycle transitions`. The tip of `main`
after this record lands is the `docs(ai)` commit immediately following it
(`git log -1 --format=%H`); both commits are pushed to `main` in the same pass,
and `origin/main` was re-read after the push to confirm the SHA.

**Scope discipline:** Phase 3 ONLY. No returns/RMA, no settlement, no commission,
no ledger, no reconciliation, no payment/checkout/inventory change, no frontend
change, no new schema definition, no second state machine, no Phase-4 work
(`fulfillment_orders`, `shipment_items`) — all explicitly out of scope and left
untouched. §"Follow-up (NOT done)" lists what was seen and deliberately NOT fixed.

---

## 1. What was missing (the gap, restated from the source)

`.ai/audit/FINAL_GAP_REPORT.md` P1-3: *"`shipments.status` now has the 056
vocabulary … but the **only** values ever written are `created`
(`order-fulfillment.ts:438`) and a one-way `pending → created` migration
(`:418`). `shipments.shipped_at` and `shipments.delivered_at` (056) have **no
writer**."* Recommendation in the same entry: *"a single shipment-status
transition (carrier/tracking entry → `created`; operator or carrier webhook → the
transit states) writing `shipped_at`/`delivered_at`. Carrier API integration is
out of scope — operator-entered transit is sufficient and honest."*

That is exactly what was built. No carrier API integration was added.

## 2. The shipment state machine (derived, not invented)

The vocabulary was read off the database, not chosen:

```
shipments_status_check
  CHECK (status IN ('pending','created','picked_up','in_transit',
                    'out_for_delivery','delivered','returned','lost','cancelled'))
```

Declared identically by `db/migrations/056_commerce_core_invariants.sql`,
`db/schema.sql` and `db/run-sqleditor.sql`; the runner proves the three-way
agreement (`backend/tests/shipment-lifecycle.test.ts`, §1). An earlier draft of
this phase used an invented vocabulary (`packed`, `ready_to_ship`, `shipped`);
it was **withdrawn before commit** because a write of any of those values would
have been refused by `23514` — the machine now names only values the database
accepts.

```
pending ─> created ─> picked_up ─> in_transit ─> out_for_delivery ─> delivered   (terminal)
   │           │           │            │                │
   └───────────┴───────────┴────────────┴────────────────┴─> cancelled (terminal)
   └───────────┴───────────┴────────────┴────────────────┴─> lost      (terminal)
returned — terminal, and unreachable from this machine (the returns/RMA flow owns it)
```

Words: `pending`/`created` are the two legacy spellings that already existed
(`created` is what `ensureShipmentForShipping()` writes). `picked_up` is the
first physical handoff — the moment `shipped_at` is stamped. `returned`, `lost`
and `cancelled` are terminal; nothing may leave a terminal state.

**Valid transitions** (each also terminating at `cancelled`/`lost`):
`pending→created` · `created→picked_up` · `picked_up→in_transit` ·
`in_transit→out_for_delivery` · `out_for_delivery→delivered`.

**Rejected transitions** (`409 INVALID_SHIPMENT_TRANSITION`, or an idempotent
success when the target IS the current status):

- every BACKWARD move: `delivered→created`, `in_transit→picked_up`, `created→pending`, …
- every forward SKIP: `created→in_transit`, `created→delivered`, `pending→picked_up`, `picked_up→delivered`
- every move out of a terminal state: `delivered→anything`, `cancelled→anything`, `lost→anything`, `returned→anything`
- any move INTO `returned` (from every status) — the returns flow's value
- any transition on an order that has no shipment row: `404 SHIPMENT_NOT_FOUND`
  (only `created` may bring the row into existence)

## 3. Idempotency

A call whose target equals the shipment's current status is a **SUCCESS and a
write-free no-op**: the row is returned unchanged (`moved: false`), no timestamp
is re-stamped, no carrier/tracking is touched, and the order axis is not advanced
a second time. The transition table deliberately has **no self-edges**, so a
repeat can never be mistaken for a state change; the helper therefore checks
equality *before* consulting the table.

The surrounding write is additive SQL (`COALESCE`), so even a genuine move can
never blank a field: `carrier = COALESCE(NULLIF(carrier,''), $n)`,
`tracking_number = COALESCE(tracking_number, $n)`,
`shipped_at = COALESCE(shipped_at, $n)`, `delivered_at = COALESCE(delivered_at, $n)`.

**Evidence:** `Test 1` (repeat of `created`), `Test 3` (repeat of `delivered`
after a real delivery), `Test 11` (repeat over HTTP returns `200 moved:false`),
`Test 9` (7 of 8 concurrent callers answered as the idempotent repeat).

## 4. Concurrency strategy and result

Strategy, in this order:

1. **The order row is the serialisation point.** `transitionShipment()` takes
   `lockOrderRow()` (`backend/lib/order-lock.ts`) as its FIRST statement, exactly
   like every other multi-row order writer. A loser waits, then re-reads the
   COMMITTED row and is judged against the state the winner produced.
2. **The UPDATE is a conditional claim**, not a read-then-write:
   `… WHERE id = $n AND status = $current RETURNING …`. If it matches 0 rows the
   answer is `409 SHIPMENT_CONCURRENT_MODIFICATION` and nothing is written.
3. **The order-axis advance is also conditional** (`WHERE id = $1 AND status = $2`),
   so a second writer cannot clobber the projection.

**Result: PASS — proven against a real PostgreSQL 14 with real pool
connections, not in memory.** `Test 9`: 8 concurrent `created→picked_up`
transitions on one order → exactly ONE `moved: true`, exactly ONE
`orderAdvanced: true`, exactly one shipment row, `shipped_at` stamped once,
carrier/tracking intact, final status `picked_up`. `Test 10`: a race whose
members cannot all be legal (`picked_up`/`delivered` ×2 from `created`) → the
forward skip is refused in every interleaving (`409 INVALID_SHIPMENT_TRANSITION`,
never a transport error), one real move, one order-axis advance. `Test 10b`: a
burst of individually-legal moves settles on one state the machine can hold and
the order's axes still project to `orders.status`.

## 5. Authorization

| Surface | Gate | Evidence |
|---|---|---|
| `PATCH /api/seller/orders/:id/shipment` | `requireAuth` → approved seller (`sellers.status` approved/active) else `403 FORBIDDEN`; then **ownership** — an `order_items` row of the order whose `shop_id` belongs to this seller — checked **under the order row lock**; failure is `404 NOT_FOUND`, so another seller cannot even confirm the order exists | `Test 11` (owner succeeds through the whole chain), `Test 12` (other seller → 404 and zero rows written; an account with no seller row → 403 before any read) |
| `PATCH /api/admin/orders/:orderId/shipment` | `isCenterMember` (owner/admin/staff) else `403`, AND the explicit `orders.manage` grant else `403` — the same two gates as `PATCH /api/admin/orders/:orderId/status` | `Test 13` (owner ⇒ allowed, `400 VALIDATION_ERROR` on a bad status, `409 INVALID_SHIPMENT_TRANSITION` on a skip, `orderAdvanced: true` on the handoff), `Test 12` (non-member → 403) |

No shipment id is ever accepted from the client: the helper resolves the order's
canonical shipment itself, so there is no identifier to manipulate (IDOR is
structurally impossible, not merely un-tried). A customer account reaches neither
route (it is not an approved seller and not a center member — both gates are
checked before any read).

## 6. Timestamps

- `picked_up` (the handoff) stamps **`shipments.shipped_at`**.
- `delivered` stamps **`shipments.delivered_at`**.
- Both are `COALESCE`d, so **a retry never overwrites** a stamp; later
  transitions never move an earlier stamp.
- Both columns already existed (migration 056 / `schema.sql:1528-1529` /
  `run-sqleditor.sql:3198-3200`) — **no schema change was needed, so no
  migration was written.**
- There is deliberately no `packed_at`/`ready_to_ship_at`: those columns do **not**
  exist, and a variable in the contracts test fails the suite if the helper ever
  references a `shipments` column absent from `db/schema.sql`.
- **The repo convention for time is `TIMESTAMPTZ` + `NOW()`** (server time, no
  local timezone arithmetic) and the writes above use it; nothing converts to or
  parses a local zone.

## 7. Tracking / carrier

- The handoff (`picked_up`) is refused with `400 SHIPMENT_REQUIRED` unless a
  carrier AND a tracking number are present — either already stored on the row,
  or supplied in that same request (so a legacy row can be completed in one
  call). Same code, same status as the order-status route's own gate.
- No transition can clear or overwrite either value (additive SQL), and a later
  request that supplies a *different* pair is ignored: the stored pair wins.
- The carrier/tracking are **not** re-validated against a carrier list, because
  the repository has none and inventing one would be a new system.

## 8. Order-fulfilment integration (no duplicate machine)

The parcel is the authority for the parcel; the ORDER is the authority for
fulfilment. The mapping is read off the source, not assumed 1:1:

| shipment → | order fulfilment target | why |
|---|---|---|
| `pending`, `created` | *(none)* | "a row exists" is not a fulfilment fact; the order-status routes already move the order to `shipped` when they create the parcel |
| `picked_up`, `in_transit`, `out_for_delivery` | `shipped` | `FULFILLMENT_STATUSES.shipped` is *defined* as "a real shipment row with a carrier + tracking exists" |
| `delivered` | `delivered` | `FULFILLMENT_STATUSES.delivered` is *defined* as "the shipment arrived" |
| `cancelled`, `lost`, `returned` | *(none)* | operator/carrier facts about the PARCEL; mapping them would silently cancel a fulfilment decision that belongs to the order routes and their payment gates |

The advance goes through the ONE authority: `advanceOrderFulfillmentAxis()`
(`backend/lib/order-state.ts`) decides with `canTransitionFulfillment()` and
`normalizeOrderStatusToFulfillment()` from `backend/lib/order-fulfillment.ts` and
records with the module's own projection (`axesForFulfillmentStatus()` +
`projectOrderStatus()`), reading the payment axis from the covering set under the
order lock. `orders.status` is still the derived projection — the shipment code
never writes it directly (a contracts test asserts zero `UPDATE orders` statements
in the shipment library).

**Divergence is refused, not tolerated:** if the order is behind and the machine
has no edge (e.g. the order is still `confirmed`, or it was `cancelled`), the
parcel move fails `409 ORDER_NOT_READY` and the whole transaction rolls back —
so the parcel cannot be advanced past the order, and the order-status route's
payment/fulfilment gates cannot be bypassed through this endpoint. If the order is
already AT or PAST the target, the advance is a silent success (`moved: false`).
The same is true in reverse for the phase-2 invariant: a shipment move never
creates a second shipment row.

**Evidence:** `Test 6` (order advances `packing → shipped` on the handoff and
`shipped → delivered` on the arrival; the intermediate hops advance nothing; the
legacy column still equals the projection of the axes), `Test 7` (order at
`confirmed` → `409 ORDER_NOT_READY` **and the shipment row did not move either**;
after the order reaches `packing` the same move succeeds), `Test 8` (a cancelled
order is not resurrected).

## 9. Database / migration

**No migration was required and none was written.** Every column, CHECK
constraint and index this phase uses already exists in all three copies:

- `shipments.shipped_at`, `shipments.delivered_at` — 056 (`db/migrations/056_commerce_core_invariants.sql:341-342`), `db/schema.sql:1528-1529`, `db/run-sqleditor.sql:3198-3200`.
- `shipments_status_check` — 056, `db/schema.sql:1688`, `db/run-sqleditor.sql:4890`.
- `shipments_order_id_unique` (Phase 2, `UNIQUE(order_id)`) — `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/057_shipment_canonical_unique.sql`.

Consequently there is no migration/schema drift to introduce, and the additive-only
rule was not tested because there was nothing additive to add. `db/run-update.sql`
was **not** created and not referenced (the repo deprecates it).

Drift checks run: `backend/tests/schema-drift.test.ts`,
`backend/tests/db-run-sqleditor-reconciler.test.ts`,
`backend/tests/migration-numbering.test.ts`, the new vocabulary three-way
agreement test, and `bash db/verify-reconciler.sh` → **RECONCILER PROOF: ALL
SCENARIOS PASSED (exit 0)**.

**Live-database verification (local disposable PostgreSQL 14, `velnox_test`, built
by running `db/run-sqleditor.sql`):** `shipments_status_check` present with the
nine statuses · `shipments_order_id_unique` present · 0 shipments rows · 0
duplicate `order_id` groups · timestamp columns present = `shipped_at`,
`delivered_at`. **Production/staging verification: BLOCKED — no production
database access from this workspace** (the sandbox has no `DATABASE_URL`; the
test-database guard refuses anything that looks like production by design).

## 10. Tests added

`backend/tests/shipment-lifecycle.test.ts` — **27 cases**, three groups:

- **Vocabulary / machine (no DB, always run, 13 cases):** the three SQL copies
  declare the SAME nine statuses; the machine's vocabulary is that list and
  nothing else; terminal ⇔ no outgoing edge; every forward step valid and its
  reverse invalid; forward skips refused; terminal protection; a repeat is not a
  machine edge; `cancelled`/`lost` reachable pre-delivery; `returned` unreachable.
- **Contracts (no DB, always run):** both routes import the ONE helper and run no
  shipment SQL of their own; the helper writes no `orders.status` and goes through
  the axis authority; it reuses the ONE creation path (no second insert, Phase-2
  unique index still declared); every `shipments` column the helper touches exists
  in the canonical schema (scraped from its own source).
- **Real database (skipped without `TEST_DATABASE_URL`, 14 cases):** creation
  through the existing writer + repeat; the full chain with timestamps and tracking
  preservation; tracking/carrier cannot be overwritten; the handoff gate; invalid,
  backward and terminal refusals; order integration (`packing→shipped`,
  `shipped→delivered`, refusal at `confirmed`, cancelled order); **two real
  concurrency races** (8 handoffs; a can't-all-be-legal race); and the two routes
  driven over HTTP with real session cookies (owner, other seller, customer,
  operator without/with `orders.manage`).

## 11. Verification actually run (this workspace, this pass)

| Check | Command | Result |
|---|---|---|
| Backend typecheck | `bun run --cwd backend typecheck` | **exit 0** |
| Frontend typechecks (all four apps) | `bun run typecheck` | **exit 0** (velshop, velseller, velcenter, velnox) |
| Targeted Phase-3 suite | `TEST_DATABASE_URL=… bun test backend/tests/shipment-lifecycle.test.ts` | **27 pass / 0 fail / 0 skip** (246 assertions) |
| Phase-1/2 + regression files | included in the full run: `order-fulfillment-state-machine`, `shipment-idempotency`, `order-state-projection`, `commerce-core-invariants`, `order-status-contract`, `customer-order-cancel`, `payment-*`, `checkout-*`, `inventory-*`, `seller-orders`, `seller-center-apis`, `schema-drift`, `migration-numbering`, `db-run-sqleditor-reconciler`, `db-identity` | all pass |
| Full suite | `TEST_DATABASE_URL=… bun test backend/tests` | **2103 pass / 2 skip / 0 fail** across 73 files (18139 assertions), 17s |
| Reconciler proof | `TEST_DATABASE_URL=… bash db/verify-reconciler.sh` | **ALL SCENARIOS PASSED, exit 0** |
| Whitespace | `git diff --check` | clean |
| Changed-file review | `git diff --numstat` | 4 files changed (115/1, 7/0, 94/0, 97/1) + 3 new files; **no deletions beyond the two import lines replaced** |

The 2 skips are pre-existing and unrelated (`upload confirm authz over HTTP` —
needs object-storage credentials).

## 12. Protected systems (unchanged by this pass)

- **Payment untouched** — no file under `backend/lib/payment-*`, `backend/routes/stripe.ts`, or the webhook path was modified.
- **Checkout untouched** — no `backend/routes/cart.ts`, `checkout-group-*`, or checkout SQL change.
- **Inventory untouched** — `backend/lib/inventory.ts` and `releaseOrderInventory` callers unchanged.
- **Phase-1 order-state authority preserved** — `backend/lib/order-state.ts` gained a writer that USES `axesForFulfillmentStatus`/`projectOrderStatus`; no vocabulary, no projection rule and no transition table was changed (verified by reading the diff: 115 inserted lines, 1 replaced import).
- **Phase-2 shipment uniqueness preserved** — `shipments_order_id_unique` still declared in all three SQL copies and present in the live database; `ensureShipmentForShipping` is still the only shipment insert and the helper creates no second row.
- **Existing fulfilment machine preserved** — no edit to `FULFILLMENT_TRANSITIONS`; the shipment path only READS it.

## 13. Changed files

```
backend/lib/order-shipment-states.ts      (new) the canonical shipment machine
backend/lib/order-shipment.ts             (new) the ONE transition helper
backend/lib/order-state.ts                (M)   + advanceOrderFulfillmentAxis() (the canonical axis writer)
backend/routes/seller-orders.ts           (M)   + PATCH /api/seller/orders/:id/shipment
backend/routes/center.ts                  (M)   + PATCH /api/admin/orders/:orderId/shipment
backend/realtime/index.ts                 (M)   + CHANNELS.SHIPMENT_UPDATED
backend/tests/shipment-lifecycle.test.ts  (new) 27 cases
.ai/audit/PHASE_3_SHIPMENT_LIFECYCLE.md   (new) this record
.ai/AI_HANDOFF.md                         (M)   §74
```

`tmp/` (two scratch notes from this pass) was deleted; no other file was touched.
`db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/**` and every frontend
file are **unmodified**.

## 14. Known limitations / risks (observed, not hypothetical)

1. **Carrier events are human-entered.** There is no carrier API integration —
   deliberate, and explicitly out of scope per P1-3's own recommendation. A wrong
   operator entry is a wrong row; nothing validates it against a carrier.
2. **No `packed`/`ready_to_ship` step.** The vocabulary has no such value and no
   such column; the warehouse-packing step is represented by the ORDER's
   `packing` status, not by the parcel.
3. **`returned` is not producible.** The value exists in the database and in the
   machine's vocabulary but has no incoming edge, because the returns/RMA flow
   (P1-4) is out of scope. A parcel that comes back therefore ends as `lost` /
   `cancelled` / `delivered` until P1-4 lands.
4. **One parcel per order is still the model** (Phase-2 invariant). A split
   shipment cannot be expressed; that is P1-5 (`fulfillment_orders` /
   `shipment_items`) and was deliberately not started.
5. **The two order-status routes still contain their own copy of the
   axes-then-projection sequence** (they predate this phase). A THIRD copy was not
   added — the shipment path calls the shared writer — but consolidating those two
   is a worthwhile follow-up, not done here to avoid changing behaviour the
   order-state and fulfilment suites pin.
6. **Concurrency is proven on a local PostgreSQL 14, not on Neon.** Neon's
   transaction semantics are PostgreSQL's, and the row lock + conditional UPDATE
   are plain READ COMMITTED semantics, but this phase did not race requests
   against the production provider.
7. **The endpoints have no frontend consumer yet.** The four apps contain zero
   shipment-status literals, so nothing broke; wiring a seller/center shipping
   panel is UI work that this phase (backend-scoped by its own brief) did not do.

## 15. Follow-up (NOT done — recorded only)

- **P1-4** returns/RMA (`order_returns` has zero references) — gives `returned`
  its writer and its edge.
- **P1-5** fulfilment work units (`fulfillment_orders`, `order_items.fulfilled_quantity`)
  — the Phase 4 that must NOT be implemented in this pass.
- Consolidate the two order-status routes onto `advanceOrderFulfillmentAxis()`.
- **BLOCKED (owner action):** production database verification (no credentials
  here) and real Stripe TEST end-to-end (no keys) — unchanged from Phase 1/2.
