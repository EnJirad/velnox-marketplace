# Archived: CI guard fix — "Verify the guard refuses production" (2026-09-25)

Moved out of `.ai/AI_HANDOFF.md` §17 on 2026-09-27 to keep the live handoff under
the ~55 KB edit limit. The record below is kept verbatim as history. The fix it
describes is live in `.github/workflows/test.yml`, and the guard rules are live in
[`.ai/context/testing.md`](../../context/testing.md).

---

## 17. CI guard fix — "Verify the guard refuses production" (2026-09-25)

**The failure.** `.github/workflows/test.yml` step *Verify the guard refuses
production* failed on every `main` run since the workflow landed. Real run
`36172693661` (for `68197ab`), job `Typecheck + tests (disposable PostgreSQL)`,
step 8 → `❌ The guard did not refuse a production database.` → exit 1. Because
`bash -e` aborts the job, **steps 9 "Run the test suite" and 10 were SKIPPED** —
CI had not been running the test suite at all on those commits.

**Root cause — the check contradicted a guard rule that is deliberately pinned.**
`TEST_DATABASE_URL` is a **job-level `env:`** (the disposable container), so it
was visible to every step — the run log prints it in the step's own `env:` block.
`decideTestDatabase()` **prefers `TEST_DATABASE_URL` over `DATABASE_URL` on
purpose**, and `test-database-isolation.test.ts` already asserts "an explicit
TEST_DATABASE_URL is preferred and wins over DATABASE_URL". The probe injected a
production-looking `DATABASE_URL`, but with the job variable still set the guard
never consulted it, correctly resolved to the disposable target, and printed
nothing — so `grep -q` matched nothing and the step reported a broken guard. **The
guard was correct; the CI assertion was wrong.** (GitHub runs `shell:
/usr/bin/bash -e {0}` — no `pipefail` — so the pipeline was not a factor.)

Reproduced locally: identical command + job env → **empty output, exit 0**.
Negative control (variable cleared) → `REFUSING TEST AGAINST PRODUCTION DATABASE`,
exit 1.

**Fix — CI wiring only; `backend/db/test-database.ts` untouched.** The probe now
clears the job variable with `env -u TEST_DATABASE_URL`, so it really models
"a test process whose only configured database is production". The step also
gains the other half of the contract: a second assertion that the disposable
target is still **ACCEPTED**, so it can no longer pass if the guard simply starts
refusing everything.

**Files changed (2 code, both CI-guard).** `.github/workflows/test.yml` (+26/−1)
and `backend/tests/test-database-isolation.test.ts` (+80); plus the handoff and
archive docs. **Payment code untouched**
— `backend/routes/stripe.ts`, `backend/lib/payment-config.ts`,
`db/migrations/047_payment_foundation.sql`, `backend/routes/cart.ts` and both
schema files verified unchanged; no schema change, no `db/run-update.sql`.

**Regression coverage — 7 new tests (39 pass / 0 fail in the file).** Subprocess:
(CI-shaped env: safe `TEST_DATABASE_URL` + production `DATABASE_URL` → **ACCEPTED**,
pinning the root cause), (D: Neon branch + `TEST_DATABASE_ALLOW_NEON_BRANCH=1` →
**ACCEPTED**; same opt-in on the production endpoint → **REFUSED**; branch without
opt-in → **REFUSED**). Source-level: the workflow must grep the documented refusal,
must contain `env -u TEST_DATABASE_URL`, must use only the reserved
`ep-ci-guard-check…neon.tech` host (never real production Neon), and must still
assert the disposable target is accepted.

**Full verification actually run (no production DB — nothing configured here,
so DB-gated suites skip as designed).** backend `bunx tsc --noEmit` **exit 0** ·
`bun run typecheck` **4/4 exit 0** · `bun test backend/tests` **518 pass / 43 skip /
0 fail** · payment tests **59 pass / 1 skip / 0 fail** · schema-drift +
migration-numbering + security-hardening **75 pass / 0 fail** · `i18n:check`
**1295/1295/1295** · `db/schema.sql` ≡ `db/run-sqleditor.sql` · no
`db/run-update.sql` · `git diff --check` clean · no secrets in the diff.

**GitHub Actions rerun — PASS (run `36176830888`, commit `85d2f48`).** Job
`Typecheck + tests (disposable PostgreSQL)` → **success**. Step 8 *Verify the
guard refuses production* → **success**, printing both `✅ Production database
refused as expected.` and `✅ Disposable test database accepted as expected.`
Step 9 *Run the test suite* → **success** (it had been **skipped** on every
previous failing run) and step 10 *Whitespace hygiene* → success.

**The suite now actually runs in CI: 559 pass / 2 skip / 0 fail** (561 tests,
24 files) against the disposable PostgreSQL — versus **518 pass / 43 skip**
locally where no test database exists. **41 DB-gated integration tests ran in CI
for the first time** (inventory reservation/concurrency, checkout + webhook
idempotency, refund/order paths) and all of them pass.

**Push.** `6f365b8 fix(ci): repair production database guard verification` +
`85d2f48 docs(ai): …` → `git push origin main` → **PUSH VERIFIED**, local
`85d2f480af036b7942982f1ce2675dc0ad865cf3` == `origin/main`, 0/0, tree clean.

**Not claimed.** Stripe Test Mode E2E is still **BLOCKED** (no credential) and
production payment readiness is **NOT claimed** — §16 stands unchanged.

---
