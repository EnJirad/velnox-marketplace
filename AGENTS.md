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

## Quick Reference

- Install: `bun install` · Dev: `bun run dev:velshop` + `bun run api:dev` · Typecheck: `bun run typecheck` · DB bootstrap: run `db/run-sqleditor.sql` once in Neon SQL Editor
- Docs: `INSTALLATION.md` (setup), `VELNOX_DESIGN_THEME.md` (design source of truth), `docs/ai/README.md` (full context map)
- Repo: `https://github.com/EnJirad/velnox-marketplace.git`

## Repo Conventions

- Feature branches: `fix/…`, `feat/…`; open PRs only when asked.
- Commits: conventional-ish (`fix(velshop): …`, `feat(db): …`). `git diff --check` clean before commit.

## Version-Control Workflow (Freebuff/Vly environments)

When `git push/pull` is blocked by the hosting platform, push via GitHub REST API (Git Data API) using the ambient token — never hardcode or echo tokens. On stale checkouts, push to feature branches only. See `docs/ai/WORKFLOW.md` for the recipe.
