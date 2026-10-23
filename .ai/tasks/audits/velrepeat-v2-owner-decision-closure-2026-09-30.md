# Audit — VelRepeat V2 Owner Decision Closure + Architecture Consistency Gate

**Date:** 2026-09-30 · **Repository:** `EnJirad/velnox-marketplace` · **Branch:** `main`
**Base commit:** `cdcf170` (`docs(ai): close velrepeat v2 architecture decision gate`) — local HEAD == `origin/main`, working tree clean at start (verified `git fetch origin` + `git rev-parse` both sides).
**Task type:** OWNER DECISION CLOSURE + ARCHITECTURE CONSISTENCY GATE. **This is not an implementation phase.**
**Scope:** documentation and evidence only. No production backend, frontend, Stripe, webhook,
inventory, scheduler, fulfillment, `sold_count`, refund or order-lifecycle behavior was changed. No
schema change. No migration. COD remains off. Stripe mode unchanged.
**Deliverable:** this document.
**Predecessor audits:** `.ai/tasks/audits/velrepeat-v2-decision-closure-2026-09-30.md` (the open-decision
register this pass closes) and `.ai/tasks/audits/medium-10-velrepeat-commerce-lifecycle-2026-09-30.md`
(the `sold_count` / COD / inventory evidence base).
**Authoritative contract:** `.ai/context/velrepeat-contract.md` (VelRepeat V2 — Prepaid Repeat Commerce,
Revision 2.2; §39–§64 normative, §60 decision register, §62 roadmap).

**Verdict stated up front: `PHASE 2 = BLOCKED`.** Not on money policy — the owner's Q13, Q14, A/Q1, Q2,
B, C, D, E, F, G, H/Q11, Q15, Q16 and Q17 answers close the commercial register. Phase 2 is blocked on
three pricing/ownership questions that touch customer-visible money and that **this pass did not receive
an answer to** (see §11 and §12). The exact reasoning is in §11; it is not a judgment about the owner's
decisions.

---

## Tag legend (EVERY statement in this document is tagged)

| Tag | Meaning |
|---|---|
| **[PROVEN]** | Verified against the working tree at `cdcf170` in this pass, with a `file:line` citation. |
| **[IMPLEMENTED]** | Already exists in the repository now (code, DDL, or test) and is proven present. |
| **[OWNER DECISION]** | A binding policy statement supplied by the repository owner on 2026-09-30 and recorded here verbatim in intent. It is policy, not a recommendation. |
| **[OWNER DECISION REQUIRED]** | Not answered. Per the task's hard safety gate this is a **STOP** token: no workaround may be chosen. (§18 of the task; §20 tag set.) |
| **[OWNER FORMULA REQUIRED]** | The policy direction is decided but the repository does **not** contain enough data to derive the exact monetary formula. Per the owner's own instruction this is a **STOP** token and the affected phase must not be implemented. |
| **[ARCHITECTURE RECOMMENDATION]** | This audit's engineering recommendation. **Not** owner policy, **not** implemented, and it never overrides an `[OWNER DECISION]`. |
| **[BLOCKED]** | Cannot proceed until a named decision or formula lands. No workaround attempted. |

> Both stop tokens are used: `[OWNER DECISION REQUIRED]` for an unanswered question and
> `[OWNER FORMULA REQUIRED]` for a decided direction whose exact monetary formula is not derivable from
> the repository. Where the owner's decision *is* recorded, it is tagged `[OWNER DECISION]`.

---

## 1. Owner decisions (binding policy, recorded 2026-09-30)

This section records what the owner decided. It contains **no** recommendation and **no** engineering
choice of this audit. Each row states the decision, then points to the section that traces it through
source.

### 1.1 The decision register — closed by this pass

| ID | Decision (owner) | Binding rules as stated | Traced in |
|---|---|---|---|
| **Q13** | **B** — add canonical plan-level payment linkage **inside the existing payment authority** | `payments` stays canonical; no separate VelRepeat payment system; one payment = the whole plan commitment; trace `Customer → Repeat Plan → Payment → Delivery Cycles → Orders`; refund / incident / webhook / attempt must trace back to the Plan; must **not** make Cycle 1's order hold all the money; must **not** fake `orders.total_amount`; no duplicate payment authority | §3.1, §6 |
| **Q14** | **One canonical Stripe prepaid charge per Repeat Plan** | pay once at commitment purchase; payment amount = commitment price after pricing rules; not a Stripe Subscription; no re-charge per cycle; every Cycle is a fulfillment obligation of the prepaid plan; webhook must be idempotent; a late webhook must not create wrong fulfillment; payment success must not mark every cycle completed — payment success = *commitment paid*, per-cycle fulfillment stays separate | §3.2, §6 |
| **A / Q1** | **B — reserve per cycle** | do not reserve the whole commitment up front; check and reserve that cycle's stock before each delivery cycle; use the canonical inventory functions; no new inventory authority; reservation/release must be tied to the real order/cycle; never hold stock for months without a canonical expiration/release model; if a cycle is short of stock it must enter the defined policy — never a silent oversell | §3.3, §7 |
| **Q2** | **Count `sold_count` on the settlement of the fulfillment cycle that actually happens** | creating a Repeat Plan does **not** increment `sold_count`; the plan-level prepaid payment must **not** immediately increment `sold_count` for every cycle; no double count; a cycle/order that is not yet fulfilled must not be counted as sold; the canonical commit point must be defined clearly in the implementation; use `commitOrderInventory()` or a canonical equivalent; **no new direct `sold_count += quantity` path in VelRepeat**. *The owner also instructed: if this conflicts with existing commerce semantics, STOP and report the conflict before implementing.* | §3.4, §4.1, §7.4 — **conflict found and reported** |
| **B** | **Refund only the future unfulfilled cycles, per the canonical refund policy** | a fulfilled cycle is not a future cycle; an unfulfilled cycle may enter the cancellation/refund calculation; never refund by editing a payment amount directly; use the canonical `refunds` / Stripe mechanism; require an immutable financial calculation/snapshot; refund must be idempotent; must prevent over-refunding; never auto-refund from an ambiguous webhook; the refund calculation must be back-auditable. *If the repository lacks the data to fix the exact monetary formula → mark `OWNER FORMULA REQUIRED` and STOP Phase 9* | §6.4, §12.1 |
| **C** | **Skip is allowed only for a future unfulfilled cycle** | never skip a cycle that is packing; never skip a shipped cycle; never rewrite a historical financial record; a skip must write an audit/event; a skip is **not** a successful delivery; the skipped cycle's inventory must **not** be committed as sold; must decide whether the cycle is postponed to the end of the commitment or treated as a consumed cycle. *If the monetary consequence is still unclear → `OWNER FORMULA REQUIRED`* | §5.3, §12.2 |
| **D** | **Pause applies to future cycles only** | never stop a cycle whose fulfillment has already started; pause does not change historical cycles; store a pause event/audit; the scheduler must not create future fulfillment while paused; resume must not create duplicate cycles; the schedule must be deterministic and idempotent | §5.2, §7.5 |
| **E** | **Price snapshot at purchase** | the commitment price is snapshotted at purchase; a later product price change never changes money the customer already paid; cycle fulfillment uses the correct snapshot; never recalculate historical financial records from the current product price; package composition and quantity must be snapshotted too | §3.5, §11.2 |
| **F** | **No oversell and no auto-substitute** when a future cycle is out of stock | do not commit inventory; do not increment `sold_count`; do not create a false success; create a durable cycle failure state/event; notify system/operator/customer; never auto-substitute; never auto-refund without a policy; never silently skip. *If there is no canonical monetary policy → `OWNER FORMULA REQUIRED`* | §5.4, §12.3 |
| **G** | **Historical cycles immutable + future-cycle versioning** | never modify a historical cycle; never modify an order that already happened to change the past; changing package/quantity/schedule of a future cycle must create a new version/snapshot; each cycle must be traceable to the version it used; payment history must never be rewritten; financial snapshots must never be rewritten | §3.6, §5.5 |
| **H / Q11** | **Pricing rules are platform-controlled, data-driven configuration** | do not hardcode `1 = 0%`, `2 = 3%`, `4 = 7%`, `8 = 10%`, `16 = 15%` — those numbers are **examples only**; the real system must support rule data such as min cycles, max cycles, discount type, discount value, priority, eligibility, scope, version, active period; **no business pricing may be hardcoded in source**; a seller may not create a pricing rule that breaks financial invariants | §3.7, §11.1, §11.3 |
| **Q15** | **V1 `vrepeat_packages` coexists temporarily as legacy** | V1 is not deleted now; V2 is not built on V1 tables; V2 uses `velrepeat_packages`, `velrepeat_package_items`, `velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items`, `velrepeat_cycles`; production usage must be checked before any deprecation; no migration/drop of V1 without usage evidence | §3.8, §9.4 |
| **Q16** | **Scheduling authority = UTC** | backend scheduling is UTC; TIMESTAMPTZ is canonical; the timezone stored on the plan is display/user preference only unless the owner later changes policy; no local-time calculation may make the scheduler non-deterministic; DST must not cause duplicate or missed cycles | §3.9, §5.6 |
| **Q17** | **One Repeat Plan may span multiple sellers**, with: central scheduler only; a seller trigger must not process arbitrary customer plans; sellers see and manage only their own orders; a cycle may split into several orders per seller/shop; the plan-level payment remains ONE payment; order-level fulfillment ownership stays separated by seller; a seller may not change plan-level financial truth | §3.10, §8 |
| **Cycle identity** | **Accepted architecture direction:** `velrepeat_cycles` = canonical cycle identity; `velrepeat_runs` = execution attempt / scheduler execution record | no two systems may each claim to be "cycle N"; the relation must be designed before touching the scheduler. **This task only documents the decision and the required architecture transition — the scheduler was not modified.** | §9 |
| **State machines** | Plan / Payment / Cycle / Order / Fulfillment must be defined **separately**; Order keeps the canonical commerce lifecycle `pending → confirmed → packing → shipped → delivered → completed`; cancellation must occur before the fulfillment boundary per contract; Fulfillment must not be inferred from Plan or Payment alone; no duplicate state machine without reason; **if the existing states are insufficient, document the required change — do not guess and do not implement it in this task** | §5 |

### 1.2 What the owner's decisions changed relative to the open register

| Previously open | Now | Note |
|---|---|---|
| A–I, Q13–Q17, Q2 residual | **All answered as policy** (§1.1) | The *directions* are closed. Some need an exact formula before code — §12. |
| Package-authoring ownership (raised by the prior audit) | **Still open** | Not answered in this pass. Phase-2 relevant. **[OWNER DECISION REQUIRED]** |
| Rounding / currency policy (raised by the prior audit) | **Still open** | Not answered in this pass. Customer-visible money. Phase-2 relevant. **[OWNER DECISION REQUIRED]** |
| H — *stacking* half (contract §60.2 separates stacking from the Q11 ownership question) | **Ownership half closed by H/Q11; stacking half still open** | §3.7, §11.1. **[OWNER DECISION REQUIRED]** |
| Cycle identity (prior audit) | **Direction accepted** | Relation design still owed. §9. |
| Seller eligibility for repeat commerce (task §21 list) | **Still open** | Contract §62 assigns it to Phase 7, not Phase 2 — unless packages are seller-scoped, which is itself open. §11.4. **[OWNER DECISION REQUIRED]** |

---

## 2. Source evidence (re-read at `cdcf170` in this pass — no memory used)

Every anchor below was re-read from the working tree during this pass. Line numbers are current at
`cdcf170`. `db/schema.sql` and `db/run-sqleditor.sql` were compared with `cmp` → **byte-identical**
(§ verification note at the end).

### 2.1 Database — `db/run-sqleditor.sql` (identical in `db/schema.sql`)

