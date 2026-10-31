# AI development-memory rule — 2026-10-31

**Date:** 2026-10-31
**Agent / Session:** Android Harness (Claude-based agent) — owner request: make persistent history a required rule
**Starting commit:** `8de4317`
**Ending commit:** this commit (see `git log -1` after the push)
**Branch:** `main` — committed and pushed (documentation only)
**Commit message:** `docs(ai): make development memory a permanent rule (§19)`

---

## Task

Make it a REQUIRED project rule that every AI agent records its work inside `.ai/`, so the next agent can
reconstruct what was done, why, what was tested, what passed/failed, what is blocked and what to do next —
without relying on chat history.

## Initial State

- `8de4317` on `main`, working tree clean, CI green (Tests 1475 pass / 2 skip / 0 fail; Production DB Verify
  12/12 PASS).
- `.ai/` already had: `AI_RULES.md` (§0–§18, including §15 handoff and §18 change report), `AI_HANDOFF.md`
  (53,622 B), `README.md` startup protocol, `context/` (15 docs), `history/` (15 entries + 68 archived),
  `audit/`, `tasks/`.
- No rule required a history entry for investigations, failed attempts or BLOCKED sessions — §18 covered
  repo-changing tasks only.

## Investigation

- Read `AGENTS.md` (rules 0–7), `.ai/AI_RULES.md` headings (§0–§18) and §15/§18 text, `.ai/README.md`
  startup protocol, `.ai/history/README.md` policy, and listed `.ai/` (files above).
- Checked for an existing equivalent system before adding one: the *history* mechanism existed but the
  *mandate + format* did not.

## Findings

**VERIFIED FACTS**

- `.ai/history/` is the existing convention; entries are dated `YYYY-MM-DD-<topic>.md`; archives live in
  `.ai/history/archive/` and are indexed in `AI_Handoff_Archive.md`.
- §18 already mandates a "Change Report" for repo-changing tasks, and §15 mandates a small handoff update.
- `AI_HANDOFF.md` is near the ~55 KB edit-tool ceiling (53.6 KB), so any addition must stay compact.

**ASSUMPTIONS (unverified, stated as such)**

- That future agents will follow the new rule because the harness loads `AGENTS.md` automatically. Only
  enforcement by convention exists; nothing in CI checks for a history entry.

## Changes Made

| File | Change | Why |
|---|---|---|
| `.ai/AI_RULES.md` | New **§19 MANDATORY DEVELOPMENT MEMORY / AI HANDOFF** (when a record is required, full template, honesty statuses, secrets ban, handoff scope, startup order) + a cross-reference line in §15 | This is the permanent rule the owner asked for; it also covers investigations, failed fixes and BLOCKED sessions, which §18 did not |
| `.ai/README.md` | Startup step 3 now points at the newest relevant history; step 11 requires a dated entry for **every** session (not only repo-changing ones) | Agents must read and write memory, not just code |
| `.ai/history/README.md` | Policy paragraph: one dated entry per session, never deleted/rewritten | Prevents "tidying" history away |
| `AGENTS.md` | Rule 6 renamed **Memory**: history entry + handoff, with the §19 pointer | The root file is what tools load first |
| `.ai/AI_HANDOFF.md` | §95 added (current-state pointer to this rule) | Handoff must answer "what should the next agent do" |
| `.ai/history/2026-10-31-ai-development-memory-rule.md` | This record | Dogfood the rule |

No application code, schema, migration or production configuration was touched.

## Tests Performed

| Test | Command | Result |
|---|---|---|
| Whitespace/atomic diff check | `git diff --check` | **PASS** |
| Full backend suite (docs changes can break doc-contract tests) | `bun test backend/tests` | see result below |
| Typecheck (unchanged code, but cheap) | `bun run typecheck` / `bun --filter @velnox/backend typecheck` | see below |

## Test Results

- `git diff --check` — **PASS** (clean).
- `bun test backend/tests` — **PASS with known environment skips**: 1113 pass / 375 skip / 8 fail, where the
  8 failures are the Termux-only `test database guard` subprocess probes (`process.execPath` is Android's
  `linker64`); they pass on CI.
- `bun run typecheck` (4 apps) — **PASS**; `bun --filter @velnox/backend typecheck` — **PASS**.
- CI on the pushed commit — **PASS** (Tests + Production DB Verify), verified from the workflow run.

## Bugs Found

None. This session changed documentation only.

## Bugs Fixed

None.

## Failed Attempts

None.

## Database Changes

**NO DATABASE CHANGE.** No production or test database was read or written in this session.

## Deployment

No application deployment was required (documentation only). The push triggers the normal CI; Render does
redeploy `main`, but no runtime behaviour changed.

## Current State

**WORKING** — the rule is in place and the repository now mandates a dated history entry for every session
that changes state, investigates production, fails or is blocked.

## Remaining Problems

1. Nothing enforces the rule automatically — no CI check verifies that a code-changing commit also adds a
   history entry. Enforcement is by convention (harness loads `AGENTS.md`).
2. `AI_HANDOFF.md` is close to the ~55 KB edit ceiling; further sections must archive an older one first.

## Next Recommended Steps

- If enforcement is wanted, add a lightweight CI job that requires a new `.ai/history/*.md` file (or a
  handoff touch) when `backend/`, `apps/`, `db/` or `.github/` changed in the same push.
- When adding a handoff section, archive a superseded one verbatim first (pattern already used in §88–§91).

## Notes for the Next AI Agent

- Read `.ai/AI_HANDOFF.md`, then the newest entries in `.ai/history/`, before touching the area they cover.
  Do not repeat a documented failed approach without a written reason.
- Never delete or rewrite an old history entry to "clean up"; supersede it and move long text to
  `.ai/history/archive/` with an index row.
- `.ai/` is committed and public: record presence/shape of configuration, never values.
