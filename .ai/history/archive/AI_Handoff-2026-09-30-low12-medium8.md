# AI_Handoff §49–§50 — LOW #12 and MEDIUM #8

Moved **verbatim** out of `.ai/AI_HANDOFF.md` on 2026-09-30 for edit headroom
(the file had reached the ~55 KB point at which the editing tools stop matching).
Both passes are COMPLETE and their findings are closed; the live status of each is in
`§6 "Remaining gaps / open items"` and in the VelRepeat sections that superseded them.

---

## 49. LOW #12 — the dead `failed` order status removed (2026-09-30)

**Status: FIXED (Case A — dead confirmed).** `fix(order): remove dead failed status guard` ·
start `04ab7ea`. **Read-side guard cleanup only:** no schema, no migration, no new status, no
state-machine / cancellation / refund / retry change, no `payments.status` change, no Stripe change.

- **What it was.** `RELEASABLE_STATUSES` (`backend/lib/inventory.ts`) gates the atomic
  `inventory_released` claim so a paid / shipped / delivered / completed order can never have its
  stock returned. It listed `"failed"` — a value that **does not exist in the order domain**.
- **Proven dead, not assumed.** All **11** `orders.status` writers were enumerated; the three dynamic
  ones traced to their origin (`seller-orders.ts:617` and `center.ts:517` are `SET status = $1` but
  gated by `isFulfillmentStatus` + `canTransitionFulfillment`; the scheduler writes the constant
  `expired`). The union of reachable values is MEDIUM #9's exact 12-value set — **no `failed`**. Two
  files that *look* like writers are not: `inventory.ts:206` writes the **flag**,
  `payment-reservation.ts:139` the **reservation window**. `git log --all -S"UPDATE orders SET status
  = 'failed'"` returns **nothing** — never written, at any commit. It was in the *first* version of the
  guard (`707d1c0`): a `payments.status` value copied into an `orders.status` guard.
- **Removed; the const is now exported** so a test asserts the real value, not a copy. The claim SQL,
  its `$2`/`$3` binding, the idempotency claim and the settled-payment refusal are **byte-identical**;
  there is exactly **one** call site.
- **Every other `'failed'` is a different axis, left alone:** `payments.status` (`stripe.ts:592`,
  `:1259`, `payment-config.ts`), `payment_events.status` (`:1578`), the V0049 comment,
  `StorePaymentStatus`, and three **read-side** analytics guards now unreachable no-ops (out of scope).
- **Tests:** NEW `dead-order-status-failed.test.ts` — **26 local + 4 DB-gated**, incl. a whole-tree
  assertion that **no source file writes `orders.status = 'failed'`**, a table-resolution scan proving
  every SQL `status = 'failed'` write targets `payments`/`payment_events`, the MEDIUM #9 set still
  exactly 12 and still without `failed`, and (DB-gated) that **PostgreSQL refuses it with 23514 on
  both INSERT and UPDATE**. The pre-existing `not.toContain("failed")` assertion was **kept**.
  **Mutation-checked:** re-adding `"failed"` fails 6 of the new tests.
