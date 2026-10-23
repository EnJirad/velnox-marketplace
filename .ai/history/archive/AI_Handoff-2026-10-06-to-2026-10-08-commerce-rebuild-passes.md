# AI Handoff archive — completed passes 2026-10-06 → 2026-10-08 (§70, §71, §72, §74)

**Verbatim** move of four completed-pass sections out of `.ai/AI_HANDOFF.md`
(moved 2026-10-23 during the VelRepeat removal / repository cleanup, to keep the
handoff under its ~55 KB edit ceiling). Nothing was discarded or reworded; links
are as written from `.ai/` (adjust `../` when following from this directory).
Index row: [`AI_Handoff_Archive.md`](../AI_Handoff_Archive.md).

---

## §70. Payment + Checkout + Order + Inventory + Webhook — rebuilt as ONE system (2026-10-06)

**Full record:** [`docs/PAYMENT_CURRENT_STATE.md`](../../../docs/PAYMENT_CURRENT_STATE.md) (25-question audit) ·
[`docs/PAYMENT_TARGET_ARCHITECTURE.md`](../../../docs/PAYMENT_TARGET_ARCHITECTURE.md) ·
[`docs/PAYMENT_IMPLEMENTATION.md`](../../../docs/PAYMENT_IMPLEMENTATION.md) (19 sections) ·
[`docs/PAYMENT_E2E_CHECKLIST.md`](../../../docs/PAYMENT_E2E_CHECKLIST.md) (58 PASS / 8 BLOCKED / **0 FAIL**).

### Root cause

Every per-order payment **read and decision** resolved the ledger by `payments.order_id` alone, while a
multi-shop purchase stores **ONE** payment row with `order_id IS NULL, checkout_group_id = <group>` → NULL →
`COALESCE(…, 'unpaid')` → the UI showed `orders.status='paid'` beside "ยังไม่ชำระ". The same blindness broke the
**decisions**: confirm gate (409 forever on a paid order), release guard (would return **sold** stock),
cancellation gate (a paid purchase could be cancelled), expiry sweep (could expire a purchase mid-payment).
**A seventh, more severe defect was found this pass** (`docs/PAYMENT_CURRENT_STATE.md`, defect 7): a group session's
`metadata.orderId` is the REPRESENTATIVE order, so the four failure/expiry paths resolved to it, searched
`payments WHERE order_id = <order>` → NULL → `moved: false` → **nothing happened at all** (payment stuck
`requires_action`, orders stuck `pending_payment` holding stock, session never closed); the sweep then expired
**one** order, leaving the session payable, and the late charge settled against `expired` orders — money taken,
nothing sold, **no incident** — silently.

### What was built

1. **`backend/lib/payment-attempt.ts`** (new, 490 lines) — the ONE covering-set resolver: predicates, the SQL
   fragments, the **precedence fold** (`refunded > partially_refunded > paid > processing > NEWEST`), row
   accessors and purchase-scope readers. **24 blind subqueries across 8 files now use it**
   (`routes/{cart,stripe,seller-orders,center}.ts`, `lib/{order-lock,order-fulfillment,inventory}.ts`,
   `jobs/payment-reservation-scheduler.ts`).
2. **`backend/lib/checkout-group-lifecycle.ts`** (new, 200 lines) — `terminateCheckoutGroup()`: locks every
   member order (id ASC), refuses when any covering payment is settled or in flight (`blockedBy`), claims each
   order, releases stock through the ONE release path, and voids the charge **last**. Used by the cancel route,
   the expiry sweep and all four failure/expiry webhook cases.
3. **`routes/stripe.ts`** — failure/expiry paths group-aware; purchase scope derived **server-side from the order
   row** (closes the retry hole where an `orderId`-only request charged ONE shop's total beside a live group
   charge); settlement records a durable late-payment incident when captured money has no payable order; refunds
   are group-aware. **Migration 055** (mirrored in both canonical SQL files): nullable `refunds.order_id`,
   `refunds.checkout_group_id` + index, `refunds_parent_check`, `payments_status_check` (added **conditionally**
   — production is unreadable from a workspace). `db/verify-reconciler.sh` counts `66|243|255|652` →
   `66|244|258|653`.
4. **One frontend file**, `apps/velshop/src/pages/ShopCheckoutSuccess.tsx`: the payment line is no longer hidden
   when the backend sends `payment: null`. No new i18n keys.

