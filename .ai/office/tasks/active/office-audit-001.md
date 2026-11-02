# Office Audit 001 — AI Office full system audit & upgrade

## Task ID
`office-audit-001`

## Original request
Audit, repair and upgrade the AI Office into a coordinated two-agent team:
AI 01 (main, `ag/claude-opus-5-5`) = main developer/implementer;
AI 02 (subagent, `cx/gpt-6-astra`) = architect, planner, independent QA.
Planning-only requests stay planning-only. Correction budget 5. Push only after
independent QA PASS + git safety conditions.

## Phase 1 audit findings (evidence)

### Model configuration (source: `files/datastore/settings.preferences_pb`)

| Slot | Setting key | Verified value | Matches user report |
|---|---|---|---|
| Main (AI 01) | `active_model` | `ag/claude-opus-5-5` | yes |
| Planning | `planning_model` | `cx/gpt-6-astra[1m]` | yes |
| Sub-agent (AI 02) | `subagent_model` | `cx/gpt-6-astra` | yes |
| Execution | `execution_model` | `af/gpt-oss-120b` | yes |

Provider ids: `fb81151c-cc54-4a6c-9d87-7380a2e81a37` appears exactly 4 times —
once for each slot (`active_`, `planning_`, `subagent_`, `execution_`).
Conclusion: one custom-endpoint provider, four model ids. No credential touched.
Historical note: an earlier session recorded `rb/deepseek-v4.1-flash-1017` /
`rb/gpt-6-luna`; the user reconfigured since. History preserved, not rewritten.

### Plan/Execute feature
`planning_provider_id` + `execution_provider_id` are **separate settings** from
`subagent_provider_id`, so dual Plan/Execute is a distinct feature from
subagent delegation. Semantics NOT VERIFIED at runtime: no tool exists to
observe which model executes plan-mode steps, and task-control files only show
`mode: ACT, thinking: OFF`. Documented as configured-but-unverified.

### Prior attempt
`task-controls/c4bfb0dc….json`: this same audit prompt previously ran on
fallback model `rb/glm-5.3-flash`, `completed: false` (provider unreachable).
This run is the retry on the main model.

### Tool access
Main (AI 01): full set verified live — file read/write/edit, shell, git,
tests/build via bun, browser, MCP servers, `task` delegation.
AI 02 (subagent): probed earlier this session — same workspace (identical
`git rev-parse --show-toplevel`), full write/edit tools, shell, browser, MCP;
cannot recurse, cannot ask the user. `permission_mode` = `FULL_ACCESS`,
`subagent_full_access` enabled.

### Git state
`main` @ `db6c146`, in sync with `origin/main` (0/0), working tree clean.

### Gap found (the core defect)
Existing `.ai/office/agents/` assigns **architect = Agent 01 (main)** and
**developer = Agent 02 (subagent)** — inverted from the required architecture.
Skill `two-agent-dev` bakes the same inversion. QA outcomes PASS/FAIL/BLOCKED/
NOT_VERIFIED and the correction-record schema are absent. These must be
rewritten (file names `architect.md` / `developer.md` still match their roles;
only the agent-to-slot mapping flips).

## Implementation plan

1. Rewrite `agents/architect.md` = AI 02 subagent role (Phase A plan, Phase B
   QA, outcome vocabulary, never approve on AI 01's word).
2. Rewrite `agents/developer.md` = AI 01 main role (implement, run checks,
   fix QA findings, git safety, no silent ignoring of findings).
3. Update `ARCHITECTURE.md` (inverted diagram, verified model table, Plan/
   Execute section, QA protocol), `DECISIONS.md` (append-only D-009…D-012),
   `RUNBOOK.md` (new kickoff template), `PROJECT_CONTEXT.md`, and the
   `tasks/`, `reviews/`, `handoffs/` READMEs (QA outcome vocabulary, record
   fields).
4. Update skill `two-agent-dev` to the inverted protocol.
5. Phase 4 tests (disposable fixture under `.ai/office/tests/qa-smoke/`):
   B delegation+planning, C implementation, D QA defect loop (deliberate defect
   → FAIL → fix → PASS), E git safety, F doc consistency. Fixture deleted after.
6. Commit and push only after every check passes.

## Acceptance criteria

1. No stale model ids in current-configuration sections of `.ai/office/`.
2. Role docs match runtime slots (AI 01 implementer / AI 02 planner+QA).
3. AI 02 returns a structured Task Brief with measurable criteria.
4. AI 01 implements it and relevant tests actually run.
5. AI 02 QA catches the deliberately introduced defect and returns FAIL with
   evidence; after correction it returns PASS.
6. Git safety checks pass; push SHA verified equal on remote.
7. Fixture cleaned up; no production file touched by the test.
