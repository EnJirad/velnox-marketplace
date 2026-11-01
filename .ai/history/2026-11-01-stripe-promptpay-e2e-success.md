# Stripe sandbox PromptPay E2E — PASS (2026-11-01)

**Starting SHA:** `f4e8bb1` · **Follow-up fix:** `3e2afff` · **Docs commit:** this record.

## Result: full lifecycle verified with real money movement in sandbox

| Stage | Evidence |
|---|---|
| Purchase created through the real backend | `POST /api/customer/checkout` (buyNow) → order `88e51b37-8c83-4c6f-9cad-e18dc5981458`, `017935129027587968`, **100.00 THB**, buyer `884291e5…`, shop `110b1b7d…` |
| Stripe session | `cs_test_b1TwafRBO2WBwNzxpbE24J819UyVOaXKGnZzlDlkcSfnZjgc1miqaJA5zz` → `complete` / `paid`, `livemode:false` |
| PaymentIntent | `pi_3UWrqaKp4iwMdWLy13JnX3kE`, amount `10000` thb, method `promptpay` |
| Neon payment | `3976d03a-d8a4-4559-9ea2-352f718d681d` → `paid`, PI stored, `paid_at 06:03:05.970Z` |
| Neon order | status **`paid`** (fulfilment still `pending` — correct: nobody shipped it) |
| Webhook | 4 events `processed`, `attempt_count 0`: `payment_intent.requires_action` `evt_3UWrqaKp4iwMdWLy1bKQxtJE`, `payment_intent.created` `evt_3UWrqaKp4iwMdWLy1ifp32Kk`, `payment_intent.succeeded` `evt_3UWrqaKp4iwMdWLy1En9SMEy`, `checkout.session.completed` `evt_1UWrrBKp4iwMdWLyEqyusvgu` |
| Idempotency | `payment_events_event_id_key` UNIQUE on `event_id`; no duplicate rows |

Test data: product `082d513b-6aa5-4d70-a56b-039afbb2c1df` ("Velnox Sandbox Test Product", 100 THB) created via the seller API, approved via moderation, then **suspended** with a reason after the test — the audit trail stays, the storefront no longer shows it. The paid test orders are left intact as financial evidence (no destructive cleanup).

## Two defects found by doing this and fixed

1. **Rail switch dead-ended** (`f4e8bb1`): an open PromptPay session answered CARD with
   `409 DUPLICATE_PAYMENT_IN_PROGRESS` and no link forward. Now the abandoned session is expired (no charge),
   its payment row is cancelled, and a session for the chosen rail is minted.
2. **Expired sessions blocked forever** (`3e2afff`): a session that had already expired still left its
   payment row in `pending/requires_action`, holding `idx_payments_one_active_stripe`; every later attempt got
   the same 409 even though the session could never be paid. The stale row is now retired and the handler
   continues. Reproduced live (409 → fix → `INVALID_STATUS` because that order had expired → stale-row fix →
   new PromptPay session → paid).

## Verification

- Live sandbox payment above (Stripe + Neon + webhook all consistent).
- `bun test backend/tests/checkout-payment-flow.test.ts` → 42 pass / 0 fail; checkout suites 45/17/0.
- `bun run typecheck` 4/4, `bun run build:apps` 4/4, backend `tsc` clean, `git diff --check` clean.
- Local full suite still shows the 8 documented Termux-only `test database guard` probes.

## Not covered yet

Refund (`charge.refunded`), webhook replay by Stripe, Connect payouts (`charges_enabled:false`), and the
card rail end-to-end (card entry cannot be automated in the WebView; the PromptPay QR was completed by the
owner in an external browser).
