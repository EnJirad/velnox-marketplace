# AI Handoff archive — order UX polish (2026-09-28)

Superseded in `.ai/AI_HANDOFF.md` by §41 (the order UX refactor, which rebuilt the same two surfaces on
top of these pieces). Kept verbatim: what the polish introduced, and the state of the order surfaces
before the refactor.

---

## 39. Order UX polish — status, progress, address, language (2026-09-28)

**Reported (ORDER UX FINAL POLISH — the last task before VelRepeat).** Make the order list and order
page clear, consistent and multilingual for every unpaid order: per-order countdowns, readable
status, ONE simple progress line, the ORDER's own address, a clearer retry, and no hard-coded Thai.
The 30-minute reservation, the sweep and the release path are untouched.

**Countdown position + states.** Each list card keeps its OWN countdown, placed at the bottom-left of
THAT card (status badge, then the countdown, then one hurry note inside the last 3 minutes) so a
running clock is never ambiguous. ONE presentation clock per page: every card derives its own
remaining time from its own `paymentExpiresAt`. A lapsed card shows the expired state and refetches
once (the sweep may already have released the stock); `visibilitychange` still re-reads the API.
Nothing in the browser writes an order status or a deadline.

**Readable, localized status.** The order-status text came from `ORDER_STATUS_META.label`, which is
Thai-only — so English/Myanmar rendered Thai on both surfaces. NEW `orderStatusI18nKey()` (shared)
maps `orders.status` → `orderStatus.*`, NEW `orderStatus` namespace (th/en/my) covers all 11
statuses + `unknown`, and both pages render the translated label. The payment pill now uses the
semantic badge tokens (`getPaymentStatusBadge`) instead of a white-on-white badge. The Burmese table
also gained the six order-page strings that were still English (`myOrderPatch.orderDetail` in
`locales/index.ts`; that patch object can no longer carry the outer `satisfies Partial<Dict>`,
which a partially-filled namespace cannot satisfy).

**ONE progress line, real statuses.** The old five-icon stepper (no payment stage) is replaced by
`ORDER_PROGRESS_STAGES` = placed → payment → processing → shipped → delivered, with
`orderProgressStageIndex()` as the single mapping (`pending`/`pending_payment` → 1,
`paid`/`confirmed` → 2, `shipped` → 3, `delivered`/`completed` → 4). Terminal orders
(`cancelled`, `expired`, `payment_failed`, `refunded`) return -1 and get the notice that explains
them instead of a line implying progress. One `<ol>`, no nested bars; on a narrow screen only the
current stage label shows (all five names stay in the DOM for screen readers) and
`aria-current="step"` marks the stage. Order status and payment status are separate concepts, each
with its own visible caption.

**Address = the order's snapshot.** The delivery section renders `orders.shipping_address` exactly as
stored (`addressSnapshot`), one line per real field, omitting fields the snapshot lacks, with a
labelled recipient and the country translated only for `TH`. It never reads the profile/address
book, so changing the default address later cannot rewrite an existing order.

**Retry + terminal states.** `ResumePaymentButton` reads "Pay again" (`orderReservation.payAgain`)
and still opens the chooser from `GET /api/payments/methods`. A `payment_failed` order gets its own
notice and NO countdown and NO pay button — the backend released the stock at that point, so a
deadline or a pay button would promise a payment the server refuses; "buy again" is the way forward.

**Verified here.** `typecheck` 4/4 · backend `tsc` 0 · `build:velshop` 0 · `i18n:check`
th=en=my=**1369** · `git diff --check` clean · NEW `backend/tests/order-ux-polish.test.ts`
**10 pass / 0 fail** (one-line progress contract + stage mapping, terminal → -1, a localized label
for every status in all three locales, readable badge tokens incl. the unknown case, both surfaces
render the localized label, the detail page uses the order's OWN snapshot and never a profile
address, a failed payment keeps the original deadline and no fabricated one, per-card countdown) ·
reservation + checkout suites **97 pass / 23 skip / 0 fail** · full backend suite **799 pass /
119 skip / 1 fail**, the same pre-existing `test-database-isolation` sandbox probe (it re-reads this
workspace's `.env`; CI, with no `.env`, passes).

**Still open (owner-side).** (1) The browser pass over both order surfaces and the method chooser in
th/en/my. (2) The production migration (§37): without `payment_expires_at` there is no countdown in
production, and the polish only changes what is rendered when the column exists.
