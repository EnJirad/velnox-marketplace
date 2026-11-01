# §104. Payment rail switching (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §104. Payment rail switching no longer dead-ends (2026-11-01) — PARTIAL

**SHA:** `a373832` → this commit. **Report:**
[`.ai/history/2026-11-01-payment-rail-switch-recovery.md`](./history/2026-11-01-payment-rail-switch-recovery.md).

A purchase with an open PromptPay session answered CARD with `409 DUPLICATE_PAYMENT_IN_PROGRESS` and no way
forward. Now the abandoned open session is expired (no money moved), its payment row moves to `cancelled`
(freeing `idx_payments_one_active_stripe`), and a session for the chosen rail is minted; if Stripe refuses
the expiry the honest 409 remains. Same-rail reuse, the durable request claim and webhook authority for
`paid` are unchanged. Verified: checkout suites 45 pass/17 skip/0 fail, typecheck 4/4, build 4/4. The
live rail switch is **NOT VERIFIED end-to-end** (card entry cannot be automated in the WebView).

---
