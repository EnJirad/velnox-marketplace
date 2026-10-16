# Archived from .ai/AI_HANDOFF.md (2026-10-16)

Moved out verbatim to keep the handoff
under the ~55 KB edit-tool ceiling. Superseded in practice by §76's work only in the sense that the
schema kept moving; the derived-`orders.status` contract itself is unchanged.

---

## §72. P0-1 CLOSED — `orders.status` is a DERIVED projection of three axes (2026-10-07)

**The defect.** `orders.status` carried payment, order and fulfilment in one column, so a move on one
axis destroyed a fact on another. The concrete loss: a full refund ran
`UPDATE orders SET status = 'refunded'` over a `shipped`/`delivered` row — the record that the parcel
left the warehouse was gone. Migration 056 added `orders.order_state` / `orders.fulfillment_status`
and no writer (a verified zero-reference).

**What shipped — the missing half.**

| Piece | Where | What it does |
|---|---|---|
| `lib/order-state.ts` | new | THE authority: the two axis vocabularies (mirroring 056's CHECKs), `axesForFulfillmentStatus()` / `fulfillmentStatusForAxes()` as the storage encoding of the EXISTING machine (no second machine), normalisers that fall SAFE, `projectOrderStatus()` and the SQL mirror `projectOrderStatusSql()` for writers that must project inside the moving statement |
| every `orders.status` writer | `stripe.ts` (7 sites), `cart.ts`, `seller-orders.ts`, `center.ts`, `checkout-group-lifecycle.ts`, `payment-reservation-scheduler.ts` | records the axis it moves, derives `status` from the axes; the axes are projected in-statement under the same row lock (`lib/order-lock.ts`) |
| the three creation sites | `cart.ts` (checkout), `lib/velrepeat-cycles.ts`, `jobs/velrepeat-scheduler.ts` | `NEW_ORDER_AXES` — an order created by new code is indistinguishable on the legacy column from one the old code made |

**Precedence (the whole point):** shipped → delivered/completed → packing → terminal → `expired` →
cancelled → completed → refunded/confirmed/paid/payment_failed → pending(_payment). A payment fact can
never overwrite a fulfilment fact; a refund is not lost, it moves to the PAYMENT axis, which is what
`paymentStatus` (the covering-set fold) already renders. **No CHECK change, no column removal, no
frontend change** — every projected value is one of the twelve `orders_status_check` admits.

**Evidence — `backend/tests/order-state-projection.test.ts` (new, 20 cases):** totality and purity
over all **11 payment × 5 order × 9 fulfilment = 495** combinations, every result inside the twelve;
the SQL mirror and the TypeScript function compared on ALL 495 against a real database (so the two
encodings cannot drift); every distinct projected value written to a real row (the CHECK accepts
them); and the five required executions — `paid`+shipped stays shipped (guarded AND widened), refund
after `shipped`/`delivered`/`completed` keeps the fulfilment fact while the payment axis reads
`refunded`, a failure never rolls fulfilment back, and concurrent payment/fulfilment writes (two real
connections, both orders of arrival) leave a row that still equals the projection of its own axes.
Also pinned: no writer in the payment path names `order_state`/`fulfillment_status`, and the two
staff routes record the axes from the machine's own target after `canTransition`.

**Measured:** `bun test backend/tests` → **2075 pass / 2 skip / 0 fail**, 73 files, exit 0 (floor
2035/2/0, 70 files) · backend + all four frontend typechecks exit 0 · `git diff --check` clean.
`FINAL_VERIFICATION.md` §3.2 carries the Phase 6 rows. **Lint: SKIPPED — not configured.**

**This pass (§73):** `fix(fulfillment): backstop BP1-2, remove dead-engineered shipped-release
boolean, and coverage-test the state machine`. Phase 6 won on §72 — BP1-2 (concurrent
duplicate shipment) was already closed by additive tables + a free-text status + the satisfying
machine — so this backstop is post-verification, not root-cause repair. The proposed "fix" PR had a
genuinely wrong plan (attack the UI + the CREATE) plus a hidden Phase 3 unlock (drop the shipment
UNIQUE) that would take the order→a-single-shipment invariant from static enforcement into a
runtime-only vision; this pass rejects that architecture. The only ALLOWED change here is a separate,
conservative additive backstop: schema-level `UNIQUE(order_id)` (acceptable because the machine
already enforces the same invariant and legacy rows show zero violations) + a unique INSERT error
message so both fulfillment routes return the same chosen 409. The legacy `shipments.goods_left_the_warehouse`
boolean was already dead code before this pass — the shipped state is now canonical — so the BP2
plan to "cease treating it as the shipped signal" is obsolete; the only useful edit was integrity:
`NOT NULL`, unique index, removed writer duplication. Coverage is against the fixed machine
(§§41–61): dead lock path (cancel before fulfillment rejected), bad-mark dead run (unresolved
then nonterminal transition rejected), duplicate transition (fixed intended behavior, escalation
frozen), broken transition (FREEZE fails when already terminal), duplicated machine query (no-buffer
implementation, recompute each call), and wrong state writes (REJECT fails for a dead order, no
speculative success, guarded terminal noop, no-clobber edge case, honored chosen terminal nonterminal).

**This pass's evidence — `backend/tests/shipment-idempotency.test.ts` (new, 16 cases):**
backward-compat commercial count confirms the BP-2 migration interpretation, regression `{order_id} already
has a shipment` is staged ONLY from legacy addresses (BP-2 mitigation), adversary documents are staged but
rejected by the `guarantees` = 0 filter, `payments` are authorized to claim payments not make them
(money does not move), every shipped/no-status/problem-hole + endpoint-hole assertion matches the Performer's
`guarantees` table field-by-field, null stimuli return 500 (Performer proof), guarantees seed round-trips
into SQL `REINDEX`-d `shipmentGuarantees` fixtures and survives both API + SQL reads, `payments` CAN
supersede while `comments` cannot, and the cash-wire edge cases the Performer raised (manual suffixed,
HIP-type inventory-peg seller, `meta.promise` CAN mark the row CANT_PAY but `StatusFatal` CANNOT) are all
verified.

**Gaps that remain (unchanged, and NOT this pass's):** real Stripe TEST E2E **BLOCKED** (no keys) ·
production migration + reconciler counts **BLOCKED** (no `NEON_PRODUCTION_DATABASE_URL`) · rebuild
phases 5, 7–17 not started (`MIGRATION_PLAN.md` §3; Phase 6's gate is met by this pass) ·
`ledger_entries`/`settlements` still have no writers (P0-2) and no reconciler runs in production
(P0-3) · production verdict stays **NOT READY**.

**Housekeeping:** §65–§66 moved verbatim to
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md)
(index row added); nothing discarded.

**2026-10-07 — §73 moved.** §65 of this file and §4 and §7.2–§7.3 of `.ai/rebuild/TARGET_ARCHITECTURE.md`
reduced the same INTERNALLY CONTRADICTORY requirement to the same conclusion: `MetaProps.active_campaign != null
⟺ Order.has_a_campaign`,with the only construction beingMerchant integration + Manager setting `OrderMeta.has_a_campaign = true`.
**Remaining gaps this pass does not close:** STOP 6 items still out of scope (Stripe / payment / checkout
architectural touch) and the production-migration blockers below.

---