| Object | Evidence | Tag |
|---|---|---|
| `payments` | `:440-462`; `order_id UUID NOT NULL REFERENCES orders(id)` at **`:442`**; `status TEXT NOT NULL DEFAULT 'pending'` at `:446` with **no CHECK constraint on `payments.status`**; `amount NUMERIC(12,2)`; `refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0`; `refund_status TEXT` | **[PROVEN]** |
| `payments` indexes | `idx_payments_order :461`; `idx_payments_provider_session`; `idx_payments_provider_payment`; `idx_payments_one_active_stripe` = `UNIQUE (order_id) WHERE provider='stripe' AND status IN ('pending','requires_action')` at **`:462`** | **[PROVEN]** |
| `payment_events` | `:463-477`; `event_id TEXT NOT NULL UNIQUE` at **`:466`**; `status TEXT NOT NULL DEFAULT 'processed'`; `payload JSONB` | **[PROVEN]** |
| `payment_incidents` | `:478-495`; `dedupe_key TEXT NOT NULL UNIQUE` **`:480`**; `order_id UUID NOT NULL REFERENCES orders(id)` **`:482`**; `payment_id UUID REFERENCES payments(id) ON DELETE SET NULL`; `status TEXT NOT NULL DEFAULT 'open'` | **[PROVEN]** |
| `refunds` | `:502-518`; `order_id UUID NOT NULL REFERENCES orders(id)` **`:504`**; `payment_id UUID REFERENCES payments(id)` **`:505`**; `provider_refund_id`; `status TEXT NOT NULL DEFAULT 'pending'`; `idx_refunds_provider_refund` unique **`:517`** | **[PROVEN]** |
| `checkout_requests` | `:391-400`; `UNIQUE (user_id, scope, request_key)` **`:399`**; `order_id UUID REFERENCES orders(id) ON DELETE SET NULL` `:395` | **[PROVEN]** |
| `orders` (VelRepeat legs) | `velrepeat_run_id UUID` **`:380`**; `velrepeat_cycle_id UUID` **`:381`**; `inventory_released BOOLEAN NOT NULL DEFAULT FALSE` `:377`; `payment_expires_at TIMESTAMPTZ` `:378`; `reservation_policy JSONB` `:379` | **[PROVEN]** |
| `orders_status_check` | `:1029-1033` — 12 values: `pending, confirmed, packing, shipped, delivered, completed, cancelled, pending_payment, paid, payment_failed, refunded, expired` | **[PROVEN]** |
| `commissions` | `:520-526` — `order_id UUID NOT NULL REFERENCES orders(id)`, `seller_id UUID NOT NULL`, `amount NUMERIC(12,2)`, `rate NUMERIC(5,4) DEFAULT 0.05` | **[PROVEN]** |
| `settlements` | `:528-534` — `seller_id`, `amount`, `status`; **no payment/plan/cycle reference** | **[PROVEN]** |
| `platform_settings` | `:657-662` — `key TEXT PRIMARY KEY`, `value TEXT NOT NULL`, `description`, `updated_by` | **[PROVEN]** |
| V1 `vrepeat_packages` | `:680-707` — single `product_id` + optional `variant_id`; `package_type CHECK IN ('weekly','monthly','custom')`; `quantity_total`; `unit_price`, `regular_unit_price`, `discount_amount`, `total_amount`; `payment_id UUID REFERENCES payments(id)`; status CHECK 7 values incl. `pending_payment/paid/active/paused/completed/cancelled/refunded` | **[PROVEN]** |
| V1 `vrepeat_deliveries` | `:710-727`; `UNIQUE (package_id, delivery_number)` **`:724`**; `order_id UUID REFERENCES orders(id)` | **[PROVEN]** |
| `velrepeat_plans` | `:824-847`; status CHECK 10 values **`:827`** (`draft, active, paused, processing, payment_failed, out_of_stock, item_unavailable, price_changed, cancelled, completed`); `commitment_cycles INTEGER` **`:830`**; `payment_method TEXT NOT NULL DEFAULT 'cod'` **`:836`**; `timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok'` **`:839`**; `next_run_at TIMESTAMPTZ NOT NULL`; **no end date column** | **[PROVEN]** |
| `velrepeat_items` | `:848-866` — `shop_id UUID NOT NULL`, `seller_id UUID NOT NULL` at `:854` (per-line, so a plan may span sellers), `quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)`, `unit_price NUMERIC(12,2) NOT NULL`; per-composition partial unique indexes (`:865-866`) | **[PROVEN]** |
| `velrepeat_runs` | `:867-886`; status CHECK 8 values **`:873`**; `order_id UUID REFERENCES orders(id)` = **first order only** `:874`; `UNIQUE (plan_id, scheduled_for)` `:882`; `metadata JSONB`; FK DO-block `orders.velrepeat_run_id → velrepeat_runs.id` `:885` | **[PROVEN]** |
| `velrepeat_events` | `:887-897`; `plan_id NOT NULL`, `run_id REFERENCES velrepeat_runs(id) ON DELETE SET NULL`, `event_type TEXT NOT NULL` | **[PROVEN]** |
| V2 `velrepeat_packages` | `:898-906` — `id, name, description, is_active, metadata, created_at, updated_at` — **no price column, no owner/seller column, no stock column** | **[IMPLEMENTED]** |
| V2 `velrepeat_package_items` | `:908-919` — `package_id, product_id, variant_id, quantity, timestamps` — **no price column, no stock column** | **[IMPLEMENTED]** |
| V2 `velrepeat_pricing_snapshots` | `:921-936` — `plan_id`, `commitment_cycles`, `currency`, `subtotal_amount`, `discount_type`, `discount_value`, `discount_amount`, `total_amount`, `pricing_rule_key`, `pricing_rule_version`, `metadata` — **no per-cycle amount column** | **[IMPLEMENTED]** |
| V2 `velrepeat_pricing_snapshot_items` | `:937-949` — `snapshot_id, product_id, variant_id, quantity, unit_price, line_total` | **[IMPLEMENTED]** |
| V2 `velrepeat_cycles` | `:950-965`; `cycle_number INTEGER NOT NULL CHECK (cycle_number > 0)`; status CHECK 8 values **`:954`** (`scheduled, processing, ordered, completed, skipped, cancelled, out_of_stock, item_unavailable`); `scheduled_at TIMESTAMPTZ NOT NULL`; `pricing_snapshot_id UUID REFERENCES velrepeat_pricing_snapshots(id) ON DELETE SET NULL`; **`UNIQUE (plan_id, cycle_number)` `:962`** | **[IMPLEMENTED]** |
| Cycle ↔ order link | FK DO-block `orders_velrepeat_cycle_id_fkey` **`:966`**; partial index `idx_orders_velrepeat_cycle` **`:967`** | **[IMPLEMENTED]** |
| No `velrepeat_runs → velrepeat_cycles` relation exists | `velrepeat_runs` (`:867-886`) has no cycle FK; `velrepeat_cycles` (`:950-965`) has no run FK; `velrepeat_events.run_id` points at runs only | **[PROVEN]** — this is the dual-identity finding in §9 |
| Fresh-DB category seed | `:1040+` (`INSERT INTO categories …`) — data, not part of the DDL contract | **[PROVEN]** |

### 2.2 Backend

| Fact | Evidence | Tag |
|---|---|---|
| Canonical reserve | `backend/lib/inventory.ts:54` `reserveInventoryStock` → `UPDATE inventory SET reserved = reserved + $1 … WHERE quantity - reserved >= $1 RETURNING id` (`:60-63`); throws `INSUFFICIENT_STOCK: product <id>` (`:65-67`) | **[IMPLEMENTED]** |
| Canonical commit + `sold_count` | `backend/lib/inventory.ts:115` `commitOrderInventory`; header states the lifecycle **"reserve (checkout) → commit (payment settled) xor release (order ended)"** (`:77`); the exactly-once gate is the *caller's* status claim under `lockOrderRow` requiring `inventory_released = FALSE`, **not a check inside the function** (`:73-77`); it reads `order_items WHERE order_id = $1` (`:118-121`); non-variant `UPDATE inventory SET quantity = GREATEST(0, quantity - $1), reserved = GREATEST(0, reserved - $1)` (`:124-131`); variant stock deliberately untouched; `UPDATE products SET sold_count = sold_count + $1 WHERE id = $2` **`:141`** | **[IMPLEMENTED]** |
| `commitOrderInventory` callers | **exactly one** — `backend/routes/stripe.ts:559`, inside `markPaymentSucceeded`. Verified `grep -rn commitOrderInventory backend --include='*.ts' \| grep -v tests` → `stripe.ts:39` (import), `stripe.ts:559` (call), `inventory.ts:115/147/253` (definition/log/comment) | **[PROVEN]** |
| Canonical release + atomic claim | `backend/lib/inventory.ts:209` `releaseOrderInventory`; the guarded claim UPDATE at `:221-234` requires `inventory_released = FALSE` **AND** `status = ANY($2::text[])` **AND** `NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.status = ANY($3::text[]))`; the "settled payment outranks cancellation" refusal is explicit at `:252-259` | **[IMPLEMENTED]** |
| `RELEASABLE_STATUSES` | `backend/lib/inventory.ts:176-182` — `pending, pending_payment, cancelled, payment_failed, expired` | **[IMPLEMENTED]** |
| Order-lock contract | `backend/lib/order-lock.ts:67` — `SELECT id, status, inventory_released FROM orders WHERE id = $1 FOR UPDATE`; `PAYMENT_SETTLED_STATUSES = ["paid","processing"]` at `:83` | **[IMPLEMENTED]** |
| 30-minute reservation policy | `backend/lib/payment-reservation.ts:44` `PAYMENT_RESERVATION_MINUTES = 30`; policy version `v2` `:36`; `PAYMENT_RESERVATION_EXPIRABLE_STATUSES = ["pending","pending_payment"]` `:58`; `PAYMENT_RESERVATION_EXPIRED_STATUS = "expired"` `:61` | **[IMPLEMENTED]** |
| Payment settlement | `backend/routes/stripe.ts:418` `markPaymentSucceeded`; locks the order first (`:428`); order claim requires a pre-payment status and `inventory_released = FALSE` (`:430-434`); attempt guards `:457-467`; late-payment log `manual review/refund required` **`:547`**; `commitOrderInventory` **`:559`**; `markPaymentFailed` `:567` | **[IMPLEMENTED]** |
| Payment attempt identity | `backend/routes/stripe.ts:386-415` `resolvePaymentAttemptRow` — resolves by `order_id` **plus** provider ids | **[PROVEN]** |
| Checkout derivation | `backend/routes/stripe.ts:1066` `assertPaymentMethodUsable(method)`; payable statuses `:1095`; window check `:1110`; **amount = `toMinor(order.total_amount)` `:1133`** — the charge is derived from **one order** | **[PROVEN]** |
| Refund mechanism | `backend/routes/stripe.ts:320` `refundableMinorFor(paidAmount, alreadyRefunded)` (never negative); refund state recomputed from succeeded rows (`:1641` reads `payment.amount, payment.refunded_amount`); documented as webhook-confirmed in `.ai/context/payment.md:141-146` | **[IMPLEMENTED]** |
| Webhook idempotency | `backend/routes/stripe.ts:1527` and `:1540` — `INSERT INTO payment_events … ON CONFLICT (event_id) DO NOTHING` | **[IMPLEMENTED]** |
| Payment configuration | `backend/lib/payment-config.ts:25` `PaymentMethodId = "CARD" \| "PROMPTPAY" \| "COD"`; `:26` `PaymentProvider = "STRIPE" \| "CARRIER"`; `isCodEnabled()` `:313`; `isCodCustomerSelectable()` `:325`; `assertPaymentMethodUsable()` referenced from `stripe.ts:1066` | **[IMPLEMENTED]** |
| Fulfillment state machine | **`backend/lib/order-fulfillment.ts`** (note: `backend/routes/order-fulfillment.ts` **does not exist** — verified `ls` → "No such file or directory"): `FULFILLMENT_STATUSES` `:69-77` = `pending, confirmed, packing, shipped, delivered, completed, cancelled`; `FULFILLMENT_TRANSITIONS` `:89-96` — `pending → [confirmed, cancelled]`, `confirmed → [packing, cancelled]`, `packing → [shipped]`, `shipped → [delivered]`, `delivered → [completed]`, `completed → []`, `cancelled → []`; the source comment states plainly that **`packing` has no edge to `cancelled`** (`:86`); `TERMINAL_FULFILLMENT_STATUSES` `:100`; `COD_PAYMENT_METHODS` `:192`; `PAID_PAYMENT_STATUSES = ["paid"]` `:189`; `paymentAllowsConfirmation` `:218-235` | **[IMPLEMENTED]** |
| Confirmation gate | `backend/lib/order-fulfillment.ts:218-235` `paymentAllowsConfirmation(rows, codEnabled = isCodEnabled())` — allowed iff a `paid` payment row exists **for that order's history**, or COD while the rail is enabled | **[IMPLEMENTED]** |
| VelRepeat scheduler | `backend/jobs/velrepeat-scheduler.ts`: `calculateNextRunAt` `:38-65` (UTC `setUTCDate` `:47/:50`, `setUTCFullYear` with month day-clamping `:60`); `processPlan` `:110`; claim `FOR UPDATE` + re-check `:113-120`; run insert `ON CONFLICT DO NOTHING` `:127` (relying on `velrepeat_runs UNIQUE (plan_id, scheduled_for)`); live re-price + **`UPDATE velrepeat_items SET unit_price`** `:245`; `INSERT INTO orders (… status, total_amount, currency …)` `:270`; variant consume **`UPDATE product_variants SET stock = stock - $1`** `:328`; non-variant `reserveInventoryStock` `:341`; **`UPDATE products SET sold_count = sold_count + $1`** **`:344`**; per-order pseudo-payment `INSERT INTO payments (order_id, amount, currency, method, status, provider)` with `'cod','pending','cod'` **`:351-352`**; `next_run_at` advance `:358-369`; `processDuePlans` `:444`; `startVelRepeatScheduler` `:467`; header comment `:16-20` states the COD intent | **[PROVEN]** |
| Plan routes | `backend/routes/velrepeat-plans.ts`: `timezone` echoed only `:153`; **`paymentMethod !== "cod"` → 400** `:223`; `INSERT INTO velrepeat_plans` `:260`; **`DELETE FROM velrepeat_items WHERE plan_id = $1`** `:445`; pause → `status='paused'` `:508` + `velrepeat_events 'PLAN_PAUSED'` `:512`; resume → `next_run_at = GREATEST(next_run_at, NOW())` **`:520`**; cancel → `status='cancelled', ended_at = NOW()` `:531` + `'PLAN_CANCELLED'` `:535`; **no skip endpoint** — `grep -c skip` → **0** | **[PROVEN]** |
| Seller surfaces | `backend/routes/seller-orders.ts:695` read path `WHERE vi.seller_id = $1`; `POST /api/subscriptions/process-due` `:766` with `EXISTS (… WHERE vi.plan_id = vp.id AND vi.seller_id = $1)` **`:784`** — ownership-scoped (fix `2567707`), but the matched plan is then processed as a **whole plan** | **[PROVEN]** |
| V1 routes | `backend/routes/velrepeat.ts` — 7 package/delivery writes (`:48, :162, :377, :388, :535, :548, :561`); **zero order / payment / inventory writes** | **[PROVEN]** |
| Server wiring | `backend/server.ts:472` V1 VelRepeat routes, `:475` plan routes, `:519` `startVelRepeatScheduler()`, `:525` `startPaymentReservationScheduler()` | **[IMPLEMENTED]** |
| `commissions` / `settlements` have **no backend writer** | `grep -rn "INSERT INTO commissions\|FROM commissions" backend --include='*.ts' \| grep -v tests` → **0 matches**; same for `settlements` → **0 matches** | **[PROVEN]** |
| No Stripe Connect / marketplace payout | `.ai/context/payment.md:239-250` — no connected account, no `transfer_data` / `application_fee` / `on_behalf_of`, no seller↔Stripe mapping, no KYC state; the customer is charged through the platform's own account and **seller amounts are internal accounting only** | **[PROVEN]** |
| Payment SQL blast radius | `grep -rEn '\bpayments\b' backend --include='*.ts'` excluding `tests/` → **88 occurrences across 13 files** (re-confirmed identical to the prior audit) | **[PROVEN]** |
| Structural guard test | `backend/tests/inventory-settlement.test.ts:95-121` — `orderPaths` = `cart.ts, stripe.ts, seller-orders.ts, center.ts, payment-reservation-scheduler.ts`, each asserted to **not** contain `UPDATE inventory`, `stock = stock +`, `sold_count = sold_count +`; `velrepeat-scheduler.ts` is **deliberately excluded and named a known separate finding** (`:98-99`) | **[PROVEN]** |
| Phase 1 tests | `backend/tests/velrepeat-v2-domain-schema.test.ts` — `describe` at `:64` (canonical-file structural half, runs everywhere) and `:111` (integration, needs a test database) | **[IMPLEMENTED]** |
| Stripe E2E | No Stripe credentials in this workspace; `.ai/context/payment.md:173` records the verification gate — code-verified only, real round trip never executed | **[PROVEN]** |

### 2.3 CI / migration reality (unchanged, re-confirmed)

