# Architecture — Velnox AI Office (two-agent development system)

Designed against **verified v3.1 runtime capabilities on this device**. Every
platform claim was checked; evidence lives in `DECISIONS.md`. Audited and
reconfigured 2026-11-02 (task `office-audit-001`).

## 1. Shape — role-inverted from v1

AI 01 (main) implements. AI 02 (subagent) plans and QA-verifies.

```
  user request ───► │ AI 01 · MAIN DEVELOPER                    │
                    │ main Code session · ag/claude-opus-5-5     │
                    │ classifies → delegates → implements        │
                    │ → verifies → fixes → ships (git)           │
                    └───────┬──────────────────────▲────────────┘
              task (Phase A: plan) │                     │ Task Brief / QA Report
                            ▼      │                     │
                    ┌──────────────┴─────────────────────┴─────┐
                    │ AI 02 · ARCHITECT · PLANNER · QA          │
                    │ nested subagent · cx/gpt-6-astra          │
                    │ Phase A: analyse, brief, criteria         │
                    │ Phase B: independent QA (read-only)       │
                    └───────┬───────────────────────────────────┘
                            ▼
                 ONE shared workspace (velnox-marketplace)
```

Planning-only requests stop after Phase A: the brief goes to the user, no code
is written. Analysis-only requests are read-only end to end.

## 2. Verified model configuration (2026-11-02)

| Slot | Setting key | Value | Provider |
|---|---|---|---|
| AI 01 main | `active_model` | `ag/claude-opus-5-5` | `fb81151c-…` |
| Planning | `planning_model` | `cx/gpt-6-astra[1m]` | `fb81151c-…` |
| AI 02 subagent | `subagent_model` | `cx/gpt-6-astra` | `fb81151c-…` |
| Execution | `execution_model` | `af/gpt-oss-120b` | `fb81151c-…` |

One custom-endpoint provider (`fb81151c-cc54-4a6c-9d87-7380a2e81a37`) serves all
four slots. Historical values (`rb/deepseek-v4.1-flash-1017`, `rb/gpt-6-luna`)
were current before this audit — see `DECISIONS.md` D-004, history preserved.

### Plan/Execute feature

`planning_provider_id` + `execution_provider_id` are **separate settings** from
`subagent_provider_id`: dual Plan/Execute is a distinct platform feature, not
subagent delegation. Configured with `cx/gpt-6-astra[1m]` (plan) and
`af/gpt-oss-120b` (execute). **Runtime semantics NOT VERIFIED**: no tool exists
to observe which model executes plan-mode steps, and task-control records show
only `mode: ACT`. Integration rule regardless: dual planning may supplement, but
AI 01 implements and AI 02 verifies — Plan/Execute must not silently replace
either role. If the app's plan mode is used, its plan is input to AI 01, never a
substitute for AI 02's brief or QA.

## 3. State lives in files

| Path | Owner | Purpose |
|---|---|---|
| `tasks/active/<slug>.md` | AI 01 | task record: request, brief ref, status, files, tests, QA outcome, round, final status |
| `handoffs/brief-*.md` | AI 02 | Task Briefs (Phase A output) |
| `handoffs/impl-*.md` | AI 01 | implementation reports (optional but recommended) |
| `reviews/QA-*-rN.md` | AI 02 | QA reports per round |
| `DECISIONS.md` | AI 01 | durable decisions, append-only |
| `PROJECT_CONTEXT.md` | shared | pointer brief into the real docs |

## 4. Concurrency rule

Foreground delegation only, one `task` call at a time, one writer. During Phase
B QA, AI 02 is read-only with respect to source. During implementation, AI 01
edits; AI 02 may write only its own brief/records.

## 5. QA protocol

Outcomes: `PASS` / `FAIL` / `BLOCKED` / `NOT VERIFIED`.

- QA verifies the **artefact**, never AI 01's claims; every criterion needs
  command output on the current file state.
- Defects are numbered with severity, `file:line`, expected/actual/evidence.
- Previously passing checks are re-run after later modifications.
- AI 02 never edits source during QA; never approves on AI 01's word.
- Correction loop: AI 01 fixes every valid defect → QA again. Budget **5**
  rounds; on exhaustion stop, preserve work, report, ask the user.

## 6. Platform capabilities, verified

| Capability | Status | Detail |
|---|---|---|
| Nested agent via `task` | **available** | returns final answer to the caller |
| Subagent may edit files | **available** | full write/edit/patch tool set (probe) |
| Subagent recursion / user questions | **not available** | briefs must be self-contained |
| Shared workspace | **confirmed** | identical `git rev-parse --show-toplevel` |
| Per-call `model` override | **not effective** | Sub-Agent setting wins (probe: invalid id accepted and ran) |
| One subagent model for all subagents | **confirmed** | single `subagent_model` setting |
| Plan/Execute dual model | **configured** | separate settings; runtime semantics unverified |
| Background subagents | **read-only** | implementation must be foreground |
| Automation (scheduled) | **available** | single-agent schema only; not used for this workflow |
| Checkpoints | **partial** | per-file `file_history`; git is the real checkpoint |
| Build/Test shortcuts | **available** | project-scoped, mirror `package.json` scripts |

## 7. Host quirks that bite

- `bun test <path>` needs a `./` prefix on this host (bun 1.4.4): use
  `bun test ./.ai/office/tests/qa-smoke/money.test.ts`, not a directory filter.
- New files are untracked → invisible to `git diff`; use `git add -N` or read.
- `bun run lint` / `format` are placeholders that prove nothing.
- On Android/Termux, `process.execPath` is the linker; the
  `test-database-isolation` end-to-end probes fail for that reason alone
  (8 known environmental failures in `bun run test`; root cause in
  `.ai/automation-reports/daily-health-report.md`).
