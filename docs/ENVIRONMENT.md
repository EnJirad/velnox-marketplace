# Environment Variables

## Frontend (Vercel)

Only one variable needed per app:

```
VITE_API_URL=http://localhost:3001/api
```

**NEVER put server secrets in frontend environment variables.**

## Backend (Render)

All secrets live here:

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | Neon PostgreSQL connection string | Yes |
| GOOGLE_CLIENT_ID | Google OAuth client ID | Yes |
| GOOGLE_CLIENT_SECRET | Google OAuth client secret | Yes |
| JWT_SECRET | JWT signing secret (64+ chars) | Yes |
| R2_ACCOUNT_ID | Cloudflare account ID | Yes |
| R2_ACCESS_KEY_ID | R2 API access key | Yes |
| R2_SECRET_ACCESS_KEY | R2 API secret key | Yes |
| R2_BUCKET | R2 bucket name | Yes |
| R2_PUBLIC_DOMAIN | R2 public URL | Yes |
| CORS_ORIGINS | Comma-separated allowed origins | Yes |
| PORT | Server port (default: 3001) | No |
| TEST_DATABASE_URL | Disposable PostgreSQL for the DB-gated tests — never production | No |
| STRIPE_SECRET_KEY | Stripe **test-mode** secret key (`sk_test_…`); a live key is refused | No — required for Card/PromptPay |
| STRIPE_PUBLISHABLE_KEY | Stripe test publishable key (`pk_test_…`), also returned to the browser | No |
| STRIPE_WEBHOOK_SECRET | Sandbox webhook signing secret (`whsec_…`); without it payments are unavailable | No |
| STRIPE_MODE | Must agree with the key (`test`) or the configuration is refused | No |
| COD_ENABLED | Cash-on-delivery rail (default OFF, fails closed) | No |
| COD_CUSTOMER_SELECTABLE | Offer COD in the storefront (default OFF) | No |
| VITE_VELSHOP_URL | VelShop URL — CORS + the Stripe Checkout return redirect | No |
| VITE_VELSELLER_URL | VelSeller URL — CORS | No |
| VITE_VELCENTER_URL | VelCenter URL — CORS | No |
| VITE_CORPORATE_URL | Corporate site URL — CORS | No |

## Stripe sandbox setup (TEST MODE ONLY)

1. Copy the sandbox keys from https://dashboard.stripe.com/test/apikeys into
   `STRIPE_SECRET_KEY` (`sk_test_…`) and `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`).
2. Add a **test** webhook endpoint pointing at
   `POST https://velnox-api.onrender.com/api/payments/stripe/webhook` — mind the
   host: `velnox-api`, because an endpoint pointed at the similar-looking
   `velnx-api` host delivers nothing at all — and copy **that endpoint's** signing
   secret (starts with `whsec_`) into `STRIPE_WEBHOOK_SECRET`.

   The secret must come from the endpoint's own page in the Dashboard.
   `stripe listen --forward-to <production-url>` signs with a **per-session CLI
   secret**, which is a different secret by design, so a forwarded event can
   never verify against the endpoint's secret and answers
   `400 Invalid signature` ("No signatures found matching the expected signature
   for payload"). That is expected behaviour, not a defect — and a CLI session
   secret must never be copied into production to make forwarding pass. Use the
   CLI for a **local** endpoint only, or `stripe trigger <type>` (without
   `--forward-to`) to make Stripe deliver to the configured endpoint itself.
   The implementation acts on: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `charge.refunded`, `refund.created`, `refund.updated`,
   `refund.failed`. Any other event is stored and ignored.
3. Verify with `GET /api/stripe/configured` → `configured: true`, `mode: "test"`,
   and `GET /api/payments/methods` → `CARD` and `PROMPTPAY` enabled, `COD` disabled.
   PromptPay needs a THB order and the PromptPay capability on the Stripe account.

   Two more checks make the signature path itself provable without reading any
   secret:

   * `GET /api/stripe/configured` → `webhookSecretHealth.shapeUsable: true`. The
     report is shape-only (`whsec_` prefix, a coarse length bucket, wrapping
     quotes, interior whitespace) so no character of the value is derivable from
     it. `shapeUsable: false` means every delivery will answer 400 until the
     value is replaced even though `webhookConfigured` reads `true`.
   * `GET /api/stripe/configured?selfTest=1` →
     `webhookSignatureSelfTest.verified: true`. It signs a throwaway payload with
     the deployed secret and verifies it through the same call the webhook uses,
     which separates "this secret did not sign that delivery" from "this
     deployment cannot verify any signature" (a code defect).

   The authoritative end-to-end proof is still a real delivery: Dashboard →
   Developers → Webhooks → the endpoint → recent delivery attempts must show a
   `2xx`, and the `payment_events` row is written before the handler dispatches,
   so a 2xx without a row (or a 400) is itself evidence about where it stopped.

A local run can use `stripe listen --forward-to localhost:3001/api/payments/stripe/webhook`
and its printed `whsec_…` instead of a dashboard endpoint.

**Stripe Connect / marketplace payouts do not exist in this repository** — the platform
charges the customer through its own Stripe account; seller amounts are internal
accounting (`commissions`, `settlements`, `backend/lib/seller-stats.ts`), not Stripe
transfers. Do not assume payout readiness.

## Security Rules

- Never commit .env files
- Never put DATABASE_URL, JWT_SECRET, or R2 secrets in frontend code
- Use VITE_ prefix ONLY for VITE_API_URL
- Backend reads secrets via process.env
