# DATABASE

## Source of Truth

Neon PostgreSQL. Single `pg.Pool` in `backend/db/index.ts` (SSL `verify-full`). Frontend never connects directly.

## Canonical Files — MUST Stay Synchronized

| File | Purpose | Rule |
|------|---------|------|
| `db/schema.sql` | Complete current schema **snapshot** | Authoritative structure; bootstraps an empty DB in one pass |
| `db/run-sqleditor.sql` | **Rerunnable additive reconciler** | Paste into Neon SQL Editor and Run as often as needed against a database that already has data |
| `db/run-update.sql` | **Deprecated** — do not recreate, update, or depend on it | — |
| `db/migrations/001_*.sql` … | Historical migrations (idempotent, `IF NOT EXISTS`) | History only; do not rewrite |

The two canonical files describe the **same database** but are **not the same
artifact**, and must not be compared byte-for-byte:

- `db/schema.sql` is what the current schema *is*. One pass over an empty database.
- `db/run-sqleditor.sql` is what has to happen to an **existing** database to bring it
  to that schema without losing anything. It therefore carries extra passes the snapshot
  has no use for — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, a `DROP NOT NULL` relax pass,
  and the index / foreign-key / constraint / trigger passes moved after the column pass so
  an older database that is missing a column is not aborted by the index that needs it.

The contract between them is **declaration parity**, asserted by
`backend/tests/helpers/canonical-schema.ts`: every table, column, index, named constraint,
function, trigger and extension `db/schema.sql` declares must still be declared by
`db/run-sqleditor.sql` with the same name and definition. The extra passes may ADD; they may
never drop or redefine.

`db/run-sqleditor.sql` was derived from `db/schema.sql`, which stays the only source of truth.
There is no in-repo generator: the additive passes are maintained by hand alongside the
snapshot, and **declaration parity is not enough** — a column added to `db/schema.sql`
without a matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` passes the parity check and
still leaves every older database without the column, failing silently. That case, the
index ordering, the constraint guards and the additive-only guarantee are pinned by
`backend/tests/db-run-sqleditor-reconciler.test.ts`; run it after any schema change.

## What Must Be in the Canonical Files

Tables, columns, types, defaults, PKs, FKs, unique/check constraints, indexes (including partial/expression), extensions, enums, functions, triggers, views — anything the current app requires. If it was added after initial schema and is still used, it must be present. No partial bootstrap.

## Fresh-DB Contract

```
Empty Postgres  →  run db/run-sqleditor.sql  →  complete current Velnox DB
                    (run it again → nothing changes)
```

No prior migrations required. Historical `db/migrations/` are for upgrading existing DBs, not for fresh creation. Never `DROP/TRUNCATE` prod to make it pass.

## The Reconciler Is Additive — Never Destructive

`db/run-sqleditor.sql` is pasted into production, so it is written to the strictest rule:

| Situation | What it does |
|---|---|
| table missing | `CREATE TABLE IF NOT EXISTS` |
| column missing | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` |
| column present under the **wrong type** | **not fixed** — `ADD COLUMN IF NOT EXISTS` is a no-op; PART 8 refuses to report success |
| column is `NOT NULL` in the old DB but nullable in the schema | `ALTER COLUMN ... DROP NOT NULL` (widens only) |
| index missing | `CREATE [UNIQUE] INDEX IF NOT EXISTS`, emitted **after** the column pass |
| constraint / FK missing | added once, guarded on `pg_constraint` |
| check whose stored definition differs from the schema | re-applied only when it differs |
| trigger missing | created once, guarded on `pg_trigger` |
| function present | `CREATE OR REPLACE` with the canonical body |

It must never contain `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DELETE`, must never
rename an object in place, and must never hide a failure behind
`EXCEPTION WHEN OTHERS THEN NULL` — a migration that cannot be completed safely has to
stop and say so, not report a false success. The one `DROP CONSTRAINT` it carries retires
`payments_exactly_one_parent_check`, which migration 054 superseded; the in-file comment
explains why, and it removes a rule rather than data.

**Order is part of the contract.** Nothing may be created before what it depends on:
tables → columns → indexes → constraints → foreign keys → triggers. An index on a column an
older database does not have yet must come after the column pass, or the whole run aborts
on the first such index.

**Verification must check the SHAPE, not only the name.** `ALTER TABLE … ADD COLUMN IF NOT
EXISTS <name> <type>` is a **no-op when a column of that name already exists under a different
type**, and a foreign key is never removed by a name check. A name-only verification therefore
passes on a database whose payment path still fails at runtime (`42804` for the type, `42703`
for the column). PART 8 consequently also requires both group columns to be `uuid`, each group
index to actually contain `(checkout_group_id)`, and each group foreign key to resolve to
`checkout_groups` with `ON DELETE SET NULL`. `db/verify-reconciler.sh` scenario I breaks each of
those on purpose and proves the run fails and names the object.

