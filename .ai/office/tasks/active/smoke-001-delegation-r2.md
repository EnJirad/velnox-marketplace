# Task brief — SMOKE-001 round 2 (iteration)

> Round 2 exercises what round 1 did not: **modifying an existing file** and
> adding a second artefact, then proving the architect can re-verify a changed
> file rather than only a new one.

## Slug
`smoke-001-delegation` (round 2)

## Request
Extend the round-1 handoff with a risk register and record the round-2 handoff.

## Context to read first
- `.ai/office/agents/developer.md`
- `.ai/office/handoffs/smoke-01.md` (the file you created in round 1 — read it
  before editing)

## Scope — files allowed to change
- `.ai/office/handoffs/smoke-01.md` — edit in place
- `.ai/office/handoffs/smoke-02.md` — create (new file)

No other file may be created or modified. Do not touch `.ai/office/agents/`,
`tasks/`, or any source code.

## Out of scope
- Any file under `apps/`, `packages/`, `backend/`
- Git commits, pushes, branch changes
- Package installation

## Acceptance criteria

1. In `smoke-01.md`, the line `ROUND: 1` becomes `ROUND: 2` (and appears exactly once).
2. In `smoke-01.md`, a new section headed `## Risks` is inserted **before** the
   final `STATUS: implemented` line, containing at least two `- ` bullet points.
3. In `smoke-01.md`, `STATUS: implemented` remains the **last** line of the file.
4. `smoke-02.md` exists, its first line is exactly `# Two-Agent Smoke Test — Round 2`.
5. `smoke-02.md` contains a `## Inherited` section stating, in one sentence, that
   round 2 edited the round-1 file rather than creating a fresh one.
6. `smoke-02.md` last line is exactly `STATUS: implemented`.
7. No file outside the two listed paths is modified (`git status --short` proof).

## Verification you must run

```bash
git status --short
wc -l .ai/office/handoffs/smoke-01.md .ai/office/handoffs/smoke-02.md
tail -1 .ai/office/handoffs/smoke-01.md
grep -n '^ROUND:' .ai/office/handoffs/smoke-01.md
grep -c '^- ' .ai/office/handoffs/smoke-01.md
```

Report the real output of each. Do not run the project build or test suite.

## Constraints

- Do not commit.
- Preserve everything else already in `smoke-01.md` — this is an in-place edit,
  not a rewrite. Round 1's `## Commands Run` section must survive.
- Keep each file under 40 lines.

## Round

`2` of `5`

## Report

Use the exact format from `agents/developer.md`.
