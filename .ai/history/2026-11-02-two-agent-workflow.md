# 2026-11-02 — Two-agent autonomous development workflow (§159)

**Branch:** `main` · **Baseline:** `f8d4b8f` · **Type:** tooling / process

## Request

Design and implement an autonomous two-agent workflow where one AI plans and
reviews while a second AI implements in the same workspace, iterating until the
task is accepted — no manual copying between agents.

## What was inspected (not assumed)

- `task` tool schema: `prompt`, `name`, `title`, `model`, `background`.
- A probe subagent reported the same `git rev-parse --show-toplevel`, branch
  `main` and SHA `f8d4b8f` as the orchestrator → **one shared workspace**.
- The same probe listed its own tools and held `write_file`, `edit_file`,
  `apply_patch`, `multi_edit`, `delete_file` → **subagents can edit**.
- It cannot spawn subagents and cannot ask the user.
- `files/datastore/settings.preferences_pb`: `subagent_provider_id` +
  `subagent_model` = `rb/deepseek-v4.1-flash`, `planning_model` =
  `rb/gpt-6-luna`, `active_model` = `rb/deepseek-v4.1-flash-1017`,
  `permission_mode` = `FULL_ACCESS`, keys `background_subagents`,
  `subagent_full_access`.
- A `task` call passing `model: "definitely-not-a-real-model"` was accepted and
  ran → per-call model override is not validated/honoured; the Sub-Agent
  setting wins.
- `shared_prefs/automation.xml`: real schema is `prompt`/`providerId`/`model`/
  `checkCommand`/`schedule`/`maxAttempts` → automation is **single-agent**; it
  has no second-agent field.
- `shared_prefs/build_test_commands.xml` and `project_checks.xml`: project-scoped
  command shortcuts mirroring the `package.json` scripts.

## What was built

`.ai/office/` — versioned, portable workflow state:

- `PROJECT_CONTEXT.md` — pointer brief (does not duplicate `.ai/context/*`)
- `ARCHITECTURE.md` — workflow design + verified capability table
- `DECISIONS.md` — D-001…D-008 with evidence
- `RUNBOOK.md` — user-facing usage
- `agents/architect.md`, `agents/developer.md` — the two roles
- `tasks/active/` (with `TEMPLATE.md`), `handoffs/`, `reviews/`

Plus a user skill `two-agent-dev` so future Code sessions load the protocol.

## Verification (real rounds, real evidence)

Three rounds executed against the live workspace:

1. **Round 1 — implement.** Agent 02 created `handoffs/smoke-01.md`. All 6
   criteria re-derived by the architect from raw bytes (`head -1`, `tail -1`,
   `tail -c 3 | od -c`, string equality): PASS.
2. **Round 2 — iterate.** Agent 02 edited the existing file in place and created
   `handoffs/smoke-02.md`. All 8 criteria PASS; `git status --short -uall`
   filtered outside `.ai/office/` was empty.
3. **Round 3 — correction.** The architect found a genuine defect the brief had
   not covered: the H1 said "Round 1" while `ROUND: 2`. Numbered finding issued;
   Agent 02 changed exactly one line. Verified: 19 lines unchanged, en dash
   `U+2013` present once, em dash `U+2014` once, `smoke-02.md` untouched.

Full record: `.ai/office/reviews/REVIEW-smoke-001.md`.

## Conclusion

The loop works: plan → delegate (foreground) → implement → independent review →
numbered correction → re-verify. No server, database or dashboard was needed.

## Known limitations (v3.1)

- One `subagent_model` for all subagents; per-call `model:` inert.
- Background delegates are read-only → implementation must be foreground.
- Subagents cannot recurse or ask questions, so briefs must be self-contained.
- Untracked files are invisible to `git diff` → use `git add -N` or read files.
- Automation cannot supervise a two-agent review loop (single-agent schema).

## Not done deliberately

- No scheduled/automation task was created; the user forbade timer-driven edits.
- `.ai/AI_HANDOFF.md` was not updated: it is 105 KB, above the ~55 KB edit
  ceiling stated in `AGENTS.md`. Archiving is a separate approved task.
