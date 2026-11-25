#!/usr/bin/env node
/**
 * benchmark.mjs — วัด before/after จากข้อมูลจริง + คำนวณ projection
 *
 * กติกา: แยกให้ชัดระหว่าง
 *   [MEASURED]   — วัดจากข้อมูลจริง ณ ตอนรัน
 *   [PROJECTED]  — คำนวณจากสมมติฐานที่ระบุ
 *   [NOT VERIFIED] — ยังไม่มีข้อมูลพอ
 *
 * ใช้: node .ai-office/tools/benchmark.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const must = (p) => join(ROOT, p);
const json = (p) => JSON.parse(readFileSync(must(p), 'utf8'));

/* ── ราคาต่อ token (จาก models-dev.json) ── */
const PRICE_PER_TOKEN = {
  'deepseek-flash': { input: 0.15e-6, cache_read: 0.003e-6, output: 0.6e-6 },
  'deepseek-v4-flash': { input: 0.15e-6, cache_read: 0.003e-6, output: 0.6e-6 },
  'deepseek-v4-pro': { input: 0.66e-6, cache_read: 0.022e-6, output: 1.98e-6 },
};

const costOf = (model, r) => {
  const p = PRICE_PER_TOKEN[model];
  return r.in_miss * p.input + r.in_hit * p.cache_read + r.out * p.output;
};

/* ── อ่าน usage จริง ── */
const usagePath = must('logs/usage.jsonl');
if (!existsSync(usagePath)) {
  console.error('ไม่มี logs/usage.jsonl — รัน tools/usage.mjs ก่อน');
  process.exit(1);
}
const usage = readFileSync(usagePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const models = {};
for (const r of usage) {
  const m = (models[r.model] ??= { requests: 0, in_miss: 0, in_hit: 0, out: 0 });
  m.requests += r.requests; m.in_miss += r.in_miss; m.in_hit += r.in_hit; m.out += r.out;
}

const basics = {};
for (const [name, m] of Object.entries(models)) {
  const c = costOf(name, m);
  basics[name] = {
    requests: m.requests,
    in_miss: m.in_miss, in_hit: m.in_hit, out: m.out,
    cache_hit_rate_pct: +((m.in_hit / (m.in_hit + m.in_miss)) * 100).toFixed(2),
    cost_usd: +c.toFixed(6),
  };
}

const totalBefore = Object.values(basics).reduce((s, b) => s + b.cost_usd, 0);

/* ── PROJECTED: ย้าย workload pro ไป flash ── */
const pro = models['deepseek-v4-pro'];
const proOnFlash = pro ? costOf('deepseek-flash', pro) : 0;
const flashCost = basics['deepseek-flash']?.cost_usd ?? 0;
const projectedTotal = flashCost + proOnFlash;

/* ── ตรวจ config ที่มีผลจริงตอนนี้ ── */
const budget = json('config/budget.json');
const policy = json('config/model-policy.json');

/* ── prompt weight (MEASURED) ── */
const fsTok = (p) => existsSync(p) ? Math.ceil(readFileSync(p).length / 4) : null;
const promptWeights = {
  'old developer': fsTok(join(ROOT, '..', '.ai/office/agents/developer.md')),
  'old architect': fsTok(join(ROOT, '..', '.ai/office/agents/architect.md')),
  'new planner': fsTok(must('agents/01-planner.md')),
  'new research': fsTok(must('agents/02-research.md')),
  'new developer': fsTok(must('agents/03-developer.md')),
  'new qa': fsTok(must('agents/04-qa.md')),
};

const out = {
  generated_at: new Date().toISOString(),
  measured: {
    source: 'logs/usage.jsonl (แปลงจาก provider CSV)',
    dates: [...new Set(usage.map((r) => r.date))],
    per_model: basics,
    total_cost_usd: +totalBefore.toFixed(6),
    note: 'MEASURED จาก CSV จริง ไม่ใช่ประมาณการ',
  },
  projected: {
    assumption: 'ย้าย 100% ของ workload deepseek-v4-pro ไป deepseek-flash ด้วยราคา flash',
    pro_workload_on_flash_usd: +proOnFlash.toFixed(6),
    pro_actual_cost_usd: basics['deepseek-v4-pro']?.cost_usd ?? 0,
    savings_usd: +((basics['deepseek-v4-pro']?.cost_usd ?? 0) - proOnFlash).toFixed(6),
    projected_total_usd: +projectedTotal.toFixed(6),
    reduction_percent: +(((totalBefore - projectedTotal) / totalBefore) * 100).toFixed(1),
  },
  targets: {
    daily_target_usd: budget.daily_target_usd,
    projected_vs_target_multiple: +(projectedTotal / budget.daily_target_usd).toFixed(2),
    meets_target: projectedTotal <= budget.daily_target_usd,
    note: 'projected ยังเกิน target — ต้องลด token ต่อ request หรือจำนวน request เพิ่ม',
  },
  prompt_weights_measured: promptWeights,
  not_verified: [
    'ต้นทุนจริงหลังเปลี่ยนแปลง — ต้องเก็บข้อมูลหลายวันหลังใช้ flash เท่านั้น',
    'การลด tool schema จริงต่อ request — Harness ไม่เปิดให้ inspect payload',
    'คุณภาพงานเทียบ pro — ต้องรันงานคู่ขนานแบบเดียวกันทั้งสอง model',
    'จำนวน request ที่ลดได้จริงจาก routing — ยังไม่มีงานจริงพอให้วัด',
  ],
};

console.log(JSON.stringify(out, null, 2));
