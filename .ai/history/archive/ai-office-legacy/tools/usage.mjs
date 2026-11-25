#!/usr/bin/env node
/**
 * usage.mjs — แปลง provider CSV → logs/usage.jsonl + คำนวณ cache hit rate และต้นทุน
 *
 * อ่าน: /sdcard/Download/cost-*.csv, amount-*.csv (หรือ path ที่ส่งมา)
 * เขียน: .ai-office/logs/usage.jsonl
 *
 * ใช้: node .ai-office/tools/usage.mjs [cost.csv] [amount.csv]
 *      node .ai-office/tools/usage.mjs --report
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOG = join(ROOT, 'logs', 'usage.jsonl');
const POLICY = JSON.parse(readFileSync(join(ROOT, 'config', 'model-policy.json'), 'utf8'));

const DOWNLOAD = '/sdcard/Download';

function parseCSV(text) {
  // strip BOM
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitLine(lines[0]);
  return lines.slice(1).map((l) => {
    const vals = splitLine(l);
    const o = {};
    head.forEach((h, i) => { o[h.trim()] = (vals[i] ?? '').trim(); });
    return o;
  });
}

function splitLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function findLatest(prefix) {
  if (!existsSync(DOWNLOAD)) return null;
  const files = readdirSync(DOWNLOAD)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.csv'))
    .sort();
  return files.length ? join(DOWNLOAD, files[files.length - 1]) : null;
}

/** สร้างสรุปต่อ (date, model) จาก 2 ไฟล์ */
export function buildUsage(costPath, amountPath) {
  const costs = parseCSV(readFileSync(costPath, 'utf8'));
  const amounts = parseCSV(readFileSync(amountPath, 'utf8'));

  const agg = new Map(); // key = date|model
  const key = (date, model) => `${date}|${model}`;

  for (const r of amounts) {
    const date = (r.start_time_iso ?? '').slice(0, 10);
    const model = r.model;
    if (!date || !model) continue;
    const k = key(date, model);
    if (!agg.has(k)) agg.set(k, { date, model, requests: 0, in_miss: 0, in_hit: 0, out: 0, prices: {} });
    const a = agg.get(k);
    const amt = Number(r.amount) || 0;
    switch (r.type) {
      case 'request_count': a.requests = amt; break;
      case 'input_cache_miss_tokens': a.in_miss = amt; a.prices.input = Number(r.price) || 0; break;
      case 'input_cache_hit_tokens': a.in_hit = amt; a.prices.cache_read = Number(r.price) || 0; break;
      case 'output_tokens': a.out = amt; a.prices.output = Number(r.price) || 0; break;
      default: break;
    }
  }

  // กระทบยอดกับ cost CSV
  const costByKey = new Map();
  for (const c of costs) {
    const date = (c.start_time_iso ?? '').slice(0, 10);
    costByKey.set(key(date, c.model), Number(c.cost) || 0);
  }

  const rows = [];
  for (const [k, a] of agg) {
    // หมายเหตุหน่วย: คอลัมน์ `price` ใน CSV ของ provider เป็นราคา "ต่อ 1 token"
    // (เช่น 0.00000015 = $0.15 ต่อ 1M token) จึงคูณตรง ๆ ไม่หาร 1e6
    const computed = a.in_miss * (a.prices.input ?? 0)
      + a.in_hit * (a.prices.cache_read ?? 0)
      + a.out * (a.prices.output ?? 0);
    const reported = costByKey.get(k);
    const totalInput = a.in_hit + a.in_miss;
    rows.push({
      date: a.date,
      model: a.model,
      requests: a.requests,
      in_miss: a.in_miss,
      in_hit: a.in_hit,
      out: a.out,
      cache_hit_rate_pct: totalInput ? +(a.in_hit / totalInput * 100).toFixed(2) : null,
      cost_computed_usd: +computed.toFixed(6),
      cost_reported_usd: reported ?? null,
      reconciles: reported == null ? null : Math.abs(computed - reported) < 1e-6,
    });
  }

  rows.sort((x, y) => x.date.localeCompare(y.date) || x.model.localeCompare(y.model));
  return rows;
}

/** เปรียบเทียบกับ baseline + ประเมินว่าอยู่ในเป้าหมายไหม */
export function summarize(rows) {
  const total = rows.reduce((s, r) => s + r.cost_computed_usd, 0);
  const byModel = {};
  for (const r of rows) {
    const m = (byModel[r.model] ??= { requests: 0, cost: 0, in_hit: 0, in_miss: 0, out: 0 });
    m.requests += r.requests; m.cost += r.cost_computed_usd;
    m.in_hit += r.in_hit; m.in_miss += r.in_miss; m.out += r.out;
  }
  for (const m of Object.values(byModel)) {
    const t = m.in_hit + m.in_miss;
    m.cache_hit_rate_pct = t ? +(m.in_hit / t * 100).toFixed(2) : null;
    m.cost = +m.cost.toFixed(6);
  }
  const dates = [...new Set(rows.map((r) => r.date))];
  return {
    dates,
    day_count: dates.length,
    total_cost_usd: +total.toFixed(6),
    avg_cost_per_day_usd: dates.length ? +(total / dates.length).toFixed(6) : 0,
    by_model: byModel,
    all_reconcile: rows.every((r) => r.reconciles !== false),
  };
}

function writeLog(rows) {
  mkdirSync(dirname(LOG), { recursive: true });
  const lines = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(LOG, lines, 'utf8');
  return LOG;
}

if (process.argv[1] && process.argv[1].endsWith('usage.mjs')) {
  const args = process.argv.slice(2);

  if (args[0] === '--report') {
    if (!existsSync(LOG)) { console.error('no usage log yet — run without --report first'); process.exit(1); }
    const rows = readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    console.log(JSON.stringify(summarize(rows), null, 2));
    process.exit(0);
  }

  const costPath = args[0] ?? findLatest('cost-');
  const amountPath = args[1] ?? findLatest('amount-');
  if (!costPath || !amountPath) {
    console.error('missing CSV: pass paths explicitly or place cost-*.csv / amount-*.csv in /sdcard/Download');
    process.exit(1);
  }
  const rows = buildUsage(costPath, amountPath);
  const out = writeLog(rows);
  const sum = summarize(rows);
  console.log(JSON.stringify({ written: out, ...sum }, null, 2));

  // เตือนเรื่องวันที่ไม่ตรงชื่อไฟล์
  const single = sum.day_count === 1;
  if (single) {
    console.error(`\n⚠️ ข้อมูลมีเพียง ${sum.day_count} วัน (${sum.dates.join(', ')}) — ชื่อไฟล์อาจบอกช่วงที่กว้างกว่า ห้ามตีความเป็นค่าเฉลี่ยช่วงยาว`);
  }
}
