# TESTING — How to Verify

## Commands (from package.json — do not invent)

| What | Command |
|------|---------|
| All apps typecheck | `bun run typecheck` |
| Single app/backend | `bun --filter @velnox/velshop typecheck` / `cd backend && bun tsc --noEmit` |
| Build all apps | `bun run build:apps` (or `build:velshop` etc.) → `apps/<app>/dist` |
| Tests | `bun test backend/tests` (`bun test` alias is `test`) |
| i18n | `bun packages/shared/scripts/i18n-check.ts` (also `bun run i18n:check`) |
| Git hygiene | `git diff --check` |

Lint/format are placeholders (`echo 'Lint not yet configured'`).

## What to Run

- **Frontend change:** typecheck affected app(s) + build if needed; check affected page, responsive, and no raw i18n keys.
- **Backend change:** `cd backend && bun tsc --noEmit` + hit affected `GET/POST/PATCH /api/*`; verify auth/authz/ownership and error shapes.
- **Shared package change:** typecheck all apps + backend (wildcard exports affect everyone).
- **Database change:** SQL validity + `diff db/schema.sql db/run-sqleditor.sql` sync + dependency order + fresh-DB question (YES) + app queries still valid. Never `DROP/TRUNCATE` prod.
- **Full-system change:** all of the above + `bun run i18n:check` if i18n touched.

## Before Declaring Done

`git diff --check` clean, no new type errors, `AI_Handoff.md` updated, `db/*.sql` synced if DB changed, no secrets committed, no `db/run-update.sql` resurrected.
