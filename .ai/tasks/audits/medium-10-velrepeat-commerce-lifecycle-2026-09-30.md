# MEDIUM #10 Audit — VelRepeat Commerce Lifecycle

**Date:** 2026-09-30 · **Mode:** READ-ONLY AUDIT (no production code, test, schema, migration or policy changed)
**Baseline:** `a8b5981` (= `origin/main`), working tree clean, branch `main`
**Audited source:** VelRepeat V2 scheduler + routes, `lib/inventory.ts`, `lib/payment-config.ts`, `lib/payment-reservation.ts`, `lib/order-fulfillment.ts`, the Stripe/COD guards, and the whole test suite.

> Artifact location note: the repo's documented convention is `.ai/tasks/completed/` (`.ai/tasks/README.md`).
> The task brief specified `.ai/tasks/audits/`, so that path was used. No production source or test was touched.

---

## Verdict

# ⛔ BLOCKED — POLICY NOT PROVEN

MEDIUM #10 is **confirmed real** (not fixed, not a false positive), and this audit proved **more** than
the original finding. But every available fix requires a **business/payment decision that no source and
no document in this repository states**, and the task's own hard-stop condition applies.

Nothing was changed. No status was invented, no policy was guessed, no test was weakened.

---

## Executive Summary

`processPlan()` is a **complete second order-creation path** that sits outside every commerce guard the
rest of the system enforces. It is live (`server.ts:519` starts the worker unconditionally) and it is
**atomic** — all of it runs in one transaction, so nothing partial is stranded.

| # | Finding | Severity | Evidence tier |
|---|---|---|---|
| **A** | VelRepeat creates a `'cod'` payment while the COD rail is **disabled platform-wide**, bypassing `assertPaymentMethodUsable()` — the one guard that fails closed | **HIGH** | SOURCE PROVEN |
| **B** | `sold_count` incremented at order **creation**, not at settlement — a second writer outside the settlement authority | MEDIUM | SOURCE PROVEN |
| **C** | A non-variant VelRepeat line **reserves** stock that can never be **committed** (COD never reaches the settlement webhook), with **no expiry** to release it | MEDIUM–HIGH | SOURCE PROVEN |
| **D** | A variant VelRepeat line **consumes** `product_variants.stock` at creation — a different mutation shape from the non-variant line in the same loop | MEDIUM | SOURCE PROVEN |
| **E** | **NEW (not in the original M10):** a VelRepeat order is `pending`, so it is payable online — paying it **double-counts `sold_count`** and adds a second terminal transition on one reservation | **HIGH** | SOURCE PROVEN (derived) |
| **F** | The plan route validates `paymentMethod === 'cod'` but **never consults `isCodEnabled()`** | HIGH | SOURCE PROVEN |
| **G** | `velrepeat_plans.payment_method` is free text with **no CHECK**, and the scheduler **ignores it**, hardcoding `'cod'` | LOW | SOURCE PROVEN |

**What *is* proven as intentional:** VelRepeat being COD-first is **documented intent**
(`velrepeat-scheduler.ts:16-20`, enforced at `velrepeat-plans.ts:223-224`). What is **not** stated
anywhere is whether that intent is meant to **override** `COD_ENABLED=false`, who settles a COD payment,
and when a recurring order's stock becomes a sale.

---

## Source Evidence

### Entry points — all three converge on the same unguarded path

| Trigger | Site | Scheduling |
|---|---|---|
| Polling worker | `jobs/velrepeat-scheduler.ts:454` (`processDuePlans`) via `:467-483` (`startVelRepeatScheduler`, 60 s) | `server.ts:519` — **started unconditionally** |
| "Run now" (customer) | `routes/velrepeat-plans.ts:574` | on demand |
| Seller-triggered run | `routes/seller-orders.ts:780` | on demand |

### The payment guard, and who actually calls it

```
payment-config.ts:387  assertPaymentMethodUsable(method)
payment-config.ts:313  isCodEnabled()        → only explicit "true"/"1" (fails CLOSED)
payment-config.ts:325  isCodCustomerSelectable() → declared && isCodEnabled()
```

**Production callers of `assertPaymentMethodUsable` — exactly two:**

