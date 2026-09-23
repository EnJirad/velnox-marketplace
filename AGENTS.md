# AGENTS.md — Velnox Marketplace

Monorepo (`bun` workspaces: `apps/velshop|velseller|velcenter|velnox`, `backend`, `packages/shared`). Default branch: `main`.

## What is Velnox

Multi-vendor marketplace. Four Vercel frontends → one Render backend (Express + WebSocket) → one Neon PostgreSQL (source of truth) + Cloudflare R2 (file storage). Google OAuth + JWT httpOnly cookies. Languages: th, en, my.

## Progressive Context Loading — START HERE

The canonical agent workspace is **`.ai/`**. Startup protocol, context-loading policy, and task-brief format: `.ai/README.md`.

```
1. AGENTS.md                          ← always (this file)
2. .ai/AI_RULES.md                    ← when changing code
3. .ai/AI_HANDOFF.md                  ← current state + remaining gaps
4. .ai/context/project-map.md         ← to locate files
5. .ai/context/<subsystem>.md         ← only the subsystem you touch
6. Actual source code                 ← authoritative implementation
7. Verify → update .ai/AI_HANDOFF.md
```

Do NOT read every doc file. Load the smallest useful set.

| Task | Read this next |
|------|---------------|
| Assigned work brief | `.ai/tasks/active/` |
| Fix product card / catalog | `.ai/context/products.md` |
| Fix category selector / tree | `.ai/context/categories.md` + `.ai/context/seller.md` |
| Fix login / session | `.ai/context/security.md` |
| Fix image upload / R2 | `.ai/context/media.md` |
| Fix checkout / orders | `.ai/context/checkout.md` |
| Fix database / schema | `.ai/context/database.md` |
| Fix API / backend / authz | `.ai/context/backend.md` |
| Fix realtime / live updates | `.ai/context/realtime.md` |
| Fix styling / theme / mobile | `.ai/context/frontend.md` |
| Full audit | `.ai/context/architecture.md` then subsystems as needed |

History is **reference only** — do not load it automatically:
`.ai/history/AI_Handoff_Archive.md` (dated index) → `.ai/history/archive/` (full
records). `.ai/AI_HANDOFF.md` holds current state + remaining gaps only and must
stay small — this environment's file-edit tools stop matching past roughly 55 KB,
so archive superseded sections instead of growing it. Policy: `.ai/history/README.md`.

**No duplicate authority:** the rulebook, handoff, and context docs live only under
`.ai/`. The root `AI_RULES.md` and `AI_Handoff.md` are pointers — never write rules
or handoff state into them.

## Rules for Every Task

1. **Inspect before editing** — verify the file, function, route, table, and schema exist in the current repo. Previous AI memory may be stale; the repo wins.
2. **Minimal correct change** — fix the root cause, preserve existing functionality, reuse existing systems. No duplicate tables, APIs, or components.
3. **Source of truth** — `Neon → Backend API → Frontend`. Frontend never touches Neon or server secrets. No fake data or mock APIs unless explicitly requested.
4. **Database sync** — any schema change must update **both** `db/schema.sql` and `db/run-sqleditor.sql` (see `.ai/context/database.md`). Never recreate `db/run-update.sql`.
5. **Verify** — `git diff --check`, typecheck/build relevant apps, and test the affected flow.
6. **Handoff** — update `.ai/AI_HANDOFF.md` with current state + remaining gaps only (not history). Keep it small.
7. **Auto-commit and push** — when a repository-changing task completes successfully, commit the changes and push to GitHub via Git CLI. Do not stop after editing or committing. See *Default Completion State* below and `.ai/context/workflow.md`.

### Default Completion State

A successful repository-changing task ends with ALL of:

```
implementation complete
+ validation passed (typecheck / tests / diff --check)
+ commit created
+ commit pushed via git push origin <branch>
+ remote verified (local SHA == remote SHA)
+ .ai/AI_HANDOFF.md updated when required
+ working tree clean
```

Do not say "done" until every line is true. If any step fails, report the exact failure and state.

If the user explicitly says *do not commit* / *do not push* / *keep changes local*, skip only those steps and report `NOT PUSHED — USER REQUEST`.

## Quick Reference

- Install: `bun install` · Dev: `bun run dev:velshop` + `bun run api:dev` · Typecheck: `bun run typecheck` · DB bootstrap: run `db/run-sqleditor.sql` once in Neon SQL Editor
- Docs: `INSTALLATION.md` (setup), `VELNOX_DESIGN_THEME.md` (design source of truth), `.ai/README.md` (agent workspace + full context map)
- Repo: `https://github.com/EnJirad/velnox-marketplace.git`

## Repo Conventions

- Default branch: `main`. Feature branches: `fix/…`, `feat/…`; open PRs only when asked.
- Commit style: `fix(velshop): …`, `feat(db): …`, `docs(ai): …`. Always `git diff --check` clean before commit.
- Push: `git push origin <branch>` — Git CLI only. No GitHub REST API / Git Data API fallback.
- If push fails, diagnose the Git error. Do not fabricate alternative push mechanisms.
- Never `git push --force` unless owner-instructed and verified safe.
