# LOW #12 — dead order status `failed` in `RELEASABLE_STATUSES` (2026-09-30)

**Status: FIXED (Case A — dead confirmed).** `fix(order): remove dead failed status guard` ·
start `04ab7ea` (= `origin/main`) · audited base `04ab7ea`.

**Nothing was guessed.** The decision rule required proving `orders.status = 'failed'` has no
writer *before* removing the guard entry, because a guard entry that merely *looks* wrong is not
the same as one that is wrong. This document is that proof.

---

## 1. The original problem

`RELEASABLE_STATUSES` (`backend/lib/inventory.ts`) is the **read side** of the order-status
domain: it gates the atomic `inventory_released` claim in `releaseOrderInventory()` so a paid /
shipped / delivered / completed order can never have its stock returned. It listed `"failed"`:

```ts
const RELEASABLE_STATUSES = [
  "pending", "pending_payment", "cancelled", "payment_failed", "expired", "failed",
];
```

Audit §42.2 **L12** recorded it as dead. MEDIUM #9 (§48, migration V0050) had already used that
finding as the *reason* to exclude `failed` from `orders_status_check` — so the two halves of the
domain disagreed: the schema forbade a state the release guard still defended.

**Risk if the entry had been real:** removing it would silently stop releasing reserved stock for
a genuine order state — customers lose units off the shelf with no refund and no alert. That is
why §3–§5 enumerate writers rather than trusting a grep.

---

## 2. Sources inspected

