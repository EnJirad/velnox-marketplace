# Audit — VelRepeat V2 Decision Closure + Architecture Gate

**Date:** 2026-09-30 · **Repository:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Base commit:** `8c96a9e` (`docs(ai): record velrepeat v2 phase 1 domain pass`) — HEAD == `origin/main`, tree clean at start.
**Task type:** DECISION CLOSURE + ARCHITECTURE GATE. **Not an implementation phase.**
**Scope:** analysis and evidence only. No production code, no schema change, no migration, no scheduler /
webhook / settlement / inventory / `sold_count` / refund / order-lifecycle edit, no COD enable, no Stripe
mode change, no Phase 2–10 work.
**Deliverable:** this document.
**Authoritative contract:** `.ai/context/velrepeat-contract.md` (VelRepeat V2 — Prepaid Repeat Commerce,
Revision 2.1; §39–§64 normative).
**Governing rule:** wherever an unresolved decision touches **money · payment settlement · refund ·
inventory ownership · `sold_count` · payment liability · financial history · fulfillment obligation**,
the answer is recorded as **OWNER DECISION REQUIRED** — never guessed, never defaulted, never
implemented. Contract §64 and the task brief are both in force.

**Tag legend (EVERY statement is tagged):**

| Tag | Meaning |
|---|---|
| **[PROVEN]** | Verified against the working tree at the base commit, with a `file:line` citation. |
| **[IMPLEMENTED]** | Already exists in the repository now (code, DDL, or test). |
| **[ARCHITECTURE RECOMMENDATION]** | This audit's engineering recommendation — **not** owner policy, **not** implemented. |
| **[OWNER DECISION REQUIRED]** | Only the owner can answer; implementation must stop here. |
| **[BLOCKED]** | Cannot proceed until a named decision lands; no workaround attempted. |

---

## 1. Current state

| Item | State | Tag |
|---|---|---|
| V2 contract | COMPLETE — Revision 2.1, §39–§64 normative, §60 decision register (1A–7B approved; A–I, Q13–Q17 open) | **[PROVEN]** |
| Phase 1 (domain + schema) | COMPLETE, committed `ea79277` (`feat(velrepeat): implement prepaid repeat domain`) | **[IMPLEMENTED]** |
| Phase 1 doc/status commit | `8c96a9e` (`docs(ai): record velrepeat v2 phase 1 domain pass`) | **[IMPLEMENTED]** |
| Phase 1 artifacts | `velrepeat_packages`, `velrepeat_package_items`, `velrepeat_plans.commitment_cycles`, `velrepeat_pricing_snapshots` + items, `velrepeat_cycles` (`UNIQUE (plan_id, cycle_number)`), `orders.velrepeat_cycle_id` + FK + partial index — in **both** `db/schema.sql` and `db/run-sqleditor.sql` (byte-identical, `cmp` verified in this pass) | **[PROVEN]** |
| Phase 1 tests | `backend/tests/velrepeat-v2-domain-schema.test.ts` — structural half runs everywhere; 4 DB-gated tests run in CI `postgres:16` | **[IMPLEMENTED]** |
| Phases 2–10 | NOT STARTED — every one has an open gate (§19) | **[BLOCKED]** |
| Production DB | migrations **048, 049, 050 pending** (Neon quota, owner action); `payment_incidents` table and `orders.payment_expires_at` absent in production | **[PROVEN]** (documented in `.ai/context/payment.md`, last successful migrate 2026-09-25) |
| Production code | unchanged by this task | **[PROVEN]** |
| Migration `051` | **not created** — deliberately (see §18) | **[PROVEN]** |
| Decision register | 1A–7B binding; **A, B, C, D, E, F, G, H, I, Q13, Q14, Q15, Q16, Q17 + Q2 residual + package-authoring ownership still open** | **[OWNER DECISION REQUIRED]** |
| No phase may merge while a gate it touches is unanswered (contract §62) | in force | **[PROVEN]** |

**What this task closes:** nothing was answered — this task converts the open register into one
evidence-backed, decision-ready document. **What it does not do:** it does not decide anything.

---

## 2. Evidence from source

All anchors below were re-read from the working tree at `8c96a9e` during this task (no memory, no
assumption). Counts use explicit methods.

### 2.1 Database (`db/run-sqleditor.sql`; identical in `db/schema.sql`)

| Object | Evidence | Tag |
|---|---|---|
| `payments` | `:440-462` — `order_id UUID NOT NULL REFERENCES orders(id)` (`:442`); `idx_payments_order`; `idx_payments_one_active_stripe` = `UNIQUE (order_id) WHERE provider='stripe' AND status IN ('pending','requires_action')` (`:460`) | **[PROVEN]** |
| `payment_events` | `:463-477` — `event_id TEXT NOT NULL UNIQUE` (`:466`) | **[PROVEN]** |
| `payment_incidents` | `:478-495` — `dedupe_key TEXT NOT NULL UNIQUE` (`:480`), `order_id UUID NOT NULL REFERENCES orders(id)` (`:482`) | **[PROVEN]** |
| `refunds` | `:502-518` — `order_id UUID NOT NULL REFERENCES orders(id)` (`:504`), `payment_id UUID REFERENCES payments(id)` (`:505`), `idx_refunds_provider_refund` unique (`:517`) | **[PROVEN]** |
| `checkout_requests` | `:391-400` — `CONSTRAINT checkout_requests_user_scope_key UNIQUE (user_id, scope, request_key)` (`:399`) | **[PROVEN]** |
| `orders` | `:377-381` — `inventory_released BOOLEAN NOT NULL DEFAULT FALSE`, `payment_expires_at TIMESTAMPTZ`, `reservation_policy JSONB`, `velrepeat_run_id UUID`, `velrepeat_cycle_id UUID` (Phase 1) | **[PROVEN]** |
| `orders_status_check` | `:1029-1033` — 12 statuses: `pending, confirmed, packing, shipped, delivered, completed, cancelled, pending_payment, paid, payment_failed, refunded, expired` | **[PROVEN]** |
| `velrepeat_plans` | `:824-845` — status CHECK 10 values (`:826`); `commitment_cycles` (`:829`, Phase 1); `payment_method TEXT NOT NULL DEFAULT 'cod'` (`:836`); `timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok'` (`:838`) | **[PROVEN]** |
| `velrepeat_items` | `:848-861` — `quantity CHECK (quantity > 0)` (`:855`); per-composition partial unique indexes (`:859-860`) | **[PROVEN]** |
| `velrepeat_runs` | `:867-883` — 8-value status CHECK (`:873`); `order_id` first-order-only (`:874`); `UNIQUE (plan_id, scheduled_for)` (`:882`) | **[PROVEN]** |
| `velrepeat_events` | `:889-895` | **[PROVEN]** |
| `vrepeat_packages` (V1) | `:680-707` — single `product_id`/`variant_id`, `package_type weekly|monthly|custom`, `quantity_total`, `unit_price`, `payment_id REFERENCES payments(id)` | **[PROVEN]** |
| `vrepeat_deliveries` (V1) | `:710-727` — `UNIQUE (package_id, delivery_number)`, `order_id` | **[PROVEN]** |
| `platform_settings` | `:657-662` — `key TEXT PRIMARY KEY`, `value TEXT NOT NULL` (a V2 tier store could reuse it, but that is a Q11 ownership question, not a fact) | **[PROVEN]** |
| Phase 1 V2 objects | `velrepeat_packages:898`, `velrepeat_package_items:908`, `velrepeat_pricing_snapshots:921`, `velrepeat_pricing_snapshot_items:937`, `velrepeat_cycles:950`, FK DO-block `:966`, partial index `:967` | **[IMPLEMENTED]** |

### 2.2 Backend

