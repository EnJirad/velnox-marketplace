# Handoff §21 — Production PostgreSQL 53000: provider quota (BLOCKED evidence) + one real pool leak fixed

Moved out of `.ai/AI_HANDOFF.md` on 2026-09-27 (edit-headroom housekeeping: the live
handoff must stay well under the ~55 KB limit where in-place edits stop matching).
This is the FIRST pass on the 53000 incident; `.ai/AI_HANDOFF.md` §22 supersedes its
classification and re-verifies its connection findings ("unchanged").

**Report.** Render logs: `code: '53000'` — *"Your account or project has exceeded
the quota. Upgrade your plan to increase limits."* — at `backend/routes/auth.ts:133`
(`resolveUser()`) and `backend/jobs/velrepeat-scheduler.ts:445` (`processDuePlans()`),
both through `backend/db/index.ts` (pg-pool). Google OAuth callbacks failed after
reaching the backend.

**1. `53000` = a provider-side Neon quota, not this codebase.** `53000` is PostgreSQL
`insufficient_resources` (class 53, generic). That exact message is Neon's quota
rejection: `neon.com/docs/guides/consumption-limits` — when any configured/plan
consumption metric (`active_time_seconds`, `compute_time_seconds`,
`written_data_bytes`, `data_transfer_bytes`, or the account/project cap) is met,
Neon suspends every compute of the project, and the suspension persists until the
next billing period unless the quota is raised. In the wild the same code + message
appears for the data-transfer variant (`Code: 53000 … Your project has exceeded the
data transfer quota`) and through the driver as HTTP 402. **Which quota** cannot be
read from this workspace — `freebuff-env list` is empty (no `DATABASE_URL`, no Neon
key) → **BLOCKED — provider quota/usage evidence unavailable**; the owner must read
Neon Console → project → Usage/Billing (or the Neon API `Get project` metrics). No
code change can lift a suspended compute, and none was attempted.

**Live production evidence (read-only, 2026-09-27).** `/api/health` 200 (it does not
touch the DB); `/api/health/r2` 200; **`/api/shops` → 500 `DB_ERROR`** and
**`/api/categories` → 500 `DB_ERROR`** — the DB path is failing *now*, consistent
with a persistent suspension. Render logs are not reachable from this workspace.

**2. The code did not exhaust that quota (measured, not assumed).** Exactly ONE
`pg.Pool` (`backend/db/index.ts:16`; repo-wide grep finds no second pool or client);
`max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`. HTTP +
WebSocket + the VelRepeat scheduler share it in one process (`server.ts` starts
`startVelRepeatScheduler()` at `server.ts:521`). The repo has no `render.yaml`; docs
describe a single Render web service (`docs/DEPLOYMENT.md:21`) — the live instance
count is dashboard-only → BLOCKED. Scheduler: an in-process `running` mutex, a
bounded `LIMIT 25` batch processed sequentially, cross-instance safety via
`FOR UPDATE` + `UNIQUE (plan_id, scheduled_for)`; no overlapping ticks, no unbounded
batch. A connection-limit problem would surface as `53300` `too_many_connections` or
a node-postgres pool timeout — not `53000`.

**3. One real connection leak existed — found and fixed (proven by source, then by
executed test).** `POST /api/admin/sellers/:id/revoke` (`backend/routes/seller.ts`,
lease at :1263) was `try/catch` with **no `finally`**: every call — 403, 400, 404,
success and error — permanently consumed one of the pool's 20 connections until the
process restarted. It was the only unreleased lease (the other ten `getClient()`
sites release in `finally`; `withTransaction` always did). A real latent service-wide
outage trigger (it would eventually starve auth too), but **NOT** the 53000: it
produces pool timeouts, not a provider quota error, and it is unrelated to the OAuth
callback path. Fixed with `finally { client.release(); }`; pool `max` unchanged.
`pool.on("error") → process.exit(-1)` (`db/index.ts:23`) is left as the documented
upstream pattern, flagged here: during a provider suspension that kills idle
connections it converts the outage into process restarts.

**4. Safe failure logging.** `backend/db/index.ts` now logs every failed
query/connect with `operation`, the statement keyword, and PostgreSQL
`code`/`severity`/`message` only — never the connection string, credentials,
cookies, or parameters (which may carry PII). The next 53000 is classifiable
straight from Render logs. No behavior change.

**Changes.** `backend/routes/seller.ts` (+5), `backend/db/index.ts` (+31/−3), new
`backend/tests/db-client-release.test.ts` (7 cases). No schema change (`db/`
untouched).

**Tests (executed).** Disposable PostgreSQL 14 `velnox_test` (59 tables) +
`JWT_SECRET`: full suite **602 pass / 2 skip / 0 fail** (604 tests, 27 files) — 7 of
them new; the 2 skips are the pre-existing R2-credential cases. The static guard is
proven non-vacuous: against the committed pre-fix `seller.ts` it reports
`{leases:[168,836,1263], releases:[328,1107], guardWouldPass:false}`. Runtime proof:
the revoke returns 200 + `sellers.status='suspended'` and `pool.idleCount` returns to
baseline; the 403 path does too; the negative control shows the probe detects a
deliberately unreleased client (idleCount one lower) and recovers after `release()`.
Backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 · `i18n:check` th=en=my=1319 ·
`db/schema.sql` ≡ `db/run-sqleditor.sql` · no `db/run-update.sql` · `git diff --check`
clean.

**Production tiers.** DB HEALTH **FAIL** (two DB-backed GETs 500 while `/api/health`
stays 200) · AUTH DB PATH **BLOCKED** (same suspension; no authorized account) ·
GOOGLE OAUTH **BLOCKED** (no test account + no deploy) · SCHEDULER **BLOCKED** (needs
Render logs). Clearing the 53000 needs the provider quota raised/reset — not a code
deploy. **Not claimed:** the quota is not fixed and OAuth was not verified in
production.
