# TESTING — How to Verify

## Commands (from package.json — do not invent)

| What | Command |
|------|---------|
| All apps typecheck | `bun run typecheck` |
| Single app/backend | `bun --filter @velnox/velshop typecheck` / `cd backend && bun tsc --noEmit` |
| Build all apps | `bun run build:apps` (or `build:velshop` etc.) → `apps/<app>/dist` |
| Tests | `bun test backend/tests` (`bun test` alias is `test`) |
| Integration tests | Needs `TEST_DATABASE_URL` — see *Test database isolation* below |
| i18n | `bun packages/shared/scripts/i18n-check.ts` (also `bun run i18n:check`) |
| Git hygiene | `git diff --check` |

Lint/format are placeholders (`echo 'Lint not yet configured'`).

## Test Database Isolation — MANDATORY

Integration tests write real rows (users → sellers → shops → products). They must
NEVER touch the application database.

| Variable | Meaning |
|----------|---------|
| `DATABASE_URL` | Application database (Neon, production in deployed/workspace `.env`). **Ignored by the test suite.** |
| `TEST_DATABASE_URL` | The only database tests may use. Must be disposable and its database name must contain `test` (e.g. `velnox_test`). |

Rules enforced by `backend/db/database-guard.ts` + `backend/tests/helpers/test-db.ts`:

1. `TEST_DATABASE_URL` never falls back to `DATABASE_URL`.
2. It is rejected when it is the same host+port+database as `DATABASE_URL`, when a
   host/database segment is a production marker (`prod`, `production`, `live`,
   `primary`), or when the database name does not contain `test`.
3. A rejected URL **fails the suite closed** (no connection is attempted).
4. A missing `TEST_DATABASE_URL` **skips** the integration tests and prints the
   reason; it never silently uses `DATABASE_URL`.
5. Backend test files gate with `const testFn = integrationTest;` from
   `./helpers/test-db.js` — never with `Boolean(process.env.DATABASE_URL)`
   (`test-database-isolation.test.ts` enforces this).

Local disposable database:

```bash
# any throwaway PostgreSQL (docker, local install, Neon branch, CI service)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/velnox_test bun test backend/tests
psql "$TEST_DATABASE_URL" -f db/run-sqleditor.sql   # bootstrap once
```

CI: `.github/workflows/backend-tests.yml` runs the suite against a throwaway
`postgres:16` service container bootstrapped from `db/run-sqleditor.sql`.

Diagnostics are credential-free (redacted host, port, database name,
classification). Never print a connection string.

### Legacy fixture audit

Before the isolation guard existed, the integration suites wrote fixtures into
the application database. `backend/scripts/test-fixture-cleanup.ts` audits and
(only on explicit opt-in) removes them:

```bash
cd backend && bun run fixtures:audit                                        # DRY RUN, read-only
cd backend && VELNOX_ALLOW_FIXTURE_CLEANUP=1 bun run fixtures:audit --apply  # deletes
```

It finds fixture roots from the markers the test sources use (`@test.local`
emails and the fixture shop slug prefixes), computes the delete set as the
foreign-key closure of those roots, and reports rows that reference anything
outside it (shared references) — those block `--apply`. Never point this at a
database you are not willing to modify.


## What to Run

- **Frontend change:** typecheck affected app(s) + build if needed; check affected page, responsive, and no raw i18n keys.
- **Backend change:** `cd backend && bun tsc --noEmit` + `bun test backend/tests` + hit affected `GET/POST/PATCH /api/*`; verify auth/authz/ownership and error shapes.
- **Test change:** `bun test backend/tests` against a disposable `TEST_DATABASE_URL`; never run it while only `DATABASE_URL` is set and expect the integration tests to run.
- **Shared package change:** typecheck all apps + backend (wildcard exports affect everyone).
- **Database change:** SQL validity + `diff db/schema.sql db/run-sqleditor.sql` sync + dependency order + fresh-DB question (YES) + app queries still valid. Never `DROP/TRUNCATE` prod.
- **Full-system change:** all of the above + `bun run i18n:check` if i18n touched.

## Before Declaring Done

`git diff --check` clean, no new type errors, `AI_Handoff.md` updated, `db/*.sql` synced if DB changed, no secrets committed, no `db/run-update.sql` resurrected.
