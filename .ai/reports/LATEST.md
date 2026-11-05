# Stripe purchase flow — production E2E, root cause, live-mode opt-in

Date: 2026-11-05 14:40 +07 (Asia/Bangkok) · Branch `main` · AI 01 (AndroidHarness)
**Starting SHA:** `f75f8637c5d0b66421f68e71286505e5ffdc27af` (= `origin/main`, clean tree)
**Final SHA:** the commit that carries this report (`git log -1`).

## 1. Status summary (read this first)

| Area | Status |
|---|---|
| Shipping quote in production | **WORKS** — ฿35.00 flat, total ฿384.30 |
| Order creation (`POST /api/customer/checkout`) | **WORKS** — order `017938632216913506`, ฿384.30 |
| Stripe Checkout Session (`POST /api/stripe/checkout`) | **WORKS** — 200 + `session.url`, card rail, `test` mode |
| Stripe hosted card page | **REACHABLE** (form rendered, test mode) |
| Completing the card form in this environment | **BLOCKED** — in-app browser surface is hidden and drops keystrokes |
| Live (real-money) payments | **NOT ENABLED** — production runs `mode: "test"`; code now supports live behind an explicit opt-in |
| Backend `payment-foundation` suite | **PASS** — 70 pass / 2 skip (skips need `TEST_DATABASE_URL`) |

**The purchase chain is not broken.** Production is deliberately running Stripe in
**test mode**, so a real card or a real PromptPay scan cannot complete — that is
the behaviour the owner read as “Stripe does not work”.

## 2. What was inspected before changing

- `backend/lib/payment-config.ts` — `stripeStatus()`, `classifyStripeSecretKey()`,
  `paymentMethodOptions()`, `assertPaymentMethodUsable()`
- `backend/routes/stripe.ts` — `POST /api/stripe/checkout`, webhook handlers
- `backend/routes/cart.ts` — `POST /api/customer/checkout`, cancel route
- `apps/velshop/src/pages/ShopCheckout.tsx` — quote → checkout → session redirect
- Production API probes with the owner session (`.ai/secrets/browser-cookies.json`,
  values never printed):
  - `GET /api/auth/me` → owner account, 200
  - `GET /api/stripe/configured` → `configured: true`, `mode: "test"`, `pk_test_…`
  - `GET /api/payments/methods` → `CARD`, `PROMPTPAY` enabled; `COD` disabled
- Render logs (`srv-da5dg76417fc73f3krkg`) and Stripe events for the last days:
  earlier attempts succeeded only in test mode (`cs_test_…`, `paid`), and production
  logs at 06:48 UTC show a full settlement (`1/1 orders paid`).

## 3. Executed production end-to-end (evidence)

1. `POST /api/customer/shipping/quote` → `quoteId c0213e12…`, subtotal `349.30`,
   shipping `35.00`, total `384.30`, reason `platform_default`.
2. `POST /api/customer/checkout` (CARD, buyNow one variant) → **200**,
   order `38f35b47-56bf-4cf8-9604-a15ca6ce30ee` / `017938632216913506`,
   `shippingFee 35.00`, `total 384.30`.
3. `POST /api/stripe/checkout` (same group, CARD) → **200**,
   `sessionId cs_test_b17cMkvkiQOucuEqne2NII2QWGf7XCnmUMtFD5bkH1izxiO293b7vJ9MJ4`,
   `url checkout.stripe.com/...`, `stripeMode: "test"`, amount `384.30`.
4. Opened that URL in the in-app browser: Stripe hosted page rendered in Thai with
   the card form (number/expiry/CVC/name/country) and the ฿384.30 total. Typing
   could not be committed — `Surface: hidden; focused: false`; every field reported
   “ต้องป้อนข้อมูล” after submit, and `browser_screenshot` refuses while hidden.
   **No card charge was attempted.**
5. Cancelled the test order through the customer API (`PATCH …/cancel`) →
   **200** `{cancelled:true, stockReleased:true}`. Database read-back:
   order `cancelled`, variant stock back to `29`, payment `cancelled`.
   No test order, reservation or stock lock was left behind.

## 4. Root cause

Production's Stripe configuration is **test mode** (`sk_test_…` + `pk_test_…` on the
sandbox account `acct_1UKCn2Kp4iwMdWLy`, “แซนด์บ็อกซ์ Velnox”). In test mode Stripe
rejects every real card and a real PromptPay QR cannot be scanned, so no genuine
purchase can complete. This was enforced in code as a hard policy: `stripeStatus()`
refused any `sk_live_` key outright.

