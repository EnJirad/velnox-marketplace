# `tasks/active/` — briefs written by Agent 01

One file per task. The file is handed to Agent 02 **verbatim**, so it must stand
alone: no "as we discussed", no pronouns pointing at chat.

## Naming

| File | Meaning |
|---|---|
| `TEMPLATE.md` | copy this; never edit it as a task |
| `<slug>.md` | the main brief |
| `<slug>-rN.md` | optional brief for round `N` when that round needs its own criteria |

Move a brief to `tasks/done/` only after the review record shows every criterion
met.

## Non-negotiables in a brief

1. **Scope — files allowed to change.** An explicit list. Everything else is a
   review finding.
2. **Acceptance criteria, numbered and observable.** A file state, an exit code,
   a string that must exist. Not "looks good".
3. **Verification commands.** Copy the real ones from `PROJECT_CONTEXT.md`.
   Never invent a command.
4. **Commit policy.** Default `do not commit` — the architect decides when.
5. **Round number** and the round budget.

## Correction rounds

A correction does not need a new brief file. Call `task` with the finding list
inline, in this shape:

```
FINDING 1 (blocking) — path/to/file.ext:LINE
  Expected: <the required state>
  Actual:   <what is there now>
  Required: <the exact change>
```

Number the findings, quote the line, state the outcome. Vague feedback is the
architect's defect.
