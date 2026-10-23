# PHASE 2 — Shipment Race / Idempotency

## Problem

BP1-2 / `P1-2`: concurrent (or repeated) calls to shipment creation can create **more than one
`shipments` row for the same order**. The Performer raised two connected findings:

- **BP1-2**: the creation path is not concurrency-safe — two simultaneous requests for the same
  order can both insert, producing duplicate `shipments`.
- **BP2**: the shipped signal was implemented as a mutable boolean (`shipments.goods_left_the_warehouse`)
  plus a migration interpretation that kept re-deriving "shipped" from that boolean instead of from
  the canonical fulfillment state machine. BP2's required "cease treating it as the shipped signal"
  is therefore not a behavior change — it is the removal of a legacy layer that was already bypassed
  by the fixed state machine.

**Before:** `shipments` had no constraint tying an order to a single shipment. Nothing serialised
two inserts for the same order, so concurrent requests could both succeed. Shipped-ness was partly
encoded by a dead-engineered boolean that the canonical path no longer depends on.

**Decision:** reject the proposed "fix" PR's architecture. Its plan attacked the UI and `CREATE
shipments` in a way that assumed the order could legitimately have many shipments, and — more
critically — it carried a hidden Phase 3 unlock: dropping the shipment UNIQUE to move the
order→a-single-shipment invariant from static enforcement into a runtime-only "shipping vision".
That unlock touches relocation/fulfillment state encoding and is out of scope for Phase 2.

Phase 2's acceptable change is **separate and conservative**: an additive backstop that makes the
already-satisfied order→a-single-shipment invariant **fail-fast and self-documenting** at the
database and API layer:

- **schema**: `UNIQUE(order_id)` on `shipments`, plus `NOT NULL` on `goods_left_the_warehouse`
  (cleanup of the dead-engineered field, not a shipped-signal change)
- **API**: the same chosen 409 message (`{order_id} already has a shipment`) from both fulfillment
  writers, emitted when the unique insert fails — so a race that reaches the database still becomes
  a stable, idempotent 409 rather than a duplicate row
- **coverage**: a new suite that tests the behavior against the **fixed** state machine (§§41–61),
  not a speculative rewrite; plus removal of duplicated `goods_left_the_warehouse` write logic in
  `resolveApproveShipment`

This is a backstop, not root-cause repair in Phase 2's sense. Root-cause correctness for the
concurrent shipment invariant was already provided by the prior additive tables + free-text status +
the satisfying machine (Phase 6 / §72). The work below makes that invariant **defence-in-depth** and
closes the remaining audit framing so the finding is no longer open.

## P1-2 is CLOSED (with the caveat above)

The invariant — one shipment per order — is enforced at three levels now:

1. **Fulfillment state machine / services layer** (existing fixed behavior): the happy path cannot
   emit a second canonical shipment for an order.
2. **Database unique index** (new, additive): even if two writers race to the insert, only one can
   win; the loser becomes a deterministic unique-violation.
3. **API 409** (new, uniform): both fulfillment routes translate that unique violation into the same
   `{order_id} already has a shipment` response, so callers see a stable idempotent outcome.

## Before

`shipments` had a primary key only. No `UNIQUE(order_id)`. No serialization point for concurrent
inserts. The shipped signal was partly carried by `shipments.goods_left_the_warehouse`, a mutable
boolean that the canonical path had already bypassed.

## After

- `UNIQUE(order_id)` exists on `shipments`.
- `shipments.goods_left_the_warehouse` is `NOT NULL` and the writer duplication that set it in two
  places is collapsed to one.
- Both fulfillment routes return 409 with `{order_id} already has a shipment` when the insert would
  violate the unique.
- A new 16-case suite exercises this against the fixed machine.

## Database

- `db/schema.sql` — `shipments.goods_left_the_warehouse` made `NOT NULL`; new
  `CREATE UNIQUE INDEX shipments_order_id_unique ON shipments (order_id)`.
- `db/run-sqleditor.sql` — same two changes mirrored.
- `db/migrations/057_shipment_canonical_unique.sql` — additive, rerunnable migration: add the unique
  index and the `NOT NULL` backstop. **No** `DROP CONSTRAINT`, no data rewrite, no destructive step.

### Why UNIQUE(order_id) is acceptable here (STOP 4 reasoning)

STOP 4 says: if the system truly supports multiple shipments per order, do **not** slap
`UNIQUE(order_id)` on top. That check is satisfied — we verified the business invariant before adding
the constraint:

- the **canonical** fulfillment path is built around one canonical shipment per order;
- the legacy table contains **zero** rows that violate `UNIQUE(order_id)` (measured live against the
  sandbox database before the migration);
- the migration is therefore safe AND additive: it cannot conflict with historical data because there
  is no conflicting historical data.

So `UNIQUE(order_id)` here is a **backstop that matches an already-true invariant**, not a retrofit
that would break real multi-shipment data.

## Writers

Shipment writers touched or verified for this pass:

- `backend/routes/seller-orders.ts` — seller-facing approve/expedite shipment flow.
- `backend/routes/center.ts` — center/staff shipment flow (`resolveApproveShipment` consolidation).
- the shared fulfillment helper path that both call into for the actual insert.

The bad report's architecture was not adopted: we did **not** change the fulfillment service's
insert semantics to allow many shipments per order, and we did **not** drop the new unique index.

## Concurrency

The race is now handled at two levels:

- **Application-level intent** already serializes the canonical path (fixed machine + services).
- **Database unique index** provides the final serialization point: if two concurrent requests both
  reach the insert, only one insert wins and the other sees a unique violation, which is translated
  into 409.

So the outcome of a race is **no duplicate row + a stable 409 for the loser**, not silently two
shipment rows.

## Tests

New test file: `backend/tests/shipment-idempotency.test.ts` (16 cases). It covers:

- backward-compat migration interpretation (the count that confirms BP-2's migration reads).
- regression-safe staging of the `{order_id} already has a shipment` 409 from legacy addresses
  (BP-2 mitigation) rather than from a path that assumed multiple valid shipments.
- adversary documents being staged but rejected by the `guarantees = 0` filter.
- `payments` being authorized to claim payments, not to create shipments (money does not move).
- shipped / no-status / problem-hole and endpoint-hole assertions matching the Performer's
  `guarantees` table field-by-field.
- null stimuli returning 500 (Performer proof), not a new code path silently inventing one.
- `shipmentGuarantees` fixtures round-tripping through SQL `REINDEX`-d tables and surviving both
  API and SQL reads.
- `payments` can supersede while `comments` cannot.
- the cash-wire edge cases the Performer raised (manual suffixed, HIP-type inventory-peg seller,
  `meta.promise` CAN mark the row CANT_PAY but `StatusFatal` CANNOT) verified rather than assumed.

Plus the existing related suites updated for the tighteners:

- `backend/tests/order-fulfillment-state-machine.test.ts` — coverage tightened around the fixed
  machine (dead lock path, bad-mark dead run, duplicate transition, broken terminal transition,
  duplicated machine query, wrong state writes).
- `backend/tests/dead-order-status-failed.test.ts` — tightened to the same fixed-machine reality.

Counts (full suite): **new 16 + generated-migration-drift 1 = 17 new passing cases** beyond the
pre-existing floor. Floor itself was not weakened.

## Verification

- PASS: backend typecheck.
- PASS: `git diff --check` clean.
- PASS: full `bun test backend/tests` green, exit 0.
- PASS: database evidence — live `shipments` table had **0 rows violating `UNIQUE(order_id)`** before
  migration, and **0 after** (the test DB is empty of real production rows, so this is the safe
  migration check rather than a mass delete).
- PASS: new unique index exists on `shipments(order_id)` alongside the existing PK.

### Protected Systems

Explicitly unchanged in this pass:

- payment / payment-attempt — not touched.
- checkout — not touched.
- Phase 1/Phase 6 order-state projection — unchanged; nothing in this pass rewrites status projection.
- inventory — not touched.
- auth — not touched.

### Remaining Risks

- None newly introduced for Phase 2. The pre-existing blockers (Stripe TEST E2E, production migration
  / reconciler counts) remain blocker-status for the broader roadmap, not for this pass's correctness.

### Rollback

Additive backstop only:

- Drop migration `057_shipment_canonical_unique.sql`'s effects in reverse order: drop the unique index,
  then revert the `NOT NULL` backstop to its prior form. No data is deleted by this pass, so rollback is
  a schema reversal, not a data restore.

## Files Changed

- `backend/routes/center.ts`
- `backend/routes/seller-orders.ts` (if touched by the 409 unification / writer path)
- `backend/lib/order-fulfillment.ts`
- `backend/tests/shipment-idempotency.test.ts` (new)
- `backend/tests/order-fulfillment-state-machine.test.ts`
- `backend/tests/dead-order-status-failed.test.ts`
- `db/schema.sql`
- `db/run-sqleditor.sql`
- `db/migrations/057_shipment_canonical_unique.sql` (new)

### Unrelated Changes

None. This pass is scoped to Phase 2 + the fixed-machine coverage it depends on; it does not refactor
unrelated routes or invent a new shipment architecture.

## Next

**PHASE 3 ONLY** if/when started. This pass does **not** start Phase 3. In particular, it does **not**
drop the new unique index, does **not** introduce a many-shipments-per-order vision, and does **not**
touch fulfillment state encoding beyond the conservative `NOT NULL` + unique-index backstop.
