# Architecture — Velnox Two-Agent Development System

Designed against **Android Harness v3.1 capabilities as verified on this device**,
not against assumptions. Every platform claim below was checked; the evidence is
recorded in `DECISIONS.md`.

## 1. Shape

No server. No database. No dashboard. One workspace, one orchestrator, one
coding subagent, and a small folder of files that survives between rounds.

```
                    ┌──────────────────────────────────────────┐
  user request ───► │ AGENT 01  Architect · Planner · QA        │
                    │ main Code session (main model)           │
                    │ tools: read, git, shell, browser, task   │
                    └───────┬──────────────────────▲───────────┘
                            │                      │
              task (foreground)                    │ final answer
                            ▼                      │
                    ┌──────────────────────────────┴───────────┐
                    │ AGENT 02  Senior Developer               │
                    │ nested subagent (subagent_model)         │
                    │ tools: write/edit/patch + shell + git    │
                    └───────┬──────────────────────────────────┘
                            │ writes
                            ▼
                 ┌────────────────────────────────┐
                 │ ONE shared workspace            │
                 │ velnox-marketplace-81f20048     │
                 └────────────────────────────────┘
```

`task` is the only channel. It is synchronous: the subagent's final answer is the
return value of the call, so the loop is a plain sequence inside one Code run —
no polling, no queue, no server.

## 2. Why this and not something else

| Option | Verdict |
|---|---|
| `task` tool (nested agent) | **chosen** — built in, shares workspace, returns an answer to the caller |
| Two Code chats side by side | rejected — no return channel, user becomes the message bus |
| Robot/Automation task | rejected for orchestration — see §6 |
| External server / queue | rejected — the platform already does this in-process |

## 3. State lives in files, not in context

A subagent starts with **zero** conversation history, and a later round starts
fresh again. Anything the loop needs must exist on disk:

| Path | Owner | Purpose |
|---|---|---|
| `tasks/active/<slug>.md` | Agent 01 | the brief; the only thing Agent 02 must obey |
| `tasks/active/<slug>-rN.md` | Agent 01 | per-round brief when a round needs its own criteria |
| `handoffs/smoke-*`, `handoffs/<slug>.md` | Agent 02 | what it did, what it ran, what is open |
| `reviews/<slug>.md` | Agent 01 | independent verdict with evidence and findings |
| `DECISIONS.md` | Agent 01 | durable decisions + platform facts |
| `PROJECT_CONTEXT.md` | shared | pointer brief; never duplicates `.ai/context/*` |
| `agents/architect.md` | Agent 01 | orchestrator role |
| `agents/developer.md` | Agent 02 | developer role, prepended to every task |

Rule of thumb: **if the next round would need it, write it down.** A finding that
only exists in chat is lost at the next delegation.

## 4. Concurrency rule — one writer

- Delegation is **foreground** (`background: false`). Background subagents are
  read-only in this build, and a background writer would race the orchestrator.
- While a round is open, Agent 01 does not edit source. It may write review and
  decision records (different files, no conflict).
- One `task` call at a time. Never fan out parallel writers into one workspace.

## 5. The loop, with the stopping rule

```
round = 1
while round <= MAX_ROUNDS (default 5):
    delegate brief (or correction findings)
    review artefact against numbered criteria   ← never the self-report
    if all criteria pass: break
    if blocker needing a human: stop and ask
    round += 1
else:
    stop, report "budget exhausted" with the open findings
```

Acceptance criteria must be **observable**: a file state, an exit code, a string
that must exist, a route that must respond. "Looks good" is not a criterion.

## 6. Platform capabilities, verified

Verified on this device (v3.1 unless noted):

| Capability | Status | Detail |
|---|---|---|
| Nested agent via `task` | **available** | returns final answer to the parent |
| Subagent may **edit files** | **available** | a probe subagent listed `write_file`, `edit_file`, `apply_patch`, `multi_edit`, `delete_file` |
| Subagent may run shell/git/browser/MCP | **available** | full tool set observed |
| Subagent recursion | **not available** | subagents cannot spawn subagents |
| Subagent ↔ user | **not available** | a subagent cannot ask a question |
| Shared workspace | **confirmed** | probe returned the same `git rev-parse --show-toplevel`, branch and SHA |
| Per-call `model` override | **not effective** | accepted without error but the Sub-Agent settings model takes precedence |
| Dedicated subagent model setting | **available** | `subagent_provider_id` + `subagent_model` (single pair, applies to *all* subagents) |
| Planning model setting | **available** | `planning_provider_id` + `planning_model`, separate from subagent |
| Background subagents | **read-only** | `background_subagents` setting; background delegates explore only |
| Automation (scheduled) | **available** | single-agent scheduled run with `checkCommand` + `maxAttempts` |
| Checkpoints | **partial** | per-file `file_history` / `file_restore`; git is the real checkpoint |
| Build/Test shortcuts | **available** | project-scoped command list, mirrors `package.json` scripts |

## 7. Model assignment

- **Agent 01** = the main session model (`active_model`). It does planning and
  judgement; that is where model quality pays.
- **Agent 02** = `subagent_model`. It does focused implementation against a
  written brief, which tolerates a cheaper/faster model.
- They are **already different** on this device (`rb/deepseek-v4.1-flash-1017`
  vs `rb/deepseek-v4.1-flash`), but same family. To get a genuinely independent
  second model, change **Settings → Sub-Agent model** (see `RUNBOOK.md`).
- There is **one** subagent model for all subagents. Round-by-round model
  switching per call is not supported in v3.1.

## 8. Automation — what it can and cannot do

`automation.xml` shows the real task schema: `prompt`, `providerId`, `model`,
`checkCommand`, `schedule`, `hour`, `minute`, `maxAttempts`, `enabled`.

- It runs **one** agent with **one** model. It has no field for a second agent,
  no round counter, and no notion of a reviewer.
- A scheduled run *could* carry a prompt that instructs the agent to use `task`,
  so a single scheduled run can execute one full two-agent cycle. It cannot
  supervise repeated rounds beyond its own `maxAttempts` retry logic.
- **Not configured here, deliberately.** A scheduled job that edits the project
  on a timer is exactly what the user forbade without an explicit request. The
  supported entry point is a normal Code chat (see `RUNBOOK.md`).

## 9. Failure modes and their tells

| Symptom | Cause | Fix |
|---|---|---|
| Subagent returns "I don't have that context" | brief was not self-contained | put the plan in the brief file, not in chat |
| Subagent edited files outside the list | scope not explicit | name the allowed paths; treat violations as blocking |
| `git diff` empty after a round | new files are **untracked**; `diff` ignores them | `git add -N <path>` or read the file directly |
| Same finding repeats every round | finding was vague | number it, quote the line, state the required outcome |
| Round 5 still failing | criteria were not observable | rewrite criteria, then restart the loop |
| Two writers conflict | background/parallel delegation used | serialize; foreground only |
