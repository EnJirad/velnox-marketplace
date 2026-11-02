# 2026-11-02 — AI Office audit & role reconfiguration (§160)

**Branch:** `main` · **Baseline:** `db6c146` · **Type:** AI Office upgrade

## Request

Full audit, repair and upgrade of the AI Office into the owner-specified
architecture: AI 01 (main, `ag/claude-opus-5-5`) = main developer/implementer;
AI 02 (subagent, `cx/gpt-6-astra`) = architect, planner, independent QA;
planning-only and analysis-only modes; correction budget 5; push only after
independent QA PASS.

## Audit findings

- Model configuration verified from the settings store: `active_model`
  `ag/claude-opus-5-5`, `planning_model` `cx/gpt-6-astra[1m]`,
  `subagent_model` `cx/gpt-6-astra`, `execution_model` `af/gpt-oss-120b` — all
  four on provider `fb81151c-…`. Matches the owner's report exactly.
- Plan/Execute is a separate settings pair from subagent delegation; runtime
  semantics unobservable → documented, not assumed.
- Core defect: v1 role docs had the architecture **inverted** (architect = main,
  developer = subagent). Skill `two-agent-dev` baked the same inversion.
- Prior attempt at this prompt fell back to `rb/glm-5.3-flash` and did not
  complete (`task-controls/c4bfb0dc`).

## Changes

- `agents/architect.md` rewritten as AI 02: Phase A planning (Task Brief format)
  and Phase B independent QA (read-only, PASS/FAIL/BLOCKED/NOT VERIFIED).
- `agents/developer.md` rewritten as AI 01: classify → delegate plan →
  implement → verify → QA loop → git safety → ship.
- `ARCHITECTURE.md` rewritten (inverted diagram, verified model table,
  Plan/Execute section, QA protocol, host quirks incl. `bun test ./` prefix).
- `DECISIONS.md` appended D-009…D-012 (role inversion, Plan/Execute, QA
  vocabulary, disposable fixtures). History preserved, nothing rewritten.
- `RUNBOOK.md` rewritten (new kickoff template, verified test results).
- `reviews/`, `handoffs/`, `tasks/active/` READMEs updated to the new ownership
  and record fields.
- Skill `two-agent-dev` rewritten to the inverted protocol.

## Verification (real, non-destructive)

- Delegation + planning: AI 02 returned QA-SMOKE-01 Task Brief, 6 criteria,
  saved to `handoffs/brief-qa-smoke.md`.
- Implementation: fixture `money.ts` + `money.test.ts` (7 cases), bun test
  exit 0.
- QA defect loop: deliberate regression (double-minus formatting) → AI 02
  round 1 **FAIL** with D1 (critical) `money.ts:20` + D2 (inaccurate report);
  AI 01 fixed; AI 02 round 2 **PASS**, fix verified in code, no regressions.
  Records: `reviews/QA-qa-smoke-r1.md`, `QA-qa-smoke-r2.md`.
- Git safety: fetch, HEAD vs origin/main (0/0), diff review, no push for the
  test itself.
- Cleanup: fixture deleted; typecheck (4 apps) 0, backend typecheck 0,
  i18n parity 0 after cleanup.

## Limitations

- Plan/Execute runtime semantics NOT VERIFIED (no observation point).
- Per-call `model:` inert (v3.1); one `subagent_model` for all subagents.
- `.ai/AI_HANDOFF.md` still over the ~55 KB edit ceiling — archive task remains.
