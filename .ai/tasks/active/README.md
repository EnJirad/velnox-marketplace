# Active Tasks

Current MVP rewrite records:

| Phase | File | Status |
|---|---|---|
| 0 — audit | `mvp-clean-rewrite-phase0-audit-2026-10-21.md` | complete; owner decisions recorded in Phase 2 |
| 1 — clean foundation | `mvp-clean-rewrite-phase1-2026-10-21.md` | complete |
| 2 — clean MVP database | `mvp-clean-rewrite-phase2-2026-10-21.md` | complete; cutover designed, not executed |
| 3 — core backend rewrite | complete (3, 3b, 3c, 3d — `AI_HANDOFF.md` §86–§89) |

These are dated records, not the current contract. The database contract is
`db/schema.sql` + `db/run-sqleditor.sql`, and the 2026-10-22 reset
(`AI_HANDOFF.md` §92) removed every `db/mvp/*` path these files name.

When new work is assigned, the brief is written here from `../TEMPLATE.md` and
the agent session reads:

1. `.ai/AI_RULES.md`
2. `.ai/AI_HANDOFF.md`
3. the brief in this directory
4. only the context files the brief lists
5. the actual source files the brief lists

Do not invent a task from `AI_HANDOFF.md` remaining-gaps notes — those are notes, not assigned work.
