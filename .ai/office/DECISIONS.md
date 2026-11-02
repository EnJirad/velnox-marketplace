# Decisions — Velnox Two-Agent Development System

Append-only. Newest at the bottom. Each entry states the decision, the evidence
it rests on, and what would make us revisit it.

---

## D-001 — Delegate with the native `task` tool, not an external orchestrator

**Status:** accepted · 2026-11-02

The platform already provides a nested agent whose final answer returns to the
caller. Building a server, queue or dashboard would duplicate a capability that
exists in-process and would need its own credentials, deploy and failure modes.

**Evidence:** the `task` tool is present with `prompt`, `name`, `title`, `model`,
`background`. A probe subagent ran `git rev-parse` and listed its own tool set,
proving it is a real agent with workspace access, not a text-transform.

**Revisit if:** a round needs to outlive the parent run, or two subagents must
work concurrently on disjoint files.

---

## D-002 — One workspace, never a copy

**Status:** accepted · 2026-11-02

Both agents read and write `velnox-marketplace-81f20048` in place. A second
checkout would create drift, duplicate `node_modules`, and make review meaningless.

**Evidence:** a probe subagent reported `git rev-parse --show-toplevel` =
`/data/data/com.androidharness.app/files/github-projects/velnox-marketplace-81f20048`,
branch `main`, SHA `f8d4b8f` — the same repository the orchestrator saw.

**Revisit if:** a task must be tried without touching the working tree; then use
a git worktree, and say so explicitly in the brief.

---

## D-003 — Foreground delegation only, one writer at a time

**Status:** accepted · 2026-11-02

Subagents inherit the workspace, so two concurrent writers can interleave edits
and produce a state neither reviewed. Foreground calls also return the result
synchronously, which is what the review step needs.

**Evidence:** the `task` schema documents background delegates as read-only; the
settings store contains `background_subagents` and `subagent_full_access`, and a
foreground probe subagent did hold write tools.

**Revisit if:** a future build lets background agents write; even then, serialize
by file ownership.

---

## D-004 — Agent 02 gets its own model through Settings, not per call

**Status:** accepted · 2026-11-02

The user asked for two different models. The supported knob is the single
Sub-Agent model setting, which applies to every subagent.

**Evidence:**
- `settings.preferences_pb` contains `subagent_provider_id` +
  `subagent_model` = `rb/deepseek-v4.1-flash`, and separately
  `planning_provider_id` + `planning_model` = `rb/gpt-6-luna`.
- The main session model is `active_model` = `rb/deepseek-v4.1-flash-1017`, so
  the two roles already differ by model id.
- A probe `task` call passing `model: "definitely-not-a-real-model"` was
  **accepted and ran**, returning normally. An invalid id is therefore not
  validated per call, and the tool documentation states the Sub-Agent setting
  takes precedence — so per-call override is not a reliable mechanism here.

**Consequence:** to change Agent 02's model, change the app setting (manual step,
see `RUNBOOK.md` §4). Do not spend rounds trying `model:` per call.

**Revisit if:** a harness build validates and honours per-call `model`.

---

## D-005 — Loop state lives in files, never in chat context

**Status:** accepted · 2026-11-02

Every subagent invocation starts with no history, and a later round is another
cold start. Chat-only decisions evaporate at the next delegation.

**Evidence:** the round-2 subagent had no memory of round 1 and had to be told to
read `handoffs/smoke-01.md`; with that instruction it edited the file correctly.
The round-3 correction likewise worked from a written finding only.

**Revisit if:** never, for this platform.

---

## D-006 — No scheduled automation for this workflow

**Status:** accepted · 2026-11-02

The user explicitly forbade a timer that edits the project unprompted. The
supported trigger is a normal Code chat.

**Evidence:** `automation.xml` real schema is
`{prompt, providerId, model, checkCommand, schedule, hour, minute, maxAttempts,
enabled}` — one agent, one model, no second-agent field, no round supervisor.
The existing daily health-monitor automation in that file is a single-agent
read-only job, which is the shape automation actually supports.

**Revisit if:** the user explicitly asks for a scheduled two-agent run.

---

## D-007 — Round budget defaults to 5, and review reads the artefact

**Status:** accepted · 2026-11-02

Five rounds bounds token cost and forces the architect to write better briefs.
Review must inspect bytes and exit codes, because a subagent's self-report is a
claim, not evidence.

