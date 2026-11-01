# Payment & Checkout Roadmap — handoff for review (2026-11-02)

> **Purpose:** everything a reviewer (human or another agent) needs to audit the payment work and write
> the next instructions. Written from verified evidence only. Secrets are deliberately absent.

---

## 0. Snapshot

| Item | Value |
|---|---|
| Repo | `https://github.com/EnJirad/velnox-marketplace.git` |
| Branch / HEAD | `main` · **`3b96fc4`** (`HEAD == origin/main`, working tree clean) |
| Backend | Render `velnox-api` → `https://velnox-api.onrender.com` (single instance, free plan, auto-deploy on `main`) |
| Frontends | `https://velshop.vercel.app`, `https://velseller.vercel.app`, `https://velcenter.vercel.app` |
| Database | Neon project `wandering-glitter-94857012`, PG 18, **MCP is READ-ONLY** |
| Stripe | Sandbox account `acct_1UKCn2Kp4iwMdWLy` ("แซนด์บ็อกซ์ Velnox"); every object `livemode:false` |
| Webhook endpoint | `we_1UKSNuKp4iwMdWLydX57ivxS` → `https://velnox-api.onrender.com/api/payments/stripe/webhook` (enabled) |
| Payment methods | `CARD` + `PROMPTPAY` enabled, `COD` disabled, currency THB |
| Signature self-test | `GET /api/stripe/configured?selfTest=1` → `webhookSignatureSelfTest.verified: true` |

### Environment limits (important for instructions)

1. **Neon MCP cannot write** — any `INSERT/UPDATE` answers `cannot execute SELECT in a read-only transaction`.
   Test data must be created **through the product APIs** (seller → admin moderation → customer checkout).
2. **Chrome DevTools MCP is unusable** — every call returns
   `Cannot download a binary for the provided platform: android (arm64)`. Use the in-app WebView browser
   (`browser_navigate`) instead; it cannot run Stripe Checkout interactions because Stripe's page is
   React-controlled and its CSP blocks `browser_eval` (`unsafe-eval` not allowed).
3. **Local PostgreSQL cannot start** — PG18 `initdb` hangs at `postgres --boot` in this Android sandbox
   (`--describe-config` works). DB-gated suites therefore run **only in CI** (disposable PostgreSQL).
4. **Card entry needs a human** in a real browser; PromptPay QR was completed by the owner externally.

---

## 1. What is already DONE (verified)

### 1.1 Payment fixes shipped

| Commit | Change | Why |
|---|---|---|
| `f4e8bb1` | Rail switch: expire the abandoned open session, cancel its payment row, mint a session for the chosen rail | Choosing CARD while an open PromptPay session existed answered `409 DUPLICATE_PAYMENT_IN_PROGRESS` with no way forward |
| `3e2afff` | Retire a payment row whose session is already `expired`/`cancelled` | An expired session kept `idx_payments_one_active_stripe` occupied → every later attempt 409 forever |
| `e5971cb` | Support Inbox (`type=support`) + `support` unread aggregate | Company needed an explicit support inbox |
| `9150048` | VelCenter image bubble, chat out of the bell, latest-unread preview | Image never rendered outside the SYSTEM branch |

### 1.2 End-to-end money proof (real sandbox payment)

```
buyer 884291e5…  ──POST /api/customer/checkout (buyNow)──►  order 88e51b37-8c83-4c6f-9cad-e18dc5981458
                                                             017935129027587968 · 100.00 THB · shop 110b1b7d…
POST /api/stripe/checkout (PROMPTPAY) ──► session cs_test_b1TwafRBO2WBwNzxpbE24J819UyVOaXKGnZzlDlkcSfnZjgc1miqaJA5zz
Stripe: status=complete · payment_status=paid · PI pi_3UWrqaKp4iwMdWLy13JnX3kE · amount 10000 · thb
Neon:   payments 3976d03a-d8a4-4559-9ea2-352f718d681d → paid · paid_at 2026-11-01T06:03:05.970Z
        orders.status = paid   (order_state pending, fulfilment unfulfilled — correct)
Webhooks (all `processed`, attempt_count 0):
        payment_intent.requires_action   evt_3UWrqaKp4iwMdWLy1bKQxtJE
        payment_intent.created           evt_3UWrqaKp4iwMdWLy1ifp32Kk
        payment_intent.succeeded         evt_3UWrqaKp4iwMdWLy1En9SMEy
        checkout.session.completed       evt_1UWrrBKp4iwMdWLyEqyusvgu
Idempotency: payment_events_event_id_key UNIQUE(event_id) → replay is safe
```