| Fact | Evidence | Tag |
|---|---|---|
| Canonical reserve | `lib/inventory.ts:54` `reserveInventoryStock` | **[IMPLEMENTED]** |
| Canonical commit + `sold_count` | `lib/inventory.ts:115` `commitOrderInventory`; `sold_count = sold_count + $1` `:141` | **[IMPLEMENTED]** |
| `commitOrderInventory` callers | exactly **one**: `routes/stripe.ts:559` inside `markPaymentSucceeded` (`grep -rn commitOrderInventory backend --include='*.ts' \| grep -v tests` → `:559` only) | **[PROVEN]** |
| Canonical release + atomic claim | `lib/inventory.ts:209`; claim `:221-233` (guards `inventory_released = FALSE`, `status = ANY(RELEASABLE_STATUSES)`, `NOT EXISTS settled payment`); `RELEASABLE_STATUSES :176-182` = pending, pending_payment, cancelled, payment_failed, expired | **[IMPLEMENTED]** |
| 30-minute reservation | `lib/payment-reservation.ts:44` `PAYMENT_RESERVATION_MINUTES = 30`; policy v2 `:36`; `applyPaymentReservationPolicy` called once, `routes/cart.ts:1000` | **[IMPLEMENTED]** |
| Reservation sweep | `jobs/payment-reservation-scheduler.ts:83-84` + `:154-155` require `payment_expires_at IS NOT NULL`; release `:183` | **[IMPLEMENTED]** |
| Settlement | `routes/stripe.ts:418` `markPaymentSucceeded`; locks order first `:428`; order claim `:430-434` (`status IN ('pending','pending_payment') AND inventory_released = FALSE`); attempt guards `:457-467`; `commitOrderInventory` `:559`; late-payment → `manual review/refund required` `:547`; `markPaymentFailed :567` | **[PROVEN]** |
| Attempt identity | `routes/stripe.ts:386-415` `resolvePaymentAttemptRow` — resolves **by `order_id` + provider ids** | **[PROVEN]** |
| Webhook idempotency | `routes/stripe.ts:1525-1540` — `INSERT INTO payment_events … ON CONFLICT (event_id) DO NOTHING`; processed/failed re-arm `:1547-1578` | **[IMPLEMENTED]** |
| Checkout gate | `routes/stripe.ts:1066` `assertPaymentMethodUsable`; ownership `user_id` check; payable statuses `:1095` (`pending`,`pending_payment`); window check `:1110` (skipped when `payment_expires_at IS NULL`); amount = `toMinor(order.total_amount)` `:1133` — **the charge is derived from one order** | **[PROVEN]** |
| Payment-config | `lib/payment-config.ts:25` `PaymentMethodId = "CARD"｜"PROMPTPAY"｜"COD"`; `:26` `PaymentProvider = "STRIPE"｜"CARRIER"`; `isCodEnabled :313`, `isCodCustomerSelectable :325`, `assertPaymentMethodUsable :387` | **[IMPLEMENTED]** |
| Fulfillment gate | `lib/order-fulfillment.ts:69` statuses; transitions `:89-97` (packing→shipped only; no packing→cancelled); `paymentAllowsConfirmation :218-235` (settled payment OR COD while `isCodEnabled()`); COD methods `:192` | **[IMPLEMENTED]** |
| Order-lock contract | `lib/order-lock.ts:67` — every multi-row writer takes `orders … FOR UPDATE` first | **[IMPLEMENTED]** |
| Scheduler | `jobs/velrepeat-scheduler.ts` — `calculateNextRunAt :38-65` (UTC `setUTC*`, month day-clamping); `processPlan :110`; claim `:113-120` (`FOR UPDATE` + re-check `active` & due); run insert `ON CONFLICT DO NOTHING :127`; item validation `:174-200`; **re-price from live server price + overwrite `velrepeat_items.unit_price` `:229-249`**; order insert `status='pending'` `:270-272`; variant consume `stock = stock - $1` `:328`; non-variant `reserveInventoryStock :341`; **`sold_count = sold_count + $1` `:344`**; **per-order pseudo-payment `method='cod', provider='cod'` `:351-352`**; run success + `next_run_at` advance `:358-369`; `processDuePlans :444`; `startVelRepeatScheduler :467` | **[PROVEN]** |
| Plan routes | `routes/velrepeat-plans.ts` — create `:195-301` with **`paymentMethod !== "cod"` → 400** `:223` (no canonical gate); PATCH deletes then re-inserts `velrepeat_items` `:445`; pause `:507-513`; resume `next_run_at = GREATEST(next_run_at, NOW())` `:520`; cancel `status='cancelled', ended_at` `:531` (no order/payment/inventory); timezone only echoed `:153` | **[PROVEN]** |
| Seller ownership | `routes/seller-orders.ts:766-800` `process-due` scoped `EXISTS (… vi.seller_id = $1)`; read path `:695` | **[IMPLEMENTED]** |
| V1 routes | `routes/velrepeat.ts` — 7 package/delivery writes (`:48,:162,:377,:388,:535,:548,:561`); **no order, payment or inventory write** | **[PROVEN]** |
| Inventory guard test | `tests/inventory-settlement.test.ts:95-121` — cart/stripe/seller-orders/center/payment-reservation-scheduler must not contain `UPDATE inventory`, `stock = stock +`, `sold_count = sold_count +`; **`velrepeat-scheduler.ts` named the known exception `:98-99` (MEDIUM #10)** | **[PROVEN]** |
| Server wiring | `server.ts:472` V1 routes, `:475` plan routes, `:519` VelRepeat scheduler, `:525` reservation scheduler | **[IMPLEMENTED]** |
| Payment SQL surface | Method: `grep -rEn '\bpayments\b' backend --include='*.ts'` excluding `tests/` → **88 occurrences across 13 files** (stripe 37, cart 13, order-lock 6, order-fulfillment 6, seller-orders 5, reservation-scheduler 5, payment-config 4, center 3, inventory 3, stripe-raw-body 2, payment-incidents 2, velrepeat-scheduler 1, db/index 1); **44 lines are SQL statement sites** (line also matches SELECT/INSERT/UPDATE/DELETE/FROM/JOIN/INTO); **248 occurrences including tests**. Earlier passes recorded "77 SQL sites across 14 files" (Phase-1 audit §3.1; contract §46) using a narrower count — the magnitude is consistent and the material finding is unchanged: any `payments.order_id` semantic change is a wide-surface change across settlement, refund, incident, reservation, checkout, webhook, seller and center paths | **[PROVEN]** |

### 2.3 CI / migration reality

| Fact | Evidence | Tag |
|---|---|---|
| `migrate-neon.yml` trigger | `on: push: branches:[main], paths: ['db/migrations/*.sql']` + `workflow_dispatch` | **[PROVEN]** |
| `migrate-neon.yml` behavior | detects **ALL** files in `db/migrations/` not present in `schema_migrations`, applies each with `psql -v ON_ERROR_STOP=1 --single-transaction -f`, records on success, stops on failure | **[PROVEN]** |
| Pending migrations | `048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check` — never recorded applied (owner-side Neon quota `53000`; last successful migrate 2026-09-25) | **[PROVEN]** (documented; runs `36371800184`, `36437470328`, probe `36449336393` failed at quota per `.ai/context/payment.md`) |
| `test.yml` | bootstraps a disposable `postgres:16` with `psql … -f db/run-sqleditor.sql` (`:84`) then `bun test backend/tests` (`:126`); references **no** repository secret | **[PROVEN]** |
| Consequence | adding `db/migrations/051_*.sql` in any push to `main` puts it into the pending set that the workflow **auto-applies unattended** as soon as the quota clears (and attempts immediately on the triggering push) | **[PROVEN]** |

---

## 3. Q13 — prepaid payment architecture

**Question (contract §46/§60.3):** where does the ONE prepaid charge for a Repeat Plan live, given
`payments.order_id UUID NOT NULL` (`db/run-sqleditor.sql:442`)?

**Hard constraint:** the canonical payment authority is exactly one system — `payments` /
`payment_events` / `refunds` + `payment-config.ts` (contract §47(3), §18.4/§18.10, AGENTS
"no duplicate payment/inventory authority"). Any shape that forks this is rejected, not merely
discouraged.

### 3.1 Option A — attach the prepaid payment to Cycle 1's order

Mechanically: no schema change; the plan's charge is stored as a `payments` row whose `order_id` points
at the cycle-1 order. Analysis against every surface the task requires:

| Dimension | Finding | Tag |
|---|---|---|
| FK | Satisfied with zero DDL — `payments.order_id NOT NULL` stays true | **[PROVEN]** |
| Amount | **Contradiction:** checkout derives the Stripe amount from `orders.total_amount` (`stripe.ts:1133`) — one cycle's goods — while the plan total is `cycle price × commitment`. Either the cycle-1 order's `total_amount` is inflated beyond its `order_items` (the order becomes a financial lie; commissions/refunds built on it are wrong), or the derivation is bypassed (weakens "the charge is DERIVED, never accepted", payment.md) | **[PROVEN]** |
| Uniqueness | `idx_payments_one_active_stripe` is per `order_id` — mechanically fine, but the *semantic* owner of the payment becomes cycle 1's order | **[PROVEN]** |
| Settlement | `markPaymentSucceeded` claims the **order** (`:430-434`) and commits **that order's** inventory (`:559`). The prepaid money covers N cycles, yet cycles 2..N have **no settled payment row** → `paymentAllowsConfirmation()` (`order-fulfillment.ts:218-235`) refuses their confirmation. Cycles 2..N could not legitimately fulfill under canonical rules | **[PROVEN]** |
| Release/cancel | `releaseOrderInventory` refuses when a settled payment exists (`inventory.ts:221-233`): cycle 1 becomes permanently un-releasable — including when the **plan** is cancelled before cycle 1 ships | **[PROVEN]** |
| Refund | `refunds.order_id NOT NULL` (`:504`) → any plan refund must be recorded against cycle 1's order even though the money is the plan's. Financial history misattributes plan money to one cycle's goods | **[PROVEN]** |
| Incident | `payment_incidents.order_id NOT NULL` (`:482`) → same misattribution for operator review | **[PROVEN]** |
| Reservation | The 30-minute window is an order property; cycle 1's window would govern a plan-level charge. Mapping "where applicable" (4A) becomes arbitrary | **[PROVEN]** |
| Webhook / attempts | `resolvePaymentAttemptRow` resolves by `order_id` (`:386-415`); a late success for a cancelled cycle-1 order takes the "manual review/refund" path (`:547`) — correct for an order, wrong for plan money | **[PROVEN]** |
| Multi-shop cycles | A cycle may be **several** orders (one per shop — `velrepeat-scheduler.ts:270-292`); "the" cycle-1 order is ambiguous when a plan spans shops | **[PROVEN]** |
| Ownership/authz | `order.user_id === userId` (`stripe.ts` checkout) coincides with `velrepeat_plans.user_id` today, so authz is not the blocker | **[PROVEN]** |
| Backward compatibility | Best possible (no DDL at all) — which is exactly why it is tempting | **[PROVEN]** |
| Verdict | **Not recommended.** It is financially incoherent: one cycle's fulfillment artifact would carry the whole plan's money, break the confirmation gate for cycles 2..N, block legitimate releases, and misattribute refunds/incidents | **[ARCHITECTURE RECOMMENDATION]** |

### 3.2 Option B — keep `payments` as the one authority; add a canonical plan linkage

Shape (analysis only — **no DDL in this task**): `payments.order_id` becomes nullable, a nullable
`payments.velrepeat_plan_id UUID REFERENCES velrepeat_plans(id)` is added, with a CHECK that exactly one
parent is set (`(order_id IS NULL) <> (velrepeat_plan_id IS NULL)`). The same question must be answered
for the two dependent tables (`refunds.order_id`, `payment_incidents.order_id` — both NOT NULL today) or
they cannot represent a plan-level refund/incident truthfully.

| Dimension | Finding | Tag |
|---|---|---|
| FK | Two FKs (order OR plan); requires `orders`/`velrepeat_plans` to exist in the same schema — both do | **[PROVEN]** |
| Uniqueness | Plan-level twin of `idx_payments_one_active_stripe` needed, e.g. partial unique on `(velrepeat_plan_id) WHERE provider='stripe' AND status IN ('pending','requires_action')` — the order-level index cannot constrain NULL order_id rows (NULLs are distinct) | **[ARCHITECTURE RECOMMENDATION]** |
| Settlement | New plan-level settlement path mirroring `markPaymentSucceeded`: lock **plan** row first (the order-lock contract must be extended to name the plan as a lock root), claim the plan payment row, record `paid`. **Effects** on inventory/`sold_count` must still flow through canonical writers — which is exactly Decision A + Q2 residual, not something Option B may invent | **[ARCHITECTURE RECOMMENDATION]** + **[OWNER DECISION REQUIRED]** (A, Q2) |
| Refund | `refunds.order_id NOT NULL` (`:504`) must become nullable + plan linkage, or plan refunds remain unrepresentable. Partial refund of ONE payment across N cycles must recompute `refunded_amount` from succeeded rows (`refundableMinorFor`, `stripe.ts:320`) — reuse, don't fork | **[ARCHITECTURE RECOMMENDATION]** |
| Incident | `payment_incidents.order_id NOT NULL` (`:482`) + `dedupe_key UNIQUE` (`:480`): linkage must extend so a plan-charge incident has a canonical home; dedupe identity should gain plan (and later cycle) identity | **[ARCHITECTURE RECOMMENDATION]** |
| Reservation | 4A "where applicable" needs a plan-level deadline analogue (plan or payment column) — **no such column exists today**; the 30-minute constant itself must not be weakened | **[OWNER DECISION REQUIRED]** (mapping belongs to Phase 4 design, per 4A) |
| Webhook | `payment_events.event_id UNIQUE` (`:466`) + `ON CONFLICT DO NOTHING` (`:1527/:1540`) is provider-global and unaffected. Duplicate/late semantics for a plan charge must reuse the same claim + the operator path, not a second handler | **[ARCHITECTURE RECOMMENDATION]** |
| Ownership/authz | Plan checkout must verify `velrepeat_plans.user_id === session user` (the same ownership rule as orders). Seller/admin surfaces keep their existing rules; no new role checks needed at this layer | **[ARCHITECTURE RECOMMENDATION]** |
| Payment SQL surface | **88 `\bpayments\b` occurrences across 13 backend non-test files (44 SQL statement lines)** — every query must be re-audited for NULL-`order_id` semantics (joins, `WHERE order_id = $1`, expectations that every payment belongs to an order). This is the true cost of Option B and must be budgeted as its own workstream | **[PROVEN]** |
| Backward compatibility | Order-scoped rows keep a non-null `order_id`; all existing queries remain valid for them. New plan rows are the only NULL-`order_id` rows; a NULL-safe audit of the 44 SQL sites is required before the DDL lands. Migration must be additive | **[ARCHITECTURE RECOMMENDATION]** |
| Second-authority check | **Finding: Option B does not create a second payment authority.** It extends the single `payments`/`refunds`/`payment_incidents` authority with a second *parent kind*; there is still exactly one payments table, one webhook claim store, one refund mechanism, one config gate | **[PROVEN — as a structural finding, not an implementation]** |
| Verdict | **Recommended shape**, conditional on: (1) owner approves Q13=B; (2) the dependent tables (refunds/incidents) are included so plan money is never misattributed; (3) the NULL-safe audit of the 44 SQL sites is completed in the same phase | **[ARCHITECTURE RECOMMENDATION]** |

### 3.3 Option C — a separate plan-payment authority (new table / new flow)

| Dimension | Finding | Tag |
|---|---|---|
| Definition | A new table (e.g. `velrepeat_plan_payments`) that records the prepaid charge independently of `payments` | **[PROVEN — as described in contract §25]** |
| Settlement/webhook/refund/incident | Would fork provider events, attempt identity, dedupe, refund arithmetic and incident handling — a **second payment authority** | **[PROVEN]** |
| Rule | Prohibited: contract §18.4/§18.10, §47(3), §64; AGENTS.md rule 4 ("no fake payment architecture, no duplicate payment authority") | **[BLOCKED]** |
| Verdict | **Rejected.** It is not cleaner — it duplicates the exact surfaces that make payment correctness provable today. Do not choose C merely because B's audit list is long | **[ARCHITECTURE RECOMMENDATION — rejection]** |

**Q13 conclusion: [OWNER DECISION REQUIRED].** A/B/C are analysed; B is the only shape that both
keeps one authority and gives plan money a truthful home; A's breakage is proven (cycle-2..N
confirmation gate, release guard, amount derivation, refund/incident misattribution). No DDL, no
nullable `payments.order_id`, and no new payment table may be created in this task or before the owner
answers.

