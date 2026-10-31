# §93. Checkout → Order → Payment verification (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-01 to keep the live handoff under this
> environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §93. Checkout → Order → Payment verification (2026-10-31) — VERIFIED, PARTIAL

**SHA:** `fc61741` (`HEAD == origin/main`, clean). **Report:**
[`.ai/history/2026-10-31-checkout-payment-verification.md`](./history/2026-10-31-checkout-payment-verification.md).

Production probed read-only: `/api/stripe/configured?selfTest=1` → `mode:"test"`, `webhookConfigured:true`,
`webhookSignatureSelfTest.verified:true`; `/api/payments/methods` → CARD+PROMPTPAY enabled, **COD disabled**.
21 payment/checkout files run individually: **335 pass / 168 skip / 0 fail** (skips = `hasTestDatabase()`, no
`TEST_DATABASE_URL` here). `typecheck` 4/4, backend `tsc`, `build:apps` 4/4, `i18n` 1265/1265/1265, diff
clean. CI on this SHA (run `41145382171`) = **1458 pass / 2 skip / 0 fail** over 74 files.

Paths traced, not assumed: `cart.ts:703` checkout · `:116` order+group · `:1052` groups · `:1138` stock;
`stripe.ts:2053` session · `:736` idempotency · `:2225` expired reservation · `:2546` webhook (`:217`
signature) · `:1773` PromptPay async · `:1053` settlement · `:2713` refund covering-set. **No defect
proven.** Real card/PromptPay/refund/webhook E2E and the 168 DB-gated cases are **BLOCKED** on missing test
keys and a disposable database → **PARTIAL**, not PASS.

---

