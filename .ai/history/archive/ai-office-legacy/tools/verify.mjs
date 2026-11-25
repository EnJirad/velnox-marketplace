#!/usr/bin/env node
/**
 * verify.mjs — Self-check ของ AI Office 2.0
 *
 * รันการตรวจทั้งหมดแล้วรายงาน PASS/FAIL/NOT VERIFIED ตามจริง
 * ใช้: node .ai-office/tools/verify.mjs
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const must = (p) => join(ROOT, p);
const json = (p) => JSON.parse(readFileSync(must(p), 'utf8'));

const state = await import('./state.mjs');

const results = [];
/** รับ fn แบบ sync — ถ้า fn throw ถือว่า FAIL */
function check(id, name, fn) {
  try {
    const r = fn();
    results.push({ id, name, status: r.ok ? 'PASS' : 'FAIL', detail: r.detail });
  } catch (e) {
    results.push({ id, name, status: 'FAIL', detail: String(e?.message ?? e) });
  }
}

/* T01 โครงสร้าง */
check('T01', 'โครงสร้างโฟลเดอร์ครบ 6', () => {
  const need = ['agents', 'config', 'runtime', 'queue', 'logs', 'tools'];
  const missing = need.filter((d) => !existsSync(must(d)));
  return { ok: missing.length === 0, detail: missing.length ? `missing: ${missing}` : '6/6' };
});

/* T02 agent profiles */
check('T02', 'agent profile ครบ 4 ตัว', () => {
  const need = ['01-planner.md', '02-research.md', '03-developer.md', '04-qa.md'];
  const have = readdirSync(must('agents')).filter((f) => f.endsWith('.md'));
  const missing = need.filter((f) => !have.includes(f));
  return { ok: missing.length === 0, detail: `${have.length} found${missing.length ? ', missing ' + missing : ''}` };
});

/* T03 configs */
check('T03', 'config JSON ทั้ง 4 ไฟล์ parse ได้', () => {
  const files = ['config/routing.json', 'config/model-policy.json', 'config/tool-profiles.json', 'config/budget.json'];
  const bad = [];
  for (const f of files) { try { json(f); } catch { bad.push(f); } }
  return { ok: bad.length === 0, detail: bad.length ? `invalid: ${bad}` : '4/4 valid' };
});

/* T04 model slots */
check('T04', 'model policy: ทุก slot = flash', () => {
  const p = json('config/model-policy.json');
  const bad = Object.entries(p.slots).filter(([, v]) => String(v).includes('pro'));
  return {
    ok: bad.length === 0 && p.default_model.includes('flash'),
    detail: `default=${p.default_model}; slots=${JSON.stringify(p.slots)}`,
  };
});

/* T05 pro gates */
check('T05', 'pro escalation มี gate ครบ + ต้องอนุมัติ', () => {
  const g = json('config/model-policy.json').pro_escalation;
  return {
    ok: g.default_is_pro === false && g.requires_user_approval === true && g.gates_all_must_pass.length >= 5,
    detail: `gates=${g.gates_all_must_pass.length}, approval=${g.requires_user_approval}, default_is_pro=${g.default_is_pro}`,
  };
});

/* T06 state machine ปฏิเสธ transition ผิด */
check('T06', 'state machine ปฏิเสธ transition ผิด', () => {
  const b1 = state.validateTransition({}, 'QUEUED', 'COMPLETED');
  const b2 = state.validateTransition({}, 'COMPLETED', 'DEVELOPMENT');
  const b3 = state.validateTransition({}, 'QUEUED', 'BOGUS');
  const okTrans = state.validateTransition({}, 'QUEUED', 'DEVELOPMENT');
  return {
    ok: b1 !== null && b2 !== null && b3 !== null && okTrans === null,
    detail: `QUEUED->COMPLETED=${b1 ? 'rejected' : 'ACCEPTED(BAD)'}; COMPLETED->DEV=${b2 ? 'rejected' : 'ACCEPTED(BAD)'}; QUEUED->BOGUS=${b3 ? 'rejected' : 'ACCEPTED(BAD)'}; QUEUED->DEV=${okTrans ?? 'ok'}`,
  };
});

/* T07 acceptance criteria gate */
check('T07', 'PLANNING->DEVELOPMENT บังคับ acceptance criteria', () => {
  const bad = state.validateTransition({ acceptance_criteria: [] }, 'PLANNING', 'DEVELOPMENT');
  const good = state.validateTransition({ acceptance_criteria: ['x'] }, 'PLANNING', 'DEVELOPMENT');
  return { ok: bad !== null && good === null, detail: `without=${bad ? 'rejected' : 'ACCEPTED(BAD)'}; with=${good ?? 'ok'}` };
});

