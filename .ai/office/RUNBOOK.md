# RUNBOOK — how to actually use the two-agent system

Everything here was verified on this device. Where a step needs the app's UI and
this document could not test the label, it says so instead of inventing one.

---

## 1. Before the first task (one-time, ~2 minutes)

### 1a. Confirm the subagent can write

`Settings` → search for **Sub-Agent**. The setting that matters stores
`subagent_full_access` ("subagent may use action tools"). It must be **ON**,
otherwise Agent 02 is read-only and cannot implement anything.

*If the label differs in your build, look for the Sub-Agent section; the stored
key is `subagent_full_access`.*

### 1b. Optional — give Agent 02 a genuinely different model

Currently:

| Role | Model (verified from settings) |
|---|---|
| Agent 01 (main session) | `rb/deepseek-v4.1-flash-1017` |
| Agent 02 (subagent) | `rb/deepseek-v4.1-flash` |

Same family. For an independent second opinion, set **Sub-Agent model** to
`rb/claude-haiku-5-5` or `rb/glm-5.3-flash` (both are in your favourites list).

**Manual step — this cannot be done by the agent.** There is no tool that writes
app settings, and editing `settings.preferences_pb` directly would risk corrupting
app state. Do it in the app UI.

Note: there is **one** subagent model for all subagents. Per-call model override
(`task`'s `model:` argument) is accepted but not honoured in v3.1 —
`DECISIONS.md` D-004.

### 1c. Background subagents stay off for implementation

Background delegates are read-only. Implementation rounds must be foreground.
Nothing to configure — just do not ask for a background round that needs to write.

---

## 2. Give the system its first task

Open a **Code** chat on the `velnox-marketplace-81f20048` workspace and send:

```
Use the two-agent development workflow in .ai/office/.

Act as Agent 01 (read .ai/office/agents/architect.md).
Task: <describe ONE concrete change, e.g. "the cart drawer total does not
update when quantity changes on mobile">

Round budget: 5.

Start with the git sync check, write the brief into
.ai/office/tasks/active/<slug>.md, then delegate to Agent 02 with the `task`
tool using .ai/office/agents/developer.md plus the brief.
Review the real files and re-run the checks yourself before accepting.
Do not commit until every criterion passes.
```

Nothing else is needed. You do **not** copy files or re-paste prompts between
agents — the `task` call and the files in `.ai/office/` carry everything.

---

## 3. What you will see

1. Agent 01 reads `AGENTS.md`, the subsystem doc and the real source files.
2. It writes `tasks/active/<slug>.md` — scope, numbered criteria, real commands.
3. A subagent chip appears for Agent 02 (`Dev · <slug>`); it edits in the same
   workspace.
4. Agent 02's final answer returns into the run — you see its report.
5. Agent 01 re-reads the diff, re-runs `typecheck` / `test` / build, and writes
   `reviews/REVIEW-<slug>.md`.
6. If anything fails, another round starts with numbered findings.
7. You get a final report with files changed, real command output and the SHA.

You can watch progress but should not need to intervene.

---

## 4. Tuning

| Knob | Where | Default |
|---|---|---|
| Round budget | in your kickoff message | `5` |
| Commit when done | say so in the request | **do not commit** |
| Model for Agent 02 | Settings → Sub-Agent model | `rb/deepseek-v4.1-flash` |
| Round-by-round briefs | `tasks/active/<slug>-rN.md` | only when a round needs its own criteria |

To make the system commit and push after a passing review, add to your request:
`commit and push when all criteria pass`. Otherwise work stays uncommitted.

---

## 5. Safety boundaries the system follows

- `git fetch` + SHA comparison before touching anything; **STOP** on divergence.
- Uncommitted user work is preserved; no `checkout --`, no `reset --hard`.
- No force push. No production deploy. No DB deletion.
- `TEST_DATABASE_URL` only; `DATABASE_URL` is production and the guard refuses it.
- No package installs or config changes unless you ask.
- Stops and asks you when: requirements are ambiguous, a destructive step is
  needed, credentials are required, or the round budget runs out.
- No scheduled/automation run is created for this workflow (`DECISIONS.md` D-006).

---

## 6. Use a real task, not the smoke test, to judge it

The smoke test proved the channel, not the quality bar. For the first real task
pick something small and observable — a single component behaviour, a single
route, a single query — so the review criteria are unambiguous.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Subagent says it cannot edit | `subagent_full_access` off | turn it on (§1a) |
| `git diff` shows nothing after a round | new files are untracked | `git add -N <path>` or read files |
| Same finding three rounds running | finding too vague | rewrite as expected / actual / required |
| Subagent went out of scope | file list missing from brief | list allowed paths explicitly |
| Two models look identical in output | only one subagent model exists | set Sub-Agent model (§1b) |
| Round 5 exhausted | criteria were not observable | rewrite criteria and restart |
| Health-monitor report appears daily | that is the separate automation, not this workflow | unrelated — see `.ai/automation` / app Automation tab |

## 8. Where things live

```
.ai/context/            ← existing project docs (source of truth)
.ai/AI_RULES.md         ← engineering rules
.ai/AI_HANDOFF.md       ← current project state

.ai/office/
  PROJECT_CONTEXT.md    ← shared entry brief
  ARCHITECTURE.md       ← this workflow's design + verified capabilities
  DECISIONS.md          ← D-001…D-008 with evidence
  RUNBOOK.md            ← this file
  agents/architect.md   ← Agent 01 role
  agents/developer.md   ← Agent 02 role
  tasks/active/         ← briefs (TEMPLATE.md, <slug>.md, <slug>-rN.md)
  handoffs/             ← Agent 02 outputs
  reviews/              ← Agent 01 verdicts
```