**Evidence:** in the smoke test the round-1 report happened to be accurate; the
architect still re-derived every criterion from the file (`head -1`, `tail -1`,
`od -c` for the trailing newline, string equality for the exact em dash). Round 3
then caught a genuine defect the subagent had not been asked about — the H1 said
"Round 1" while `ROUND: 2` — which only file inspection revealed.

**Revisit if:** criteria become machine-checkable end to end, in which case the
checks should be scripted rather than re-typed.

---

## D-008 — Untracked files need `git add -N` before they appear in a diff

**Status:** accepted · 2026-11-02

New files created by Agent 02 are untracked, and `git diff` does not show
untracked files. A review that only runs `git diff` will silently see nothing for
a brand-new file.

**Evidence:** the round-2 subagent reported `git status --short` = `?? .ai/office/`
and correctly noted that `git diff` was empty because everything it touched was
untracked.

**Consequence:** the review step must either `git add -N <path>` (intent-to-add,
which does not stage content) or read the file directly. This system's review
template prefers reading the file plus an explicit checklist.

---

## D-009 — Role inversion: AI 01 implements, AI 02 plans and QA-verifies

**Status:** accepted · 2026-11-02 · task `office-audit-001`

v1 assigned architect to the main agent and developer to the subagent. The
owner's required architecture is the inverse: AI 01 (main, implements), AI 02
(subagent, plans and independently verifies). Role files were rewritten;
`architect.md` / `developer.md` filenames kept — they still name their roles,
only the agent-to-slot mapping flipped.

**Evidence:** the QA defect loop ran end to end after the inversion — AI 02
caught a deliberately introduced regression (double-minus money formatting) as
`FAIL` with `file:line`, expected/actual/evidence, then re-verified the fix in
code and returned `PASS` (`reviews/QA-qa-smoke-r1.md`, `QA-qa-smoke-r2.md`).

---

## D-010 — Plan/Execute dual model is a separate platform feature

**Status:** accepted · 2026-11-02

`planning_provider_id` / `execution_provider_id` are distinct settings from
`subagent_provider_id`; all four currently resolve to provider `fb81151c-…`.
Configured values: `cx/gpt-6-astra[1m]` (plan), `af/gpt-oss-120b` (execute).

**Verified:** the settings exist with these values (store inspection 2026-11-02).
**NOT VERIFIED:** which model actually executes plan-mode steps at runtime — no
tool observes this, and task-control records only show `mode: ACT`. Therefore:
Plan/Execute may supplement the workflow, but AI 01's implementation and AI 02's
independent QA remain the authority. A plan-mode draft is input to AI 01, never
a replacement for AI 02's brief or QA PASS.

**Revisit if:** a future build exposes plan/execute session records to inspect.

---

## D-011 — QA vocabulary is PASS / FAIL / BLOCKED / NOT VERIFIED, blind to implementation claims

**Status:** accepted · 2026-11-02

QA reads the artefact and re-runs checks on the current file state. It must
never approve on AI 01's word. When implementation reports lag the actual state,
QA's own evidence wins and the discrepancy becomes a process defect.

**Evidence:** in the round-1 QA test, AI 01's "7 pass, 0 fail" claim described a
pre-regression state while QA saw the post-regression state; AI 02 correctly
ruled `FAIL` on its own output and logged the report inaccuracy as D2 (low).
Lesson recorded in the role docs: implementation reports must state the exact
file state they describe.

---

## D-012 — QA-loop test fixtures are disposable and cleaned up

**Status:** accepted · 2026-11-02

Deliberate defects are introduced only into isolated fixtures, never production
files. After the loop completes, fixtures are deleted; QA reports in
`reviews/` remain the evidence record.

**Evidence:** `.ai/office/tests/qa-smoke/` (money helper + 7-case bun test)
exercised plan → implement → QA FAIL → fix → QA PASS, then was deleted before
commit. No production file was touched: `git status` after cleanup shows only
`.ai/office/` documentation changes, and `bun run typecheck`,
`bun --filter @velnox/backend typecheck`, `bun run i18n:check` all exit 0.

Host note: `bun test .ai/office/tests/qa-smoke/` (directory filter) matches no
test files on bun 1.4.4 here — the `./`-prefixed file-path form is required.
