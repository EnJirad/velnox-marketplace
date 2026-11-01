# §112. Refund + replay tests green (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom.

## §112. Refund + duplicate-webhook replay are green in CI (2026-11-02)

**SHA:** `277a2b7`. **Report:**
[`.ai/history/2026-11-02-refund-webhook-replay-tests.md`](./history/2026-11-02-refund-webhook-replay-tests.md).

`backend/tests/payment-refund-replay.test.ts` (3 DB-gated tests, real routes + real HMAC signature): same
`succeeded` event twice → one `payment_events` row, `paid_at` unchanged, order paid; `charge.refunded` twice
→ one `refunds` row, payment stays paid, order not downgraded; forged signature → 400 and zero rows.
**CI: Tests #250 success, Production DB Verify #66 success** (disposable PostgreSQL). Two test-side defects
fixed on the way: Stripe config was read at import time (503 → dynamic import after env), and a pre-existing
order-number flake (`> 1800` hit exactly 1800 → `> 1700`). **No application code changed.** NOT TESTED:
partial refunds, out-of-order refund-before-success, and the admin refund endpoint's Stripe call.

---
