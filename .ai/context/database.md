# DATABASE

## State (2026-10-22) — `db/` holds exactly two files

| File | Purpose |
|------|---------|
| `db/schema.sql` | **The canonical MVP DDL.** The only description of the data model there is. |
| `db/run-sqleditor.sql` | The same DDL in dependency order for the Neon SQL Editor, then a guarded **additive upgrade** for a database installed from an older version, then a read-only install check. |

Nothing else lives in `db/`: no `db/mvp/`, no `db/migrations/`, no `db/README.md`,
no seed, no reset, no verifier scripts. Tooling lives in `scripts/` and docs live
outside `db/` entirely.

The **CREATE DDL is contractually identical** in both files — same tables,
columns, types, constraints, indexes, triggers, same names, same definitions.
The installer may additionally carry an additive upgrade section
(`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, guarded `ADD CONSTRAINT` blocks) so
an existing database can be brought forward; `db/schema.sql` stays a pure
snapshot. Neither file may carry a comment (`--`, `/* */`) or a
destructive/data-writing statement (`DROP`, `TRUNCATE`, `DELETE`, `INSERT`,
`UPDATE`). Explanations belong in `docs/DATABASE.md`,
`docs/PRODUCTION_CUTOVER.md` and this file.

## The schema, in one paragraph

23 tables · 229 columns · 86 indexes · 167 constraints · 7 triggers. Users with
`revoked_tokens`, `user_identities` (Google linking) and `cover_url`;
`seller_profiles` with an approval `status` gating every
product write; categories, products, product variants (no stock of their own),
product images, `product_selling_units` (N base units for the seller's own
price — **no stock column**: `inventory` is the only stock authority and a pack
purchase reserves `quantity × base_quantity`); one `inventory` row per
`(product_id, variant_id)`; addresses; one cart per `(user, seller)`; orders
with **one six-value status axis** (`pending_payment`, `paid`, `processing`,
`shipped`, `delivered`, `cancelled`) and JSONB/item snapshots; `payments` +
`payment_events` for webhook idempotency; `checkout_requests(user_id,
request_key)` for checkout idempotency; `product_favorites` and
`product_reviews` (one row per user per product, `rating 1–5`, `published`/
`hidden`); shipments; `audit_logs`.

Rules that must never drift:

- money is `NUMERIC(12, 2)` everywhere; nothing converts a money column to
  `Number`/`parseFloat`/`toFixed`;
- `inventory` is the single stock authority; checkout reserves with a guarded
  `UPDATE … WHERE quantity - reserved >= n` inside a transaction, commits or
  releases exactly once;
- lifecycle machines live in **database triggers** (`23514`/`P0001` are mapped
  by the API to **409**), not in application code;
- every creation statement is guarded (`IF NOT EXISTS` / `ON CONFLICT`), so a
  second run changes nothing;
- a column added to an **existing** table after the first install must also
  appear in the installer's upgrade section, or a re-run cannot repair a
  database that predates it (`users.cover_url`, `addresses.latitude`,
  `addresses.longitude` today);
- no `order_state`, no `shops`, no `checkout_groups`, no `velrepeat_*`, no
  `wholesale`/`is_wholesale` — pinned by
  `backend/tests/mvp-schema-contract.test.ts` and
  `backend/mvp/tests/isolation.test.ts`.

## How the two files are proved

| Command | What it proves | Needs a DB? |
|---|---|---|
| `bun run db:check` (`scripts/db-verify.sh`) | **Both** files apply to an empty database, **both apply a second time**, and the two `pg_dump --schema-only` results are identical | yes (disposable) |
| `bun run db:verify` (`backend/tests/mvp-schema-contract.test.ts`) | Declaration parity, the 23-table inventory, no non-MVP column, one order axis, one stock authority, `NUMERIC(12,2)`, seven lifecycle triggers, rerunnability, no comments/destructive SQL, `db/` contains only the two files | no |
| `bun run test:mvp` (`scripts/db-test-run.sh`) | Builds `velnox_mvp_app_test` from `db/schema.sql` and runs `backend/mvp/tests/**` — auth, cart, checkout, overselling, inventory, payments/webhook idempotency, seller/admin authorisation, selling units | yes (disposable) |

Never point any of these at production. See *Test Database* below.

## Fresh-DB and rerun contract

An empty Postgres becomes the complete Velnox schema by running either file
**once**, with no prior migrations. Running it a **second time must change
nothing** — no duplicate table, column, constraint, index or trigger — and must
never touch a row. Respect PostgreSQL dependency order (extensions → types →
tables → FKs → indexes → functions → triggers → views); for circular FKs create
the tables first and `ALTER TABLE ADD CONSTRAINT` afterwards. Do not weaken a
constraint to break a cycle.

## There is no migration chain

`db/migrations/` (62 files), the migration runner and
`.github/workflows/production-db-migrate.yml` were removed together. Nothing in
this repository applies incremental SQL. `db/run-update.sql` is deprecated —
never create, edit or reference it. A schema change is a change to **both**
canonical files in the same commit, re-proved with `bun run db:check`.

## Production is a separate, unexecuted change

Production still runs the **pre-MVP** database. The repository can no longer
talk to it (the routes that did are gone), and the switch is planned, not done:
`docs/PRODUCTION_CUTOVER.md`.

| Workflow | Role | Secret | Writes to production? |
|---|---|---|---|
| `diag-neon-schema.yml` | read-only schema inventory | `NEON_PRODUCTION_DATABASE_URL` | never |
| `diag-stripe-payment-trace.yml` | read-only payment trace | `NEON_PRODUCTION_DATABASE_URL` | never |
| `test.yml` | CI typecheck + tests | **none** (throwaway postgres service) | never |
| ~~`production-db-verify.yml`~~ | retired with the pre-MVP object set | — | — |
| ~~`production-db-migrate.yml`~~ | retired with the migration chain | — | — |

Standing rules:

- **No silent fallback.** A production step never substitutes another variable
  when the secret is absent; it stops with
  `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`
- **No hard-coded credential.** No committed remote connection string in any
  workflow; the only permitted URLs are the `localhost` service container and
  the `ep-ci-guard-check` fixture, which nothing connects to.
- **CI never touches production.** `test.yml` references no secret at all, and
  the guard refuses a production-looking `DATABASE_URL`.
- **Verification never repairs.** A missing object FAILs and names the fix.
- **Identity is proven, not assumed.** Every production run prints
  `current_database()`, `current_schema()`, `server_version`, `current_user`
  and a row-count fingerprint — never the host, password or connection string.
  `describeDatabaseIdentity()` does the same at API boot;
  `safeDatabaseLabel()` is what you print (a Neon URL embeds its password).

### ⚠️ `42703 column "x" does not exist` does NOT mean the query is unqualified

Measured, not inferred. PostgreSQL emits the **same message** in two different
situations: (a) no relation in the statement's scope owns `x`, or (b) the
relation **is** in scope and **the table itself lacks `x`**. The message never
names the relation, so the error text cannot distinguish them. A production
`42703` was therefore attributed to a stale deploy and dismissed twice when the
real cause was that production had never received the migration.

**Never diagnose a 42703 from its text.** Read the catalog
(`information_schema.columns` / `pg_attribute` / `pg_constraint`) and confirm
*which database* you are connected to first. A `42703` never proves whether the
database or the code is wrong.

### ⚠️ Prove which database you are on before trusting any read

The retired Actions secret `NEON_DATABASE_URL` pointed at a **different** Neon
from Render's `DATABASE_URL` (measured 2026-10-04: disjoint shops/orders
sets). A green run against it proved nothing about production. The two
definitions do not share any value in this repository, so the divergence is
structural — identity can only be established at the two places listed above,
compared against what the live host actually serves. Creating the
`NEON_PRODUCTION_DATABASE_URL` secret is an owner action on GitHub Secrets.

## Test Database

Tests never touch `DATABASE_URL` — that value is production.
`TEST_DATABASE_URL` names a disposable PostgreSQL the DB-gated tests may write
to; its name must end in `_test`. The guard is `backend/db/test-database.ts`,
wired into the pool through `resolveConnectionString()` in
`backend/db/index.ts`, and `backend/tests/setup.ts` aborts the run before any
fixture loads. Nothing configured → DB-gated tests skip; that is the normal
state in a sandbox without credentials. See `testing.md`.

## Pool Configuration & Latency Attribution

Single pool in `backend/db/index.ts`:

| Option | Value | Why |
|--------|-------|-----|
| `max` | 20 | unchanged |
| `min` | **1** | Warm floor. pg-pool arms its idle-reap timer only while `_clients.length > min`, so the last client is never reaped; without it the next statement pays the whole TCP/TLS/auth handshake to Neon (~1.3 s measured) on its critical path |
| `idleTimeoutMillis` | 30000 | Bursts still trim back down to `min` |
| `connectionTimeoutMillis` | 5000 | Bounds acquiring a connection |
| `query_timeout` | 15000 | Client-side statement deadline — **the only** timeout that may be set here |
| `maxLifetimeSeconds` | 1800 | Bounds connection age (client-side timer) |

**Never add a server-side/startup parameter** — `statement_timeout`,
`lock_timeout`, `idle_in_transaction_session_timeout`, or `keepAlive`: Neon's
PgBouncer rejects an untracked startup parameter, which breaks **every**
connection instead of one route.

**Read a slow-query log line by its split, not its total.** `query()` logs
`acquire Xms + execute Yms = Zms`. A warm round trip is ~0.2 s, so the total
alone cannot distinguish a bad plan from a cold pool: a large acquire with a
small execute is connection checkout, the reverse is the statement/database.
`classifySlowQuery()` performs that attribution.

## Payment window (`orders.payment_expires_at`)

Checkout reserves stock for a fixed 30-minute window and writes
`payment_expires_at` inside the order-creation transaction; nothing else writes
it. `idx_orders_payment_expires_at … WHERE status = 'pending_payment'` serves
the sweep's range scan and its `ORDER BY`.

The sweeper is `backend/jobs/mvp-order-expiry-scheduler.ts` — it starts with
the service and honours `MVP_ORDER_EXPIRY_SCHEDULER=off`, which hands the job to
`POST /api/mvp/admin/maintenance/expire-pending-orders`. Each candidate is
claimed with `FOR UPDATE SKIP LOCKED` and cancelled through the one cancellation
authority, so overlapping ticks or instances cannot double-release stock.

Read-only owner check:

```sql
SELECT id, status, payment_expires_at FROM orders
 WHERE status = 'pending_payment' AND payment_expires_at <= NOW()
 ORDER BY payment_expires_at ASC LIMIT 25;
```

## Safety & Verification

- Never `DROP DATABASE`/`SCHEMA`/`TABLE`, `TRUNCATE` or `DELETE` without
  explicit owner authorisation, and never against production.
- A schema change updates **both** files and is proved by `bun run db:check`,
  `bun run db:verify` and `bun run test:mvp`.
- Also assert `db/run-update.sql` was not resurrected and that `db/` still
  contains exactly two files (the contract test does).
- `git diff --check` must be clean; no secrets in any committed file.

Related: `.ai/AI_RULES.md` §6, `INSTALLATION.md`, `docs/DATABASE.md`,
`docs/PRODUCTION_CUTOVER.md`.
