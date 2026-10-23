# TESTING — How to Verify

## Commands (from package.json — do not invent)

| What | Command |
|------|---------|
| All apps typecheck | `bun run typecheck` |
| Single app/backend | `bun --filter @velnox/velshop typecheck` / `bun --filter @velnox/backend typecheck` |
| Build all apps | `bun run build:apps` (or `build:velshop` etc.) → `apps/<app>/dist` |
| Static suites | `bun test backend/tests packages/shared/tests` (schema contract + shared client; no database) |
| MVP API suite | `bun run test:mvp` (`scripts/db-test-run.sh`; creates its own database from `db/schema.sql`) |
| Browser E2E | `bun run test:mvp:browser` (`scripts/db-browser-e2e.sh`; disposable database) |
| Schema equivalence | `bun run db:check` (`scripts/db-verify.sh`) · declaration contract: `bun run db:verify` |
| Test database | `TEST_DATABASE_URL` → a disposable PostgreSQL (never `DATABASE_URL`) |
| i18n | `bun packages/shared/scripts/i18n-check.ts` (also `bun run i18n:check`) |
| Git hygiene | `git diff --check` |

Lint/format are placeholders (`echo 'Lint not yet configured'`).

## Test Database Isolation (mandatory)

`DATABASE_URL` in a deployment is the application database, and the MVP API
suite **writes** fixtures (users → sellers → products → cart → orders →
inventory). It must never reach production.

- `TEST_DATABASE_URL` is the only database a test run may use. `bun run test:mvp`
  creates and drops its own database (`velnox_mvp_app_test`) on that cluster, so
  the static suite's database is never mutated.
- `backend/db/test-database.ts` is the single decision point. `backend/db/index.ts`
  builds the pool through `resolveConnectionString()`, which in a test process
  returns the validated test database and **throws** when the configured target is
  production. `decideTestDatabase()` is fatal-or-safe: never a fallback.
- Production = a production env marker (`NODE_ENV`/`APP_ENV`/`ENVIRONMENT`/
  `VERCEL_ENV` = `production`, `RENDER=true`), a Neon host (`*.neon.tech`), or the
  production `DATABASE_URL` endpoint. A Neon branch needs
  `TEST_DATABASE_ALLOW_NEON_BRANCH=1` and still may not be the production endpoint.
- Fail-fast: the root `bunfig.toml` `[test] preload` (`backend/tests/setup.ts`)
  aborts before any test file loads; every MVP test imports
  `backend/tests/helpers/test-db.ts`, which asserts the same at import.
- Tests gate on `hasTestDatabase()` — **never** re-add a raw
  `Boolean(process.env.DATABASE_URL)` check.
- Nothing configured → DB-gated tests skip; the rest of the suite runs. This is the
  normal state in a sandbox without credentials.
- `.github/workflows/test.yml` runs both suites against a disposable `postgres:16`
  service and references **no** repository secret.

## What to Run

- **Frontend change:** typecheck affected app(s) + build if needed; check affected page, responsive, and no raw i18n keys.
- **Backend change:** `bun --filter @velnox/backend typecheck` + `bun run test:mvp`; hit the affected `/api/mvp/*` route and verify auth/authz/ownership and error shapes.
- **Shared package change:** typecheck all apps + backend (wildcard exports affect everyone) + `bun test packages/shared/tests`.
- **Database change:** update BOTH `db/schema.sql` and `db/run-sqleditor.sql`, then `bun run db:verify` (declaration parity) + `bun run db:check` (both files applied twice to a disposable database) + `bun run test:mvp`. Never `DROP/TRUNCATE` prod.
- **Full-system change:** all of the above + `bun run i18n:check` if i18n touched.

## Before Declaring Done

`git diff --check` clean, no new type errors, `.ai/AI_HANDOFF.md` updated, both `db/*.sql` files changed together, no secrets committed, no `db/run-update.sql` or `db/migrations/` resurrected.
