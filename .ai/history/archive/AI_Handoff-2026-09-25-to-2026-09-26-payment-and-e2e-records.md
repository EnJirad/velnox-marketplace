# Velnox Handoff — archive: §15–§20 (payment foundation, Stripe E2E records, CI guard, readiness audit, moderation queue)

Moved out of `.ai/AI_HANDOFF.md` on **2026-10-06** during the payment/checkout/order
rebuild (handoff edit-ceiling housekeeping — the live file was at 54.3 KB against the
~55 KB match limit).

**Verbatim.** Nothing was reworded, corrected or summarised; this is the text exactly as
it stood in the handoff. Reference only — the repository is always authoritative.
Still-live claims from these sections are restated in `.ai/AI_HANDOFF.md` §15–§20
(consolidated pointer) and in `.ai/context/payment.md`.

---

## 15. Payment foundation — Stripe test mode, Card + PromptPay, COD OFF (TASK 005, 2026-09-25)

**Archived** (full text) → [`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
Live reference: [`.ai/context/payment.md`](context/payment.md) — read that, not this line.

Built ON the existing Stripe code (V0023) — no second payment system, no duplicate table.
**Stripe: TEST MODE ONLY; COD stays disabled.** The audit found the pre-existing code unsafe
(no PromptPay, no idempotency, sync `constructEvent`, any key accepted, `payment_events` marked
seen before processing, COD as the checkout DEFAULT, `refunds` a table with no code) and
`backend/lib/payment-config.ts` became the ONE decision point: test-mode-only key classification,
fail-closed COD flags, Card + PromptPay checkout, `constructEventAsync`, DATABASE-BACKED
idempotency (`checkout_requests` + `idx_payments_one_active_stripe` + atomic `payment_events`
claim/re-arm), separate order↔payment lifecycles, and refunds capped at the paid amount
(`orders.manage`). Schema: migration 047 + both canonical files; `run-update.sql` **not** created.

---

## 16. Stripe TEST-mode E2E verification (TASK 006, 2026-09-25) — **BLOCKED**

**Status: BLOCKED — Stripe TEST credentials unavailable** (unchanged). `freebuff-env
list` → `{"files":{}}`; no Stripe API call, PaymentIntent, PromptPay QR, webhook
delivery or refund has ever been executed. Pre-move evidence (probe table, tier
table, secret audit, unblock steps) is archived:
[`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
**Correction:** its claim that this sandbox has no `postgres`/`psql` binary was
wrong — PostgreSQL 14 IS installed there, and §18 records the DB-gated payment
tests executing (**560 pass / 2 skip / 0 fail**). Only the credential half stands.

---

## 17. CI guard fix — "Verify the guard refuses production" (2026-09-25)

**Archived** (closed record, pushed at the time) →
[`history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md`](history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md).
Moved 2026-09-27 to make room for §22. The fix is live in
`.github/workflows/test.yml` (`env -u TEST_DATABASE_URL` plus the
accepted-target assertion) and CI has been green on every push since, including
`c2d3639` (run 36283775266). Live rules: [`.ai/context/testing.md`](context/testing.md).

## 18. Stripe TEST-mode E2E — independent re-verification (TASK 007, 2026-09-26)

**Archived** (BLOCKED record; its statements are mirrored into
[`.ai/context/payment.md`](context/payment.md)) →
[`history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md`](history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md).
Moved 2026-09-27 to make room for §23. **Stripe TEST E2E stays BLOCKED** (§6, §22):
credential gate unchanged, no PaymentIntent / PromptPay QR / webhook delivery / refund
ever executed, production payment readiness **NOT claimed**.

## 19. Production-readiness audit — risk-ordered (TASK 009, 2026-09-26)

**Archived** (closed record) →
[`history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md).
Moved 2026-09-27 to make room for §22. **PRODUCTION: NOT READY** and **PRODUCTION
PAYMENT READINESS: NOT CLAIMED** still stand; per-gate evidence is in
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md);
Stripe TEST E2E and production Browser / Google-OAuth / R2-authenticated E2E stay
**BLOCKED** (§6, §18).

## 20. Moderation-queue pagination + verification-queue i18n (2026-09-26) — archived

Full narrative: [`history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md`](history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md)
(this was the documented NEXT SPLIT; moved out on 2026-09-27). What stays live:

- `GET /api/admin/products/moderation` is bounded and returns `{products, pagination}`;
  `ProductModerationQueue.tsx` pages it (25) and its badge reads `pagination.total`.
- `SellerVerificationQueue.tsx` renders through the `review.*` namespace (24 keys added in
  th/en/my); the corrupted `ระงับและลบrêtailer แล้ว` string is fixed.
- Tooling note: both edits sat past the ~55 KB match window and were applied with a single-use
  `bun` anchor-asserting script.
- Still open / unchanged: §19's release blockers (Stripe TEST E2E, browser/OAuth/R2 E2E,
  `velnox.com` NS delegation, §9.4 catalog reads, dead realtime channels);
  `ProductModerationQueue.tsx`'s other copy is still hardcoded Thai (pre-existing).