---

## 4. Q14 — Stripe payment model

**Required model (contract §46):** `Repeat Plan → ONE prepaid Stripe payment → Cycle 1..N`, paid once.
Explicitly **not** `Cycle N → charge N`, and **not** Stripe Subscriptions unless the owner redefines it.

| Dimension | Evidence / analysis | Tag |
|---|---|---|
| What the repo actually uses | Stripe **Checkout Sessions** + webhooks (`checkout.session.completed`, `async_payment_succeeded`, `payment_intent.succeeded`); amount derived server-side (`stripe.ts:1133`); session close/expire on cancellation; PromptPay delayed-notification handled (`sessionConfirmsPayment`) | **[PROVEN]** |
| One charge for the plan | Matches the architecture once Q13 resolves the parent: one `payments` row, one session, one attempt, one settlement event → the whole commitment | **[ARCHITECTURE RECOMMENDATION]** |
| PaymentIntent | The session creates a PaymentIntent; the repo already reconciles intent & session ids in `resolvePaymentAttemptRow` (`:386-415`) — reuse, do not build a parallel intent flow | **[IMPLEMENTED]** |
| Webhook | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` (`:1525-1540`); duplicate delivery re-runs nothing; a throwing handler returns 500 for redelivery | **[IMPLEMENTED]** |
| Idempotency | Layered and DB-backed: `checkout_requests` `UNIQUE (user_id, scope, request_key)` (`:399`), `idx_payments_one_active_stripe` (`:460`), `payment_events` claim | **[IMPLEMENTED]** |
| Payment attempt | Attempt identity is per `order_id` today; a plan-level attempt needs the Option-B linkage and must keep the "row the refund is later built from" guarantee (`stripe.ts:439/477` comments) | **[ARCHITECTURE RECOMMENDATION]** |
| Payment incident | Plan-charge unsafe settlement must create the same durable incident (6A) with a dedupe key that cannot collide — requires the incident linkage extension | **[IMPLEMENTED mechanism]** + **[ARCHITECTURE RECOMMENDATION]** (linkage) |
| Refund | Full/partial refunds are webhook-confirmed and recomputed from succeeded rows; a plan refund is the same mechanism applied to the plan-linked payment row | **[IMPLEMENTED mechanism]** + **[OWNER DECISION REQUIRED]** (policy = Decision B) |
| Order synchronization | Under prepaid, a cycle order must never become a checkout object: no `pending`/`pending_payment` payable order per cycle, no per-cycle Stripe session, no per-cycle `payments` insert (the current scheduler's COD row `:351-352` must not survive into the prepaid path). Cycle orders must derive their fulfillability from the **plan's** settled payment via a canonical, reviewed gate — not from a fabricated per-order payment | **[ARCHITECTURE RECOMMENDATION]** → Phase 5/8, gated by Q13 |
| Reservation | 4A applies "where applicable": one plan-level window, not N order windows; mapping is Phase 4 design | **[OWNER DECISION REQUIRED]** (mapping) |
| Duplicate webhook | Idempotent by construction (event claim); same guarantee must hold for plan events | **[IMPLEMENTED]** |
| Late webhook | Order-level rule: money is recorded, no resurrection, operator review (`:547`). Plan-level analogue is required and is exactly the 6A incident path — no auto refund/retry | **[ARCHITECTURE RECOMMENDATION]** |
| Stripe Subscriptions | A **new provider integration** (subscription objects, invoice events, billing cycles, new idempotency/attempt mapping, plan↔subscription state coupling) — not a VelRepeat change, and it contradicts "ONE prepaid payment" as written. Only if the owner explicitly redefines the rail | **[OWNER DECISION REQUIRED]** |
| E2E verification reality | No Stripe credentials in this workspace: no PaymentIntent/PromptPay/webhook/refund round trip has ever been executed; `.ai/context/payment.md` records **CODE VERIFIED only → BLOCKED**. Any future Phase-4 implementation inherits this gate | **[PROVEN]** |

**Q14 conclusion: [OWNER DECISION REQUIRED].** Recommendation: **one large canonical Checkout-Session
charge per plan at plan creation**, no per-cycle charges, no Stripe Subscriptions. This is a
recommendation, not a decision; no implementation is changed by this audit.

---

## 5. Inventory — Model A vs Model B (Decision A / Q1)

**Question (contract §51, STOP #2):** reserve the **entire commitment** at prepaid payment (Model A),
or reserve **per cycle** just before fulfillment (Model B)? **The owner decides; this section does not.**

### 5.1 The required comparison (each row = one axis the task names)

| # | Axis | **Model A — whole commitment at prepaid** | **Model B — per cycle** | Tag |
|---|---|---|---|---|
| 1 | Stock locking | locks `qty_per_cycle × commitment` at payment (e.g. 20×16 = 320 units per line) | locks only `qty_per_cycle` at each cycle | **[ARCHITECTURE RECOMMENDATION]** |
| 2 | Overselling | hides N cycles of demand from every other buyer; a single plan can silently exhaust a catalog; the seller's current stock must satisfy months of future demand | bounded to one cycle at a time; protects other buyers | **[ARCHITECTURE RECOMMENDATION]** |
| 3 | Future availability | the seller must have (and keep) the full commitment stock from day 1; later stock-outs elsewhere cannot reclaim it | uses whatever stock exists at each cycle; later cycles can genuinely run out | **[ARCHITECTURE RECOMMENDATION]** |
| 4 | Seller inventory | one plan can freeze a small seller's entire inventory | mirrors today's per-order reservation exactly | **[ARCHITECTURE RECOMMENDATION]** |
| 5 | Cancellation | releasing must unwind `qty × remaining cycles` from a hold that may already be spoken for; interacts with Decision B (refund) | release is local to the affected cycle(s) | **[ARCHITECTURE RECOMMENDATION]** |
| 6 | Refund | money is refundable per policy while stock release is a separate, wide operation — two different scopes on one action | refund and release can be decided per cycle with matching scope | **[ARCHITECTURE RECOMMENDATION]** |
| 7 | Out-of-stock future cycle | the shortage is detectable **at purchase** (reserve fails → no prepaid sale), which is a *protection* but also silently blocks B2B-scale orders | shortage is discovered at cycle time → requires Decision F (postpone/substitute/cancel-credit-refund) | **[ARCHITECTURE RECOMMENDATION]** |
| 8 | Warehouse / fulfillment | warehouse must segregate/hold committed units for months — an operational concept the repo has never modeled | warehouse behaves as today: units exist per cycle | **[ARCHITECTURE RECOMMENDATION]** |
| 9 | Reservation expiry | the only expiry concept is the **30-minute** window (`payment-reservation.ts:44`) — meaningless for a months-long hold; A requires a **new** expiry/policy model | per-cycle holds behave exactly like today's order reservation | **[PROVEN]** + **[ARCHITECTURE RECOMMENDATION]** |
| 10 | Scalability | hold size grows linearly with commitment (1/2/4/8/16 cycles × quantity × product lines); concurrent plans compound | hold size is constant regardless of commitment | **[ARCHITECTURE RECOMMENDATION]** |
| 11 | Multiple products | each line locks `qty × commitment` independently; a package multiplies across composition lines | same as today, per line per cycle | **[ARCHITECTURE RECOMMENDATION]** |
| 12 | Package | A locks the whole package commitment at once (larger blast radius); no package stock exists or may be created either way | per-cycle reservation through the same product/variant rows the package references | **[PROVEN]** (no package stock — Phase 1 DDL has no stock column; asserted by test) |
| 13 | Quantity per cycle | must store both `quantity_per_cycle` and the implied total hold | stores only the per-cycle quantity (already stored: `velrepeat_items.quantity`) | **[PROVEN]** |
| 14 | 1/2/4/8/16 cycles | lock scales 1×→16×; the 16-cycle plan is the worst case the model must survive | identical behavior at every commitment | **[ARCHITECTURE RECOMMENDATION]** |
| 15 | Partial fulfillment | whole-plan hold vs partial delivery: if some cycles never ship, the unshipped hold must be unwound (policy!) — no such policy exists | each cycle's fate is independent; nothing to unwind globally | **[ARCHITECTURE RECOMMENDATION]** |

### 5.2 Source evidence the choice must respect

| Fact | Evidence | Tag |
|---|---|---|
| Canonical machinery that must be reused either way | `reserveInventoryStock` (`inventory.ts:54`), `commitOrderInventory` (`:115`), `releaseOrderInventory` (`:209`, atomic claim `:221-233`), `RELEASABLE_STATUSES` (`:176-182`) | **[IMPLEMENTED]** |
| No plan-level reservation record exists | Phase 1 added none; `orders` carry `inventory_released` (`:377`) — a **plan** has no such flag. Model A would need a new reservation concept (the contract explicitly flags this as "part of the decision, not an implementation detail") | **[PROVEN]** |
| Variant/non-variant asymmetry (must be resolved one way) | scheduler decrements `product_variants.stock` directly (`:328`) while the non-variant line uses `reserveInventoryStock` (`:341`) — different failure/rollback shapes for the same business fact | **[PROVEN]** |
| `sold_count` coupling | the canonical writer is reachable only from order settlement (`stripe.ts:559`); the current VelRepeat path writes `sold_count` ad hoc (`:344`) | **[PROVEN]** |
| Reservation expiry semantics | the sweep requires `payment_expires_at IS NOT NULL` (`:83-84/:154-155`); with Model A the only window that exists is 30 minutes | **[PROVEN]** |
| Contract invariance either way | exactly one terminal outcome per reservation (commit **or** release); no negative inventory, no double release/commit/`sold_count`; reuse guards, do not re-implement | **[PROVEN]** (contract §51 binding) |

### 5.3 Recommendation (not a decision)

**[ARCHITECTURE RECOMMENDATION] Model B** — per-cycle reservation at cycle-order creation through the
canonical machinery — because: (a) it needs **no new reservation authority** (A's plan-level hold has no
representation today and would need a new expiry/release concept, i.e. *more* new money-adjacent
machinery); (b) overselling stays bounded to one cycle; (c) holds match the only expiry policy that
exists; (d) release/refund scopes stay local. Model B does **not** remove Decision F: a per-cycle
shortage still needs an owner policy. Model A's one genuine advantage (buyers cannot be confirmed into a
commitment the seller cannot serve) is a **policy trade-off**, not a technical verdict.

**Decision A remains [OWNER DECISION REQUIRED] (STOP #2).** No inventory DDL, code, or test may
presume either model.

---

## 6. Pricing architecture (Decision H / Q11)

**Required pipeline (contract §44, normative shape):**

```
Base Product Price → Package Composition → Quantity → Commitment
→ applicable pricing rule / tier → Cycle Price → Total Prepaid Price
```

| Requirement | Finding | Tag |
|---|---|---|
| Tier data lives in **data**, not business logic | No tier table and no discount logic exist anywhere today (contract §44); V1 `products.vrepeat_weekly_price / vrepeat_monthly_price` are V1-only and not a V2 engine | **[PROVEN]** |
| Hardcoding forbidden | The example ladder `1/2/4/8/16 → 0/3/7/10/15 %` must **not** be hardcoded anywhere; changing a tier must not require editing `processPlan` or a route | **[OWNER DECISION REQUIRED]** is the *values*; the no-hardcode rule itself is **[PROVEN]** (contract §44/§64) |
| Engine inputs | `minimum_cycles`, `maximum_cycles`, `discount_type`, `discount_value`, `eligibility`; eligibility ∈ {quantity, commitment, package, seller pricing, customer eligibility} — never `role = "seller"` | **[PROVEN]** (contract §30/§44/§56) |
| Snapshot storage | Already implemented: `velrepeat_pricing_snapshots` + `_items` (commitment, currency, subtotal, discount type/value/amount, total, rule key/version, per-line qty/unit price/line total) — append-only; **the engine does not exist; the record does** | **[IMPLEMENTED]** |
| Snapshot immutability | The scheduler's live re-pricing (`velrepeat-scheduler.ts:229-249`) is the exact opposite of the prepaid requirement; it must become impossible for a prepaid plan (Phase 4/5) | **[PROVEN]** |
| B2C / B2B | one pipeline; the difference is quantity/package/commitment/pricing rules, not role | **[PROVEN]** (contract §56) |
| Merchant/reseller usage | Same pipeline; no separate subsystem may exist | **[PROVEN]** (contract §56) |

### 6.1 Rule-configurable data model — [ARCHITECTURE RECOMMENDATION] (not a decision)

The engine must be able to express the pipeline without embedding any percentage. A rule row shaped
like this supports both H options (stacking and one-tier-wins) and both Q11 owners (platform or seller)
without a code change when values change:

```
pricing_rule
  id, scope ('platform' | 'seller'), owner_id (nullable)
  applies_to ('product' | 'package'), product_id / package_id (nullable)
  min_cycles, max_cycles            -- open bounds; the ladder is rows, not code
  min_quantity (nullable optional second dimension for H)
  discount_type ('percent' | 'amount_per_cycle' | 'unit_price')
  discount_value NUMERIC(12,4)
  currency, priority, is_active
  eligibility JSONB                 -- documented inputs only
  version / created_at / updated_at
