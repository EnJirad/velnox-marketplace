# AGENTS.md — Velnox Marketplace

Monorepo (`bun` workspaces: `apps/velshop|velseller|velcenter|velnox`, `backend`, `packages/shared`). Default branch: `main`.

## What is Velnox

Multi-vendor marketplace. Four Vercel frontends → one Render backend (Express + WebSocket) → one Neon PostgreSQL (source of truth) + Cloudflare R2 (file storage). Google OAuth + JWT httpOnly cookies. Languages: th, en, my.

## Progressive Context Loading — START HERE

```
1. AGENTS.md                          ← always (this file)
2. AI_RULES.md                        ← when changing code
3. docs/ai/PROJECT_MAP.md             ← to locate files
4. docs/ai/<SUBSYSTEM>.md             ← only the subsystem you touch
5. Actual source code                 ← authoritative implementation
6. Verify → update AI_Handoff.md
```

Do NOT read every doc file. Load the smallest useful set.

| Task | Read this next |
|------|---------------|
| Fix product card / catalog | `docs/ai/PRODUCTS.md` |
| Fix category selector / tree | `docs/ai/CATEGORIES.md` + `docs/ai/SELLER.md` |
| Fix login / session | `docs/ai/AUTH.md` |
| Fix image upload / R2 | `docs/ai/MEDIA.md` |
| Fix checkout / orders | `docs/ai/CHECKOUT.md` |
| Fix database / schema | `docs/ai/DATABASE.md` |
| Fix styling / theme | `docs/ai/DESIGN.md` |
| Full audit | `docs/ai/ARCHITECTURE.md` then subsystems as needed |

History in `docs/ai/history/` is **reference only** — do not load automatically.

## Rules for Every Task

1. **Inspect before editing** — verify the file, function, route, table, and schema exist in the current repo. Previous AI memory may be stale; the repo wins.
2. **Minimal correct change** — fix the root cause, preserve existing functionality, reuse existing systems. No duplicate tables, APIs, or components.
3. **Source of truth** — `Neon → Backend API → Frontend`. Frontend never touches Neon or server secrets. No fake data or mock APIs unless explicitly requested.
4. **Database sync** — any schema change must update **both** `db/schema.sql` and `db/run-sqleditor.sql` (see `docs/ai/DATABASE.md`). Never recreate `db/run-update.sql`.
5. **Verify** — `git diff --check`, typecheck/build relevant apps, and test the affected flow.
6. **Handoff** — update `AI_Handoff.md` with current state only (not history).
7. **Auto-commit and push** — when a repository-changing task completes successfully, commit the changes and push to GitHub via Git CLI. Do not stop after editing or committing. See *Default Completion State* below and `docs/ai/WORKFLOW.md`.

### Default Completion State

A successful repository-changing task ends with ALL of:

```
implementation complete
+ validation passed (typecheck / tests / diff --check)
+ commit created
+ commit pushed via git push origin <branch>
+ remote verified (local SHA == remote SHA)
+ AI_Handoff.md updated when required
+ working tree clean
```

Do not say "done" until every line is true. If any step fails, report the exact failure and state.

If the user explicitly says *do not commit* / *do not push* / *keep changes local*, skip only those steps and report `NOT PUSHED — USER REQUEST`.

## Quick Reference

- Install: `bun install` · Dev: `bun run dev:velshop` + `bun run api:dev` · Typecheck: `bun run typecheck` · DB bootstrap: run `db/run-sqleditor.sql` once in Neon SQL Editor
- Docs: `INSTALLATION.md` (setup), `VELNOX_DESIGN_THEME.md` (design source of truth), `docs/ai/README.md` (full context map)
- Repo: `https://github.com/EnJirad/velnox-marketplace.git`

## Repo Conventions

- Default branch: `main`. Feature branches: `fix/…`, `feat/…`; open PRs only when asked.
- Commit style: `fix(velshop): …`, `feat(db): …`, `docs(ai): …`. Always `git diff --check` clean before commit.
- Push: `git push origin <branch>` — Git CLI only. No GitHub REST API / Git Data API fallback.
- If push fails, diagnose the Git error. Do not fabricate alternative push mechanisms.
- Never `git push --force` unless owner-instructed and verified safe.
