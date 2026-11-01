# §103. Stripe sandbox commerce E2E (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §103. Stripe sandbox commerce E2E (2026-11-01) — PARTIAL

**SHA:** `17d02af` (no code change). **Report:**
[`.ai/history/2026-11-01-stripe-sandbox-e2e.md`](./history/2026-11-01-stripe-sandbox-e2e.md).

Sandbox verified (`acct_1UKCn2Kp4iwMdWLy`, every object `livemode:false`); MCP connected; webhook endpoint
enabled with signature self-test `verified:true`. Created disposable customer `cus_VXvHJGDsqwtypE`, product
`prod_VXvH3QgFUvktwy`, price 100.00 THB, and Checkout Session `cs_test_a16Ny…` (open, unpaid).

**BLOCKED for payment completion:** this MCP exposes PaymentIntent READ only (`PostPaymentIntents` →
"not available"), and hosted Checkout cannot be driven here — the WebView renders "This link is incomplete"
with no interactive elements and Stripe's CSP blocks `browser_eval`. No PaymentIntent was created or
confirmed, and nothing was fabricated (`payments/orders/payment_events` rows for the test session: 0/0/0).

**Real pipeline proven from history (read-only):** PromptPay PI `pi_3UWgrNKp4iwMdWLy0QdDHuIa`
(`succeeded`, 41930 thb) ↔ `payments` row `d4c540d9-…` (`paid`, 419.30 THB) with four processed
`payment_events` (`payment_intent.created/requires_action/succeeded`, `checkout.session.completed`);
`payment_events_event_id_key` is UNIQUE ⇒ webhook replay is idempotent. Connect: one account,
`charges_enabled:false`, not onboarded ⇒ **NOT CONFIGURED**. Refund not attempted (no new payment; would need
explicit owner approval).

---