```

Resolution semantics (which rows apply, whether they stack, precedence) **are Decision H** and are
bound by Q11's second half — **who owns tier data** (platform-wide vs seller-owned vs both). Engine
outputs are written into the Phase-1 snapshot tables; historical snapshots are never recomputed.

**Rounding & currency [ARCHITECTURE RECOMMENDATION]:** compute in minor units or NUMERIC(12,2) and
define one documented rounding point (recommend: round the per-cycle price and the total once,
half-up, at the snapshot boundary; never round differently on two code paths). Rounding is
customer-visible money — if the owner wants a different rule, that is a pricing decision, not an
implementation detail.

**Decision H / Q11 remains [OWNER DECISION REQUIRED] (STOP #4).** Phase 2 cannot start on guesses.

---

## 7. Q15 — V1 `vrepeat_packages` fate

| Fact | Evidence | Tag |
|---|---|---|
| V1 shape | single `product_id` (+ optional variant), `package_type weekly|monthly|custom`, `quantity_total`, `unit_price`, `payment_id REFERENCES payments(id)`, status vocabulary incl. `paid/active/refunded` | **[PROVEN]** (`:680-707`) |
| V1 delivery | `vrepeat_deliveries` with `UNIQUE (package_id, delivery_number)`, `order_id` | **[PROVEN]** (`:710-727`) |
| V1 endpoints | `routes/velrepeat.ts` — 7 write statements, all package/delivery-scoped (`:48,:162,:377,:388,:535,:548,:561`); **zero commerce writes** (no order, no payment, no inventory) | **[PROVEN]** |
| V2 need | multi-item composition with per-cycle quantity, no stock, no payment — V1 cannot express it (single product; carries its own pricing/payment fields) | **[PROVEN]** |
| Phase 1 default | V2 composition tables were added **beside** V1, non-destructively; `vrepeat_packages` was left untouched | **[IMPLEMENTED]** |

| Option | Analysis | Tag |
|---|---|---|
| **Reuse** | Not technically possible: V1 is single-product with embedded price/payment columns; V2 is multi-item with per-cycle quantity and no stock. Reusing would force V2 semantics into a V1-shaped table | **[PROVEN]** rejection basis |
| **Migrate** | There is no proven V1 data population to migrate (production DB unreadable from here; V1 writes exist but usage is unverified). A data migration would be a schema+data change → not in this task | **[BLOCKED]** until usage is known + owner approves |
| **Coexist** | Current state: V1 tables/endpoints remain; V2 tables exist independently. Zero risk to existing behavior | **[IMPLEMENTED]** |
| **Deprecate** | Would remove/retire endpoints + tables; a destructive roadmap item | **[OWNER DECISION REQUIRED]** |

**Q15 remains [OWNER DECISION REQUIRED].** Recommendation: keep V1 as legacy, build nothing on it, and
decide deprecation only after a production usage check (impossible while the DB quota is unresolved).
Phase 2 needs the Q15 answer only to the extent of not colliding with V1 names — which Phase 1 already
guarantees.

---

## 8. Q16 — timezone semantics

| Fact | Evidence | Tag |
|---|---|---|
| Stored instants | all schedule columns are `TIMESTAMPTZ`; every computation is UTC | **[PROVEN]** |
| The timezone column is inert | `velrepeat_plans.timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok'` (`:838`) is only echoed at `velrepeat-plans.ts:153` — nothing writes a different value, nothing reads it for scheduling | **[PROVEN]** |
| Schedule math | `calculateNextRunAt` (`velrepeat-scheduler.ts:38-65`) uses `setUTC*` with month day-clamping; no local-time or DST handling exists anywhere | **[PROVEN]** |
| Cycle immutability | a cycle's scheduled instant is immutable once the plan is prepaid (contract §42(3)) — any timezone rule must not silently move sold delivery dates | **[PROVEN]** |

| Option | Analysis | Tag |
|---|---|---|
| **(a) Timezone load-bearing** | Define "the delivery date" in the plan's timezone (e.g. 09:00 Asia/Bangkok) and normalize to UTC instants. Requires: DST rules for zones that have it, a policy for what a "day" means across zones, and writes/reads of the column — none exist. Adds a new class of scheduling incidents | **[ARCHITECTURE RECOMMENDATION]** — only if a business requirement proves it |
| **(b) Scheduling defined as UTC, documented** | Instants stay UTC (already true); the column becomes display metadata (or is documented as informational); no DST surface exists because the marketplace's languages (th/en/my) map to zones without DST, but the rule must be explicit, not incidental | **[ARCHITECTURE RECOMMENDATION]** — recommended default |

