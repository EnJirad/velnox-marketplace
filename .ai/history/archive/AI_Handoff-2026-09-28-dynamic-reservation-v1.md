# Handoff §36 — Dynamic Payment Reservation V1 (2026-09-28)

**Reference only.** Moved out of `.ai/AI_HANDOFF.md` when §38 replaced the
risk-based window with a FIXED 30-minute reservation (Part 1). The policy
described below is superseded; everything it says about the expiry sweep, the
ONE release path, the race guards and the database columns still holds.

---

## 36. Dynamic Payment Reservation V1 — an unpaid order holds stock for a risk-based window (2026-09-28)

**Reported.** Stock reserved at order creation had NO deadline: an order abandoned at Stripe held
its units until someone cancelled it or Stripe expired the session (~24 h), so the last unit of a
scarce product sat behind an abandoned order. Asked for: risk-based reservation windows (MIN 10,
MAX 60, default 30 min), an expiry mechanism that releases exactly once, no resurrection by a late
webhook, a countdown in the order UI, and tests.

**Architecture as found (inspected, not assumed).** Stock is reserved inside the
order-creation transaction (`backend/routes/cart.ts`): variant items → guarded
`product_variants.stock -= qty`; non-variant → `reserveInventoryStock()` (`inventory.reserved +=`).
ONE release path exists, `releaseOrderInventory()` (`backend/lib/inventory.ts`), whose atomic
`inventory_released` claim + status guard already made release at-most-once for cancel / payment
failure / session expiry. Schedulers exist (`backend/jobs/velrepeat-scheduler.ts`, 60 s tick,
DB-as-source-of-truth). `orders.status` had no deadline column; COD/VelRepeat orders are settled by
the carrier (VelRepeat inserts its own orders and never touches Stripe). **No reservation system
was duplicated — this extends the existing one.**

**Policy (new `backend/lib/payment-reservation.ts`, pure + deterministic).** Signals from real
columns only: `inventory.quantity - reserved`, `product_variants.stock`, `products.featured`
(the platform's promotion flag — the schema has NO flash-sale field, so none is invented), and
7-day sales velocity from `order_items ⋈ orders` over real sold statuses
(`paid|confirmed|shipped|delivered|completed`, covering the Stripe and COD rails). Scarcest line
wins (`MIN(available_stock)`).

| Risk | Window | Fires when |
|---|---|---|
| CRITICAL | 15 min | ≤2 available · ≤5 available with ≥1 unit/day · <1.5 days of cover · promoted AND ≤5 available |
| HIGH | 20 min | ≤10 available · ≤20 available with ≥1 unit/day · <3 days of cover |
| NORMAL | 30 min | everything else (the default; also "stock unknown") |
| LOW | 45 min | ≥20 available, <1 unit/day, ≥10 days of cover, not promoted |
| VERY_LOW | 60 min | ≥50 available, ≤0.2 units/day, ≥30 days of cover, not promoted |

Windows are clamped to 10–60 and the whole policy (riskLevel, minutes, reason, signals) is stored
on the order.

**Changes.**

| Piece | Change |
|---|---|
| `backend/lib/payment-reservation.ts` | NEW — the ONE policy: thresholds, `calculatePaymentReservationPolicy()` (pure), `gatherOrderReservationSignals()` (one SQL round trip), `applyPaymentReservationPolicy()`. COD → no window |
| `backend/jobs/payment-reservation-scheduler.ts` | NEW — scan (`payment_expires_at <= NOW()`, expirable statuses, `inventory_released = FALSE`) → guarded claim `pending|pending_payment → expired` → payment row `cancelled` (`PAYMENT_RESERVATION_EXPIRED`) → `releaseOrderInventory()` → then close the Stripe session. `paid`/`processing` payments block the claim entirely |
| `backend/routes/cart.ts` | Checkout takes the window INSIDE the order-creation transaction; both read routes expose `paymentExpiresAt` (ms) |
| `backend/routes/stripe.ts` | `markPaymentSucceeded` guard now also requires `inventory_released = FALSE` (a paid-after-release order can never be resurrected) and logs the reason (incl. `reservation_expired`); checkout refuses a lapsed window with **400 `PAYMENT_RESERVATION_EXPIRED` BEFORE** any session is created; the session is created with `expires_at` = the deadline (Stripe's 30 min–24 h bound applied) and the response carries `paymentExpiresAt` |
| `backend/server.ts` | `startPaymentReservationScheduler()` beside the VelRepeat scheduler |
| `backend/routes/seller-orders.ts` | `expired` maps to `cancelled` (the seller has nothing to fulfil; the default branch would have invited a confirmation) |
| `packages/shared/src/lib/commerce.ts` | `expired` status + meta + terminal transitions; `orderStripePayability` now returns `expired` and refuses a lapsed window; NEW `paymentReservationState()` + `formatPaymentCountdown()` |
| `apps/velshop/.../ShopOrderDetail.tsx` | Countdown strip ("ชำระเงินภายใน MM:SS"), one-second presentation-only tick, one refetch when it lapses, expired notice replacing the steps, no pay button |
| `apps/velshop/.../ShopCheckoutSuccess.tsx` | `expired` is terminal for polling and has a status meta |
| i18n | NEW top-level `orderReservation` namespace (th/en/my): `payWithin` (`{time}`), `windowNote`, `expiredTitle`, `expiredDesc` — i18n:check th=en=my=**1338** |
| DB | `orders.payment_expires_at TIMESTAMPTZ`, `orders.reservation_policy JSONB`, `idx_orders_payment_expires_at` (partial on `IS NOT NULL`) in **both** `db/schema.sql` and `db/run-sqleditor.sql` (+ new `db/migrations/048_payment_reservation.sql`, additive/idempotent) |

**Deploy order (safety).** The columns arrive with migration `048`, and the host deploys on push,
so the two can cross: the reservation write is therefore wrapped in a `SAVEPOINT` and tolerates
**only** `undefined_column` (42703) — otherwise a missing column would abort the order-creation
transaction and break EVERY checkout. A backend newer than its database keeps serving, orders get
no window (like legacy rows), the write logs the exact migration to apply, and the sweep logs once
and resumes by itself on the first scan that succeeds after the migration lands.

**Race handling (the invariant: no order is ever resurrected, no unit released twice).** Sweep,
webhook and customer cancel all write the same row through guarded UPDATEs, so the row lock picks
exactly one winner and the losers re-evaluate to 0 rows. A payment that arrives before the
deadline wins (stock becomes SOLD, `inventory_released` stays FALSE, the sweep then skips it). A
payment that arrives after the order expired cannot reclaim stock and cannot set `paid` — the money
stays on the payment row and is logged as **manual review/refund required** (the reconciliation
path; no refund is invented in code). A `paid`/`processing` payment blocks the automatic expiry, so
a live charge is never expired out from under the customer. Nothing under
`backend/middleware/stripe-raw-body.ts` or the webhook's signature/`payment_events` handling
changed.
