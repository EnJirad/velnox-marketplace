// One-off: regenerate the canonical task report after verification.
// Not part of the runtime path — run with `bun run .ai/office/scripts/write-report.ts`.
import { writeLatestReport } from '../report-manager';

await writeLatestReport({
  taskId: 'ai-office-runtime-integration',
  timestamp: new Date().toISOString(),
  classification: 'T2',
  objective:
    'AI Office runtime integration, context optimization, single-report policy, end-to-end validation',
  affectedFiles: [
    '.ai/office/ESSENTIAL_RULES.md',
    '.ai/office/report-manager.ts',
    '.ai/office/tests/report-manager.test.ts',
    '.ai/office/tests/e2e-workflow.test.ts',
    '.ai/office/context-management/task-router.ts',
    '.ai/office/context-management/task-context-selector.ts',
    '.ai/office/context-management/task-router.test.ts',
    '.ai/AI_HANDOFF.md',
    '.ai/AI_RULES.md',
    '.ai/README.md',
    '.ai/office/QUICK_START.md',
  ],
  changesSummary:
    'Essential safety rules now load at every task level (including T1) through a real filesystem read instead of a null stub. The task router emits includeEssentialRules and the context manager consumes it. Report system is now one canonical .ai/reports/LATEST.md overwritten per task; five legacy report files were moved verbatim to .ai/history/archive/reports-legacy/. The report path is overridable via AI_REPORT_DIR so tests cannot delete the real report.',
  verificationResults: { typecheck: true, tests: true, i18n: true, gitDiffCheck: true },
  qaStatus: 'PASS',
  qaDetails:
    '81 tests pass across 7 files (0 failures). typecheck 4/4 apps exit 0. i18n parity 1602 x 3. git diff --check clean.',
  status: 'COMPLETED',
});

console.log('LATEST.md written');