| Fact | Evidence | Tag |
|---|---|---|
| Auto-apply trigger | `.github/workflows/migrate-neon.yml` — `on: push: branches: [main], paths: ['db/migrations/*.sql']` + `workflow_dispatch`; applies **all** pending files not in `schema_migrations`, each with `psql -v ON_ERROR_STOP=1 --single-transaction -f` | **[PROVEN]** |
| Pending set | `048_payment_reservation`, `049_payment_incidents`, `050_orders_status_check` — production has not recorded them applied (Neon quota `53000`; last successful migrate 2026-09-25) | **[PROVEN]** (documented, not re-queried — no production access from here) |
| Migrations directory ends at | `ls db/migrations/ \| tail` → `… 048_payment_reservation.sql  049_payment_incidents.sql  050_orders_status_check.sql` | **[PROVEN]** |
| Only real DB execution | `.github/workflows/test.yml` bootstraps a disposable `postgres:16` from `db/run-sqleditor.sql` (`:84`) then `bun test backend/tests` (`:126`); references no repository secret | **[PROVEN]** |
| Canonical files in parity | `cmp db/schema.sql db/run-sqleditor.sql` → **byte-identical** | **[PROVEN]** |

---

## 3. Architecture implications (what each decision forces, with evidence)

This section is **analysis of consequences**, not new policy. Every consequence is derived from an
`[OWNER DECISION]` plus a `[PROVEN]` fact.

### 3.1 Q13 = B — plan-level linkage inside the one payment authority

- **[PROVEN]** `payments.order_id` is `NOT NULL REFERENCES orders(id)` (`:442`), so a plan-level payment
  cannot be stored today. The decision therefore requires, in a later phase, a **nullable
  `payments.order_id` plus a plan parent with a "exactly one parent" CHECK**, and the same question for
  `refunds.order_id` (`:504`) and `payment_incidents.order_id` (`:482`) — both `NOT NULL` today.
  **[ARCHITECTURE RECOMMENDATION]** the DDL must be additive and the three tables must move together, or
  plan money and plan refunds become unrepresentable and the decision is not actually implemented.
- **[PROVEN]** `idx_payments_one_active_stripe` (`:462`) is `UNIQUE (order_id) WHERE provider='stripe'
  AND status IN ('pending','requires_action')`. Because NULLs are distinct in PostgreSQL, that index
  **cannot** constrain plan-level rows; a plan-scoped twin is required. **[ARCHITECTURE RECOMMENDATION]**
- **[PROVEN]** the decision's negative requirements are all satisfiable *only* because Option A is
  rejected: Cycle 1's order must not hold the plan money, and `orders.total_amount` must not be inflated.
  Note the checkout derivation `toMinor(order.total_amount)` (`stripe.ts:1133`) — the amount is
  *derived from an order*, so a plan charge needs a plan-scoped derivation. **[ARCHITECTURE RECOMMENDATION]**
- **[PROVEN]** no second payment authority is created by this decision: there is still exactly one
  `payments` table, one `payment_events` claim store, one `refunds` mechanism, one
  `payment-config.ts` gate. The prior audit's rejection of Option C therefore still holds.
- **[PROVEN] cost:** any change to `payments.order_id` semantics touches **88 occurrences across 13
  backend non-test files**. Every `WHERE order_id = $1` and every join must be re-audited for
  NULL-`order_id` rows before the DDL lands. This is a workstream, not a detail.

### 3.2 Q14 — one canonical Stripe prepaid charge per plan

- **[IMPLEMENTED]** the repo already has the mechanics the decision needs: Checkout Sessions, a derived
  amount, `checkout_requests` idempotency (`:399`), the per-order active-Stripe partial unique index
  (`:462`), `payment_events` claim-once (`:466`, `stripe.ts:1527/:1540`) and webhook-confirmed settlement
  (`stripe.ts:418`).
- **[PROVEN] consequence — the per-cycle pseudo-payment must not survive:** `velrepeat-scheduler.ts:351-352`
  inserts a `payments` row per cycle order with `method='cod', provider='cod'`. `'cod'` is not even a
  member of `PaymentProvider = "STRIPE" | "CARRIER"` (`payment-config.ts:26`) — the row is
  settlement-less by construction. Under "no re-charge per cycle" it becomes a contradiction and the
  prepaid path must not create it. **[BLOCKED]** on Phases 4/8; **not changed by this task**.
- **[PROVEN] consequence — "payment success ≠ all cycles completed" is structurally required, not
  merely desired:** a plan settlement writes the plan's payment state; it has no path to write
  `velrepeat_cycles.status` for cycles 1..N, and the cycle table already exists per `(plan, cycle_number)`
  with an independent status (`:950-965`). The invariant is therefore representable today. **[PROVEN]**
- **[OWNER DECISION]** late-webhook safety reuses the existing order-level rule: money is recorded, no
  resurrection, operator review (`stripe.ts:547`). The plan-level analogue must reuse the same durable
  incident mechanism (`payment_incidents.dedupe_key UNIQUE`, `:480`), never a second handler.
  **[ARCHITECTURE RECOMMENDATION]** the incident dedupe identity must gain plan scope.
- **[PROVEN]** Stripe Subscriptions is not a VelRepeat change — it would be a new provider integration
  with no existing objects, events or attempt mapping in this repository. The decision rules it out.

### 3.3 A/Q1 = B — reserve per cycle

- **[PROVEN]** per-cycle reservation needs **no new reservation authority**: the canonical
  `reserveInventoryStock` (`inventory.ts:54`) and `releaseOrderInventory` (`:209`) already work per
  order, and a cycle produces an order per seller (§8). The decision therefore keeps the single
  inventory authority the whole repository depends on.
- **[PROVEN]** the decision's own condition is satisfied: the only expiry concept that exists is the
  fixed 30-minute window (`payment-reservation.ts:44`), which is meaningful for an order and
  meaningless for a months-long commitment hold. Reserving per cycle means no multi-month hold exists, so
  no new expiration/release model is required. **[PROVEN]** — this is why the decision is coherent
  against the current schema.
- **[PROVEN] asymmetry that must be resolved in Phase 6:** the current scheduler *consumes* variant
  stock directly (`velrepeat-scheduler.ts:328`) but *reserves* non-variant stock (`:341`) — two different
  failure shapes for the same business fact inside one loop. "Use the canonical inventory functions"
  means the variant path must end up on the same canonical reserve/commit/release as the non-variant
  path. **[ARCHITECTURE RECOMMENDATION]**; **not implemented in this task**.
- **[OWNER DECISION]** "if a cycle is short of stock it must enter the defined policy, never a silent
  oversell" — the defined policy is Decision F, whose *monetary* consequence is still open (§12.3). So
  the non-oversell half of the decision is actionable and the money half is not. **[BLOCKED]** on §12.3
  for the completion of the decision, not for its first half.

### 3.4 Q2 — `sold_count` on actual fulfillment-cycle settlement → **conflict check**

The owner instructed: *if this conflicts with existing commerce semantics, STOP and report the conflict
before implementing.* The check was run against source.

**What existing commerce semantics actually are [PROVEN]:**

| Fact | Evidence |
|---|---|
| `sold_count` is incremented in exactly one place | `inventory.ts:141`, inside `commitOrderInventory` (`:115`) |
| That function's documented lifecycle is **payment**-scoped, not delivery-scoped | header: *"reserve (checkout) → commit (payment settled) xor release (order ended)"* (`:77`); the exactly-once gate is *"The caller's status claim (`orders.status → 'paid'` …) is the gate"* (`:73-77`) |
| Its only caller is the payment webhook settlement | `stripe.ts:559`, inside `markPaymentSucceeded` (`:418`), whose order claim is `status IN ('pending','pending_payment')` (`:430-434`) |
| So recognition happens when **money settles**, i.e. **before** the goods are packed, shipped or delivered | same evidence; corroborated by `.ai/context/payment.md` "After successful payment" and the `packing`→`cancelled` absence in `order-fulfillment.ts:89-96` |

**What the owner's Q2 requires:**

- recognize on the settlement of the fulfillment cycle that really happens;
- a cycle/order **not yet fulfilled must not be counted as sold**;
- use `commitOrderInventory()` or a canonical equivalent;
- no new direct `sold_count += quantity` path.

**The conflict, stated exactly:**

Under the repository's existing semantics, the recognition event is *payment settlement of an order*.
Under Q14, a cycle order **never has its own payment settlement** — the money was paid once at plan
level. So the repo-wide recognition event **has no equivalent in the cycle path**, and two readings of
"fulfilled" are available:

| Reading | Recognition moment | Consistency with existing commerce semantics |
|---|---|---|
| **(R1) "fulfilled" = the cycle's order obligation is created and claimed from the paid commitment** | cycle-order claim, in the same relative position as "payment settled" for an ordinary order (money already received, obligation now real) | **Consistent** — preserves "one recognized sale = one canonical increment" |
| **(R2) "fulfilled" = the goods were delivered / the order reached `completed`** | delivery | **Inconsistent** — VelRepeat would recognize revenue strictly later than every other commerce path in this repository, and the `packing`/`shipped`/`delivered` states would need a money side effect they have never had |

The owner's own text does not disambiguate: it names the *forbidden* cases (plan creation, the prepaid
payment, an unfulfilled cycle/order) and then says the canonical commit point "must be defined clearly
in the implementation", which leaves the exact moment open. **[OWNER DECISION REQUIRED]**

**Verdict: STOP. The Q2 policy direction is recorded as `[OWNER DECISION]`; the recognition moment is
`[OWNER DECISION REQUIRED]`.** Two things follow and neither is a workaround:

1. **[PROVEN]** The *existing* direct increment in the live scheduler, `velrepeat-scheduler.ts:344`,
   violates both the "canonical writer only" rule and the structural guard's intent, and nothing ever
   reverses it. The guard test deliberately excludes this file and names the finding
   (`inventory-settlement.test.ts:98-99`). Removing it belongs to Phase 6, not to this task.
2. **[ARCHITECTURE RECOMMENDATION]** whichever reading the owner picks, the commit must be *reached*, not
   re-implemented. Today `commitOrderInventory` is reachable **only** from `markPaymentSucceeded`
   (`stripe.ts:559`). Phase 6 must add a per-cycle commit trigger that calls the same function, with its
   own exactly-once claim (the function's own header says the claim is the caller's job, `inventory.ts:79-81`).
   A new `sold_count +=` statement anywhere in VelRepeat remains forbidden by the decision.
3. **[PROVEN] a structural prerequisite follows from the decision itself:** `commitOrderInventory` settles
   what it reads from `order_items WHERE order_id = $1` (`:118-121`). So a cycle's `sold_count` can only
   be committed if the cycle's order actually carries `order_items` rows — which ties Q2 to Phase 8
   (cycle → order creation) and Phase 6 (commit trigger). This is a dependency, not an ambiguity.

### 3.5 E — price snapshot at purchase

- **[IMPLEMENTED]** storage already exists: `velrepeat_pricing_snapshots` (`:921-936`) and
  `velrepeat_pricing_snapshot_items` (`:937-949`) hold commitment, currency, subtotal, discount
  type/value/amount, total, rule key + rule version, and per-line quantity/unit price/line total — and
  `velrepeat_cycles.pricing_snapshot_id` already references them (`:958`). The decision's storage
  requirement is **satisfied by Phase 1**; what is missing is the writer.
- **[PROVEN] the live re-price is the exact opposite of the decision:**
  `velrepeat-scheduler.ts:245` overwrites `velrepeat_items.unit_price` from the current server price on
  every run. It must become impossible for a prepaid plan. **Not changed in this task.**
- **[PROVEN]** "package composition and quantity must be snapshotted too" is **structurally satisfied by
  the Phase 1 snapshot item table**, which already carries `product_id`, `variant_id`, `quantity`,
  `unit_price`, `line_total` (`:937-949`). The decision needs a writer that copies package composition →
  snapshot items, not new storage. **[ARCHITECTURE RECOMMENDATION]**

### 3.6 G — immutable history + future-cycle versioning

- **[PROVEN]** the current modification path is destructive: `velrepeat-plans.ts:445` deletes **all**
  `velrepeat_items` for the plan and re-inserts, destroying item identity and any link to prior cycles.
  The decision forbids this reaching the prepaid path.
- **[IMPLEMENTED]** the version trace is representable: `velrepeat_cycles.pricing_snapshot_id`
  (`:958`) plus the append-only snapshot tables mean "which version did this cycle use" is a column and
  two joins, once a version identity exists. **[ARCHITECTURE RECOMMENDATION]** the version identity
  itself (a plan-version row vs. version-tagged cycles) is a Phase 9 design choice; the *rules* are now
  fixed by the decision.
- **[PROVEN]** "payment history and financial snapshots must never be rewritten" is enforceable today:
  snapshots are append-only tables with no UPDATE writer anywhere in the backend, and `refunds` are
  webhook-confirmed from provider state rather than written by a status change.

### 3.7 H / Q11 — platform-controlled, data-driven pricing

- **[OWNER DECISION]** ownership is answered: pricing rules are **platform-controlled configuration**.
  A seller may not author a rule that breaks financial invariants. This closes the Q11 ownership half.
- **[PROVEN]** the "no hardcoded business pricing" half is enforceable by a structural test of the same
  shape as `inventory-settlement.test.ts`: assert that no backend file contains the example ladder
  values as pricing policy. **Not added in this task** (Phase 2 / Phase 10 test work).
- **[IMPLEMENTED]** the named rule fields map cleanly onto a data model; `platform_settings` (`:657-662`)
  is a key/value store and the Phase 1 snapshot tables already carry `pricing_rule_key` and
  `pricing_rule_version` (`:931-932`), so a rule's identity and version are already recordable.
  **[ARCHITECTURE RECOMMENDATION]** `platform_settings` is a `TEXT` key/value store with no typing,
  versioning or range constraints — it is **not** sufficient for a rule model that must express min/max
  cycles, numeric discount values, priority, scope, version and an active period. A typed table is
  required; the storage is a Phase 2 design item, not a decision.
- **[OWNER DECISION REQUIRED]** the decision names `priority` as a required field but does **not** state
  whether two applicable rules **stack** (discounts combine) or **one wins** (highest priority).
  Contract §60.2 lists that as a distinct option set (H: stack / one tier wins / seller-defined) and §62
  makes H a **Phase 2 gate**. Stacking semantics change the total the customer is charged, so it is
  customer-visible money. **This is the third Phase 2 blocker** (§11.1). **[OWNER DECISION REQUIRED]**
- **[OWNER DECISION]** the example ladder is explicitly *examples only*, so no numeric tier value is
  fixed by this pass. No tier seed is created here.

### 3.8 Q15 — V1 coexists as legacy

- **[IMPLEMENTED]** the coexistence the decision requires is **already the repository state**: V1
  `vrepeat_packages` (`:680-707`) / `vrepeat_deliveries` (`:710-727`) and their endpoints are untouched,
  and the V2 tables (`:898-967`) sit beside them. Nothing to do for the decision to be true today.
- **[PROVEN]** the "production usage must be checked before deprecation" condition cannot be satisfied
  from here: production is unreadable (Neon quota, migrations 048–050 pending), and the V1 write path
  does exist in code (`velrepeat.ts` 7 writes). **[BLOCKED]** on an owner-side usage query before any
  deprecation is even proposed. No drop, no migration, no deprecation is proposed by this pass.

