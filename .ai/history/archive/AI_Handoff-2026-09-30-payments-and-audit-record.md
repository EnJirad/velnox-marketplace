# AI Handoff archive — §37–§48 (moved 2026-09-30, edit-headroom housekeeping)

Moved **verbatim** out of `.ai/AI_HANDOFF.md` on 2026-09-30 so the live handoff could stay under
its edit ceiling while the VelRepeat Prepaid Repeat Commerce pass (§51) was appended. Index row:
[`.ai/history/AI_Handoff_Archive.md`](./AI_Handoff_Archive.md).

Nothing here changed. Several of these sections were themselves already superseded by later
records (audit findings §42.1–§42.5 live in
`AI_Handoff-2026-09-29-audit-findings-detail.md`, and §38–§41 in
`AI_Handoff-2026-09-29-part2-and-order-surfaces.md`); the live status of everything below is in
**§6 "Remaining gaps / open items"** and in the §42.2 finding index of the main handoff.

---

## 37. Migration 048 never applied — checkout read path repaired (2026-09-28)

**Archived for length** → `.ai/history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md`.
In one line: production Neon still had no `orders.payment_expires_at`, the migration run died on the
§22 quota, and the checkout READ named the column so a missing deadline took checkout down instead of
being unenforced. Fixed by `selectOrderPaymentRow()` (`to_jsonb(o) ->> 'payment_expires_at'`: one
statement that is correct against both schemas and cannot raise 42703). Still open — see §40.

**OWNER ACTION (unchanged, still required).** Clear the Neon quota, then **Actions → Migrate Neon
Database → Run workflow** with `migration_file = 048_payment_reservation.sql` (`gh workflow run`
answers 403 — the GitHub App has no `actions: write`), **or** run the SQL in the archive file, section
**OWNER ACTION** ([`history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md`](history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md))
in the Neon SQL Editor. It is additive and nullable, so existing orders keep `NULL` (= "no window",
what the sweep ignores).

**Current status (§42 #6, still true):** unapplied in production; the 30-minute countdown is therefore
invisible to customers and the expiry sweep claims nothing.

---

## 38–41. Archived (moved 2026-09-29, edit-headroom housekeeping)

§38 (fixed 30-minute reservation + countdown + pay-again UX), §39 (order UX polish — status, progress,
address, language), §40 (countdown invisible in production — migration 048) and §41 (order-surface
refactor: shared `OrderStatusBadge`, new seller order detail, `generateOrderNumber()`) moved **verbatim**
to [`history/archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md`](history/archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)) so §42 could be appended.

**Still live from them.** The reservation is a **CONSTANT 30 minutes** (`PAYMENT_RESERVATION_MINUTES`;
§36's risk bands are deleted) · the tier UI is GREEN >15:00 / YELLOW ≤15:00 / RED ≤5:00 · **migration
048 is still NOT applied in production** (§42 #6) · the browser pass over both order surfaces in th/en/my
is still open. **One correction to §38:** its "the ONE release path" holds for the PAYMENT paths only —
§42 #2 records the second (seller) release path that bypasses `releaseOrderInventory()`.

---

## 42. Full-system audit — Part 1 (cancellation race) + Part 2 (30-min reservation) (2026-09-29)

**What this pass is.** A read-only, end-to-end audit of Velnox at **`2c52bfc`** covering Part 1
(payment ↔ customer cancellation race hardening) and Part 2 (30-minute payment reservation +
automatic expiry + stock release). **No code, schema, migration, API, state-machine or UI change was
made by this pass.** Evidence tiers: **LOCAL VERIFIED** (a command ran here) · **PRODUCTION VERIFIED**
(a live read) · **PRODUCTION BLOCKED** (not observable from a workspace) · **CODE-VERIFIED ONLY**.

**§0 startup sync — the sandbox was 34 commits stale** (`behind 34 / ahead 0`); `git pull --ff-only`
fast-forwarded to `2c52bfc` == `origin/main`, no local work lost, **no commit created**. Any handoff
text written before `2c52bfc` is not verified against the audited code.

### 42.1 What was checked, and the result

**The 18-row audit table moved 2026-09-29 (edit headroom)** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md)
(§42.1). What still binds today, restated: **#8/#10** (two release paths, `quantity` never
consumed) → **fixed §43** · **#12 / #6** migration 048 → **still PRODUCTION BLOCKED** ·
**#13** production Stripe is `mode:"test"` with **COD disabled** · **#18** `db/schema.sql` ↔
`db/run-sqleditor.sql` byte-identical, head `048`. The three rows that cannot be claimed from a
workspace — #15 real Stripe E2E, #16 browser E2E, #17 DB-gated suites (CI is the only execution) —
are restated in **§45**.

