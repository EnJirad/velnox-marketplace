# `reviews/` — QA reports written by AI 02

One file per QA round: `QA-<slug>-rN.md`. AI 02 writes these **after**
independently verifying the artefact — never from AI 01's claims.

## Outcome vocabulary

| Outcome | Meaning |
|---|---|
| `PASS` | all applicable acceptance criteria verified with AI 02's own command output on the current file state |
| `FAIL` | specific defects or missing requirements — numbered, with evidence |
| `BLOCKED` | verification impossible: missing access, infrastructure or resources |
| `NOT VERIFIED` | insufficient evidence — never counts as PASS |

## Report shape

`QA REPORT <slug> — ROUND <n>` · OUTCOME · per-criterion evidence · numbered
defects (`file:line`, expected / actual / evidence, severity) · regressions ·
blockers · not-verified items.

## Rules

1. Evidence or it did not happen — every PASS names the command that proved it.
2. Re-run previously passing checks after later modifications.
3. Read the file, not the diff alone — untracked new files are invisible to
   `git diff` (`DECISIONS.md` D-008).
4. AI 02 is read-only with respect to source during QA; the only write is this
   report.
5. Never approve on AI 01's word. A discrepancy between AI 01's report and the
   observed state is itself a (low-severity) process defect.

Historical note: v1 of this folder held review verdicts written by the main
agent, when the roles were inverted (`DECISIONS.md` D-009).