### ⚠️ `42703 column "x" does not exist` does NOT mean the query is unqualified (2026-10-04)

Measured, not inferred. PostgreSQL emits the **same message** in two different situations:

| case | situation | message |
|---|---|---|
| (a) | no relation in the statement's FROM/JOIN scope owns `x` | `column "x" does not exist` |
| (b) | the relation **is** in scope, and **the table itself lacks `x`** | `column "x" does not exist` |

The message never names the relation it failed against, so the error text **cannot** distinguish
them. This caused a real misdiagnosis: a production `42703` on `payments.checkout_group_id`
was attributed to a stale deploy and dismissed twice, when the actual cause was that
**production had never received migration 054** — the query was correct and the database was
behind (`.ai/AI_HANDOFF.md`, §66 and the correction that follows it).

**So never diagnose a 42703 from its text.** Read the catalog
(`information_schema.columns` / `pg_attribute` / `pg_constraint`), and confirm *which database*
you are connected to — `describeDatabaseIdentity()` in `backend/db/index.ts` prints both at boot,
and `.github/workflows/diag-neon-schema.yml` probes them on demand.

**Schema qualification.** `db/schema.sql` — and therefore this file's table section — uses
unqualified names, which is the repo-wide convention. The reconciler pins
`SET search_path = public, pg_catalog;` on its first statement and qualifies every statement
that mutates an existing table, so `orders` means `public.orders` deterministically instead of
whatever the session happened to have. `db/verify-reconciler.sh` scenario G runs the whole file
with a decoy schema first in `search_path` and asserts nothing is written there.

## How the reconciler is proved

`bash db/verify-reconciler.sh` (or `bun run db:verify`) builds disposable databases and runs the
real file against them. It is the only check that exercises behaviour rather than text, and it
covers the shape that actually broke production:

| Scenario | What it builds | What it proves |
|---|---|---|
| A | empty database, run ×3 | creates the full schema; runs 2 and 3 change nothing |
| B | **the reported shape** — `checkout_groups` exists, `orders.checkout_group_id` and `payments.checkout_group_id` missing | the columns are added, with their indexes and foreign keys |
| C | legacy — no `checkout_groups` at all | the table and both columns are created |
| D | already-current database, run twice more | no duplicates, no errors |
| E | populated database | existing rows are byte-identical afterwards |
| F | after B/C | one payment with `order_id IS NULL` is accepted, i.e. a group purchase works |
| G | a decoy schema first in `search_path` | nothing is created or altered outside `public` |
| H | **the reported incident** — real `payments` rows with Stripe provider ids, `payments.checkout_group_id` removed | the production statement from `routes/stripe.ts` raises 42703 **before** and resolves the group **after**; the payment row, its provider ids and its `paid` status are unchanged |
| I | a reconciled database, then deliberately broken | PART 8 exits 0 when reconciled, and **fails and names the object** on a wrong-typed column and on a `CASCADE` foreign key |

It exits non-zero unless every assertion it prints actually passed.

## Dependency Ordering

Respect PostgreSQL dependency order (extensions → types → tables → FKs → indexes → functions → triggers → views → seeds). For circular FKs, create tables without the FK then `ALTER TABLE ADD CONSTRAINT` after (deferred via `DO $$ IF NOT EXISTS (pg_constraint)`); do not weaken constraints.

## Migration Workflow

1. Add a new `db/migrations/NNN_*.sql` (idempotent, no `DROP TABLE`).
2. Update **both** `db/schema.sql` and `db/run-sqleditor.sql`.
3. Production receives migrations via `.github/workflows/migrate-neon.yml` (secret `NEON_DATABASE_URL`) or manual apply.
4. Track via `schema_migrations` table.

### ⚠️ The Actions `NEON_DATABASE_URL` is NOT the production database (proven 2026-10-04)

**A green migration run proves nothing about production until you have checked which
database it ran against.** The GitHub Actions secret `NEON_DATABASE_URL` resolves to a
*different* Neon database from the one Render's `DATABASE_URL` connects to. Measured on
2026-10-04:

| | Actions `NEON_DATABASE_URL` (`current_database = neondb`) | Production, via `GET /api/shops` on `velnox-api.onrender.com` |
|---|---|---|
| shops | **1** — `5d56f6f8…/eloop` | **2** — `26d65318…/home-tech`, `91f4b9bf…/velnox-support` |
| users / products / sellers | 3 / 1 / 1 | not exposed publicly |
| orders / payments | 0 / 0 | real purchases exist |

