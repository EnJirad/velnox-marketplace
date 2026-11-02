# `handoffs/` — what Agent 02 produced

Agent 02 writes here (or reports here) at the end of every round. A handoff is a
claim; the architect verifies it and records the verdict in `../reviews/`.

## Required content

- `STATUS:` done | partial | blocked
- `ROUND:` the round it answers
- `SHA:` `git rev-parse --short HEAD` at the time of writing
- `## Commands Run` — the real command and its real exit code
- `## Risks` — what could still break
- last line exactly `STATUS: implemented` for completed work

## Rules

- Never write a command you did not run.
- Never claim a check you skipped; say `not run`.
- Stay inside the brief's file list.

## Known gotcha

New files are untracked, so `git diff` shows nothing for them. Reviewers must use
`git status --short`, read the file, or `git add --intent-to-add <path>`.