Test data handling: product `082d513b-6aa5-4d70-a56b-039afbb2c1df` ("Velnox Sandbox Test Product", 100 THB)
was created through the seller API, approved by moderation, then **suspended** with a reason. The paid test
order was intentionally **kept** as financial evidence.

### 1.3 Earlier payment evidence (same pipeline, PromptPay)

`pi_3UWgrNKp4iwMdWLy0QdDHuIa` (`succeeded`, 41930 thb) ↔ `payments d4c540d9-…` (`paid`, 419.30 THB) ↔
4 `payment_events` (`created`/`requires_action`/`succeeded`/`checkout.session.completed`).

---

## 2. Test results (actual commands & numbers)

| Check | Command | Result |
|---|---|---|
| Apps typecheck | `bun run typecheck` | PASS 4/4 |
| Backend typecheck | `cd backend && bunx tsc --noEmit` | PASS |
| Builds | `bun run build:apps` | PASS 4/4 |
| i18n parity | `bun run i18n:check` | OK — 1280 keys × 3 locales |
| Checkout suites | `bun test backend/tests/checkout-payment-flow.test.ts backend/tests/checkout-group-session-open.test.ts` | 45 pass / 17 skip / 0 fail |
| Chat parity | `bun test backend/tests/chat-parity.test.ts` | 8 pass / 0 fail |
| Full suite (local) | `bun test backend/tests` | 8 fail — **all** the documented Termux-only `test database guard` probes |
| Full suite (CI, disposable PG) | Production DB Verify #59 | **1489 pass / 0 fail / 1491 tests** |
| CI workflows | Tests #235–#238, Production DB Verify #59/#60 | PASS (production schema + identity verified) |
| Webhook signature | `GET /api/stripe/configured?selfTest=1` | `verified: true` |

**NOT RUN (and why):** browser E2E for chat (no session in that task), card checkout completion (WebView
cannot type into Stripe), refund (needs approval + a fresh successful payment), Connect transfers
(`charges_enabled:false`), Chrome DevTools MCP (platform binary unavailable).

---

## 3. Remaining backlog — P1 … P5

Legend: **files** = expected touch points; **accept** = observable done-ness; **test** = required evidence.

### P1a — payment UX polish (mostly already present)

`ResumePaymentButton.tsx` already offers CARD/PROMPTPAY from `/api/payments/methods`; `MyOrders.tsx` already
shows a per-order deadline from `paymentExpiresAt`. The rail switch now works end-to-end at the API level.
**Remaining:** show the countdown on the order **detail** page too, and map backend error codes
(`INVALID_STATUS`, `DUPLICATE_PAYMENT_IN_PROGRESS`) to human copy instead of a generic failure toast.
**Files:** `apps/velshop/src/pages/ShopOrderDetail.tsx`, `ShopCheckout.tsx`, i18n patch objects.
**Accept:** expired order shows "หมดเวลาชำระ" + one tap to a new attempt; a 409 shows the existing session
link rather than a dead end. **Test:** typecheck/build + structural assertions; browser check by owner.

### P1b — saved cards / one-tap (needs schema)

**Why:** today every payment re-enters a card. Lazada/TikTok keep a saved method per customer.
**Design:** Stripe Customer per user (already created by Checkout `customer_creation:always`), then
`SetupIntent` + `saved_payment_method_options` on the session; store only `provider_customer_id` +
`default_payment_method_id` (never PAN). Add to `payments` or a new `payment_methods` table **with
`db/schema.sql` + `db/run-sqleditor.sql` updated together** (AGENTS rule 4).
**Files:** `backend/routes/stripe.ts`, `backend/routes/upload.ts` (none), `db/*.sql`, checkout UI.
**Accept:** second purchase can pay with the stored method without re-entry; revocation path exists.
**Test:** disposable-PG suite + owner browser run (card entry is human-only).

