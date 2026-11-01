# Stripe sandbox commerce E2E (2026-11-01) — PARTIAL

**Starting SHA:** `17d02af29e993ee017a4ef80908e2ee16555d71f` (working tree clean, `HEAD == origin/main`).
**Environment:** Stripe sandbox account `acct_1UKCn2Kp4iwMdWLy` ("แซนด์บ็อกซ์ Velnox"); every object read or
created reported `livemode: false`. Production API self-check reported `mode: "test"`,
`webhookConfigured: true`, `webhookSignatureSelfTest.verified: true`; methods `CARD` + `PROMPTPAY` enabled,
`COD` disabled, currency THB.

## What was actually executed

| Step | Result | Evidence |
|---|---|---|
| MCP connection | PASS | `get_stripe_account_info` → `acct_1UKCn2Kp4iwMdWLy` |
| Sandbox verification | PASS | all objects `livemode:false`; webhook endpoint `we_1UKSNu…` `livemode:false` |
| Webhook endpoint | PASS | `https://velnox-api.onrender.com/api/payments/stripe/webhook`, status `enabled`, events incl. `payment_intent.succeeded`, `payment_intent.payment_failed` |
| Test customer | PASS | `cus_VXvHJGDsqwtypE` (`velnox-sandbox-e2e+20261101@example.com`) |
| Test product | PASS | `prod_VXvH3QgFUvktwy` "Velnox Sandbox Test Product" |
| Test price | PASS | `price_1UWpRYKp4iwMdWLyoXpqwq9f` — 10000 THB minor units (100.00 THB), `one_time` |
| Checkout session | PASS (created, UNPAID) | `cs_test_a16NyZZypDKny7qt5x5oWH3u19lU81fYPz4lhrwZTDFKNv7fOJxDg2n1YY`, `amount_total 10000 thb`, `status open`, `payment_intent null` |
| Successful payment (new) | **BLOCKED** | see below |
| Failed payment (new) | **BLOCKED** | same cause |
| Refund | **BLOCKED** | no new successful payment exists to refund; historical payment is a real user's sandbox payment and must not be refunded without the owner |
| Connect | **NOT CONFIGURED (usable)** | one connected account `acct_1UKCpCKp4iBM4Vyz`: `details_submitted:false`, `charges_enabled:false`, capabilities `card_payments`/`transfers` = `inactive`; no transfer attempted |

## Blocker for D/E (exact)

The Stripe MCP surface exposes **read-only PaymentIntent operations** in this session: `PostPaymentIntents`
is rejected as "not available", and no confirm/capture operation exists in the discovered spec. Checkout
Session creation IS available, but confirming a hosted session needs a browser:

- the in-app browser loaded `checkout.stripe.com` but Stripe rendered **"This link is incomplete"** and
  exposed no interactive elements (hosted SPA check failed on the CSP-served page);
- Stripe's page also blocks `browser_eval` (CSP `script-src` without `unsafe-eval`), so the card iframe
  cannot be driven programmatically;
- no PaymentIntent was therefore created by this run (`payment_intent: null`), and none was confirmed.

No records were fabricated to work around it: a Neon check for the test session found
`test_payment_rows = 0`, `test_order_rows = 0`, `test_event_rows = 0`.

## Real integration evidence (historical, verified now — not created by this run)

A genuine sandbox purchase from 2026-10-31T18:18Z is present in both sides and matches exactly:

- Stripe PaymentIntent `pi_3UWgrNKp4iwMdWLy0QdDHuIa`: `status: succeeded`, `amount: 41930`, `currency: thb`,
  `payment_method_types: ["promptpay"]`, `livemode: false`.
- Velnox `payments` row `d4c540d9-…`: `amount 419.30`, `currency THB`, `method PROMPTPAY`, `status paid`,
  `provider_payment_id` = that PI, `provider_checkout_session_id` = `cs_test_b1Ideb…`,
  `paid_at 2026-10-31T18:18:46.071Z`.
- Velnox `payment_events` (all `status: processed`): `payment_intent.requires_action`
  `evt_3UWgrNKp4iwMdWLy0cvRcWDL`, `payment_intent.created` `evt_3UWgrNKp4iwMdWLy0wKKxwsz`,
  `payment_intent.succeeded` `evt_3UWgrNKp4iwMdWLy0atFPYv2`, `checkout.session.completed`
  `evt_1UWgrZKp4iwMdWLywNx29PlG`.
- Idempotency: `payment_events_event_id_key` is a UNIQUE index on `event_id`, so a replayed webhook cannot
  be processed twice; `attempt_count` is 0 on all four rows (first delivery succeeded).

This proves the real pipeline (Stripe → signed webhook → `payment_events` → `payments.status = paid`) with
production data, including PromptPay, without writing anything.

## Database

Read-only checks via Neon (no schema change, no writes): `payments` columns include
`provider_payment_id`, `provider_checkout_session_id`, `amount`, `currency`, `status`, `paid_at`,
`refund_status`; `payment_events` has `event_id` (unique), `event_type`, `status`, `processed_at`,
`attempt_count`, `next_retry_at`. Totals: `payments 1`, `payment_events 4`, `refunds 0`.

## Not verified

- A newly created successful card payment and its `payment_intent.succeeded` webhook for THIS run.
- A declined payment (`payment_intent.payment_failed`) for THIS run.
- `charge.refunded` handling for a new refund.
- Connect charges/transfers (account not onboarded; none attempted).

## Next steps

1. Enable a PaymentIntent create/confirm path (Stripe MCP operation or the Velnox `POST /api/stripe/checkout`
   with a disposable test order in a non-production database), then re-run D/E/F/G.
2. For a browser path, the hosted Checkout must be driven in a browser that can execute Stripe's scripts
   (the in-app WebView renders "link incomplete" and enforces CSP).
3. Refund test needs owner approval and a payment created for the purpose.
