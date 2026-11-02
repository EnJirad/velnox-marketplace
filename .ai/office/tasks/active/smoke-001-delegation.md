# Task brief — SMOKE-001 two-agent delegation test

> Deliberately tiny and harmless: it proves the delegation channel works before
> anyone trusts it with product code. It creates one documentation file.

## Slug
`smoke-001-delegation`

## Request
Prove that Agent 01 can delegate to Agent 02, that Agent 02 can write in the
shared workspace, and that Agent 01 can independently verify the result.

## Context to read first
- `AGENTS.md`
- `.ai/office/agents/developer.md`

## Scope — files allowed to change
- `.ai/office/handoffs/smoke-01.md` — create this file (new file)

No other file may be created or modified.

## Out of scope
- Any source code under `apps/`, `packages/`, `backend/`
- Git commits, pushes, or branch changes
- Package installation

## Acceptance criteria

1. `.ai/office/handoffs/smoke-01.md` exists.
2. Its first line is exactly `# Two-Agent Smoke Test — Round 1`.
3. It contains a line starting with `ROUND:` whose value is `1`.
4. It contains a line `SHA: <short sha>` where the sha is the output of
   `git rev-parse --short HEAD`.
5. It contains a section headed `## Commands Run` listing at least one real
   command with its real exit code.
6. The file's last line is exactly `STATUS: implemented`.

## Verification you must run

```bash
git rev-parse --short HEAD
git status --short
```

Report the real output of both. Do not run the project build or test suite —
nothing in this task can affect them.

## Constraints

- Do not commit.
- Do not modify any existing file.
- Keep the file under 40 lines.

## Round

`1` of `5`

## Report

Use the exact `STATUS / FILES CHANGED / COMMANDS RUN / ACCEPTANCE CRITERIA /
ASSUMPTIONS / OPEN PROBLEMS` format from `agents/developer.md`.
