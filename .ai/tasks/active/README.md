# Active Tasks

Current MVP rewrite records:

| Phase | File | Status |
|---|---|---|
| 0 — audit | `mvp-clean-rewrite-phase0-audit-2026-10-21.md` | complete; owner decisions recorded in Phase 2 |
| 1 — clean foundation | `mvp-clean-rewrite-phase1-2026-10-21.md` | complete |
| 2 — clean MVP database | `mvp-clean-rewrite-phase2-2026-10-21.md` | complete; cutover designed, not executed |
| 3 — core backend rewrite | not started | blocked until Phase 2 is reviewed |

Do not start Phase 3 from these records. The current database contract is
`db/mvp/schema.sql`; the pre-MVP pair is frozen (`db/README.md`).

When new work is assigned, the brief is written here from `../TEMPLATE.md` and
the agent session reads:

1. `.ai/AI_RULES.md`
2. `.ai/AI_HANDOFF.md`
3. the brief in this directory
4. only the context files the brief lists
5. the actual source files the brief lists

Do not invent a task from `AI_HANDOFF.md` remaining-gaps notes — those are notes, not assigned work.
