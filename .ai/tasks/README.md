# Tasks

Task briefs are how work is assigned to an agent session. They exist so a session reads one short file instead of guessing scope from a long prompt.

## Layout

```
tasks/
├── TEMPLATE.md     the required brief format
├── active/         assigned work — read the brief for the task you were given
└── completed/      finished task reports — NEVER auto-loaded
```

## Rules

- **One file per task**, kebab-case, in `active/` while in progress.
- A brief must define all seven fields (objective, allowed scope, relevant context, relevant source, verification, stop conditions, expected output). If any is missing, stop and clarify before making broad changes.
- Move the file to `completed/` when the work is verified and committed. Completed reports are evidence, not context — do not load them unless asked for history.
- Pre-existing historical work (before this workspace existed) is in `.ai/history/` (moved from `docs/ai/history/`).
- Never load an unrelated brief. Read only the brief for the task you were assigned.

## Active Tasks

None currently assigned. When a task is assigned, its brief appears in `active/` and is named here.
