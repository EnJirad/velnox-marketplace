# §107. Payment UX typed errors (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §107. Payment UX: typed errors + resume, countdown reused (2026-11-02)

**Report:** [`.ai/history/2026-11-02-payment-ux-countdown-errors.md`](./history/2026-11-02-payment-ux-countdown-errors.md).

`ResumePaymentButton` now branches on `ApiError.code`: `DUPLICATE_PAYMENT_IN_PROGRESS` resumes the open
session with one extra same-rail request (never a second charge), `INVALID_STATUS` explains the closed
payment window; raw server text is no longer the only message. Countdown/expiry were already correct and are
**reused** (`ShopOrderDetail` ← `paymentExpiresAt` → `reservation.remainingMs`, gated by
`payability.payable`; `MyOrders` keeps its ticker). Two `checkout.*` keys added for th/en/my (1282 parity).
New `payment-ux-contract` (8 pass) plus the checkout suites (50 tests, 0 fail); local full suite back to the
8 Termux-only DB-guard probes; typecheck 4/4, build 4/4. **NOT RUN:** browser countdown/resume — needs a
human browser.

---
