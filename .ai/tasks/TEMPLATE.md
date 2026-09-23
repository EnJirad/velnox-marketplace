# Task — <short title>

Status: active
Assigned: <YYYY-MM-DD>

## Objective

One or two sentences. What must be true when this is done.

## Allowed Scope

What may be changed. What may explicitly **not** be changed (e.g. "no DB change", "do not touch auth", "do not rewrite the queue").

## Relevant Context

The smallest set of context files this task needs, by path:

- `.ai/context/<file>.md`
- (leave empty if none beyond `AI_RULES.md` + `AI_HANDOFF.md`)

## Relevant Source

Files/directories to inspect before editing:

- `backend/routes/<file>.ts`
- `apps/<app>/src/...`

## Verification

Exact commands and the manual flow that proves it:

```bash
bun run typecheck
cd backend && bun test tests
```

Plus: which screen/endpoint to exercise, what a correct result looks like, and what must NOT regress.

## Stop Conditions

Stop and report instead of proceeding when:

- the source contradicts the brief (the brief is wrong → say so)
- the fix needs a DB change not covered by `db/schema.sql` + `db/run-sqleditor.sql`
- the change would weaken auth/authz, or delete a working feature
- verification fails and the root cause is outside scope

## Expected Output

- the change itself (files listed)
- validation results (real command output, not a claim)
- a concise report: PASS / PARTIAL / FAIL per requirement, what remains unproven
- `.ai/AI_HANDOFF.md` updated
- commit (only when verified) — see `.ai/context/workflow.md`