**Verdicts on the ten architecture questions — ARCHIVED 2026-09-29** → verbatim in
`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md` (§42.1). Headline: authorities were
each single-sourced, but `quantity` was never consumed, the seller path double-released, `paid →
cancelled` existed, production schema mismatched. (2)+(6) ✅ §43 · (7) ✅ refused §44 · (5) ✅ §47 ·
(9) ✅ §48.

### 42.2 PROBLEMS — severity ordered (index; full write-ups archived)

**Archived 2026-09-29** → `.ai/history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`
(the verbatim §42.2 paragraphs — source lines, SQL, and the test that pinned the wrong behaviour —
plus §42.3–§42.5). One line per finding, with its current status:

| # | Finding (one line) | Status |
|---|---|---|
| C1 | Non-variant `inventory.quantity` never consumed on payment → a paid unit stays sellable | ✅ **FIXED** §43 |
| C2 | Seller cancellation was a SECOND release path (inline restore, no claim) → double release / phantom units | ✅ **FIXED** §43 |
| H3 | A seller/center can cancel a PAID order: money kept, no refund, no alert | ✅ **FIXED** §44 |
| H4 | `payment_intent.payment_failed` is per-ATTEMPT but terminal at ORDER level → a later successful retry is refused | ❌ **OPEN** |
| H5 | A payment arriving after the order died has no auto-refund and no operator queue (only `console.warn`) | ✅ **FIXED** §47 |
| H6 | PRODUCTION BLOCKED: migration 048 unapplied (Neon quota) → Part 2 inert in production | ⛔ **OWNER ACTION** |
| M7 | The payment-success path ignores variants | ✅ resolved by §43 (`commitOrderInventory` leaves `product_variants.stock` to the reservation) |
| M8 | Two overlapping urgency contracts in `commerce.ts` (3-minute vs GREEN/YELLOW/RED) | ✅ **FIXED** §50 |
| M9 | `orders.status` has no CHECK constraint | ✅ **FIXED** §48 (migration 050) |
| M10 | VelRepeat bypasses the order-creation guards (COD row, `sold_count` at creation, uncommittable hold) | ❌ **OPEN** |
| M11 | Inventory-row AB-BA deadlock → generic 500 `CHECKOUT_FAILED` | ❌ **OPEN** |
| L12 | `"failed"` is dead in `RELEASABLE_STATUSES` | ✅ **FIXED** §49 |
| L13 | `inventory-race` concurrency evidence exists only in CI (LOCAL tier) | ℹ️ evidence note |
| L14 | Settlement is per shop/order row → one multi-shop checkout can end partially paid / expired | ❌ **OPEN** |

### 42.3–42.5 Archived (moved 2026-09-29, edit-headroom housekeeping)

The cancellation matrix, the race verdicts and the prioritized action list moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md),
which now holds all of §42.2–§42.5. The matrix and the race verdicts are fully superseded: their only two
❌ cells were fixed by §43 and §44. **The current open list is §42.2** — do not work from 42.5.

**Not claimable from a workspace.** Real Stripe E2E; the production schema query (401); browser E2E of
`/orders`, `/cart` and the seller order pages (no signed-in session); any DB-gated case locally
(CI is the only execution).

---

## 43. Inventory integrity — audit CRITICAL #1 + #2 fixed (2026-09-29)

**Task** `fix(inventory): harden settlement and release` · **commit `8b89ecf`** (pushed, == `origin/main`)
· audited base `2c52bfc` (§42) · start `829347e`. **No schema change, no migration touched, no
reservation/policy/frontend change.**

- **CRITICAL #1 PASS — settlement now CONSUMES stock.** NEW `commitOrderInventory()` (called only
  from `stripe.ts:429`, in the same transaction as the order claim) does `quantity −N, reserved −N`
  for a non-variant line, leaves a variant's `product_variants.stock` where the reservation put it,
  and counts `sold_count +N` once. `GREATEST(0, …)` keeps stock non-negative.
