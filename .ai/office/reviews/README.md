# `reviews/` — verdicts written by Agent 01

One file per task: `REVIEW-<slug>.md`. Written **after** inspecting the artefact,
never from the subagent's report.

## Template

```
# Review — <slug>

Round: <n>   Commit/baseline: <short sha>   Verdict: ACCEPTED | CHANGES REQUIRED

## Criteria

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | <criterion> | PASS | <command + output> |

## Findings

1. (blocking|minor) path/to/file:N — expected / actual / required

## Checks run

<command> → exit <code> (<observed>)

## Notes for the next round
```

## Rules

1. **Evidence or it did not happen.** Every PASS names the command that proved it.
2. **Read the file, not the diff alone.** Untracked new files are invisible to
   `git diff` (`DECISIONS.md` D-008).
3. **Re-run the verification yourself.** A subagent's exit codes are not yours.
4. **Findings are numbered and actionable.** "Improve the code" is not a finding.
5. **State the verdict explicitly** — ACCEPTED or CHANGES REQUIRED. Ambiguity
   burns a round.
