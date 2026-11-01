# Refund + duplicate-webhook replay harness — NOT IMPLEMENTED (2026-11-02)

**Status:** BLOCKED (agent session limit), no code written, nothing pushed from this task.
**HEAD at the time:** `7f65953` · working tree clean.

## What was asked

Automated tests, on a disposable PostgreSQL, for:
1. the same signed Stripe event delivered twice → one `payment_events` row, `paid_at` stable, order state
   applied once;
2. refund lifecycle (`charge.refunded`, duplicate delivery, `refund_status`, no duplicate refund rows, order
   not downgraded);
3. invalid signature rejected, no client-side refund/paid writes, financial history preserved.

## Why it was not implemented in this session

- Every existing webhook test builds its **own** express harness (`stripeWebhookRawBody` + HMAC
  `t=…,v1=…` + hand-built fixtures): see `multi-shop-checkout.test.ts` (`deliverIntentSucceeded`),
  `payment-attempt-identity.test.ts`, `late-payment-incidents.test.ts`, `customer-order-cancel.test.ts`.
- A new harness must reproduce the exact NOT NULL shape of `orders` / `payments` and the
  seller→shop→order fixture chain. Getting that wrong produces a red CI run, which is worse than not
  shipping the file — and this device cannot run it locally (no disposable PostgreSQL; PG18 `initdb` hangs
  in the Android sandbox).
- Remaining context in the session was insufficient to write, run, push and confirm CI green.

## What IS already verified about these paths (structural, not behavioural)

| Fact | Evidence |
|---|---|
| Event idempotency is a DB rule | `payment_events_event_id_key` UNIQUE + `ON CONFLICT (event_id) DO NOTHING` |
| Duplicate success cannot re-stamp money | `paid_at = COALESCE(paid_at, NOW())`, attempt UPDATE guarded by `status <> 'failed'` |
| Refund endpoint exists and is auth-guarded | `POST /api/admin/orders/:orderId/refund` (`requireAuth`) |
| Live production shows no stuck rows | 0 unprocessed `payment_events`, 0 paid orders without a paid payment |

**NOT TESTED:** duplicate delivery, refund lifecycle, invalid-signature rejection — at the database level.

## Ready-to-implement spec (next session)

1. New file `backend/tests/payment-refund-replay.test.ts`; `const testFn = hasTestDatabase() ? test : test.skip;`
2. Fixtures via `query` from `../db/index.js` + `purgeUsers` in `afterAll`:
   customer user → seller user (`sellers` approved) → `shops` → `orders` (with `checkout_group_id`) →
   `payments` (`provider='stripe'`, `provider_payment_id='pi_test_…'`, `status='requires_action'`,
   `method='CARD'`, `amount`, `currency='THB'`).
3. `postWebhook(payload, eventId)` helper: express app → `stripeWebhookRawBody` → `setupStripeRoutes` →
   `createHmac("sha256", WEBHOOK_SECRET)` over `${t}.${payload}`; header `stripe-signature: t=…,v1=…`.
4. Duplicate test: same `evt_…` id twice → `SELECT COUNT(*) FROM payment_events WHERE event_id=$1` = **1**,
   `payments.status='paid'`, `paid_at` unchanged between calls, `orders.status='paid'`.
5. Refund test: `charge.refunded` twice (same event id) → one refund row, `payments.refund_status` set once,
   order status unchanged (no downgrade).
6. Security: wrong signature → HTTP 400 and no new rows.
7. Verify: `bun test backend/tests` locally (skips without DB), push, then confirm the CI
   **Production DB Verify** run (disposable PostgreSQL) before reporting PASS.

## Recommended order

This harness → browser card success/failure matrix (human) → `velnox.com` DNS.
