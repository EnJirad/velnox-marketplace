# TESTING — How to Verify

## Commands (from package.json — do not invent)

| What | Command |
|------|---------|
| All apps typecheck | `bun run typecheck` |
| Single app/backend | `bun --filter @velnox/velshop typecheck` / `cd backend && bun tsc --noEmit` |
| Build all apps | `bun run build:apps` (or `build:velshop` etc.) → `apps/<app>/dist` |
| Tests | `bun test backend/tests` (`bun test` alias is `test`) |
| Test database | `TEST_DATABASE_URL` → a disposable PostgreSQL (never `DATABASE_URL`) |
| i18n | `bun packages/shared/scripts/i18n-check.ts` (also `bun run i18n:check`) |
| Git hygiene | `git diff --check` |

Lint/format are placeholders (`echo 'Lint not yet configured'`).

## Test Database Isolation (mandatory)

`DATABASE_URL` in this repository is the **production** Neon database, and the
DB-gated integration tests *write* fixtures (users → sellers → shops → products →
orders, plus `helpers/purge.ts` deletes). They must never reach production.

- `TEST_DATABASE_URL` is the only database a test run may use. A disposable
  local/CI PostgreSQL is the intended target: bootstrap it once with
  `db/run-sqleditor.sql` (`psql "$TEST_DATABASE_URL" -f db/run-sqleditor.sql`).
- `backend/db/test-database.ts` is the single decision point. `backend/db/index.ts`
  builds the pool through `resolveConnectionString()`, which in a test process
  returns the validated test database and **throws** when the configured target is
  production. `decideTestDatabase()` is fatal-or-safe: never a fallback.
- Production = a production env marker (`NODE_ENV`/`APP_ENV`/`ENVIRONMENT`/
  `VERCEL_ENV` = `production`, `RENDER=true`), a Neon host (`*.neon.tech`), or the
  production `DATABASE_URL` endpoint. A Neon branch needs
  `TEST_DATABASE_ALLOW_NEON_BRANCH=1` and still may not be the production endpoint.
- Fail-fast: the root `bunfig.toml` `[test] preload` (`backend/tests/setup.ts`)
  aborts before any test file loads; `backend/tests/helpers/test-db.ts` asserts the
  same at import (covers `cd backend && bun test tests`).
- Tests gate on `hasTestDatabase()` from `helpers/test-db.ts` — **never** re-add a
  raw `Boolean(process.env.DATABASE_URL)` check. `test-database-isolation.test.ts`
  fails if one reappears.
- Nothing configured → DB-gated tests skip; the rest of the suite runs. This is the
  normal state in a sandbox without credentials.
- Never filter test data out of `/api/shops` or the frontend — that hides the
  symptom instead of fixing the boundary.
- `.github/workflows/test.yml` runs the suite against a disposable `postgres:16`
  service and references **no** repository secret.

## What to Run

- **Frontend change:** typecheck affected app(s) + build if needed; check affected page, responsive, and no raw i18n keys.
- **Backend change:** `cd backend && bun tsc --noEmit` + hit affected `GET/POST/PATCH /api/*`; verify auth/authz/ownership and error shapes.
- **Shared package change:** typecheck all apps + backend (wildcard exports affect everyone).
- **Database change:** SQL validity + `diff db/schema.sql db/run-sqleditor.sql` sync + dependency order + fresh-DB question (YES) + app queries still valid. Never `DROP/TRUNCATE` prod.
- **Full-system change:** all of the above + `bun run i18n:check` if i18n touched.

## Before Declaring Done

`git diff --check` clean, no new type errors, `.ai/AI_HANDOFF.md` updated, `db/*.sql` synced if DB changed, no secrets committed, no `db/run-update.sql` resurrected.
