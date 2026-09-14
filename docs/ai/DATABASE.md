# DATABASE

## Source of Truth

Neon PostgreSQL. Single `pg.Pool` in `backend/db/index.ts` (SSL `verify-full`). Frontend never connects directly.

## Canonical Files — MUST Stay Synchronized

| File | Purpose | Rule |
|------|---------|------|
| `db/schema.sql` | Complete current schema snapshot | Authoritative structure |
| `db/run-sqleditor.sql` | Complete idempotent fresh-DB bootstrap | Run once on an **empty** DB to get the full current DB |
| `db/run-update.sql` | **Deprecated** — do not recreate, update, or depend on it | — |
| `db/migrations/001_*.sql` … | Historical migrations (idempotent, `IF NOT EXISTS`) | History only; do not rewrite |

`db/schema.sql` and `db/run-sqleditor.sql` must represent the **same final structure** and be updated together on every schema change. No SQL comments inside them (put notes in handoff/docs).

## What Must Be in the Canonical Files

Tables, columns, types, defaults, PKs, FKs, unique/check constraints, indexes (including partial/expression), extensions, enums, functions, triggers, views — anything the current app requires. If it was added after initial schema and is still used, it must be present. No partial bootstrap.

## Fresh-DB Contract

```
Empty Postgres  →  run db/run-sqleditor.sql once  →  complete current Velnox DB
```

No prior migrations, no `ALTER TABLE` tail required. Historical `db/migrations/` are for upgrading existing DBs, not for fresh creation. Never run the bootstrap against production as a migration; never `DROP/TRUNCATE` prod to make it pass.

## Dependency Ordering

Respect PostgreSQL dependency order (extensions → types → tables → FKs → indexes → functions → triggers → views → seeds). For circular FKs, create tables without the FK then `ALTER TABLE ADD CONSTRAINT` after (deferred via `DO $$ IF NOT EXISTS (pg_constraint)`); do not weaken constraints.

## Migration Workflow

1. Add a new `db/migrations/NNN_*.sql` (idempotent, no `DROP TABLE`).
2. Update **both** `db/schema.sql` and `db/run-sqleditor.sql`.
3. Production receives migrations via `.github/workflows/migrate-neon.yml` (secret `NEON_DATABASE_URL`) or manual apply.
4. Track via `schema_migrations` table.

Startup must never run DDL (`ALTER TABLE`).

## Safety & Verification

- Never `DROP DATABASE/SCHEMA/TABLE` or `TRUNCATE` without explicit owner auth.
- Verify: `diff db/schema.sql db/run-sqleditor.sql` is clean (structure), `git diff --check`, dependency order, and that the fresh-DB question is YES: *"Can an empty Neon become the current DB by running `db/run-sqleditor.sql` once?"*
- Also check `db/run-update.sql` was not resurrected.

Related: `AI_RULES.md` §6, `INSTALLATION.md` §5–6, `docs/DATABASE.md`.
