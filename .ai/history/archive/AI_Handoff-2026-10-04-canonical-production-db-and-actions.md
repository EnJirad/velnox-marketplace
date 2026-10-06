# Velnox Handoff — archive: Canonical production DB + GitHub Actions alignment (2026-10-04)

Moved out of `.ai/AI_HANDOFF.md` on **2026-10-06** during the payment/checkout/order
rebuild (handoff edit-ceiling housekeeping; made room for §70).

**Verbatim.** Reference only — the repository is always authoritative. Still-live facts
are restated in the handoff's `## Canonical production DB + GitHub Actions alignment`
replacement pointer.

---

## Canonical production DB + GitHub Actions alignment (2026-10-04)

The Actions↔Render split is closed **in the repository**; the secret itself is still an owner
action. `NEON_PRODUCTION_DATABASE_URL` is now the one name GitHub Actions uses to reach the
production Neon, and the two workflows that touch production are named for that role:

* **`production-db-verify.yml`** (new) — read-only. `repository` job validates the schema
  contract and proves no workflow carries a credential, a remote connection string or a silent
  fallback; `production` job prints `current_database` / `current_schema` /
  `server_version` / `current_user` plus a row-count fingerprint, then checks 11 objects —
  both group columns **with their type**, both `ON DELETE SET NULL` group FKs, the group
  indexes, the payment parent CHECKs and the migration ledger. `gates` job runs the real
  commands against a throwaway postgres container. `verdict` prints one PASS/BLOCKED/FAIL.
* **`production-db-migrate.yml`** (was `migrate-neon.yml`, same engine, renamed) — the only
  workflow that writes to production. It now prints the database identity **before** applying
  anything and tells the operator to stop if it is not production.
* `diag-neon-schema.yml` and `diag-stripe-payment-trace.yml` follow the canonical secret.
  `test.yml` is unchanged and still references **no** secret.

**Verification never repairs.** A missing object FAILs the job and names the fix; the workflow
never creates it. **A missing secret is BLOCKED, never substituted** —
`BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`

Both properties were proven, not asserted: the check SQL was executed against a real reconciled
database (**11/11 PASS**) and against a database with `payments.checkout_group_id` dropped — the
reported production condition — where it reported **5 FAIL** naming exactly what was missing and
exited non-zero without writing. The workflow guards were run against the real tree (clean) and
against a planted violation file (all three fire, exit 1). The `repository` guards were written
after three of them false-positived on the current tree, which is the only reason the planted
`ep-ci-guard-check` fixture and the `test.yml` comment are now explicitly excluded.

Suite after this change: **1962 pass / 2 skip / 0 fail**, typecheck 4/4 + backend 0, build 4/4,
`db:verify` 9/9 exit 0, `git diff --check` clean.

**Renaming `migrate-neon.yml` broke `backend/tests/migration-numbering.test.ts`** (it reads that
workflow by name), which is the guard that pins the runner's filename-keyed ledger. Caught by
running the suite rather than by inspection; the reference now points at the renamed file.

**Two further defects only the real Actions run could find.**

1. The new `repository` job runs the schema-contract tests with **no database**, and
   `backend/tests/checkout-group-sql-scope.test.ts` had one test inside a *static* `describe`
   that still executed its statement through `query()` — so it passed in `test.yml` (which
   always has a container) and failed in the new job. That assertion is now gated on
   `hasTestDatabase()` exactly like every other DB-backed one: 71 pass / 11 skip with no
   database, and it still runs and passes when one is present.
2. `db/verify-reconciler.sh` defaulted to hard-coded `velnox_test` / `velnox_test`
   credentials and ignored `TEST_DATABASE_URL`, so in a CI job whose container uses
   `postgres` / `postgres` every scenario failed on
   `password authentication failed` — and, worse, it had been verifying against different
   credentials than it tested against. It now derives `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`
   and the admin database from `TEST_DATABASE_URL` (query string stripped, never echoed),
   with explicit `PG*` / `VELNOX_VERIFY_ADMIN_DB` still winning. Verified against three
   shapes: the CI credentials, the local credentials, and explicit overrides; plus a
   credential-less URL, which must not corrupt the parse. `test.yml` never ran
   `db:verify`, which is why this survived until now.

Both were found by inspecting the GitHub run, not locally — which is the whole argument for
verifying on Actions.
