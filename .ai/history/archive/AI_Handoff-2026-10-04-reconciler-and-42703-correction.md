# Archived from `.ai/AI_HANDOFF.md` — 2026-10-04 (edit-headroom housekeeping)

> **Reference only.** Current state lives in `.ai/AI_HANDOFF.md`; the reconciler's
> contract is maintained in `.ai/context/database.md`.
>
> The `db/run-sqleditor.sql` reconciler narrative below is superseded as *current state*
> by the handoff's current sections and by `database.md`. It is kept verbatim because it
> records **why** three latent defects existed and what each fix changed — the reasoning
> is not duplicated anywhere else.

## `db/run-sqleditor.sql` is now a rerunnable additive reconciler (2026-10-04)

The Neon SQL Editor file was a copy of `db/schema.sql`, so it could only ever describe an
EMPTY database. Production already has tables and rows, so "run it again" was never safe and
"run it once on production" could not bring production up to the current schema.

It is now derived from `db/schema.sql` (the only source of truth) in seven ordered passes:

| Pass | What it does |
|---|---|
| 1 | `CREATE TABLE IF NOT EXISTS` — the snapshot |
| 2 | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for all 652 columns, then `SET NOT NULL` only where no row is NULL |
| 2c | `DROP NOT NULL` where the schema no longer requires it (this is what makes `payments.order_id` work on an old database) |
| 3 | indexes — **after** the column pass |
| 4 | foreign keys, guarded on `pg_constraint` |
| 5 / 5c | unique + check constraints; checks `schema.sql` deliberately re-declares, re-applied only when the stored definition differs |
| 6 | the trigger, guarded on `pg_trigger` |
| 7 | read-only verification `SELECT`s |

Never `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DELETE`; never an `EXCEPTION` handler, so
an unfixable problem stops the run instead of reporting a false success.

**PART 8 asserts, it does not only report.** PART 7 prints the object state; PART 8 then
raises if `checkout_groups`, either group column, a group index or a group foreign key is
still absent when the run ends, naming every missing object. So a green run means the
database really was reconciled, never that the script stayed quiet. Proven live: the block
alone against an empty database exits 3 with all nine objects listed, and against a
reconciled one emits a NOTICE and exits 0. The file also runs correctly as a SINGLE
transaction (`psql -1`), which is how the Neon SQL Editor executes a pasted script.

**Three latent defects fixed on the way, all of which had bitten or would have bitten production:**

1. `orders_checkout_group_id_fkey` was declared in `db/schema.sql` **before**
   `CREATE TABLE checkout_groups`, so a fresh database aborted with `42P01`. `db/schema.sql`
   itself now bootstraps cleanly — it previously did not.
2. Indexes were created in the table section. On a database that has `orders` but not yet
   `orders.checkout_group_id`, `CREATE INDEX … idx_orders_checkout_group` aborted the entire
   run. Indexes now follow the column pass.
3. Six CHECK constraints (`orders_status_check`, `sellers_status_check`, the two velrepeat
   status checks, the two pricing-snapshot checks) were `DROP`+`ADD` re-declarations in
   `schema.sql` because their definition changed over history. A name-only guard silently
   keeps the OLD definition on an older database and rejects a value the canonical schema
   allows. They are now compared against the canonical definition and re-applied only when
   they differ.

`payments_exactly_one_parent_check` is retired by the one `DROP CONSTRAINT` the file carries
(migration 054 superseded it; left in place it rejects every multi-shop payment). It removes a
rule, not data, and is commented in place.

**THE ACTUAL REPORTED FAILURE WAS DIFFERENT, and it is now the pinned scenario.** Production
had `checkout_groups` **existing** while `orders.checkout_group_id` was **missing**, so the
root cause was never "the table is absent". It was that `checkout_group_id` existed ONLY inside
`CREATE TABLE IF NOT EXISTS orders (…)` — a no-op for a table that already exists — and the
file contained exactly **one** `ADD COLUMN IF NOT EXISTS` in total, none of them for this
column. `CREATE TABLE IF NOT EXISTS checkout_groups` then ran and succeeded, which is exactly
why the table existed while the column did not. The first statement that *references* the
column (`CREATE INDEX … idx_orders_checkout_group`) errors, so any reconciliation placed after
it would be dead code. `db/verify-reconciler.sh` scenario B builds precisely that state.

**Schema qualification.** The file now pins `SET search_path = public, pg_catalog;` on its first
statement and qualifies every statement that mutates an existing table, so `orders` means
`public.orders` deterministically rather than whatever the session had. Scenario G runs the
whole file with a decoy schema first in `search_path` and asserts nothing is written there.

**Verified** by `bash db/verify-reconciler.sh` (`bun run db:verify`) — 7 scenarios, all PASS,
including the reported production shape, legacy, twice-more, data preservation, an accepted
group payment, and the hostile-`search_path` case. `db/schema.sql` built and
`db/run-sqleditor.sql` built produce an **identical** 1267-object catalog. `pnpm test`
1926 pass / 2 skip / 0 fail; typecheck 4/4; `build:apps` 4/4.

**Declaration parity is not sufficient, and there is no in-repo generator.** Adding a column
to `db/schema.sql` without a matching `ALTER TABLE … ADD COLUMN IF NOT EXISTS` leaves the
parity check green while every older database silently never receives the column — the run
exits 0 and checkout breaks later, in production. `backend/tests/db-run-sqleditor-reconciler.test.ts`
closes that, plus index ordering, constraint guards and the additive-only guarantee (17 tests,
verified non-vacuous by injecting a column with no column pass and watching it fail). The
additive passes are maintained by hand alongside the snapshot; run that file after any
schema change.

**The two canonical files are no longer byte-identical, on purpose.** The contract between
them is declaration parity, asserted by `backend/tests/helpers/canonical-schema.ts`, and the
11 tests that pinned byte-identity now pin that instead. `db/run-update.sql` remains absent.

---
