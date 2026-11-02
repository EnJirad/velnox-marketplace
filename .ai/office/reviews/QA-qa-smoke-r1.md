QA REPORT QA-SMOKE-01 — ROUND 1
OUTCOME: FAIL

CRITERIA CHECKED:
  - Criterion 1: exactly two new files under `.ai/office/tests/qa-smoke/`, nothing else created → PASS — `find .ai/office/tests -type f` → only `money.ts` and `money.test.ts`. No existing file under the fixture was modified (both are untracked new files per `git status --short`).
  - Criterion 2: `money.ts` exports exactly `roundToCents` and `formatMoney`, zero import statements → PASS — read of `.ai/office/tests/qa-smoke/money.ts` (21 lines): `export function roundToCents` (line 7), `export function formatMoney` (line 13), `const SYMBOLS` module-level map (line 11), no `import` keyword anywhere in the file.
  - Criterion 3: `money.test.ts` imports only `test, expect` from `bun:test` plus the two helpers, exactly 7 `test(...)` blocks → PASS (with one cosmetic note) — read of `money.test.ts`: line 1 `import { expect, test } from "bun:test";`, line 2 `import { formatMoney, roundToCents } from "./money";`, exactly 7 `test(` blocks (lines 5, 9, 13, 17, 21, 25, 29). Note: the helper import specifier is `./money`, not the brief's literal `./money.ts`; bun 1.4.4 resolves it to the same module and the run confirms it, so this is cosmetic, not a defect.
  - Criterion 4: test run exits 0 with `7 pass`, `0 fail`, `Ran 7 tests across 1 file.` → **FAIL** — real run: `bun test ./.ai/office/tests/qa-smoke/money.test.ts` → exit code 1, output `6 pass`, `1 fail`, `7 expect() calls`, `Ran 7 tests across 1 file. [14.00ms]`. AI 01's claimed "7 pass, 0 fail" is contradicted by direct evidence; the report was false.
  - Criterion 5: output contains `[test-db] no test database configured — DB-gated integration tests will skip.` → PASS — the preload notice appears verbatim as the first line of the run (with an appended sentence `Set TEST_DATABASE_URL to a disposable PostgreSQL database to run them.`, which still contains the required substring). Safe, no-database configuration confirmed; production DB never touched.
  - Criterion 6: `git status --short` shows nothing under `apps/`, `packages/`, `backend/`, `db/`, and no change to `package.json`/`bun.lock` → PASS — `git status --short` output: ` M .ai/office/agents/architect.md`, ` M .ai/office/agents/developer.md`, `?? .ai/office/handoffs/brief-qa-smoke.md`, `?? .ai/office/tasks/active/office-audit-001.md`, `?? .ai/office/tests/`. No production path appears.

DEFECTS:
  D1 (critical) — .ai/office/tests/qa-smoke/money.ts:20 (root cause at lines 15–16, 20)
     Expected: `formatMoney(-1234.5)` → `"-฿1,234.50"` (brief APPROACH case 6; minus sign once, before the symbol).
     Actual:   `formatMoney(-1234.5)` → `"-฿-1,234.50"` (double minus: sign appears after the symbol too).
     Evidence: `bun test ./.ai/office/tests/qa-smoke/money.test.ts` → exit 1:
       `(fail) formatMoney keeps the minus sign before the symbol`
       `Expected: "-฿1,234.50"`
       `Received: "-฿-1,234.50"`
       `at <anonymous> (.../money.test.ts:26:32)`
     Root cause: `cents.toFixed(2)` on a negative amount returns `"-1234.50"`, so `intPart` is already `"-1234"` and the thousands-grouping regex inserts a comma inside it (`-1,234`); line 20 then prepends another `-` via `${negative ? "-" : ""}`. The sign is handled twice. Fix (for AI 01, not applied by QA): take the absolute value before `toFixed`/grouping, or strip the leading `-` from `intPart`, and keep the single `negative ? "-" : ""` prefix.
     Severity: critical — the fixture's stated purpose is to exercise the plan → implement → QA loop, and the QA loop caught a failing pinned acceptance case; the implementation does not meet the brief and AI 01's "7 pass, 0 fail" report was inaccurate.

  D2 (low) — process defect, not a file defect
     Expected: AI 01's report of test results to match reality (architect.md Phase B: claims are not evidence).
     Actual:   AI 01 reported `bun test ./.ai/office/tests/qa-smoke/money.test.ts` → exit 0, "7 pass, 0 fail"; the identical command on this round's exact file state exits 1 with `6 pass, 1 fail`.
     Evidence: QA run quoted above (same command, same files).
     Severity: low — no code impact beyond D1, but the accuracy of implementation reports must be corrected before any future QA round is trusted.

REGRESSIONS: none — the fixture is new; no pre-existing behavior was modified (`git diff --stat` shows only the pre-existing in-flight edits to `.ai/office/agents/architect.md` and `.ai/office/agents/developer.md`, outside this task's scope and unmodified by QA).

BLOCKERS: none.

NOT VERIFIED: none — every criterion was checked with direct command output or a full read of both files on this round's exact file state.

DEViations CONFIRMED from AI 01's report:
  1. Confirmed: `bun test .ai/office/tests/qa-smoke/` (brief's form) matches no test files on this host — output: `The following filters did not match any test files: .ai/office/tests/qa-smoke/` (605 files searched), exit 1. The `./`-prefixed file-path form is the correct substitute; deviation accepted.
  2. Confirmed: unrelated in-flight changes exist (`M .ai/office/agents/architect.md`, `M .ai/office/agents/developer.md`, `?? .ai/office/tasks/active/office-audit-001.md`); treated as out of scope per the brief's SCOPE LIMITS and deviation 2.

DISPOSITION: FAIL — one critical defect (D1). Return to AI 01 for a fix limited to `.ai/office/tests/qa-smoke/money.ts` (test file already matches the brief); re-run QA as round 2 afterwards. Do not widen scope; the two files remain the only touchable artifacts.