- **CRITICAL #2 PASS — ONE release authority.** `seller-orders.ts` now calls
  `releaseOrderInventory()` and writes no inventory row at all. The claim refuses an order whose money
  settled, so COMMIT+RELEASE and RELEASE+COMMIT are impossible for one reservation.
- **Verified:** local `857 pass / 161 skip / 0 fail` · **CI `36564425934` green:
  `1016 pass / 2 skip / 0 fail`** (disposable `postgres:16`) · `tsc` 0 · `typecheck` 4/4 ·
  `build:apps` 0 · i18n 1414×3 · `git diff --check` clean.
- **Wrong invariants corrected (the assertion, not the number):** seven tests pinned the old
  "quantity is never consumed" bug; they now assert `quantity −N` on commit.
- **Full evidence (sections A–N, race matrix, every command):**
  [`.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md`](tasks/completed/inventory-integrity-fix-2026-09-29.md)

---

## 44. Paid-order cancellation guard + the center release leak (2026-09-29)

**Task** `fix(orders): refuse cancelling a paid order (audit HIGH #3)` · **commit `895cebf`**
**Task** `fix(center): release the reservation on an admin cancellation` · **commit `3d77254`**
(both pushed, == `origin/main`). Base `c9fd09b` (§43). **No schema change, no migration touched.**
Two commits because they are two independent defects.

- **HIGH #3 PASS — money outranks a staff cancellation.** NEW
  `assertNoSettledPaymentForCancellation()` (`lib/order-fulfillment.ts`) reads `orders.status` plus every
  `payments.status` in `PAYMENT_SETTLED_STATUSES` in **one** statement, under the caller's existing
  `lockOrderRow`, and throws 409 `ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`. Gated **before** the
  cancel UPDATE in BOTH `seller-orders.ts` and `center.ts`. Required because
  `normalizeOrderStatusToFulfillment` maps `paid → pending`, so a paid order looked cancellable. The
  codes are the **customer's** — `cart.ts` already used the same two, giving ONE vocabulary.
- **Center release leak (NEW from §43) — CLOSED.** `center.ts` wrote `cancelled` and released
  nothing, stranding the hold forever. It now calls the ONE `releaseOrderInventory()` authority.
- **Deliberately NOT changed:** `NEXT_ORDER_STATUSES` (`commerce.ts:461`) — pinned by
  `order-status-contract.test.ts` and cannot know about money. The button is still offered; the
  localized 409 refusal is what stops the write.
- **Verified:** `860 pass / 162 skip / 0 fail` · `tsc` 0 · `typecheck` 4/4 · i18n 1416×3 ·
  `git diff --check` clean. New: a DB-gated "a paid order is refused a staff cancellation; an unpaid
  one is not" + 3 source-contract tests.