**Required clarifications attached to Q16:** user timezone (customer viewing/local intent)? seller
timezone (fulfillment day)? platform timezone (UTC)? The decision must name which one governs the
**cycle's scheduled instant** and which govern **display** only. **Q16 remains [OWNER DECISION
REQUIRED]** — and any future timezone change must not move an already-prepaid cycle instant.

---

## 9. Q17 — multi-seller plan handling

| Fact | Evidence | Tag |
|---|---|---|
| Multi-seller plans are possible | `velrepeat_items` has a per-line `seller_id` (`:853`); one plan may contain lines from several sellers | **[PROVEN]** |
| Ownership fix (7B) | `POST /api/subscriptions/process-due` selects only plans containing a line of the calling seller (`EXISTS … vi.seller_id = $1`), matching the read path (`seller-orders.ts:766-800`, `:695`) | **[IMPLEMENTED]** (`2567707`) |
| Residual | once matched, the plan is processed as a **whole plan** — a seller can trigger other sellers' lines | **[PROVEN]** |
| Fulfillment shape | one run already creates one order **per shop** (`velrepeat-scheduler.ts:270-292`) — fulfillment is already multi-order | **[PROVEN]** |
| Contract requirement | central scheduler owns global due processing (7B); every seller surface must be ownership-enforced | **[PROVEN]** |

