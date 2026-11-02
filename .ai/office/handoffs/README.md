# `handoffs/` — cross-agent records

Two kinds of file, written by different agents:

| File | Author | Content |
|---|---|---|
| `brief-<slug>.md` | AI 02 | Task Brief from Phase A planning (REQUEST / AFFECTED FILES / APPROACH / STEPS / ACCEPTANCE CRITERIA / TEST CASES / RISKS / SCOPE LIMITS) |
| `impl-<slug>.md` | AI 01 | implementation report: files changed, commands run with real exit codes, deviations from the brief, and **the exact file state the report describes** |

## Rules

- A handoff is a claim. The receiving agent verifies it against the real
  workspace before acting on it.
- Never write a command you did not run; never claim a skipped check.
- Implementation reports must state the exact file state they describe — a
  report describing an earlier state reads as false evidence to QA
  (`DECISIONS.md` D-011).
- New files are untracked, so `git diff` shows nothing for them; use
  `git status --short --untracked-files=all` and read files directly.

Historical note: `smoke-01.md` / `smoke-02.md` are v1 smoke-test records from
before the role inversion and are kept as history.
