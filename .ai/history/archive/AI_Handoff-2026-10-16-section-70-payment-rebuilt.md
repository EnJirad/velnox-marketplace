# Archived from .ai/AI_HANDOFF.md (2026-10-16)

Moved out **verbatim** while adding §77 (edit-headroom housekeeping: the current-state
file was at ~56 KB against the ~55 KB edit-tool ceiling). Every rule it established is
still live and is listed in the handoff's `## §70 … ARCHIVED` pointer; the long-form
record lives under `docs/PAYMENT_*.md`.

---

## §70. Payment + Checkout + Order + Inventory + Webhook — rebuilt as ONE system (2026-10-06)

**Full record:** [`docs/PAYMENT_CURRENT_STATE.md`](../docs/PAYMENT_CURRENT_STATE.md) (25-question audit) ·
[`docs/PAYMENT_TARGET_ARCHITECTURE.md`](../docs/PAYMENT_TARGET_ARCHITECTURE.md) ·
[`docs/PAYMENT_IMPLEMENTATION.md`](../docs/PAYMENT_IMPLEMENTATION.md) (19 sections) ·
[`docs/PAYMENT_E2E_CHECKLIST.md`](../docs/PAYMENT_E2E_CHECKLIST.md) (58 PASS / 8 BLOCKED / **0 FAIL**).

### Root cause

Every per-order payment **read and decision** resolved the ledger by `payments.order_id` alone, while a
multi-shop purchase stores **ONE** payment row with `order_id IS NULL, checkout_group_id = <group>` → NULL →
`COALESCE(…, 'unpaid')` → the UI showed `orders.status='paid'` beside "ยังไม่ชำระ". The same blindness broke the
**decisions**: confirm gate (409 forever on a paid order), release guard (would return **sold** stock),
cancellation gate (a paid purchase could be cancelled), expiry sweep (could expire a purchase mid-payment).
**A seventh, more severe defect was found this pass** (`docs/PAYMENT_CURRENT_STATE.md`, defect 7): a group session's
`metadata.orderId` is the REPRESENTATIVE order, so the four failure/expiry paths resolved to it, searched
`payments WHERE order_id = <order>` → NULL → `moved: false` → **nothing happened at all** (payment stuck
`requires_action`, orders stuck `pending_payment` holding stock, session never closed); the sweep then expired
**one** order, leaving the session payable, and the late charge settled against `expired` orders — money taken,
nothing sold, **no incident** — silently.

### What was built

1. **`backend/lib/payment-attempt.ts`** (new, 490 lines) — the ONE covering-set resolver: predicates, the SQL
   fragments, the **precedence fold** (`refunded > partially_refunded > paid > processing > NEWEST`), row
   accessors and purchase-scope readers. **24 blind subqueries across 8 files now use it**
   (`routes/{cart,stripe,seller-orders,center}.ts`, `lib/{order-lock,order-fulfillment,inventory}.ts`,
   `jobs/payment-reservation-scheduler.ts`).
2. **`backend/lib/checkout-group-lifecycle.ts`** (new, 200 lines) — `terminateCheckoutGroup()`: locks every
   member order (id ASC), refuses when any covering payment is settled or in flight (`blockedBy`), claims each
   order, releases stock through the ONE release path, and voids the charge **last**. Used by the cancel route,
   the expiry sweep and all four failure/expiry webhook cases.
3. **`routes/stripe.ts`** — failure/expiry paths group-aware; purchase scope derived **server-side from the order
   row** (closes the retry hole where an `orderId`-only request charged ONE shop's total beside a live group
   charge); settlement records a durable late-payment incident when captured money has no payable order; refunds
   are group-aware. **Migration 055** (mirrored in both canonical SQL files): nullable `refunds.order_id`,
   `refunds.checkout_group_id` + index, `refunds_parent_check`, `payments_status_check` (added **conditionally**
   — production is unreadable from a workspace). `db/verify-reconciler.sh` counts `66|243|255|652` →
   `66|244|258|653`.
4. **One frontend file**, `apps/velshop/src/pages/ShopCheckoutSuccess.tsx`: the payment line is no longer hidden
   when the backend sends `payment: null`. No new i18n keys.

### Verified (all observed, none assumed)

| Check | Result |
|---|---|
| `bun test backend/tests` on a freshly reconciled disposable DB | **2011 pass / 2 skip / 0 fail**, 2013 tests, 69 files |
| `backend/tests/checkout-group-payment-visibility.test.ts` (new, 539 lines) | **18/18** |
| `bun run db:verify` | exit 0 — **52 PASS**, ALL SCENARIOS PASSED |
| `bun run typecheck` (4 frontends) + `@velnox/backend` | exit 0 |
| `bun run build:apps` | exit 0 (4/4) |
| `bun run i18n:check` · `git diff --check` | exit 0 · clean |

Five pre-existing source-shape tests failed because they pinned the OLD blind SQL verbatim; each was updated to
pin the new architecture, and the cancel contract gained a **stronger** assertion (a grouped refusal is decided
under the member-order locks and returns before the provider session is closed or any socket event published).
No assertion was weakened, skipped or deleted. `bun run lint` is **not configured** in this repo.

### Still BLOCKED (unchanged, do not read as PASS)

1. **Real Stripe TEST-mode E2E** — no `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
   `STRIPE_WEBHOOK_SECRET` (`freebuff-env list` → `{"files":{}}`), no browser, no test account. Phase 19 is
   verified at **DB level with prototype-spied Stripe sessions** and labelled as a simulation. Requires: set the
   three Stripe keys in the backend env and register the webhook for `POST /api/payments/stripe/webhook`.
2. **Production Neon unreachable** — migration 055 could not be read against or applied to production (no
   `NEON_PRODUCTION_DATABASE_URL`; GitHub App token 403 on secrets and workflow dispatch). Apply 055, confirm the
   two new constraints, re-run the count assertion.
3. **Owner follow-ups from this pass:** reconcile historical rows where a charge landed on `expired` orders
   (start from `payment_incidents`); decide/implement seller payout (Stripe Connect or an internal ledger) and
   persist commission per order — neither exists today (`docs/PAYMENT_IMPLEMENTATION.md` §19).

### Conflict flagged in the task brief

The brief lists `db/run-update.sql` as a schema sync target. `AGENTS.md` rule 4 forbids recreating that file, so
only `db/schema.sql`, `db/run-sqleditor.sql` and the migration were written. `db/run-update.sql` remains absent.
