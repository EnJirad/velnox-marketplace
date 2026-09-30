# Audit — VelRepeat V2 Prepaid Repeat Commerce Contract (design only)

**Date:** 2026-09-30 · **Repository:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Scope:** CONTRACT / DOMAIN DESIGN ONLY — no production code, schema, migration, payment, inventory,
scheduler or behavior-test changes; only `.ai/` documents were edited.
**Contract artifact:** `.ai/context/velrepeat-contract.md` → **VelRepeat V2 — Prepaid Repeat Commerce
Contract**, Revision 2.0 (Part III §39–§64 added; Parts I–II preserved).
**Purpose:** upgrade the VelRepeat contract to the owner's Prepaid Repeat Commerce business model so the
next task implements against an unambiguous specification instead of re-deriving the business model.

---

## 1. Repository commits inspected

| Commit | Meaning |
|---|---|
| `6f5a998` | `origin/main` when the contract's Part II was derived; source baseline for Parts I–II facts |
| `00986be` | local HEAD while Part III (V2 specification) was drafted (Task A commit: Part II + doc updates) |
| `2567707` | owner-approved 7B fix — seller-triggered due-plan processing scoped to the seller's own plans |

All `file:line` anchors cited by the contract were read from the working tree at `00986be` on
2026-09-30 (spot re-verified in this pass: `payments.order_id` NOT NULL, scheduler `sold_count`, COD
literals, PATCH delete/re-insert, resume/cancel SQL, inventory release claim, plan-run claim).

## 2. Files inspected

**Backend:** `jobs/velrepeat-scheduler.ts`, `routes/velrepeat-plans.ts`, `routes/seller-orders.ts`,
`routes/stripe.ts`, `routes/velrepeat.ts` (V1), `routes/cart.ts`, `lib/payment-config.ts`,
`lib/inventory.ts`, `lib/order-fulfillment.ts`, `lib/payment-reservation.ts`,
`jobs/payment-reservation-scheduler.ts`, `tests/velrepeat-core.test.ts`,
`tests/inventory-settlement.test.ts`, `server.ts`, `routes/index.ts`.
**Database:** `db/schema.sql` / `db/run-sqleditor.sql` (VelRepeat tables, `payments`,
`payment_incidents`, `orders`, `products`, `inventory`, `vrepeat_packages` / `vrepeat_deliveries`;
migrations end at `050_orders_status_check.sql`).
**Docs:** `.ai/AI_RULES.md`, `.ai/AI_HANDOFF.md`, `.ai/context/project-map.md`, `.ai/context/payment.md`,
`.ai/context/velrepeat-contract.md`,
`.ai/tasks/audits/medium-10-velrepeat-commerce-lifecycle-2026-09-30.md`.

## 3. Current behavior proven (summary — full evidence in contract Parts I–II)

- `payments.order_id UUID NOT NULL REFERENCES orders(id)` (`db/run-sqleditor.sql:441`) — every payment
  is order-scoped; a plan-level payment has **no canonical home**. `payment_incidents.order_id` is
  likewise `NOT NULL`.
- `commitOrderInventory` (`backend/lib/inventory.ts:115`, `sold_count` at `:141`) is reached from exactly
  one call site — `stripe.ts:559` inside `markPaymentSucceeded` (order payment settlement).
- `velrepeat_runs` has `UNIQUE (plan_id, scheduled_for)` but **no cycle ordinal, no per-cycle status**
  (`run-sqleditor.sql:865-882`); one run creates **one order per shop** (`velrepeat-scheduler.ts:262`)
  and `order_id` holds only the first order (rest in `metadata.orderIds`, `:361-364`).
- The scheduler writes `sold_count = sold_count + $1` at cycle creation (`:343-346`), consumes variant
  stock directly (`:326-335`) while the non-variant line uses `reserveInventoryStock` (`:341`), and
  inserts per-order pseudo-payment rows `method='cod', status='pending', provider='cod'` (`:350-354`)
  even though `'cod'` is not in `PaymentProvider` (`payment-config.ts:26`).
- `processPlan` re-prices every cycle against the live price and overwrites `velrepeat_items.unit_price`
  (`:229-249`) — the opposite of an immutable prepaid snapshot.
- Plan create path hard-rejects any method other than `'cod'` (`velrepeat-plans.ts:224-227`) without
  consulting `assertPaymentMethodUsable()` / `isCodEnabled()`.