### Verified (all observed, none assumed)

| Check | Result |
|---|---|
| `bun test backend/tests` on a freshly reconciled disposable DB | **2011 pass / 2 skip / 0 fail**, 2013 tests, 69 files |
| `backend/tests/checkout-group-payment-visibility.test.ts` (new, 539 lines) | **18/18** |
| `bun run db:verify` | exit 0 — **52 PASS**, ALL SCENARIOS PASSED |
| `bun run typecheck` (4 frontends) + `@velnox/backend` | exit 0 |
| `bun run build:apps` | exit 0 (4/4) |
| `bun run i18n:check` · `git diff --check` | exit 0 · clean |

Five pre-existing source-shape tests failed because they pinned the OLD blind SQL verbatim; each was updated to
pin the new architecture, and the cancel contract gained a **stronger** assertion (a grouped refusal is decided
under the member-order locks and returns before the provider session is closed or any socket event published).
No assertion was weakened, skipped or deleted. `bun run lint` is **not configured** in this repo.

### Still BLOCKED (unchanged, do not read as PASS)

1. **Real Stripe TEST-mode E2E** — no `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
   `STRIPE_WEBHOOK_SECRET` (`freebuff-env list` → `{"files":{}}`), no browser, no test account. Phase 19 is
   verified at **DB level with prototype-spied Stripe sessions** and labelled as a simulation. Requires: set the
   three Stripe keys in the backend env and register the webhook for `POST /api/payments/stripe/webhook`.
2. **Production Neon unreachable** — migration 055 could not be read against or applied to production (no
   `NEON_PRODUCTION_DATABASE_URL`; GitHub App token 403 on secrets and workflow dispatch). Apply 055, confirm the
   two new constraints, re-run the count assertion.
3. **Owner follow-ups from this pass:** reconcile historical rows where a charge landed on `expired` orders
   (start from `payment_incidents`); decide/implement seller payout (Stripe Connect or an internal ledger) and
   persist commission per order — neither exists today (`docs/PAYMENT_IMPLEMENTATION.md` §19).

### Conflict flagged in the task brief

The brief lists `db/run-update.sql` as a schema sync target. `AGENTS.md` rule 4 forbids recreating that file, so
only `db/schema.sql`, `db/run-sqleditor.sql` and the migration were written. `db/run-update.sql` remains absent.

---

## §71. Production e-commerce full-system rebuild — phases 0-4 DONE, 5-17 not started (2026-10-06)

**PHASE 4 (DB invariants) IS DONE AND VERIFIED; phases 5-17 have not started.** The 13 required
design documents live in **`.ai/rebuild/`** — that directory is the authority for this
work, and `FINAL_VERIFICATION.md` is the ONLY record of what passed: its §2 is the untouched
pre-change floor and its §3.1 the Phase 4 evidence. Read `CURRENT_ARCHITECTURE.md` (evidence-backed
audit, findings A1-A19), `TARGET_ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md` and
`MIGRATION_PLAN.md` (the 17-phase plan and its gates).

**Phase 4 shipped** `db/migrations/056_commerce_core_invariants.sql` — additive and rerunnable: the 9
new tables, both order axes, the SAME four counters on BOTH stock axes, the ledger append-only trigger
and the retry metadata. No `DROP CONSTRAINT` and no `DROP INDEX` anywhere in it. It is mirrored into
BOTH canonical files and **distributed into the reconciler's real passes**, never a late block — a late
block puts `ADD COLUMN` after the index pass and the contract tests refuse it.
`db/verify-reconciler.sh` expects `75|296|339|807` and derives scenario G's table count from `CANON`
instead of a literal. `commerce-core-invariants.test.ts` asserts the SQLSTATEs.

`orders_total_matches_parts_check` was written and DELIBERATELY REVERTED — §43's "a constraint would
reject valid data": a production-shaped order can hold a total with no line breakdown. Do not
reintroduce it; the reconcilers report the relationship instead.

**Blocker status unchanged — not PASS:** Stripe TEST E2E **BLOCKED** (no keys; `freebuff-env list` →
`{"files":{}}`); production migration **BLOCKED** (no `NEON_PRODUCTION_DATABASE_URL`). `bun run lint` is
**not configured**. §39's `db/run-update.sql` demand conflicts with `AGENTS.md` rule 4 — that file stays
absent; only `db/schema.sql`, `db/run-sqleditor.sql` and `db/migrations/056_*.sql` get written.

Next: **Phase 5 (Checkout)**, then 6-17 per `MIGRATION_PLAN.md` §3. Re-read §2 and §3.1 of
`FINAL_VERIFICATION.md` first: a regression is a difference from §2, never from the last edit.

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
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md)
(index row added); nothing discarded.

**2026-10-07 — §73 moved.** §65 of this file and §4 and §7.2–§7.3 of `.ai/rebuild/TARGET_ARCHITECTURE.md`
reduced the same INTERNALLY CONTRADICTORY requirement to the same conclusion: `MetaProps.active_campaign != null
⟺ Order.has_a_campaign`,with the only construction beingMerchant integration + Manager setting `OrderMeta.has_a_campaign = true`.
**Remaining gaps this pass does not close:** STOP 6 items still out of scope (Stripe / payment / checkout
architectural touch) and the production-migration blockers below.

---

## §74. Phase 3 — shipment lifecycle (`P1-3`) (2026-10-08) — **DONE**

Full record: [`.ai/audit/PHASE_3_SHIPMENT_LIFECYCLE.md`](../../audit/PHASE_3_SHIPMENT_LIFECYCLE.md).
**Starting HEAD `6e24bd546e37e4db65a578cf90bdc9f407c0cd24`** (= `origin/main`, Phase 2).
**Final HEAD (implementation commit):** `b9824fec170926af6cbc7e03890b61d361a58adc`
— `feat(shipping): implement shipment lifecycle transitions`. The `docs(ai)` commit
that carries this section is the tip after it (`git log -1 --format=%H` on `main`);
both are pushed in the same pass and `origin/main` was re-read to confirm.

`shipments.status` had a nine-value CHECK constraint and exactly ONE writer that
ever wrote it (`created`). Phase 3 adds the missing transition: the canonical
vocabulary is read off the database (`pending, created, picked_up, in_transit,
 out_for_delivery, delivered, returned, lost, cancelled` — an invented
`packed/ready_to_ship/shipped` draft was withdrawn because those values would be
refused by `23514`), the machine is forward-only and terminal-protected, repeats
are write-free idempotent successes, and the two timestamps the schema already
had (`shipped_at` on handoff, `delivered_at` on arrival) are stamped once.

- **Atomicity:** the order row lock FIRST (`lib/order-lock.ts`), then a
  CONDITIONAL `UPDATE … WHERE id = $n AND status = $current` — proven with 8 real
  concurrent transactions on a local PostgreSQL 14: exactly one move, one
  timestamp, one order-axis advance.
- **No duplicate machine:** the order's own fulfilment axis is advanced only
  through `canTransitionFulfillment` + `projectOrderStatus`
  (`advanceOrderFulfillmentAxis` in `lib/order-state.ts`), so a parcel move the
  order's machine has no edge for is refused `409 ORDER_NOT_READY` instead of
  letting the two lifecycles diverge; `orders.status` stays a projection.
- **Surfaces:** `PATCH /api/seller/orders/:id/shipment` (approved seller +
  ownership under the lock) and `PATCH /api/admin/orders/:orderId/shipment`
  (center member + `orders.manage`, audited). `CHANNELS.SHIPMENT_UPDATED`.
- **Schema:** NO migration needed — every column, the CHECK and the Phase-2
  unique index already existed in 056/057, `db/schema.sql` and
  `db/run-sqleditor.sql`; nothing additive was outstanding.
- **Tests:** `backend/tests/shipment-lifecycle.test.ts` (27 cases; 13 run without
  a database, 14 are DB-gated) plus the whole existing suite green.
- **Verified this pass:** backend typecheck 0 · all four frontend typechecks 0 ·
  targeted suite 27 pass / 0 fail · full suite **2103 pass / 2 skip / 0 fail** ·
  `bash db/verify-reconciler.sh` ALL SCENARIOS PASSED · `git diff --check` clean.
- **Protected (unchanged):** payment, checkout, inventory, the Phase-1 order-state
  authority and the Phase-2 `UNIQUE(order_id)` invariant.
- **BLOCKED (unchanged, owner action):** production database verification and
  real Stripe TEST E2E; and the endpoints have no frontend consumer yet
  (deliberately backend-scoped).
- **Not started (out of scope):** P1-4 returns/RMA, P1-5 `fulfillment_orders`
  (Phase 4), settlement, commission, ledger, reconciliation.