| Option | Analysis | Tag |
|---|---|---|
| **(i) Split plan per seller at creation** | One plan per seller means N plans for one basket; "ONE prepaid payment per plan" (contract §46) would become N charges or a bundled charge across plans — directly re-opens Q13/Q14 and complicates the customer story | **[ARCHITECTURE RECOMMENDATION]** — not preferred |
| **(ii) Per-seller execution inside one plan** | The cycle engine generates per-seller orders; a seller trigger processes only that seller's lines of the cycle; the central scheduler processes the whole cycle. Keeps one plan, one payment, and makes the ownership predicate correct at the item level | **[ARCHITECTURE RECOMMENDATION]** — recommended shape |
| **(iii) Forbid multi-seller plans** | Validation at creation: all items must belong to one seller. Simplest correct rule today, but a product restriction the owner must accept | **[ARCHITECTURE RECOMMENDATION]** — viable interim |
| **(iv) Keep as-is + discovery-only triggers** | The current residual persists (a seller triggers other sellers' lines) | **[PROVEN]** risk |

**Q17 remains [OWNER DECISION REQUIRED].** No plan-splitting, no per-seller subset execution, and no
validation restriction may be implemented before the owner answers; Phase 7 is gated on it.

---

## 10. Cancellation and refund (Decision B / Q3)

**The five state axes must never be conflated** (contract §39.1/§48/§49):

```
Plan state      (velrepeat_plans.status / commitment progress)
Payment state   (payments.status — canonical)
Cycle state     (velrepeat_cycles.status — Phase 1 vocabulary)
Order state     (orders_status_check — canonical, 12 values)
Fulfillment     (FULFILLMENT_STATUSES + FULFILLMENT_TRANSITIONS — canonical)
```

**Binding non-equivalences:** **PAID PLAN ≠ FULFILLED PLAN** · **PAID CYCLE ≠ DELIVERED ORDER** ·
a settled plan payment does not mean any cycle order exists, and a delivered order does not settle the
plan. **PAID CYCLE ≠ DELIVERED ORDER:** a cycle can be `ordered` while its order is still `packing`.

### 10.1 Three cancellation levels (contract §53)

| Level | What it is | Impacts to resolve | Tag |
|---|---|---|---|
| Cancel **Repeat Plan** | ends the agreement; all remaining cycles stop | future cycles · prepaid balance · payment · refund · inventory · seller · customer | **[OWNER DECISION REQUIRED]** (policy = B) |
| Cancel **Future Cycle** | removes one upcoming cycle | commitment arithmetic · schedule of the rest · money · stock | **[OWNER DECISION REQUIRED]** (B/C) |
| Cancel **Current Order** | cancels an already-generated cycle order | canonical order rules; stock release; **no independent charge exists under prepaid** | **[IMPLEMENTED]** (canonical), prepaid semantics gated |

### 10.2 Refund — what exists and what does not

| Fact | Evidence | Tag |
|---|---|---|
| Refund machinery | order-scoped, webhook-confirmed: `refunds.order_id NOT NULL` (`:504`), `provider_refund_id` unique (`:517`), `refunded_amount` recomputed from succeeded rows (`stripe.ts:667-726`), `refundableMinorFor` never negative (`:320`) | **[IMPLEMENTED]** |
| Partial refund of a plan charge | **unrepresentable today** — a refund row must name an order; a prepaid charge belongs to a plan (Q13); no partial-commitment refund shape exists | **[PROVEN]** |
| Plan cancellation today | sets `status='cancelled'`, `ended_at`, writes `PLAN_CANCELLED` — and touches **no order, no payment, no inventory** (`velrepeat-plans.ts:531-536`) | **[PROVEN]** |
| Money consequence | with prepaid money, the current cancel is a money-handling hole, not a policy: the customer's plan stops while the charged value is unaccounted | **[PROVEN]** |

**Decision B (Q3) remains [OWNER DECISION REQUIRED] (STOP #1):** refundable future cycles · 
non-refundable · credit · seller-defined. Whatever is chosen, the representation requires (per §3.2):
plan-linked payment rows, plan-linked refund rows, and webhook-confirmed partial refunds via the
existing recompute mechanism — **reuse, never fork**. No refund policy may be invented.

---

## 11. Pause (Decision D / Q5)

| Fact | Evidence | Tag |
|---|---|---|
| Current pause | sets `status='paused'` + `PLAN_PAUSED` event (`velrepeat-plans.ts:507-513`); allowed from `active|out_of_stock` (`:496`) | **[PROVEN]** |
| Current resume | `status='active'`, `next_run_at = GREATEST(next_run_at, NOW())` (`:520`) — a **silent one-interval deferral with no commitment accounting** | **[PROVEN]** |
| No end date | a plan has no end date; its horizon is `commitment_cycles × interval` (Phase 1 added the count; the schedule is still `next_run_at`-driven) | **[PROVEN]** |
| Immutability | a cycle's scheduled instant is immutable once prepaid (contract §42(3)); pause either moves future instants (a change to sold delivery dates — requires explicit owner approval per §42) or consumes them | **[PROVEN]** |

| Decision D option | Analysis | Tag |
|---|---|---|
| **(A) Extend end date** | encoding requires an explicit end/horizon concept (remaining-cycles counter); future instants shift forward by the paused duration | **[ARCHITECTURE RECOMMENDATION]** |
| **(B) Consume commitment dates** | the paused window consumes cycles — customer loses deliveries while fully paid; needs B/I refund/credit interplay | **[ARCHITECTURE RECOMMENDATION]** |
| **(C) Seller-defined** | per-seller policy needs a field + resolution rules; still needs a default | **[ARCHITECTURE RECOMMENDATION]** |

**Binding whichever is chosen** (contract §54): completed cycles immutable; only future cycles
affected; idempotent; **no invented financial behavior** — if pause moves money (credit/refund) it must
be an owner decision that also resolves how a prepaid charge is partially returned. **Decision D
remains [OWNER DECISION REQUIRED] (STOP #3).**

---

## 12. Skip (Decision C / Q4)

| Fact | Evidence | Tag |
|---|---|---|
| No skip endpoint exists | `grep -n skip backend/routes/velrepeat-plans.ts` → **zero matches**; nothing in `velrepeat.ts` either | **[PROVEN]** |
| Nearest behavior | the closest semantics today are cancel-whole-plan or pause-whole-plan; neither skips **one** cycle | **[PROVEN]** |
| Cycle vocabulary (Phase 1) | `velrepeat_cycles.status` includes `skipped` — vocabulary only, no behavior | **[IMPLEMENTED]** (vocabulary) / **[BLOCKED]** (behavior) |

| Decision C option | Analysis | Tag |
|---|---|---|
| **(A) Postpone cycle** | moves that cycle's instant (and possibly the rest); interacts with §42 immutability and Decision D's arithmetic | **[ARCHITECTURE RECOMMENDATION]** |
| **(B) Consume commitment** | the customer paid for N cycles and receives N−1 — the value gap must be addressed or explicitly accepted by the owner | **[ARCHITECTURE RECOMMENDATION]** |
| **(C) Credit/refund** | moves money → needs the plan-refund representation from §10.2 and Decision B's policy | **[ARCHITECTURE RECOMMENDATION]** |

**Binding:** skip must be idempotent (same skip twice = once; §58) and may touch only **future** cycles
(§54). **Decision C remains [OWNER DECISION REQUIRED] (STOP #3).**

---

## 13. Modification (Decision G / Q6, Q7)

| Fact | Evidence | Tag |
|---|---|---|
| Destructive PATCH | `PATCH` deletes **all** `velrepeat_items` for the plan then re-inserts (`:445`) — item identity and prior-cycle snapshots are destroyed | **[PROVEN]** |
| Snapshot requirement | purchase-time price/quantity/composition are immutable history (§45); Phase 1 snapshot tables exist to hold exactly this | **[IMPLEMENTED]** (storage) / **[BLOCKED]** (enforcement) |
| Contract principle | completed cycle = immutable; historical price = immutable; historical quantity = immutable | **[PROVEN]** (contract §55) |

| Decision G option | Analysis | Tag |
|---|---|---|
| **(A) Future cycles only** | mutation allowed only for not-yet-generated cycles; earlier cycles keep their snapshot; still needs a versioned representation (below) to avoid destroying history | **[ARCHITECTURE RECOMMENDATION]** |
| **(B) Prohibited** | simplest immutability guarantee; conflicts with customer expectations but is the safest money-wise | **[ARCHITECTURE RECOMMENDATION]** |
| **(C) Versioned plan** | a plan gains a new future-cycle version while earlier cycles keep the old composition/snapshot — proposed shapes: a version row on `velrepeat_plans`, or version-tagged cycles; choose in Phase 9 design | **[ARCHITECTURE RECOMMENDATION]** |

**No charge/refund difference may be invented:** whether a modification costs or refunds money is
exactly Decision G + B/I territory, and it needs the partial-refund representation (§10.2).
**Decision G remains [OWNER DECISION REQUIRED] (STOP #4).** The destructive PATCH must not survive
into the prepaid path whichever option wins.

---

## 14. Future pricing (Decision E / Q9)

| Fact | Evidence | Tag |
|---|---|---|
| Current behavior | `processPlan` re-prices **every** cycle from the live server price, overwrites `velrepeat_items.unit_price`, records events and notifies (`velrepeat-scheduler.ts:229-249`) | **[PROVEN]** |
| Prepaid requirement | a future product/variant price change must **never** change the plan's historical financial commitment (§45); historical plans are never repriced from current prices | **[PROVEN]** (contract) |
| Storage readiness | Phase 1 snapshot tables exist for **both** options (locked = one snapshot; reprice = snapshot + change records) | **[IMPLEMENTED]** |

| Decision E option | Analysis | Tag |
|---|---|---|
| **(A) Locked at purchase** | matches the prepaid model: the customer paid a total; the seller's later price changes are the seller's risk. The cycle's `order_items` already snapshot what a cycle cost and are reused | **[ARCHITECTURE RECOMMENDATION]** |
| **(B) Future cycles reprice** | contradicts the paid-for total unless the owner defines who bears the difference (customer top-up? seller absorbs? plan re-quote?) — that is a **money** question, so it cannot be inferred | **[OWNER DECISION REQUIRED]** |
| Either way | the live-reprice overwrite (`:229-249`) must stop being possible for a prepaid plan; the canonical order-level snapshot (`order_items.price/subtotal`) is reused, never duplicated | **[PROVEN]** |

**Decision E remains [OWNER DECISION REQUIRED] (STOP #4).** Recommendation: locked (A).

---

## 15. Out-of-stock future cycle (Decision F / Q8, Q10)

| Fact | Evidence | Tag |
|---|---|---|
| Today's failure behavior | `INSUFFICIENT_STOCK` throws inside the run transaction → rollback; the plan stays active and is retried at the next sweep (`velrepeat-scheduler.ts:328-341` + claim `:113-120`) | **[PROVEN]** |
| Plan/run vocabulary | plan CHECK contains `out_of_stock` (`:826`); run CHECK contains `out_of_stock`/`item_unavailable` (`:873`); Phase-1 cycle vocabulary adds `out_of_stock`/`item_unavailable` | **[IMPLEMENTED]** (vocabulary) |
| Prepaid exposure | once the plan is prepaid, a cycle that cannot be served represents **paid value undelivered**; retry-forever is an implicit policy and, per the task stop-rule, a fulfillment-obligation question | **[OWNER DECISION REQUIRED]** |

| Decision F option | Analysis | Tag |
|---|---|---|
| **(A) Postpone** | retry the cycle later (bounded retries, never silent forever); no money movement; needs a retry/escalation policy (after N failures → operator, not auto-refund) | **[ARCHITECTURE RECOMMENDATION]** |
| **(B) Substitute** | replace with an equivalent product/variant — a **customer-facing value change** on paid goods; needs a definition of equivalence and consent | **[OWNER DECISION REQUIRED]** |
| **(C) Cancel/refund/credit** | moves money → needs §10.2 representation + B policy | **[OWNER DECISION REQUIRED]** |
| **(D) Seller policy** | per-seller handling; needs a field + a platform default | **[OWNER DECISION REQUIRED]** |

**Interplay:** under Model A a shortage is discovered at purchase (no prepaid sale — clean, but blocks
large B2B orders); under Model B it is discovered at cycle time (this section). **Decision F remains
[OWNER DECISION REQUIRED] (STOP #2/#1).**

---

## 16. Fulfillment failure (Decision I / Q12)

| Fact | Evidence | Tag |
|---|---|---|
| Fulfillment state machine | `FULFILLMENT_STATUSES` (`order-fulfillment.ts:69`); transitions `:89-97` allow **packing→shipped only** (no packing→cancelled) | **[IMPLEMENTED]** |
| Confirmation gate | `paymentAllowsConfirmation` (`:218-235`) — a settled payment (or COD while enabled) is required; under prepaid the settled money belongs to the **plan**, which no order-level gate can see today | **[PROVEN]** |
| Refund on failed fulfillment | only order-scoped, webhook-confirmed refunds exist (`refunds.order_id NOT NULL`); a prepaid plan's failure after payment has no representation | **[PROVEN]** |
| No invented handling | 6A: unsafe settlement ⇒ durable incident ⇒ VelCenter operator review; **never** automatic refund/retry/reopen (contract §59) | **[PROVEN]** |

| Decision I option | Analysis | Tag |
|---|---|---|
| **(A) Credit** | customer keeps value inside the platform; needs a credit representation that does not exist (and must not become a second money authority) | **[OWNER DECISION REQUIRED]** |
| **(B) Refund** | needs §10.2 plan-level partial refunds + B policy | **[OWNER DECISION REQUIRED]** |
| **(C) Retry / reschedule** | re-attempt the cycle's fulfillment (new order or re-ship); needs the cycle/order idempotency claim (§17) so a retry cannot create a duplicate order | **[ARCHITECTURE RECOMMENDATION]** |
| **(D) Seller policy** | per-seller obligation; needs a platform floor/default | **[OWNER DECISION REQUIRED]** |

**Binding:** whatever the choice, a failed fulfillment must not silently consume paid value, and it
must not auto-refund/retry outside an owner-approved policy (6A). **Decision I remains [OWNER DECISION
REQUIRED] (STOP #1).**

---

## 17. Invariants — proof and evidence

Each invariant is stated, tagged, and paired with the evidence that makes it true or with the exact
mechanism that would make it provable. Nothing here is asserted without a reference.

### 17.1 Payment — one prepaid commitment ⇒ **no charge per cycle**

- **[PROVEN] requirement:** contract §46 — one plan, one payment; explicitly "not 4 separate payments".
- **[PROVEN] counterexample in current source:** `velrepeat-scheduler.ts:351-352` inserts a per-order
  pseudo-payment `method='cod', status='pending', provider='cod'` on **every run**, i.e. one payment
  row per cycle. `'cod'` is not even a member of `PaymentProvider = "STRIPE"|"CARRIER"`
  (`payment-config.ts:26`), so the row is settlement-less by construction.
- **[PROVEN] proof mechanism available:** exactly one payment row per plan is provable by
  (a) attempt/identity resolution keyed to the plan (Q13 Option B linkage),
  (b) `payment_events` exactly-once delivery (`event_id UNIQUE`, `:466` / claim `:1527`),
  (c) absence of any cycle-keyed charge path.
- **[BLOCKED]** until Q13/Q14 are answered; Phase 4/8 verdict required. **This invariant may not be
  assumed by an implementation.**

### 17.2 Cycle — **same plan + same `cycle_number` = exactly one cycle**

- **[IMPLEMENTED]** `velrepeat_cycles` with `UNIQUE (plan_id, cycle_number)` (`db/run-sqleditor.sql:950-965`),
  in both canonical files (byte-identical, `cmp` verified this pass).
- **[IMPLEMENTED] proof:** constraint enforced by PostgreSQL; the DB-gated half of
  `backend/tests/velrepeat-v2-domain-schema.test.ts` exercises the uniqueness path (runs in CI
  `postgres:16`; skips locally — no local PostgreSQL).
- **[PROVEN] no cycle generation exists yet**, so the invariant is *structural*, not yet exercised
  against a generator. **[BLOCKED]** on the Phase-5 identity reconciliation (§19).

### 17.3 Order — **same plan + same cycle + same execution = at most one order**

- **[PROVEN] requirement:** contract §58/STOP #12; must be test-provable, not asserted.
- **[PROVEN] current gap:** generation is keyed to a run (`velrepeat_runs UNIQUE (plan_id, scheduled_for)`,
  `:882`; claim `:113-120`) and one run creates **one order per shop** (`:270-292`); there is no
  cycle-scoped claim and no `(cycle, seller)` uniqueness for orders.
- **[ARCHITECTURE RECOMMENDATION] mechanism:** a cycle-scoped claim — `SELECT … FROM velrepeat_cycles
  WHERE id = $1 FOR UPDATE` + status transition (`scheduled → processing`) inside the same transaction
  that inserts the order(s), plus a uniqueness key on `(velrepeat_cycle_id, seller_id/shop_id)` so a
  cycle's per-seller orders are each at most one. The existing order-lock contract (`lib/order-lock.ts:67`)
  is extended to name the cycle as a lock root; guards are reused, never re-implemented.
- **[BLOCKED]** on the Phase-5 identity reconciliation **and** a DB-gated proof before acceptance.

### 17.4 Inventory — **canonical authority only; no package inventory**

- **[PROVEN]** `velrepeat_packages`/`velrepeat_package_items` DDL carries **no stock column**
  (`:898-920`); the Phase-1 test asserts its absence. A package is a commercial composition only.
- **[PROVEN]** stock lives in `products` / `product_variants` / `inventory`; every write goes through
  `reserveInventoryStock` (`inventory.ts:54`), `commitOrderInventory` (`:115`),
  `releaseOrderInventory` (`:209`).
- **[PROVEN]** `commitOrderInventory` has exactly one caller (`stripe.ts:559`); release is guarded by an
  atomic claim (`:221-233`) with `RELEASABLE_STATUSES` (`:176-182`).
- **[PROVEN] known violation to resolve (not to extend):** the scheduler's variant path writes
  `product_variants.stock` directly (`:328`) while the non-variant path calls the canonical reserve
  (`:341`) — Decision A must settle the one right behavior.
- **[BLOCKED]** on Decision A. **No package-level inventory, no second reservation authority.**

### 17.5 `sold_count` — **no increment at plan / package / cycle creation**

- **[PROVEN] canonical relationship:** `sold_count = sold_count + $1` exists only inside
  `commitOrderInventory` (`inventory.ts:141`), reached only from order settlement (`stripe.ts:559`) —
  i.e. **one recognized sale = one canonical increment** (3A).
- **[PROVEN] current violation:** `velrepeat-scheduler.ts:344` increments `sold_count` at **cycle
  creation**, and nothing ever reverses it; the structural guard
  (`tests/inventory-settlement.test.ts:95-121`) deliberately excludes `velrepeat-scheduler.ts` and
  names it the known finding (`:98-99`).
- **[PROVEN] forbidden increments:** plan creation, package creation, cycle creation, reservation, and
  any VelRepeat-specific counter (contract §52).
- **[OWNER DECISION REQUIRED] Q2 residual — the recognition moment:** under prepaid the settlement
  happens **once at plan level before any cycle order exists**, so the canonical writer is currently
  *unreachable* for prepaid cycles. Whether recognition happens at plan settlement or per cycle is not
  fixed by the owner; **exactly-once must be test-enforced whichever moment is chosen**.
- **[BLOCKED]** on Decision A + Q2 moment. The increment at `:344` may not be reproduced in any new
  path.

### 17.6 Supporting invariants (all reusable, none to be re-invented)

| Invariant | Evidence | Tag |
|---|---|---|
| Every reservation reaches exactly one terminal outcome (commit **or** release) | guards `inventory.ts:221-233`; contract §51(1) | **[IMPLEMENTED]** |
| No negative inventory, no double release/commit | `stock = stock - $1 … WHERE stock >= $1`; atomic `inventory_released` claim | **[IMPLEMENTED]** |
| Webhook exactly-once | `payment_events.event_id UNIQUE` + `ON CONFLICT DO NOTHING` (`stripe.ts:1527/:1540`) | **[IMPLEMENTED]** |
| Incident dedupe cannot double-fire | `payment_incidents.dedupe_key UNIQUE` (`:480`) — identity must gain plan (and later cycle) scope | **[IMPLEMENTED]** + **[ARCHITECTURE RECOMMENDATION]** |
| Cycle N never completes because Cycle 1 did | one row per `(plan, cycle_number)`, independent status | **[IMPLEMENTED]** (structure) / **[BLOCKED]** (generator) |
| A prepaid cycle's scheduled instant is immutable | contract §42(3); snapshot tables | **[PROVEN]** requirement |

---

## 18. Migration safety

### 18.1 Proven behavior of `.github/workflows/migrate-neon.yml`

| Step | Proven content | Tag |
|---|---|---|
| Trigger | `on: push: branches: [main], paths: ['db/migrations/*.sql']` **plus** `workflow_dispatch` (optional single-file input) | **[PROVEN]** |
| Ledger | creates `schema_migrations` if absent; reads applied names from it | **[PROVEN]** |
| Pending detection | for a push (no input): iterates **every** `db/migrations/*.sql` and adds any name **not** in `schema_migrations` — i.e. it applies **all** pending migrations, not just the changed file | **[PROVEN]** |
| Application | per file: `psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f <file>`; on success records the name; on failure prints and `exit 1` (stops the chain) | **[PROVEN]** |
| Explicitly not run | `db/schema.sql` and `db/run-sqleditor.sql` are never executed by this workflow — only `db/migrations/*.sql` | **[PROVEN]** |
| Current pending set | `048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check` — production has not recorded them applied | **[PROVEN]** (documented; runs `36371800184`, `36437470328`, probe `36449336393` failed at Neon quota `53000`; last success 2026-09-25, before 048 existed) |

### 18.2 Consequence, stated exactly

- **[PROVEN]** Any new file `db/migrations/051_*.sql` pushed to `main` joins the pending set and is
  **auto-applied to production Neon unattended** — immediately on the triggering push if the quota
  allows, otherwise on the first later run once the quota clears. There is no approval step in between.
- **[PROVEN]** With the backlog still pending, an added `051` would also **reorder/add to** an
  unattended DDL chain whose 048–050 leg has never been executed successfully in production.
- **[PROVEN]** Production currently lacks `payment_incidents` (049) and `orders.payment_expires_at`
  (048); the unconstrained `orders.status` (050) means the status CHECK is also absent there.

### 18.3 This task's migration verdict

- **[PROVEN] decision recorded:** **no migration `051` was created** in this task — not for the Phase-1
  schema (already present in both canonical files) and not for any Q13 experiment.
- **[PROVEN] canonical-file state:** Phase 1 DDL landed additively in **both** `db/schema.sql` and
  `db/run-sqleditor.sql` and they remain byte-identical (`cmp` → identical, this pass).
- **[PROVEN] fresh-DB contract intact:** an empty Postgres still becomes the complete current DB by
  running `db/run-sqleditor.sql` once (this is what CI does at `test.yml:84`).
- **[BLOCKED] rule for the future:** if an experiment ever seems to require a migration, **stop and
  report before pushing** — never add one while 048–050 are pending and the unattended auto-apply path
  is armed. When the owner clears the quota and approves a phase, the migration is added together with
  the canonical-file update, in that phase, deliberately.
- **[PROVEN]** `db/run-update.sql` must never be recreated (AGENTS rule 4; `.ai/AI_RULES.md` §6).

---

## 19. Dependency graph

```
Q13 (payment linkage) ──┬─> Phase 4 (prepaid payment) ──┬─> Phase 3 completion (plan payment states)
Q14 (Stripe model) ─────┘                              └─> Phase 8 (trace Order→Cycle→Plan→Customer→Payment)
A   (inventory model) ──┬─> Phase 6 (inventory)
Q2  (sold_count moment)─┘
H   (pricing stacking) ─┬─> Phase 2 (package + pricing)
Q11 owner of tier data ─┤
Q15 (V1 packages) ──────┘
E   (future price) ─────┬─> Phase 2 (snapshot write path) / Phase 3 (plan create)
Q16 (timezone) ─────────┘
F   (out-of-stock) ─────┬─> Phase 5 (cycle) / Phase 8 (order fulfillment)
Phase-5 identity ───────┘   reconciliation of velrepeat_runs vs velrepeat_cycles
Q17 (seller split) ────────> Phase 7 (scheduler)
B · C · D · G · I ─────────> Phase 9 (cancellation / pause / skip / modification / prepaid failure)
all of the above ──────────> Phase 10 (unit + DB-gated + CI proof)
```

| Phase (contract §62) | Gates | Status in this pass | Tag |
|---|---|---|---|
| 1. Domain + schema | Q13, Q16 (design inputs) | COMPLETE | **[IMPLEMENTED]** |
| 2. Package + pricing | **H/Q11**, Q15, package-authoring ownership | fully blocked | **[BLOCKED]** |
| 3. Repeat Plan | E, Q16 (+ Q13 for prepaid status vocabulary) | blocked | **[BLOCKED]** |
| 4. Prepaid payment | **Q13, Q14** | blocked | **[BLOCKED]** |
| 5. Delivery Cycle | Phase-5 identity reconciliation, F | blocked | **[BLOCKED]** |
| 6. Inventory | **A**, Q2 moment | blocked | **[BLOCKED]** |
| 7. Scheduler | Q16, Q17 | blocked | **[BLOCKED]** |
| 8. Order fulfillment | Q13 (trace), F | blocked | **[BLOCKED]** |
| 9. Cancellation / pause / modification | **B, C, D, G, I** | blocked | **[BLOCKED]** |
| 10. Tests + E2E | all of the above | blocked | **[BLOCKED]** |

**Structural items surfaced for Phase 5 (architecture, owner-visible because they touch the live
scheduler):**

1. **Cycle identity reconciliation** — Phase 1 added `velrepeat_cycles` while `velrepeat_runs` remains
   the live execution record (8-value status, `UNIQUE (plan_id, scheduled_for)`, first-order-only
   `order_id` + `metadata.orderIds`). The contract requires **exactly one** authority for "did cycle N
   happen". Leaving both unkeyed to each other is a dual-identity hazard (a second authority risk).
   **[ARCHITECTURE RECOMMENDATION]** `velrepeat_cycles` becomes the cycle authority; `velrepeat_runs`
   becomes the execution attempt referencing a cycle (or is retired) — chosen in Phase 5 **before** any
   generator code. **[OWNER DECISION REQUIRED]** to ratify the direction, since it changes the live
   scheduler's durable shape.
2. **Plan prepaid status vocabulary** — `velrepeat_plans.status` (`:826`, 10 values) was not extended;
   prepaid payment states depend on Q13/Q14. Phase 4/3 design item, gated.

---

## 20. Exact decisions required from the owner

Every row below is **[OWNER DECISION REQUIRED]** and is on the stop list (money · settlement · refund ·
inventory ownership · `sold_count` · payment liability · financial history · fulfillment obligation).
None is answered here; none may be defaulted.

| ID | Question | Options | Blocks | Why it cannot be guessed |
|---|---|---|---|---|
| **A / Q1** | Inventory reservation model | whole commitment at prepaid · per cycle | Phase 6, Phase 10 | decides stock ownership, overselling exposure and release scope; STOP #2 |
| **B / Q3** | Prepaid cancellation | refundable future cycles · non-refundable · credit · seller-defined | Phase 9, §10 cash representation | invents a refund policy that does not exist; STOP #1 |
| **C / Q4** | Skip | postpone · consume · credit/refund | Phase 9 | moves or consumes paid value |
| **D / Q5** | Pause | extend end date · consume commitment dates · seller-defined | Phase 9 | changes the horizon of a paid commitment |
| **E / Q9** | Future price change | locked at purchase · reprice future cycles | Phase 2/3/9 | decides who bears a price movement on prepaid money |
| **F / Q8/Q10** | Out-of-stock future cycle | postpone · substitute · cancel/refund/credit · seller policy | Phase 5/8/9 | paid value undelivered; fulfillment obligation |
| **G / Q6/Q7** | Plan modification | future cycles only · prohibited · versioned plan | Phase 9 | can create/destroy monetary value and history |
| **H / Q11** | B2B pricing stacking **+ who owns tier data** | stack · one tier wins · seller-defined; **plus** platform vs seller vs both | Phase 2, Phase 10 | sets the price of every future prepaid contract |
| **I / Q12** | Prepaid + future fulfillment failure | credit · refund · retry/reschedule · seller policy | Phase 9 | money + fulfillment obligation; STOP #1 |
| **Q13** | Prepaid payment linkage | A attach to cycle-1 order · B `payments` nullable `order_id` + `velrepeat_plan_id` · C separate authority (**rejected**) | Phase 4 (+3, +8) | decides payment settlement and financial liability |
| **Q14** | Stripe payment model | one large charge per plan · true Stripe Subscriptions (only if the owner redefines the rail) | Phase 4 | decides the money rail itself |
| **Q15** | V1 `vrepeat_packages` | reuse · migrate · coexist · deprecate | Phase 2 boundary | touches existing durable data/endpoints |
| **Q16** | Timezone semantics | load-bearing plan timezone · scheduling defined as UTC | Phase 3/7 | changes when sold deliveries are scheduled |
| **Q17** | Multi-seller plan | split plan · per-seller execution · forbid · keep as-is | Phase 7 | changes plan/payment composition and seller obligations |
| **Q2 residual** | `sold_count` recognition moment under prepaid | plan settlement · per cycle | Phase 6/10 | decides when revenue is recognized |
| **New (this audit)** | Package-authoring ownership — who may author package prices/composition | platform/operator · seller-owned · both | Phase 2 | a package price is a pricing input that feeds prepaid totals |
| **New (this audit)** | Cycle-identity reconciliation (`velrepeat_cycles` vs `velrepeat_runs`) | cycles is the authority; runs = execution log · keep runs as the authority | Phase 5 (before any generator code) | must not create a second authority for "did cycle N happen" |
| **New (this audit)** | Rounding / currency policy for the prepaid total | half-up at snapshot boundary (recommended) · other | Phase 2 (customer-visible money) | a rounding rule is a money rule |

---

## Decision Matrix

| Decision | Current Evidence | Options | Recommended Architecture | Owner Decision |
|---|---|---|---|---|
| **Q13 Payment Linkage** | `payments.order_id NOT NULL` (`db/run-sqleditor.sql:442`); `refunds.order_id`/`payment_incidents.order_id` NOT NULL (`:504`/`:482`); 88 `payments` occurrences across 13 non-test backend files (44 SQL lines); attempt identity by `order_id` (`stripe.ts:386-415`); amount derived from `orders.total_amount` (`:1133`) | A attach to cycle-1 order · B nullable `order_id` + `velrepeat_plan_id` (+ refunds/incidents linkage) · C separate authority (rejected) | **B** — one authority, plan money has a truthful home; A breaks cycle-2..N confirmation (`order-fulfillment.ts:218-235`), the release guard (`inventory.ts:221-233`), amount derivation, and refund/incident attribution; C creates a second authority | **REQUIRED** |
| **Q14 Payment Rail** | One prepaid charge per plan (contract §46); repo uses Checkout Sessions + webhooks, amount derived server-side (`stripe.ts:1133`); webhook dedupe `:1527`; Stripe E2E never executed (no credentials) | one large canonical charge at plan creation · per-cycle charges (rejected by the contract) · Stripe Subscriptions (new integration) | **One large canonical charge per plan**; no per-cycle charge; **not** Subscriptions unless the owner redefines the rail | **REQUIRED** |
| **Q1 Inventory** | canonical reserve/commit/release (`inventory.ts:54/:115/:209`, atomic claim `:221-233`); 30-min window only (`payment-reservation.ts:44`); variant/non-variant asymmetry (`velrepeat-scheduler.ts:328` vs `:341`); no plan-level reservation record | A reserve whole commitment at prepaid · B reserve per cycle | **B** — no new reservation authority, overselling bounded to one cycle, holds match the only expiry policy that exists; A needs a new months-long hold + expiry/release concept | **REQUIRED** |
| **Q11 Pricing** | no tier/discount logic exists; V1 price fields are not an engine; snapshot tables implemented (`:921-949`); example ladder 1/2/4/8/16 → 0/3/7/10/15 % must not be hardcoded | stack (commitment+quantity) · one tier wins · seller-defined; **plus** platform vs seller owned tier data | Rule **rows in data** (scope, min/max cycles, discount_type/value, priority, eligibility, version) resolved by the engine; no percentage in code; **ownership is the owner's answer** (H) | **REQUIRED** |
| **Q15 V1 Package** | `vrepeat_packages` single-product + `vrepeat_deliveries` (`:680-727`); `routes/velrepeat.ts` 7 package/delivery writes, zero commerce writes; V2 multi-item tables added beside them (Phase 1) | reuse · migrate · coexist · deprecate | **Coexist as legacy** now (already the state); build nothing on V1; deprecate only after a prod usage check (blocked by Neon quota) | **REQUIRED** |
| **Q16 Timezone** | `timezone TEXT DEFAULT 'Asia/Bangkok'` (`:838`) only echoed (`velrepeat-plans.ts:153`); all math UTC (`velrepeat-scheduler.ts:38-65`); TIMESTAMPTZ columns | load-bearing plan timezone (DST-aware) · scheduling defined as UTC (documented) | **Define scheduling as UTC** and treat the column as display metadata, unless a requirement proves timezone-aware delivery days | **REQUIRED** |
| **Q17 Seller Split** | 7B ownership fix live (`seller-orders.ts:766-800`) with a whole-plan residual; one order per shop per run (`velrepeat-scheduler.ts:270-292`); plan may mix sellers (`velrepeat_items.seller_id`) | split plan at creation · per-seller execution inside one plan · forbid multi-seller · keep as-is | **Per-seller execution inside one plan** (one plan, one payment; ownership correct at item level); forbid-multi-seller as a viable interim | **REQUIRED** |
| **Cancellation** | cancel sets status/`ended_at` only, touches no order/payment/inventory (`velrepeat-plans.ts:531-536`); three levels defined (§53) | refundable future cycles · non-refundable · credit · seller-defined | Depends on B; any chosen policy must use plan-linked refund rows with webhook-confirmed partial refunds | **REQUIRED** |
| **Refund** | order-scoped only (`refunds.order_id NOT NULL :504`); recomputed from succeeded rows (`stripe.ts:667-726`); no partial-commitment representation | full/partial plan refund · credit · none | Reuse the canonical refund mechanism with plan linkage; no invented refund path; policy = Decision B | **REQUIRED** |
| **Pause** | pause = status only (`:507-513`); resume = `GREATEST(next_run_at, NOW())` silent deferral (`:520`); no end date; instants immutable once prepaid | extend end date · consume commitment dates · seller-defined | Needs an explicit horizon/remaining-cycles concept before any behavior; whichever option, completed cycles stay immutable and no silent money effect | **REQUIRED** |
| **Skip** | no skip endpoint exists anywhere (`grep` → 0); `skipped` exists only as cycle vocabulary (Phase 1) | postpone · consume · credit/refund | Postpone is the least-money default **as a recommendation**; consuming or crediting requires B's refund representation | **REQUIRED** |
| **Modification** | destructive PATCH delete/re-insert (`velrepeat-plans.ts:445`); snapshot immutability required (§45) | future cycles only · prohibited · versioned plan | Future-only **with versioning** (plan version row or version-tagged cycles, chosen Phase 9); the destructive PATCH must not survive | **REQUIRED** |
| **Future Price** | scheduler re-prices every cycle from live price and overwrites `velrepeat_items.unit_price` (`:229-249`) — opposite of §45 | locked at purchase · reprice future cycles | **Locked at purchase** (matches the prepaid total); reprice would need an owner-defined bearer of the difference | **REQUIRED** |
| **Out of Stock** | `INSUFFICIENT_STOCK` rollback + retry (`:328-341`); `out_of_stock`/`item_unavailable` vocabulary exists (plan/run/cycle) | postpone · substitute · cancel/refund/credit · seller policy | **Postpone with bounded retries + operator escalation** (no auto-refund) as a recommendation; any money option needs B | **REQUIRED** |
| **Fulfillment Failure** | transitions packing→shipped only (`order-fulfillment.ts:89-97`); confirmation gate `:218-235`; refunds order-scoped; 6A incident policy in force | credit · refund · retry/reschedule · seller policy | Retry/reschedule by default with the cycle/order idempotency claim; money options require B; never auto-refund (6A) | **REQUIRED** |

**Additional gates surfaced by this audit** (same rules — all **[OWNER DECISION REQUIRED]**):

| Decision | Current Evidence | Options | Recommended Architecture | Owner Decision |
|---|---|---|---|---|
| **Q2 residual — `sold_count` moment** | canonical writer `inventory.ts:141` reachable only from order settlement (`stripe.ts:559`), unreachable for a plan-level prepaid charge; scheduler violates it at `:344` | recognize at plan settlement · recognize per cycle | Recognize through a canonical writer exactly once; the choice decides when revenue appears and which writer is extended | **REQUIRED** |
| **Package-authoring ownership** | V2 package tables exist (`:898-920`); nobody may author them yet; a package price is a pricing input only | platform/operator · seller-owned · both | Platform-authored packages with seller product prices as inputs, **if** the owner confirms; otherwise seller-scoped | **REQUIRED** |
| **Cycle identity reconciliation** | `velrepeat_cycles` (Phase 1, `UNIQUE (plan_id, cycle_number)`) vs live `velrepeat_runs` (8-value status, `UNIQUE (plan_id, scheduled_for)`, first-order-only `order_id` + `metadata.orderIds`) | cycles is the authority (runs become execution log/referenced) · runs stays the authority | `velrepeat_cycles` becomes the single cycle authority; reconcile **before** any generator code (Phase 5) so no second authority exists | **REQUIRED** |
| **Rounding / currency policy** | amounts `NUMERIC(12,2)`; snapshot tables store discount/value/total; no documented rounding rule | half-up at snapshot boundary · other | One documented rounding point at the snapshot boundary; never two different rounding paths | **REQUIRED** |

---

## This task's scope and verification (closing note)

- **Edited files:** only `.ai/` documents (this audit; a Revision 2.2 pointer in
  `.ai/context/velrepeat-contract.md`; a §54 entry in `.ai/AI_HANDOFF.md`).
- **Not touched:** `backend/**`, `db/**`, `apps/**`, `packages/**`, `.github/**`. No migration file. No
  scheduler, webhook, settlement, inventory, `sold_count`, refund, order-lifecycle or payment behavior
  change. COD remains off. Stripe mode unchanged.
- **Decisions closed by this task:** none — this task produces analysis only. The register (A–I,
  Q13–Q17, Q2 residual, package-authoring ownership, cycle identity, rounding) is still open, and
  1A–7B remain the binding approved set.
- **Production:** NOT VERIFIED and NOT CLAIMED. Migrations 048–050 are still unapplied (Neon quota,
  owner action); the Phase-1 objects exist only in the canonical SQL files and in CI's disposable
  PostgreSQL.
- **Verification of this pass:** `bun run test`, `cd backend && bunx tsc --noEmit`, `bun run typecheck`,
  `bun run build:apps`, `git diff --check` — results recorded in `.ai/AI_HANDOFF.md` §54. Local DB-gated
  tests skip (no local PostgreSQL); CI's `postgres:16` remains the only real DB execution.
- **Next safe phase:** none is unblocked. The earliest phase (2. Package + pricing) is gated on
  **H/Q11 + Q15 + package-authoring ownership**; Phase 3 on **E + Q16**; Phase 4 on **Q13 + Q14**;
  Phase 6 on **A + Q2**; Phase 9 on **B/C/D/G/I**.

