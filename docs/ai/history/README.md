# History — Reference Only

Historical files are **reference material**. Only load them when the current task requires historical context.

Three layers, in order of preference:

| Layer | File | Holds |
|---|---|---|
| Current state | `AI_Handoff.md` | what is true now + remaining gaps. Kept small on purpose — the file-edit tools stop matching past roughly 55 KB. |
| Index | `AI_Handoff_Archive.md` | a dated index of completed / superseded work, with line pointers |
| Full records | `docs/ai/history/archive/*.md` | the verbatim long-form narrative |

When a section of `AI_Handoff.md` is superseded, add an index row to
`AI_Handoff_Archive.md` and move any long-form text into `docs/ai/history/archive/`;
never grow the current-state file to hold history.

Do **not** include history in mandatory startup context:

```
AGENTS.md → AI_RULES.md → docs/ai/PROJECT_MAP.md → subsystem doc → source
```

History is the last resort, not the first read.