- **Still open:** the **live** index is **§42.2** — do not work from an older list. Full text of all
  findings: [`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md).

---## 45. CI follow-up — the paid-cancellation assertion was the bug, not the code (2026-09-29)

**CI failure: FIXED.** Implementation changed: **NO** (zero source files touched).
`test(orders): fix paid cancellation regression assertion` · start `08d6d68` · runs
`36580595287` (`2a725d3`) and `36580934430` (`c313244`) both **success, 1020 pass / 2 skip / 0 fail**.

- **Root cause:** a stale assertion that contradicted its own fixture, in the DB-gated test §44
  added (`order-fulfillment-state-machine.test.ts`): it seeds `paidRow` at `orders.status='paid'`
  on purpose (the raw webhook-written status must be refused, not just a `paid` payment row), then
  swept ALL rows asserting `'confirmed'` — `Expected: "confirmed"` / `Received: "paid"`. The gate is
  a read-only `SELECT` and the `ORDER_ALREADY_PAID` assertion just before it PASSED, so the
  implementation was never wrong. Fix: assert each row against its OWN seeded status, and add
  `unpaid` so the allowed path is covered too.
- **CI is the proof, not the local run** (the fixed test is one of 5 DB skips — no Postgres here).
  Full evidence incl. both CI logs: `.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md`
  → "CI Failure Follow-up".

---

## 46. HIGH #4 — payment ATTEMPT identity (2026-09-29)

**Status: FIXED** · `fix(payment): separate failed attempts from order payment state` · start
`c313244`. **One production file: `backend/routes/stripe.ts`.** No schema, no migration, no
inventory file, no frontend, no new business rule.

- **Root cause — every write to `payments` chose its row by a NEWEST-ROW HEURISTIC, not by the
  attempt the Stripe event names**, discarding `paymentIntent.id` / `session.id` even though they sit in
  `provider_payment_id` / `provider_checkout_session_id`. An order **legitimately has several payment
  rows**, so a **LATE event about a dead attempt landed on the live one**: a late
  `payment_intent.payment_failed` failed the customer's still-open session, flipped the ORDER to
  `payment_failed` and released their stock; a late `payment_intent.succeeded` recorded captured money
  against an attempt that was never charged.
- **The order-level half was NOT the bug and was NOT changed.** `PAYABLE_ORDER_STATUSES =
  ['pending','pending_payment']` is the retry policy — **no policy was invented**.
- **Solution:** NEW `resolvePaymentAttemptRow()` resolves the row by `provider_payment_id` OR
  `provider_checkout_session_id`, keeping the heuristic only as a fallback for an event with no stored
  identifier. The terminal guards moved onto the **outer** UPDATE, and `markPaymentFailed` /
  `markPaymentCanceled` now require **this attempt to have actually transitioned** (read from
  `rowCount`) before the order moves and stock is released. **Inventory impact: none.**
- **Tests:** NEW `payment-attempt-identity.test.ts` — 7 contract (local; **4 failed before the fix**)
  + 6 DB-gated behavioural. Local `867 pass / 168 skip / 0 fail` · `tsc` 0 · `typecheck` 4/4 ·
  `build:apps` 4/4 · i18n 1416×3. ⚠️ First CI `36585376063` failed (2 NEW-TEST defects, no production
  change). **✅ GREEN on `c599606`: `36586188271` → `1033 pass / 2 skip / 0 fail`.**
- **Full evidence (25 sections, state map, every command):**
  [`.ai/tasks/completed/payment-failed-retry-2026-09-29.md`](tasks/completed/payment-failed-retry-2026-09-29.md)

---

## 47. HIGH #5 — late / unrecordable payment operator flow (2026-09-29)

**Status: FIXED** · `fix(payment): add operator handling for late payments` · start `fd4ba52`.
**No refund policy, no reopen policy, no order resurrection, no order-lifecycle change.**

- **Root cause — "money arrived that the system cannot act on" was a `console.warn`, not a record.**
  The sharpest case was **structurally invisible**: a captured charge for an attempt already recorded
  `failed` on a still-`pending_payment` order **moves the order to `paid` and commits the stock**
  while the payment row stays `failed` — and `POST /api/admin/orders/:orderId/refund` then refuses
  it (`409 PAYMENT_NOT_REFUNDABLE`; that route requires `status = 'paid'`). Reachable via
  `SESSION_NOT_REUSABLE` (customer switches rail) then pays the old tab.
- **Solution:** NEW `backend/lib/payment-incidents.ts` — the ONE authority — records
  `payment_incidents` (migration **049**) whenever money is received that cannot safely settle.
  Detection widened from `!moved` to `!moved || !attemptRecorded`, **minus duplicate deliveries**.
  Order guards and both inventory functions untouched. `dedupe_key` =
  `provider:orderId:attempt:reason`, UNIQUE, via `ON CONFLICT DO NOTHING`.
- **No policy invented:** `.ai/context/payment.md` already fixes it — "never resurrect … No refund is
  invented in code — an operator decides". The resolve route updates only `payment_incidents` (pinned
  by test: no `UPDATE orders/payments/refunds`, no inventory work). Authorization is the **existing**
  catalog (`orders.view` / `orders.manage`); the new VelCenter tab has **no refund and no reopen
  button**. Schema-tolerant on purpose: with 049 unapplied the write swallows `42P01`/`42703`.
- **Tests:** NEW `late-payment-incidents.test.ts` — 10 contract (local) + 8 behavioural, covering
  cases A–D, dedupe, authorization, and that resolving changes nothing but the incident. Local
  `878 pass / 176 skip / 0 fail` · `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · i18n 1416×3.
- **⚠️ Two CI failures, both TEST defects, zero production files changed.** (a) `36590962144`
  (`19 fail`): `payment_incidents.order_id` is a NO ACTION FK on `orders` but was missing from the
  `tests/helpers/purge.ts` child enumeration, so 13 pre-existing suites failed in their own
  `finally`. Fixed by adding the table; no assertion weakened. (b) `36591311016` (`2 fail`):
  `Expected: 200 / Received: 403` — the fixture seeded an `employees` row but `resolvePermissions`
  takes the role from **`users.role`**; fixed by inserting the role, 403 assertions **not** weakened.
- **✅ CI GREEN on the third run — `36592289354` (`b9551b8`): `1052 pass / 2 skip / 0 fail`.**
- **Full evidence (28 sections):**
  [`.ai/tasks/completed/late-payment-operator-2026-09-29.md`](tasks/completed/late-payment-operator-2026-09-29.md)
- **⚠️ OWNER DECISION, not solved here:** in Case A the charge sits on a `failed` row, so the
  existing refund route still cannot move it. What a captured charge on a failed attempt **is**
  (refund, or keep against a delivered order) is a refund policy no source or doc states.
- **Remaining blockers:** migrations 048 **and 049 PRODUCTION BLOCKED** (owner, Neon quota) ·
  Stripe E2E ⛔ · browser E2E ⛔ · MEDIUM #8–#11, LOW #12–#14 open.

## 48. MEDIUM #9 — `orders.status` CHECK (2026-09-29)

**Status: FIXED** · `fix(db): constrain order status values` · commits `619747f`/`61d7b50`/`04ab7ea`.
**No state machine change, no new status, no application source file touched.**

- **Root cause — the only status column in the schema without a CHECK.** Free text let a typo or a
  retired path store a value nothing knows, and `normalizeOrderStatusToFulfillment()` answers
  `pending` for anything unrecognised — so the row looks un-actioned, not broken.
- **The allowed set was DERIVED from the writers, not chosen:** the 7 `FULFILLMENT_STATUSES` ∪ 5
  payment-lifecycle values (`pending_payment`/`paid`/`payment_failed`/`refunded`/`expired`); the two
  parameterized writers are gated by `isFulfillmentStatus` + `canTransitionFulfillment()`.
  **Deliberately excluded:** `failed` (audit LOW #12 — now removed, §49) and every `payments.status`
  value. Payment state stays a separate axis.
- **History — a RE-ADD, not an invention:** V0003 declared a narrower list, the real writers began
  failing, and **V0016 dropped it**. V0050 restores it inline on `CREATE TABLE orders` + an
  idempotent `ALTER`; both canonical files byte-identical. `db/run-update.sql` untouched.
- **It is NOT the state machine, and a test proves it:** `completed → pending` is **accepted** by the
  database. The gates remain the only transition authority; none was weakened.
- **Tests:** NEW `order-status-check-constraint.test.ts` — 17 contract (local) + 9 DB-gated. One
  pre-existing test asserted the CHECK's **absence**; it was rewritten to the new truth with
  **stronger** assertions, never skipped or weakened.
- **✅ Verification:** local `896 pass / 185 skip / 0 fail` (1081/50) · `tsc` 0 · `typecheck` 4/4 ·
  `build:apps` 4/4 · i18n 1416×3 · schema parity OK · `git diff --check` clean ·
  `lint` = placeholder (no real lint script).
- **⚠️ First CI FAILED (`36596404247` + `36596404197` Migrate Neon) — two causes, one mine.** (a) The
  pre-existing **Neon quota** killed `Migrate Neon Database` on its *first* step; it never reached
  050. (b) **A bug in my own test:** it seeded `RETURNING status` (no `id`), so `UPDATE … WHERE
  id = NULL` matched zero rows and the NOT NULL assertion was *vacuous*. Fixed by returning
  `id, status` and asserting `rowCount === 1` first.
- **✅ CI GREEN on `61d7b50`: `36597070677` → success, `1079 pass / 2 skip / 0 fail`**, all nine
  DB-gated constraint tests `(pass)`.
- **⚠️ Production NOT verified; V0050 NARROWS the set** — it fails loudly by design rather than
  rewriting a live order's status. 048/049 unapplied, so 050 has not run and production
  `orders.status` is still unconstrained.
- **Full evidence (30 sections):**
  [`.ai/tasks/completed/order-status-check-2026-09-29.md`](tasks/completed/order-status-check-2026-09-29.md)
- **HIGH #5 untouched.** The captured-charge-on-a-`failed`-attempt question remains an
  **OWNER DECISION**.

---
