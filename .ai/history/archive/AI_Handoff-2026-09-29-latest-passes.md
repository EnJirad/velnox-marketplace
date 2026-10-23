# Handoff §5 "Latest passes" — archived 2026-09-29 (edit-headroom housekeeping)

This is the handoff's chronological "Latest passes" section, moved **verbatim** on 2026-09-29 so
`.ai/AI_HANDOFF.md` could stay inside its ~55 KB edit ceiling while the current records (§43 CRITICAL
#1/#2, §44 HIGH #3, §45 the CI follow-up, §46 HIGH #4) were appended.

It is a narrative of completed work, not a list of open items: nothing in it describes a gap that
is still unfixed. The live record of what is still open is **§6 "Remaining gaps / open items"** in
`.ai/AI_HANDOFF.md`, which was deliberately kept inline. Superseded audit detail lives in
`archive/AI_Handoff-2026-09-29-audit-findings-detail.md`; the per-task evidence chains named below
still exist in git history and in `.ai/tasks/completed/`.

---

## 5. Latest passes

### 2026-09-29 — payment ↔ customer-cancellation race hardened (shared LOCK ORDER)

The contradiction was already unreachable (the guarded `UPDATE orders … status = ANY(…)`
claims plus the `inventory_released` flag made exactly one writer win), but the two sides
took the rows in OPPOSITE orders: cancel = `orders` → `payments`, while
`markPaymentFailed` / `markPaymentCanceled` = `payments` → `orders` — an AB-BA deadlock
PostgreSQL breaks by aborting one side (a 500 on the customer's cancel, or a `failed` event
Stripe redelivers, with the winner decided by lock timing). `backend/lib/order-lock.ts` now
defines the ONE order: the order row is locked FIRST by the cancel route,
`markPaymentSucceeded`, `markPaymentFailed`, `markPaymentCanceled`, `syncRefundFromStripe`
and the reservation sweep. The cancel route also re-reads the payment state UNDER that lock,
so `paid`/`processing` still refuse (`ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`) instead of
trusting a pre-transaction read. A settlement after a cancellation is still recorded on the
payment row (refunding it) and never resurrects the order, re-reserves stock, or commits it.
No schema change; Stripe webhook architecture untouched.

Evidence: `backend/tests/payment-cancellation-race.test.ts` — **21 cases covering the whole
TEST 01–18 race matrix**: the structural lock-order contract; forced-interleave probes that
prove both sides wait on the SAME order row (and that no path holds the `payments` row while
waiting); cancel↔settlement both ways; `checkout.session.completed` ∥
`payment_intent.succeeded`; expiry ∥ settlement; cancel ∥ confirmed / packing / shipped —
each issued as **concurrent real HTTP** against the real routes behind one held lock, so the
winner is decided by PostgreSQL and never by issue order; the same event id delivered three
times at once; a duplicated retry after a cancellation; `reserved`/`sold_count` exactly-once;
a cancelled order refusing to return to fulfilment under concurrent pressure — plus a new
`cancel vs shipment` race in `order-fulfillment-state-machine.test.ts`. Full backend suite
**995 pass / 0 fail**; `tsc --noEmit`, `bun run typecheck` (4 apps) and `bun run build:apps`
green; `git diff --check` clean; CI `36547644881` success on `d4e184d`. The probe was proven
to have teeth: removing the lock from `markPaymentCanceled` makes it fail with PostgreSQL
`55P03`.

**Part ② (same day) — the 30-minute reservation lifecycle, audited + tested end to end.**
Nothing new was built: the system already existed (columns + index in both schema files,
`lib/payment-reservation.ts` = fixed `PAYMENT_RESERVATION_MINUTES = 30` from the SERVER clock,
the `payment-reservation-scheduler` worker wired at boot, countdown on both order surfaces with
the GREEN/YELLOW/RED/EXPIRED tone contract, `orderReservation` copy in th/en/my, `paymentExpiresAt`
+ `reservationMinutes` on both order read routes). What was missing was the TEST MATRIX, so 7
cases were added: expiry ∥ confirmation, expiry ∥ packing, expiry with a duplicated webhook,
`checkout.session.completed` ∥ expiry, a settlement 1.5 s before the deadline, a pay-again
attempt on an order the worker already ended, and the 1-reservation → at-most-1-terminal-
transition invariant (plus `confirmed`/`packing` added to the never-expired status list).
Stale "Dynamic Payment Reservation V1" wording (the deleted risk-band table) was corrected in
`checkout.md`, `database.md`, `payment.md`, `cart.ts`, `server.ts`, `commerce.ts`, `th.ts`.
Backend suite **1002 pass / 0 fail**, typecheck + `build:apps` + `i18n:check` green.
**Still unverified: the production Neon columns** — dispatching the read-only
`diag-neon-schema.yml` returns **403** (no `actions:write` on the app token) and `/api/_diag/schema`
is 401 without a production session, so migration 048's presence in production remains an
owner action, and the countdown is NOT claimed production-ready.

### 2026-09-29 — fulfilment state machine hardened: `packing` + payment/shipment gates

ONE authority: `backend/lib/order-fulfillment.ts` — `pending → confirmed → packing →
shipped → delivered → completed` + terminal `cancelled`. `confirmed` = the shop accepted the
order (packing NOT started, the customer may still cancel); `packing` = fulfilment started
(NOBODY may cancel: the table has no `packing → cancelled` edge). The seller route and the
VelCenter admin route both apply it, each under `FOR UPDATE` on the order row. Two gates now
run inside that transaction: shifting to `confirmed` needs a SETTLED payment (`paid`
`payments` row — the Stripe webhook is the only writer; COD passes only while its disabled
rail is on), and `packing → shipped` needs a `shipments` row carrying a carrier + tracking
number (the seller ship dialog and VelCenter's collect them and send them WITH the
transition, so status + shipment are one transaction). Customer cancellation is unchanged
(`pending|pending_payment|confirmed`, still the guarded `UPDATE` in `cart.ts`) and the two
paths serialize on the row. Seller reads now take the recipient name/phone from
`orders.shipping_address` (account row = legacy fallback only). **NO schema change:**
`orders.status` has no CHECK constraint, so `packing` needs no migration.

Evidence: `backend/tests/order-fulfillment-state-machine.test.ts` (24 cases — real DB for
both gates and for the cancel-vs-packing race in both orders), full backend suite **973
pass / 0 fail**, `bun run typecheck` (4 apps) + `bun run build:apps` + `i18n:check`
(th=en=my=1414) green. i18n note: the `packing` label lives in the new top-region
`orderFulfillment` namespace because th/my's `orderStatus`/`orderSteps` blocks sit past the
safe edit window; `orderStatusI18nKey()` / `orderProgressStageI18nKey()` are the ONE mapping.

**Measured correction to the workspace rule:** the file-edit window is the first
**32 768 bytes** (~32 KB), not ~55 KB — a match at byte 32 748 succeeds, one at 35 778 is
"not found", so this handoff's own sections past ~32 KB (§37+) are no longer editable in
place. Archive/split before growing further.

### 2026-09-22 — two superseded passes

**Archived** (closed records, both pushed at the time) →
[`history/archive/AI_Handoff-2026-09-22-readiness-passes.md`](history/archive/AI_Handoff-2026-09-22-readiness-passes.md).
Moved 2026-09-25 to keep this file under the ~55 KB edit limit. Covers the
`/_diag` prefix guard, seller-verification queue pagination, the 029/030/034/035
migration-numbering proof, honest overview counters, the dead route mappings removed
from `api-routes.ts`, `order:updated` from every status writer, and `config:updated`.

### 2026-09-23 — production verification: DB tests executed, one real bug found, media hardened

**Archived** (closed record, pushed at the time) →
[`history/archive/AI_Handoff-2026-09-23-production-verification.md`](history/archive/AI_Handoff-2026-09-23-production-verification.md).
Moved 2026-09-27 to keep this file under the ~55 KB edit limit. Headline: all 35
DB-gated tests executed for the first time on a disposable PostgreSQL (`452 pass /
0 fail / 0 skip`), the `releaseOrderInventory` double-release was found and fixed by
one guarded UPDATE, and R2/media enforcement moved server-side (10 MB cap + HeadObject
at every persistence point). The still-open catalog read stayed in §9.4.