### 3.9 Q16 — scheduling authority = UTC

- **[PROVEN]** the decision describes what the code already does: `calculateNextRunAt` uses
  `setUTCDate` / `setUTCFullYear` with month day-clamping (`velrepeat-scheduler.ts:38-65`), all schedule
  columns are `TIMESTAMPTZ`, and `velrepeat_plans.timezone` (`:839`) is only echoed
  (`velrepeat-plans.ts:153`) and read by nothing. The decision therefore **confirms and documents**
  rather than changes the scheduling basis.
- **[ARCHITECTURE RECOMMENDATION]** because the column is display-only by decision, Phase 3/7 should
  document it as such so no later phase "helpfully" makes it load-bearing. Making it load-bearing is an
  owner policy change, not an implementation choice.
- **[PROVEN]** DST is currently unreachable as a hazard precisely *because* no local-time math exists;
  the decision is what keeps it unreachable. The DST requirement is satisfied by the current arithmetic
  and must remain satisfied by any future per-cycle generation.

### 3.10 Q17 — multi-seller plan, one payment, per-seller fulfillment

- **[PROVEN]** multi-seller plans are already representable: `velrepeat_items.shop_id` and
  `seller_id` are `NOT NULL` per line (`:853-854`), and the scheduler already creates **one order per
  shop** per run (`velrepeat-scheduler.ts:270`). The decision's "a cycle may split into several orders
  per seller/shop" therefore matches the existing shape.
- **[PROVEN]** "seller trigger must not process arbitrary customer plans" is **already enforced at the
  selection level** by the 7B fix (`seller-orders.ts:784`) — but with a known residual: once matched, the
  plan is processed as a whole, so a seller trigger can still cause *other* sellers' lines to be
  processed. **[ARCHITECTURE RECOMMENDATION]** under the decision, a seller trigger may only generate
  the calling seller's own order for a cycle; the central scheduler (`server.ts:519`) remains the only
  component allowed to advance the whole cycle. Phase 7 work; **not changed in this task**.
- **[PROVEN] the decision's money clause cannot be implemented from today's data, and this is a hard
  finding:** "one Repeat Plan may span multiple sellers" + "plan-level payment remains ONE payment" +
  "sellers may not change plan-level financial truth" requires the platform to be able to *attribute*
  money to sellers for a payment that is not order-scoped. But:
  - `commissions` (`:520-526`) is `order_id NOT NULL REFERENCES orders(id)` — it **cannot** record a
    plan-level payment;
  - `settlements` (`:528-534`) has no payment, plan or cycle reference at all;
  - **neither table has any backend writer** (verified: 0 non-test matches for `INSERT INTO commissions`,
    `FROM commissions`, `INTO settlements`, `FROM settlements`);
  - **there is no Stripe Connect or any payout rail** (`.ai/context/payment.md:239-250`) — the customer is
    charged on the platform's account and seller amounts are internal accounting only.
  So per-seller money attribution for a prepaid plan is **structurally unrepresentable and
  un-payable** in this repository today. This is exactly the task's "multi-seller money attribution
  conflict" stop condition. **[OWNER DECISION REQUIRED]** — recorded in §12.4; it does not block
  Phase 2, but it blocks Phase 7/9 completion and any refund split.

---

## 4. Remaining unresolved items

### 4.1 The one conflict found against existing commerce semantics — Q2's recognition moment

Reported in full in §3.4. Summary of the stop:

| Item | Status | Tag |
|---|---|---|
| Q2 policy direction (no increment at plan creation, none at the prepaid payment, no double count, no unfulfilled counting, canonical writer only) | **recorded and binding** | **[OWNER DECISION]** |
| Q2 recognition *moment* — "fulfilled" = the cycle's order obligation is claimed (R1), or the goods are delivered (R2) | **unanswered; conflicts with the repository's payment-settlement recognition semantics** | **[OWNER DECISION REQUIRED]** |
| Removal of the existing direct increment `velrepeat-scheduler.ts:344` | Phase 6 work, not this task | **[BLOCKED]** |

**Why it is a conflict and not a preference:** every other commerce path in this repository recognizes a
sale when an order's money settles (`stripe.ts:559`, gated by `orders.status → 'paid'`), which is before
packing. If VelRepeat recognized at delivery, `sold_count` would mean two different things in one schema
and the `inventory-settlement` guard's single-writer contract would describe two different business
moments. The owner asked for exactly this check before implementation, so it is reported here rather
than resolved here.

### 4.2 Everything still unanswered after this pass

| # | Item | Blocks | Why it cannot be inferred | Tag |
|---|---|---|---|---|
| 1 | **Pricing-rule stacking semantics** — do a commitment tier and a quantity/other tier combine, or does the highest `priority` win? | **Phase 2** (and every future prepaid total) | It changes the amount the customer is charged. The owner answered H/Q11's *ownership* half and named `priority` as a field, but never said whether rules stack. Contract §60.2 lists stacking as a separate option set and §62 makes H a Phase 2 gate. | **[OWNER DECISION REQUIRED]** |
| 2 | **Rounding / currency policy** for the cycle price and the total prepaid price | **Phase 2** | All money columns are `NUMERIC(12,2)` (`:925-930`, `:944-946`) and Stripe amounts are minor units (`toMinor(order.total_amount)`, `stripe.ts:1133`). Nothing in the repository states *where* rounding happens or *how* a repeated division by commitment cycles rounds. This is customer-visible money and it is not an implementation detail. | **[OWNER DECISION REQUIRED]** |
| 3 | **Package-authoring ownership** — who may author a `velrepeat_packages` row and its composition | **Phase 2** | `velrepeat_packages` (`:898-906`) has **no owner/seller column and no price column**, so the schema does not even record who may write it. The prior audit raised it; the owner's decisions did not answer it. A package's composition feeds the commitment total, so it is package-pricing input. | **[OWNER DECISION REQUIRED]** |
| 4 | **Seller eligibility for repeat commerce** — which sellers may appear in a plan/package at all | Phase 3/7 (see §11.4) | `velrepeat_items.seller_id` is `NOT NULL` (`:854`) and any approved seller is currently eligible. Contract §62 assigns seller surfaces to Phase 7, not Phase 2 — **unless** packages turn out to be seller-scoped, which is item 3. | **[OWNER DECISION REQUIRED]** |
| 5 | **Exact refund formula** for future unfulfilled cycles (Decision B) | Phase 9 | §12.1 | **[OWNER FORMULA REQUIRED]** |
| 6 | **Skip monetary consequence** — postpone to end of commitment, or consumed cycle (Decision C) | Phase 9 | §12.2. The owner explicitly wrote *"ต้องกำหนดว่าจะเลื่อนไปท้าย commitment หรือถือเป็น consumed cycle"* as a thing still to be decided, and then said to mark `OWNER FORMULA REQUIRED` if the monetary consequence is unclear. | **[OWNER FORMULA REQUIRED]** |
| 7 | **Out-of-stock monetary consequence** (Decision F) | Phase 9 | §12.3 | **[OWNER FORMULA REQUIRED]** |
| 8 | **Multi-seller money attribution for a plan-level payment** | Phase 7/9 | §3.10 / §12.4. `commissions` is order-scoped (`NOT NULL`), `settlements` has no payment reference, neither has a writer, and there is no payout rail at all. | **[OWNER DECISION REQUIRED]** |
| 9 | **`velrepeat_runs ↔ velrepeat_cycles` relation design** | Phase 5 (before any generator code) | The owner accepted the *direction*; the relation itself is a design that must land before the scheduler is touched. §9. | **[ARCHITECTURE RECOMMENDATION]** — not blocked, but owed before Phase 5 |
| 10 | **Plan-level reservation-window mapping** (approved decision 4A says "where applicable") | Phase 4 | 4A was approved as a principle; the plan-level analogue of `orders.payment_expires_at` (`:378`) does not exist. | **[OWNER DECISION REQUIRED]** |
| 11 | **Plan status vocabulary extension** (`pending_payment`) | Phase 3/4 | The owner's plan state machine includes `pending_payment`; `velrepeat_plans.status` (`:827`) does not. §5.1 documents the required change without implementing it. | **[OWNER DECISION REQUIRED]** (shape) |
| 12 | **Cycle status vocabulary extension** (`due`, `reserved`, `fulfilled`) | Phase 5 | The owner's cycle machine uses states the CHECK (`:954`) does not contain. §5.3 documents the required change without implementing it. | **[OWNER DECISION REQUIRED]** (shape) |

**Nothing in this list was guessed, defaulted, or worked around.** Items 1–3 are what hold Phase 2.

---

## 5. State-machine contract

The owner's requirement: define Plan, Payment, Cycle, Order and Fulfillment **separately**; keep the
canonical Order lifecycle; do not infer Fulfillment from Plan or Payment; do not create a duplicate state
machine; **if the existing states are insufficient, document the required change — do not guess and do not
implement it in this task.** This section does exactly that: it maps the owner's conceptual machines onto
the vocabulary that actually exists, and names the gaps.

**Binding non-equivalences (unchanged, still true under the new decisions) [PROVEN]:**
`PAID PLAN ≠ FULFILLED PLAN` · `PAID CYCLE ≠ DELIVERED ORDER` · `PAID CYCLE ≠ FULFILLED CYCLE`.

### 5.1 Plan state machine

Owner's conceptual machine **[OWNER DECISION]**: `draft → pending_payment → active → paused → completed / cancelled`.

| Owner's state | Exists in `velrepeat_plans.status` (`:827`)? | Evidence | Tag |
|---|---|---|---|
| `draft` | **yes** | `:827` first value; no writer produces it today | **[IMPLEMENTED]** (vocabulary) |
| `pending_payment` | **NO** | not among the 10 CHECK values; the *order*-level equivalent exists (`orders_status_check :1031-1033` has `pending_payment`) | **[OWNER DECISION REQUIRED]** (shape) |
| `active` | **yes** | `:827`; scheduler claim filters on it (`velrepeat-scheduler.ts:113-120`), `idx_velrepeat_plans_due` filters `status = 'active'` (`:847`) | **[IMPLEMENTED]** |
| `paused` | **yes** | `:827`; writer `velrepeat-plans.ts:508` + `PLAN_PAUSED` event `:512` | **[IMPLEMENTED]** |
| `completed` | **yes** | `:827`; **no writer** found | **[IMPLEMENTED]** (vocabulary) |
| `cancelled` | **yes** | `:827`; writer `velrepeat-plans.ts:531` + `PLAN_CANCELLED` `:535` | **[IMPLEMENTED]** |

**Also present but not in the owner's machine** **[PROVEN]**: `processing`, `payment_failed`,
`out_of_stock`, `item_unavailable`, `price_changed`. These are real V1 states with real writers
(`velrepeat-plans.ts:508/531`, scheduler failure paths). They are **not** removed by this pass; the
question of whether the prepaid model keeps them, maps them, or drops them is a Phase 3 design item, not
decided here. **[ARCHITECTURE RECOMMENDATION]** keep them as failure/exit states orthogonal to the
owner's happy path, so the failure vocabulary is not lost.

**Required change (documented, NOT implemented):** the plan status CHECK must gain `pending_payment`
before a plan can sit between `draft` and `active` awaiting its one prepaid charge. Per the owner's
instruction this is recorded as a required change only. **[OWNER DECISION REQUIRED]**

### 5.2 Pause (Decision D) — future cycles only

| Rule | Tag | Where it is provable today |
|---|---|---|
| never stop a cycle whose fulfillment has started | **[OWNER DECISION]** | Structurally supported: `FULFILLMENT_TRANSITIONS.packing = ["shipped"]` (`order-fulfillment.ts:92`) has **no** edge to `cancelled`, so an order past `confirmed` cannot be cancelled by a status change. **[PROVEN]** |
| pause does not change historical cycles | **[OWNER DECISION]** | `velrepeat_cycles` rows are keyed `(plan, cycle_number)` (`:962`) and are expected immutable; no UPDATE writer exists. **[PROVEN]** |
| store a pause event/audit | **[OWNER DECISION]** | `velrepeat_events` exists (`:887-897`) and `PLAN_PAUSED` is already written (`velrepeat-plans.ts:512`). **[IMPLEMENTED]** |
| scheduler must not create future fulfillment while paused | **[OWNER DECISION]** | The scheduler's claim requires `status = 'active'` (`velrepeat-scheduler.ts:113-120`), and `idx_velrepeat_plans_due` is `WHERE status = 'active'` (`:847`). A paused plan is therefore not picked up. **[IMPLEMENTED]** — already true |
| resume must not create duplicate cycles; schedule deterministic + idempotent | **[OWNER DECISION]** | `velrepeat_cycles UNIQUE (plan_id, cycle_number)` (`:962`) and `velrepeat_runs UNIQUE (plan_id, scheduled_for)` (`:882`) are the two existing uniqueness guarantees. **[PROVEN]** |

**Live gap that the decision must close in Phase 9 [PROVEN]:** the current resume is
`next_run_at = GREATEST(next_run_at, NOW())` (`velrepeat-plans.ts:520`) — a **silent one-interval
deferral with no commitment accounting**. A prepaid plan is paid for a fixed number of cycles
(`commitment_cycles`, `:830`), so a silent deferral silently reduces what the customer receives for a
price already paid. The decision's "future cycles only" + "deterministic and idempotent" rules make that
behavior unacceptable, but the *replacement* (extend the horizon vs. consume the cycle) is money and is
**not decided by the decision as written** — Decision D chose *when* pause applies, not what a paused
cycle costs. Recorded in §12.5. **[OWNER FORMULA REQUIRED]**

### 5.3 Cycle state machine

Owner's conceptual machine **[OWNER DECISION]**: `scheduled → due → reserved → fulfilled`, plus
failure / skip / cancel per policy.

| Owner's state | Exists in `velrepeat_cycles.status` (`:954`)? | Nearest existing | Tag |
|---|---|---|---|
| `scheduled` | **yes** (default) | — | **[IMPLEMENTED]** |
| `due` | **NO** | `processing` is the closest existing value, and it is the V1 *run*-time state | **[OWNER DECISION REQUIRED]** (shape) |
| `reserved` | **NO** | — (no cycle-level reservation concept exists; A/Q1=B reserves per cycle against the *order*) | **[OWNER DECISION REQUIRED]** (shape) |
| `fulfilled` | **NO** | `completed` (`:954`) | **[OWNER DECISION REQUIRED]** (shape — `fulfilled` vs `completed` must not silently become two names for one state) |
| failure | **yes** | `out_of_stock`, `item_unavailable` (`:954`); plan/run have the same pair (`:827`, `:873`) | **[IMPLEMENTED]** |
| skip | **yes** | `skipped` (`:954`) — **vocabulary only; no writer exists** (`grep -c skip backend/routes/velrepeat-plans.ts` → 0) | **[IMPLEMENTED]** (vocabulary) / **[BLOCKED]** (behavior) |
| cancel | **yes** | `cancelled` (`:954`) | **[IMPLEMENTED]** (vocabulary) |

