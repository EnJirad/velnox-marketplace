# Handoff §85 — Phase 2F CI Checkout/Payment Test Reliability (2026-10-30)

Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-30 (edit-headroom
housekeeping while appending §87; the current-state file was 53.2 KB against the
~55 KB edit-tool limit). Nothing was discarded. The condensed current-state
pointer lives in [`.ai/AI_HANDOFF.md` §85](../../AI_HANDOFF.md).

---

## §85. Phase 2F — CI Checkout/Payment Test Reliability (2026-10-30) — COMPLETE

**Base SHA:** `31456976c017f9dd85f5cb04ab383b852b6d1cf9` (local was 8 behind; fast-forwarded first,
clean tree). **Code commit:** `fe7927b6fee4a7028244b1eead79f2502e01ba2b` (3 test files, +232/−4).
**Report:** [`.ai/history/2026-10-28-phase-2f-ci-payment-test-reliability.md`](./history/2026-10-28-phase-2f-ci-payment-test-reliability.md).

**The 11 red CI tests were NOT a product defect and NOT a missing CI secret.** The six
`buy-now-checkout` and five `realtime-commerce-phase2c` DB cases send `paymentMethod: "CARD"`; their
`beforeAll` set a dummy `sk_test_…` key but **deleted `STRIPE_WEBHOOK_SECRET`**, while
`stripeStatus()` requires a configured webhook secret for a usable rail. The payment gate therefore
answered **503 `STRIPE_WEBHOOK_NOT_CONFIGURED` before any stock/idempotency/realtime code ran** — in
every environment, CI included. The tests configure the rail themselves; they configured half of it.

**Fix (tests only).** Both suites now install the complete DUMMY test-mode rail already used by
`checkout-payment-flow` (`STRIPE_MODE=test`, `sk_test_0000…`, `whsec_0000…`), saved/restored around
the block. No assertion weakened, no case skipped, and no product, Stripe, pricing, reservation or
auth code touched. New `backend/tests/checkout-test-payment-rail.test.ts` (10 cases) pins: the
fixture is usable/test-mode; a live key, a missing webhook secret, or no configuration is still
refused; the checkout handler makes no Stripe API call; the CI workflow references no secret and no
`STRIPE_*`/`COD_ENABLED`, keeps `TEST_DATABASE_URL`, and still pins the production-database refusal.

**Verified.** Pre-fix local disposable PG14: `31 pass / 11 fail` (both suites). Post-fix: **42/0**.
Full `bun test tests` (disposable PG14): **1359 pass / 6 skip / 0 fail** (1365 tests, 67 files).
GitHub Actions on `fe7927b`: **run `40986922370` — success, 1363 pass / 2 skip / 0 fail**; all 11
previously failing cases are `(pass)`, zero `(fail)` lines. `bun run typecheck` 4/4 · backend
typecheck · `build:apps` 4/4 · `i18n:check` 1257/1257/1257 · `git diff --check` clean.
**BROWSER/E2E: NOT RUN** (no tooling; test-configuration-only change).

**Boundaries:** production DB **not connected** (only an explicit local `TEST_DATABASE_URL`),
production payment **not touched**, schema/SQL **unchanged**, Stripe logic **unchanged**, COD default
**unchanged**, VelRepeat **unchanged**. No owner approval or secret is needed.