The two sets are disjoint. Consequences:

* Migration `054_checkout_groups_numeric_order_number` **is applied and present** on the
  Actions database, and production still raised
  `relation "checkout_groups" does not exist` / `42P01` on real checkout. The table was
  never missing — it was missing *from the database checkout actually ran against*.
* Every earlier "schema is fine, it must be something else" conclusion drawn from the
  Actions ledger is subject to this. The ledger describes the Actions database only.

**Before trusting any ledger read, prove the identity first.** The read-only probes in
`.github/workflows/diag-neon-schema.yml` now answer it directly — `rowcount.shops`,
`shops.ids (first 5)` and `current_database`. Compare them against what the live host
serves before drawing a conclusion. Re-pointing the secret at the Neon project Render
owns is an owner action on GitHub Secrets (the repo's app token gets `403` on both
`secrets` and `workflow_dispatch`).

Startup must never run DDL (`ALTER TABLE`).

### Why the two URLs were never checked against each other (2026-10-04)

Measured from the tracked tree: **no real Neon endpoint, hostname or credential is committed
anywhere.** Every `neon.tech` in a tracked file is a placeholder (`ep-xxx`), a CI guard fixture
(`ep-ci-guard-check`, used only to prove the suite refuses a production-looking URL), or a doc
example. Render's `DATABASE_URL` is **not defined in this repository at all** — it exists only in
Render's dashboard. The Actions URL is only ever referenced as `${{ secrets.NEON_DATABASE_URL }}`
in three workflows (`migrate-neon.yml`, `diag-neon-schema.yml`, `diag-stripe-payment-trace.yml`).

So the two databases **share no definition in the repo**, which means nothing in CI or in the
codebase can ever assert they are the same endpoint — the divergence is structural, not a stale
value that a refresh would fix. The only places identity can be established are, in order:

1. `describeDatabaseIdentity()` at API boot — prints `current_database()` and whether the payment
   schema is present, from whichever database that process actually opened.
2. `.github/workflows/diag-neon-schema.yml` — `current_database`, `rowcount.shops`,
   `shops.ids (first 5)`, and the `payments.checkout_group_id` type/FK probes.

Compare those against what the live host serves **before** trusting any ledger read. Never print
either connection string: a Neon URL embeds its password, so only the database name is safe to
report (`safeDatabaseLabel()` exists for exactly this).

## Test Database

Tests never touch `DATABASE_URL` — that value is production. `TEST_DATABASE_URL`
names a disposable PostgreSQL the DB-gated integration tests may write to;
bootstrap it once with `db/run-sqleditor.sql`. The guard is
`backend/db/test-database.ts`, wired into the pool factory via
`resolveConnectionString()` in `backend/db/index.ts`. See `testing.md`.

## Pool Configuration & Latency Attribution

Single pool in `backend/db/index.ts`. Current shape and why:

| Option | Value | Why |
|--------|-------|-----|
| `max` | 20 | unchanged |
| `min` | **1** | Warm floor. pg-pool arms its idle-reap timer only while `_clients.length > min`, so the last client is never reaped. Without it the pool empties 30 s after the previous query and the next statement pays the whole TCP/TLS/auth handshake to Neon (~1.3 s measured 2026-09-28) on its own critical path |
| `idleTimeoutMillis` | 30000 | Bursts still trim back down to `min` |
| `connectionTimeoutMillis` | 5000 | Bounds acquiring a connection |
| `query_timeout` | 15000 | Client-side statement deadline — **the only** timeout that may be set here |
| `maxLifetimeSeconds` | 1800 | Bounds the age of the now-persistent connection (client-side timer) |

**Never add a server-side/startup parameter** — `statement_timeout`, `lock_timeout`,
`idle_in_transaction_session_timeout`, or `keepAlive` (pg sends it as `keepalives`): Neon's
PgBouncer rejects an untracked startup parameter, which breaks **every** connection instead of one
route. `query_timeout` is enforced in-process, which is what makes it safe on this deployment.

**Read a slow-query log line by its split, not its total.** `query()` logs
`acquire Xms + execute Yms = Zms, layer=pool-connection|statement, pool idle/total/waiting`. A warm
round trip here is ~0.2 s, so the total alone cannot distinguish a bad plan from a cold pool: a
large acquire with a small execute is connection checkout, the reverse is the statement/database.
`classifySlowQuery()` performs that attribution (pinned by `backend/tests/db-latency.test.ts`);
`db-client-release.test.ts` guards the lease/release half, and `webhook-resilience.test.ts` guards
the bounded waits.