### P1c — inline PromptPay QR (highest UX impact, architecture change)

**Problem:** Stripe **hosted Checkout** redirects; the QR is not exposed to us.
**Design:** add `POST /api/stripe/promptpay-intent` that creates a PaymentIntent
(`payment_method_types:["promptpay"]`), returns `next_action.promptpay.display_qr_code` (image) +
`expires_at`, and a `GET …/status` for bounded polling (max ~10 min, stop on terminal state). Keep the
Checkout path as fallback. Settle **only** through the existing signature-verified webhook — no client-side
"paid".
**Files:** `backend/routes/stripe.ts` (new handlers + reuse `settleCheckoutGroup`), `apps/velshop/src/pages/
ShopCheckout.tsx` (QR panel + countdown), `ResumePaymentButton.tsx`.
**Accept:** QR rendered in-app, countdown, auto-detect success, same DB result as the verified E2E.
**Test:** unit/structural + disposable-PG webhook simulation using Stripe test keys (CI has none → the
owner must complete one QR in sandbox). **Risk:** medium-high; do it behind a flag if possible.

### P2 — money reliability

- Refund: `POST /api/admin/orders/:orderId/refund` already exists; verify `charge.refunded` →
  `payments.refund_status` with a real sandbox refund (**needs owner approval**, must be a payment created
  for the test, not a user's).
- Webhook replay: re-deliver an event from the Stripe dashboard (or `stripe events resend`) and prove no
  duplicate `payments`/`orders` transition (UNIQUE `event_id` already guarantees the insert).
- Abandoned attempts: a scheduler already expires unpaid orders; add an assertion that the payment row is
  cancelled at the same time (partially covered by `3e2afff`).

### P3 — commerce parity

- **COD per shop** — `isCodCustomerSelectable()` exists but the rail is globally off; make it per-shop with
  a seller setting and an explicit "seller confirms payment" transition.
- **Shipping options** — one flat fee today; add per-shop methods (standard/express) with an ETA and a
  server-side recalculation of the order total.
- **Order timeline** — expose `order_state`/`fulfillment_status` transitions + `payment_events` as one
  customer-visible timeline (no new tables; it is already stored).
- **Receipt** — printable summary (order number, method, PI reference) — no new storage.

### P4 — Stripe Connect (marketplace payouts)

`acct_1UKCpCKp4iBM4Vyz` exists but `details_submitted:false`, `charges_enabled:false`, capabilities
`card_payments`/`transfers` = `inactive`. Needed: onboarding link, decide **destination charges** (single
payment, `transfer_data.amount` = seller share, platform fee) vs **separate charges & transfers**; then
`application_fee_amount` policy and payout reporting. **Do not modify account settings without owner.**

### P5 — observability

Payment dashboard from `payments` + `payment_events`: counts by status, stuck `processing`, webhook backlog
(`idx_payment_events_backlog` already exists), and an alert threshold. Read-only queries only.

---

## 4. Rules the next agent must keep

1. Never write to production Neon outside product APIs; never delete financial rows.
2. Never bypass webhook signature verification or mark an order paid from a client.
3. Keep one payment pipeline: `payments` + `payment_attempts` + `payment_events` + `checkout_requests`.
4. Schema change ⇒ update **both** `db/schema.sql` and `db/run-sqleditor.sql`; verify via the workflow.
5. Amounts are THB minor units in Stripe (×100); never trust a client-supplied total.
6. Document every session in `.ai/history/` and update `.ai/AI_HANDOFF.md` (keep it < ~55 KB).
7. Report `NOT RUN` rather than inferring success; card entry and QR need a human browser.

---

## 5. Suggested next actions (for the reviewer)

1. Confirm P1c design (PaymentIntent + in-app QR) or keep hosted Checkout and skip inline QR.
2. Decide P1b scope: saved card storage needs a schema change and a Stripe Customer migration path.
3. Approve a **dedicated** sandbox payment for the refund test (never refund a real user's payment).
4. Enable Connect onboarding only if marketplace payouts are in scope for launch.