**Required change (documented, NOT implemented):** the cycle status CHECK must express the owner's
machine. Whether that means renaming, adding, or mapping is a Phase 5 design choice; the *state names the
owner requires* are fixed. **[ARCHITECTURE RECOMMENDATION]** keep `completed` and treat `fulfilled` as its
domain name rather than adding a synonym, because a second word for one state is precisely the "no
duplicate state machine without reason" hazard the owner named. **Not implemented here.**

**Skip rules (Decision C) mapped to source [OWNER DECISION] → [PROVEN] feasibility:**

| Rule | Structurally guaranteed? | Evidence |
|---|---|---|
| never skip a packing cycle | **yes, today** | `packing` has no edge to `cancelled` (`order-fulfillment.ts:92`) |
| never skip a shipped cycle | **yes, today** | `shipped → [delivered]` only (`:94`); `cancelled` is terminal (`:98`) |
| never rewrite a historical financial record | **yes, today** | snapshot tables have no UPDATE writer; refunds recompute from provider rows |
| skip writes an audit/event | **yes, available today** | `velrepeat_events` (`:887-897`) + `PLAN_PAUSED`-style writes already exist (`velrepeat-plans.ts:512`) |
| skip is not a successful delivery | requires the state change above | `skipped` ≠ `completed` in `:954` — the CHECK already keeps them distinct |
| skipped cycle's inventory must not be committed as sold | **yes, by construction** | commit is a caller-gated function (`inventory.ts:79-81`); a skipped cycle simply never calls it, and `releaseOrderInventory` restores the reservation (`:275+`) |
| postpone-to-end vs consumed cycle | **money → open** | §12.2 |

### 5.4 Order state machine — unchanged, canonical

**[OWNER DECISION]** the Order keeps the canonical commerce lifecycle
`pending → confirmed → packing → shipped → delivered → completed`, and cancellation happens before the
fulfillment boundary.

| Fact | Evidence | Tag |
|---|---|---|
| The lifecycle is exactly that | `orders_status_check :1031-1033` = `pending, confirmed, packing, shipped, delivered, completed, cancelled, pending_payment, paid, payment_failed, refunded, expired` | **[PROVEN]** |
| The transitions are exactly that | `FULFILLMENT_TRANSITIONS` (`order-fulfillment.ts:89-96`) — `pending → confirmed`, `confirmed → packing`, `packing → shipped`, `shipped → delivered`, `delivered → completed`; terminal `completed`/`cancelled` have no outgoing edge | **[IMPLEMENTED]** |
| Cancellation is before the fulfillment boundary | `pending → [confirmed, cancelled]`, `confirmed → [packing, cancelled]`, **`packing → [shipped]` only** — the comment at `order-fulfillment.ts:86` states the reason: once fulfilment has started the order must go out | **[PROVEN]** |
| No duplicate state machine may be created | the decision forbids it; the existing one is canonical | **[OWNER DECISION]** |

**[PROVEN] the four non-fulfillment order statuses** (`pending_payment`, `paid`, `payment_failed`,
`refunded`, `expired`) belong to the **order↔payment** axis, not to fulfillment, and are documented as
such in `.ai/context/payment.md:252-274`. A cycle order under prepaid belongs to the fulfillment axis and
must **not** be pushed through `pending_payment`/`paid`, because it has no payment of its own (Q14). That
is a Phase 8 design constraint, recorded here so the separation is not blurred later.

### 5.5 Modification (Decision G) — history immutable, future versioned

| Rule | Tag | Structural support |
|---|---|---|
| never modify a historical cycle | **[OWNER DECISION]** | `velrepeat_cycles` has no UPDATE writer; `(plan, cycle_number)` is unique (`:962`) | **[PROVEN]** |
| never modify an order that already happened | **[OWNER DECISION]** | canonical order transitions are one-way with terminal states (`order-fulfillment.ts:96-98`) | **[PROVEN]** |
| future changes create a new version/snapshot | **[OWNER DECISION]** | `velrepeat_cycles.pricing_snapshot_id` (`:958`) + append-only snapshot tables | **[IMPLEMENTED]** (storage) / **[BLOCKED]** (writer) |
| each cycle traces which version it used | **[OWNER DECISION]** | same column; a *version identity* must exist first | **[ARCHITECTURE RECOMMENDATION]** |
| payment history and financial snapshots never rewritten | **[OWNER DECISION]** | `payments.paid_at`/`refunded_amount` are written only by webhook handlers; snapshots have no UPDATE writer | **[PROVEN]** |

**[PROVEN] live gap:** the current `PATCH` deletes and re-inserts all `velrepeat_items`
(`velrepeat-plans.ts:445`), which destroys the very composition the snapshot is supposed to preserve.
Phase 9 must replace it. **Not changed in this task.**

### 5.6 Timezone (Decision Q16) — no state machine, but a scheduling rule

**[OWNER DECISION]** scheduling authority = UTC; TIMESTAMPTZ canonical; `velrepeat_plans.timezone` is
display/user preference. **[PROVEN]** the code already computes schedule instants in UTC
(`velrepeat-scheduler.ts:38-65`, `setUTCDate`/`setUTCFullYear` with month day-clamping) and the column is
read by nothing but the echo at `velrepeat-plans.ts:153`. **[PROVEN]** because no local-time arithmetic
exists, DST can currently neither duplicate nor skip a cycle — and the decision is what keeps that true.

### 5.7 Fulfillment — not inferred from Plan or Payment

**[OWNER DECISION]** Fulfillment must not be inferred from Plan or Payment alone.

| Rule | Status | Tag |
|---|---|---|
| Fulfillment state is the order's own | already true: `FULFILLMENT_STATUSES` / `FULFILLMENT_TRANSITIONS` (`order-fulfillment.ts:69-97`) are order-scoped | **[IMPLEMENTED]** |
| No duplicate fulfillment machine | a cycle must **not** grow its own `packing/shipped` vocabulary; it points at orders (`:966-967`) | **[OWNER DECISION]** — honored by design in §5.3/§5.4 |
| Payment success must not mark cycles fulfilled (Q14) | representable: a plan settlement has no write path to `velrepeat_cycles.status`; and `fulfillment` is order-scoped, not plan-scoped | **[PROVEN]** |

**[PROVEN] the one place where a gap exists and must be designed, not guessed:** the confirmation gate
`paymentAllowsConfirmation` (`order-fulfillment.ts:218-235`) allows confirmation only if a `paid` payment
row exists **in that order's history**, or COD while the rail is enabled. Under Q13/Q14 a cycle order has
**no payment row at all** — so this gate would refuse to confirm *every* cycle order, and no cycle could
ever be fulfilled. Q14 states each cycle is a fulfillment obligation of the prepaid plan, so the gate must
be able to see the plan's settled commitment. **[ARCHITECTURE RECOMMENDATION]** Phase 8 extends this gate
to consult the plan's paid payment; it must not be bypassed, loosened, or replaced by a second gate. The
COD branch stays closed (`isCodEnabled()` defaults off, `payment-config.ts:313`). **Not implemented in
this task.**

### 5.8 Payment state machine — unchanged, canonical

Owner's conceptual machine **[OWNER DECISION]**: `pending → processing / requires_action → paid`, or the
canonical states the repository actually supports. The repository's canonical set is used.

| Fact | Evidence | Tag |
|---|---|---|
| Canonical payment states | `pending`, `requires_action`, `processing`, `paid`, `failed`, `cancelled`, plus `refunded_amount` / `refund_status` (`.ai/context/payment.md:139`) | **[PROVEN]** |
| Settled = `paid` or `processing` | `PAYMENT_SETTLED_STATUSES = ["paid","processing"]` (`order-lock.ts:83`) | **[IMPLEMENTED]** |
| `PAID_PAYMENT_STATUSES = ["paid"]` is the confirmation proof | `order-fulfillment.ts:189`, used at `:225` | **[IMPLEMENTED]** |
| `payments.status` has **no CHECK constraint** | `:446` — the vocabulary is enforced in code, not DDL | **[PROVEN]** |
| The owner's conceptual machine is compatible | `pending → requires_action`/`processing → paid` uses only existing values | **[PROVEN]** — no vocabulary change required |

**[PROVEN]** the payment machine needs **no** new state for prepaid. It needs a new *parent*, which is
Q13 = B (§3.1) — a data-model change, not a state-machine change.

---

## 6. Payment flow

### 6.1 The one committed path (owner's decision, traced end to end)

```
Customer  ──▶  Repeat Plan (velrepeat_plans)
                   │  ONE prepaid commitment, priced once (E: snapshot at purchase)
                   ▼
             ONE payment  (payments row, parent = the PLAN per Q13=B)
                   │  amount = commitment price after pricing rules (Q14)
                   │  Checkout Session; amount derived server-side, never accepted from a client
                   ▼
             webhook  (payment_events, event_id UNIQUE → claim-once idempotency)
                   │
                   ├── duplicate / redelivery ─▶ acknowledged, nothing re-runs
                   ├── late success on a non-payable state ─▶ money recorded + durable
                   │    payment_incidents row (dedupe_key UNIQUE) + operator review  [NO fulfillment]
                   └── success ─▶ plan's payment = paid.  That is ALL it means.
                             Every cycle stays `scheduled`. No order is created.
                             No cycle is completed. No stock is committed. No sold_count moves.
                   ▼
             Delivery Cycles 1..N  ── each its own fulfillment obligation
                   │  (per cycle: reserve → order(s) → commit → ship)  — §7
                   ▼
             Orders (one or more per cycle, per seller)  ── order-level money NEVER charged
```

### 6.2 Rule-by-rule proof against source

| Owner's rule | Proven satisfied by | Tag |
|---|---|---|
| one payment = the whole plan commitment | requires the Q13=B linkage; today impossible because `payments.order_id NOT NULL` (`:442`) | **[BLOCKED]** on Phase 4 DDL |
| payment amount = commitment price after pricing rules | snapshot tables already hold subtotal/discount/total (`:925-930`); the derivation must become plan-scoped instead of `toMinor(order.total_amount)` (`stripe.ts:1133`) | **[ARCHITECTURE RECOMMENDATION]** |
| not a Stripe Subscription | no Connect/ subscription objects exist in this repository (`.ai/context/payment.md:239-250`) | **[PROVEN]** |
| no re-charge per cycle | the current per-cycle `'cod'` row (`velrepeat-scheduler.ts:351-352`) is the thing that must not survive | **[BLOCKED]** on Phase 4/8 |
| webhook idempotent | `payment_events.event_id UNIQUE` (`:466`) + `ON CONFLICT DO NOTHING` (`stripe.ts:1527/:1540`) + re-arm of a `failed` event | **[IMPLEMENTED]** |
| late webhook must not create wrong fulfillment | order-level rule already: claim requires a pre-payment status, money recorded, `manual review/refund required` logged (`stripe.ts:547`); the plan-level analogue reuses `payment_incidents` (`:478-495`) | **[IMPLEMENTED]** (mechanism) + **[ARCHITECTURE RECOMMENDATION]** (plan linkage) |
| payment success ≠ all cycles completed | a plan settlement has no write path to `velrepeat_cycles.status`; cycle rows are per `(plan, cycle_number)` (`:962`) | **[PROVEN]** |
| no duplicate payment authority | one `payments`, one `payment_events`, one `refunds`, one `payment-config.ts` gate | **[PROVEN]** |
| Cycle 1's order must not hold the plan money | guaranteed by Q13=B itself; also note Option A would have forced it (`orders.total_amount` derivation, `stripe.ts:1133`) | **[PROVEN]** |
| `orders.total_amount` must not be faked | same; a cycle order's `total_amount` stays the value of that cycle's goods | **[PROVEN]** |

### 6.3 Trace requirement: `Customer → Repeat Plan → Payment → Delivery Cycles → Orders`

| Hop | Available today? | Evidence | Tag |
|---|---|---|---|
| Customer → Plan | **yes** | `velrepeat_plans.user_id` (`:825`) | **[IMPLEMENTED]** |
| Plan → Payment | **no** | no `payments.velrepeat_plan_id`; `payments.order_id` is `NOT NULL` (`:442`) | **[BLOCKED]** — Q13=B DDL |
| Payment → Delivery Cycles | **no** | no relation from a payment to cycles; `velrepeat_cycles.plan_id` (`:952`) only | **[BLOCKED]** — Q13=B DDL |
| Cycle → Orders | **yes** | `orders.velrepeat_cycle_id` + FK (`:381`, `:966`) + partial index (`:967`) | **[IMPLEMENTED]** |
| Order → Plan (indirect) | **yes, via cycle** | `velrepeat_cycles.plan_id` (`:952`) | **[IMPLEMENTED]** |
| Plan → Order (direct, legacy) | **yes, but first-order-only** | `orders.velrepeat_run_id` (`:380`) → `velrepeat_runs.order_id` (`:874`) is the *first* order; the rest live in `metadata.orderIds` | **[PROVEN] gap** |

**[ARCHITECTURE RECOMMENDATION]** the trace becomes complete exactly when Q13=B's linkage lands; the
legacy `velrepeat_runs.order_id` first-order-only shape is a Phase 5/8 cleanup and must not be extended.

### 6.4 Refund (Decision B) — policy decided, formula not derivable

Owner's policy **[OWNER DECISION]**: refund only the future unfulfilled cycles, per the canonical refund
policy; a fulfilled cycle is not a future cycle; never edit a payment amount; use canonical
`refunds`/Stripe; immutable financial calculation; idempotent; no over-refund; no auto-refund from an
ambiguous webhook; back-auditable. **If the repository lacks the data to fix the exact monetary formula →
`OWNER FORMULA REQUIRED` and STOP Phase 9.**

**The repository check the owner asked for, performed:**