### Owner read-only check before changing ANY index

Run in the Neon SQL Editor. `EXPLAIN` only, and never `ANALYZE` on a mutating statement:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount, status, reason, created_at, refunded_at
  FROM refunds WHERE order_id = '<order-uuid>' ORDER BY created_at ASC;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM velrepeat_plans
 WHERE status = 'active' AND next_run_at <= NOW()
 ORDER BY next_run_at ASC LIMIT 25;

SELECT indexrelname, idx_scan, idx_tup_read FROM pg_stat_user_indexes
 WHERE relname IN ('refunds', 'velrepeat_plans') ORDER BY relname, indexrelname;

SELECT relname, n_live_tup, n_dead_tup, last_analyze, last_autoanalyze
  FROM pg_stat_user_tables WHERE relname IN ('refunds', 'velrepeat_plans');
```

Expected: `refunds` → Index Scan on `idx_refunds_order`; `velrepeat_plans` → Index Scan on
`idx_velrepeat_plans_due` (the partial index) with **no Sort**. Only a Seq Scan justifies an
index/statistics change — check `pg_indexes` for an equivalent index first so none is duplicated,
then update `db/schema.sql` + `db/run-sqleditor.sql` together. This is the evidence bar for a
composite index such as `refunds (order_id, created_at)`: the 2026-09-28 investigation rejected it
because the latency was connection acquisition, not the plan (handoff §34).

## Payment reservation (orders.payment_expires_at)

`orders` carries the fixed 30-minute payment reservation: `payment_expires_at TIMESTAMPTZ`
(NULL = no window — COD orders and every row that predates the feature, which the sweep ignores)
and `reservation_policy JSONB` (the audited policy: `{version: "v2", reservationMinutes: 30,
reason, expiresAt}`; a v1 row with `riskLevel` + `signals` is historical data only — the risk-band
calculation no longer exists). Both are written by `backend/lib/payment-reservation.ts` inside the
order-creation transaction; nothing else writes them.

`idx_orders_payment_expires_at ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL`
serves the sweep's range scan **and** its `ORDER BY`; the status / `inventory_released` filters are
applied by `backend/jobs/payment-reservation-scheduler.ts` to the few due rows. The index predicate
is deliberately loose: one index, no duplicated status list to drift out of sync.

Introduced by `db/migrations/048_payment_reservation.sql` (additive, idempotent, no backfill).
Apply it to production **before** deploying a backend that writes the column — but the order does
not have to be perfect: the reservation write runs inside a `SAVEPOINT` and tolerates **only**
`undefined_column`, so a backend that is newer than its database keeps checkout working (orders
simply get no window, exactly like legacy rows) and says so in the log. The sweep logs the missing
column once and stays disabled until a scan succeeds after the migration.

```sql
-- what the sweep reads (read-only owner check)
SELECT id, status, payment_expires_at FROM orders
 WHERE payment_expires_at IS NOT NULL AND payment_expires_at <= NOW()
   AND status IN ('pending', 'pending_payment') AND inventory_released = FALSE
 ORDER BY payment_expires_at ASC LIMIT 25;

-- the health of the feature: how many windows are open, and how many lapsed but unswept
SELECT count(*) FILTER (WHERE payment_expires_at > NOW()) AS open_windows,
       count(*) FILTER (WHERE payment_expires_at <= NOW()
                          AND status IN ('pending','pending_payment')
                          AND inventory_released = FALSE) AS lapsed_unswept
  FROM orders WHERE payment_expires_at IS NOT NULL;
```

## Safety & Verification

- Never `DROP DATABASE/SCHEMA/TABLE` or `TRUNCATE` without explicit owner auth.
- Verify: declaration parity between `db/schema.sql` and `db/run-sqleditor.sql`
  (`canonicalParity()` must be empty), `db-run-sqleditor-reconciler.test.ts` (every new
  column has its `ADD COLUMN IF NOT EXISTS` pass), `git diff --check`, dependency order,
  and both questions: *"Can an empty Neon become the current DB by running
  `db/run-sqleditor.sql` once?"* and *"If I run it a second and third time, does anything
  change — and are no rows lost on an old database?"*
- Also check `db/run-update.sql` was not resurrected, and that the reconciler contains no
  `DROP TABLE` / `DROP COLUMN` / `TRUNCATE` / `DELETE FROM` and no `EXCEPTION` handler.

Related: `.ai/AI_RULES.md` §6, `INSTALLATION.md` §5–6, `docs/DATABASE.md`.
