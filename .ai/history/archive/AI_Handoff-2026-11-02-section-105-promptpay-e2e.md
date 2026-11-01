# §105. Stripe sandbox PromptPay E2E (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §105. Stripe sandbox PromptPay E2E — PASS (2026-11-01)

**SHA:** `f4e8bb1` → `3e2afff` → this docs commit. **Report:**
[`.ai/history/2026-11-01-stripe-promptpay-e2e-success.md`](./history/2026-11-01-stripe-promptpay-e2e-success.md).

Real 100.00 THB purchase through the backend: order `88e51b37…` → Stripe session `cs_test_b1TwafRB…`
`complete/paid` → PI `pi_3UWrqaKp…` → Neon `payments` `paid` → **`orders.status = paid`**, with four processed
`payment_events` (`requires_action`, `created`, `succeeded`, `checkout.session.completed`) and no duplicates
(UNIQUE `event_id`). Test product `082d513b…` retired via moderation `suspended`; paid orders kept as evidence.

Two defects were fixed on the way: rail switch dead-ended on 409 (`f4e8bb1`) and an expired session kept its
payment row active forever (`3e2afff`). Next: P1 payment UX (inline PromptPay QR + countdown).

---
