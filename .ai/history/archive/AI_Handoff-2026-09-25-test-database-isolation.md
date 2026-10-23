# Archived: Test database isolation (TASK 004A, 2026-09-25)

Moved out of `.ai/AI_HANDOFF.md` §13 on 2026-09-26 to make room under the ~55 KB
edit limit for the new §§19–20. The record below is kept verbatim as history.

The system it describes is live and documented in
[`.ai/context/testing.md`](../../context/testing.md) (test-database isolation
section): `backend/db/test-database.ts` is the single decision point,
`backend/tests/helpers/test-db.ts` gates every DB-gated file on
`hasTestDatabase()`, `backend/tests/setup.ts` (via root `bunfig.toml` `[test]
preload`) aborts before any file loads, and `.github/workflows/test.yml` runs the
suite against a disposable `postgres:16` service referencing no repository
secret. The still-open items stayed live in `.ai/AI_HANDOFF.md` §6.

---

## 13. Test database isolation (TASK 004A, 2026-09-25)

**Root cause.** `backend/db/index.ts` built the one `pg.Pool` from `DATABASE_URL`,
which in this repository *is* the production Neon connection string
(`.env.example`); no test-database variable existed. Every DB-gated test opened on
`Boolean(process.env.DATABASE_URL)` and then wrote real rows — `so-test-*`,
`inv-*`, `inv-cancel-*`, `inv-paid-*` and the `*@test.local` users → sellers →
shops → products → orders. A plain `bun test` on any machine carrying the
production URL therefore seeded production: a silent fallback, no guard, no CI
test job. Closes the **root cause** of archived finding #7.

**Guard (new).** `backend/db/test-database.ts` — pure metadata, never connects.
`TEST_DATABASE_URL` is preferred; a hard throw refuses a production env marker
(`NODE_ENV`/`APP_ENV`/`ENVIRONMENT`/`VERCEL_ENV` = `production`, `RENDER=true`), a
Neon host (`*.neon.tech`), and the production `DATABASE_URL` endpoint. A Neon
*branch* needs `TEST_DATABASE_ALLOW_NEON_BRANCH=1` and still may not be the
production endpoint. `decideTestDatabase()` is **fatal or safe — never a fallback
to production**; nothing configured means the DB-gated tests skip, as before.
`resolveConnectionString()` is now the pool factory's only source of a connection
string; loopback targets keep their own sslmode (a disposable Postgres has no
TLS). Fail-fast: `backend/tests/setup.ts` via root `bunfig.toml` `[test] preload`
aborts before any file loads, and `helpers/test-db.ts` asserts the same at import
so `cd backend && bun test tests` is covered too. No message ever contains a
credential — host/database only.

**Fixtures.** All 11 DB-gated files gate on `hasTestDatabase()`
(`backend/tests/helpers/test-db.ts`) instead of the raw check. **No filtering was
added to `/api/shops` or the frontend** — the fix is at the database boundary.
`helpers/purge.ts` unchanged.

**Regression test.** `backend/tests/test-database-isolation.test.ts`, 32 cases:
metadata parsing, production refusal, the no-fallback decision, the pool-factory
path, sslmode, a real `bun` subprocess proving fail-closed, and source-level
guards that the old gate cannot return.

**CI (new).** `.github/workflows/test.yml` — disposable `postgres:16` service,
`TEST_DATABASE_URL` on localhost, `db/run-sqleditor.sql` bootstrapped once, then
typecheck + `bun test backend/tests`. It references **no secret at all**;
`NEON_DATABASE_URL` is never a test database. Previously no test job existed.
`upload-security.test.ts` now gates its 2 bucket-dependent cases on R2 config
(`itR2`) rather than JWT alone (missing R2 credentials produced a 500, not the
behaviour under test), and the "arbitrary namespace" confirm case accepts
`R2_OBJECT_NOT_FOUND` — the storage check legitimately runs before the shop
ownership query and reaches no write either way.

**Verification (actually run).** Backend `tsc` clean; 4/4 apps typecheck clean.
Against a disposable local PostgreSQL 14 cluster (created, bootstrapped from
`db/run-sqleditor.sql` → 59 tables, then dropped and stopped): **491 pass / 2
skip / 0 fail** (493 tests, 23 files; both skips are the R2-credential cases).
Guard proof against the **real suite**: with a production-looking `DATABASE_URL`
it exits **1** with **0 pass / 23 fail** and `REFUSING TEST AGAINST PRODUCTION
DATABASE` — no test body runs; identical with `RENDER=true`; a disposable target
exits 0. `git diff --check` clean.

**Production read-only verification (no writes, no credentials read).**
`GET /api/health` → 200 `{"status":"ok"}`. `GET /api/shops` → 200 with exactly
one shop (“Eloop”, active); scanning the response for `so-test` / `inv-test` /
`inv-cancel` / `inv-paid` / `test.local` / `test@` returns **0 matches**. **EXISTING
PRODUCTION TEST DATA FOUND: none on this surface.** A `SELECT` cannot be run (no
production credentials here, by design), so rows no public endpoint surfaces are
unverified; **nothing was deleted or modified**.

**Still open.** (a) Archived finding #7's data half — historical fixture rows
remain an owner cleanup action. (b) `.env.example` is protected from the agent's
edit tools, so its `TEST_DATABASE_URL` entry could not be added; the variable is
documented in `INSTALLATION.md` and `.ai/context/testing.md` — add the line
manually. (c) A dev machine carrying a production `DATABASE_URL` now fails the
whole run instead of silently writing to production — the intended fail-closed
behaviour; set `TEST_DATABASE_URL` to run tests.

**Next task:** TASK 004B — production R2 authenticated round-trip.
