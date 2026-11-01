# Abandoned payment attempts: safe retirement (2026-11-01)

**Starting SHA:** `3e2afff` → **this commit**.

## The gap

`POST /api/stripe/checkout` reused an open session only for the same rail; when the stored session
was already `expired`, the payment row stayed in `pending/requires_action`, holding
`idx_payments_one_active_stripe`. Every later attempt answered `409 DUPLICATE_PAYMENT_IN_PROGRESS`
even though that session could never be paid (`3e2afff` fixed the simple expiry case).

The remaining risk was the reverse: the branch treated **any** non-open session as dead, including
`status = "complete"` — which, for a paid PromptPay/card checkout, is exactly what a successful payment
looks like *before* the webhook has been processed. Retiring that row would have downgraded money.

## Fix

`backend/routes/stripe.ts` now retires an abandoned attempt only when it can provably never be paid:

```
expired                              → retire (mark cancelled), continue with the new rail
complete AND payment_status != paid  → retire (abandoned async attempt)
open (same rail)                     → reuse its URL, no new session
anything else (incl. complete/paid)  → keep the row; answer the honest 409
```

The UPDATE is `WHERE id = $1 AND status IN ('pending','requires_action')`, so a paid row is untouched even
under a webhook race, and a second cleanup pass matches zero rows (idempotent). Rows are never deleted:
the cancelled attempt, its Stripe ids and `payment_events` stay auditable.

## Transition

| | before | after |
|---|---|---|
| active row, session open, same rail | reused | reused (unchanged) |
| active row, session expired | retired (`cancelled`) | retired (unchanged) |
| active row, session complete **unpaid** | retired | retired |
| active row, session complete **paid** | **retired (downgrade risk)** | untouched → 409, webhook stays authority |

## Tests

`backend/tests/payment-abandonment.test.ts` (8 pass) pins: expired retires, complete-unpaid retires,
complete-paid guarded (guard precedes the cancel), no `DELETE FROM payments/payment_events`, idempotent
state filter, open session reused, rail switch expires first, one webhook `constructEvent` authority.
`checkout-payment-flow.test.ts` assertion updated from `existing.status !== "open"` to the two precise
states (same intent, stronger). Combined suites: **58 tests, 0 fail**; full suite back to the 8 documented
Termux-only DB-guard probes; backend `tsc` clean, apps typecheck 4/4, builds 4/4, diff clean.

## NOT RUN

DB-gated behaviour (real expiry + webhook race) — no disposable PostgreSQL on this device; it runs in CI.
Stripe-side expiry is simulated by reading the session object, not by waiting 24 h.
