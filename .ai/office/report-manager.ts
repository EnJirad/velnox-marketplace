/**
 * Report Manager — single canonical latest report.
 *
 * Replaces the accumulating dated reports with ONE file: `.ai/reports/LATEST.md`.
 * Each completed task overwrites it. No dated report history is kept — git
 * history of the code is the durable record.
 *
 * Durable project knowledge (architecture, decisions, current state, unresolved
 * issues, latest verified commit) belongs in `.ai/AI_HANDOFF.md` and
 * `.ai/context/*.md`, not here.
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises';

export interface TaskReport {
  taskId: string;
  timestamp: string;
  classification: 'T1' | 'T2' | 'T3';
  objective: string;
  affectedFiles: string[];
  changesSummary: string;
  verificationResults: {
    typecheck: boolean;
    tests: boolean;
    i18n: boolean;
    gitDiffCheck: boolean;
  };
  qaStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
  qaDetails?: string;
  gitCommit?: string;
  status: 'COMPLETED' | 'PARTIAL' | 'BLOCKED';
  notes?: string;
}

export const REPORT_DIR = process.env.AI_REPORT_DIR || '.ai/reports';
export const LATEST_REPORT = `${REPORT_DIR}/LATEST.md`;

async function ensureReportDir(): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
}

function formatReport(report: TaskReport): string {
  const lines: string[] = [];

  lines.push(`# AI Office Task Report — ${report.taskId}`);
  lines.push('');
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push(`**Classification:** ${report.classification}`);
  lines.push(`**Objective:** ${report.objective}`);
  lines.push(`**Status:** ${report.status}`);
  lines.push(`**Git Commit:** ${report.gitCommit || 'Not committed'}`);
  lines.push('');

  lines.push('## Affected Files');
  if (report.affectedFiles.length > 0) {
    report.affectedFiles.forEach((f) => lines.push(`- \`${f}\``));
  } else {
    lines.push('- None');
  }
  lines.push('');

  lines.push('## Changes Summary');
  lines.push(report.changesSummary);
  lines.push('');

  lines.push('## Verification Results');
  lines.push(`- Typecheck: ${report.verificationResults.typecheck ? 'PASS' : 'FAIL'}`);
  lines.push(`- Tests: ${report.verificationResults.tests ? 'PASS' : 'FAIL'}`);
  lines.push(`- I18n Parity: ${report.verificationResults.i18n ? 'PASS' : 'FAIL'}`);
  lines.push(`- Git Diff Check: ${report.verificationResults.gitDiffCheck ? 'PASS' : 'FAIL'}`);
  lines.push('');

  lines.push('## QA Status');
  lines.push(`**${report.qaStatus}**`);
  if (report.qaDetails) {
    lines.push('');
    lines.push(report.qaDetails);
  }
  lines.push('');

  if (report.notes) {
    lines.push('## Notes');
    lines.push(report.notes);
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Single canonical report — replaced on each new task. Generated ${report.timestamp}.*`);

  return lines.join('\n');
}

export async function writeLatestReport(report: Record<string, unknown> | TaskReport): Promise<string> {
  const normalized = normalizeReport(report);
  await ensureReportDir();
  const content = formatReport(normalized);
  await writeFile(LATEST_REPORT, content, 'utf8');
  return content;
}

export async function readLatestReport(): Promise<string | null> {
  try {
    return await readFile(LATEST_REPORT, 'utf8');
  } catch {
    return null;
  }
}

export async function getLatestReportSummary(): Promise<{
  exists: boolean;
  timestamp?: string;
  taskId?: string;
  status?: string;
}> {
  const content = await readLatestReport();
  if (!content) return { exists: false };

  return {
    exists: true,
    taskId: content.match(/# AI Office Task Report — (.+)/)?.[1]?.trim(),
    timestamp: content.match(/\*\*Timestamp:\*\* (.+)/)?.[1]?.trim(),
    status: content.match(/\*\*Status:\*\* (.+)/)?.[1]?.trim(),
  };
}

/** Test helper — removes the canonical report. Never used by task execution. */
export async function clearLatestReport(): Promise<void> {
  try {
    await unlink(LATEST_REPORT);
  } catch {
    // Already absent — nothing to do.
  }
}

function normalizeReport(report: Record<string, unknown> | TaskReport): TaskReport {
  const r = report as Record<string, unknown>;
  const vr = (r.verificationResults ?? {}) as Record<string, unknown>;
  return {
    taskId: String(r.taskId ?? 'unknown'),
    timestamp: String(r.timestamp ?? new Date().toISOString()),
    classification: (r.classification as TaskReport['classification']) ?? 'T2',
    objective: String(r.objective ?? ''),
    affectedFiles: Array.isArray(r.affectedFiles) ? (r.affectedFiles as string[]) : [],
    changesSummary: String(r.changesSummary ?? ''),
    verificationResults: {
      typecheck: Boolean(vr.typecheck),
      tests: Boolean(vr.tests),
      i18n: Boolean(vr.i18n),
      gitDiffCheck: Boolean(vr.gitDiffCheck),
    },
    qaStatus: (r.qaStatus as TaskReport['qaStatus']) ?? 'NOT_RUN',
    qaDetails: r.qaDetails ? String(r.qaDetails) : undefined,
    gitCommit: r.gitCommit ? String(r.gitCommit) : undefined,
    status: (r.status as TaskReport['status']) ?? 'COMPLETED',
    notes: r.notes ? String(r.notes) : undefined,
  };
}
