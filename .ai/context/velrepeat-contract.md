# VelRepeat Business & Payment Contract

**Status:** AUTHORITATIVE CONTRACT (design only — no implementation)
**Created:** 2026-09-30 · **Baseline:** `9780aa1` (= `origin/main`)
**Supersedes for VelRepeat:** nothing. **Governs:** all future VelRepeat implementation, tests,
inventory behavior, payment behavior and operator behavior.
**Primary evidence:** `.ai/tasks/audits/medium-10-velrepeat-commerce-lifecycle-2026-09-30.md` (MEDIUM #10
audit), plus the source it cites.

> **This document invents no policy.** Every statement is tagged with an evidence class. Where the
> repository cannot prove a business answer, the row says **OWNER DECISION REQUIRED** and the
> implementation must stop there rather than guess.

---

## 0. How to read this document

| Tag | Meaning |
|---|---|
| **[PROVEN]** | Read directly from source at `9780aa1`; file:line cited. |
| **[INTENT]** | Documented in source comments, `.ai/`, or an audit — but not enforced by a test. |
| **[DECISION]** | A **proposed** rule that follows from the canonical authorities. Not yet owner-approved. |
| **[OWNER DECISION REQUIRED]** | No source, doc, or test answers it. **Implementation must not guess.** |

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

> **OWNER DECISION #1 — Does VelRepeat respect `COD_ENABLED`?**
> Today it does not (`processPlan` never calls `isCodEnabled()`). Should a run be refused while the COD
> rail is off, or is VelRepeat deliberately exempt? If exempt, the exemption must be documented,
> because it contradicts `payment-config.ts`'s fail-closed design.

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

> **OWNER DECISION #7 — May an approved seller trigger due plans that are not theirs?**
> `POST /api/subscriptions/process-due` (`seller-orders.ts:755`) runs any customer's due plans with no
> user scope. Scope it, restrict it, or retire it in favour of the scheduler?

---

## 22. What this contract deliberately does NOT do

- It does **not** change any line of production code, test, schema or migration.
- It does **not** enable or disable COD, and does not assume a value for either flag.
- It does **not** introduce a payment rail, a status, a refund/retry/reopen policy, or a permission model.
- It does **not** treat the current VelRepeat divergence as intentional. §42.2 **M10 remains OPEN**, and
  MEDIUM #8 / MEDIUM #9 / LOW #12 results are untouched.
- It does **not** claim production verification. Migrations **048/049/050 remain unapplied** (Neon
  quota); no Stripe or browser E2E has ever run.

**Implementation status: NOT STARTED — blocked on Owner Decisions #1–#7.**
