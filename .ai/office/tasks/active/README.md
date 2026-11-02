# `tasks/active/` — task records written by AI 01

One file per task: `<slug>.md`. It is the durable record of the whole loop —
the thing that survives between delegation rounds and lets any reader audit what
happened.

## Required fields (per task)

1. **Task ID** — unique slug, matches the filename.
2. **Original user request** — quoted.
3. **Task Brief** — reference to `../handoffs/brief-<slug>.md` (AI 02's output).
4. **Implementation status** — current round, what AI 01 has done.
5. **Modified file list** — actual paths, kept current.
6. **Test results** — real commands and exit codes.
7. **QA report** — reference to `../reviews/QA-<slug>-rN.md`, outcome per round.
8. **Correction round number** — current round of max 5.
9. **Final acceptance status** — one of: `ACCEPTED (QA PASS)` · `OPEN` ·
   `BLOCKED` · `BUDGET EXHAUSTED`.

## Rules

- Update the record at every state change; do not batch updates to the end.
- Move to `tasks/done/` only after final acceptance status is `ACCEPTED`.
- `TEMPLATE.md` is a copy source, never edited as a task.

Historical note: v1 briefs (`smoke-001-*.md`) were written for the pre-inversion
protocol where the main agent planned; kept as history.
