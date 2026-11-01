# Payment UX: countdown reuse + typed error recovery (2026-11-02)

**Scope:** the small P1a slice only — no schema, no new pipeline, no Stripe behaviour change.

## What changed

1. `apps/velshop/src/components/shop/ResumePaymentButton.tsx`
   - imports `ApiError` and branches on the backend's machine code instead of showing the raw server text;
   - `DUPLICATE_PAYMENT_IN_PROGRESS` → asks ONCE more for the same rail, so the open session is **resumed**
     (`reused: true`) or, after the backend retires a stale row, exactly one new session is minted; a second
     409 shows `checkout.paymentAlreadyInProgress`;
   - `INVALID_STATUS` → `checkout.paymentNoLongerAvailable` ("outside the payment window"), with no blind retry;
   - the single-press guard, `crypto.randomUUID()` request key, and the "never navigate to an empty URL" rule
     are unchanged. Nothing marks an order paid.
2. `packages/shared/src/lib/i18n/locales/index.ts` — two new `checkout.*` keys merged for th / en / my
   (`paymentNoLongerAvailable`, `paymentAlreadyInProgress`). Parity 1282/1282/1282.
3. Countdown/expiry were already implemented in the existing pattern and were **reused, not duplicated**:
   `ShopOrderDetail` renders `reservation.remainingMs` derived from the server's `paymentExpiresAt` and gates
   the pay action on `payability.payable`; `MyOrders` keeps its per-order deadline ticker.

## Tests

**Added** `backend/tests/payment-ux-contract.test.ts` (8 tests, source-level guards): server-deadline
countdown, payability gating, list ticker retained, `ApiError` code reading, duplicate → resume (two
`createStripeCheckout` call sites), `INVALID_STATUS` copy, no client-side "paid", and the three-locale patch.

**Adjusted** one existing assertion in `checkout-payment-flow.test.ts` from an exact-whitespace literal to
`/orderId,\s+method: chosen,/` after the retry wrapper changed indentation. Same claim, no weakened check.

- `bun test backend/tests/checkout-payment-flow.test.ts backend/tests/payment-ux-contract.test.ts`
  → 50 tests, **0 fail**
- `bun test backend/tests` → 8 fail, all the documented Termux-only `test database guard` probes
- `bun run i18n:check` → OK 1282 × 3
- `bun run typecheck` → 4/4 · `bun run build:apps` → 4/4 · `git diff --check` clean

## NOT RUN

- Browser countdown/expiry visuals and a real resume-after-409: need a live unpaid order and a human browser
  (card/QR entry cannot be automated in the WebView; Stripe's CSP blocks `browser_eval`).
- DB-gated suites locally (no disposable PostgreSQL on this device) — they run in CI.

## Remaining (out of scope, unchanged)

P1b saved cards, P1c inline PromptPay QR, P2 refund/replay, P3 COD/shipping/timeline, P4 Connect, P5 dashboard.