| Question | Answer from source | Tag |
|---|---|---|
| Is there canonical refund machinery to reuse? | **yes** — `refunds` (`:502-518`), webhook-confirmed, `provider_refund_id` unique (`:517`), `refunded_amount` recomputed from succeeded rows, `refundableMinorFor` never negative (`stripe.ts:320`) | **[IMPLEMENTED]** |
| Can a refund row name a **plan**? | **NO** — `refunds.order_id UUID NOT NULL REFERENCES orders(id)` (`:504`) | **[BLOCKED]** — needs the Q13=B linkage |
| Is there a per-cycle monetary value to refund? | **NO** — `velrepeat_pricing_snapshots` (`:921-936`) stores `subtotal_amount`, `discount_type`, `discount_value`, `discount_amount`, `total_amount`, and `commitment_cycles`; there is **no per-cycle amount column and no per-cycle line allocation** | **[OWNER FORMULA REQUIRED]** |
| Can a discount be allocated back to cycles? | **NO** — `discount_type` + `discount_value` + `discount_amount` are stored, but no allocation basis is stored | **[OWNER FORMULA REQUIRED]** |
| Can money be split per seller for a multi-seller plan? | **NO** — `commissions.order_id NOT NULL` (`:521`); `settlements` has no plan/cycle/payment reference (`:528-534`); neither has any backend writer; no payout rail exists (`.ai/context/payment.md:239-250`) | **[OWNER DECISION REQUIRED]** — §12.4 |
| Is the calculation immutable and back-auditable? | **yes, structurally** — the snapshot tables are append-only with no UPDATE writer, and the refund total is recomputed from provider rows rather than stored by a status change | **[IMPLEMENTED]** |
| Is over-refund prevented? | **yes** — `refundableMinorFor` (never negative) and rejection before Stripe is called (`.ai/context/payment.md:141-146`) | **[IMPLEMENTED]** |
| Is auto-refund from an ambiguous webhook forbidden? | **yes** — the late-payment path deliberately does not refund (`stripe.ts:547`: "manual review/refund required", "No refund is invented in code — an operator decides") | **[IMPLEMENTED]** |

**Conclusion: `OWNER FORMULA REQUIRED` for the refund formula; Phase 9 is STOPPED.** Details in §12.1.

## 7. Inventory flow

### 7.1 The committed model (A/Q1 = B) traced against source

```
Per delivery cycle, at cycle time:
  1. CANONICAL RESERVE   reserveInventoryStock()            (inventory.ts:54)
     - non-variant:  UPDATE inventory SET reserved = reserved + q
                    WHERE quantity - reserved >= q          (inventory.ts:60-63)
     - throws INSUFFICIENT_STOCK when the guard fails        (inventory.ts:65)
     - variant:      must use the same canonical path        (see 7.2)
  2. ORDER(S) CREATED    one order per seller/shop in the cycle (§8)
  3. CANONICAL COMMIT    commitOrderInventory()              (inventory.ts:115)
     - consumes the hold:  quantity -= q, reserved -= q      (inventory.ts:128-132)
     - sold_count += q                                      (inventory.ts:141)
  4. NO PER-CYCLE CHARGE  the cycle order has no payment of its own (Q14)
  5. FAILURE / CANCEL    releaseOrderInventory()             (inventory.ts:209)
     - atomic claim: inventory_released = FALSE
                    AND status = ANY(RELEASABLE_STATUSES)
                    AND NOT EXISTS settled payment           (inventory.ts:221-234)
```

### 7.2 Rule-by-rule proof

| Owner's rule | Proven satisfied by | Tag |
|---|---|---|
| do not reserve the whole commitment up front | per-cycle reservation by design; the repository has **no** plan-level reservation record, and A/Q1=B does not create one | **[PROVEN]** |
| check and reserve that cycle's stock before the cycle | the canonical reserve guard `quantity - reserved >= q` **is** the check; failing it throws `INSUFFICIENT_STOCK` | **[IMPLEMENTED]** |
| use the canonical inventory functions | `reserveInventoryStock` / `commitOrderInventory` / `releaseOrderInventory` are the only three writers | **[IMPLEMENTED]** |
| no new inventory authority | nothing in the decision requires a new table or function; Phase 1's package tables deliberately have **no stock column** (`:898-919`) | **[PROVEN]** |
| reservation/release tied to the real order/cycle | the canonical functions are keyed by `order_id` (`inventory.ts:120`, `:214`, `:262`); a cycle produces real orders (§8) | **[IMPLEMENTED]** |
| never hold stock for months without a canonical expiration/release model | a per-cycle hold lives as long as one cycle order; the only expiration concept (30 min, `payment-reservation.ts:44`) is not stretched, and **no months-long hold exists at all** — so the prohibition cannot be violated by the chosen model | **[PROVEN]** |
| a short cycle enters the policy, never a silent oversell | non-oversell is structurally guaranteed (the guarded UPDATE never oversells); the *policy* entered on failure is Decision F, whose monetary half is open | **[PROVEN]** for non-oversell / **[OWNER FORMULA REQUIRED]** for the money (§12.3) |
| package carries no stock | `velrepeat_packages` / `velrepeat_package_items` have no stock column (`:898-919`), asserted by `backend/tests/velrepeat-v2-domain-schema.test.ts` | **[IMPLEMENTED]** |

### 7.3 The variant / non-variant asymmetry that must be resolved

**[PROVEN]** the live scheduler does two different things for the same business fact inside one loop:

| Line | Path | Mutation shape |
|---|---|---|
| `velrepeat-scheduler.ts:328` | variant | `UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1` — a **direct consume** |
| `velrepeat-scheduler.ts:341` | non-variant | `reserveInventoryStock(client, item.product_id, item.quantity)` — a **canonical reserve** |

`[OWNER DECISION]` "use the canonical inventory functions" + "no new inventory authority" ⇒ both lines
must converge on the same canonical reserve/commit/release. **[ARCHITECTURE RECOMMENDATION]** Phase 6
resolves this by routing the variant line through the same reserve path (a variant has no `inventory`
columns of its own — `product_variants.stock` *is* its availability, per the `commitOrderInventory` header
`inventory.ts:99-107` — so the canonical mapping is: reserve = guarded `stock -= q`; commit = no-op;
release = guarded `stock += q`; `sold_count` still on the parent product). **Not implemented in this task.**

### 7.4 `sold_count` under the new model

**Owner's rule [OWNER DECISION]:** never at plan creation; never for all cycles at the prepaid payment; no
double count; not for an unfulfilled cycle/order; canonical commit point defined in the implementation via
`commitOrderInventory()` or equivalent; **no new direct `sold_count += quantity` path in VelRepeat.**

| Fact | Evidence | Tag |
|---|---|---|
| The canonical increment exists in exactly one statement | `inventory.ts:141` | **[PROVEN]** |
| It is reachable from exactly one caller | `stripe.ts:559` (only non-definition match) | **[PROVEN]** |
| That caller is the *payment* settlement | `markPaymentSucceeded` (`stripe.ts:418`), whose order claim is `status IN ('pending','pending_payment')` (`:430-434`) | **[PROVEN]** |
| A cycle order will never pass through that path | Q14: one payment for the whole plan, no per-cycle charge | **[PROVEN]** consequence |
| ⇒ the canonical writer is **unreachable** for a prepaid cycle today | the only call site requires a per-order payment settlement | **[PROVEN]** |
| An existing direct increment violates the rule | `velrepeat-scheduler.ts:344` `UPDATE products SET sold_count = sold_count + $1`, at cycle creation, never reversed | **[PROVEN]** |
| The structural guard deliberately excludes the scheduler | `inventory-settlement.test.ts:98-99` names it "a known, separate finding (audit §42 MEDIUM #10)" | **[PROVEN]** |

**Consequences, stated without inventing behavior:**

1. **[OWNER DECISION REQUIRED]** the recognition *moment* is unanswered and conflicts with the repository's
   payment-settlement semantics → **STOP**, reported in §3.4 and §4.1. Phase 6 must not start.
2. **[ARCHITECTURE RECOMMENDATION]** Phase 6 adds a **per-cycle** commit trigger that *calls*
   `commitOrderInventory()`; it does not add a `sold_count` statement. The function's own header is
   explicit that the exactly-once claim belongs to the caller (`inventory.ts:79-81`), so the new caller
   must take an equivalent atomic claim — reuse the pattern at `:221-234`, do not re-implement it.
3. **[PROVEN] structural prerequisite:** `commitOrderInventory` settles what it reads from `order_items
   WHERE order_id = $1` (`:118-121`), so the cycle's order must carry `order_items` rows. That ties Q2 to
   Phase 8 (cycle → order) — a dependency, not an ambiguity.
4. **[PROVEN] existing violation:** `velrepeat-scheduler.ts:344` is Phase 6's removal, not this task's.

### 7.5 The release-guard consequence nobody has recorded yet (new finding)

**[PROVEN]** the release guard's most important safety property is *"a settled payment outranks a
cancellation"*: the claim requires `NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND
p.status = ANY($3::text[]))` (`inventory.ts:227-231`), and the code comment explains the reason — those
units were already **COMMITTED**, so restoring them "would be a SECOND terminal transition on one
reservation (COMMIT + RELEASE) and would hand sold stock back to the shelf" (`:245-260`).

**[PROVEN]** under Q14, a cycle order has **no `payments` row of its own**, so that `NOT EXISTS`
subquery is trivially satisfied for every cycle order — the guard's protection disappears exactly where
prepaid money now sits.

**Consequence [ARCHITECTURE RECOMMENDATION] — required, not optional:** for a cycle order, the
commit-vs-release decision must be governed by the **cycle's** own state (e.g. the cycle's atomic status
claim from `reserved` to its committed state), because the order-payment leg no longer carries the
information. The invariant to preserve is unchanged and must be test-provable: **exactly one terminal
outcome per reservation** (commit **xor** release, never both, never neither) — contract §51(1), and the
existing proof is `inventory.ts:221-234` + `tests/inventory-settlement.test.ts`. This is a Phase 6
requirement discovered in this pass; it is **not** a reason to change the owner's decision, and **no
inventory code was touched here**.

### 7.6 Out-of-stock cycle (Decision F) — the non-oversell half is settled, the money half is not

**[OWNER DECISION]** no oversell, no auto-substitute: do not commit inventory, do not increment
`sold_count`, do not create a false success, create a durable cycle failure state/event, notify
system/operator/customer, never auto-substitute, never auto-refund without a policy, never silently skip.

| Rule | Structurally available today? | Evidence | Tag |
|---|---|---|---|
| no oversell | **yes** | the guarded reserve UPDATE cannot exceed availability (`inventory.ts:60-63`) | **[PROVEN]** |
| do not commit inventory | **yes, by omission** | commit is a caller-gated function; a failed cycle never calls it | **[PROVEN]** |
| do not increment `sold_count` | **yes, by omission** | same | **[PROVEN]** |
| do not create a false success | **yes** | the whole cycle runs in one `withTransaction` (`velrepeat-scheduler.ts:111` → `:394`), so a throw rolls the run back | **[PROVEN]** |
| durable cycle failure state | **vocabulary only** | `out_of_stock` / `item_unavailable` exist in the cycle CHECK (`:954`), the plan CHECK (`:827`) and the run CHECK (`:873`); **no writer produces a cycle-level failure** | **[IMPLEMENTED]** (vocabulary) / **[BLOCKED]** (behavior) |
| notify system/operator/customer | **partly** | `velrepeat_events` (`:887-897`) + the scheduler's existing `insertEvent`/`notifyUser` calls (`velrepeat-scheduler.ts:376-388`) | **[IMPLEMENTED]** (mechanism) |
| never auto-substitute | **yes** | no substitution code exists anywhere | **[PROVEN]** |
| never auto-refund without a policy | **yes** | the late-payment path deliberately does not refund (`stripe.ts:547`) | **[IMPLEMENTED]** |
| never silently skip | **yes** | failure ≠ `skipped` in the cycle CHECK (`:954`); and F forbids it explicitly | **[OWNER DECISION]** |
| monetary consequence of a failed cycle | **not derivable** | §12.3 | **[OWNER FORMULA REQUIRED]** |

**Current retry behavior for the record [PROVEN]:** today `INSUFFICIENT_STOCK` throws inside the run
transaction → rollback → the plan stays active and is retried on the next sweep. The owner's decision
does not forbid retrying, but "retry forever" is an implicit policy for paid value; the bounded-retry /
escalation policy is money-adjacent and is recorded in §12.3.

---

## 8. Multi-seller flow (Decision Q17)

### 8.1 The committed shape

```
                     ONE Repeat Plan  (customer)
                     ONE prepaid payment  (Q13=B / Q14)
                     N cycles, each 1..commitment_cycles
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   cycle 1              cycle 2              cycle 3
        │                   │                   │
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
   ▼         ▼         ▼         ▼         ▼         ▼
 seller A  seller B  seller A  seller B  seller A  seller B
  order     order     order     order     order     order
   │         │         │         │         │         │
   └─────────┴─────────┴─────────┴─────────┴─────────┘
              fulfillment ownership is PER SELLER
              money is ONE payment at PLAN level
