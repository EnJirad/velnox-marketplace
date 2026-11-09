#!/usr/bin/env node
/**
 * route.mjs — Task classifier / router
 *
 * เลือก workflow ตามระดับงานโดยดูจาก keyword + ไฟล์ที่แตะ
 * ใช้ routing.json เป็นแหล่งกติกา
 *
 * ใช้: node .ai-office/tools/route.mjs "<task description>" [file1 file2 ...]
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CFG_PATH = join(ROOT, 'config', 'routing.json');

export function loadRouting() {
  return JSON.parse(readFileSync(CFG_PATH, 'utf8'));
}

/** ไฟล์ที่ถือว่าเสี่ยงสูง → ยกระดับเป็น architecture/migration */
const CRITICAL_PATHS = [
  /^backend\/routes\/auth/, /^backend\/middleware\//,
  /^backend\/lib\/payment/, /^backend\/lib\/money/,
  /^db\//, /\.sql$/,
  /^packages\/shared\/src\/lib\/commerce/,
];

const UI_PATHS = [/\.css$/, /\/components\//, /\/pages\//, /\.tsx$/];

export function classify(description = '', files = []) {
  const cfg = loadRouting();
  const d = description.toLowerCase();
  const reasons = [];
  let level = 'feature';

  const has = (kws) => kws.filter((k) => d.includes(k.toLowerCase()));

  const migHits = has(cfg.classification_hints.migration_keywords);
  const archHits = has(cfg.classification_hints.architecture_keywords);
  const debugHits = has(cfg.classification_hints.debug_keywords);
  const smallHits = has(cfg.classification_hints.small_keywords);
  const bugHits = has(cfg.classification_hints.bugfix_keywords ?? []);

  const criticalFiles = files.filter((f) => CRITICAL_PATHS.some((r) => r.test(f)));
  const uiFiles = files.filter((f) => UI_PATHS.some((r) => r.test(f)));

  if (migHits.length || criticalFiles.some((f) => /^(db\/|.*\.sql$)/.test(f))) {
    level = 'migration';
    reasons.push(`migration signal: ${migHits.join(', ') || criticalFiles.join(', ')}`);
  } else if (archHits.length) {
    level = 'architecture';
    reasons.push(`architecture signal: ${archHits.join(', ')}`);
  } else if (debugHits.length) {
    level = 'debug';
    reasons.push(`debug signal: ${debugHits.join(', ')}`);
  } else if (criticalFiles.length) {
    level = 'bugfix';
    reasons.push(`critical path touched: ${criticalFiles.join(', ')}`);
  } else if (bugHits.length) {
    level = 'bugfix';
    reasons.push(`bugfix signal: ${bugHits.join(', ')}`);
  } else if (smallHits.length && files.length > 0 && files.length <= 2 && uiFiles.length === files.length) {
    level = 'small';
    reasons.push(`small signal: ${smallHits.join(', ')} + UI-only files (${files.length})`);
  } else if (smallHits.length && files.length === 0) {
    level = 'small';
    reasons.push(`small signal: ${smallHits.join(', ')}`);
  } else {
    reasons.push('default: feature');
  }

  const def = cfg.levels[level];
  const agents = Object.entries(def.agents)
    .filter(([, on]) => on)
    .map(([k]) => k);

  return {
    level,
    label: def.label,
    workflow: def.workflow,
    agents,
    max_retries: def.max_retries,
    reasons,
    justification: buildJustification(level, agents, reasons),
  };
}

function buildJustification(level, agents, reasons) {
  if (agents.length === 0) return 'ไม่มี agent ต้องถูกเรียก';
  const names = { planner: 'Planner (AI01)', research: 'Research (AI02)', developer: 'Developer (AI03)', qa: 'QA (AI04)' };
  return `ระดับ ${level} → เรียก ${agents.map((a) => names[a] ?? a).join(', ')} เพราะ ${reasons.join('; ')}`;
}

if (process.argv[1] && process.argv[1].endsWith('route.mjs')) {
  const desc = process.argv[2] ?? '';
  const files = process.argv.slice(3);
  console.log(JSON.stringify(classify(desc, files), null, 2));
}
