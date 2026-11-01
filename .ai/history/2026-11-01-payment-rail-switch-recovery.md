# Payment rail switching: no more 409 dead end (2026-11-01)

**Starting SHA:** `a3738329cf6eebe4febf523b579cbdc381a70702` · **Final:** see the commit that carries
this file.

## The defect (reproduced in production, sandbox money)

A pending order carried one open Stripe Checkout Session opened for **PromptPay**. Asking the backend for a
**CARD** session for the same purchase answered:

```json
{"success":false,"error":{"code":"DUPLICATE_PAYMENT_IN_PROGRESS","message":"Your payment is being prepared. Please try again."}}
```

Nothing had been charged, the PromptPay session was still `open`, and there was **no link forward** — the
customer could neither switch to card nor resume the old prompt. `ResumePaymentButton`'s own header already
promised the opposite ("the backend abandons a stale open session for a different method"), so the docs and
the code disagreed.

## Root cause

`POST /api/stripe/checkout` reused an open session only when
`existing.metadata?.method === method`; every other open session fell through to the conflict branch, whose
only exit was an error. The abandoned rail was never expired, so the
`idx_payments_one_active_stripe` slot stayed occupied and no new session could exist.

## Fix (smallest safe change)

In the reuse block of `backend/routes/stripe.ts`, when the open session belongs to a **different** rail:

1. `stripe.checkout.sessions.expire(activeSessionId)` — an open Checkout Session has collected no money, so
   expiring it is safe;
2. if Stripe confirms the expiry, the abandoned payment row moves to `status='cancelled'` (freeing the DB
   slot), and the handler continues to mint a session for the rail the customer actually chose;
3. if the expiry is refused (the session completed in the meantime), the request still answers
   `DUPLICATE_PAYMENT_IN_PROGRESS` rather than creating a second payable session.

Same-method reuse, the durable `checkout_requests` claim, the unique active-payment index and the webhook's
sole authority over `paid` are untouched.

## Verification

- `bun test backend/tests/checkout-payment-flow.test.ts backend/tests/checkout-group-session-open.test.ts`
  → **45 pass / 17 skip / 0 fail**; the structural contract now also asserts the expire + retire path.
- Full suite `bun test backend/tests` → 8 failures, all the documented Termux-only `test database guard`
  probes (unchanged baseline).
- `bun run typecheck` 4/4 · `bun run build:apps` 4/4 · `git diff --check` clean.

**NOT VERIFIED end-to-end:** switching rails on a live purchase needs a sandbox checkout completion in a
browser; that step is still pending (no card entry is possible from the app's WebView — Stripe's inputs are
React-controlled and its CSP blocks `browser_eval`).
