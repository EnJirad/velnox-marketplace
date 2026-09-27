# AI Handoff archive — Stripe Sandbox/Test-Mode audit (2026-09-27)

**Archived 2026-09-27** out of `.ai/AI_HANDOFF.md` §27, verbatim, to keep the live
handoff editable (this environment's file-edit tools stop matching past roughly
55 KB in a file). Moved by the §28 pass (order-status contract fix), which
re-probed production and **superseded this pass's headline production claim** —
read the two "SUPERSEDED" notes below before quoting anything here as current.

Nothing was discarded. What is still live and actionable lives in the handoff:

- §27's owner action step (1) — configuring test mode in production — **is now DONE**
  (verified read-only 2026-09-27: `{configured:true, mode:"test", webhookConfigured:true}`,
  CARD + PROMPTPAY enabled).
- The sandbox round trip (PaymentIntent / PromptPay QR / webhook delivery / refund) is
  **still never executed**, here or elsewhere ⇒ **BLOCKED**, not PASS.
- Stripe Connect is **still MISSING** ⇒ `CHECKOUT READY` must never be read as
  `MARKETPLACE PAYOUT READY`.

---

## 27. Stripe Sandbox/Test-Mode audit — configuration is owner-gated, checkout code verified (2026-09-27)

**Outcome: audit PASS, sandbox E2E BLOCKED.** The existing implementation already satisfies
every property the brief lists, so **no code, schema or Stripe behaviour was changed** (no
defect found; the brief forbids redesign). This pass added the missing *configuration
documentation* plus freshly executed evidence.

**Credential gate (unchanged, re-confirmed).** `freebuff-env list` → `{"files":{}}` — this
workspace defines **no** environment keys, so no Stripe object, PaymentIntent, PromptPay QR,
webhook delivery or refund has ever been executed from here. `postgres`/`psql`/`docker` are
**absent in this workspace** (§18's disposable PostgreSQL belonged to a different, disposable
sandbox), so the 2 DB-gated payment tests skip locally and run in CI. **No live credential
exists anywhere:** the only `sk_live_`/`pk_live_` strings in the tree are zero-filled
placeholders in `payment-foundation.test.ts` and regexes in `payment-config.ts`, and a
242-commit `git log -S` scan adds nothing.

**Executed evidence (real processes + real HTTP, this workspace).**
- Probe of the real route stack with nothing configured: `GET /api/stripe/configured` → 200
  `{configured:false,mode:null,publishableKey:null,webhookConfigured:false,`
  `reason:"STRIPE_NOT_CONFIGURED"}`; `GET /api/payments/methods` → 200, `paymentMethods: []`,
  CARD/PROMPTPAY/COD all `enabled:false`, `cod:{enabled:false,customerSelectable:false}`; the
  webhook **refuses rather than acknowledging** an unverifiable event → **503**; both checkout
  endpoints answer **401** without a session cookie (auth precedes the method guard).
- `bun test backend/tests/payment-foundation.test.ts` → **59 pass / 2 skip / 0 fail**
  (61 tests, 160 assertions): live-key refusal, missing webhook secret = unavailable, COD
  fail-closed (absent / misspelled / quoted / arbitrary), 403 `PAYMENT_METHOD_DISABLED` on
  **both** checkout endpoints, unknown method → 400, webhook signature reject **and accept**
  (`constructEventAsync`), the PromptPay unpaid-session trap, refundable arithmetic, and
  line-item reconciliation against `orders.total_amount`.
- Full suite **573 pass / 87 skip / 0 fail** locally (660 tests, 32 files; the 87 skips are
  DB-gated — this workspace has no PostgreSQL) · backend `tsc` exit 0 · `bun run typecheck`
  4/4 exit 0 · `i18n:check` th=en=my=**1319** · `git diff --check` clean.
- **CI run `36305688863` on `4bf0002` — success (1m09s), disposable `postgres:16`: 658 pass /
  2 skip / 0 fail.** The two DB-gated payment cases that skip here **passed there**: *webhook
  idempotency — a duplicated event id is processed once and acknowledged twice*, and *a refused
  COD attempt writes nothing — neither checkout endpoint creates an order, payment, shipment,
  settlement, or request row*. The guard step printed **✅ Production database refused** and
  **✅ Disposable test database accepted**. ⇒ webhook idempotency and the COD-no-write proof are
  **AUTOMATED TEST VERIFIED** (CI, disposable database), not merely code-verified.
- **Production, read-only:** `/api/health` 200 · `/api/shops` **200 with real rows** ⇒ §22's
  provider suspension is **over** (the database serves again) · `/api/stripe/configured` 200
  `{"configured":false,…,reason:"STRIPE_NOT_CONFIGURED"}` · `/api/payments/methods` → all
  three methods `enabled:false`. **Production held no Stripe credential and offered no
  payment method: no live mode, nothing to leak, nothing touched.**
  → **SUPERSEDED the same day (§28):** the owner then completed the configuration, and
  production now offers **CARD + PROMPTPAY** with `{configured:true, mode:"test",
  webhookConfigured:true}`. Still no live credential anywhere.

**Change — documentation only (no code, no schema, no payment behaviour).**
`INSTALLATION.md` §4 and its *Backend (ALL secrets)* table plus `docs/ENVIRONMENT.md` now
name the variables the source actually reads — `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, `COD_ENABLED`, `COD_CUSTOMER_SELECTABLE`, and
`TEST_DATABASE_URL` — plus the webhook path and the 11 handled event types.
**`.env.example` still lacks them:** protected from agent edits, so it stays an owner edit.
`.ai/context/payment.md` gained the Connect finding.

**Stripe Connect: MISSING — not a defect of this task.** No connected account,
`accountLink`/onboarding, `transfer_data`/`application_fee`/`on_behalf_of`, seller↔Stripe
mapping, KYC state or Stripe payout exists; `payouts.process` was deliberately removed from
the permission catalog because no payout endpoint, table or screen exists
(`backend/lib/permissions.ts:28-29`, guarded by `center-rbac.test.ts`). Seller amounts are
internal accounting (`commissions`, `settlements`, `seller-stats.ts`). ⇒ **`CHECKOUT READY`
must never be read as `MARKETPLACE PAYOUT READY`.**

**Owner action to unblock the sandbox (2 steps).** (1) Stripe Dashboard → **Test mode** →
API keys → set `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`; add a **test** webhook to
`POST https://<backend-host>/api/payments/stripe/webhook` and set its `whsec_…` as
`STRIPE_WEBHOOK_SECRET`. (2) Re-run this pass: `GET /api/stripe/configured` must report
`configured:true, mode:"test"`, and only then do the Card / PromptPay / refund / webhook
round trips become executable. **Still standing:** §22's Neon Usage check (owner) and the
§14/§19 production E2E blocks. **Step (1) is now DONE — see §28.**
