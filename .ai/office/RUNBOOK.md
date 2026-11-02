# RUNBOOK — how to use the AI Office (two-agent system)

Verified on this device 2026-11-02 (task `office-audit-001`). Where a step needs
the app's UI and this document could not test the label, it says so.

## 1. Verified model configuration

| Role | Model | Slot |
|---|---|---|
| **AI 01** — Main Developer (implements) | `ag/claude-opus-5-5` | `active_model` |
| **AI 02** — Architect · Planner · QA (subagent) | `cx/gpt-6-astra` | `subagent_model` |
| Planning (Plan/Execute feature) | `cx/gpt-6-astra[1m]` | `planning_model` |
| Execution (Plan/Execute feature) | `af/gpt-oss-120b` | `execution_model` |

All four slots use one custom-endpoint provider. AI 01 and AI 02 are different
model ids — the two-model requirement holds. Plan/Execute is a separate feature;
it may supplement but never replaces AI 01's implementation or AI 02's QA
(`DECISIONS.md` D-010).

## 2. One-time settings check

`Settings` → **Sub-Agent**: `subagent_full_access` must be **ON** (AI 02 needs
write access to hand off briefs; it is read-only during QA itself). Background
subagents are read-only — implementation-adjacent work stays foreground.

## 3. Give the system a task

Open a **Code** chat on `velnox-marketplace-81f20048` and just ask in normal
language. AI 01 classifies the request:

| You say | AI 01 does |
|---|---|
| "Fix X", "Build X", "Improve X" | full loop: AI 02 plans → AI 01 implements → AI 02 QA → fix → … → QA PASS → commit + push |
| "Plan X", "Design X" | AI 02 produces a Task Brief; returned to you; **no code written** |
| "Analyze X", "Audit X" | read-only analysis; **no file changes** |

Example kickoff (works verbatim):

```
Use the AI Office two-agent workflow (.ai/office/).

Task: <describe ONE concrete outcome>

You are AI 01, the main developer: delegate planning to AI 02 via the `task`
tool using .ai/office/agents/architect.md, implement the approved brief,
run the checks yourself, then have AI 02 do independent QA and fix every
valid defect until QA PASS (max 5 correction rounds). Commit and push only
after an independent QA PASS and the git safety checks.
```

No manual copying between agents: the `task` call and `.ai/office/` files carry
everything.

## 4. What you will see

1. AI 01 checks git sync, classifies, delegates Phase A (`Architect · <slug>`).
2. AI 02 inspects real files and returns a Task Brief with measurable criteria
   (saved to `handoffs/brief-<slug>.md`).
3. AI 01 implements, runs the brief's commands, reports.
4. AI 01 delegates Phase B QA (`Architect · qa …`); AI 02 re-derives everything
   from bytes and returns PASS / FAIL / BLOCKED / NOT VERIFIED with evidence
   (saved to `reviews/QA-<slug>-rN.md`).
5. On FAIL: numbered defects → AI 01 fixes → QA again (max 5 rounds).
6. On PASS: AI 01 runs git safety, commits, pushes, verifies the remote SHA,
   and gives you the final report with evidence.

## 5. Git safety (enforced every ship)

`fetch` + SHA comparison first (stop on divergence) · QA PASS required · final
diff reviewed · no secrets/`.env` staged · no force push · no production deploy
· no destructive DB ops · remote SHA verified after push.

## 6. Verified workflow test (2026-11-02)

Ran end to end on a disposable fixture (`.ai/office/tests/qa-smoke/`, deleted
afterwards; reports kept in `reviews/`):

- **Delegation + planning** — AI 02 returned a structured Task Brief (QA-SMOKE-01)
  with 6 criteria and real commands; saved to `handoffs/`.
- **Implementation** — AI 01 implemented per brief; `bun test` exit 0, 7/7 pass.
- **Independent QA** — AI 02 found a deliberately introduced regression:
  FAIL, defect D1 (critical) with `money.ts:20`, expected/actual/evidence, plus
  D2 flagging an inaccurate implementation report.
- **Correction loop** — AI 01 fixed D1; QA round 2 re-verified in code: PASS,
  no regressions.
- **Git safety** — fetch/SHA/divergence checks exercised; no push needed for the
  test itself.
- Project-level checks after the loop: typecheck (4 apps) 0, backend typecheck 0,
  i18n parity 0.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| AI 02 says it cannot edit | `subagent_full_access` off | turn it on (§2) |
| `git diff` shows nothing after a round | new files untracked | `git add -N <path>` or read files |
| `bun test .ai/office/tests/...` matches nothing | bun 1.4.4 path filter | use `./` prefix: `bun test ./.ai/office/tests/...` |
| `bun run lint` "passes" | placeholder script | not evidence; lint is unconfigured |
| 8 failing tests in `bun run test` | Android/Termux `process.execPath` = linker | environmental; see daily-health-report — not a code defect |
| Same QA finding repeats | finding too vague | rewrite as expected/actual/required with `file:line` |
| Round 5 exhausted | criteria not observable | stop, rewrite criteria, ask the user |
| Plan/Execute used instead of the loop | plan mode activated in app | its plan is input to AI 01 only; QA still belongs to AI 02 |

## 8. Where things live

```
.ai/context/            existing project docs (source of truth)
.ai/AI_RULES.md         engineering rules · .ai/AI_HANDOFF.md current state

.ai/office/
  PROJECT_CONTEXT.md    shared entry brief
  ARCHITECTURE.md       design + verified capabilities + model table
  DECISIONS.md          D-001…D-012, append-only, with evidence
  RUNBOOK.md            this file
  agents/architect.md   AI 02 role (planner + QA)
  agents/developer.md   AI 01 role (main developer)
  tasks/active/         task records (TEMPLATE.md, <slug>.md)
  handoffs/             briefs (AI 02) + implementation reports (AI 01)
  reviews/              QA reports per round (AI 02)
```
