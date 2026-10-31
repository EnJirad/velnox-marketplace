# History — Reference Only

Every work session writes one dated entry here (`YYYY-MM-DD-<topic>.md`), including sessions that
changed nothing, failed, or were blocked — see `.ai/AI_RULES.md` §19. Entries are never deleted or
rewritten to tidy the folder; superseded state is summarised in `.ai/AI_HANDOFF.md`.

Historical files are **reference material**. Only load them when the current task requires historical context.

Three layers, in order of preference:

| Layer | File | Holds |
|---|---|---|
| Current state | `.ai/AI_HANDOFF.md` | what is true now + remaining gaps. Kept small on purpose — the file-edit tools stop matching past roughly 55 KB. |
| Index | `.ai/history/AI_Handoff_Archive.md` | a dated index of completed / superseded work, with line pointers |
| Full records | `.ai/history/archive/*.md` | the verbatim long-form narrative |

When a section of `.ai/AI_HANDOFF.md` is superseded, add an index row to
`.ai/history/AI_Handoff_Archive.md` and move any long-form text into
`.ai/history/archive/`; never grow the current-state file to hold history.

Do **not** include history in mandatory startup context:

```
AGENTS.md → .ai/AI_RULES.md → .ai/context/project-map.md → subsystem doc → source
```

History is the last resort, not the first read.

> Moved here from `docs/ai/history/` when the agent workspace moved to `.ai/` (2026-09-23).