- **✅ Verification:** local `922 pass / 189 skip / 0 fail` (1111/51) — exactly +26/+4/+1 over
  `04ab7ea` · `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · i18n 1416×3 · schema parity OK ·
  `git diff --check` clean · `lint` = placeholder (no real lint script).
- **⚠️ First CI run FAILED (`36643103344`, `1106 pass / 3 fail`) — a defect in THIS task's own test
  fixture; no production file changed.** The `order_items` INSERT declares 4 placeholders but passed 5
  values; DB-gated, so only CI could catch it. Fixed in `b63610a`; **no assertion weakened.**
- **✅ CI GREEN on `b63610a`: `36643327528` → success, `1109 pass / 2 skip / 0 fail`** — all 26 local
  + all 4 DB-gated LOW #12 tests `(pass)`. Docs run `36643598261` (final HEAD `d21de22`) also green.
- **Production:** **048/049/050 still NOT APPLIED** (Neon quota — **OWNER ACTION**). No migration file
  changed, so `Migrate Neon Database` did not trigger. Safe to deploy before 050 exists.
- **Full evidence (10 sections, the 8-category classification, every writer, every command):**
  [`.ai/tasks/completed/dead-order-status-failed-2026-09-30.md`](tasks/completed/dead-order-status-failed-2026-09-30.md)
- **MEDIUM #9 and HIGH #5 both untouched.** The captured-charge-on-a-`failed`-**attempt** question
  remains an **OWNER DECISION** (it concerns `payments.status`, not modified here).
- **Next task:** MEDIUM #8 (now §50, done) → **MEDIUM #10** VelRepeat bypasses
  `releaseOrderInventory`.

---

## 50. MEDIUM #8 — the duplicated reservation-urgency contracts (2026-09-30)

**Status: FIXED (CASE C — one contract was provably dead).**
`fix(shared): resolve reservation urgency contract duplication` · start `d21de22` (= `origin/main`).
**Presentation only:** no order state, no payment state, no Stripe, no inventory, no DB, no migration,
no new status, no i18n key, no change to the 30-minute policy.

- **What M8 was.** `commerce.ts` carried two urgency scales: `PAYMENT_RESERVATION_URGENT_MS = 3 min`
  (phase → `urgent`) and `PAYMENT_RESERVATION_YELLOW_MS = 15 min` / `RED_MS = 5 min`
  (tone → green/yellow/red). Both were imported by `MyOrders.tsx` **and** `ShopOrderDetail.tsx`.
- **Proven duplicate vs distinct — from source, not names.** Every comparison against a phase value
  in the whole repository is `phase === "active" || phase === "urgent"` (3 sites), plus `=== "expired"`
  (3) and `=== "none"` (1). **No consumer ever distinguished `urgent` from `active`**, so the 3-minute
  tier could not change a pixel. The urgency users actually see is chosen from the **tone** on both
  pages (`criticalNote` at RED ≤5 min, `urgentNote` at YELLOW ≤15 min) and drives the colour maps.
- **Why it was dead (history).** §38 shipped the 3-minute phase tier; §39 (`8261152`) added the tone
  tiers and left the old one behind. Its own doc comment — *"the last three minutes stay 'urgent' too,
  which is what turns the hurry note on"* — had been **false since §39**; the note has been driven by
  `tone === "red"` (5 min). A superseded remnant, not an intentional second contract.
- **Removed:** `PAYMENT_RESERVATION_URGENT_MS` and the `"urgent"` member
  (`PaymentReservationPhase` is now `none | active | expired`). The phase is a pure window-visibility
  predicate; the tone is the single urgency authority. `MyOrders.tsx` (×2) and `ShopOrderDetail.tsx`
  (×1) drop `|| === "urgent"` — the countdown now renders **continuously** 30:00 → 00:01 while the
  note/colour escalate. The old pin `"only the last three minutes are urgent"` was **replaced**, not
  deleted: the new test asserts the phase stays `active` at six sample points, that `02:13` still
  formats identically, and that the urgency is carried by the tone.
- **Tests:** NEW `reservation-urgency-contracts.test.ts` — **34 DB-free tests** covering all eight
  required proofs, behavioural and cross-file (no tautologies). **Mutation-checked:** re-inserting
  `"urgent"` + the 3-minute branch fails 2 of them; reverting returns 34/34.
- **✅ Verification:** local `956 pass / 189 skip / 0 fail` (1145 tests / 52 files) — exactly
  +34 pass / +0 skip / +1 file over `d21de22` (`922/189`, 51 files) · backend `tsc` 0 · `typecheck`
  4/4 · `build:apps` 4/4 · i18n th=en=my=**1416** (unchanged) · `git diff --check` clean ·
  `lint` = `echo 'Lint not yet configured'` (**no real lint script**). The task brief's `pnpm …`
  commands are **NOT AVAILABLE** — this is a `bun` workspace (`bun.lock`, no `packageManager`);
  the repository's real commands were run per `.ai/context/testing.md`. No new DB-gated test (pure
  presentation logic, no SQL); the 189 skips are the pre-existing suites, unchanged.
- **✅ CI GREEN — `36648719460` (code `fcf250b`) and `36648733866` (final HEAD `fa10c52`), both
  success; `1143 pass / 2 skip / 0 fail`, 1145 tests / 52 files.** All **34** MEDIUM #8 tests report
  `(pass)`, zero failures. `Migrate Neon Database` did not trigger (no migration file changed).
- **Production: BLOCKED, unchanged by this task.** Migrations **048/049/050 are still NOT APPLIED**
  (Neon quota — **OWNER ACTION**), so production has no `orders.payment_expires_at` and **no
  countdown renders at all**; these tiers are only reachable once 048 lands. No migration file
  changed, so `Migrate Neon Database` will not re-trigger. The **browser pass over both order
  surfaces in th/en/my is still open** — "rendering is byte-identical" rests on source proof
  (one JSX branch) + 60 passing source-pinning tests, **not** on a browser run.
- **Full evidence (objective, baseline, the 15-symbol table, the 3 consumer comparisons, data flow,
  the 8 proofs, verification):**
  [`.ai/tasks/completed/reservation-urgency-contracts-2026-09-30.md`](tasks/completed/reservation-urgency-contracts-2026-09-30.md)
- **HIGH #4, HIGH #5, MEDIUM #9, LOW #12 all untouched** — no order/payment state, no `payments.status`,
  no Stripe semantics, no attempt identity, no incident handling, no inventory, no cancellation /
  refund / retry policy, no schema.

---

