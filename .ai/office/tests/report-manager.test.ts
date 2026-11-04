import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { 
  writeLatestReport, 
  readLatestReport, 
  getLatestReportSummary, 
  clearLatestReport,
  TaskReport 
} from '../report-manager';

describe('Report Manager', () => {
  beforeEach(async () => {
    await clearLatestReport();
  });
  
  afterEach(async () => {
    await clearLatestReport();
  });

  test('should write and read a latest report', async () => {
    const report: TaskReport = {
      taskId: 'TEST-001',
      timestamp: '2026-11-03T10:00:00Z',
      classification: 'T2',
      objective: 'Implement new feature',
      affectedFiles: ['apps/velshop/src/components/NewFeature.tsx'],
      changesSummary: 'Added new feature component with tests',
      verificationResults: {
        typecheck: true,
        tests: true,
        i18n: true,
        gitDiffCheck: true
      },
      qaStatus: 'PASS',
      qaDetails: 'All criteria verified',
      gitCommit: 'abc123',
      status: 'COMPLETED'
    };

    await writeLatestReport(report);
    const content = await readLatestReport();
    
    expect(content).not.toBeNull();
    expect(content).toContain('TEST-001');
    expect(content).toContain('T2');
    expect(content).toContain('Implement new feature');
    expect(content).toContain('COMPLETED');
  });

  test('should replace previous report on subsequent writes', async () => {
    // First report
    const report1: TaskReport = {
      taskId: 'TASK-1',
      timestamp: '2026-11-03T10:00:00Z',
      classification: 'T1',
      objective: 'Fix typo',
      affectedFiles: ['file1.ts'],
      changesSummary: 'Fixed typo',
      verificationResults: { typecheck: true, tests: true, i18n: true, gitDiffCheck: true },
      qaStatus: 'NOT_RUN',
      status: 'COMPLETED'
    };

    await writeLatestReport(report1);
    let content = await readLatestReport();
    expect(content).toContain('TASK-1');

    // Second report replaces first
    const report2: TaskReport = {
      taskId: 'TASK-2',
      timestamp: '2026-11-03T11:00:00Z',
      classification: 'T2',
      objective: 'Add feature',
      affectedFiles: ['file2.ts'],
      changesSummary: 'Added feature',
      verificationResults: { typecheck: true, tests: true, i18n: true, gitDiffCheck: true },
      qaStatus: 'PASS',
      status: 'COMPLETED'
    };

    await writeLatestReport(report2);
    content = await readLatestReport();
    expect(content).toContain('TASK-2');
    expect(content).not.toContain('TASK-1');
  });

  test('getLatestReportSummary returns correct metadata', async () => {
    const report: TaskReport = {
      taskId: 'SUMMARY-TEST',
      timestamp: '2026-11-03T12:00:00Z',
      classification: 'T3',
      objective: 'Critical fix',
      affectedFiles: ['file3.ts'],
      changesSummary: 'Critical security fix',
      verificationResults: { typecheck: true, tests: true, i18n: true, gitDiffCheck: true },
      qaStatus: 'PASS',
      status: 'COMPLETED'
    };

    await writeLatestReport(report);
    const summary = await getLatestReportSummary();
    
    expect(summary.exists).toBe(true);
    expect(summary.taskId).toBe('SUMMARY-TEST');
    expect(summary.timestamp).toBe('2026-11-03T12:00:00Z');
  });

  test('getLatestReportSummary returns empty when no report', async () => {
    await clearLatestReport();
    // Small delay to ensure file system sync
    await new Promise(r => setTimeout(r, 10));
    const summary = await getLatestReportSummary();
    expect(summary.exists).toBe(false);
  });

  test('multiple sequential writes keep only latest', async () => {
    for (let i = 1; i <= 5; i++) {
      const report: TaskReport = {
        taskId: `TASK-${i}`,
        timestamp: `2026-11-03T1${i}:00:00Z`,
        classification: 'T1',
        objective: `Task ${i}`,
        affectedFiles: [`file${i}.ts`],
        changesSummary: `Changes ${i}`,
        verificationResults: { typecheck: true, tests: true, i18n: true, gitDiffCheck: true },
        qaStatus: 'NOT_RUN',
        status: 'COMPLETED'
      };
      await writeLatestReport(report);
    }

    const content = await readLatestReport();
    expect(content).toContain('TASK-5');
    expect(content).not.toContain('TASK-1');
    expect(content).not.toContain('TASK-2');
    expect(content).not.toContain('TASK-3');
    expect(content).not.toContain('TASK-4');
  });
});
