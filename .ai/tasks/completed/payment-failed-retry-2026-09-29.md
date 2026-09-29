# Payment attempt identity — audit HIGH #4 (2026-09-29)

**Task** `fix(payment): separate failed attempts from order payment state` · **HIGH #4: FIXED**

One production file changed: `backend/routes/stripe.ts`. No schema, no migration,
no inventory file, no frontend, no Stripe architecture, no new business rule.

---

## 1. Starting SHA

`c313244666f9da59d71858916aab800e59d5a738` ("docs(ai): record the CI confirmation for the
paid-cancellation fix"). `git fetch origin` → local HEAD == `origin/main`, tree clean, **in sync**
(`.ai/AI_RULES.md` §0).

## 2. Repository state

- Branch `main`, in sync with `origin/main`, no local work in progress.
- Migration head is still `048`; **migration 048 is NOT applied in production** (audit #6,
  PRODUCTION BLOCKED on the Neon quota). Untouched by this task.
- `db/schema.sql` and `db/run-sqleditor.sql` verified byte-identical after the change
  (`diff` → no output).
- This workspace has **no PostgreSQL and no container runtime** (`docker`, `podman`,
  `pg_ctl`, `postgres`, `initdb`, `psql` all absent), so every DB-gated test SKIPS here.
  CI's disposable `postgres:16` service is the only place they execute.

## 3. Documents read

`AGENTS.md` · `.ai/AI_RULES.md` · `.ai/AI_HANDOFF.md` (§44, §45) ·
`.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md` ·
`.ai/context/payment.md` · `.ai/context/testing.md`.
There is no `WORKFLOW.md` in this repository (`.ai/context/workflow.md` is the equivalent);
this was confirmed by `ls`, not assumed.

## 4. Source files inspected

| File | What was read from it |
|---|---|
| `backend/routes/stripe.ts` | `orderIdForPaymentIntent`, `markPaymentSucceeded`, `markPaymentFailed`, `markPaymentCanceled`, `syncRefundFromStripe`, `handleStripeEvent` (all 11 event cases), `POST /api/stripe/checkout`, the refund route, the webhook route |
| `backend/lib/order-lock.ts` | `lockOrderRow`, `PAYMENT_SETTLED_STATUSES`, `paymentBlocksCancellation`, `latestPaymentStatusForOrder` |
| `backend/lib/inventory.ts` | `commitOrderInventory`, `releaseOrderInventory`, `RELEASABLE_STATUSES` |
| `backend/lib/payment-config.ts` | `PAYMENT_STATUS` enum |
| `backend/lib/order-fulfillment.ts` | `FULFILLMENT_TRANSITIONS`, `normalizeOrderStatusToFulfillment` |
| `backend/jobs/payment-reservation-scheduler.ts` | the expiry sweep (referenced, not changed) |
| `packages/shared/src/lib/commerce.ts` | `NEXT_ORDER_STATUSES`, `PAYABLE_ORDER_STATUSES`, `isOrderPayable` |
| `backend/routes/cart.ts` | the customer cancel guard (referenced, not changed) |
| `db/schema.sql` | `payments`, `payment_events`, `idx_payments_one_active_stripe` |
| `backend/tests/payment-cancellation-race.test.ts` | the established real-webhook HTTP harness reused by the new suite |

## 5. Current payment state machine

`payments.status` values written by the code: `requires_action` (created by checkout),
`paid`, `failed`, `cancelled`. `pending` and `processing` are declared in
`PAYMENT_STATUS` but **`processing` is never written to `payments.status`** — the only
`processing` writes in the repo are `payment_events.status` (`backend/routes/stripe.ts:1316/1329/1337`).
So a Stripe payment attempt is in practice: `requires_action` → one of `paid` / `failed` / `cancelled`.

Identifier columns already exist and are already populated at insert
(`db/schema.sql`, `INSERT INTO payments` at `stripe.ts:1108`):
`provider_payment_id` (= the PaymentIntent id) and `provider_checkout_session_id`
(= the Checkout Session id). **No new column was needed.**

## 6. Current order state machine

`orders.status` written by the payment paths: `pending_payment` → `paid` | `payment_failed` |
`cancelled`, plus `expired` by the sweep. `PAYABLE_ORDER_STATUSES = ['pending','pending_payment']`
(`packages/shared/src/lib/commerce.ts`), and `POST /api/stripe/checkout` enforces exactly
that list (`stripe.ts:886`):

```ts
if (!["pending", "pending_payment"].includes(order.status)) {
  fail(res, 400, "INVALID_STATUS", `Order status '${order.status}' cannot be paid`);
}
```

## 7. Current failure path (BEFORE the fix)

`payment_intent.payment_failed` → `orderIdForPaymentIntent` → `markPaymentFailed(orderId, code, message)`:

1. `lockOrderRow` (order row FIRST — the shared lock order).
2. `UPDATE payments … WHERE id = (SELECT id FROM payments WHERE order_id=$1 AND provider='stripe' AND status <> 'paid' ORDER BY created_at DESC LIMIT 1)`
3. `UPDATE orders SET status='payment_failed' WHERE id=$1 AND status IN ('pending','pending_payment')` — **unconditional on (2)**
4. `releaseOrderInventory(client, orderId)` — **unconditional**

## 8. Current retry path (BEFORE the fix)

**There is no retry-within-the-same-order path, by design, and this task did not add one.**
`.ai/context/payment.md` states it: *"`payment_failed`, `expired`, `cancelled`, `refunded` and COD
orders get **no** pay button — for `payment_failed` the sweep already released the stock, so the
page shows the failure notice (and "buy again") rather than a deadline or a retry the backend
would refuse."* The backend agrees (`INVALID_STATUS`, 400).

What DOES exist and is supported is **attempt retry inside the payment window**: while the order
is `pending_payment`, `POST /api/stripe/checkout` retires the previous attempt
(`SESSION_NOT_REUSABLE`) and opens a new one. That is the retry the audit's Invariant B/C are
about, and it is where the defect lived.

## 9. Root cause

> **Every write to `payments` in `routes/stripe.ts` chose its row with a newest-row heuristic
> instead of the row the Stripe event names.**

`markPaymentSucceeded` (`status <> 'failed'` newest), `markPaymentFailed` and
`markPaymentCanceled` (`status <> 'paid'` newest), and the completed-but-unpaid
`checkout.session.completed` branch all ignored the attempt identity — even though
`paymentIntent.id` and `session.id` are in hand at every call site and both are stored.

An order **legitimately has several `payments` rows**: checkout itself retires one and opens
another on the same order (`SESSION_NOT_REUSABLE`, `stripe.ts`), and Stripe keeps delivering
events for the retired session afterwards. A LATE event about a dead attempt is therefore
routine, and it landed on the live one:

- **late `payment_intent.payment_failed` for attempt A** → step (2) marked **B** failed, step (3)
  flipped the ORDER to `payment_failed`, step (4) released the stock. The customer, sitting on
  an open session for B inside their window, loses the order and the units go back on the shelf.
- **late `payment_intent.succeeded` for attempt A** → the captured money was recorded against
  **B** (which was never charged) while A stayed `failed`. B's row is the record a refund is
  built from, so the refund trail and the settlement record both name the wrong attempt.

Both are Invariant F. The order-level guard in step (3) was NOT the problem — it correctly
refuses to overwrite a `paid`/`cancelled`/`expired` order. The problem was that it was reached
for an event that was not about this order's live attempt.

## 10. Design decision

1. **Do not add a retry policy.** The brief's premise — "customer retries the same order after a
   failure" — is impossible in this codebase by design (§8). Inventing one would contradict
   `.ai/context/payment.md` and `PAYABLE_ORDER_STATUSES`. **No business rule was invented.**
2. **Resolve the payment row BY the attempt the event carries** (new `resolvePaymentAttemptRow`,
   matching `provider_payment_id` OR `provider_checkout_session_id`, scoped to the order and to
   `provider='stripe'`). The newest-row heuristic is kept ONLY as the fallback for an event that
   names no stored attempt, so nothing that resolves today changes behaviour.
3. **Move the terminal guards onto the outer UPDATE** so they protect the resolved row itself.
4. **Tie the ORDER transition to the attempt.** `markPaymentFailed` / `markPaymentCanceled` now
   require the attempt row to have actually transitioned (`status NOT IN ('paid','failed','cancelled')`,
   read from `rowCount`) before the order moves and stock is released. This is the second half of
   the fix and the one that stops the order-level damage.
5. **The SUCCESS order transition is deliberately left as it was.** Money settling the order is
   the existing documented behaviour, and gating it would change when a captured charge is
   recorded — which is refund policy (see §24, and HIGH #5).
6. One non-transactional call site (`checkout.session.completed`, unpaid) uses the pool-level
   `query` through a small adapter; its pre-existing non-atomic two-query shape is unchanged.

## 11. Files changed

| File | Change |
|---|---|
| `backend/routes/stripe.ts` | **the fix** — `PaymentAttemptRef` + `resolvePaymentAttemptRow`; the three writers resolve attempt-scoped and are guarded; the order claim is gated; all 6 call sites pass the attempt they carry |
| `backend/tests/payment-attempt-identity.test.ts` | **NEW** — 7 contract tests (DB-free) + 6 behavioural tests (DB-gated) |
| `backend/tests/checkout-payment-flow.test.ts` | one assertion de-fragilised (see §16) |

`git diff --stat` → 3 files. `git diff --name-only` outside `backend/tests/` → **only
`backend/routes/stripe.ts`**.

## 12. Database / schema impact

**NONE.** No column, table, index or constraint was added or changed. The fix uses
`provider_payment_id` and `provider_checkout_session_id`, which already exist and are already
populated at insert. No migration file was created or edited; `048` untouched.
`diff db/schema.sql db/run-sqleditor.sql` → identical.

## 13. Payment attempt invariants (A–G)

| # | Invariant | Status | Where |
|---|---|---|---|
| A | A failed attempt cannot become successful by mutating history wrongly | **HELD (strengthened)** — the success guard is on the resolved row (`AND status <> 'failed'`) |
| B | A retry uses the correct attempt per the existing architecture | **FIXED** — the row is resolved by `provider_payment_id` / `provider_checkout_session_id` |
| C | A successful retry can settle an order that is still payable | **HELD** — the order guard is unchanged; the resolved row now carries the money |
| D | A failed attempt must not release a reservation a live attempt still needs | **FIXED** — the release is gated on THIS attempt's transition |
| E | A duplicate webhook must not settle twice | **HELD (strengthened)** — `payment_events` claim unchanged; the row guard makes a re-assert a no-op |
| F | A late failure after a successful retry must not return the order to `payment_failed` | **FIXED** — the order claim is gated on the attempt; a failure naming a terminal attempt moves nothing |
| G | A success for a dead order must not resurrect it, and must follow the existing policy | **HELD, unchanged** — `inventory_released = FALSE` + pre-payment-status guard; the operator warning is untouched |

## 14. Inventory invariants

`commitOrderInventory()` and `releaseOrderInventory()` were **not modified**; no new release
helper and no direct stock restore was added. The only change is *when* they are reached:
- `commitOrderInventory` — still only when the order claim succeeded (`moved`), unchanged.
- `releaseOrderInventory` — now reached only when THIS attempt actually transitioned to
  `failed`/`cancelled`, so a late event for a dead attempt can no longer free stock a live
  attempt still holds. The authority's own guards (`inventory_released` claim + settled-payment
  refusal) are unchanged, so COMMIT+RELEASE and RELEASE+COMMIT remain impossible.

## 15. Race test matrix

New file `backend/tests/payment-attempt-identity.test.ts` drives the REAL webhook route with
locally signed Stripe events (Stripe's own HMAC scheme; no network, no SDK call).

| Scenario | Expected | Result | Test | Evidence |
|---|---|---|---|---|
| late FAILURE for a dead attempt | live attempt + order + stock untouched | **PASS (CI)** | `a late FAILURE for a dead attempt leaves the live attempt and the order alone` | order `pending_payment`, `inventory_released=false`, `reserved=3`, B `requires_action` |
| late SUCCESS for a dead attempt | THAT row settles, not the live one | **PASS (CI)** | `a late SUCCESS for a dead attempt settles THAT row, not the live one` | A `paid`, B `requires_action`, order `paid`, `quantity 50→47`, `sold_count 3` |
| SUCCESS duplicated | one settlement | **PASS (CI)** | `a duplicate SUCCESS settles once` | `quantity 50−N` once, `sold_count +N` once |
| FAILURE duplicated | one release | **PASS (CI)** | `a duplicate FAILURE releases once` | `reserved→0` once, `quantity` unchanged, `sold_count 0` |
| FAILURE after SUCCESS | order stays `paid` | **PASS (CI)** | `a late FAILURE after a SUCCESS does not move a paid order back to payment_failed` | order `paid`, `inventory_released=false`, stock committed |
| no usable identifier | falls back, never dead-letters | **PASS (CI)** | `an attempt row written WITHOUT a PaymentIntent id still settles` | order `paid`, stock committed |
| payment × cancellation | one writer wins | **PASS (local + CI)** | `payment-cancellation-race.test.ts` | unchanged suite, 0 fail |
| payment success × expiry | one writer wins | **PASS (local + CI)** | `payment-reservation-expiry.test.ts` | unchanged suite, 0 fail |
| retry × expiry / retry × cancellation | covered by the two suites above | **PASS (local + CI)** | same | attempt-scoped writes cannot add a second terminal transition |
| structural contract (7 cases) | attempt identity + order gating | **PASS (local)** | `payment-attempt-identity.test.ts` describe 1 | runs with no database |

**Local execution limit, stated plainly:** the six DB-gated tests above **SKIP in this
workspace** (no PostgreSQL, no container runtime). They run in CI. The seven DB-free contract
tests run locally and are the local proof. No PASS above is claimed without the run that
produced it — see §16/§17/§22.

## 16. Targeted test results

```
$ bun test backend/tests/payment-attempt-identity.test.ts
BEFORE the fix:   2 pass / 4 FAIL / 6 skip   exit 1
AFTER  the fix:   7 pass / 0 fail  / 6 skip   exit 0
```
The 4 before-failures were the DB-free contract tests, which is the local reproduction
(§9): *"no writer picks its row with the newest-row heuristic"*, *"each writer resolves the row
through the ONE attempt resolver"*, *"every event passes the attempt it carries"*, and the
absence of the resolver.

**One pre-existing test de-fragilised, not weakened.**
`checkout-payment-flow.test.ts:425` asserted the literal `"markPaymentCanceled(orderId"`, which
only matched because the call was on one line; the new call is multi-line. The contract — the
expired-session path calls the cancel writer with the order — is unchanged, so the assertion
became a whitespace-tolerant regex that ALSO now pins the attempt scoping. It fails on a
regression exactly as before and additionally catches a lost session identity.

## 17. Full test results

```
$ NODE_ENV=test bun test backend/tests
867 pass / 168 skip / 0 fail — 1035 tests across 48 files, exit 0
```
Baseline before this task was `860 pass / 162 skip / 0 fail` (1022 tests / 47 files); the
delta is the new file's 7 contract tests. Related suites run explicitly (12 files, payment /
cancellation / expiry / inventory / checkout / fulfilment / webhook):
`240 pass / 94 skip / 0 fail`, exit 0.

## 18. Typecheck

```
$ cd backend && bunx tsc --noEmit            → exit 0
$ bun run typecheck                           → 4/4 apps exit 0
```
Note: `backend/tsconfig.json` has `exclude: ["tests"]`, so `tsc` does **not** cover test files;
the new test file was typechecked separately (see §24 for the known pre-existing
`bun:test`-typing errors that are environmental, not new).

## 19. Build

```
$ bun run build:apps  → 4/4 built, exit 0
```

## 20. i18n

```
$ bun run i18n:check → th=1416 en=1416 my=1416 keys, all locales at parity, exit 0
```
Unchanged (1416, same as before this task) — no user-facing string was added; the 409/400
messages the operator or customer sees are unchanged.

## 21. `git diff --check`

```
$ git diff --check → clean, exit 0
$ bun run lint     → "Lint not yet configured" (placeholder), exit 0
```

## 22. CI result

See the final report for the run id, conclusion and totals on the pushed commit. CI runs the
full suite against a disposable `postgres:16`, which is where the six DB-gated tests above
execute for real.

## 23. Production verification status

**NOT TESTED — no production action was taken, by design.** No production database write, no
Neon migration, no Stripe LIVE call, no real customer payment, no refund. The Stripe secret
gate is unchanged: only `sk_test_`/`rk_test_` keys are accepted, and `STRIPE_NOT_CONFIGURED`
means payments are unavailable (never a fallback). Real Stripe E2E (a real PaymentIntent /
PromptPay QR / webhook delivery / refund round trip) remains **BLOCKED** — no Stripe test
credentials in this workspace, exactly as recorded in `.ai/context/payment.md`.

## 24. Remaining risks

1. **Residual, documented not fixed (needs a refund/late-payment policy = HIGH #5):** if a
   captured charge arrives for an attempt already recorded as `failed`, the payment row is not
   rewritten (Invariant A) and the order still settles; the existing `console.warn` operator
   line is the only signal. Deciding whether to re-open, refund, or flag-and-queue is HIGH #5
   and is **not** invented here. This is the only place the fix deliberately leaves a question.
2. **`checkout.session.completed` (unpaid) still does two non-atomic pool queries** — unchanged
   pre-existing shape; it only writes `requires_action` (never money, never stock).
3. **`idx_payments_one_active_stripe` covers only `pending`/`requires_action`.** `processing`
   is never written to `payments.status`, so there is no live gap today, but a future writer of
   `processing` would need the index widened. Noted, not changed (out of scope).
4. **The six behavioural tests are CI-only** in this environment; the local proof is the
   seven contract tests. This is the LOCAL/CI split from audit row #17.
5. **The handoff file is at its ~55 KB edit ceiling** — this record lives outside it on purpose.

## 25. Next task

**HIGH #5 — the operator surface for a late / unrecordable payment.** It is the natural
successor: risk #1 above is exactly its subject, and the audit already names it as the item
where money can be taken with no automated path back. Before that, the owner action remains
**applying migration 048** (PRODUCTION BLOCKED on the Neon quota), because until it is applied
Part 2 is not live in production.

Full evidence chain: this file · `.ai/AI_HANDOFF.md` §46 · the CI run named in the final report.
