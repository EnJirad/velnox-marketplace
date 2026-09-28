# Handoff §31 — PromptPay settlement diagnostic (2026-09-27) — archived 2026-09-28

Verbatim record of `.ai/AI_HANDOFF.md` §31 before it was replaced by a stub on
2026-09-28, to keep the live handoff small. Superseded for current state by
handoff §33 (the signature boundary made self-identifying) and by the live
`.ai/context/payment.md`; kept because it is the only record of the PromptPay
`enabled_events` / `payment_events` read that is still owner-side.

## 31. PromptPay settlement diagnostic — order stuck `pending_payment` (2026-09-27)

**Task:** explain why a customer's successful sandbox PromptPay payment left the order at
`pending_payment` / "รอชำระเงิน" with a "ชำระเงินต่อ" button instead of `paid`.
**Diagnostic only — no production code was changed** (the brief forbids fixing before the
root cause is classified, and every code-contract check passed).

**Verified from here (evidence):**
- Deployed backend: `GET /api/stripe/configured` → `{configured:true, mode:"test",
  webhookConfigured:true}`; `GET /api/payments/methods` → `CARD→card`,
  `PROMPTPAY→promptpay`, COD disabled. Test mode only; **no `STRIPE_*` credential exists in
  this workspace** (`freebuff-env list`: DATABASE_URL, Google, JWT, R2 only).
- `backend/routes/stripe.ts` has every settlement handler: `checkout.session.completed`
  guarded by `sessionConfirmsPayment` (an unpaid PromptPay completion never marks paid),
  `async_payment_succeeded` → `markPaymentSucceeded`, `async_payment_failed`,
  `expired`, `payment_intent.succeeded|payment_failed|canceled`; the session sets
  `metadata.orderId` **and** `payment_intent_data.metadata`. Local
  `payment-foundation.test.ts`: **59 pass / 2 skip / 0 fail**.
- Render runs **≥2026-09-25 code** (its responses carry `webhookConfigured` /
  `stripePaymentMethodType`, both introduced in `b806be1`), so the async handlers are live.
- Webhook endpoint probed live: no signature → 400 "Missing stripe-signature header";
  forged signature → 400 "Invalid signature" ⇒ route reachable, Stripe configured (a missing
  config answers 503 first) and `constructEventAsync` executes and rejects.
- §28 above: a production order moved `pending_payment → paid` "seconds after a successful
  test-mode checkout" the same day ⇒ endpoint URL, signing secret, handler and DB write
  path have **demonstrably worked at least once** — a global webhook failure is ruled out.
- The stuck order was created **2026-09-27 11:23:09Z** (public catalog `lastOrderedAt` on
  the only published product = `MAX(orders.created_at)` over its non-cancelled orders),
  i.e. minutes after the one-press checkout shipped (`cfee0bd`, 11:20Z).

**Classification (best fit, NOT final):** the global path works, so the failure is on the
**PromptPay-specific leg** — leading **B: `checkout.session.async_payment_succeeded` never
delivered** (its `enabled_events` selection is unknown from here; if the endpoint was
created with only `checkout.session.completed`, PromptPay can never settle — the full event
list was only documented in `docs/ENVIRONMENT.md` today, `86211a2`). Alternates: **A**
(the test payment never reached `payment_status=paid` on Stripe's side) and **E** (a
per-event handler failure recorded in `payment_events`). Ruled out: D/global signature or
wrong endpoint URL (§28 settled an order), H/I/J (nothing diverges below the DB), and any
application-code defect (the code both refuses the unpaid-session trap and would settle the
async event if it arrived).

**Blocked reads — both owner-side:**
1. **Stripe side.** No test key here ⇒ endpoint `enabled_events`, delivery attempts and the
   stuck session's real `payment_status` cannot be inspected. Unblock: add the **test**
   `STRIPE_SECRET_KEY` (`sk_test_…`) under Settings → Environment (it is never printed), or
   paste Dashboard → Developers → Webhooks → endpoint → enabled events + the delivery
   attempt (HTTP status/response) for the stuck session.
2. **Database side.** Every credential available here is refused by the provider 53000
   quota (§22): workspace `.env` `DATABASE_URL` **and** the Actions secret
   `NEON_DATABASE_URL` fail on pooler *and* direct endpoints (local trace + Actions run
   `36318662893`, 2026-09-27), while the deployed backend serves fresh DB reads ⇒ whether
   those URLs are even the project Render uses is itself an owner check. Unblock: restore
   the Neon quota, then re-run the trace workflow below.

**New tool (kept):** `.github/workflows/diag-stripe-payment-trace.yml` (commit `da39976`,
push-verified) — SELECT-only aggregates: payments by rail/status, the `payment_events`
delivery record by type/status, failed-handler errors, settlement mismatches. **Aggregates
only, because this repository is PUBLIC**; the secret is referenced as
`psql "$NEON_DATABASE_URL"` and never echoed. It triggers on push of the file itself
(`workflow_dispatch` is 403 for the app token). Its first run produced the quota evidence
above.

**Decisive next reads (any one settles B vs A vs E):** (i) does the Stripe endpoint list
`checkout.session.async_payment_succeeded` in `enabled_events`? (ii) does `payment_events`
contain any async row dated 2026-09-27? (iii) what is the stuck Checkout Session's
`payment_status`? Official PromptPay test procedure (docs.stripe.com/payments/promptpay):
in test mode click **Generate QR code**, scan it with any QR app, then **authorize** on the
Stripe-hosted test page — only that authorization completes the payment.

**Doc hazard spotted (recommendation, not fixed):** `INSTALLATION.md` (§4 example and the
`VITE_API_URL` table) uses `https://velnx-api.onrender.com`, which answers **404 on every
route**; the real backend — confirmed from the deployed `velshop.vercel.app` bundle — is
`https://velnox-api.onrender.com`. A Stripe webhook pointed at the `velnx` host would
deliver nothing.
