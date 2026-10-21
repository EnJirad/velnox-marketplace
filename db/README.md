# `db/` — which schema is the truth?

There are **two database states** in this repository during the MVP rewrite. They
are deliberately not mixed, and only one of them is canonical at a time.

| State | Files | Status | Used by |
|---|---|---|---|
| **MVP (canonical from Phase 2)** | `db/mvp/schema.sql`, `db/mvp/reset.sql`, `db/mvp/seed.sql` | **Source of truth for the MVP database.** Actively edited. | `db/mvp/verify.sh`, CI's MVP verification step, Phase 3+ |
| **Pre-MVP (frozen)** | `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/*.sql`, `db/verify-reconciler.sh` | **FROZEN.** No new tables, columns or migrations. Do not edit while the pre-MVP backend is deployed. | the currently deployed backend, the existing test suite, the production DB workflows |

`db/run-update.sql` does not exist and must never be recreated.

## Why the frozen pair still exists

The backend deployed today reads the 77-table pre-MVP schema. Replacing
`db/schema.sql` in place would break that deployment, the fresh-bootstrap
contract in `.github/workflows/test.yml`, and the 77-table assertions in the
existing suite — none of which Phase 2 is allowed to rewrite. The pre-MVP pair is
therefore kept byte-for-byte and scheduled for deletion in the cutover
(`db/mvp/cutover.md`), **not** edited into a half-MVP state.

## Commands

```bash
# Prove the MVP schema against disposable PostgreSQL databases.
# Needs TEST_DATABASE_URL; creates and drops its own databases.
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_test \
  bash db/mvp/verify.sh          # or: bun run db:verify:mvp

# Rebuild ONE disposable development/test database (destructive; guarded).
VELNOX_RESET_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/velnox_dev \
  bash db/mvp/reset.sh --seed    # or: bun run db:reset -- --database-url ... --seed

# Pre-MVP reconciler proof (legacy; unchanged).
bun run db:verify
```

## Hard rules

- **Never** run `reset.sql`/`reset.sh`, `DROP`, or `TRUNCATE` against production.
  The reset refuses anything whose database name does not end in `_dev`/`_test`
  **and** whose session has not explicitly set `velnox.allow_reset=yes`.
- The reset wrapper never falls back to `DATABASE_URL`; you must name the target.
- `db/migrations/` is frozen history. The pre-MVP production workflow still
  applies it; it is retired at cutover, not now.
- Money is `NUMERIC(12,2)`; IDs are UUIDs from `gen_random_uuid()`; no extension
  is required by the MVP schema.
