# Archive — §22 PostgreSQL 53000, provider-side quota classified (2026-09-27)

Verbatim handoff §22 as it stood before the 2026-09-27 split (moved to make room for §27).
Supersedes: `.ai/history/archive/AI_Handoff-2026-09-27-postgres-53000.md` (first pass, §21).

---

## 22. PostgreSQL 53000 — provider-side quota classified; provider action required (2026-09-27)

**New production evidence (with §21's safe logging deployed as `c2d3639`).** Render
logs now show `53000` on BOTH paths: `operation: connect` from
`backend/db/index.ts:70` (the `getClient()` failure logger) called by
`backend/routes/auth.ts:133` (`const poolClient = await getClient();` inside
`resolveUser()`), AND `operation: query` / `statement: SELECT`; the VelRepeat
scheduler fails the same way. ⇒ new connections are refused AND existing
connections are dropped. No OAuth code was touched.

**Classification — (B)+(E): a provider consumption quota was exhausted and Neon
suspended the project's compute. Not (A) connection limit, not (C) storage, not
(F) provider-wide.**
- Neon FAQ *"What are the limits and quotas for Neon's Free plan?"*
  (`neon.com/faqs/free-plan-limits-and-quotas`): *"CU-hours or network transfer
  used up: the project's compute is suspended until the next billing period or
  until you upgrade. **Existing connections drop and new ones can't open.**"* —
  a verbatim match to the two observed operations. Free-plan budget: **100 CU-hours
  per project per month** and **5 GB per project per month public network
  transfer**; computes scale to zero only after **5 minutes** of inactivity.
- **(A) excluded:** Postgres connection exhaustion is `53300` *"remaining
  connection slots are reserved for non-replication superuser connections"* —
  a different code and message (Neon's own support write-up uses `53300` for
  connection limits); the pool is 20 connections in one process (§21).
- **(C) excluded:** per the same FAQ, storage above 0.5 GB fails *inserts, updates
  and deletes that would increase storage* — connections and SELECTs keep working.
  A refused connect plus a refused SELECT contradict it.
- **(F) excluded:** the message is account/project-scoped.
- **Which of the two Free-plan metrics tripped is BLOCKED:** it needs Neon Console
  → project → Usage (or the Neon API). No credential exists in this workspace
  (`freebuff-env list` → `{}`), and the SELECT-only diagnostic workflow still cannot
  be dispatched — `gh workflow run diag-neon-schema.yml` → **HTTP 403 Resource not
  accessible by integration** (re-confirmed 2026-09-27; Actions *read* works —
  `gh run list` — Actions *write* does not). Last *proven* production-DB workflow
  connection: `migrate-neon.yml` run `36167403209` success at
  **2026-09-25T17:29:05Z**.

**Contributing factor (arithmetic, not a guess).** `startVelRepeatScheduler()`
(`server.ts:521`) polls with the default **60 s** interval
(`VELREPEAT_SCHEDULER_INTERVAL_MS`, floor 10 s) and every tick runs at least one
SELECT (`processDuePlans(25)`), forever. Neon's Free plan scales a compute to zero
only after **5 minutes** of inactivity, so a 60-second poll never allows an idle
window: the compute stays active 24/7 ≈ 0.25 CU × ~730 h ≈ **~182 CU-hours/month** —
~1.8× the 100 CU-hour allowance, enough to suspend the project ~16–17 days into a
monthly window with zero customer traffic. (Conditional on the project being on the
Free plan, which this workspace cannot read.) **No scheduler change was made:** the
root cause is a provider quota, and the brief forbids application-code changes that
hide that; the cadence is an owner decision.

**Connection findings (re-verified, unchanged).** Still exactly one `pg.Pool`
(`max: 20`, idle 30 s, connect timeout 5 s); THE one real leak (shop revoke) was
fixed in §21; every other lease releases in `finally`; the scheduler has no
overlapping ticks, no unbounded batches, no long-running transactions.

**Production verification (read-only, 2026-09-27).** `/api/health` 200 (it does not
touch the DB) · `/api/shops` → 500 `DB_ERROR` · `/api/categories` → 500 `DB_ERROR` ·
`/api/products` → 500 `DB_ERROR`. **DB CONNECT: FAIL** (provider-suspended) ·
**DB QUERY: FAIL** · **Google OAuth: BLOCKED** (downstream symptom; no authorized
test account) · **Scheduler: BLOCKED** (needs Render logs; same 53000 in the
reported logs).

**Owner action (PROVIDER ACTION REQUIRED).** Neon Console → project → **Usage**:
read CU-hours and public network transfer against the plan allowance (100 CU-hours /
5 GB on Free), then either upgrade to Launch or wait for the monthly reset —
compute resumes automatically and no data is lost. If the project came from the
Vercel Neon integration, the same limits are adjustable from Vercel → Integrations
→ Neon → manage → settings.