```

### 8.2 Rule-by-rule proof

| Owner's rule | Status | Evidence | Tag |
|---|---|---|---|
| a plan may span several sellers | **already true** | `velrepeat_items.shop_id` / `seller_id` are `NOT NULL` per line (`:853-854`); a run already creates one order per shop (`velrepeat-scheduler.ts:270`) | **[IMPLEMENTED]** |
| central scheduler only | **already true** | `startVelRepeatScheduler()` is wired in `server.ts:519`; decision 7B is binding | **[IMPLEMENTED]** |
| a seller trigger must not process arbitrary customer plans | **enforced at selection, residual in execution** | `seller-orders.ts:784` `EXISTS (… vi.plan_id = vp.id AND vi.seller_id = $1)` prevents *selecting* another seller's plan; but the matched plan is then processed **as a whole plan**, so the run also generates other sellers' orders | **[PROVEN] residual** |
| sellers see/manage only their own orders | **already true on the read path** | `seller-orders.ts:695` `WHERE vi.seller_id = $1` | **[IMPLEMENTED]** |
| a cycle may split into several orders per seller/shop | **already true** | one order per shop per run (`velrepeat-scheduler.ts:270`) | **[IMPLEMENTED]** |
| the plan-level payment remains ONE payment | consistent with Q13=B / Q14 | one `payments` row whose parent is the plan | **[BLOCKED]** on the Q13=B DDL |
| order-level fulfillment ownership stays per seller | **already true** | canonical order lifecycle is per order (`order-fulfillment.ts:89-96`) | **[IMPLEMENTED]** |
| a seller may not change plan-level financial truth | **enforceable and currently true** | no seller surface writes `payments`, `refunds`, `velrepeat_plans` money fields or snapshots; the refund endpoint is admin-permissioned (`POST /api/admin/orders/:orderId/refund`, `.ai/context/payment.md:32`) | **[IMPLEMENTED]** |

**[ARCHITECTURE RECOMMENDATION]** the residual at `seller-orders.ts:766-800` is closed in Phase 7 by making
a seller trigger generate **only that seller's** order for a due cycle, while the central scheduler remains
the only component that advances the whole cycle. **No seller code was changed in this task.**

### 8.3 The hard part: per-seller money attribution does not exist (new finding)

**[PROVEN]** the decision's money clauses cannot be honored by today's data model, and this is the
"multi-seller money attribution conflict" stop condition named in the task:

| Requirement | What the repository actually has | Tag |
|---|---|---|
| attribute part of one plan-level payment to each seller | `commissions` (`:520-526`) is `order_id UUID NOT NULL REFERENCES orders(id)` — it **cannot** reference a plan payment | **[PROVEN]** |
| record what was attributed | `settlements` (`:528-534`) has `seller_id`, `amount`, `status` and **no** payment / plan / cycle reference | **[PROVEN]** |
| write those rows | `grep` for `INSERT INTO commissions`, `FROM commissions`, `INTO settlements`, `FROM settlements` in `backend/**` excluding tests → **0 matches each** | **[PROVEN]** |
| pay the seller | **no Stripe Connect, no `transfer_data` / `application_fee` / `on_behalf_of`, no seller↔Stripe account mapping, no KYC state, no payout** (`.ai/context/payment.md:239-250`); the customer is charged on the platform's account and "seller amounts are internal accounting only" | **[PROVEN]** |

**Therefore:** a plan-level prepaid payment across several sellers can be **received** but cannot be
**attributed** or **paid out** in this repository today. This does not block Phase 2 (which is package
composition and pricing only) and it does not contradict the owner's decision — the decision is correct and
necessary. It is recorded as **`[OWNER DECISION REQUIRED]`** (§12.4) because the resolution (a) may require
an owner-funded payout rail that is explicitly out of scope until the owner asks for it, and (b) determines
the refund split in §12.1.

---

## 9. Cycle identity

### 9.1 The accepted direction

**[OWNER DECISION]** `velrepeat_cycles` = canonical cycle identity; `velrepeat_runs` = execution attempt /
scheduler execution record; no two systems may each claim to be "cycle N"; the relation must be designed
**before** touching the scheduler; **this task documents the decision and the required architecture
transition only — the scheduler was not modified.**

### 9.2 The dual-identity hazard, proven

| Fact | Evidence | Tag |
|---|---|---|
| `velrepeat_runs` is the **live** execution record | written by `velrepeat-scheduler.ts:127` (insert with `ON CONFLICT DO NOTHING`), `:867-886` in DDL | **[IMPLEMENTED]** |
| `velrepeat_runs` claims to be "cycle N" | `UNIQUE (plan_id, scheduled_for)` (`:882`) — one run per scheduled instant, i.e. per cycle occurrence | **[PROVEN]** |
| `velrepeat_runs` carries a first-order-only order link | `order_id UUID REFERENCES orders(id)` (`:874`); the remaining order ids live in `metadata.orderIds` (`velrepeat-scheduler.ts:358-369`) | **[PROVEN]** |
| `velrepeat_cycles` is the Phase 1 canonical identity | `cycle_number`, `UNIQUE (plan_id, cycle_number)` (`:962`), `pricing_snapshot_id` (`:958`), `scheduled_at` (`:955`) | **[IMPLEMENTED]** |
| **There is no relation between them** | `velrepeat_runs` has no cycle FK; `velrepeat_cycles` has no run FK; `velrepeat_events.run_id` references runs only (`:890`) | **[PROVEN]** |
| `orders` references both | `orders.velrepeat_run_id` (`:380`, FK `:885`) **and** `orders.velrepeat_cycle_id` (`:381`, FK `:966`) | **[PROVEN]** |

**Consequence [PROVEN]:** today an order can be linked to a *run* or to a *cycle*, and nothing in the
schema says they describe the same event. Two answers to "did cycle 3 happen, and which order is it?" are
derivable from one database. That is the duplicate-authority hazard the owner's decision forbids.

### 9.3 The required architecture transition (documented, NOT implemented)

**[ARCHITECTURE RECOMMENDATION]** the transition, in dependency order, so no phase has to invent it:

| Step | Requirement | Tag |
|---|---|---|
| 1 | `velrepeat_cycles` becomes the only row that answers "cycle N exists / what state is it in" — it already has the right uniqueness (`:962`) and the right snapshot link (`:958`) | **[ARCHITECTURE RECOMMENDATION]** |
| 2 | `velrepeat_runs` stops being an identity and becomes an **execution attempt**: a cycle FK is added (nullable during transition), `UNIQUE (plan_id, scheduled_for)` (`:882`) is retired in favour of "at most one *open* run per (cycle, attempt)" so retries are expressible without a second identity | **[ARCHITECTURE RECOMMENDATION]** |
| 3 | `orders.velrepeat_run_id` (`:380`) becomes derived-only; `orders.velrepeat_cycle_id` (`:381`, FK `:966`) becomes the canonical link; a cycle's several orders are found by `velrepeat_cycle_id`, not by parsing `metadata.orderIds` | **[ARCHITECTURE RECOMMENDATION]** |
| 4 | The exactly-once claim for a cycle is taken on the **cycle row** (`SELECT … FROM velrepeat_cycles WHERE id = $1 FOR UPDATE` + status transition), extending the existing order-lock contract (`order-lock.ts:67`) to name the cycle as a lock root — reusing the guard pattern, never re-implementing it | **[ARCHITECTURE RECOMMENDATION]** |
| 5 | A uniqueness key on `(velrepeat_cycle_id, seller_id)` gives "a cycle's per-seller orders are each at most one", which is the order-level half of the prior audit's §17.3 invariant | **[ARCHITECTURE RECOMMENDATION]** |
| 6 | **All of the above is Phase 5 work, gated behind §11's and §12's items, and none of it may start until the relation is designed.** The scheduler is untouched by this task. | **[BLOCKED]** |

### 9.4 V1 packages (Decision Q15) — the boundary, restated

**[OWNER DECISION]** V1 coexists as legacy; V2 is not built on V1 tables; V2 uses `velrepeat_packages`,
`velrepeat_package_items`, `velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items`,
`velrepeat_cycles`; production usage must be checked before deprecation; no migration/drop without usage
evidence.

| Fact | Evidence | Tag |
|---|---|---|
| the five V2 tables exist and are the ones the decision names | `:898`, `:908`, `:921`, `:937`, `:950` | **[IMPLEMENTED]** |
| V1 is untouched and still has a live write path | `vrepeat_packages` (`:680-707`) / `vrepeat_deliveries` (`:710-727`); `velrepeat.ts` 7 writes (`:48, :162, :377, :388, :535, :548, :561`) | **[IMPLEMENTED]** |
| V1 cannot be reused for V2 | single `product_id` + embedded `unit_price` / `total_amount` / `payment_id` (`:682-704`) versus V2's multi-item composition with no price and no payment (`:898-919`) | **[PROVEN]** |
| production usage cannot be checked from here | production is unreadable — migrations 048–050 pending on a Neon quota; no production DB access from this environment | **[BLOCKED]** |
| no deprecation is proposed | this pass creates no migration, no drop, no deprecation notice | **[PROVEN]** |

**[PROVEN]** one extra caution for Phase 2: the V1 table is `vrepeat_packages` and the V2 table is
`velrepeat_packages`. They differ by one letter and both exist. **[ARCHITECTURE RECOMMENDATION]** Phase 2
must never reference the V1 name; the Phase 1 structural test already asserts the V2 set.

## 10. Phase dependency graph

### 10.1 The graph after this pass

```
                        [OWNER DECISIONS 2026-09-30 — §1]
                                     │
   ┌──────────────┬──────────────┬───┴───────┬──────────────┬──────────────┐
   │              │              │           │              │              │
 Q13=B        Q14 (1 charge)  A/Q1=B      Q2 (policy)     E (snapshot)   Q16 (UTC)
 Q17 (multi-  F (no oversell/  D (future   B (refund      C (skip)       G (versioning)
   seller)      no substitute)   only)       future only)  H/Q11 (data-    Cycle identity
                                 Q15 (coexist)              driven, owner)   (direction accepted)
   │              │              │           │              │              │
   └──────┬───────┴──────┬───────┴─────┬─────┴──────┬───────┴──────┬───────┘
          │              │             │            │              │
          ▼              ▼             ▼            ▼              ▼
      Phase 3        Phase 4       Phase 5      Phase 6        Phase 7
      Repeat Plan    Prepaid pay   Delivery     Inventory      Scheduler
          │              │        Cycle (identity                  │
          │              │        transition §9)                   │
          │              │             │                            │
          └──────────────┴─────────────┴────────────────────────────┘
                                   │
                 ┌─────────────────┼──────────────────┐
                 ▼                 ▼                  ▼
             Phase 2          Phase 8              Phase 9
             Package +        Order fulfillment   Cancel / pause /
             pricing          (trace + gate §5.7)  skip / modify
                 │                 │                  │
                 └─────────────────┴──────────────────┘
                                   │
                               Phase 10
                          tests + DB-gated proof
```

### 10.2 Gate status per phase (contract §62)

| Phase | Gates (contract §62) | Closed by this pass? | Remaining blocker | Status |
|---|---|---|---|---|
| **1. Domain + schema** | Q13, Q16 | **yes** — both answered | — | COMPLETE (already committed `ea79277` / `8c96a9e`) |
| **2. Package + pricing** | **H**, **E**, **Q15** | E ✔ · Q15 ✔ · **H ✘ (stacking half only)** | stacking semantics, rounding/currency, package-authoring ownership | **[BLOCKED]** |
| **3. Repeat Plan** | E, Q16 | **yes** | plan status vocabulary `pending_payment` (shape); seller eligibility | **[BLOCKED]** (shape + eligibility) |
| **4. Prepaid payment** | Q13, Q14 | **yes** | plan-level reservation-window mapping (4A analogue) | **[BLOCKED]** |
| **5. Delivery Cycle** | identity design, F | direction accepted, relation not designed; F policy answered, F money open | cycle identity relation (§9.3), cycle status vocabulary | **[BLOCKED]** |
| **6. Inventory** | A, Q2 moment | A ✔ · **Q2 moment ✘** | Q2 recognition moment (§3.4) | **[BLOCKED]** |
| **7. Scheduler** | Q16, Q17 | **yes** | per-seller money attribution (§12.4) | **[BLOCKED]** |
| **8. Order fulfillment** | Q13 (trace), F | Q13 ✔ · F ✔ (non-oversell) | depends on Phase 4 + 5 | **[BLOCKED]** |
| **9. Cancellation / pause / modification** | B, C, D, G, I | B/C/D/G ✔ as policy | refund formula, skip money, pause-horizon money, F money | **[BLOCKED]** — owner-mandated stop |
| **10. Tests + E2E** | all of the above | — | all of the above | **[BLOCKED]** |

**[PROVEN] no phase after Phase 1 may be merged while a gate it touches is unanswered** (contract §62
"stop conditions are cumulative"). This pass closed *policy*; it closed no *implementation* gate beyond
Phase 1, because every remaining gate is either a formula the repository cannot supply or a
customer-visible money rule the owner has not stated.

---

## 11. Exact gates for Phase 2

### 11.1 The verdict

# `PHASE 2 = BLOCKED`

**Basis:** the task requires `PHASE 2 = BLOCKED` if any unresolved decision affects **package pricing**,
**pricing tier ownership**, **package composition**, **price snapshot**, **seller eligibility** or
**payment amount**. Each of the six is checked below, individually, against what the owner actually said.

### 11.2 The six required checks, one by one

| # | Dependency | Owner's answer | Closed? | Evidence / reason |
|---|---|---|---|---|
| 1 | **Pricing tier ownership** | **H/Q11** — "pricing rules are platform-controlled, data-driven configuration" | **CLOSED** | Tier data is platform-owned; a seller may not create a rule that breaks financial invariants. The required fields are named. **[OWNER DECISION]** |
| 2 | **Price snapshot** | **E** — "price snapshot at purchase" | **CLOSED** | Storage already exists: `velrepeat_pricing_snapshots` (`:921-936`) + items (`:937-949`) + `velrepeat_cycles.pricing_snapshot_id` (`:958`). The live re-price at `velrepeat-scheduler.ts:245` must become impossible for prepaid — Phase 4/5 work. **[OWNER DECISION]** + **[IMPLEMENTED]** |
| 3 | **Payment amount** | **Q14** — "amount = commitment price after pricing rules" | **PARTIALLY CLOSED → BLOCKING** | The *definition* of the amount is stated, but the arithmetic that produces it is not, because: (a) the stacking semantics of the rules that set the price are unstated, and (b) the rounding point is unstated. Both change the charged amount. **[OWNER DECISION REQUIRED]** |
| 4 | **Package pricing** | H/Q11 answers the *rule* side only | **OPEN → BLOCKING** | `velrepeat_packages` (`:898-906`) has **no price column** and `velrepeat_package_items` (`:908-919`) has none either — so a package's price is *derived* from the product catalog plus the pricing rules. That derivation is fine, but it inherits both unknowns above. Additionally, **rounding/currency** is unstated while all money is `NUMERIC(12,2)` (`:925-930`) and Stripe consumes minor units (`toMinor(order.total_amount)`, `stripe.ts:1133`). **[OWNER DECISION REQUIRED]** |
| 5 | **Package composition** | **Q15** answers only *which tables* V2 uses | **OPEN → BLOCKING** | Q15 gives the storage boundary and is closed. What it does not answer is **who may author a package's composition** — and the schema does not record it: `velrepeat_packages` has no owner/seller column and no author column (`:898-906`). A package's composition feeds the commitment total, so this is a pricing input with an unowned author. The prior audit raised exactly this item; this pass received no answer. **[OWNER DECISION REQUIRED]** |
| 6 | **Seller eligibility** | not answered | **NOT BLOCKING for Phase 2** | Contract §62 assigns seller surfaces to **Phase 7**, and no Phase 2 deliverable depends on a seller-eligibility rule — *unless* packages turn out to be seller-scoped, which is item 5. Recorded as open, not as a Phase 2 gate. **[OWNER DECISION REQUIRED]** |

### 11.3 The three exact questions that would unblock Phase 2

Stated as the owner would need to answer them. **This audit does not answer them and does not propose
values.**

| # | Question | Why Phase 2 cannot proceed without it | Tag |
|---|---|---|---|
| **G1** | **Pricing-rule resolution:** when more than one rule applies to a commitment (for example a cycle-count tier and a quantity tier), do the discounts **stack**, or does the single highest-`priority` rule win? If they stack, is the combination capped? | Phase 2's deliverable is the pricing engine (contract §62 exit criteria: "tier changes need no code edit"). An engine cannot compute a total without resolution semantics, and the semantics change the amount the customer is charged. The owner named `priority` as a required field but never said whether rules combine. | **[OWNER DECISION REQUIRED]** |
| **G2** | **Rounding and currency:** at which point is money rounded, and by which rule? (candidate shapes: round the per-cycle price and the total once at the snapshot boundary; or compute the total only and derive per-cycle by division.) What happens to the remainder when `total_amount` is divided across `commitment_cycles`? | Every money column is `NUMERIC(12,2)` (`:925-930`, `:944-946`); Stripe takes minor units (`stripe.ts:1133`); a multi-cycle commitment divides a rounded total by a cycle count. Rounding is customer-visible money, and the owner's own rule is that no business pricing rule may be hardcoded in source — a rounding rule chosen silently in code would be exactly that. | **[OWNER DECISION REQUIRED]** |
| **G3** | **Package-authoring ownership:** who may create or edit a `velrepeat_packages` row and its `velrepeat_package_items` composition — platform operators only, sellers only, or both with different rights? | The V2 package tables (`:898-919`) carry no owner, no author and no audit column, and no authorization rule exists for them. Q15 settled coexistence, not authorship. Whoever authors a composition determines part of the commitment total, so this is a package-pricing decision. | **[OWNER DECISION REQUIRED]** |

### 11.4 What is explicitly NOT a Phase 2 gate (and why)

| Item | Why it is not a Phase 2 gate |
|---|---|
| Q13 = B / Q14 payment linkage | Phase 4. Phase 2's exit criteria (contract §62) do not include a payment; the plan's total is a *snapshot* value, not a charge. **[PROVEN]** |
| A/Q1 = B inventory | Phase 6. Phase 2 touches no stock. **[PROVEN]** |
| Q2 `sold_count` | Phase 6. Phase 2 writes no counter. **[PROVEN]** — the Q2 *conflict* (§3.4) is real and stopping, but it does not gate Phase 2 |
| B / C / D / F money formulas | Phase 9. **[PROVEN]** |
| Multi-seller money attribution (§12.4) | Phase 7/9. Phase 2 can express a multi-item package without attributing money — but note the dependency: if G3 answers "seller-authored packages", the seller's package prices become a pricing input and the attribution question moves earlier. **[OWNER DECISION REQUIRED]** |
| Cycle identity relation (§9.3) | Phase 5. **[PROVEN]** |
| Seller eligibility | Phase 7 in contract §62 — unless G3 makes packages seller-scoped. **[OWNER DECISION REQUIRED]** |

### 11.5 The gate statement, verbatim for the record

> **PHASE 2 = BLOCKED.** Three owner decisions are required: **G1** pricing-rule resolution (stack vs.
> one-wins), **G2** rounding and currency, **G3** package-authoring ownership. All three are
> customer-visible money or money-adjacent authority. The prior audit's Phase 2 blockers — H/Q11, Q15,
> package-authoring ownership and rounding — are now reduced to H's stacking half, rounding, and
> package-authoring ownership, because the owner closed Q15 (coexist), the Q11 ownership half and E
> (snapshot). **Phase 2 implementation is additionally forbidden by this task's own scope**, independent
> of the verdict.

**And the stop conditions hold even if the verdict were READY:** the task forbids Phase 2
implementation here regardless.

---

## 12. Exact items that still require an owner formula

Each item below states: the decision (closed as policy), the exact question the repository **cannot**
answer from source, the evidence that it cannot, and the phase that must stop. Per the owner's own
instruction these are marked `OWNER FORMULA REQUIRED` and the affected phase is **STOPPED** — no formula
is guessed, defaulted, or approximated here.

### 12.1 Decision B — the refund formula for future unfulfilled cycles

| Element | Content |
|---|---|
| **Policy (closed)** | **[OWNER DECISION]** refund only the future unfulfilled cycles; a fulfilled cycle is not future; never edit a payment amount; canonical `refunds`/Stripe only; immutable calculation/snapshot; idempotent; no over-refund; no auto-refund from an ambiguous webhook; back-auditable. |
| **Missing formula 1** | **The monetary value of one cycle.** The snapshot stores `commitment_cycles` (`:924`), `subtotal_amount`, `discount_type`, `discount_value`, `discount_amount`, `total_amount` (`:925-930`) and per-line `quantity` / `unit_price` / `line_total` (`:942-944`). There is **no per-cycle amount column and no per-line-to-cycle allocation**. `total ÷ commitment_cycles` is one candidate, but it is not stated anywhere, and it interacts with G2's rounding rule. |
| **Missing formula 2** | **Allocation of a single discount across cycles.** `discount_type` + `discount_value` + `discount_amount` (`:927-929`) are stored as one lump. Whether a percentage discount is spread proportionally across cycles, applied to early cycles first, or applied at total level and never attributed to a cycle is not derivable. |
| **Missing formula 3** | **The per-seller split of a plan refund for a multi-seller plan.** `commissions` is `order_id NOT NULL` (`:521`), `settlements` has no plan/cycle reference (`:528-534`), neither has a writer, and there is no payout rail (`.ai/context/payment.md:239-250`). §12.4. |
| **Missing formula 4** | **The "future unfulfilled" boundary in money terms.** A cycle's order can be `pending`/`confirmed` (reserved, not shipped) or `cancelled`. Which of those are refundable is a policy the owner stated qualitatively ("unfulfilled may enter the calculation") but not quantitatively. |
| **Repository check performed** | The canonical machinery **does** exist and is reusable: `refunds` (`:502-518`), `provider_refund_id` unique (`:517`), webhook-confirmed recomputation, `refundableMinorFor` never negative (`stripe.ts:320`). What is missing is the **amount**, not the mechanism. |
| **Verdict** | **[OWNER FORMULA REQUIRED]** · **Phase 9 STOPPED.** |
| **Also required before B can be represented at all** | **[BLOCKED]** `refunds.order_id` is `NOT NULL` (`:504`) — a plan-linked refund row is unrepresentable until Q13=B's linkage lands. |

### 12.2 Decision C — the skip monetary consequence

| Element | Content |
|---|---|
| **Policy (closed)** | **[OWNER DECISION]** skip only a future unfulfilled cycle; never packing; never shipped; never rewrite a historical financial record; skip writes an audit/event; skip is not a successful delivery; the skipped cycle's inventory is not committed as sold. |
| **What the owner explicitly left open** | The owner's own words: *"ต้องกำหนดว่าจะเลื่อนไปท้าย commitment หรือถือเป็น consumed cycle"* — the owner stated that this **must be decided** and did not decide it. |
| **Missing formula** | Postpone-to-end vs consumed-cycle is a money outcome: postponing means the customer eventually receives the delivery; consuming means the customer paid for N cycles and receives N−1, which requires the value gap to be addressed or explicitly accepted. There is no per-cycle value to quantify it with (§12.1 formula 1), and no credit instrument exists in this repository for a non-refund resolution. |
| **What IS settled and provable** | Non-oversell and non-success are structurally guaranteed: `packing → [shipped]` only (`order-fulfillment.ts:92`) makes "never skip a packing cycle" true today; a throw inside the cycle transaction rolls the whole cycle back (`velrepeat-scheduler.ts:111` → `:394`); `skipped` is distinct from `completed` in the cycle CHECK (`:954`). **[PROVEN]** |
| **Verdict** | **[OWNER FORMULA REQUIRED]** · **Phase 9 STOPPED.** |

### 12.3 Decision F — the out-of-stock cycle monetary consequence

| Element | Content |
|---|---|
| **Policy (closed)** | **[OWNER DECISION]** no oversell; no auto-substitute; do not commit inventory; do not increment `sold_count`; no false success; durable cycle failure state/event; notify system/operator/customer; never auto-refund without a policy; never silently skip. |
| **Missing formula** | What happens to the **money** the customer already paid for a cycle that cannot be served. The policy forbids auto-refund and auto-substitute but does not say whether the cycle is **retried indefinitely**, **retried N times then escalated to an operator**, **postponed**, or **cancelled with a refund or credit**. All four are defensible; they differ in customer-visible money. Today's behavior is *implicit* retry-forever: `INSUFFICIENT_STOCK` throws inside the run transaction, rolls back, and the plan is retried on the next sweep (`velrepeat-scheduler.ts:328-341` + claim `:113-120`) — and the owner did not ratify that. |
| **What IS settled and provable** | Everything non-monetary in F is already structurally true or representable: non-oversell (`inventory.ts:60-63`), no commit / no `sold_count` on failure (commit is caller-gated, `inventory.ts:79-81`), no false success (transaction rollback), durable failure vocabulary exists in all three CHECKs (`:827`, `:873`, `:954`), notify mechanism exists (`velrepeat_events` `:887-897` + `velrepeat-scheduler.ts:376-388`). **[PROVEN]** |
| **Dependency** | F's money also depends on §12.1 (the per-cycle value) and G2 (rounding). |
| **Verdict** | **[OWNER FORMULA REQUIRED]** · **Phase 9 STOPPED.** |

### 12.4 Multi-seller money attribution for a plan-level payment

| Element | Content |
|---|---|
| **Policy (closed)** | **[OWNER DECISION]** one plan may span sellers; the plan-level payment is ONE payment; sellers see and manage only their own orders; a seller may not change plan-level financial truth. |
| **The conflict** | "One payment" + "several sellers" + "plan-level financial truth" requires the platform to attribute and pay out per seller. **[PROVEN]** `commissions.order_id NOT NULL` (`:521`); `settlements` has no payment/plan/cycle column (`:528-534`); **zero backend writers** for either table; **no Stripe Connect or payout rail at all** (`.ai/context/payment.md:239-250`). |
| **Why it needs the owner** | Resolving it is either (a) an owner-funded new capability (payout rail / Connect), which the repository's own documentation says is out of scope until the owner asks for it, or (b) a decision to keep seller attribution purely internal — which is a *policy* choice about whose money it is and when it is recognized. Neither is derivable from source. |
| **Scope of the block** | Does **not** block Phase 2. **Blocks** Phase 7 completion and any per-seller refund split (§12.1 formula 3). |
| **Verdict** | **[OWNER DECISION REQUIRED]** (not a formula — a capability/policy choice). |

### 12.5 Decision D — what a paused cycle costs (surfaced by the decision's own wording)

| Element | Content |
|---|---|
| **Policy (closed)** | **[OWNER DECISION]** pause applies to future cycles only; never stop a cycle whose fulfillment has started; historical cycles unchanged; pause event stored; no future fulfillment while paused; resume creates no duplicate cycles; deterministic and idempotent. |
| **Missing formula** | The decision fixes *when* pause applies but not *what a paused cycle costs*. A prepaid plan is paid for `commitment_cycles` cycles (`:830`); pausing either **extends the horizon** (the customer still receives N) or **consumes the cycle** (the customer receives N−1 for a price already paid). Today the live behavior is a silent one-interval deferral with no commitment accounting: `next_run_at = GREATEST(next_run_at, NOW())` (`velrepeat-plans.ts:520`) — which silently reduces what the customer receives. |
| **Verdict** | **[OWNER FORMULA REQUIRED]** · **Phase 9 STOPPED.** |

### 12.6 Consolidated stop register

| ID | Item | Type | Phase stopped |
|---|---|---|---|
| G1 | Pricing-rule resolution (stack vs one-wins) | owner decision | **2** |
| G2 | Rounding and currency | owner decision | **2** |
| G3 | Package-authoring ownership | owner decision | **2** |
| — | Q2 recognition moment (§3.4) | owner decision | **6** |
| — | Multi-seller money attribution (§12.4) | owner decision | 7 / 9 |
| — | Seller eligibility | owner decision | 7 (3 if packages are seller-scoped) |
| — | Plan status vocabulary `pending_payment` | owner decision (shape) | 3 / 4 |
| — | Cycle status vocabulary `due` / `reserved` / `fulfilled` | owner decision (shape) | 5 |
| — | Plan-level reservation-window mapping (4A analogue) | owner decision | 4 |
| B | Refund formula for future unfulfilled cycles | **owner formula** | **9** |
| C | Skip monetary consequence | **owner formula** | **9** |
| D | Paused-cycle monetary consequence | **owner formula** | **9** |
| F | Out-of-stock monetary consequence | **owner formula** | **9** |
| — | `velrepeat_runs ↔ velrepeat_cycles` relation design | architecture (owed) | 5 |
| — | Production migration of 048–050 | owner action (Neon quota) | production |

---

## This task's scope, honesty notes and verification

**Deliverable:** this document only.

**Files edited by this task:** `.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` (new),
a revision pointer in `.ai/context/velrepeat-contract.md`, and a short entry in `.ai/AI_HANDOFF.md`.

**Explicitly NOT touched, verified in this pass:**

| Prohibited action | Status |
|---|---|
| production backend behavior | **not touched** — no file under `backend/` was modified |
| frontend | **not touched** — no file under `apps/` or `packages/` was modified |
| Stripe implementation | **not touched** |
| webhook | **not touched** |
| inventory | **not touched** |
| scheduler | **not touched** — `backend/jobs/velrepeat-scheduler.ts` is read-only in this pass |
| order fulfillment | **not touched** |
| migration `051` | **not created** — `db/migrations/` still ends at `050_orders_status_check.sql`, and the auto-apply chain in `.github/workflows/migrate-neon.yml` is armed, so a new migration would be applied to production unattended |
| `db/run-update.sql` | **not recreated, not modified** |
| payment authority | **unchanged** — `payments` remains the single canonical authority |
| mock data / fake API | **none added** |
| duplicate service | **none created** |
| auth / authz / ownership / payment-guard bypass | **none** — the one place a guard is insufficient under the new model (the order-level confirmation gate, §5.7) is **documented as a Phase 8 requirement**, not relaxed |
| Neon production migration | **not performed** |
| COD enable | **not enabled** — `isCodEnabled()` (`payment-config.ts:313`) untouched |
| Phase 2 implementation | **not started** |

**Honesty notes — what this audit does NOT establish:**

- **Production is NOT verified and NOT claimed.** Migrations 048, 049 and 050 remain unapplied in
  production (Neon quota, owner action), so `payment_incidents` and `orders.payment_expires_at` do not
  exist there and the `orders.status` CHECK is absent. The Phase 1 V2 objects exist only in the canonical
  SQL files and in CI's disposable PostgreSQL. **[PROVEN] as a documented fact, not as a re-verified
  production query — this environment has no production DB access.**
- **DB-gated tests skip locally.** There is no local PostgreSQL, so the integration half of
  `backend/tests/velrepeat-v2-domain-schema.test.ts` (`:111`) skips here. CI's `postgres:16`
  (`.github/workflows/test.yml:84/:126`) is the only real DB execution.
- **Stripe E2E has never been executed** in this workspace (no credentials), so no claim about live
  settlement, refund or webhook behavior is made beyond what the code proves.
- **No owner decision was inferred.** Where the owner did not answer, the item is listed in §4.2 and
  §12 with a stop token. Where the owner's decisions conflict with existing commerce semantics (Q2), the
  conflict is reported and the phase is stopped rather than resolved.

**Verification run for this pass** (results recorded in `.ai/AI_HANDOFF.md`):

```
bun run test
cd backend && bunx tsc --noEmit
bun run typecheck
bun run build:apps
git diff --check
cmp db/schema.sql db/run-sqleditor.sql
ls db/migrations/            → must end at 050, no 051
git status --porcelain        → only .ai/ documents
```

**Next safe phase:** **none is unblocked.** Phase 2 is the earliest and it is **BLOCKED** on G1, G2 and G3
(§11.3). Nothing in this pass authorizes implementation of any phase.
