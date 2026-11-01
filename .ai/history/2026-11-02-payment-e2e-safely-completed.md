# Payment E2E — safe tests completed, unsafe ones skipped (2026-11-02)

**SHA audited:** `e5aebfa` → `277a2b7` (tests) → docs at `c1c6e55`. Working tree clean.

## Results

| Test | Result | Evidence |
|---|---|---|
| Duplicate `payment_intent.succeeded` delivery | **PASS** | CI disposable PG: one `payment_events` row, `paid_at` unchanged, order paid (`payment-refund-replay`) |
| Invalid webhook signature | **PASS** | CI: HTTP 400, zero rows written |
| Duplicate `charge.refunded` (fixture-signed event) | **PASS** | CI: one refund row, payment stays `paid`, order not downgraded |
| PromptPay sandbox (real, human-entered) | **PASS** (earlier) | order `88e51b37…` paid 100.00 THB, PI `pi_3UWrqaKp…`, 4 processed events — `.ai/history/2026-11-01-stripe-promptpay-e2e-success.md` |
| Abandoned/expired session cleanup + rail switch | **PASS (code + unit)** | `payment-abandonment` 8 pass; live repro earlier (409 → fix → new session) |
| Payment state transitions / no client-side paid | **PASS (structural)** | payability gate, `ApiError` mapping, no frontend `paid` write |
| Full payment suites (local) | **PASS** | 148 tests / 6 files, 0 fail, 17 DB-gated skips |
| Full backend suite (local) | 8 failures | all documented Termux-only `test database guard` probes |
| Card payment E2E in a browser | **SKIPPED** | Stripe Checkout card fields are React-controlled and Stripe's CSP blocks `browser_eval`; `browser_type` does not commit values ("ต้องป้อนข้อมูล" on submit). Entering a card needs a human and is out of scope for the agent. |
| Real Stripe Dashboard refund | **SKIPPED** | Would need a fresh sandbox payment plus owner approval and dashboard access; refunding a real user's sandbox payment is not permitted. Fixture refund tests are NOT evidence of a dashboard refund. |
| Partial refunds | **SKIPPED** | Application records full-charge refunds; partial path is not implemented/asserted |
| Out-of-order refund-before-success webhook | **SKIPPED** | No harness to delay/reorder provider events safely |
| Stripe event re-send via CLI | **SKIPPED** | Stripe CLI not installed; MCP has no resend. Idempotency proven by UNIQUE `event_id` + `ON CONFLICT` |
| Connect payouts/transfers | **SKIPPED** | Connected account `charges_enabled:false`, not onboarded; payouts are out of scope and prohibited |

## Payment security

- Signature verification: enforced on every delivery (`constructEvent`), forged secret → 400, no writes.
- Idempotency: `payment_events.event_id` UNIQUE + `ON CONFLICT DO NOTHING`; second delivery applies nothing,
  `paid_at` is `COALESCE`d.
- Order consistency: refund never un-pays; cleanup refuses `complete+paid`; no row deletion anywhere.
- Client-side: no path marks an order paid; the success page renders the API status only.

## CI / CD

- GitHub: **Tests #252** (`c1c6e55`) success; **Production DB Verify #66** (`277a2b7`) success, including the
  disposable-PostgreSQL suite with the refund/replay tests.
- Vercel: `velshop`, `velseller`, `velcenter`, `velnox-theta` all answer **200** (latest READY deployment
  recorded in §109; subsequent commits are docs/test only).

## Remaining risks

1. Card rail is unproven end-to-end in a browser (human required).
2. No real dashboard refund executed; only webhook-side refund handling is proven.
3. Partial refunds and out-of-order delivery are unimplemented/uncovered.
4. Connect payouts remain unconfigured.