| Caller | Site | Guards |
|---|---|---|
| `routes/cart.ts` | **:697** | normal checkout (`:688 normalizePaymentMethod` first) |
| `routes/stripe.ts` | **:1066** | Stripe checkout ("before any order, payment, shipment, or settlement write") |

**`velrepeat-scheduler.ts`, `velrepeat-plans.ts` and `velrepeat.ts` import nothing from
`payment-config.ts` and call none of these guards.** Verified by import scan and by a direct grep of
the three files for `payment-config|assertPaymentMethodUsable|isCodEnabled|COD_ENABLED` → **no match**.

### The one existing artifact that already knew about this

`backend/tests/inventory-settlement.test.ts:95-99` — written during CRITICAL #1/#2 (§43):

> `velrepeat-scheduler.ts` reserves at creation and is a **known, separate finding (audit §42
> MEDIUM #10)**.

and the guard list at `:100-121` (`orderPaths`) — which forbids every other order path from writing
`sold_count = sold_count +`, `UPDATE inventory` or `stock = stock +` — **deliberately omits**
`velrepeat-scheduler.ts`. So the §43 hardening deliberately did not cover VelRepeat, and the divergence
is already written down in the test suite.

---

## VelRepeat Lifecycle

Every arrow below is read from source, not assumed. **All of it is inside one `withTransaction`
(`velrepeat-scheduler.ts:111` → `:394`)**.

| # | Step | File : line | DB operation | Status before → after | Guard called | Test proving it |
|---|---|---|---|---|---|---|
| 1 | **Trigger** | `velrepeat-scheduler.ts:454` / `:467` | `SELECT … velrepeat_plans WHERE status='active' AND next_run_at <= NOW()` | plan `active` | — | `velrepeat-core.test.ts:156` (DB-gated) |
| 2 | **Claim** | `:113-120` | `SELECT … FOR UPDATE` re-checking `status='active' AND next_run_at<=NOW()` | — | row lock | `velrepeat-core.test.ts:156` |
| 3 | **Run insert** | `:126-132` | `INSERT velrepeat_runs … ON CONFLICT (plan_id, scheduled_for) DO NOTHING` | `processing` | UNIQUE `(plan_id, scheduled_for)` | `velrepeat-core.test.ts:217-221` |
| 4 | **Item load** | `:137-156` | join `velrepeat_items`→`products`/`product_variants`/`shops`/`sellers`/`inventory` | — | — | — |
| 5 | **Validation** | `:174-200` | — (read-only) | run → `out_of_stock` / `item_unavailable` | `validatePlanItem()` :68 | `velrepeat-core.test.ts:59-138` (unit) |
| 6 | **Order creation** | **`:269-284`** | `INSERT INTO orders (user_id, shop_id, status, total_amount, currency, shipping_address_id, shipping_address, notes, velrepeat_run_id) VALUES (…,'pending',…)` | **new** → `pending` | ❌ **no payment-method guard** | ❌ **none** |
| 7 | **order_items** | `:312-323` | `INSERT INTO order_items` (+ name/image/variant snapshots) | — | — | ❌ none |
| 8a | **Inventory (variant)** | **`:326-335`** | `UPDATE product_variants SET stock = stock - $1 WHERE id=$2 AND stock >= $1` (throws on 0 rows) | stock **consumed** | atomic guarded decrement | ❌ none |
| 8b | **Inventory (non-variant)** | **`:341`** | `reserveInventoryStock(client, …)` → `UPDATE inventory SET reserved = reserved + $1 WHERE … quantity - reserved >= $1` | stock **held** | atomic guarded reserve | ❌ none |
| 9 | **sold_count** | **`:343-346`** | `UPDATE products SET sold_count = sold_count + $1` | **incremented at creation** | ❌ **not the settlement authority** | ❌ none |
| 10 | **Payment** | **`:350-354`** | `INSERT INTO payments (order_id, amount, currency, method, status, provider) VALUES ($1,$2,$3,'cod','pending','cod')` | **new** → method `cod`, status `pending`, provider `cod` | ❌ **hardcoded literals** | ❌ none |
| 11 | **Run success** | `:359-369` | `UPDATE velrepeat_runs SET status='success' …`; `UPDATE velrepeat_plans SET next_run_at=$2` | run `success` | — | `velrepeat-core.test.ts:230-236` |
| 12 | **Notify** | `:376-388` | `insertEvent` / `notifyUser` | — | — | — |

**Steps 6–11 are all in the same transaction.** Note step 7 runs **once per shop** (`:262`), so one plan
run can create several orders — this is the same shape as LOW #14 (per-shop settlement).

---

## Payment Lifecycle

### What VelRepeat writes vs. the canonical order/payment state machine

| Field | VelRepeat value | Canonical set | Verdict |
|---|---|---|---|
| `orders.status` | `'pending'` (`velrepeat-scheduler.ts:272`) | 12-value `orders_status_check` (MEDIUM #9) | ✅ **valid** — `pending` is allowed |
| `payments.status` | `'pending'` (`:352`) | `payments.status` has **no CHECK** | ✅ storable, no constraint to satisfy |
| `payments.method` | `'cod'` (`:352`) | `normalizePaymentMethod('cod') === 'COD'` | ⚠️ case mismatch — stored lowercase, canonical id is `COD` |
| `payments.provider` | `'cod'` (`:352`) | `PaymentProvider = "STRIPE" \| "CARRIER"` (payment-config.ts:26) | ❌ **`'cod'` is not a `PaymentProvider`** |
| `orders.payment_expires_at` | **never set** (absent from the INSERT at `:270-273`) | written by `applyPaymentReservationPolicy` | ❌ **NULL** |
| `orders.reservation_policy` | **never set** | `"v2"` / 30 min | ❌ **NULL** |

**Consequence of `payment_expires_at IS NULL`** — the expiry sweep selects only
`WHERE payment_expires_at IS NOT NULL AND payment_expires_at <= NOW()`
(`payment-reservation-scheduler.ts:83-84`, and again in the guarded claim at `:154-155`), and
`expireOne` bails at `:128` if the deadline is falsy. **A VelRepeat order can never be expired
automatically.** The doc agrees this is by design for COD ("COD gets no window at all"), but the
*inventory* consequence is not addressed anywhere.

### Can a VelRepeat order ever be fulfilled?

`order-fulfillment.ts:218-235` — `paymentAllowsConfirmation()`:

```ts
if (paidRow) return { allowed: true, … };
if (codEnabled && latest && isCodPaymentMethod(latest.method)) return { allowed: true, … };
return { allowed: false, … };
```

A VelRepeat payment row is `status='pending'` (never `paid`) and `method='cod'`, so confirmation passes
**only while `isCodEnabled()` is true**. With COD disabled in production, a VelRepeat order **can never
leave `pending`** except by being cancelled. The module comment at `order-fulfillment.ts:58-61` says
this branch "is closed in production" — which is consistent, and confirms COD is not meant to be
fulfilment-reachable while the rail is off.

---

## COD Evidence

**A — Where normal checkout uses the guard:** `routes/cart.ts:697` (`assertPaymentMethodUsable`) and
again `routes/stripe.ts:1066`. Both are described in-source as the real boundary: *"the storefront
hiding the option is only UX, this is the boundary"* (`cart.ts:685`).

**B — Does VelRepeat use the same guard? NO.** Verified by import scan and by grep. The three VelRepeat
files contain **no reference** to `payment-config` at all.

**C — Can VelRepeat create a payment with `method = COD`? YES** — `velrepeat-scheduler.ts:352` inserts
the literal `'cod'`, unconditionally, for every successful plan run.

**D — With `COD_ENABLED` unset/false, can it still create a COD payment row? YES.** Source evidence,
end to end:

1. `velrepeat-plans.ts:203` defaults `paymentMethod = "cod"` when the body omits it;
2. `velrepeat-plans.ts:223-224` accepts it because the check is only
   `if (paymentMethod !== "cod")` — it never calls `isCodEnabled()`;
3. the plan row is stored (`:260-268`) with `velrepeat_plans.payment_method` =
   `TEXT NOT NULL DEFAULT 'cod'`, **no CHECK constraint** (`db/run-sqleditor.sql:834`);
4. `processPlan()` claims the plan (`:113-120`, status only) and inserts the payment at `:350-354`
   with no method check anywhere in `111-394`.

`isCodEnabled()` is therefore **irrelevant to VelRepeat**: the rail being off does not stop a COD order,
and the absence of a COD settlement webhook means nothing ever moves that payment out of `pending`.

**E — Is COD-for-VelRepeat documented intent? YES for the rail choice, NO for the override.**
Evidence for intent:

- `velrepeat-scheduler.ts:16-20`: *"plans are created with payment_method = 'cod' (the platform's
  default provider) … A real recurring payment provider (Stripe saved payment method / payment
  intents) can be added later behind plan.payment_method without changing the run/order machinery."*
- `velrepeat-plans.ts:224`: the route's only accepted value is `'cod'`.

Evidence **absent** — searched `.ai/**` and all source: **no document, comment or test anywhere states
that VelRepeat is exempt from `COD_ENABLED`**, or conversely that it must respect it. `.ai/context/payment.md`
states COD is disabled and must stay disabled "until a carrier/settlement model exists" — which is
precisely the model VelRepeat does not have.

**Policy status: UNPROVEN.** This is decision #1 below.

---

## Inventory Lifecycle

Call graph, all production callers:

| Function | Definition | Callers |
|---|---|---|
| `reserveInventoryStock` | `inventory.ts:54` | `cart.ts:972` · **`velrepeat-scheduler.ts:341`** |
| `commitOrderInventory` | `inventory.ts:115` | **`stripe.ts:559` only** (the settlement webhook) |
| `releaseOrderInventory` | `inventory.ts:209` | `cart.ts:1400` (customer cancel) · `stripe.ts:614` (`payment_failed`) · `stripe.ts:661` (session expired) · `seller-orders.ts:629` · `center.ts:531` · `payment-reservation-scheduler.ts:183` |

### Matrix

| Flow | Reserve | Commit | Release | Guard / idempotency |
|---|---|---|---|---|
| **Normal checkout** (`cart.ts`) | ✅ `:972` inside the order tx | ✅ via `stripe.ts:559` on settlement | ✅ `:1400` on cancel | `inventory_released` claim, `RELEASABLE_STATUSES`, no-settled-payment gate |
| **Stripe success** | — | ✅ `stripe.ts:559` (single authority) | ❌ refused (settled payment) | `commitOrderInventory` = the one terminal transition |
| **Payment failed** | — | ❌ | ✅ `stripe.ts:614` → status `payment_failed` ∈ releasable | idempotent claim |
| **Payment expired** | — | ❌ | ✅ `payment-reservation-scheduler.ts:183` | idempotent claim; requires `payment_expires_at IS NOT NULL` |
| **VelRepeat — non-variant** | ✅ `:341` (`reserved += N`, `quantity` untouched) | ❌ **NEVER** — `commitOrderInventory` is only reachable from the Stripe webhook, which COD never reaches | ⚠️ only via a **manual** cancel; **no expiry** (`payment_expires_at` NULL) | ⚠️ the release itself is sound, but nothing *schedules* it |
| **VelRepeat — variant** | ⚠️ **no reserve** — `:326-335` decrements `product_variants.stock` directly (**a consume**) | n/a — `commitOrderInventory` leaves variant stock where the reservation put it | ⚠️ `releaseOrderInventory` *would* add it back, but only on a manual cancel | ⚠️ asymmetric with the non-variant line **in the same loop** |

**The provable leak (non-variant):** after a run, `sold_count` says *N sold*, `inventory.reserved` says
*N held*, `inventory.quantity` is unchanged, and availability (`quantity - reserved`) is permanently
reduced by *N*. Because COD never settles and no expiry exists, that hold is released **only if someone
manually cancels the order**.

**Is a release reachable at all? YES, but only reactively.** `orders.status='pending'` is in
`RELEASABLE_STATUSES` (`inventory.ts:176-181`), `inventory_released` defaults `FALSE`
(`db/schema.sql:377`), and the VelRepeat payment is `'pending'` (not in `PAYMENT_SETTLED_STATUSES`), so
`releaseOrderInventory` would succeed on `cart.ts:1400` / `seller-orders.ts:629` / `center.ts:531`. The
mechanism exists; **nothing triggers it on a schedule.**

---

## sold_count Writers

Complete list — `sold_count = sold_count + $1` has **exactly two** production writers:

| Writer | File : line | Function | Trigger | Order/payment state | Intended? |
|---|---|---|---|---|---|
| **Settlement authority** | `lib/inventory.ts:141` | `commitOrderInventory()` | Stripe `payment_intent.succeeded` → `stripe.ts:559` | payment **settled**, `inventory_released = FALSE` | ✅ **YES — canonical** |
| **VelRepeat** | `jobs/velrepeat-scheduler.ts:344` | `processPlan()` | plan run, inside the item loop | `orders.status='pending'`, `payments.status='pending'` — **nothing settled** | ❌ **NO — deviates** |

### Canonical source of truth

**`commitOrderInventory()` (`lib/inventory.ts:141`) is canonical**, and this is *proven*, not chosen:

- `inventory-settlement.test.ts:120` asserts that **every** order-lifecycle path in `orderPaths`
  (`cart.ts`, `stripe.ts`, `seller-orders.ts`, `center.ts`, `payment-reservation-scheduler.ts`) must
  **not** contain `sold_count = sold_count +` — the invariant is written down and enforced by CI;
- `inventory-settlement.test.ts:129` repeats it for `stripe.ts`;
- `:98-99` names `velrepeat-scheduler.ts` as the **known exception** to that rule.

So the architecture states the authority unambiguously. The `intentional?` column above is answered by
an existing test, not by judgement — **but the test only records the exception; it does not say the
exception is desired.** That intent is decision #3 below.

### ⚠️ Finding E — double counting (derived, not previously recorded)

A VelRepeat order is `orders.status='pending'`, and `stripe.ts:1095` accepts
`["pending","pending_payment"]` for payment. Because `payment_expires_at` is NULL, the window check at
`stripe.ts:1110` is **skipped** (`reservationExpiresAt !== null` is false). So a customer can pay a
VelRepeat COD order online through the normal "continue payment" button. If they do:

- `commitOrderInventory` runs → `sold_count += N` **a second time** for the same units;
- non-variant: `quantity -= N, reserved -= N` on top of the creation-time reserve;
- the `inventory_released` claim does **not** block it — that flag is `FALSE` and is only consulted on
  the release path, while the settle path (`stripe.ts:433`) requires `inventory_released = FALSE` too.

**Net: `sold_count` over-reports by N for any VelRepeat order paid online.** This is a new finding
beyond the original M10 text and is the strongest argument that the bypass is not merely cosmetic.

---

## Transaction Boundaries

`processPlan()` opens **one** `withTransaction` at `velrepeat-scheduler.ts:111` and returns at `:394`.

| Operation | In the transaction? | Note |
|---|---|---|
| Claim run (`FOR UPDATE`) | ✅ `:113` | |
| `INSERT velrepeat_runs` | ✅ `:126` | |
| Create order | ✅ `:269` | |
| Create `order_items` | ✅ `:312` | |
| Create payment | ✅ `:350` | |
| Reserve / consume inventory | ✅ `:326-342` | |
| **Increment `sold_count`** | ✅ `:343` | |
| Update run + plan state | ✅ `:359-369` | |
| Commit point | `:394` (implicit COMMIT on `withTransaction` return) | |
| Rollback | any throw — e.g. `INSUFFICIENT_STOCK` at `:334` | `reserveInventoryStock` throws at `inventory.ts` when the guarded UPDATE matches 0 rows |

**Verdict: the transaction boundary is CORRECT.** Nothing partial is stranded by a mid-run failure —
an `INSUFFICIENT_STOCK` throw at `:334` rolls the whole run back, and the in-source comment at
`:337-340` says exactly that. Two early exits return `null` (`:121` not claimed, `:133` already run)
and simply commit an empty transaction.

**The risk is not a torn transaction — it is a fully-committed wrong transaction.** The run commits
*successfully* with a COD payment that no settlement path will ever touch. The reserve is then
indefinite by construction, not by accident.

---

## Order State

| Value | Written where | In the canonical 12-value set? | Notes |
|---|---|---|---|
| `orders.status = 'pending'` | `velrepeat-scheduler.ts:272` | ✅ yes | Also what `cart.ts:89` writes |
| `orders.status = 'pending_payment'` | — | ✅ | **never used by VelRepeat** — so no Stripe session, no `pending_payment` phase |
| `paid` | — | ✅ | unreachable (COD never settles) |
| `payment_failed` | — | ✅ | unreachable (no failure path) |
| `cancelled` | — | ✅ | reachable only via a manual cancel |
| `expired` | — | ✅ | **unreachable** — `payment_expires_at` is NULL, so the sweep can never select it |
| `confirmed` / `packing` | — | ✅ | **unreachable while COD is disabled** (`paymentAllowsConfirmation`) |

**No inconsistency with the order state machine was found** — every value VelRepeat writes is legal.
The findings are about the *lifecycle around* the state, not the state vocabulary itself. MEDIUM #9's
`orders_status_check` is satisfied and unaffected. No new status is proposed.

---

## Test Coverage

`velrepeat-core.test.ts` (246 lines) is the only dedicated file. The table below covers the nine
required requirements.

| Requirement | Existing test | Covered? |
|---|---|---|
| COD disabled cannot create a COD payment | `payment-foundation.test.ts:297-338` covers `assertPaymentMethodUsable("COD")` → 403; `order-fulfillment-state-machine.test.ts:211-214`. **Neither touches VelRepeat.** No test drives `processPlan` with `COD_ENABLED` unset | ❌ **NO** |
| VelRepeat payment lifecycle (creation → settlement) | none — the only integration test (`:156`) asserts run/order counts and `next_run_at`; it never reads the `payments` row | ❌ **NO** |
| `sold_count` only after valid settlement | `inventory-settlement.test.ts:120` forbids `sold_count` in 5 order paths — **and deliberately excludes VelRepeat** (`:98-99`) | ❌ **NO** (the invariant is *documented as violated*) |
| Reservation commit | `inventory-settlement.test.ts:416` (Test A/J) covers the Stripe path only | ❌ **NO** for VelRepeat |
| Reservation release | `inventory-race.test.ts:224` (idempotent release), `payment-reservation-expiry.test.ts` — Stripe/expiry paths only | ❌ **NO** for VelRepeat |
| Failed payment | `stripe.ts:614` path covered | ❌ **NO** for VelRepeat (no failure path exists) |
| Expired payment | `payment-reservation-expiry.test.ts` — requires `payment_expires_at`, which VelRepeat never sets | ❌ **NO** (unreachable) |
| Duplicate VelRepeat execution | `velrepeat-core.test.ts:217-221` — UNIQUE `(plan_id, scheduled_for)`, run count = 1 | ✅ **YES** (DB-gated) |
| Concurrent execution | `velrepeat-core.test.ts:156` — two concurrent `processPlan` → exactly 1 run, 1 order | ✅ **YES** (DB-gated) |

**Summary: 2 of 9 covered** — and both are the concurrency/idempotency guards, which are the parts that
were already correct. The entire commerce lifecycle (payment, inventory, `sold_count`) is untested.

---

## CI Evidence

| Tier | What it proves here |
|---|---|
| **SOURCE PROVEN** | Every arrow, guard bypass, writer and value in this document was read from source at `a8b598b`. The single strongest artifact is `inventory-settlement.test.ts:95-99`, which independently names the divergence. |
| **TEST PROVEN** | `bun run test` = **956 pass / 189 skip / 0 fail** (1145 tests / 52 files) at `a8b5981`. The 2 VelRepeat DB-gated tests **SKIP locally** — no PostgreSQL in this workspace. |
| **CI PROVEN** | Run `36648992825` on `a8b5981` — **success**, `1143 pass / 2 skip / 0 fail`. This is where `velrepeat-core.test.ts:156` actually executes, against the disposable `postgres:16`. |
| **PRODUCTION PROVEN** | ❌ **NONE.** No production read was performed, and none is claimed. |

**CI proves the concurrency guards pass. It proves nothing about COD, `sold_count` or the reservation —
no test asserts any of them.**

---

## Production Verification

**Not verified. Nothing below is claimed as production-proven.**

| Item | Status | Source |
|---|---|---|
| Migration **048** (`orders.payment_expires_at`) | ⛔ **NOT APPLIED** | Neon quota; `stripe.ts:1081-1085` records the production error `column "payment_expires_at" does not exist` (2026-09-28) |
| Migration **049** (`payment_incidents`) | ⛔ **NOT APPLIED** | same quota |
| Migration **050** (`orders_status_check`) | ⛔ **NOT APPLIED** | same quota; production `orders.status` still unconstrained |
| Neon quota | ⛔ `ERROR: Your account or project has exceeded the quota` — **OWNER ACTION** | `Migrate Neon Database` fails on its first step, before any migration |
| Real Stripe TEST E2E | ⛔ **never executed** | no PaymentIntent / QR / webhook / refund has ever run from a workspace |
| Browser E2E | ⛔ **not run** | no signed-in session; the VelRepeat order surfaces (`/orders`, subscription dialog) have not been seen |

**Material consequence for this audit:** with 048 unapplied, `applyPaymentReservationPolicy` is skipped
by design, so VelRepeat orders and legacy orders look alike here. Once 048 lands, normal checkout orders
get a deadline and an expiry sweep — **and VelRepeat orders still will not**, widening the divergence
rather than closing it. Conversely, findings A–G are all visible on the *current* schema and do not
depend on any migration.

**The VelRepeat worker is live regardless of migrations** — `server.ts:519` is unconditional.

---

## Proven Facts

1. `assertPaymentMethodUsable` has **exactly two** production callers — `cart.ts:697` and
   `stripe.ts:1066`. No VelRepeat file references `payment-config` at all.
2. `isCodEnabled()` fails closed, yet is **never consulted** by any VelRepeat code path.
3. `processPlan()` inserts `method='cod', status='pending', provider='cod'` unconditionally
   (`velrepeat-scheduler.ts:350-354`), and the plan route only checks `paymentMethod !== "cod"`
   (`velrepeat-plans.ts:223`), never the feature flag.
4. `velrepeat_plans.payment_method` is `TEXT NOT NULL DEFAULT 'cod'` with **no CHECK**
   (`db/run-sqleditor.sql:834`); the scheduler **ignores** `plan.payment_method` and hardcodes `'cod'`.
5. `sold_count` has exactly **two** writers: `inventory.ts:141` (settlement) and
   `velrepeat-scheduler.ts:344` (creation). The first is canonical — proven by the guard list at
   `inventory-settlement.test.ts:100-121`.
6. `commitOrderInventory` has exactly **one** caller, `stripe.ts:559` — a Stripe webhook. A COD order can
   never reach it.
7. A VelRepeat order has `payment_expires_at = NULL`, so the expiry sweep
   (`payment-reservation-scheduler.ts:83-84, 154-155, 128`) can **never** select or expire it.
8. `releaseOrderInventory` **would** succeed on a VelRepeat order (status `pending` is releasable, flag
   `FALSE`, payment not settled) — but only a **manual cancel** triggers it.
9. A VelRepeat order is payable online (`stripe.ts:1095` accepts `pending`; the window check at `:1110`
   is skipped when the deadline is NULL), and paying it makes `commitOrderInventory` run **in addition
   to** the creation-time `sold_count` increment → double counting.
10. `payments.provider = 'cod'` is not a member of `PaymentProvider` (`payment-config.ts:26`:
   `"STRIPE" | "CARRIER"`).
11. The whole of `processPlan()` is **one transaction** (`:111`–`:394`); a stock throw at `:334` rolls
    the run back cleanly. The transaction boundary is correct.
12. `orders.status='pending'` is legal under MEDIUM #9's `orders_status_check`; no state-machine
    violation exists.
13. `startVelRepeatScheduler()` is called unconditionally at `server.ts:519` — the path is **live**.
14. An existing test already records this as a known open finding
    (`inventory-settlement.test.ts:95-99`).
15. 2 of the 9 required behaviours are covered; both are the concurrency guards.

## Unproven Facts

1. **Whether VelRepeat is *meant* to run while COD is disabled.** No source, doc or comment says so.
2. **What settles a COD payment.** There is no carrier webhook, no settlement job, no COD
   fulfilment path anywhere in the repository.
3. **Whether `sold_count` at creation is intended** for a recurring order. The §43 test records the
   deviation but does not endorse it.
4. **Whether a recurring order should hold a reservation or consume at creation.** Both shapes exist
   today for the same run, and neither is documented as deliberate.
5. **Whether a VelRepeat order should be payable online at all** — nothing addresses the `pending`
   status being Stripe-payable.
6. **Whether `provider='cod'` is intentional** or simply a placeholder for a future carrier rail.
7. **Whether any VelRepeat plan or order exists in production.** No production read was made.
8. **The true blast radius in production** (how many recurring orders, how much stock held) — not
   observable from a workspace.

---

## Risks

| # | Risk | Likelihood | Impact |
|---|---|---|---|
| 1 | Stock held indefinitely by non-variant VelRepeat lines (no expiry, no settlement) — availability shrinks run after run | **High** (every run) | **High** — phantom out-of-stock, lost sales |
| 2 | `sold_count` over-reports for any VelRepeat order paid online | Medium | Medium — public sales figures wrong |
| 3 | COD payments accumulate in `pending` forever with no operator view — nothing in VelCenter lists them (HIGH #5's `payment_incidents` only fires on the Stripe webhook) | **High** | **High** — money is owed and invisible |
| 4 | A seller/admin can act on a VelRepeat order whose payment can never be `paid` — confirmation is refused while COD is off | Medium | Medium — order appears stuck at `pending` |
| 5 | `payments.provider='cod'` violates the `PaymentProvider` union — any future provider-aware code will mis-branch | Medium | Low–Medium |
| 6 | Variant and non-variant lines mutate stock in **different ways** in the same loop — a future fix to one will not fix the other | Medium | Medium |
| 7 | No test would catch a regression in any of the above | **High** | **High** — the lifecycle is untested |

---

## Required Owner Decision

**Verdict: BLOCKED — POLICY NOT PROVEN.** The audit must stop here. Each item below is a business or
payment-policy question that **no source and no document in this repository answers**, and every
available fix is blocked on one of them.

1. **COD gating.** Should a VelRepeat plan/run be refused while `COD_ENABLED` is off — i.e. is VelRepeat
   exempt from the platform's COD feature flag, or must it respect it? (Today it is silently exempt.)
   *If exempt, that exemption needs to be written down, because it contradicts `payment-config.ts`'s
   fail-closed design.*
2. **COD settlement.** What moves a COD payment from `pending` to `paid`? There is no carrier webhook
   and no settlement job. Without an answer, "reserve now, commit later" cannot be implemented, and
   no order can ever legitimately reach `confirmed` while COD is off.
3. **`sold_count` placement.** Should a recurring order count as sold at creation (an order *placed*) or
   at COD settlement (an order *paid*)? The canonical authority is `commitOrderInventory`; moving the
   increment is a policy decision, and it interacts with #2.
4. **Reservation shape.** Should a recurring line hold a reservation (as normal checkout does) or
   consume at creation? And if it holds, **what ends the hold** — given the expiry sweep cannot, because
   COD orders deliberately have no window?
5. **Online payment of a recurring order.** Should a VelRepeat order be offered "continue payment"? If
   yes, the double-count in fact #9 must be fixed first. If no, the order needs a state the storefront
   recognises as not-payable — which is a state-machine decision.
6. **Variant vs non-variant symmetry.** Should both lines behave identically? If yes, which shape is
   correct — and does the variant line need to become a reservation?
7. **Refund / cancellation of a recurring COD order.** If a customer cancels after the goods shipped,
   nothing in the current architecture handles it. (Related to, but distinct from, the open HIGH #5
   owner decision on a captured charge on a failed attempt.)

Until 1, 2 and 4 are answered, the VelRepeat bypass cannot be closed without either inventing a
settlement mechanism or changing a payment/inventory policy — both explicitly out of scope here.

---

*No production source, test, schema, migration, policy or business behaviour was changed by this audit.
The only file created is this document.*
