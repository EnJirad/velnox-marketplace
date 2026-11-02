# Task brief template

One file per task: `.ai/office/tasks/active/<slug>.md`.
Copy this file, rename it, fill every section. Agent 02 receives this file's
contents verbatim, so it must stand alone.

---

## Slug
`<kebab-case-id>` — matches the filename.

## Request
The user's original development request, quoted.

## Context to read first
- `AGENTS.md`
- `.ai/context/<subsystem>.md`
- `<existing source files that already implement something similar>`

## Scope — files allowed to change
- `<path>` — <what changes>
- `<path>` — <what changes>

Nothing else may be modified. Files outside this list are a review finding.

## Out of scope
- <explicitly excluded work, to stop Agent 02 widening the task>

## Acceptance criteria
Numbered and testable. Never "looks good".

1. `<observable behaviour or file state>`
2. `<command that must exit 0>`
3. `<specific string/type/route that must exist>`

## Verification commands
```bash
bun run typecheck
bun --filter @velnox/backend typecheck   # only if backend changed
bun run test                             # only if behaviour changed
bun run i18n:check                       # only if user-facing strings changed
bun run build:<app>                      # only if an app changed
```

## Risks / constraints
- <known hazard, migration, or compatibility concern>

## Round
`1` of max `5`

## Commit policy
`do not commit` (default) | `commit when criteria pass`