- `PATCH` deletes and re-inserts `velrepeat_items` (`:444-453`), destroying item identity and snapshots;
  cancel sets status only and touches no order/payment/inventory (`:529-537`); resume is a silent
  `GREATEST(next_run_at, NOW())` deferral (`:520`); no skip endpoint exists.
- `velrepeat_plans.timezone` is inert — only echoed at `velrepeat-plans.ts:153`; all schedule math is
  UTC (`calculateNextRunAt`, `velrepeat-scheduler.ts:38-65`).
- `vrepeat_packages` / `vrepeat_deliveries` (V1) are single-product, have **zero commerce writes**, and
  are not reusable for the V2 multi-item Package concept.
- 7B fix in place: `POST /api/subscriptions/process-due` (`seller-orders.ts:751-800`) selects only plans
  containing an item of the calling seller (`EXISTS … vi.seller_id = $1`), matching the read path
  (`:695`). Residual: a multi-seller plan still runs as a whole plan when part of it matches (Q17).
- Production migrations `048`, `049`, `050` are **not applied** (Neon quota — owner action); the
  `payment_incidents` table and `orders.payment_expires_at` do not exist in production yet.

## 4. V2 business requirements (owner, 2026-09-30)

One domain model for B2C + B2B; Product | Package | Repeat Plan | Delivery Cycle | Order | Payment |
Fulfillment are distinct entities; quantity per cycle vs. total commitment quantity are separate
numbers; schedule and commitment are separate dimensions; commitment = number of delivery cycles (not
months); pricing pipeline Base→Package→Quantity→Commitment→Tier→Cycle Price→Total Prepaid with
min/max cycles, `discount_type`/`discount_value`, eligibility, tiers in data, **no hardcoded
percentages**; immutable price snapshot; **one prepaid payment per plan** (฿372 = ฿93 × 4, paid once —
not 4 payments, not 1 order with 4 deliveries); payment success ≠ all cycles complete; Repeat Plan →
Cycle 1..N hierarchy with per-cycle fields; each cycle produces its own fulfillment order with **no new
charge** and the trace `Order → Cycle → Plan → Customer → Payment`; inventory Model A vs Model B
documented but **not chosen**; `sold_count` invariants; cancellation/pause/skip/modification defined as
concepts with owner decisions reserved; idempotency incl. *same Plan + same Cycle + same execution ⇒ no
duplicate Order*; HIGH #5 incident flow preserved.

## 5. Owner decisions (approved / resolved)

| ID | Decision |
|---|---|
| **1A** | Respect `COD_ENABLED` — no VelRepeat bypass; canonical gates only |
| **2A** | Stripe is the VelRepeat payment rail |
| **3A** | `sold_count` via the canonical settlement path (moment still open, §52) |
| **4A** | 30-minute payment reservation where applicable |
| **5A** | Customer can pay VelRepeat with Stripe |
| **6A** | Durable payment incident on unsafe settlement |
| **7B** | Central scheduler only; sellers cannot trigger other customers' plans (fix `2567707`) |