/* T08 retry gate */
check('T08', 'FAILED->QUEUED ปฏิเสธเมื่อ attempts ครบ', () => {
  const bad = state.validateTransition({ attempts: 2, max_attempts: 2 }, 'FAILED', 'QUEUED');
  const good = state.validateTransition({ attempts: 1, max_attempts: 2 }, 'FAILED', 'QUEUED');
  return { ok: bad !== null && good === null, detail: `attempts=2/2 → ${bad ? 'rejected' : 'ACCEPTED(BAD)'}; attempts=1/2 → ${good ?? 'ok'}` };
});

/* T09 tool profiles */
check('T09', 'tool profile ครบ 4 role', () => {
  const roles = Object.keys(json('config/tool-profiles.json').profiles);
  const need = ['planner', 'research', 'developer', 'qa'];
  const missing = need.filter((r) => !roles.includes(r));
  return { ok: missing.length === 0, detail: `${roles.length} roles: ${roles.join(', ')}` };
});

/* T10 single writer */
check('T10', 'single-writer: เฉพาะ developer มี write tool', () => {
  const t = json('config/tool-profiles.json');
  const writers = Object.entries(t.profiles)
    .filter(([, v]) => (v.allowed ?? []).some((x) => ['write_file', 'edit_file', 'apply_patch'].includes(x)))
    .map(([k]) => k);
  return { ok: writers.length === 1 && writers[0] === 'developer', detail: `writers=${JSON.stringify(writers)}` };
});

/* T11 usage log */
check('T11', 'usage.jsonl มีข้อมูล', () => {
  const p = must('logs/usage.jsonl');
  if (!existsSync(p)) return { ok: false, detail: 'not found — รัน tools/usage.mjs ก่อน' };
  const n = readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).length;
  return { ok: n > 0, detail: `${n} record(s)` };
});

/* T12 backup ครบ */
check('T12', 'backup ครบ', () => {
  const d = must('backup/2026-11-09-pre-optimization');
  if (!existsSync(d)) return { ok: false, detail: 'no backup dir' };
  const have = readdirSync(d);
  const need = ['mcp-snapshot.json', 'task-controls-snapshot.json', 'office-files.txt', 'mcp-servers-names.json'];
  const missing = need.filter((f) => !have.includes(f));
  return { ok: missing.length === 0, detail: `${have.length} files${missing.length ? ', missing ' + missing : ''}` };
});

/* T13 backup ไม่มี secret */
check('T13', 'backup ไม่มี secret', () => {
  const d = must('backup/2026-11-09-pre-optimization');
  const hits = [];
  for (const f of readdirSync(d)) {
    const txt = readFileSync(join(d, f), 'utf8');
    if (/Authorization"\s*:\s*"Bearer/i.test(txt) || /\bsk-[a-zA-Z0-9]{20,}/.test(txt)) hits.push(f);
  }
  return { ok: hits.length === 0, detail: hits.length ? `SECRET FOUND IN: ${hits}` : 'clean' };
});

/* T14 .ai/office ไม่ถูกแตะ — คำนวณ sha256 ใน Node เอง ไม่พึ่ง shell */
check('T14', '.ai/office ไม่ถูกแก้ไข (sha256)', () => {
  const list = must('backup/2026-11-09-pre-optimization/office-files.txt');
  const repoRoot = join(ROOT, '..');
  const expected = readFileSync(list, 'utf8').split('\n').filter(Boolean).map((line) => {
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    return m ? { hash: m[1], path: m[2] } : null;
  }).filter(Boolean);

  if (expected.length === 0) return { ok: false, detail: 'backup list empty or unparsable' };

  const bad = [];
  for (const { hash, path } of expected) {
    const abs = join(repoRoot, path);
    if (!existsSync(abs)) { bad.push(`MISSING ${path}`); continue; }
    const actual = createHash('sha256').update(readFileSync(abs)).digest('hex');
    if (actual !== hash) bad.push(`CHANGED ${path}`);
  }
  return {
    ok: bad.length === 0,
    detail: bad.length === 0 ? `${expected.length}/${expected.length} files OK` : bad.slice(0, 5).join('; '),
  };
});

/* T15 routing levels */
check('T15', 'routing ครบ 6 ระดับ', () => {
  const r = json('config/routing.json');
  const need = ['small', 'bugfix', 'feature', 'architecture', 'migration', 'debug'];
  const missing = need.filter((l) => !r.levels[l]);
  return { ok: missing.length === 0, detail: `${Object.keys(r.levels).length} levels${missing.length ? ', missing ' + missing : ''}` };
});

/* T16 budget retry limits */
check('T16', 'budget กำหนด retry limit', () => {
  const b = json('config/budget.json');
  return {
    ok: b.retry_limits?.implementation_retries_per_task === 2 && b.retry_limits?.identical_request_retries === 0,
    detail: JSON.stringify(b.retry_limits),
  };
});

/* ── summary ── */
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(JSON.stringify({ summary: { total: results.length, pass, fail }, results }, null, 2));
process.exit(fail === 0 ? 0 : 1);