`AGENTS.md` · `.ai/AI_RULES.md` · `.ai/AI_HANDOFF.md` (§42.2, §48) · `.ai/context/payment.md` ·
`.ai/context/testing.md` · `.ai/context/workflow.md` ·
`.ai/history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md` (§42.1–42.5, the verbatim L12
paragraph) · `.ai/tasks/completed/order-status-check-2026-09-29.md` (MEDIUM #9) ·
`.ai/tasks/completed/payment-failed-retry-2026-09-29.md` (HIGH #4) ·
`.ai/tasks/completed/late-payment-operator-2026-09-29.md` (HIGH #5) ·
`.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md` (CRITICAL #1/#2).

Source: `backend/lib/inventory.ts`, `backend/lib/order-fulfillment.ts`,
`backend/lib/order-lock.ts`, `backend/lib/payment-reservation.ts`, `backend/lib/payment-config.ts`,
`backend/routes/stripe.ts`, `backend/routes/cart.ts`, `backend/routes/seller-orders.ts`,
`backend/routes/center.ts`, `backend/routes/products.ts`, `backend/routes/seller-intelligence.ts`,
`backend/routes/upload.ts`, `backend/routes/velrepeat.ts`, `backend/routes/velrepeat-plans.ts`,
`backend/jobs/payment-reservation-scheduler.ts`, `backend/jobs/velrepeat-scheduler.ts`,
`packages/shared/src/lib/commerce.ts`, `packages/shared/src/lib/shop.ts`,
`packages/shared/src/components/order/OrderStatusBadge.tsx`, all `db/migrations/*.sql`,
`db/schema.sql`, `db/run-sqleditor.sql`, the seven test files that touch the guard, and the full
git history of `backend/lib/inventory.ts`.

---

## 3. Every `orders.status` writer (the decisive evidence)

Every `UPDATE orders` / `INSERT INTO orders` in the repository, with the value written and — for
the parameterized ones — the origin of `$1` traced back to its authority.

| # | Site | Value | Origin of the value |
|---|---|---|---|
| 1 | `routes/cart.ts:88-89` | INSERT `'pending'` | literal |
| 2 | `jobs/velrepeat-scheduler.ts:270-272` | INSERT `'pending'` | literal |
| 3 | `routes/cart.ts:1369` | `'cancelled'` | literal (customer cancel) |
| 4 | `routes/stripe.ts:431` | `'paid'` | literal (confirming webhook) |
| 5 | `routes/stripe.ts:610` | `'payment_failed'` | literal (`payment_intent.payment_failed`) |
| 6 | `routes/stripe.ts:657` | `'cancelled'` | literal (`checkout.session.expired`) |
| 7 | `routes/stripe.ts:764` | `'refunded'` | literal (refund webhook) |
| 8 | `routes/stripe.ts:1394` | `'pending_payment'` | literal (Checkout Session created) |
| 9 | `routes/seller-orders.ts:617` | `SET status = $1` | **`req.body.status`**, gated at `:539` by `isSellerOrderStatus()` = `isFulfillmentStatus()` = `FULFILLMENT_STATUSES`; the 7-value state machine. Then re-gated in-transaction by `canTransitionFulfillment()` |
| 10 | `routes/center.ts:517` | `SET status = $1` | **`req.body.status`** into `to`, gated at `:460` by `isFulfillmentStatus()`; same in-transaction gate |
| 11 | `jobs/payment-reservation-scheduler.ts:149` | `SET status = $2` | **`PAYMENT_RESERVATION_EXPIRED_STATUS` = `"expired"`** (`lib/payment-reservation.ts:61`), further constrained by `status = ANY(PAYMENT_RESERVATION_EXPIRABLE_STATUSES)` = `pending｜pending_payment` |

**The three dynamic writers cannot produce `failed`:** #9 and #10 are string-checked against
`FULFILLMENT_STATUSES` *before* the query, and #11 writes a module constant. There is no fourth
dynamic writer.

**Checked and confirmed NOT writers** (the trap the brief warned about):

- `backend/lib/inventory.ts:206` — `UPDATE orders SET inventory_released = true …`. Writes the
  **flag**, never `status`.
- `backend/lib/payment-reservation.ts:139` — `UPDATE orders SET payment_expires_at = $2,
  reservation_policy = $3`. Writes the **reservation window**, never `status`.

**Searched for and found nothing:** no schema-qualified (`UPDATE public.orders`) or aliased
(`UPDATE o SET`) status write; no `INSERT INTO orders` in any `db/*.sql`; no migration writes
`orders.status` at all.

**Union of every reachable value:** `{pending, pending_payment, paid, payment_failed, refunded,
cancelled, confirmed, packing, shipped, delivered, completed, expired}` — **12 values, no
`failed`.** This is exactly MEDIUM #9's derived `ALLOWED_ORDER_STATUSES`, which independently
confirms the schema derivation was complete.

---

## 4. Every `failed` occurrence, classified

`grep -rn "'failed'\|\"failed\"\|RELEASABLE_STATUSES"` over `*.ts|*.tsx|*.sql|*.js|*.json`
(excluding `node_modules`, `dist`), then classified:

| Category | Where | Verdict |
|---|---|---|
| **1. `orders.status`** | `lib/inventory.ts:165` (the guard entry, now removed) | **dead** |
| **2. `payments.status`** | `routes/stripe.ts:440` (`resolvePaymentAttemptRow(…, "failed")`), `:592` (`UPDATE payments SET status = 'failed'`), `:1259` (`SESSION_NOT_REUSABLE`); `lib/payment-config.ts:45,54` (`FAILED` constants); `commerce.ts:236` (`StorePaymentStatus`); `paymentBlocksCancellation("failed")` (fed `paymentStatus` at `cart.ts:1358`) | **live, per-ATTEMPT** — a different axis, untouched |
| **3. Stripe/payment-event status** | `routes/stripe.ts:1543,1548,1578` (`payment_events.status`); `:714,736` (`refunds`); `db/migrations/049_payment_incidents.sql:14` ("the attempt was already recorded `failed`" — the *payment attempt*, not the order) | **live, untouched** |
| **4. Inventory release guard** | `lib/inventory.ts:165` only | **dead → removed** |
| **5. UI/display** | `lib/shop.ts` `ORDER_STATUS_META` + `ORDER_STATUS_ICONS` (7 keys, no `failed`); `OrderStatusBadge.tsx`; `lib/commerce.ts` `StoreOrderStatus` (no `failed`); `lib/commerce.ts` `StorePaymentStatus` (has it) | **order axis has none; payment axis has it** |
| **6. Test fixture / payment-domain input** | `order-fulfillment-state-machine.test.ts:184`, `order-ux-polish.test.ts:217`, `payment-cancellation-race.test.ts:113`, `payment-attempt-identity.test.ts:*`, `late-payment-incidents.test.ts:*`, `customer-order-cancel.test.ts:256,637` | all **payments.status**, all still valid |
| **7. Documentation** | `.ai/AI_HANDOFF.md:537,774`; `db/migrations/050_orders_status_check.sql:38` | handoff updated (§ below); **V0050 deliberately left as written** — AI_RULES §6 forbids rewriting historical migrations, so its comment is left intact as history |
| **8. Dead/legacy** | the guard entry; and **defensive READ guards**: `center.ts:281`, `products.ts:2256`, `seller-intelligence.ts:226,254,319` all use `o.status NOT IN ('cancelled','failed','refunded')` or `[…].includes(r.status)` | reads, not writes. Now unreachable no-ops. **Left untouched on purpose** — rewriting analytics is scope expansion, and a defensive read is harmless. A test now pins that none of them is a write path. |
| **other tables (legit)** | `velrepeat_runs` / `velrepeat_plans` / `vrepeat_packages` CHECK lists (`schema.sql:717,871,942`), `velrepeat-scheduler.ts:31`, `velrepeat-plans.ts:791`, `velrepeat.ts:514` | unrelated domains |
| **logging (unrelated)** | `routes/upload.ts` (10×), `apps/velshop/.../ProfileImageUpload.tsx` (7×) | R2 log-line `status` field, not a domain status |

---

## 5. Evidence that `failed` was dead

Four independent proofs, in increasing strength:

1. **Enumeration** — §3: eleven writers, twelve reachable values, no `failed`.
2. **Whole git history** — `git log --all -S"UPDATE orders SET status = 'failed'"` returns
   **nothing**. The value was *never* written to an order at any commit.
3. **Provenance** — `git log -S'"failed"' -- backend/lib/inventory.ts` shows the entry was
   present in the **very first** version of `RELEASABLE_STATUSES` (`707d1c0`, 2026-09-08). It
   was never added alongside a writer; it is a `payments.status` value copied into an
   `orders.status` guard — a copy-paste of the payment axis into the order axis.
4. **Schema history** — V0003's `orders_status_check` (`pending, confirmed, processing, shipped,
   delivered, cancelled`) never included `failed`, and V0016 dropped it before the real writers
   appeared. No migration has ever needed to accommodate a `failed` order.
5. **The database refuses it (DB-gated test)** — a new test proves PostgreSQL itself rejects both
   `INSERT … 'failed'` and `UPDATE … 'failed'` with **23514 / `orders_status_check`**, and leaves
   the row untouched. No historical row and no future writer can put a `failed` order past the
   guard that was removed. *(This one executes only in CI — see §8.)*

**Conclusion: Case A.** No business flow, historical compatibility or payment state depends on
`failed` as an `orders.status`. Removal is safe and makes the domain internally consistent.

---

## 6. What was checked before removing it

- **Call sites of `RELEASABLE_STATUSES`: exactly one** — `inventory.ts:217`, the `$2` of the
  guarded claim. The rest of the module never references it. The removal therefore narrows one
  SQL predicate and nothing else.
- **No test depends on it.** `grep -n "RELEASABLE"` across all seven test files that touch the
  guard → **zero matches**. The tests exercise `releaseOrderInventory()` behaviour, not the list.
- **No migration / historical compatibility.** No `db/*.sql` writes or reads
  `orders.status = 'failed'`; the only `db/` hit is a V0049 comment about the *payment attempt*.
- **Settled-payment gate is orthogonal** — it is passed as `$3` and reads `payments`, so removing
  an order-status entry cannot weaken it.

---

## 7. Files changed

| File | Change |
|---|---|
| `backend/lib/inventory.ts` | Removed `"failed"` from `RELEASABLE_STATUSES`; exported the const (`export const RELEASABLE_STATUSES: string[]`) so a test can assert the real value instead of a copy; rewrote the doc comment to name the writer behind each remaining value and to state why `failed` must not come back. **No logic change** — the claim SQL, the `$2`/`$3` binding, the idempotency claim and the settled-payment refusal are byte-identical. |
| `backend/tests/dead-order-status-failed.test.ts` | **NEW** — 26 local + 4 DB-gated tests (below). |
| `backend/tests/order-status-check-constraint.test.ts` | Comment only: the L12 note now says the entry was *removed* rather than *is dead*. **The assertion `expect(ALLOWED_ORDER_STATUSES).not.toContain("failed")` is unchanged and still passes.** |
| `.ai/AI_HANDOFF.md` | L12 row → FIXED; new §49. |
| `.ai/tasks/completed/dead-order-status-failed-2026-09-30.md` | This record. |

**Deliberately NOT changed:** `db/schema.sql`, `db/run-sqleditor.sql`,
`db/migrations/050_orders_status_check.sql` (MEDIUM #9 — untouched; a historical migration must
not be rewritten), `backend/lib/order-fulfillment.ts`, `backend/lib/payment-reservation.ts`,
`backend/lib/payment-incidents.ts` + `db/migrations/049_payment_incidents.sql` +
`apps/velcenter/.../PaymentIncidentTab.tsx` (HIGH #5), every `routes/stripe.ts` payment path,
`packages/shared/src/lib/commerce.ts`, the read-side analytics guards, and `db/run-update.sql`
(never touched — deprecated).

---

## 8. Tests added / changed, and real results

`backend/tests/dead-order-status-failed.test.ts` — the six required proofs, each pinned:

| Required proof | Test |
|---|---|
| 1. `RELEASABLE_STATUSES` has no dead order status `failed` | `` `failed` is gone from the release guard ``, plus `no payments-domain value leaks into the guard` (also excludes `processing`/`requires_action`/`partially_refunded`/`succeeded`), `the guard is exactly the five statuses that were already reachable`, no-duplicates/no-whitespace, and a source assertion that the **declaration literal** is free of `"failed"` |
| 2. Every remaining status is real (writer/domain) | `the guard is a subset of the MEDIUM #9 allowed set`; the checkout/VelRepeat `'pending'` INSERT regexes; `UPDATE orders SET status = '<v>'` in `stripe.ts` for the five Stripe values; `PAYMENT_RESERVATION_EXPIRED_STATUS === "expired"` + the sweep's `SET status = $2`; **both parameterized writers gated by `isFulfillmentStatus`/`isSellerOrderStatus`**; and a whole-tree assertion that **no source file writes `orders.status = 'failed'`** |
| 3. `payment_failed` is still a real lifecycle value | in both the guard and the allowed set; written by `routes/stripe.ts`; `order-fulfillment.ts` still has `case "payment_failed":` mapping it to `cancelled` |
| 4. `payments.status = 'failed'` is never read as an order status | **every SQL `status = 'failed'` write in the backend is resolved to its target table and asserted to be `payments`/`payment_events`, never `orders`** (with a positive control that the scan still finds the known sites, so it cannot pass vacuously); `StoreOrderStatus` has no `failed` while `StorePaymentStatus` does; `ORDER_STATUS_META` keys == `FULFILLMENT_STATUSES`; and the three read-side `NOT IN (… 'failed' …)` guards are asserted to be **reads, not writes** |
| 5. MEDIUM #9's allowed set is unchanged | the set is still **exactly 12** values (asserted literally *and* derived), still **without `failed`**; `schema.sql` == `run-sqleditor.sql` byte-identical and both declare exactly that set; **V0050 declares exactly that set and still excludes `failed`**; the guard is a strict subset of what the CHECK allows |
| 6. Inventory release behavior unchanged | the guarded UPDATE still carries `inventory_released = FALSE`, `status = ANY($2)`, `NOT EXISTS (SELECT 1 FROM payments p …)`, `RETURNING id`, and is still bound as `[orderId, RELEASABLE_STATUSES, [...PAYMENT_SETTLED_STATUSES]]`; `PAYMENT_SETTLED_STATUSES` is still `["paid","processing"]` read from `payments`; **no second array constant was added** |

**DB-gated (4, `TEST_DATABASE_URL` only — CI is the only place they execute):** every surviving
guard status still releases its reserved stock *and* is still idempotent on a second call; a
non-releasable status (`paid`/`shipped`/`delivered`/`completed`/`confirmed`) still refuses; a
settled payment still outranks the status guard; and **PostgreSQL refuses `orders.status =
'failed'`** with 23514 on both INSERT and UPDATE, leaving the row untouched.

**Mutation-checked (the tests are not vacuous):** re-inserting `"failed"` into the constant and
re-running the file fails **6** tests, then reverted. Two bugs in my own new test were also caught
and fixed this way (a malformed assertion, a stray character) rather than by loosening anything.

### Real verification output (2026-09-30, at `04ab7ea` + this change)

| Command | Result |
|---|---|
| `NODE_ENV=test bun test tests` (from `backend/`) | **922 pass / 189 skip / 0 fail** — 1111 tests / 51 files, 5391 assertions |
| baseline before this change | 896 pass / 185 skip / 0 fail — 1081 tests / 50 files |
| delta | **+26 pass, +4 skip, +1 file** — exactly the new file |
| `cd backend && bunx tsc --noEmit` | exit 0, no output |
| `bun run typecheck` | 4/4 apps exit 0 |
| `bun run build:apps` | 4/4 apps built |
| `bun run i18n:check` | `th=1416 en=1416 my=1416` — parity OK |
| `diff db/schema.sql db/run-sqleditor.sql` | identical |
| `git diff --check` | clean |
| `bun run lint` | **not a real check** — `package.json:29` is `echo 'Lint not yet configured'`. Reported as absent, not run. |

**The 4 DB-gated tests SKIP locally** — this sandbox has no PostgreSQL and no container runtime,
so they are **not** claimed as passing here. They run in CI against the disposable `postgres:16`
service (`.github/workflows/test.yml`).

---

## 9. Production status

- **Migrations 048, 049, 050 are all still NOT APPLIED in production** — the Neon quota
  (`ERROR: Your account or project has exceeded the quota`) is an **OWNER ACTION** and is
  unchanged by this task. `Migrate Neon Database` triggers only when a file under `db/migrations/`
  changes; **this commit changes no migration file, so that workflow will not re-run and will stay
  red for the same pre-existing reason.**
- Therefore **production `orders.status` is still unconstrained** — `orders_status_check` does not
  exist in production yet. This task is **code-only and adds no schema requirement**.
- **This change is safe to deploy before 050 is applied.** It only narrows a read guard; it does
  not depend on the constraint existing. Conversely, applying 050 later is unaffected.
- Real Stripe E2E and browser E2E remain **BLOCKED** (no credentials / no signed-in session).

---

## 10. Explicit safety confirmations

- ✅ **MEDIUM #9 scope NOT expanded.** `orders_status_check` was not widened, narrowed or
  re-derived. V0050, `db/schema.sql` and `db/run-sqleditor.sql` are byte-for-byte untouched;
  `failed` was **not** added to the CHECK; the allowed set is still exactly 12 values, asserted by
  a new test.
- ✅ **HIGH #5 unchanged.** `backend/lib/payment-incidents.ts`,
  `db/migrations/049_payment_incidents.sql` and
  `apps/velcenter/src/components/PaymentIncidentTab.tsx` are untouched. No refund route, no
  operator queue and no incident policy were modified. The captured-charge-on-a-`failed`-**attempt**
  question stays an **OWNER DECISION** (and note it concerns `payments.status`, which this task
  did not modify).
- ✅ **Payment semantics unchanged.** No `payments.status` value, no Stripe webhook behaviour, no
  `PAYMENT_SETTLED_STATUSES`, no `resolvePaymentAttemptRow` change. Every `'failed'` under the
  payments/payment-events axis is exactly as it was.
- ✅ **Inventory semantics unchanged.** `releaseOrderInventory()`'s claim SQL, its idempotency
  guarantee, its transactional requirement and its settled-payment refusal are byte-identical.
  The only change is one value removed from a read guard — narrowing it to statuses that exist.
- ✅ **No automatic refund, no reopen, no retry/cancellation policy change, no new status, no
  state-machine change, no production data edit, no test skipped or weakened.** The one
  pre-existing MEDIUM #9 assertion that mentions `failed` was **kept**, and a comment was added.