(Plus the previously resolved #1/#7 in contract §21.)

## 6. New owner decisions required

**Decisions A–I (business):** A inventory reservation (whole commitment vs per cycle) · B prepaid
cancellation (refundable / non-refundable / credit / seller-defined) · C skip (postpone / consume /
credit-refund) · D pause (extend / consume / seller-defined) · E future price change (locked /
reprice) · F out-of-stock future cycle (postpone / substitute / cancel-refund-credit / seller policy) ·
G modification (future-only / prohibited / versioned) · H B2B stacking (stack / one-tier / seller) ·
I prepaid + future fulfillment failure (credit / refund / retry / seller).
**Q13–Q17 (architecture, from §38):** prepaid payment shape (A/B; C rejected) · one charge vs Stripe
Subscriptions · `vrepeat_packages` (V1) supersede-or-leave · timezone load-bearing vs UTC · per-seller
plan splitting.
**Q2 residual:** the `sold_count` recognition *moment* under prepaid (plan settlement vs per-cycle).

None of these were answered or defaulted in this task.

## 7. Architecture gaps

Database (no plan-level payment home; no cycle ordinal; no commitment/snapshot fields) · Payment (no
payable plan object; per-cycle pseudo-payments conflict) · Inventory (no plan-level reservation;
variant/non-variant asymmetry) · Order (no cycle-scoped idempotent claim; payment leg untraceable) ·
Scheduler (cycle generation semantics absent; timezone inert) · Pricing (engine + tier data absent) ·
Package (no V2 entity; V1 not reusable) · Cycle (identity unprovable) · Authorization (future surfaces
must adopt the ownership predicate; Q17 residual) · Refund (plan-level partial refunds
unrepresentable) · Cancellation (status-only today) · Pause (silent deferral) · Modification
(destructive PATCH) · Observability (no cycle-level events; incident key lacks plan/cycle).
The full CURRENT → V2 REQUIREMENT → GAP → PROPOSED SOLUTION → OWNER DECISION table is contract §61.

## 8. Risk areas

- **Push/delivery risk (environment):** the previous push attempt returned `403` for the managed
  `freebuff-web[bot]` credential; if it recurs, the fix is reconnecting the repository / updating the
  Freebuff GitHub App permissions — no credential workarounds.
- **Production DB risk:** migrations 048/049/050 unapplied (Neon quota); `payment_incidents` absent in
  production.
- **Verification risk:** DB-gated tests skip locally (no PostgreSQL); CI `postgres:16` is the only real
  execution. No production verification of anything VelRepeat V2.
- **Design risk if implemented naively:** hardcoded discount tiers, repriced snapshots, per-cycle
  charging, `sold_count++` at plan/cycle creation, destructive PATCH, partial-refund without a policy,
  duplicate payment/reservation authorities — all explicitly forbidden by contract §64.
- **Immutability risk:** historical financial records and completed cycles must never be edited.

## 9. Implementation phases (contract §62 — none started)

1. Domain + schema · 2. Package + pricing · 3. Repeat Plan · 4. Prepaid payment · 5. Delivery Cycle ·
6. Inventory · 7. Scheduler · 8. Order fulfillment · 9. Cancellation / pause / modification ·
10. Tests + E2E. Each phase is gated by the decisions in §6; stop conditions are cumulative.

## 10. Why implementation was intentionally not performed

1. **Task instruction:** the owner explicitly scoped this task as CONTRACT / DOMAIN DESIGN ONLY.
2. **Structural blockers (proven):** (a) `payments.order_id NOT NULL` leaves a prepaid charge with no
   canonical home (Q13); (b) the only `sold_count` writer is unreachable for prepaid cycles (Q2/3A
   moment); (c) `velrepeat_runs` cannot idempotently prove “cycle N ⇒ one order”.
3. **Policy gates (owner decisions):** inventory model A/B, cancellation/refund, skip/pause,
   modification pricing, out-of-stock handling, B2B stacking and prepaid-failure handling are
   unanswered — implementing any of them would invent business policy, which is forbidden.
4. **Absolute rules:** no COD enabling, no Stripe mode change, no fake API/schema, no duplicate
   inventory/payment systems, no `sold_count` at plan creation, no self-decided refund/inventory/
   pause/skip/modification/out-of-stock policy, no editing historical financial records, no deleting
   important contract content, no writing proposed behavior as current behavior.

## 11. Changes made by this task

- `.ai/context/velrepeat-contract.md` — upgraded to **VelRepeat V2 — Prepaid Repeat Commerce Contract**
  (Revision 2.0): V2 evidence-class legend (§0), retitled header, and **Part III §39–§64** (business
  definition; package; quantity per cycle; schedule; commitment; pricing; snapshot; prepaid payment;
  payment authority; payment vs fulfillment; cycle hierarchy; order; inventory A/B; `sold_count`;
  cancellation; pause/skip; modification; B2C/B2B; authorization; idempotency; incidents; **V2 owner
  decisions 1A–7B + A–I + Q13–Q17**; gap analysis; roadmap; acceptance criteria; prohibited actions).
  Parts I–II (including the MEDIUM #10 findings, payment/inventory architecture and unresolved
  decisions) are preserved.
- `.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md` — this audit.
- `.ai/AI_HANDOFF.md` — §52 records the V2 contract pass (state + gaps only).

**No files under `backend/`, `db/`, `packages/`, `apps/`, or frontends were touched. No migration, no
schema change, no payment/inventory/scheduler change, no test changing production behavior.**

## 12. Verification

- `git status` / `git diff` for this task show **only** the three `.ai/` documents above.
- `git diff --check` clean before commit.
- Docs-only change: no typecheck/test suite is affected; the repository's DB-gated tests skip locally
  (no PostgreSQL) — CI's disposable `postgres:16` remains the only real execution.
- **Production: NOT VERIFIED** (Neon quota; migrations 048/049/050 unapplied). No production PASS is
  claimed anywhere.