## 5. What changed

| File | Change |
|---|---|
| `backend/lib/payment-config.ts` | live mode is now an **explicit opt-in**: a live key is used only when `STRIPE_ALLOW_LIVE` is exactly `true`/`1` **and** `STRIPE_MODE=live` and a webhook secret exists. New `isLiveModeAllowed()`. Test mode unchanged and still the default. A late live key is never enough on its own. |
| `backend/tests/payment-foundation.test.ts` | +4 configuration cases: live refused with either opt-in missing, usable with both + webhook, and refused when a live key has no webhook secret. |
| `apps/velshop/src/pages/ShopCheckout.tsx` | shows an amber **test-mode notice** under the payment methods when the backend reports `stripe.mode = "test"`, so a sandbox charge is never mistaken for a sale. |
| `packages/shared/src/lib/i18n/locales/index.ts` | `checkout.testModeNotice` in th/en/my (parity 1704 keys). |
| `.ai/context/payment.md` | header/rule/verification updated to “test by default, live by explicit opt-in” + the executed production round trip. |

Nothing removed. No new endpoint, table, provider or mock.

## 6. Why this shape (and not “just turn on live”)

A live secret key pasted into Render would otherwise begin charging real cards with
no second confirmation. Two independent switches (`STRIPE_ALLOW_LIVE` +
`STRIPE_MODE=live`) plus the existing webhook-secret requirement mean:

- a mistaken paste of a live key stays refused (`STRIPE_LIVE_KEY_REFUSED`);
- a declared mode that disagrees with the key stays refused (`STRIPE_MODE_MISMATCH`);
- live without a webhook secret is refused, because a payment that cannot be
  confirmed from the provider must never be taken.

## 7. Tests executed (this session)

| Command | Result |
|---|---|
| `bun test ./backend/tests/payment-foundation.test.ts` | **PASS** — 70 pass, 2 skipped (DB-gated), 0 fail |
| `bun run i18n:check` | PASS — th=1704, en=1704, my=1704 |
| `bun --filter @velnox/velshop typecheck` | PASS (exit 0) |
| `bun --filter @velnox/backend typecheck` | PASS (exit 0) |
| Production API round trip (§3) | Executed; quote/checkout/session 200, card form reached, test order cancelled |
| Completing the hosted card form | **BLOCKED** (hidden browser surface) |
| Live-mode charge | **NOT RUN** (no live credentials; by design) |

## 8. Systems confirmed unaffected

- Order money is still derived server-side (`orders.total_amount` → line items); the
  diff touches configuration + presentation only.
- Webhook settlement, idempotency, reservation expiry and inventory release were
  not modified; the cancel path executed and released stock correctly.
- COD stays disabled; no COD flag changed.

## 9. Limitations / not verified

- The hosted card form was **not submitted** in this environment. Test card
  `4242 4242 4242 4242` (expiry any future date, CVC any 3 digits) is the documented
  test credential, but the browser surface here cannot hold focus.
- No live key exists for this project's Stripe account (it is a sandbox account), so
  live mode could not be exercised.
- `STRIPE_ALLOW_LIVE` / `STRIPE_MODE` on Render are unset; production therefore
  remains test mode exactly as before.

## 10. Work still open (owner action to accept real money)

1. Activate the Stripe account for live payments (the connected account is a sandbox).
2. In Render, set live credentials for `velnox-api`:
   `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_PUBLISHABLE_KEY=pk_live_…`,
   `STRIPE_WEBHOOK_SECRET=whsec_…` (from the LIVE webhook endpoint pointing at
   `https://velnox-api.onrender.com/api/payments/stripe/webhook`),
   `STRIPE_MODE=live`, `STRIPE_ALLOW_LIVE=true`.
3. Redeploy and check `GET /api/stripe/configured` → `mode: "live"`, `configured: true`.
4. Run one small real purchase, confirm the webhook marks the order `paid`, then refund it.
5. Optional follow-up: hide/soften the test-mode notice once live is on (it disappears
   automatically because it only renders when `mode === "test"`).

## 11. What the next agent must know first

- **Never** claim Stripe is broken based on a failed real card while `mode` is
  `test`; call `GET /api/stripe/configured` first. Test mode cannot charge real money.
- Live mode needs BOTH `STRIPE_ALLOW_LIVE` and `STRIPE_MODE=live`; removing either
  reverts to fail-closed.
- The owner session used for testing lives in `.ai/secrets/browser-cookies.json`
  (gitignored, never print). The test order created and cancelled this session was
  `017938632216913506`; nothing was left reserved.
