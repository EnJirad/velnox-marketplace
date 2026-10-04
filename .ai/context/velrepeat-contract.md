# VelRepeat V2 — Prepaid Repeat Commerce Contract

**Status:** AUTHORITATIVE CONTRACT — **V2** (**Phase 1 implemented**: additive domain + schema; Phases 2–10 **NOT STARTED**)
**Created:** 2026-09-30 · **Baselines:** `9780aa1` (Part I) → `6f5a998` (Part II) → `00986be` (Part III) → Phase 1 (2026-09-30)
**Revision 2.3 — 2026-09-30.** Owner Decision Closure + Architecture Consistency Gate — the owner
supplied binding answers for **Q13=B, Q14, A/Q1=B, Q2, B, C, D, E, F, G, H/Q11, Q15, Q16, Q17** and the
cycle-identity direction. **`PHASE 2 = BLOCKED`** on three remaining customer-visible money /
authority questions (pricing-rule resolution, rounding/currency, package-authoring ownership) plus
`OWNER FORMULA REQUIRED` for the B/C/D/F monetary formulas. **No production code, no schema, no
migration**:
`.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` (12 sections; the Q2 conflict check
against existing commerce semantics; the five state machines mapped onto the vocabulary that actually
exists; payment / inventory / multi-seller flows; the required cycle-identity transition; the exact
Phase 2 gates).
**Revision 2.2 — 2026-09-30.** Decision Closure + Architecture Gate complete — analysis only, **no
decision answered, no code changed**: `.ai/tasks/audits/velrepeat-v2-decision-closure-2026-09-30.md`
(20 sections; Q13 options A/B/C with Option B's full surface; Q14 recomposition; inventory A/B across all
15 axes; pricing rules; Q15–Q17; the lifecycle matrix on separate Plan/Payment/Cycle/Order/Fulfillment
axes; invariants; migration safety; dependency graph; the closing Decision Matrix — every row
`OWNER DECISION REQUIRED`). The §60 register is unchanged and remains the gate.
**Revision 2.1 — 2026-09-30.** Phase 1 (domain + schema) implemented additively in both canonical SQL
files — see the closing status block and
`.ai/tasks/audits/velrepeat-v2-phase1-dependency-analysis-2026-09-30.md`. Payment linkage, inventory,
pricing rules and lifecycle behavior remain gated by §60.
**Revision 2.0 — 2026-09-30.** The owner supplied the full **Prepaid Repeat Commerce** model and approved
decisions **1A–7B**; the V2 business model adds nine owner decisions (**A–I**, §60) that are still
required before any financial, inventory or lifecycle implementation starts.
**Part I (§0–§22):** created 2026-09-30 from the MEDIUM #10 audit — the recurring-commerce contract.
**Part II (§23–§38):** added 2026-09-30 from source at `6f5a998` for the owner-supplied prepaid model.
Decisions #1 and #7 are **RESOLVED**.
**Part III (§39–§64):** added 2026-09-30 — the **normative V2 specification**. Part III states
requirements and decisions and references Parts I–II for the source evidence; it never restates current
behavior as a proposal, or a proposal as current behavior.
**Supersedes for VelRepeat:** nothing. **Governs:** all future VelRepeat implementation, tests,
inventory behavior, payment behavior and operator behavior. Where Part III is more specific than a
Part I/II rule, **Part III governs**.
**Primary evidence:** `.ai/tasks/audits/medium-10-velrepeat-commerce-lifecycle-2026-09-30.md` (MEDIUM #10),
`.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md` (V2 contract audit), plus the source they cite.

> **This document invents no policy.** Every statement is tagged with an evidence class. Where the
> repository cannot prove a business answer, the row says **OWNER DECISION REQUIRED** and the
> implementation must stop there rather than guess.

---

## 0. How to read this document

**V2 evidence classes** — the authoritative vocabulary. Part III uses these; Parts I–II keep the
shorthand below and are preserved verbatim.

| Tag | Meaning |
|---|---|
| **[PROVEN FROM SOURCE]** | Read directly from source at the cited baseline (`9780aa1` / `6f5a998` / `00986be`); `file:line` cited. |
| **[CURRENT IMPLEMENTATION]** | How the system actually works today — an aggregate of proven facts. Never a proposal. |
| **[APPROVED BUSINESS RULE]** | Explicitly approved by the owner (decisions 1A–7B, #1, #7). Binding. |
| **[V2 BUSINESS REQUIREMENT]** | A normative requirement derived from the owner's V2 business model. |
| **[PROPOSED DESIGN]** | A suggested design. **Not** current behavior and **not** yet ratified by implementation. |
| **[OWNER DECISION REQUIRED]** | No source, doc, test or owner statement answers it. **Implementation must NOT guess.** |

**Part I/II shorthand:** `[PROVEN]` = PROVEN FROM SOURCE · `[INTENT]` = documented intent (treated as
PROPOSED DESIGN where it becomes normative) · `[DECISION]` = a proposed rule, re-classified in Part III
as V2 BUSINESS REQUIREMENT or PROPOSED DESIGN · `[OWNER DECISION REQUIRED]` = unchanged.

Authority order for anything this document touches: `AGENTS.md` → `.ai/AI_RULES.md` →
`.ai/context/<subsystem>.md` → **this file** → source. When this contract and source disagree, the
source wins and **this document is wrong and must be corrected** (`.ai/AI_RULES.md` §1).

---

## 1. Purpose

Define, in one place, what a VelRepeat plan is, what a run does, and exactly how a recurring order
must behave with respect to payment, inventory, `sold_count`, order state and operators.

It exists because the MEDIUM #10 audit proved that `processPlan()` is a **second order-creation path**
that sits outside every commerce guard the rest of the system enforces. Without a written contract, a
future fix would have to invent business policy. This contract closes that gap **as far as the
repository allows** and hands the remainder to the owner.

## 2. Scope

**In scope:** `velrepeat_plans`, `velrepeat_items`, `velrepeat_runs`, `velrepeat_events`; the orders,
`order_items`, `payments` and inventory rows a run creates; and the operator surface for money a run
cannot settle.

**Explicitly OUT of scope — see §3.2:** `vrepeat_packages` / `vrepeat_deliveries` (the "VelRepeat
Packages" V1 system in `backend/routes/velrepeat.ts`). **[PROVEN]** that system writes only its own two
tables: grepping `velrepeat.ts` for `orders|payments|inventory|sold_count|reserveInventory|commitOrder|
releaseOrder` returns **no commerce write at all**. It is a delivery scheduler, not a commerce path, and
MEDIUM #10 does not concern it.

**Also out of scope:** the 30-minute online payment reservation (governed by
`.ai/context/payment.md`), which applies to orders that wait for a Stripe payment. VelRepeat's
relationship to it is **[OWNER DECISION #4]**.

## 3. Definitions

| Term | Definition | Evidence |
|---|---|---|
| **VelRepeat plan** | A customer-owned, authenticated record of recurring intent: a set of products/variants with quantities, a cadence (`days`/`weeks`/`months` + interval), a shipping address, and `payment_method` (COD-only today). | **[PROVEN]** `velrepeat_plans` DDL `run-sqleditor.sql:826-842`; created at `velrepeat-plans.ts:259-268` |
| **VelRepeat run** | One execution of one plan at one scheduled instant. Exactly one run row exists per `(plan_id, scheduled_for)`. | **[PROVEN]** `velrepeat-scheduler.ts:126-132`, `UNIQUE (plan_id, scheduled_for)` `run-sqleditor.sql:877` |
| **Recurring order** | The `orders` row a successful run creates. **One order per shop** in a multi-shop plan. | **[PROVEN]** `velrepeat-scheduler.ts:262-284`; `velrepeat-core.test.ts:223-228` |
| **Planned cadence** | `next_run_at`, advanced after each successful run by `calculateNextRunAt()`. | **[PROVEN]** `velrepeat-scheduler.ts:358, 366-369` |
| **Commercial sale** | A unit that has actually been paid for. **Distinct from "order created".** | **[DECISION]** — required by §10; not expressible in current schema |

## 4. Business lifecycle

### 4.1 What VelRepeat IS

**VelRepeat is (1): a recurring order generator that MUST use the normal commerce system.**

It is **not** (2) a separate commerce or payment path. **[DECISION]** — and the strongest argument for
this is that the repository already treats (2) as a defect, not a design:

- `backend/tests/inventory-settlement.test.ts:95-99` — a test written during CRITICAL #1/#2 names
  `velrepeat-scheduler.ts` "a **known, separate finding**", and `:100-121` deliberately **omits** it
  from the guard list that forbids every other order path from writing `sold_count = sold_count +`,
  `UPDATE inventory` or `stock = stock +`;
- `velrepeat-scheduler.ts:337-340` itself justifies its stock handling as "the same protection as the
  variant path", i.e. it is written *towards* the canonical path, not away from it;
- the run engine reuses the canonical `reserveInventoryStock()` (`velrepeat-scheduler.ts:341`) rather
  than writing its own SQL.

**[INTENT]** A *future* payment provider was anticipated — `velrepeat-scheduler.ts:18-20`: "A real
recurring payment provider (Stripe saved payment method / payment intents) **can be added later** behind
`plan.payment_method` without changing the run/order machinery." That is a statement of extensibility,
**not** of current behavior, and it does not authorize a parallel authority.

### 4.2 When a run creates an order

**[PROVEN]** (`velrepeat-scheduler.ts:110-394`), in order:

1. **Claim** (`:113-120`) — `SELECT … FOR UPDATE` re-checking `status='active' AND next_run_at <= NOW()`.
2. **Run insert** (`:126-132`) — `ON CONFLICT (plan_id, scheduled_for) DO NOTHING`; 0 rows ⇒ return
   `null` (already processed).
3. **Load items** (`:137-156`) with live product/variant/seller/inventory state.
4. **Validate** (`:174-200`) — any failure ends the run `out_of_stock` or `item_unavailable`, sets the
   plan to that status, notifies, and **creates no order**.
5. **Price** (`:229-249`) — always the current server price; a change is recorded, the snapshot updated.
6. **Create** (`:262-355`) — one order **per shop**, its `order_items`, its inventory effect, its
   `sold_count` effect, and its payment row.
7. **Advance** (`:358-369`) — run `success`, `next_run_at` moved forward.

**A run creates an order if and only if every item passes validation.** There is no partial or
degraded order.

### 4.3 The resulting order must obey the same commerce invariants

**[DECISION]** — a recurring order is an `orders` row and **must** be indistinguishable from any other
order to every downstream authority: the state machine, the payment guard, the inventory authorities,
`sold_count`, and the operator surface. Any rule that applies to an ordinary order applies to a
recurring order, and **any exception is a policy decision, not an implementation detail**.

## 5. Payment contract

### 5.1 Payment method

| Question | Answer | Evidence class |
|---|---|---|
| Is VelRepeat COD-only **today**? | **Yes** — enforced end to end. | **[PROVEN]** |
| Where is it enforced? | Frontend hardcodes it (`VelRepeatPlanDialog.tsx:107`); the route rejects anything else (`velrepeat-plans.ts:223-224`); the scheduler hardcodes the literals (`velrepeat-scheduler.ts:352`). | **[PROVEN]** |
| Can VelRepeat use Stripe today? | **Not by design** — the route refuses every non-`cod` value, and the scheduler never reads `plan.payment_method`. | **[PROVEN]** |
| Can it eventually support multiple methods? | Architecturally yes (the field exists and is surfaced in the API at `velrepeat-plans.ts:151`), but **no design is specified and none may be invented here.** | **[INTENT]** only |
| What happens when the configured method is disabled? | **Today: nothing — the run proceeds and creates a COD payment regardless.** See §6. | **[PROVEN]** — this is the defect |

**[PROVEN]** the method is never read at settlement: `velrepeat-scheduler.ts:350-354` writes
`method='cod', status='pending', provider='cod'` as literals. `plan.payment_method` is selected at
`:115` and never used again. The column is `TEXT NOT NULL DEFAULT 'cod'` with **no CHECK**
(`run-sqleditor.sql:834`).

> **Note on `provider`:** `'cod'` is written to `payments.provider`, but `PaymentProvider` is
> `"STRIPE" | "CARRIER"` (`payment-config.ts:26`). **[PROVEN]** inconsistency. Under §11 no new rail is
> introduced, so this must be reconciled to an existing value during implementation — which existing
> value is **[OWNER DECISION #2]**.

### 5.2 COD — the decisive questions

| Question | Answer | Class |
|---|---|---|
| Does VelRepeat respect `COD_ENABLED`? | **No.** `isCodEnabled()` (`payment-config.ts:313`, fails closed) is **never called** by any VelRepeat file. | **[PROVEN]** |
| Can VelRepeat bypass the payment-method guard? | **Yes, and it does.** `assertPaymentMethodUsable` has exactly two production callers — `cart.ts:697` and `stripe.ts:1066`. No VelRepeat file imports `payment-config` at all. | **[PROVEN]** |
| Is COD currently allowed for real customer fulfillment? | **No.** `paymentAllowsConfirmation` (`order-fulfillment.ts:218-235`) admits a COD row **only** while `isCodEnabled()`. With COD off, a recurring order can never reach `confirmed`. | **[PROVEN]** |
| Is a COD payment ever settled? | **No mechanism exists.** There is no carrier webhook, no COD settlement job, and no writer of `payments.status='paid'` outside the Stripe webhook. | **[PROVEN]** |

**Therefore a VelRepeat order created today is, by construction, permanently unfulfillable and
permanently unpaid — while still counting as "sold" (§10).** This is the core of MEDIUM #10.

**Whether that bypass is permitted at all is [OWNER DECISION #1].** The repository proves what the code
does; it does not prove that doing so is intended. `.ai/context/payment.md` says COD must stay disabled
"until a carrier/settlement model exists" — which is precisely the model VelRepeat lacks.

## 6. COD contract (dedicated table)

| Question | Evidence | Contract |
|---|---|---|
| COD enabled globally? | `INSTALLATION.md:147-148, 464-465`; `docs/ENVIRONMENT.md:35-36` — both default **OFF**; `payment-config.ts:313-329` fails closed. **[PROVEN]** | Default off. A run MUST NOT create a COD payment while the rail is off. **[DECISION]** |
| VelRepeat can create COD? | `velrepeat-scheduler.ts:350-354`. **[PROVEN]** | Only when the rail is on. **[OWNER DECISION #1]** |
| VelRepeat can bypass the COD guard? | Yes today — no `payment-config` import in any VelRepeat file. **[PROVEN]** | **MUST NOT.** Every payment-creating path must pass `assertPaymentMethodUsable()`. **[DECISION]** — the bypass is the defect MEDIUM #10 names, and §18 forbids it. |
| COD can settle? | No settlement mechanism exists anywhere. **[PROVEN]** | **[OWNER DECISION #2]** |
| COD can enter fulfillment? | `order-fulfillment.ts:230` — only while `isCodEnabled()`. **[PROVEN]** | Only after a real settlement, per **[OWNER DECISION #2]**. |
| COD cancellation? | Customer cancel `cart.ts:1400`; seller `seller-orders.ts:629`; operator `center.ts:531`. `assertNoSettledPaymentForCancellation` (`order-fulfillment.ts`) refuses when money settled. **[PROVEN]** | Unchanged. A COD order with no settlement is cancellable by all three. **[DECISION]** |
| COD inventory release? | `releaseOrderInventory` would succeed (status `pending` ∈ releasable, `inventory_released=FALSE`, payment not settled). **[PROVEN]** but **nothing triggers it on a schedule.** | Per §11. **[DECISION]** |

## 7. Stripe contract

VelRepeat is **not** a Stripe customer today. Stated explicitly, as required:

- **Can a run create a Stripe payment?** No. The route rejects non-`cod` (`velrepeat-plans.ts:223-224`)
  and the scheduler hardcodes `'cod'` (`velrepeat-scheduler.ts:352`). **[PROVEN]**
- **Can a recurring order be paid through the existing Stripe checkout?** **[PROVEN] YES — and this is a
  defect.** `stripe.ts:1095` accepts `orders.status IN ('pending','pending_payment')`, a run creates
  `'pending'`, and the window check at `:1110` is skipped because `payment_expires_at` is NULL. A
  customer pressing "continue payment" reaches `markPaymentSucceeded` → `commitOrderInventory`, which
  then runs **on top of** the creation-time `sold_count` increment → **the same units are counted as
  sold twice** (MEDIUM #10 finding E). Under §18 this must be impossible; whether the order should be
  payable at all is **[OWNER DECISION #5]**.
- **Can a recurring order receive Stripe webhook settlement?** Mechanically yes, with the double-count
  above. **[PROVEN]**
- **Does it use the existing payment-attempt identity rules (HIGH #4)?** Automatically — every Stripe
  settlement goes through `markPaymentSucceeded`/`resolvePaymentAttemptRow` (`stripe.ts`), so attempt
  identity is inherited, not bypassed. **[PROVEN]**
- **Does it use the existing payment-incident mechanism (HIGH #5)?** **[PROVEN] YES, and it is the
  safety net.** `payment-incidents.ts` fires from the Stripe webhook, so an *online-paid* recurring
  order that cannot settle becomes a durable incident. But a **COD** recurring order never reaches that
  webhook, so **COD money is owed with no incident, no operator queue and no record** — the exact failure
  HIGH #5 was created to end, re-opened for this path. See §15.
- **No recurring Stripe/subscription behavior is invented here.** The only forward-looking statement in
  the repository is `velrepeat-scheduler.ts:18-20` ("can be added later"), which is **[INTENT]**, not a
  specification.

## 8. Order-state contract

**No new statuses.** The canonical 12 (`orders_status_check`, MEDIUM #9, V0050): `pending`, `pending_payment`,
`paid`, `payment_failed`, `refunded`, `cancelled`, `confirmed`, `packing`, `shipped`, `delivered`,
`completed`, `expired`.

| Transition | From → To | Actor / trigger | Current source | Contract |
|---|---|---|---|---|
| **Initial** | — → `pending` | the run | `velrepeat-scheduler.ts:272` **[PROVEN]** | unchanged **[PROVEN]** |
| **Payment opened** | `pending` → `pending_payment` | customer pays online | **never reached by a run** | **[OWNER DECISION #5]** |
| **Payment settled** | `pending` → `paid` | Stripe webhook only | `stripe.ts:431` **[PROVEN]** | unchanged |
| **Payment failed** | `pending` → `payment_failed` | Stripe webhook | `stripe.ts:610` **[PROVEN]** | unchanged |
| **Fulfillment starts** | `pending` → `confirmed` | seller/operator | `seller-orders.ts:617`, `center.ts:517`, gated by `canTransitionFulfillment` + `assertPaymentConfirmedForConfirmation` | `confirmed` = **seller accepted the order** **[PROVEN]** |
| **Picked/packed** | `confirmed` → `packing` | seller/operator | same | `packing` = **fulfillment has started** **[PROVEN]** |
| **Cancelled** | `pending` → `cancelled` | customer / seller / operator | `cart.ts:1369`, `seller-orders.ts:617`, `center.ts:517` | **MUST NOT** be possible after `packing` — `packing` has no edge to `cancelled` (`order-fulfillment.ts:89-97`) **[PROVEN]** |
| **Expired** | `pending` → `expired` | expiry sweep | **unreachable for a run** — `payment_expires_at` is NULL and the sweep requires `IS NOT NULL` (`payment-reservation-scheduler.ts:83-84, 154-155`) | **[OWNER DECISION #4]** |

**[PROVEN]** no state-machine violation exists today: `'pending'` is legal under `orders_status_check`.
The findings are about the lifecycle *around* the state, not the vocabulary.

**Run statuses are a separate axis** (`velrepeat_runs.status`, `run-sqleditor.sql:871`). **[PROVEN]** only
four of its eight legal values are ever written: `processing` (`:128`), `success` (`:361`),
`out_of_stock` and `item_unavailable` (`:183`). **`payment_failed`, `price_changed`, `failed` and
`cancelled` are unreachable** — dead enum values. The contract must not rely on them; if a settlement
step is introduced, `[OWNER DECISION #2]` decides whether they are used or the enum is narrowed.

## 9. Inventory contract

**Canonical authorities — exactly one of each. [PROVEN]**

| Function | Definition | Callers |
|---|---|---|
| **Reserve** | `reserveInventoryStock` `inventory.ts:54` | `cart.ts:972` · `velrepeat-scheduler.ts:341` |
| **Commit** (settlement) | `commitOrderInventory` `inventory.ts:115` | **`stripe.ts:559` only** |
| **Release** | `releaseOrderInventory` `inventory.ts:209` | `cart.ts:1400` · `stripe.ts:614` · `stripe.ts:661` · `seller-orders.ts:629` · `center.ts:531` · `payment-reservation-scheduler.ts:183` |

A recurring order **MUST** use these three and **MUST NOT** write `inventory`, `product_variants.stock`
or `sold_count` itself. **[DECISION]** — this is exactly the invariant
`inventory-settlement.test.ts:100-121` already enforces for the other five order paths.

### Before payment

| Question | Contract | Class |
|---|---|---|
| Reserve inventory? | **Yes** — hold, do not consume. Availability (`quantity - reserved`) falls; `quantity` does not. | **[DECISION]** |
| Consume variant stock? | **No.** A variant line is currently decremented **directly** (`velrepeat-scheduler.ts:326-335`) — a *consume*, asymmetric with the non-variant line in the same loop. | **[DECISION]** — the variant line must be converted to a hold to match. |
| Consume available quantity? | **No.** | **[DECISION]** |
| Do nothing until payment? | **No** — a hold is required, or concurrent checkout can oversell (`velrepeat-scheduler.ts:337-340`). | **[PROVEN]** |

### After successful payment

| Question | Contract | Class |
|---|---|---|
| When does `quantity` decrease? | At **settlement**, inside `commitOrderInventory` (`inventory.ts:126-134`), for non-variant lines only. | **[PROVEN]** |
| When does `reserved` decrease? | At settlement (commit) **or** at release — never both. Enforced by `inventory_released` + `status = ANY(RELEASABLE_STATUSES)` + the no-settled-payment gate (`inventory.ts:223-231`). | **[PROVEN]** |
| When does variant stock change? | At reserve (down) and at release (up); **unchanged by commit** — the commit path deliberately leaves it where the reservation put it (`inventory.ts:129-135`, MEDIUM #7). | **[PROVEN]** |
| When does `sold_count` increment? | **At settlement, by `commitOrderInventory` only.** See §10. | **[DECISION]** |

### Failed payment · Expired payment · Cancellation

| Scenario | Contract | Class |
|---|---|---|
| **Failed payment** | `orders.status='payment_failed'`, `payments.status='failed'`, release via `stripe.ts:614`. Idempotent: the `inventory_released` claim means a second call is a no-op (`inventory.ts:225`). | **[PROVEN]** |
| **Expired payment** | Only exists if a window exists — **[OWNER DECISION #4]**. Release is performed by `payment-reservation-scheduler.ts:183` through the same `releaseOrderInventory`. | **[PROVEN]** mechanism, **[OWNER DECISION]** applicability |
| **Cancellation** | Allowed from `pending` (and `pending_payment`/`confirmed` for a customer) — `CUSTOMER_CANCELABLE_ORDER_STATUSES` (`commerce.ts:934`). Release by `releaseOrderInventory`. **Refused** when money has settled (`assertNoSettledPaymentForCancellation`) and after `packing`. | **[PROVEN]** |

> **[PROVEN] a release mechanism already exists and is sound** for a recurring order: status `pending` is
> in `RELEASABLE_STATUSES` (`inventory.ts:176-181`), `inventory_released` defaults `FALSE`
> (`run-sqleditor.sql:377`), and the payment is not settled. The defect is that **nothing schedules it**.

## 10. sold_count contract

**Question: when exactly does VelRepeat increment `products.sold_count`?**

**Answer: at settlement, by `commitOrderInventory()` — and nowhere else.**

`commitOrderInventory` (`inventory.ts:115`, sold_count at `:141`) **is** the canonical settlement
authority. This is *proven*, not chosen:

- **[PROVEN]** `inventory-settlement.test.ts:120` asserts that **every** order-lifecycle path —
  `cart.ts`, `stripe.ts`, `seller-orders.ts`, `center.ts`, `payment-reservation-scheduler.ts` — must
  **not** contain `sold_count = sold_count +`, and `:129` repeats it for `stripe.ts`;
- **[PROVEN]** `inventory-settlement.test.ts:98-99` names `velrepeat-scheduler.ts` the **known
  exception** to that rule;
- **[PROVEN]** `commitOrderInventory` has exactly one caller, `stripe.ts:559` — the settlement webhook.

**Current VelRepeat behavior — `velrepeat-scheduler.ts:343-346`, incrementing inside the item loop at
order creation — violates this invariant. It is not a second authority; it is the absence of one.**

### The guarantee

> **One successfully sold unit = exactly one `sold_count` increment.**
>
> **Order creation alone ≠ a completed sale.**

`createOrder()` is not a sale; `commitOrderInventory()` is. **[DECISION]** — this follows directly from
the canonical authority, and the implementation must therefore make settlement reachable for a
recurring order, which is blocked on **[OWNER DECISION #2]**.

**If the owner instead wants "order placed = sold" for recurring orders, that is a legitimate business
definition — but it must be stated explicitly, applied consistently, and must still prevent the
double-count in §7 (creation increment + later `commitOrderInventory`).** Choosing it is
**[OWNER DECISION #3]**. Either way the rule is *exactly one increment per unit*, and it must be
enforced by a test, not by convention.

## 11. Reservation contract

| Element | Contract | Class |
|---|---|---|
| **Reservation start** | When the run creates the order, inside the run's single transaction. | **[PROVEN]** (`velrepeat-scheduler.ts:111-394`) |
| **Reservation duration** | The online reservation is a **constant 30 minutes** (`PAYMENT_RESERVATION_MINUTES`, `payment-reservation.ts:44`). **COD deliberately has no window** — `payment.md`: *"COD gets no window at all (nothing online is waited on)"*. | **[PROVEN]** |
| **Reservation expiration** | `payment-reservation-scheduler.ts:80-92`, requiring `payment_expires_at IS NOT NULL`. | **[PROVEN]** |
| **Release trigger** | `releaseOrderInventory` — the ONE release authority. | **[PROVEN]** |
| **Commit trigger** | Settlement via `markPaymentSucceeded` → `commitOrderInventory`. | **[PROVEN]** |
| **Cancellation trigger** | Customer / seller / operator cancel, after the status claim. | **[PROVEN]** |
| **Idempotency** | The atomic `UPDATE orders … WHERE inventory_released = FALSE AND status = ANY(RELEASABLE_STATUSES) AND NOT EXISTS (settled payment) RETURNING id` claim (`inventory.ts:220-231`) means exactly one caller wins. | **[PROVEN]** |
| `inventory_released` | The once-only release flag. Default `FALSE`. | **[PROVEN]** |
| `payment_expires_at` | **NULL for every recurring order** — the run's INSERT (`:270-273`) omits it, and `applyPaymentReservationPolicy` has exactly one caller, `cart.ts:1000`. Consequence: the expiry sweep **can never select a recurring order**. | **[PROVEN]** |
| `reservation_policy` | Also never written by a run → NULL. The storefront shows no countdown and no progress bar for a recurring order. | **[PROVEN]** |

**Does VelRepeat follow the 30-minute policy? [OWNER DECISION #4].**

The repository proves COD has no window (`.ai/context/payment.md`, `.ai/context/checkout.md`), which is
consistent with the current `NULL`. **What the repository does not prove is what ends a recurring
order's hold when no window and no settlement exist** — today, nothing. That gap is unresolvable
without **[OWNER DECISION #2]** (settlement) or an explicit hold-expiry policy.

## 12. Cancellation contract

- **Allowed from:** `pending`, `pending_payment`, `confirmed` — customer
  (`CUSTOMER_CANCELABLE_ORDER_STATUSES`, `commerce.ts:934`, pinned against `cart.ts` by
  `customer-order-cancel.test.ts`). Seller/operator cancellation is gated by
  `canTransitionFulfillment`. **[PROVEN]**
- **Refused after `packing`** — `packing` has no edge to `cancelled`
  (`order-fulfillment.ts:89-97`). **[PROVEN]**
- **Refused when money settled** — `assertNoSettledPaymentForCancellation` returns 409
  `ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`. **[PROVEN]**
- **Inventory effect:** `releaseOrderInventory` restores `reserved` (non-variant) or `stock`
  (variant), exactly once. **[PROVEN]**
- **Plan-level cancellation** (`velrepeat-plans.ts:548`) cancels the **plan**, not any order it already
  produced. **[PROVEN]** — a plan cancellation MUST NOT be treated as an order cancellation.
- **[DECISION]** A recurring order MUST follow the identical cancellation rule as an ordinary order,
  including the fulfillment boundary and the settled-payment refusal.

## 13. Failure / expiry matrix

Every cell is grounded in existing canonical behavior or an explicit owner decision. **[PROVEN]** means
today's real, source-read behavior — which for the bottom rows is the divergence this contract must fix.

| Scenario | Order | Payment | Inventory | `sold_count` | Run / Plan |
|---|---|---|---|---|---|
| **Run succeeds** | `pending` (1 per shop) | created `cod`/`pending` | variant **consumed**; non-variant **held** | **+N at creation** ⚠️ | run `success`; `next_run_at` advanced |
| **Out of stock** | none created | none | untouched (throw at `:334` rolls back) | untouched | run `out_of_stock`; plan → `out_of_stock`; notified |
| **Item unavailable** | none created | none | untouched | untouched | run `item_unavailable`; plan → `item_unavailable`; notified |
| **No items** | none created | none | untouched | untouched | run `item_unavailable`; plan → `cancelled`; `PLAN_CANCELLED` |
| **Payment pending** (steady state) | `pending`, unfulfillable while COD off | `cod`/`pending` **forever** | hold **indefinite** | already counted | run `success` — no further transition |
| **Payment succeeds (online)** | → `paid` | → `paid` | commit **plus** the creation hold | **+N a second time** ⚠️ | unchanged |
| **Payment fails** | → `payment_failed` | → `failed` | released (`stripe.ts:614`) | unchanged (must not count) | run status unreachable |
| **Payment expires** | → `expired` | → `cancelled` | released (sweep `:183`) | unchanged | unreachable for a run (no window) |
| **Customer cancels** | → `cancelled` | untouched | released (`cart.ts:1400`) | **must be reversed if §10 applies at creation** ⚠️ | unchanged |
| **Seller cancels** | → `cancelled` | untouched | released (`seller-orders.ts:629`) | as above | unchanged |
| **Late payment event** | never resurrected | recorded on the payment row | untouched | untouched | HIGH #5 incident may fire |
| **Duplicate event** | no-op (attempt guards) | no-op | no-op | no-op | `ON CONFLICT DO NOTHING` on runs |
| **Retry payment** | **[OWNER DECISION #2]** | — | — | — | — |

⚠️ = the divergence MEDIUM #10 exists to close.

**[PROVEN] "Customer cancels" is the sharpest cell.** Under the current creation-time increment, a
cancelled recurring order has already inflated `sold_count` and **nothing decrements it** — the release
path restores stock but not the counter. §10 must therefore settle the increment question before
cancellation can be correct.

## 14. Idempotency contract

| Surface | Mechanism | Class |
|---|---|---|
| **Plan run** | `UNIQUE (plan_id, scheduled_for)` + `ON CONFLICT DO NOTHING` (`:126-132`); plus `SELECT … FOR UPDATE` re-checking `status='active' AND next_run_at <= NOW()` (`:113-120`). Two concurrent workers ⇒ exactly one run. | **[PROVEN]**, tested (`velrepeat-core.test.ts:156-236`) |
| **Order creation** | Keyed to the run; a skipped run creates nothing. | **[PROVEN]** |
| **Payment creation** | One per order, inside the run transaction. A replayed run is blocked by the run guard. | **[PROVEN]** |
| **Settlement** | `commitOrderInventory` behind `stripe.ts:433`'s `inventory_released = FALSE` guard + HIGH #4 attempt guards. | **[PROVEN]** |
| **Inventory commit** | Same claim. | **[PROVEN]** |
| **Inventory release** | Atomic `inventory_released` claim — exactly one winner, losers are no-ops. | **[PROVEN]** |
| **`sold_count`** | **NO IDEMPOTENCY TODAY.** The creation-time increment (`:343-346`) is not guarded, and combined with a later settlement it double-counts. | **[PROVEN] gap** |
| **Cancellation** | Status guard + the release claim. | **[PROVEN]** |
| **Webhook delivery** | `payment_events` UNIQUE `event_id` + `ON CONFLICT DO NOTHING` (`stripe.ts:1536-1541`); re-arm path for a previously-failed event. | **[PROVEN]** |

**Required:** the implementation must guarantee **no duplicate run, order, settlement, inventory
mutation, `sold_count` increment, or release** — under repeated scheduler ticks, repeated webhook
delivery, and concurrent workers.

## 15. Operator / incident contract

Follows the HIGH #5 philosophy, which `.ai/context/payment.md` already states: *"never resurrect … No
refund is invented in code — an operator decides."*

- **Money that cannot safely settle becomes a durable, operator-visible incident.** **[PROVEN]** the
  mechanism exists — `payment_incidents` (migration **049**, `backend/lib/payment-incidents.ts`),
  VelCenter tab `incidents`, permissions `orders.view` (list) / `orders.manage` (resolve). Tests assert
  the resolve route performs **no** `UPDATE orders/payments/refunds` and no inventory work.
- **Never** automatic refunds, automatic retries, order reopening, or manual payment mutation.
  **[PROVEN]** as standing policy.
- **[PROVEN] The gap this contract must close:** a **COD** recurring order produces **no** Stripe
  webhook, so `payment-incidents.ts` **never fires** for it. Money that is owed has no record, no
  queue and no acknowledgement — precisely the class of loss HIGH #5 was created to eliminate.
- **[OWNER DECISION #6]:** what operator surface, if any, exists for a recurring order that can never
  settle. No new UI or status may be invented here.

## 16. Authorization contract

Reuse the existing systems. **No parallel permission model.**

| Action | Who | Enforcement | Class |
|---|---|---|---|
| Create / list / read a plan | the owning customer | `requireAuth` + `WHERE user_id = $1` / `id = $1 AND user_id = $2` (`velrepeat-plans.ts:195, 304, 337`) | **[PROVEN]** |
| Modify a plan (items, cadence, address) | the owning customer | `requireAuth` + `id = $1 AND user_id = $2` (`:372, 487`) | **[PROVEN]** |
| Pause / resume / cancel a plan | the owning customer | `requireAuth` + `id = $1 AND user_id = $2` (`:557`) | **[PROVEN]** |
| Run-now | the owning customer | `requireAuth` + `id = $1 AND user_id = $2` (`:588`) | **[PROVEN]** |
| Repeat-now from an order | the owning customer | `requireAuth` + `SELECT id FROM orders WHERE id = $1 AND user_id = $2` (`:643`) | **[PROVEN]** |
| Seller VelRepeat overview | approved/active seller | `requireAuth, requireApprovedSeller` (`:716`; `middleware/seller.ts:58`) | **[PROVEN]** |
| Seller delivery updates (V1) | approved/active seller | `requireAuth, requireApprovedSeller` (`velrepeat.ts:442, 488`) | **[PROVEN]** |
| Admin VelRepeat overview | owner / admin / staff | inline `users.role` check (`:784`) — **not** the shared permission catalog | **[PROVEN]** — consistent with HIGH #5's VelCenter tab |
| **Trigger the due-plan worker** | approved seller | `requireAuth` + seller check, then **`SELECT id FROM velrepeat_plans WHERE status='active' AND next_run_at <= NOW()` with NO user scope** (`seller-orders.ts:755-788`) | **[PROVEN] ⚠️** |

> **[PROVEN] Authorization finding.** `POST /api/subscriptions/process-due` lets **any** approved seller
> force-run **any** customer's due plans, early and cross-tenant. It is not a data leak (it returns
> counts only) but it is a cross-tenant side-effect trigger. **[OWNER DECISION #7]:** should it be
> scoped to the seller's own products, restricted to staff, or removed in favour of the scheduler?
> **No change is made here** — it is recorded, not fixed.

Ownership of a *generated* order: it belongs to the **plan's** `user_id`
(`velrepeat-scheduler.ts:275`), so the customer can see and cancel it like any other order. **[PROVEN]**

## 17. Invariants

Any implementation of this contract must preserve all of the following.

1. **Order lifecycle** — a recurring order follows the canonical order lifecycle; no new status.
2. **Payment guard** — no payment row is ever created for a method that is not currently usable
   (`assertPaymentMethodUsable`). *Currently violated.*
3. **Inventory** — every reservation reaches **exactly one** terminal outcome: commit **or** release,
   never both, never neither.
4. **`sold_count`** — a unit contributes **exactly once**, at settlement, via `commitOrderInventory`.
   *Currently violated.*
5. **Cancellation** — cannot bypass the fulfillment boundary or the settled-payment refusal.
6. **Idempotency** — repeated scheduler or webhook execution cannot duplicate any commerce effect.
7. **Incidents** — money that cannot safely settle becomes a durable, operator-visible record.
8. **Single authority** — exactly one canonical function for payment settlement, inventory commit,
   inventory release and `sold_count`.
9. **Transactionality** — a run's commerce effects are atomic (§19).
10. **Presentation** — `paymentReservationPhase`/`paymentReservationTone` (MEDIUM #8) are presentation
    only and MUST NOT move state.

## 18. Forbidden behaviors

The implementation MUST NOT, under any circumstance:

1. Create an order, payment, reservation or `sold_count` increment outside a run's transaction.
2. Bypass `assertPaymentMethodUsable`, or treat a disabled rail as available.
3. Write `inventory`, `product_variants.stock` or `sold_count` from an order path — only the three
   canonical functions may.
4. Introduce a second inventory authority, or a second `sold_count` authority.
5. Introduce a new order, payment or run status.
6. Invent an automatic refund, automatic retry, order reopening, or a manual payment mutation.
7. Change the order state machine, `orders_status_check`, or any fulfillment boundary.
8. Add a migration or edit schema without both canonical SQL files in step (and never
   `db/run-update.sql`).
9. Bypass auth, or introduce a parallel permission model.
10. Create a second order-creation path.

## 19. Transaction boundary (current, proven, to be preserved)

`processPlan()` runs the **entire** run inside one `withTransaction` (`velrepeat-scheduler.ts:111-394`):
claim, run insert, order, order_items, payment, inventory effect, `sold_count`, run/plan state.

- **Commit point:** the return from `withTransaction` (`:394`).
- **Rollback point:** any throw — e.g. `INSUFFICIENT_STOCK` at `:334`.
- **Stranding risk:** **none from a mid-run failure** — the run rolls back cleanly and the plan stays
  active for retry (`:337-340`).

**[PROVEN]** the real risk is a *fully committed* wrong transaction: the run commits `success` with a COD
payment that no settlement path will ever reach. Correctness of the transaction boundary is **not** the
defect; the content it commits is.

## 20. Implementation acceptance criteria

A future implementation is complete only when **all** of these are true and demonstrated by tests.

### Commerce
- A recurring order is an ordinary `orders` row and passes through the canonical lifecycle.
- Its initial status and every transition are drawn from the canonical 12.
- It cannot be confirmed while its payment is unconfirmed.

### Payment
- No VelRepeat payment can bypass a disabled payment rail — proven by a test with `COD_ENABLED` unset.
- Creating a plan with a disabled method is refused with the canonical error code.
- The payment rail for VelRepeat is **explicitly owner-approved** (not assumed).

### Inventory
- Every reservation reaches exactly one commit or one release.
- A variant line and a non-variant line mutate stock in the **same** way.
- `inventory_released` guarantees at-most-once release under concurrency.

### sold_count
- A unit contributes to `sold_count` **exactly once**, at settlement.
- Cancelling a recurring order does not leave an inflated `sold_count` **or** an inflated counter that
  is never reversed.
- A test proves the increment does not happen at order creation.

### Cancellation
- Cancellation cannot bypass the `packing` boundary or the settled-payment refusal.

### Idempotency
- Two concurrent `processPlan` calls ⇒ one run, one order, one payment, one `sold_count` effect.
- A replayed webhook cannot double-settle, double-commit or double-release.
- A replayed run cannot re-apply `sold_count`.

### Payment incidents
- Money that cannot safely settle — **including a COD recurring order** — becomes a durable,
  operator-visible incident.

### No parallel authorities
- Exactly one canonical function each for settlement, inventory commit, inventory release and
  `sold_count`; a test asserts no order path writes those rows directly (extend the existing
  `orderPaths` guard to include the VelRepeat path).

---

## 21. Owner decisions required

These **cannot** be proven from the repository. Implementation MUST stop at each one rather than guess.

> ✅ **RESOLVED 2026-09-30 (owner): Decision #1 — Does VelRepeat respect `COD_ENABLED`?**
> **YES — no exemption.** `COD_ENABLED=false` must never be bypassed to create a VelRepeat COD
> transaction. Every VelRepeat payment path goes through the canonical
> `assertPaymentMethodUsable()` / `isCodEnabled()` / `isCodCustomerSelectable()` in
> `payment-config.ts`. **No VelRepeat-specific bypass may exist.**
> **This decision does NOT enable COD** — the rail stays off until an operator turns it on, and it
> also does not, by itself, wire Stripe: the prepaid Stripe model is blocked on **§38 Q1–Q12**.

> **OWNER DECISION #2 — What payment rail is officially supported for VelRepeat, and what settles it?**
> A COD payment has **no** settlement mechanism: no carrier webhook, no settlement job, no writer of
> `payments.status='paid'` outside Stripe. Until a rail is chosen, "reserve now, commit later" cannot be
> implemented and no recurring order can legitimately reach `confirmed`.

> **OWNER DECISION #3 — When is a recurring item considered sold?**
> Order creation (current) or settlement (canonical)? If creation, §10's exactly-once rule must still
> hold and cancellation must reverse the counter.

> **OWNER DECISION #4 — Does VelRepeat use the standard 30-minute payment reservation?**
> COD is documented as having no window, which is consistent with today's `NULL` — but then **what ends
> the hold?** The expiry sweep can never select a recurring order, so today nothing does.

> **OWNER DECISION #5 — May a recurring order be paid online?**
> It currently can be (`status='pending'`, no window), and doing so double-counts `sold_count`. If the
> answer is yes, that defect must be fixed first; if no, the order needs to be non-payable — which is a
> state-machine decision.

> **OWNER DECISION #6 — What operator surface exists for a recurring order that can never settle?**
> HIGH #5's `payment_incidents` fires from the Stripe webhook only, so a COD recurring order produces no
> incident. Without this, money is owed invisibly.

> ✅ **RESOLVED 2026-09-30 (owner): Decision #7 — May an approved seller trigger due plans that are not
> theirs?**
> **NO.** The **central scheduler owns global due-plan processing**. A seller must never force-run a
> customer's plan that is not theirs. Seller-scoped operations must be **ownership-enforced** — the
> due-plan query is restricted to plans that contain at least one item belonging to the calling
> seller. Implemented 2026-09-30 (see §35).

---

## 22. What this contract deliberately does NOT do

- It does **not** change any line of production code, test, schema or migration.
- It does **not** enable or disable COD, and does not assume a value for either flag.
- It does **not** introduce a payment rail, a status, a refund/retry/reopen policy, or a permission model.
- It does **not** treat the current VelRepeat divergence as intentional. §42.2 **M10 remains OPEN**, and
  MEDIUM #8 / MEDIUM #9 / LOW #12 results are untouched.
- It does **not** claim production verification. Migrations **048/049/050 remain unapplied** (Neon
  quota); no Stripe or browser E2E has ever run.

**Implementation status: PARTIAL — see §23–§38 and Part III (§39–§64). §23–§38 were added 2026-09-30
(owner-supplied Prepaid Repeat Commerce business model); Part III is the normative V2 specification.
Decisions #1 and #7 are RESOLVED and 1A–7B are approved; the prepaid payment, inventory,
sold-recognition and lifecycle semantics remain blocked on §38 Q1–Q17 and §60 Decisions A–I.**

---

# PART II — PREPAID REPEAT COMMERCE (added 2026-09-30)

**Added because** the owner defined VelRepeat as a **Prepaid Repeat Commerce** system, not a
subscription that re-orders. The model the owner requires:

```
Customer → Product or Package → quantity per cycle → delivery schedule
        → commitment (cycles) → tiered price → ONE prepaid payment
        → Repeat Plan → N Delivery Cycles → one order per cycle
```

Everything below is re-derived from source at `6f5a998`. The same tag rules as §0 apply:
**[PROVEN]** / **[INTENT]** / **[DECISION]** / **[OWNER DECISION REQUIRED]**.

---

## 23. Current facts for each business-model concept (STEP-3 table)

| Concept | Exists today? | Evidence at `6f5a998` | Class |
|---|---|---|---|
| **Product** | Yes, fully. | `products` `run-sqleditor.sql:207+`, variants `product_variants`, inventory `inventory:322`. | **[PROVEN]** |
| **Package** (multi-item commercial composition) | **No.** No table, no route, no type. `velrepeat_items` is *already* multi-item per plan (`:846`) — it is the nearest thing, but it is a plan line, not a reusable/sellable composition, and it carries no package price of its own. | grep `package` in VelRepeat V2 files → only `Package` word usage in V1 `vrepeat_packages`. | **[PROVEN] ABSENT** |
| **Repeat Plan** | Yes. | `velrepeat_plans` `:823-842`. | **[PROVEN]** |
| **Plan Item** | Yes. `quantity` already exists per line. | `velrepeat_items` `:846-857`, `quantity INTEGER CHECK (quantity > 0)` `:851`. | **[PROVEN]** |
| **Pricing snapshot** | **No.** `velrepeat_items.unit_price` is a *mutable running snapshot* — `processPlan` **overwrites it** on every run when the product price moves (`:244-248`) and notifies the customer. That is the exact opposite of an immutable prepaid snapshot. | `velrepeat-scheduler.ts:233-249`. | **[PROVEN] ABSENT / actively contradicted** |
| **Schedule** | Partially. `frequency_type` (`days`/`weeks`/`months`) + `interval_value > 0` **already covers 7 / 14 / 30 days** (`days/7`, `days/14`, `days/30`). No constraint ties the two together, and the schedule is **not** stored per cycle. | `run-sqleditor.sql:827-828`; `calculateNextRunAt` `:38-65`. | **[PROVEN] present, under-specified** |
| — timezone | **Column exists and is decorative.** `velrepeat_plans.timezone` is only echoed back to the API (`velrepeat-plans.ts:153`); **no code writes it and no code uses it**. All schedule math is UTC (`setUTCDate`, `NOW()`). | `:829`; `:114-123`; `:358`. | **[PROVEN] inert → timezone correctness is ABSENT** |
| **Commitment** (number of prepaid cycles) | **No.** No column, no counter, no end-of-commitment computation. `velrepeat_plans.status` allows `'completed'` and **nothing ever writes it** — a plan is only ever `active`/`paused`/failure-status/`cancelled`. | `:826` (status CHECK); grep shows no writer of `'completed'` for a plan. | **[PROVEN] ABSENT** |
| **Tiered pricing by commitment** | **No.** No tier table, no discount logic anywhere. The illustrative 0/3/7/10/15 % in the owner brief has **no source and must not be hardcoded**. | absence across `backend/`. | **[PROVEN] ABSENT** |
| — existing quantity pricing | Partial, and **belonging to V1 only**: `products.vrepeat_weekly_price / vrepeat_monthly_price / vrepeat_weekly_qty / vrepeat_monthly_qty / vrepeat_min_qty / vrepeat_max_qty` exist (`:224-232`). They are read by `velrepeat-plans.ts:68,85-92` **only to bound quantity**, and priced by `velrepeat.ts:138-143` (**V1**, zero commerce writes). | verified above | **[PROVEN] partial, unused for V2 pricing** |
| **Prepaid payment** | **No — and structurally impossible today.** `payments.order_id` is `NOT NULL REFERENCES orders(id)`. There is no plan-level payment row, and no column anywhere points a payment at a plan. | `run-sqleditor.sql:441`. | **[PROVEN] ABSENT + structural blocker (§25)** |
| **Delivery cycle** | **No cycle entity.** `velrepeat_runs` is keyed `UNIQUE (plan_id, scheduled_for)` — structurally the natural cycle key — but it has **no cycle number, no commitment boundary, no per-cycle status of its own**, and `velrepeat_runs.order_id` holds only the **first** order id while the rest live in `metadata.orderIds`. | `run-sqleditor.sql:865-882`; `:361-364`. | **[PROVEN] nearest thing, insufficient** |
| **Order per cycle** | One order **per shop per run** — so a multi-shop plan produces **N orders for one cycle**, and a cycle has no identity. | `:262`, `:252-258`; `velrepeat-core.test.ts:223-228`. | **[PROVEN] 1 cycle : N orders** |
| **Inventory reserve / commit / release** | Yes, canonical — but VelRepeat calls only **reserve**, and does it at *cycle creation* only. | §9; `velrepeat-scheduler.ts:341`. | **[PROVEN] partial** |
| **`sold_count`** | **Violating.** Written directly at order creation (`:343-346`), bypassing `commitOrderInventory`. | §10. | **[PROVEN] defect** |
| **Pause / skip** | Pause/resume exist (`velrepeat-plans.ts:495-528`) and are **purely scheduling**: resume does `GREATEST(next_run_at, NOW())`, i.e. a **silent deferral of one interval with no commitment accounting**. There is **no skip** endpoint at all. | `:495-528` | **[PROVEN] pause exists, skip ABSENT** |
| **Modification** | PATCH exists but **destroys history**: `DELETE FROM velrepeat_items WHERE plan_id = $1` then re-inserts (`:445-452`), so item identity and the price snapshot of every prior cycle are lost. No versioning. | `:444-453` | **[PROVEN] exists, unsafe for prepaid** |
| **Cancellation** | Plan cancel sets `status='cancelled'` and touches **no order, no payment, no inventory** (`:529-537`). With a prepaid payment that is a money-handling hole. | `:529-537` | **[PROVEN] incomplete for prepaid** |
| **B2C / B2B** | One model. `vrepeat_min_qty` / `vrepeat_max_qty` are the only quantity lever and are set per product by the seller; there is **no pricing consequence** attached to quantity. | `:85-92` | **[PROVEN] single model, no quantity pricing** |
| **Scheduler ownership** | Central scheduler exists (`server.ts:519` → `startVelRepeatScheduler`, `:467-487`), **but a seller route can also run it globally** — see §35. | `:444-458`, `:467-487` | **[PROVEN] + defect (now fixed)** |

---

## 24. Existing tables vs. required concepts (PHASE 19 check — do not duplicate)

| Required concept | Reuse this | Do **not** create |
|---|---|---|
| Product / variant / stock | `products`, `product_variants`, `inventory` — canonical | a package-level stock column |
| Repeat Plan | `velrepeat_plans` (extend: commitment, schedule, prepaid total) | a second plan table |
| Plan Item | `velrepeat_items` | a second item table |
| Package composition | **[PROVEN] nothing exists** — a new composition table is genuinely required, and it must reference real `products.id` / `product_variants.id` and carry **no inventory of its own** | `vrepeat_packages` is **NOT** reusable: it is the V1 single-product package (one `product_id`, `quantity_total`), it has **zero commerce writes**, and reusing it would collide conceptually. **Decision required** on whether to supersede it or leave it untouched. |
| Delivery cycle | `velrepeat_runs` is the nearest structural fit (`UNIQUE(plan_id, scheduled_for)`) but is insufficient (§23) | a duplicate run table |
| Order | `orders` + `order_items` — canonical, plus `orders.velrepeat_run_id` (`:380`, FK `:883`) | a repeat-specific order |
| Payment | `payments`, `payment_events`, `refunds` — canonical, **but order-scoped** (§25) | a VelRepeat payment table (would be a **second payment authority**) |
| Payment attempt | no dedicated table; attempt identity is `payments.provider_payment_id` / `provider_checkout_session_id` + `resolvePaymentAttemptRow` (`stripe.ts:386-415`) | a duplicate attempt store |
| Payment incident | `payment_incidents` (`:477`), `payment-incidents.ts`, VelCenter tab — reuse | a VelRepeat incident table |

---

## 25. Prepaid payment model — the structural blocker

> Owner model: 4 cycles × ฿93 = **฿372 paid once**, meaning *a prepaid commitment for 4 delivery
> cycles* — **not** 4 payments, and **not** one order holding 4 cycles.

**[PROVEN] the canonical payment authority is order-scoped.** `payments.order_id UUID NOT NULL
REFERENCES orders(id)` (`run-sqleditor.sql:441`). Every payment row the platform has ever created
belongs to exactly one order; the Stripe webhook resolves the order first and then the attempt
(`stripe.ts:428` `lockOrderRow` → `:440` `resolvePaymentAttemptRow`); `payment_incidents.order_id` is
likewise `NOT NULL` (`:481`).

**Consequence [PROVEN]:** a payment for N cycles has **no canonical home today**. Three shapes are
possible and **none may be chosen without the owner**:

| Shape | What it means | Why it is not silently acceptable |
|---|---|---|
| **A. Payment on cycle 1's order** | The plan's money sits on one cycle's `orders` row. | Every downstream rule reads "the money on this order pays for this order": `releaseOrderInventory` refuses to release an order whose payment settled (`:227-231`), `assertNoSettledPaymentForCancellation` refuses to cancel it, and `commitOrderInventory` settles **that order's lines only** (`:119-122`). One prepaid payment would therefore make cycle 1 un-cancellable and un-releasable while cycles 2..N have no money at all — an incoherent split of one payment across N orders. |
| **B. Make `payments.order_id` nullable + add `velrepeat_plan_id`** | The payment belongs to the plan. | This changes the **canonical payment table** that every payment route, webhook, incident, refund and settlement test reads. It is a real, reviewable change — **not** a duplicate authority — but it must be designed and approved, not improvised. |
| **C. A new `velrepeat_plan_payments` table** | Plan payments live apart from order payments. | **Forbidden by §18.4/§18.10** — it is a **second payment authority**, with its own settlement, refund and incident semantics. Not offered as a recommendation; listed only because the shape is obvious and must be named as rejected. |

**Additional hard constraint [PROVEN]:** `assertPaymentMethodUsable()` gates a *method*, and the
owner has fixed the rail as **Stripe** (§21 #1 resolved). But `POST /api/stripe/checkout` reads the
amount from **`orders.total_amount`** (`buildCheckoutLineItems`) and refuses any order whose status is
not `pending`/`pending_payment` (`:1095`). A prepaid plan therefore has **no payable order to point a
Stripe Session at** until a shape above is chosen.

**Also blocking [PROVEN]:** Stripe Checkout supports single charges and *Subscriptions*. This system
has **no subscription billing object**, no price/product in Stripe, and no recurring-charge job —
`payments` records one settled amount per order. Prepaid-commitment billing is therefore
**one large Stripe charge at plan creation**, not Stripe Subscriptions. **[DECISION]** — it follows
from what exists; **[OWNER DECISION REQUIRED]** if the owner wants true Stripe Subscriptions
instead, because that is a new provider integration, not a VelRepeat change.

---

## 26. Delivery cycles and the order relationship

**Owner model:** `Repeat Plan → Cycle 1 → Order A … Cycle N → Order N`, each cycle with **its own
lifecycle**, and **plan status ≠ order status**.

**[PROVEN] today there is no cycle entity and no cycle → order identity:**

- a "cycle" is implicit in `velrepeat_runs.scheduled_for`;
- a run creates **one order per shop** (`:262`) and can therefore create **several orders for one
  cycle**;
- `velrepeat_runs.order_id` records only the **first** order; the rest survive only inside
  `metadata.orderIds` (`:361-364`);
- cycle 2's status is not derivable from anything except "did a run happen".

**Contract:**

1. A cycle is a first-class row with an **ordinal**, a **scheduled instant**, its **own status**, and
   its **own link to its order(s)**. **[DECISION]**
2. Cycle status is **not** an `orders.status` value — it is a plan-side axis (scheduled → order
   generated → fulfilled → completed/skipped/cancelled). **[DECISION]** — the canonical 12 order
   statuses (§8) keep their exact meaning and are not extended.
3. **Completed cycles are immutable.** No edit, no re-price, no delete. **[PROVEN] this is already
   violated by `PATCH` (`:445`)** — it must stop being possible for a prepaid plan.
4. One cycle may span several orders (multi-shop) — that is existing, proven behavior and is **not**
   a defect; what is missing is the cycle identity that binds them. **[DECISION]**
5. `Cycle 2` must never become `completed` because `Cycle 1` did. **[DECISION]**

---

## 27. Package

**Owner model:** a package is a commercial composition (Toothpaste ×1, Soap ×2, Shampoo ×1) that
references real products/variants and **carries no inventory of its own**.

**Contract:**

1. A package references **real** `products.id` / `product_variants.id` rows. It never duplicates
   product data. **[DECISION]**
2. A package **never** owns stock. Reservation/settlement flow through the existing
   `inventory` / `product_variants` rows for the referenced products — there is exactly one stock
   authority (§9). **[DECISION]** — this is what makes "package does not duplicate product inventory"
   enforceable rather than aspirational.
3. A plan is composed from **either** a single product **or** a package; both reduce to the same
   plan items so the run engine stays single-path. **[DECISION]**
4. Packages may have their **own** price, but the package price must be a **pricing input**, never an
   inventory input. **[DECISION]** — the tier/price model is §30 and is **[OWNER DECISION REQUIRED]**
   as to who may author package prices.

**[PROVEN] no package concept exists today** (§23). A new composition table is required. Per §18.8 it
must land in **both** `db/schema.sql` and `db/run-sqleditor.sql`, additively, and **never** in
`db/run-update.sql`. **[OWNER DECISION REQUIRED]** — see §38 Q11 and the `vrepeat_packages` question
in §24.

---

## 28. Price snapshot (owner requirement)

> The system must snapshot the price actually used so that *what / quantity / base price / package
> pricing / discount / commitment / price per cycle / total prepaid* is auditable forever, and a later
> product price change must never re-price an already-bought plan.

**[PROVEN] This is the opposite of today's behavior.** `processPlan` deliberately re-prices **every
cycle against the live server price**, overwrites `velrepeat_items.unit_price`, and tells the customer
the price changed (`:229-249`). That is correct for *pay-per-cycle* and **wrong for prepaid**.

**Contract (applies to the prepaid model):**

1. The price used at checkout is frozen on the plan (and, per cycle, on the cycle's order lines).
2. `order_items.price` / `subtotal` already snapshot what a cycle actually cost —
   `run-sqleditor.sql` `order_items`. **[PROVEN]** reused, not duplicated.
3. A seller's later price change **MUST NOT** alter an existing prepaid plan (owner rule).
   Whether a *new* plan sees the new price is obvious (it does).
4. Historical cycles are immutable. **[PROVEN] today `PATCH` deletes and rewrites `velrepeat_items`**
   (`:445`) — under this contract that is forbidden once a plan is prepaid.
5. Money arithmetic is derived from the snapshot; it is **never recomputed from the live catalog**.
   **[DECISION]** — follows from (3) and the owner's "no historical repricing" rule.

**[OWNER DECISION REQUIRED]** — see §38 Q9/Q10 (seller price change, delisted product).

---

## 29. Schedule

**Owner model:** at least 7 / 14 / 30 days, **stored as plan data**, and the logic must not be
hardcoded per route.

**Contract:**

1. The schedule lives on the plan, not in a route. **[PROVEN] already true** —
   `frequency_type` + `interval_value` (`:827-828`), computed once in `calculateNextRunAt`
   (`velrepeat-scheduler.ts:38-65`), which is the single schedule authority already used by both the
   route (`:255`) and the run engine (`:358`).
2. 7/14/30 need **no new vocabulary** — `days/7`, `days/14`, `days/30` express all three. Existing
   values are **preserved** (`months` with day clamping must keep working). **[DECISION]**
3. **All schedule math is UTC today and the plan's own timezone is inert** (§23). The owner requires
   timezone correctness. Either the timezone becomes load-bearing (requires a timezone library and a
   decision on what "09:00 in the customer's timezone" even means for a delivery date), or the plan is
   defined as UTC. **[OWNER DECISION REQUIRED]** — not guessed.
4. A cycle's scheduled instant is **immutable once prepaid**, otherwise the prepaid commitment's
   delivery dates silently move. **[DECISION]** — follows from §25(4).

---

## 30. Commitment and tiered pricing

**Owner model:** commitment = number of **prepaid delivery cycles** (1 / 2 / 4 / 8 / 16 …). Longer
commitment = lower price. The percentage table in the brief is **illustrative only** and **must not
be hardcoded**.

**Contract:**

1. Commitment is stored on the plan as a number, and the set of cycles equals it. **[DECISION]**
2. Price inputs are **separable**: base price → package price → quantity → commitment → discount rule
   → unit price → cycle price → **total prepaid**. Each is snapshotted (§28). **[DECISION]**
3. **Tier rules live in data, not in business logic** — changing a tier must not require editing
   `processPlan` or any route. **[DECISION]** — the owner's explicit requirement.
4. **[PROVEN] no tier data exists today.** `platform_settings` (`run-sqleditor.sql`, key/value) is the
   existing platform-configuration store and `products.vrepeat_*_price` are the existing *seller* price
   fields. **Which one owns commitment tiers — platform, seller, or both — is an owner decision**
   (§38 Q11), because it determines who may change prices that are baked into prepaid commitments.

---

## 31. Inventory — plan level vs. cycle level

**Owner requirement:** make this explicit, with a comparison, and **do not choose silently.**

| Axis | **Reserve the whole commitment at payment** | **Reserve per cycle, just before fulfillment** |
|---|---|---|
| Stock | hides N cycles of demand from ordinary shoppers for up to 16 cycles | only 1 cycle is hidden at a time |
| Warehouse availability | needs `qty × commitment` on hand now; a seller cannot sell what is already spoken for | needs only `qty` now, `qty` again later |
| Cancellation | releasing a plan means releasing a hold that may already be committed to later cycles — and it interacts with §38 Q3 (refund) | release is local to one cycle |
| Expiry | the 30-minute window (`payment-reservation.ts:44`) is meaningless for a months-long hold; a new expiry policy is needed | per-cycle window behaves like today |
| Long commitments | overselling risk is structurally high — 16 × qty can silently exhaust a catalog | risk is bounded by one cycle |
| Overselling | requires a new plan-level reservation record (a second reservation concept) | reuses the existing order-level hold unchanged |

**Contract (either way):**

1. Every reservation reaches **exactly one** terminal outcome: commit **or** release (§9). **[PROVEN]**
   invariant, preserved.
2. **No negative inventory, no double release, no double commit, no double `sold_count`.**
   **[PROVEN]** guards exist and must be reused, not re-implemented.
3. The variant line and the non-variant line **must behave identically**. **[PROVEN] today they do
   not** — the variant is *consumed* (`:326-335`) while the non-variant is *held* (`:341`) inside the
   same loop. Under either option this asymmetry must be resolved one way, and **which way is part of
   the reserve decision**.
4. **[OWNER DECISION REQUIRED]** — §38 Q1. This is a hard **STOP** condition (STOP #2). No inventory
   code is written before it is answered.

---

## 32. sold_count under the prepaid model

**Owner invariant, stated verbatim in the brief:** `sold_count` must **never** be incremented merely
because a Repeat Plan was created.

**[PROVEN] the canonical authority remains `commitOrderInventory`** (`inventory.ts:115`, `sold_count`
at `:141`), enforced for every other order path by `inventory-settlement.test.ts:95-121`, which names
`velrepeat-scheduler.ts` the **known exception** (`:98-99`).

**The prepaid design conflict, stated plainly [PROVEN]:**

> `commitOrderInventory` is reached from exactly **one** place — `stripe.ts:559`, inside
> `markPaymentSucceeded`, i.e. **when an order's payment settles**. Under the prepaid model the money
> settles **once, at plan level, before any cycle order exists**, and later cycles produce orders with
> **no payment event at all**. So the canonical settlement authority becomes **unreachable** for every
> prepaid cycle, while the current VelRepeat path increments `sold_count` at *cycle creation* with no
> guard (`:343-346`) and nothing ever reverses it on cancellation.

Those are the only two behaviors the repository currently exhibits, and **neither is acceptable**:

- settlement-at-payment ⇒ a prepaid plan would never count a single sale;
- increment-at-cycle-creation ⇒ counting happens for an unpaid/unfulfilled cycle and is never undone.

Three candidate designs exist (settle the whole commitment once; settle per cycle via a **new,
non-payment** settlement trigger; or redefine "sold" for recurring units). Each changes canonical
inventory semantics. **[OWNER DECISION REQUIRED]** — §38 Q2, and **STOP** condition (STOP #7).

**Non-negotiable regardless of the answer [PROVEN + owner rule]:**

- exactly **one** increment per unit, enforced by a **test**, not by convention;
- plan creation, cycle creation, payment pending, payment failed, payment expired ⇒ **`sold_count`
  unchanged**;
- successful settlement ⇒ **+exactly once**; a duplicate event ⇒ **no additional increment**;
- no VelRepeat-specific `sold_count++` anywhere.

---

## 33. Cancellation, pause, skip and modification

| Operation | **[PROVEN]** today | Under prepaid it must additionally answer |
|---|---|---|
| **Cancel plan** | sets `status='cancelled'`; touches **no** order, **no** payment, **no** inventory (`:529-537`) | what happens to the **remaining cycles** and to the **prepaid balance** → §38 Q3 |
| **Cancel one cycle** | **no such concept** | does the money move? is stock released? → §38 Q4 |
| **Cancel the order** | canonical rules apply (§12) | the order holds no money of its own, so "money settled" means "the plan settled" — **[PROVEN] this is the `assertNoSettledPaymentForCancellation` interaction** |
| **Pause** | pure scheduling: resume does `GREATEST(next_run_at, NOW())` (`:520`) — a silent one-interval deferral | does the commitment **end date** move? do consumed cycles still count? → §38 Q5 |
| **Skip next cycle** | **no endpoint exists** | does the cycle shift later, or is it dropped and the commitment reduced? → §38 Q4 |
| **Modify** | `DELETE FROM velrepeat_items` then re-insert (`:445-452`) — **destroys** item identity and the price snapshot | existing/completed cycles immutable; only future cycles change; is the price difference charged or refunded? → §38 Q6/Q7 |

**Absolute rules for all four [owner]:** no invented refund policy, no invented skip/pause financial
behavior, no invented modification pricing, no editing completed cycles, no editing historical
financial records. **STOP** conditions 1, 3, 4.

**[PROVEN] note on refunds:** the only refund machinery is Stripe-confirmed (`refunds` table,
`stripe.ts:764+`, `payment.md`), and it is **order-scoped**. A prepaid balance spans N orders, so
"refund cycles 3–4" has **no canonical representation** until §25 is resolved. This is a second,
independent reason the prepaid model cannot be implemented before §38 Q3.

---

## 34. B2C and B2B — one model

**Owner rule:** no separate B2B system. The same model serves both; the difference is **quantity,
package, commitment and pricing rules** — **not** `role = "seller"`.

**Contract:**

1. One plan type, one engine, one pricing pipeline. **[DECISION]**
2. Quantity is bounded today only by `vrepeat_min_qty` / `vrepeat_max_qty`, which have **no price
   consequence** (`:85-92`). B2B quantity pricing therefore does not exist. **[PROVEN] ABSENT**
3. Pricing eligibility may consider quantity, commitment, package and seller rules — but each input
   and its precedence must be **specified**, and the interaction between a quantity tier and a
   commitment tier is unspecified. **[OWNER DECISION REQUIRED]** — §38 Q11.

---

## 35. Scheduler ownership and authorization — ✅ OWNER-APPROVED

> **Owner decision (PHASE 15):** the **central scheduler owns global due-plan processing**. A seller
> must **not** trigger due plans belonging to other customers. Seller-scoped operations must be
> ownership-enforced.

**State at `6f5a998` [PROVEN]:**

- the central scheduler exists and runs unconditionally (`server.ts:519` → `startVelRepeatScheduler`,
  `velrepeat-scheduler.ts:467-487` → `processDuePlans` `:444-458`);
- **[PROVEN] defect:** `POST /api/subscriptions/process-due` (`seller-orders.ts:755-788`) let **any
  approved seller** force-run **any** customer's due plans, with no user scope;
- **[PROVEN] the read path was already correct:** `GET /api/seller/subscriptions` scopes with
  `WHERE vi.seller_id = $1` (`:695`), so the seller only ever sees their own lines. Only the **write**
  trigger was unscoped.

**Implemented 2026-09-30 [OWNER-APPROVED]:** the due-plan selection is restricted to plans containing
at least one item belonging to the calling seller — the exact ownership predicate the read path
already uses. A seller can therefore trigger only plans that include their own products; the global
scan stays with the central scheduler.

**Residual, recorded not hidden [PROVEN]:** a plan that mixes several sellers' products is still
processed as a **whole plan**, so a seller who matches part of such a plan triggers the customer's
other lines too. Fully removing that would require splitting a plan per seller, which changes plan
semantics. **[OWNER DECISION REQUIRED]** if the owner wants per-seller splitting.

---

## 36. Payment incidents (HIGH #5 policy)

**Owner rule:** Stripe succeeded but the payment / order / cycle cannot settle safely ⇒ **durable
incident → VelCenter review**. Never automatic refund, reopen, inventory mutation or retry.

**Contract:**

1. Reuse `payment_incidents` + `payment-incidents.ts` + the VelCenter tab. **No VelRepeat incident
   table.** **[PROVEN]** mechanism exists (`:477`, migration 049).
2. **Dedupe** on a deterministic key so a replayed webhook cannot create a second incident
   (`dedupe_key UNIQUE`, `:479`). **[PROVEN]**
3. Identity preserved across webhook retry: provider event id (`payment_events.event_id UNIQUE`,
   `stripe.ts:1536-1541`), payment attempt identity (`stripe.ts:386-415`), order identity
   (`lockOrderRow`), **plus plan identity and cycle identity** — which do not exist yet (§26) and must
   be part of the incident key once they do. **[DECISION]**
4. **"[PROVEN] gap that prepaid closes":** a COD recurring order never reaches the Stripe webhook, so
   `payment-incidents.ts` never fires for it (§15). Under a prepaid Stripe plan the plan-level charge
   *does* produce a webhook, so the safety net applies — **provided** the plan-level payment shape of
   §25 resolves the same way the order-level one does.
5. **[OWNER DECISION REQUIRED]** — contract #6 remains open: what operator surface exists for money
   that is prepaid but can never be fulfilled (§38 Q12).

---

## 37. Idempotency at every level

**Owner rule:** duplicate execution at every level must be impossible — webhook, scheduler, retry,
concurrent `process-due`, cycle creation, order creation, payment settlement, inventory commit.

| Level | **[PROVEN]** mechanism today | Prepaid requirement |
|---|---|---|
| Plan run | `SELECT … FOR UPDATE` re-check (`:113-120`) + `UNIQUE (plan_id, scheduled_for)` + `ON CONFLICT DO NOTHING` (`:126-132`) | keep, unchanged |
| Cycle creation | the run row **is** the cycle key, but only implicitly | must become an explicit cycle identity (§26) |
| Order creation | keyed to the run; one order per shop (`:262`) | **Cycle N must not create two orders.** Needs a cycle-scoped claim. **[DECISION]** |
| Payment settlement | order row locked first (`stripe.ts:428`), `inventory_released = FALSE` guard (`:432-433`), attempt guards (`:457-467`) | plan-level payment needs the same three guards on the plan row |
| Inventory commit / release | atomic `inventory_released` claim (`inventory.ts:221-233`) | reuse unchanged |
| `sold_count` | **no idempotency today** (`:343-346`) | **must be exactly-once**, test-enforced (§32) |
| Webhook delivery | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` (`stripe.ts:1536-1541`) | reuse unchanged |
| Checkout request | `checkout_requests UNIQUE (user_id, scope, request_key)` | reuse; prepaid needs its own `scope` |

**Required [owner]:** *same plan + same cycle + same execution key ⇒ never two orders.* This is
**STOP** condition 12 — it must be **provable by test** before implementation, not asserted.

---

## 38. OWNER DECISIONS REQUIRED — prepaid model

These are the owner's own PHASE 26 questions. **None may be answered by the implementation.** Each is
a hard **STOP** for the code it gates.

| # | Question | Gates | Stop |
|---|---|---|---|
| **Q1** | On successful prepaid payment, is inventory reserved for the **whole commitment** or **per cycle**? | schema + inventory code | #2 |
| **Q2** | Is `sold_count` recognised at **cycle/order settlement** or at **prepaid payment**? | `commitOrderInventory` trigger | #7 |
| **Q3** | If a prepaid plan is cancelled, is the money for **future cycles refunded**? | refunds, `releaseOrderInventory` | #1 |
| **Q4** | Does a **skipped** cycle shift later, or does it **reduce the commitment**? | skip endpoint | #3 |
| **Q5** | Does **pause** move the commitment end date? | pause/resume | #3 |
| **Q6** | May a customer change package/quantity mid-plan? | PATCH safety | #4 |
| **Q7** | If the price differs after a change, how is the difference **charged / refunded**? | money movement | #4 |
| **Q8** | A future cycle is **out of stock** — what happens to that cycle and to the money? | cycle failure path | #2 |
| **Q9** | Seller changes the price after purchase — do future cycles use the **original** price? | price snapshot | #4 |
| **Q10** | A package item is **removed / delisted** — what happens to future cycles? | validation | #2 |
| **Q11** | How do **B2B quantity pricing** and **commitment discount** combine, and who owns the tier data? | pricing engine | #4 |
| **Q12** | Payment succeeded but a future cycle can never be fulfilled — what is the state of the **prepaid funds**? | incident policy, #6 | #1 |

**Plus, raised by the source inspection of Part II:**

> **Q13 — prepaid payment shape.** `payments.order_id` is `NOT NULL` (§25). Does the prepaid charge
> attach to a plan (shape A, with the coherence problems listed), or does `payments` gain a nullable
> `order_id` plus `velrepeat_plan_id` (shape B)? Shape C is rejected by §18.

> **Q14 — plan-level commit.** Prepaid commitment billing as one large Stripe charge (no Stripe
> Subscriptions object exists), or true Stripe Subscriptions (a new provider integration)?

> **Q15 — `vrepeat_packages` (V1).** It is a single-product, zero-commerce, unreferenced-by-V2 table
> (§24). Supersede it with the new package concept, or leave it untouched as legacy?

> **Q16 — plan timezone.** §29(3): make `velrepeat_plans.timezone` load-bearing, or declare all
> VelRepeat scheduling UTC?

> **Q17 — per-seller plan splitting.** §35 residual: may a seller trigger a multi-seller plan at all?

**Implementation status after Part II:** contract complete; **no** prepaid financial or inventory
behavior implemented. Only the owner-approved authorization fix (§35) has been written.

> **Part III added 2026-09-30 (V2 normative specification, §39–§64).** Parts I–II remain the evidence
> base. Where Part II labeled a rule **[DECISION]** (proposed, not owner-approved), Part III
> re-classifies it as **[V2 BUSINESS REQUIREMENT]** or **[PROPOSED DESIGN]**, and keeps everything
> financial the owner has not answered at **[OWNER DECISION REQUIRED]**. **Read Part III before
> implementing anything.**

---

# PART III — V2 NORMATIVE SPECIFICATION (added 2026-09-30)

**This is the part to implement against.** It states what VelRepeat V2 must be, using the six evidence
classes from §0. Every statement below is a requirement, an approved rule, a proposal, or an explicit
owner question. Where Parts I–II carry the source evidence, Part III references them instead of
re-deriving it. **No behavior in this part is implemented** (see §64).

**V2 one-line model:** `Product/Package → quantity per cycle → schedule → commitment → tiered pricing →
ONE prepaid payment → Repeat Plan → N delivery cycles → one fulfillment order per cycle (per seller)`.

---

## 39. Business definition (V2)

> «VelRepeat คือระบบ Prepaid Repeat Commerce ที่ให้ลูกค้าเลือกสินค้าเดี่ยวหรือ Package กำหนด quantity
> ต่อ delivery cycle เลือกความถี่และจำนวนรอบ รับราคาตาม commitment และชำระเงินล่วงหน้าครั้งเดียว
> จากนั้นระบบจัดการ delivery cycles แยกกัน โดยแต่ละ cycle สามารถสร้าง fulfillment order ของตัวเองได้»
> — owner brief, 2026-09-30. **[APPROVED BUSINESS RULE]**

**English (binding reading of the same statement):** VelRepeat is a Prepaid Repeat Commerce system:
the customer chooses a single product or a Package, sets a quantity per delivery cycle, chooses a
frequency and a number of cycles, receives commitment-based pricing, and pays **once up front**; the
system then manages **separate delivery cycles**, where each cycle can produce **its own fulfillment
order**.

### 39.1 The seven entities — definitions and non-equivalences

| Entity | V2 definition | Current reality at `00986be` | Class |
|---|---|---|---|
| **Product** | The catalog item that is stocked and shipped: `products` + `product_variants` + `inventory`. The **only** stock authority. | Exists fully (§23). | **[CURRENT IMPLEMENTATION]** |
| **Package** | A **commercial composition** of ≥1 real product/variant with a quantity per cycle. Carries **no stock of its own**. | **Does not exist** for V2; `vrepeat_packages` is V1 single-product with zero commerce writes (§23/§24). | **[V2 BUSINESS REQUIREMENT]** + [PROVEN] ABSENT |
| **Repeat Plan** | The customer's **prepaid commercial agreement**: composition, quantity per cycle, schedule, commitment (number of cycles), pricing snapshot, total prepaid, address. | `velrepeat_plans` exists as a pay-per-run recurring intent; no commitment, no prepaid total, no snapshot (§23). | **[V2 BUSINESS REQUIREMENT]** + [PROVEN] partial |
| **Delivery Cycle** | One delivery instance inside the plan, ordinal **1..N**, with scheduled instant, quantity snapshot, price snapshot, status, and order reference(s). | No cycle entity; implicit in `velrepeat_runs` (no ordinal, no per-cycle status — §26). | **[V2 BUSINESS REQUIREMENT]** + [PROVEN] insufficient |
| **Order** | The **fulfillment artifact** of one cycle (one per shop in a multi-shop plan). The only object that moves goods and inventory. | `orders`/`order_items` exist and are reused; cycle link incomplete (§26). | **[V2 BUSINESS REQUIREMENT]** + [CURRENT IMPLEMENTATION] |
| **Payment** | **One prepaid charge for the whole plan commitment**, via the canonical payment authority (Stripe rail; COD only per canonical config). Never per cycle; never per order. | Order-scoped only: `payments.order_id NOT NULL` (§25). | **[V2 BUSINESS REQUIREMENT]** + [PROVEN] blocker |
| **Fulfillment** | Per-cycle physical execution (pick/pack/ship, COD collection) under the canonical order state machine. Independent of payment settlement. | `order-fulfillment.ts` governs per-order status + transitions (§8). | **[CURRENT IMPLEMENTATION]** + [V2 BUSINESS REQUIREMENT] for the cycle axis |

**Non-equivalences (binding):**

- Product ≠ Package (a package is not a product; it owns no stock).
- Package ≠ Repeat Plan (a package is reusable commercial content; a plan is one customer's agreement).
- Repeat Plan ≠ Order (a plan spans N cycles; an order covers one cycle's goods).
- Delivery Cycle ≠ Order (one cycle may produce more than one order when a plan spans shops/sellers).
- Payment ≠ Fulfillment (paid does not mean delivered; delivered does not mean settled — §48).

---

## 40. Product and Package

**Requirements:**

1. A Repeat Plan starts from **either** a single product **or** a Package; both reduce to the same plan
   lines so the run engine stays single-path (§27(3)). **[V2 BUSINESS REQUIREMENT]**
2. A Package references **real** `products.id` / `product_variants.id` rows and never duplicates
   product data. **[V2 BUSINESS REQUIREMENT]** (§27(1))
3. A Package is a **commercial composition, not an inventory source.** It owns no stock; all
   reservation/settlement flows through the existing `inventory` / `product_variants` rows (§9). A
   package-level stock column must not be introduced. **[V2 BUSINESS REQUIREMENT]** — the current
   source has **no** package inventory model to preserve, so nothing legitimises a package stock
   authority.
4. A package price may exist, but it is a **pricing input only** — never an inventory input (§27(4)).
   **[PROPOSED DESIGN]** until the pricing engine (§44) and Q15 are resolved.

**Illustrative composition (example only — not catalog data, not a policy):**

```
Daily Care Package
  Toothpaste × 1
  Soap       × 2
  Shampoo    × 1
```

**[CURRENT IMPLEMENTATION] (absence):** no V2 package entity exists (§23). A new composition structure
is required and, when implemented, must land in **both** `db/schema.sql` and `db/run-sqleditor.sql`
(additively) — never in `db/run-update.sql` (§18.8). `vrepeat_packages` V1 is single-product and NOT
reusable as-is (§24). **[OWNER DECISION REQUIRED] — Q15:** supersede `vrepeat_packages` with the V2
package concept, or leave it untouched as legacy.

---

## 41. Quantity per cycle vs. total commitment quantity

**Two different numbers per line; both must be expressible and snapshotted.** **[V2 BUSINESS
REQUIREMENT]**

- `quantity_per_cycle` — what one delivery cycle contains.
- `total_commitment_quantity` — `quantity_per_cycle × commitment`; the total contracted units.

**Illustrative example (arithmetic only — the numbers are examples, not policy):**

```
commitment = 16 cycles
  Toothpaste × 20 per cycle → total  320 units
  Soap       × 30 per cycle → total  480 units
  Shampoo    × 10 per cycle → total  160 units
```

**[CURRENT IMPLEMENTATION]:** `velrepeat_items.quantity` already stores a per-line quantity with
`CHECK (quantity > 0)` (`run-sqleditor.sql:851`) and the scheduler consumes it per run; no total exists
anywhere. Quantity bounds exist only via the V1 `products.vrepeat_min_qty / vrepeat_max_qty`
(`velrepeat-plans.ts:68,85-92`) which carry **no pricing consequence** (§23).

**Binding:** 320 toothpaste units means **16 deliveries of 20** — not one delivery of 320. Total
commitment quantity is a **contract total**, not a single fulfillment quantity. Any other behavior
would contradict the stated model and is **[OWNER DECISION REQUIRED]** before it could exist.

---

## 42. Schedule semantics

**Owner requirement:** support schedules such as **every 7 days / every 14 days / every 30 days** — but
this list is **examples, not final business policy**; the source does not yet fix a policy, so the
implementation must not hardcode a closed set. **[V2 BUSINESS REQUIREMENT]**

**A schedule is the pair `(interval, cycle position)` plus an explicit timezone.** Each cycle must be
addressable by:

- **schedule** — the stored interval/frequency on the plan;
- **cycle number** — the ordinal 1..N (§49);
- **next delivery date** — the plan's next `scheduled_at`; the source for that cycle's order creation.

**[CURRENT IMPLEMENTATION]:** `velrepeat_plans.frequency_type` (`days`/`weeks`/`months`) +
`interval_value > 0` (`run-sqleditor.sql:827-828`) already express `days/7`, `days/14`, `days/30`; the
single schedule authority is `calculateNextRunAt()` (`velrepeat-scheduler.ts:38-65`), used by both the
route (`velrepeat-plans.ts:255`) and the run engine (`velrepeat-scheduler.ts:358`). Month-length and
day-clamping behavior belongs to that helper and is **preserved, not duplicated** (§29(2)).

**Timezone semantics (must be explicit — no implicit server-local timezone):** **[V2 BUSINESS
REQUIREMENT]**

1. All scheduling math today is UTC (`setUTC*`, `NOW()`) and `velrepeat_plans.timezone` is **inert** —
   the column is only echoed back at `velrepeat-plans.ts:153`; nothing writes it, nothing reads it
   (§23). **[PROVEN FROM SOURCE]**
2. V2 requires either (a) the plan timezone becomes **load-bearing** (a real timezone-aware scheduling
   decision, including what “the delivery date” means in that timezone), or (b) VelRepeat scheduling is
   **defined as UTC** and documented as such. **[OWNER DECISION REQUIRED] — Q16.** Until then, no
   implementation may silently inherit the server's local timezone.
3. A cycle's scheduled instant is **immutable once the plan is prepaid** (§26(5), §29(4));
   otherwise prepaid delivery dates silently move a sold commitment.

---

## 43. Commitment vs. schedule

**Commitment is the number of delivery cycles the customer buys — not a number of months.**
**[V2 BUSINESS REQUIREMENT]**

```
every 7  days × 4 cycles   → 4 cycles, ~28 days of plan
every 30 days × 4 cycles   → 4 cycles, ~120 days of plan
```

Both plans have **commitment = 4**; their **durations differ** because the schedule differs. The
commitment price ladder indexes on the **cycle count** (§44), and a cycle number is always interpreted
within the plan's commitment (cycle N of N).

**[CURRENT IMPLEMENTATION]:** no commitment column, no cycle counter, and no end-of-commitment
computation exist; `velrepeat_plans.status` permits `'completed'` but nothing ever writes it (§23).
**[V2 BUSINESS REQUIREMENT]:** commitment is stored on the plan; the set of cycles equals it (cycle
count = commitment); plan completion semantics (all cycles terminal) are **[PROPOSED DESIGN]** for
Phase 3 — not current behavior.

---

## 44. Pricing model

**Pipeline (normative shape):** **[V2 BUSINESS REQUIREMENT]**

```
Base Product Price
        ↓
Package Composition
        ↓
Quantity
        ↓
Commitment
        ↓
Discount / Pricing Tier
        ↓
Cycle Price
        ↓
Total Prepaid Price
```

- The engine accepts **`minimum_cycles`, `maximum_cycles`, `discount_type`, `discount_value`,
  `eligibility`** (§30 requirement). Tier ladder examples: **1 / 2 / 4 / 8 / 16** cycles.
- **Discount numbers such as 3% / 7% / 10% / 15% are examples only.** No discount percentage may be
  hardcoded as production policy before the owner approves it (§30(3), §38 Q11).
- **Tier rules live in data, not in business logic** — changing a tier must not require editing
  `processPlan` or any route (§30(3)). Where the data lives (platform-level `platform_settings` vs.
  seller-owned fields, or both) is **[OWNER DECISION REQUIRED] — Q11**, because it decides who may
  change prices baked into prepaid commitments.
- **Eligibility inputs** may include: quantity, commitment, package, seller pricing rules and customer
  eligibility (§34/§56). Eligibility is **never** `role = "seller"`.
- **Cycle price** is a pricing output (base ฿100 / cycle with a commitment tier applied → ฿93 / cycle,
  illustrative only) and is **snapshotted** (§45).
- If a different architecture (e.g. explicit price-rule rows instead of tier tables) proves better, it
  must be proposed as **[PROPOSED DESIGN]** and ratify the same pipeline — the stages are the contract,
  the storage is not.

**[CURRENT IMPLEMENTATION]:** no tier table and no discount logic exist anywhere; the V1
`products.vrepeat_weekly_price / vrepeat_monthly_price` fields are priced only by V1
`velrepeat.ts:138-143` (zero commerce writes) and are NOT a V2 pricing engine (§23).

---

## 45. Price snapshot

**At checkout the system must snapshot, and thereafter never recompute from the live catalog:**
**[V2 BUSINESS REQUIREMENT]**

| Snapshot field (per plan, and per line where applicable) |
|---|
| product price |
| variant price |
| package composition |
| quantity (per cycle) |
| cycle price |
| discount (type / value / applied amount) |
| commitment (cycle count) |
| total prepaid price |
| currency |
| pricing rule id + rule version |

**Immutability rule:** after purchase, a future product/variant price change must **never** change the
plan's historical financial commitment; historical plans are **never** repriced from current product
prices (§28). **[V2 BUSINESS REQUIREMENT]**

**[PROVEN FROM SOURCE] current conflict:** `processPlan` deliberately re-prices **every cycle against
the live server price**, overwrites `velrepeat_items.unit_price` and notifies the customer
(`velrepeat-scheduler.ts:229-249`). That is correct for pay-per-cycle and **wrong for prepaid** — it is
the opposite of this requirement, and it must stop being possible for a prepaid plan (Phase 4/5).
`order_items.price/subtotal` already snapshot what a cycle actually cost and are **reused, not
duplicated** (§28(2)).

**[OWNER DECISION REQUIRED] — Decision E (Q9):** future seller price changes leave the plan **locked
at purchase** (A) or future cycles **reprice** (B). No default may be assumed.

---

## 46. Prepaid payment (one plan, one charge)

**Model:** **one Repeat Plan → one prepaid financial commitment → one payment.** **[V2 BUSINESS
REQUIREMENT]**

**Illustrative arithmetic (examples only — no percentages are fixed by this contract):**

```
฿100  / cycle  (base)
× 4  cycles   (commitment)
commitment tier → ฿93 / cycle
──────────────────────────────
Total prepaid = ฿372, paid ONCE
```

**Explicitly not:** 4 separate payments; nor 1 order containing all 4 deliveries. Payment, Repeat Plan,
Delivery Cycle and Order are four distinct entities (§39.1); the payment funds the **plan**, the plan
contains **cycles**, and each cycle produces its **own order(s)** (§50).

**Structural blocker (unresolved): [PROVEN FROM SOURCE]** `payments.order_id UUID NOT NULL
REFERENCES orders(id)` (`db/run-sqleditor.sql:441`) — there is no plan-level payment row, and a payment
for N cycles has **no canonical home** today. Shapes (§25): **A** attach to cycle 1's order (coherence
problems — one settled payment makes cycle 1 un-cancellable/un-releasable while cycles 2..N carry no
money), **B** make `payments.order_id` nullable + add `velrepeat_plan_id` (a real canonical change,
reviewable — not a duplicate authority), **C** a new `velrepeat_plan_payments` table — **rejected**
(second payment authority, §18.4/§18.10). Choosing between A and B is **[OWNER DECISION REQUIRED] —
Q13.**

**Also unresolved: [PROVEN FROM SOURCE]** `POST /api/stripe/checkout` derives the amount from
`orders.total_amount` and only accepts orders in `pending`/`pending_payment` (`stripe.ts:1095`), so a
prepaid plan has no payable object until Q13 is decided. **[OWNER DECISION REQUIRED] — Q14:** one large
canonical Stripe charge at plan creation (what the architecture supports), or true Stripe Subscriptions
(a new provider integration, not a VelRepeat change).

**Approved elements: [APPROVED BUSINESS RULE]** 2A (Stripe is the rail), 5A (a customer can pay a
VelRepeat plan with Stripe), 4A (the standard 30-minute payment reservation applies **where
applicable** — its mapping to a plan-level charge is part of Phase 4 design, not assumed here).

---

## 47. Payment authority

**Approved rules (binding):**

1. **[APPROVED BUSINESS RULE — 2A / 5A]** Stripe is the VelRepeat payment rail; a customer can pay a
   VelRepeat plan with Stripe.
2. **[APPROVED BUSINESS RULE — 1A]** COD must respect the canonical COD configuration. Every VelRepeat
   payment path must go through `assertPaymentMethodUsable()` / `isCodEnabled()` /
   `isCodCustomerSelectable()` (`payment-config.ts:313/325/387`). **No VelRepeat-specific bypass may
   exist**, and COD must **never** be enabled just to make VelRepeat work.
3. The canonical payment authority is **exactly one system** — `payments` / `payment_events` /
   `refunds` + `payment-config.ts`. VelRepeat adds **no** second payment authority, method or rail.

**[CURRENT IMPLEMENTATION] (for the gap record, not a design):** the create path hard-rejects any
method other than `'cod'` (`velrepeat-plans.ts:224-227`) **without consulting the canonical gate**;
the scheduler writes settlement-less per-order rows `method='cod', status='pending', provider='cod'`
(`velrepeat-scheduler.ts:350-354`) even though `'cod'` is not a member of the `PaymentProvider` union
(`payment-config.ts:26`). **[PROVEN FROM SOURCE]** — pre-existing behavior; the prepaid wiring is
Phase 4 and may not reproduce these shortcuts.

---

## 48. Payment vs. fulfillment

**Rule:** payment success **≠** all delivery cycles completed. **[V2 BUSINESS REQUIREMENT]**

Example (state-axis separation, not a UI spec):

```
after the prepaid payment settles:  plan = PAID
                                    Cycle 1 = scheduled
                                    Cycle 2 = scheduled
                                    Cycle 3 = scheduled
                                    Cycle 4 = scheduled

after Cycle 1 is fulfilled:         Cycle 1 = completed
                                    Cycle 2–4 = still NOT completed
```

Three independent status axes exist and none implies another:

1. **Payment status** — settled / pending / failed / expired (canonical `payments` semantics).
2. **Plan / cycle status** — the plan and each delivery cycle progress on their own axis (§49).
3. **Order status** — the canonical order statuses (`orders_status_check`) + fulfillment transitions
   (`order-fulfillment.ts:89-97`, `FULFILLMENT_STATUSES`), unchanged.

**[CURRENT IMPLEMENTATION]:** per-order confirmation is gated by `paymentAllowsConfirmation()`
(`order-fulfillment.ts:218-235`) — a settled payment row allows confirmation; a COD row allows it only
while `isCodEnabled()`. Under prepaid Stripe the settled money belongs to the **plan**, not to the
cycle's order (§46); how a cycle order is legitimately confirmed in that situation is Phase 5/8
**[PROPOSED DESIGN]** and is gated by Q13/Q14. It must not weaken the canonical gate — COD confirmation
still requires `isCodEnabled()`.

---

## 49. Repeat Plan vs. Delivery Cycle (hierarchy)

**Normative hierarchy:** **[V2 BUSINESS REQUIREMENT]**

```
Repeat Plan
 ├── Cycle 1
 ├── Cycle 2
 ├── Cycle 3
 └── Cycle N            (N = commitment)
```

**Every cycle must carry:**

| Cycle field | Meaning |
|---|---|
| `cycle_number` | ordinal 1..N, unique within the plan |
| `scheduled_at` | the cycle's delivery instant (§42) |
| `status` | the cycle's own lifecycle state (not an order status) |
| `quantity snapshot` | per-line quantity contracted for this cycle (§41) |
| `price snapshot` | per-line/cycle pricing frozen at checkout (§45) |
| `order reference(s)` | the order(s) generated for this cycle (§50) |
| `fulfillment state` | derived from its order(s)' fulfillment progress |

**Rules:**

1. Cycle status advances on its **own axis** (scheduled → order generated → fulfilled →
   completed/skipped/cancelled) and is **not** an `orders.status` value; the canonical order statuses
   are not extended (§26(2)). **[V2 BUSINESS REQUIREMENT]**
2. Completed cycles are **immutable** (§26(3), §55). **[V2 BUSINESS REQUIREMENT]**
3. One cycle may span several orders (one per shop/seller) — existing proven behavior, preserved; what
   V2 adds is the cycle identity that binds them (§26(4)). **[V2 BUSINESS REQUIREMENT]**
4. `Cycle 2` must never become `completed` because `Cycle 1` did (§26(5)). **[V2 BUSINESS REQUIREMENT]**

**[CURRENT IMPLEMENTATION] — the gap:** no cycle entity exists. `velrepeat_runs` is the nearest
structure: `UNIQUE (plan_id, scheduled_for)` (`run-sqleditor.sql:877`), a status CHECK with 8 values of
which only `processing / success / out_of_stock / item_unavailable` are ever written, `order_id`
holding only the **first** order while the rest survive in `metadata.orderIds`
(`velrepeat-scheduler.ts:361-364`). No ordinal, and no agreement between “cycle N” and any stored key
(§23/§26). **[PROVEN FROM SOURCE]**

**Contract direction [PROPOSED DESIGN]:** make the cycle first-class by **extending `velrepeat_runs`**
(add `cycle_number` + snapshot fields + multi-order linkage) **or** by introducing one cycle table that
`velrepeat_runs` references — exactly one of the two, chosen in Phase 5 design. Either shape must keep
`UNIQUE` identity for `(plan, cycle_number)` so “same plan + same cycle + same execution ⇒ one order”
(§58) is provable, and must not create a second authority for “did cycle N happen”.

---

## 50. Order (the fulfillment artifact)

**Model: one cycle → its own order(s); no new charge per cycle.** **[V2 BUSINESS REQUIREMENT]**

```
Repeat Plan RP-001
  Cycle 1 → Order O-001
  Cycle 2 → Order O-002
  Cycle 3 → Order O-003
  Cycle 4 → Order O-004
```

**Rules:**

1. An order is created **for a cycle**, as its fulfillment artifact — never as a re-charge of the plan.
   Under prepaid, **no payment charge may be created per cycle**; the canonical payment is the single
   plan-level charge (§46). **[V2 BUSINESS REQUIREMENT]**
2. **[PROVEN FROM SOURCE] current conflict:** the scheduler currently inserts a per-order pseudo-payment
   row (`velrepeat-scheduler.ts:350-354`) and one order per shop per run (`:262`). The per-order payment
   row may not survive into the prepaid model — except as the canonical COD-at-delivery flow (**only**
   while COD is enabled per the canonical config). Its removal/replacement is Phase 8 design.
3. **Traceability (binding):** `Order → Cycle → Repeat Plan → Customer → Payment`. Today:
   `orders.velrepeat_run_id` (FK, `run-sqleditor.sql:380`, `:883`), `velrepeat_runs.plan_id`,
   `velrepeat_plans.user_id` carry the first half; the payment leg requires Q13 to become traceable
   for prepaid. **[V2 BUSINESS REQUIREMENT]**
4. Orders reuse the canonical `orders` + `order_items` tables — no repeat-specific order table (§24).
   **[V2 BUSINESS REQUIREMENT]**

---

## 51. Inventory — do not decide without the owner

**Five distinct moments must never be conflated:** **[V2 BUSINESS REQUIREMENT]**

1. **Payment commitment** — the customer has paid for N cycles (money).
2. **Inventory reservation** — stock is held (reserved) but not yet sold.
3. **Inventory commitment** — stock is definitively consumed for a sale (`commitOrderInventory`).
4. **Sold recognition** — the sales counter (`products.sold_count`) is incremented; canonical writer only.
5. **Fulfillment** — physical pick/pack/ship for a cycle's order.

**The two candidate models (comparison — NOT a choice):**

| Axis | **Model A — reserve the whole commitment at prepaid payment** | **Model B — reserve per cycle, just before fulfillment** |
|---|---|---|
| **Stock locking** | locks `qty × commitment` at payment | locks `qty` per cycle |
| **Overselling** | hides N cycles of demand; 16 × qty can silently exhaust a catalog | bounded to one cycle at a time |
| **Long-term plan** | hold spans up to 16 intervals — no existing concept models a months-long hold | hold behaves exactly like today's order-level reservation |
| **Cancellation** | releasing a plan releases a hold that may already be spoken for by future cycles — entwined with the refund decision (Decision B) | release is local to one cycle |
| **Expiry** | the 30-minute window (`payment-reservation.ts:44`) is meaningless for a long hold; a new expiry policy would be required | per-cycle window behaves like today (canonical policy) |
| **Future stock** | the seller must have/commit stock for future cycles **now** | uses whatever stock exists at each cycle |
| **Warehouse availability** | needs `qty × commitment` on hand now | needs only `qty` now, again later |

**Contract either way (binding invariants):** **[V2 BUSINESS REQUIREMENT]**

1. Every reservation reaches **exactly one** terminal outcome: commit **or** release (§9).
2. **No negative inventory, no double release, no double commit, no double `sold_count`.** The existing
   guards are reused, not re-implemented.
3. Variant and non-variant lines **must behave identically**. **[PROVEN FROM SOURCE] today they do
   not**: the scheduler decrements `product_variants.stock` directly (`velrepeat-scheduler.ts:326-335`)
   while the non-variant line uses `reserveInventoryStock` (`:341`) — an asymmetry that must be
   resolved one way, and **which way is part of Decision A**.
4. The canonical inventory machinery is the only authority: `reserveInventoryStock` (`inventory.ts:54`),
   `commitOrderInventory` (`:115`), `releaseOrderInventory` (`:209`, atomic claim `:221-233`) —
   **no second reservation concept** may be introduced unless Model A explicitly requires a plan-level
   reservation record, which is part of the decision, not an implementation detail.

**[OWNER DECISION REQUIRED] — Decision A (Q1):** Model **A** (reserve the entire commitment at prepaid
payment) or Model **B** (reserve per cycle). **This is STOP #2.** No inventory code is written before it
is answered.

---

## 52. `sold_count` invariants

**The invariants (binding):** **[APPROVED BUSINESS RULE — 3A] + [V2 BUSINESS REQUIREMENT]**

- Repeat Plan creation **≠** sold
- Payment pending **≠** sold
- Payment failure **≠** sold
- Payment expiry **≠** sold
- Reservation **≠** sold
- No `sold_count` increment at plan creation, cycle creation or reservation; **no VelRepeat-specific
  counter of any kind**.

**Canonical writer relationship:** `commitOrderInventory` (`inventory.ts:115`, `sold_count` at `:141`)
is the canonical sales-counter writer, reached from exactly one place: `stripe.ts:559` inside
`markPaymentSucceeded` — i.e. **only when an order's payment settles** (§32). **[PROVEN FROM SOURCE]**

**Approved mechanism (3A):** `sold_count` is recognized via the **canonical settlement path**, never via
ad-hoc counters. **[APPROVED BUSINESS RULE]**

**Still open:** under prepaid the settlement happens **once at plan level before any cycle order
exists**, so the canonical authority is currently **unreachable** for prepaid cycles; the recognition
**moment** (plan settlement vs. per-cycle settlement) is not yet fixed by the owner — **[OWNER DECISION
REQUIRED] (Q2 residual; related to Decisions A/F).** Whatever the moment, exactly-once behavior is
mandatory and **test-enforced**, not asserted.

**[PROVEN FROM SOURCE] current defect (must not be reproduced):** `velrepeat-scheduler.ts:343-346`
writes `sold_count = sold_count + $1` directly at cycle creation and nothing ever reverses it; the
structural guard in `inventory-settlement.test.ts:95-121` names `velrepeat-scheduler.ts` the known
exception (`:98-99`). Extending that guard to the VelRepeat path is part of Phase 6/10 (§20).

---

## 53. Cancellation — three levels

**Three distinct operations; their impacts must be designed, not invented:** **[V2 BUSINESS
REQUIREMENT]**

| Level | What it is | Impacts to resolve |
|---|---|---|
| **Cancel Repeat Plan** | ends the whole agreement (all remaining cycles) | future cycles; prepaid balance; payment; refund; inventory; seller; customer |
| **Cancel Future Cycle** | removes one upcoming cycle | commitment arithmetic; schedule of the rest; money; stock |
| **Cancel Current Order** | cancels the fulfillment artifact of a cycle already generated | canonical order cancellation rules (§12); stock release; no independent charge exists under prepaid |

**Impact matrix (what the design must answer — not guessed here):**

| Impact | Cancel Plan | Cancel Future Cycle | Cancel Current Order |
|---|---|---|---|
| future cycles | stop all remaining | remove one, keep the rest | unaffected |
| prepaid balance | money for undelivered cycles → **Decision B** | value of one cycle → **Decision B** | no order-level money exists (§46) |
| payment | single plan charge (§46); partial-refund path is unrepresentable today (§33) | same | no change to the plan charge |
| refund | **no refund policy exists for prepaid**; the only refund machinery is order-scoped + Stripe-confirmed (§33) | same | canonical order-level rules only |
| inventory | release depends on Model A/B (**Decision A**) | release the affected hold | canonical `releaseOrderInventory` |
| seller | seller's future fulfillment obligations stop; a seller still may not cancel other customers' plans (7B) | the cycle's seller affected | canonical seller rules |
| customer | plan ends; remaining value per Decision B | one delivery skipped per Decision B/C | order canceled per canonical rules |

**[CURRENT IMPLEMENTATION]:** plan cancel sets `status='cancelled'`, `ended_at`, and a
`PLAN_CANCELLED` event — and touches **no order, no payment, no inventory** (`velrepeat-plans.ts:529-537`).
**[PROVEN FROM SOURCE]** — with prepaid money that is a money-handling hole, not a policy.

**[OWNER DECISION REQUIRED] — Decision B (Q3):** prepaid cancellation is **A** refundable future cycles ·
**B** non-refundable · **C** credit · **D** policy varies by seller. **No refund policy may be
invented.** STOP #1 gates it.

---

## 54. Pause / Skip / Reschedule

**Three scheduling-lifecycle concepts; their financial behavior must not be chosen here.**
**[V2 BUSINESS REQUIREMENT]**

| Concept | Meaning | The unanswered question |
|---|---|---|
| **Pause** | temporarily stop cycle generation | does the commitment **end date extend**, do consumed dates **count against commitment**, or is it **seller-defined**? → **Decision D** |
| **Skip** | customer declines one cycle | does the cycle **move to the end** (postpone), is it **consumed without delivery**, or does it become **credit/refund**? → **Decision C** |
| **Reschedule** | move a future cycle's `scheduled_at` | permitted or not; whether it affects subsequent cycles; no financial behavior defined |

**[CURRENT IMPLEMENTATION] (evidence):** pause/resume exist and are **purely scheduling** — resume
runs `GREATEST(next_run_at, NOW())` (`velrepeat-plans.ts:520`), i.e. a **silent one-interval deferral
with no commitment accounting**; **no skip endpoint exists at all** (§23/§33). **[PROVEN FROM SOURCE]**

**Binding rules whichever the owner chooses:** **[V2 BUSINESS REQUIREMENT]**

1. Completed cycles stay immutable; skip/pause/reschedule may only touch **future** cycles.
2. Idempotency: applying the same skip/pause twice must behave as once (§58).
3. No invented financial behavior: if the chosen option moves money (credit/refund), it must be an
   owner decision (**C**/**I**) that also resolves how a prepaid charge is partially returned (§46/§53).

**[OWNER DECISION REQUIRED] — Decision C (Q4):** skip = **A** postpone · **B** consume · **C**
credit/refund. **[OWNER DECISION REQUIRED] — Decision D (Q5):** pause = **A** extend end date · **B**
consume commitment dates · **C** seller-defined. **STOP #3.**

---

## 55. Plan modification

**Principles (immutable history):** **[V2 BUSINESS REQUIREMENT]**

- **Completed cycle = immutable.** No edit, no re-price, no delete.
- **Historical price = immutable** (the snapshot is the financial record — §45).
- **Historical quantity = immutable.**

**Changing package / quantity / schedule after purchase:**

1. May affect only **future, not-yet-generated cycles** (at most). **[V2 BUSINESS REQUIREMENT]**
2. Optionally **versioned**: a plan can gain a new future-cycle version while every earlier cycle keeps
   the old composition/snapshot — proposed alternatives: a version row on `velrepeat_plans`, or
   version-tagged cycles. Choose in Phase 9 design. **[PROPOSED DESIGN]**
3. **No charge/refund difference may be invented** — whether a modification costs/refunds money is an
   owner decision. **[OWNER DECISION REQUIRED] — Decision G (Q6/Q7):** **A** future cycles only ·
   **B** prohibited · **C** versioned plan. **STOP #4.**

**[CURRENT IMPLEMENTATION] — the conflict:** `PATCH` destroys history: `DELETE FROM velrepeat_items`
then re-insert (`velrepeat-plans.ts:444-453`) loses item identity and every prior-cycle snapshot. Under
this contract that mutation must become impossible for a prepaid plan (§26(3), §28(4)).
**[PROVEN FROM SOURCE]**

---

## 56. B2C and B2B — one domain model

**Rule:** one plan type, one engine, one pricing pipeline. **No separate B2B Repeat subsystem.**
**[V2 BUSINESS REQUIREMENT]**

**Examples (illustrative — not catalog data, not policy):**

```
B2C:  Toothpaste × 1      Soap × 1                  every 30 days   × 4 cycles
B2B:  Toothpaste × 20     Soap × 30    Shampoo × 10 every 7  days   × 16 cycles
```

The difference between the two is **quantity, package, commitment and pricing rules** — never
`role = "seller"`. **[V2 BUSINESS REQUIREMENT]**

**Pricing eligibility may consider:** quantity · commitment · package · seller pricing · customer
eligibility. Each input and its precedence must be **specified** before implementation (§34(3)); the
interaction between a quantity tier and a commitment tier is currently **unspecified** → **Decision
H**.

**[CURRENT IMPLEMENTATION]:** one model exists; the only quantity lever is
`products.vrepeat_min_qty / vrepeat_max_qty` (bounds only, **no pricing consequence**,
`velrepeat-plans.ts:85-92`); there is no quantity pricing and no commitment pricing (§23/§34).
**[PROVEN FROM SOURCE]**

**[OWNER DECISION REQUIRED] — Decision H (Q11):** B2B stacking = **A** commitment + quantity discounts
stack · **B** one pricing tier wins · **C** seller-defined. (Q11's second half — **who owns the tier
data** — must be answered with it.)

---

## 57. Seller authorization

**Approved rule (7B, binding):** the **central scheduler owns global due-plan processing**. A seller
must **not** trigger due plans belonging to other customers. Every seller-scoped operation must be
**ownership-enforced**. **[APPROVED BUSINESS RULE]**

**[CURRENT IMPLEMENTATION] (already fixed — commit `2567707`):**

- `POST /api/subscriptions/process-due` (`seller-orders.ts:751-800`) now selects only plans containing
  at least one item of the calling seller —
  `EXISTS (SELECT 1 FROM velrepeat_items vi WHERE vi.plan_id = vp.id AND vi.seller_id = $1)` — the same
  ownership predicate the read path `GET /api/seller/subscriptions` already used
  (`WHERE vi.seller_id = $1`, `:695`). **[PROVEN FROM SOURCE]**
- Tests: 3 structural + 3 DB-gated (intruder cannot trigger; owner seller can; unapproved seller gets
  403) in `backend/tests/velrepeat-core.test.ts`.

**Residual [PROVEN FROM SOURCE]:** a plan that mixes several sellers' products is still processed as a
**whole plan** — a seller who matches part of it triggers the customer's other lines too. Fully removing
that requires per-seller plan splitting, which changes plan semantics. **[OWNER DECISION REQUIRED] —
Q17:** may a seller trigger a multi-seller plan at all?

**V2 requirement:** any future surface (cycle generation triggers, fulfillment endpoints, modification
endpoints) must adopt the same ownership predicate. **No code change in this contract phase.**
**[V2 BUSINESS REQUIREMENT]**

---

## 58. Idempotency at every level

**Required invariant (STOP #12):** *same Repeat Plan + same Cycle + same execution ⇒ no duplicate
Order.* **[V2 BUSINESS REQUIREMENT]**

| Level | **[CURRENT IMPLEMENTATION]** mechanism | V2 requirement / gap |
|---|---|---|
| **Payment webhook** | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` (`stripe.ts:1536-1541`) | reuse unchanged; plan-level events join the same store |
| **Payment settlement** | order row locked first (`stripe.ts:428`), `inventory_released = FALSE` guard (`:432-433`), attempt guards (`:457-467`) | plan-level settlement needs the same locks/guards on the plan row (Phase 4) |
| **Scheduler** | `SELECT … FOR UPDATE` re-check (`velrepeat-scheduler.ts:113-120`) | keep |
| **`process-due`** | same `processPlan` path per plan | must remain concurrency-safe under concurrent triggers (§37) |
| **Cycle generation** | the run row **is** the cycle key, implicitly (`UNIQUE (plan_id, scheduled_for)`, `ON CONFLICT DO NOTHING` `:126-132`) | must become an **explicit** cycle identity with a unique `(plan, cycle_number)` (§49) |
| **Order generation** | keyed to the run; one order per shop (`:262`); `order_id` = first order only | **cycle-scoped claim required**; one cycle must never create two orders (§37) |
| **Inventory commit** | single canonical `commitOrderInventory` via settlement | reuse; extend guard coverage to VelRepeat (§52) |
| **Inventory release** | atomic `inventory_released` claim (`inventory.ts:221-233`) | reuse unchanged |

**Not automated today:** `sold_count` has **no idempotency** (`velrepeat-scheduler.ts:343-346`) — must
become exactly-once and test-enforced (§52). **[PROVEN FROM SOURCE]**

**Provability requirement:** the “one order per cycle” invariant must be **provable by test** (unit and
DB-gated under CI's `postgres:16`) before implementation is accepted — not asserted. **STOP #12.**

---

## 59. Payment incident (HIGH #5 policy)

**Preserved policy (approved 6A):** if a payment succeeds but the settlement cannot be performed safely,
create a **durable payment incident** and route it to **VelCenter operator review**. **[APPROVED
BUSINESS RULE]**

```
Stripe payment succeeds
        ↓
payment attempt identified
        ↓
cannot safely settle (order/plan/cycle state mismatch, guard failure)
        ↓
durable payment incident (payment_incidents)
        ↓
VelCenter operator review
```

**Never automatic:** refund · reopen · retry · inventory mutation — unless an approved policy says
otherwise. **[APPROVED BUSINESS RULE + V2 BUSINESS REQUIREMENT]**

**Reuse (no VelRepeat incident table):** `payment_incidents` + `payment-incidents.ts` + the VelCenter
tab (§36); `dedupe_key UNIQUE` so a replayed webhook cannot create a second incident. Identity must
eventually include **plan identity and cycle identity** once they exist (§26/§36). **[V2 BUSINESS
REQUIREMENT]**

**[CURRENT IMPLEMENTATION]:** the mechanism exists in-repo; `payment_incidents` arrives with migration
`049`, which is **not applied to production** (Neon quota — owner action). Under prepaid, the plan-level
charge produces a Stripe webhook, so this safety net applies **provided** Q13/Q14 resolve the plan-level
attempt identity the same way the order-level one works. **[PROVEN FROM SOURCE]**

---

## 60. V2 OWNER DECISIONS

### 60.1 Approved (owner, 2026-09-30) — binding

| ID | Decision | Effect |
|---|---|---|
| **1A** | **Respect `COD_ENABLED`** — no VelRepeat bypass | COD stays off until an operator enables it; VelRepeat never overrides it |
| **2A** | **Stripe is the VelRepeat payment rail** | the prepaid charge is a Stripe charge |
| **3A** | **`sold_count` via canonical settlement** | no ad-hoc counters; canonical writers only (the recognition *moment* is still §52's open item) |
| **4A** | **30-minute payment reservation where applicable** | the canonical reservation policy applies to VelRepeat wherever it applies at all; mapping to a plan-level charge is Phase 4 design |
| **5A** | **Customer can pay VelRepeat with Stripe** | Stripe checkout for plans is in scope |
| **6A** | **Durable payment incident** | unsafe settlement ⇒ incident ⇒ VelCenter (never auto refund/retry/etc.) |
| **7B** | **Central scheduler only** | sellers cannot trigger other customers' plans; ownership-enforced (fix `2567707`, §57) |

These are **not** proposals: they are binding statements made by the owner on 2026-09-30, supplementing
§21's resolved #1/#7.

### 60.2 New — [OWNER DECISION REQUIRED] (raised by the V2 business model)

| ID | Decision | Options | Gates (contract refs) |
|---|---|---|---|
| **A** | Inventory reservation | **A** reserve the entire commitment at prepaid payment · **B** reserve per cycle | §51, Q1 · STOP #2 |
| **B** | Prepaid cancellation | **A** refundable future cycles · **B** non-refundable · **C** credit · **D** seller-defined | §53, Q3 · STOP #1 |
| **C** | Skip | **A** postpone cycle · **B** consume commitment cycle · **C** credit/refund | §54, Q4 · STOP #3 |
| **D** | Pause | **A** extend end date · **B** consume commitment dates · **C** seller-defined | §54, Q5 · STOP #3 |
| **E** | Future price change | **A** locked at purchase · **B** future cycles reprice | §45, Q9 · STOP #4 |
| **F** | Out-of-stock future cycle | **A** postpone · **B** substitute · **C** cancel/refund/credit · **D** seller policy | §51/§53, Q8/Q10 · STOP #2 |
| **G** | Plan modification | **A** future cycles only · **B** prohibited · **C** versioned plan | §55, Q6/Q7 · STOP #4 |
| **H** | B2B pricing stacking | **A** commitment + quantity discounts stack · **B** one tier wins · **C** seller-defined | §56, Q11 · STOP #4 |
| **I** | Prepaid + future fulfillment failure | **A** credit · **B** refund · **C** retry/reschedule · **D** seller policy | §53/§59, Q12 · STOP #1 |

**No option in §60.2 may be chosen by the implementation.** Where a chosen option conflicts with an
earlier STOP, the STOP wins until the owner-provided policy is written into this contract.

### 60.3 Open architecture decisions (from Part II — still unanswered)

| ID | Question (see §38) | Gates |
|---|---|---|
| **Q13** | Prepaid payment shape — **A** (attach to cycle 1's order) vs **B** (`payments.order_id` nullable + `velrepeat_plan_id`); C rejected as a second authority | Phase 4 |
| **Q14** | One large Stripe charge vs true Stripe Subscriptions | Phase 4 |
| **Q15** | `vrepeat_packages` (V1): supersede or leave as legacy | Phase 2 |
| **Q16** | Plan timezone load-bearing vs UTC | Phase 1/3 |
| **Q17** | Per-seller plan splitting | Phase 7 |

### 60.4 Decision → contract-question map (nothing lost)

Q1→A · Q2→(3A mechanism; recognition moment still open, §52) · Q3→B · Q4→C · Q5→D · Q6/Q7→G ·
Q8→F · Q9→E · Q10→F · Q11→H · Q12→I · Q13–Q17→§60.3.

---

## 61. Architecture gap analysis

Read every row as: **CURRENT SYSTEM → V2 REQUIREMENT → GAP → PROPOSED SOLUTION → OWNER DECISION**.
No row with an unanswered decision may be implemented.

| Area | Current system (evidence) | V2 requirement | Gap | Proposed solution | Owner decision |
|---|---|---|---|---|---|
| **Database** | `payments.order_id NOT NULL` (`:441`); no cycle ordinal (`velrepeat_runs`); no commitment/snapshot fields; migrations 048–050 unapplied in production | express plan-level payment, cycles, commitment, snapshots, package composition | no existing shape can store a prepaid plan's money or its cycles | Phase 1 additive schema design in **both** `db/schema.sql` + `db/run-sqleditor.sql` | **Q13** shape; production application blocked (Neon quota — owner action) |
| **Payment** | order-scoped authority; checkout derives from `orders.total_amount`; scheduler writes per-order `'cod'` rows (`:350-354`) | one Stripe charge per plan; COD only per canonical config | no payable object for a plan; per-cycle pseudo-payments conflict with prepaid | Phase 4: plan checkout + webhook settlement + incident path | **Q13** / **Q14** |
| **Inventory** | canonical reserve/commit/release; variant vs non-variant asymmetry (`:326-335` vs `:341`); no plan-level reservation | Model A or B; exactly one terminal outcome per reservation | cannot hold a commitment; asymmetry must be resolved | Phase 6 per Decision A | **A** (Q1) · STOP #2 |
| **Order** | one order per shop per run (`:262`); cycle link partial (`order_id` = first; `metadata.orderIds`) | per-cycle order(s), no per-cycle charge, full trace | no cycle-scoped idempotent claim; payment leg untraceable | Phase 5/8: cycle-scoped order claim + trace fields | **Q13** (trace leg); **F** (stock failure path) |
| **Scheduler** | central scheduler; UTC math; ownership-scoped seller trigger (`2567707`); multi-seller whole-plan residual | central-only, cycle-aware, explicit timezone | no cycle generation semantics; timezone inert | Phase 7 | **Q16** / **Q17** |
| **Pricing** | none for V2; V1 seller price fields only (§23) | pipeline with tier data, min/max cycles, discount_type/value, eligibility, snapshot | engine and tier data absent; percentages must not be hardcoded | Phase 2 | **H** (Q11) · **E** (Q9) |
| **Package** | absent for V2; `vrepeat_packages` V1 single-product, zero-commerce | composition of real products/variants, no stock of its own | no entity; V1 not reusable | Phase 2: new composition structure (both schema files) | **Q15** |
| **Cycle** | implicit in `velrepeat_runs`; no ordinal/status; `order_id` first-only | first-class cycles 1..N with snapshot, status, order refs | blocker #3 — no provable cycle identity (“cycle N ⇒ one order” unprovable) | Phase 5: extend `velrepeat_runs` **or** one cycle table (pick exactly one) | identity design (Phase 5) — must be ratified before code |
| **Authorization** | 7B fix landed; read path already scoped; residual multi-seller whole-plan run | keep central scheduler; every seller surface ownership-enforced | future surfaces do not exist yet; residual remains | Phase 7 enforcement + tests | **Q17** |
| **Refund** | order-scoped, Stripe-confirmed only; no plan-level representation | only if owner chooses refundable options | partial-commitment refunds unrepresentable | Phase 9, conditional on **B** / **I** | **B** / **I** |
| **Cancellation** | status-only; touches no order/payment/inventory (`:529-537`) | 3-level matrix (§53) | money/stock semantics absent | Phase 9 | **B** (Q3) |
| **Pause** | silent one-interval deferral (`:520`); no accounting | explicit pause semantics (§54) | no commitment accounting | Phase 9 | **D** (Q5) |
| **Modification** | destructive PATCH (`:444-453`) | future-only / versioned; immutable history | snapshot destruction; no versioning | Phase 9 | **G** (Q6/Q7) |
| **Observability** | `velrepeat_events`; `payment_incidents` (repo; prod pending 049); VelCenter surfaces | plan/cycle visibility; incident identity incl. plan/cycle | no cycle-level events; incident key lacks plan/cycle | Phases 5/10 + incident key extension | 6A governs; none new |

---

## 62. Implementation roadmap (NOT STARTED — gates shown per phase)

> **This task implements nothing.** Each phase below starts only after its owner decisions are answered
> in §60 (and §60.3). The phase order is fixed by the contract; phases may not skip their gates.

| Phase | Scope | Exit criteria | Gates |
|---|---|---|---|
| **1. Domain + schema** | Finalize the V2 entity model (plan/commitment/cycles/package lines/snapshots/payment linkage); additive schema design in **both** SQL files | reviewed schema design; cycle identity chosen (§49); no migration until owner + Neon quota | Q13, Q16 |
| **2. Package + pricing** | Package composition structure; pricing engine (§44 pipeline); tier data store; snapshot write path | tier changes need no code edit; snapshot fields test-proven | H, E, Q15 |
| **3. Repeat Plan** | Prepaid plan creation/read: commitment, schedule, snapshot, total prepaid; versioning hook | a contract-shaped plan can be created (staging) with no cycle generation yet | E, Q16 |
| **4. Prepaid payment** | Plan-level Stripe charge (Q13/Q14 shape); webhook settlement; incident on unsafe settle; COD only per canonical config | one charge per plan; no per-cycle charge; incident proven | Q13, Q14 |
| **5. Delivery Cycle** | Cycle rows: ordinal, `scheduled_at`, status, quantity/price snapshot, order refs | cycle count = commitment; unique `(plan, cycle_number)` enforced | identity design; F |
| **6. Inventory** | Chosen Model A/B; single reservation authority; resolve variant/non-variant asymmetry; `sold_count` exactly-once | no double commit/release; guard extended to VelRepeat; tests | A, Q2 moment |
| **7. Scheduler** | Central-only due processing for cycles; timezone semantics; ownership predicate on any seller surface | ownership tests; timezone explicit | Q16, Q17 |
| **8. Order fulfillment** | Cycle → order(s) idempotent claim; fulfillment state per cycle; trace `Order→Cycle→Plan→Customer→Payment` | same plan + cycle + execution ⇒ one order (DB-gated test) | Q13 (trace), F |
| **9. Cancellation / pause / modification** | Implement owner decisions B/C/D/G/I minimally; immutability enforced | completed cycles immutable; no invented refunds | B, C, D, G, I |
| **10. Tests + E2E** | Unit + DB-gated + CI `postgres:16`; extend `inventory-settlement` guard to VelRepeat; idempotency proof | all §63 criteria green in CI; production migration plan | all above |

**Stop conditions are cumulative:** no phase may be merged while any gate it touches is unanswered.

---

## 63. Acceptance criteria (contract completeness)

The V2 contract is complete when all of the following hold — **all are satisfied by this document as a
specification; none are satisfied in code**:

| # | Criterion | Where |
|---|---|---|
| 1 | business model described without ambiguity | §39 |
| 2 | Package vs Product clearly separated | §39.1/§40 |
| 3 | quantity per cycle separated from total commitment | §41 |
| 4 | schedule separated from commitment | §42/§43 |
| 5 | prepaid payment separated from fulfillment | §46/§48 |
| 6 | Repeat Plan separated from Order | §49/§50 |
| 7 | Cycle separated from Order | §49/§50 |
| 8 | pricing pipeline + snapshot defined | §44/§45 |
| 9 | inventory semantics explicitly identified (A vs B, not chosen) | §51 |
| 10 | `sold_count` invariant defined | §52 |
| 11 | payment incident defined | §59 |
| 12 | authorization defined | §57/§60.1 |
| 13 | idempotency defined | §58 |
| 14 | cancellation identified | §53 |
| 15 | pause/skip identified | §54 |
| 16 | modification identified | §55 |
| 17 | B2C/B2B identified | §56 |
| 18 | unresolved financial decisions explicitly listed | §60.2/§60.3 (A–I, Q13–Q17) |
| 19 | **no production code changed** | §64 + audit `velrepeat-v2-contract-2026-09-30.md` |

---

## 64. V2 prohibited actions (this phase, and until gates close)

- Do **not** modify production code, database schema, migrations, frontends or packages beyond
  owner-approved phase work. (The contract phase changed only `.ai/` — audit
  `velrepeat-v2-contract-2026-09-30.md`; **Phase 1** changed only the two canonical SQL files + one test
  file — audit `velrepeat-v2-phase1-dependency-analysis-2026-09-30.md`.)
- Do **not** create migrations, fake APIs, fake schemas, or duplicate inventory/payment systems.
- Do **not** enable COD, change Stripe mode, or bypass `assertPaymentMethodUsable()` /
  `isCodEnabled()` / `isCodCustomerSelectable()`.
- Do **not** increment `sold_count` at plan creation, cycle creation, or reservation; no
  VelRepeat-specific counter.
- Do **not** decide refund, inventory-reservation, pause/skip, modification-pricing, or out-of-stock
  policy — those are §60.2 decisions.
- Do **not** delete important content from Parts I–II, and never write proposed behavior as current
  behavior (or vice versa).

---

**V2 CONTRACT STATUS: specification complete.**
**IMPLEMENTATION STATUS: PHASE 1 COMPLETE (2026-09-30) — additive domain + schema only.**
`velrepeat_packages` / `velrepeat_package_items` · `velrepeat_plans.commitment_cycles` ·
`velrepeat_pricing_snapshots` / `velrepeat_pricing_snapshot_items` · `velrepeat_cycles`
(`UNIQUE (plan_id, cycle_number)`) · `orders.velrepeat_cycle_id` + FK. Tests:
`backend/tests/velrepeat-v2-domain-schema.test.ts`. **No migration file** —
`production-db-migrate.yml`
auto-applies all pending migrations (048–050 owner-blocked); next number `051`.
**Phases 2–10 NOT STARTED.**
Gates: §60.1 approved (1A–7B) · §60.2 Decisions A–I **[OWNER DECISION] — answered 2026-09-30; B, C, D,
F still need an exact monetary formula** · §60.3 Q13–Q17 **[OWNER DECISION] — all answered
2026-09-30** · **PHASE 2 = BLOCKED** (pricing-rule resolution · rounding/currency · package-authoring
ownership) · STOP #1/#2/#3/#4/#12 remain in force (§18, §32, §37, §51, §53, §54, §55).
Full record: `.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md`.
