#!/usr/bin/env node
/**
 * state.mjs — State Manager (single authority) ของ Velnox AI Office 2.0
 *
 * หลักการ:
 *  - state.json คือแหล่งความจริงเดียวของ state
 *  - ทุกการเปลี่ยน state ต้องผ่าน validateTransition()
 *  - เขียนแบบ atomic: tmp → rename
 *  - ใช้ lock กัน concurrent write
 *
 * ใช้: node .ai-office/tools/state.mjs <command> [args]
 */

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE = join(ROOT, 'runtime', 'state.json');
const LOCK = join(ROOT, 'runtime', 'lock.json');
const EVENTS = join(ROOT, 'logs', 'events.jsonl');
const QUEUE = join(ROOT, 'queue', 'tasks.json');

const LOCK_TTL_SECONDS = 60;

/* ────────────────────────── state machine ────────────────────────── */

export const STATES = [
  'QUEUED', 'PLANNING', 'RESEARCH', 'DEVELOPMENT',
  'REVIEW', 'TESTING', 'COMPLETED', 'FAILED', 'BLOCKED',
];

/** ตารางการเปลี่ยน state ที่อนุญาต — นอกตาราง = ปฏิเสธ */
export const TRANSITIONS = {
  QUEUED: ['PLANNING', 'DEVELOPMENT', 'BLOCKED'],
  PLANNING: ['RESEARCH', 'DEVELOPMENT', 'BLOCKED'],
  RESEARCH: ['PLANNING', 'DEVELOPMENT', 'BLOCKED'],
  DEVELOPMENT: ['REVIEW', 'FAILED', 'BLOCKED'],
  REVIEW: ['TESTING', 'DEVELOPMENT', 'BLOCKED', 'FAILED'],
  TESTING: ['COMPLETED', 'FAILED', 'DEVELOPMENT', 'BLOCKED'],
  COMPLETED: [],
  FAILED: ['QUEUED', 'BLOCKED'],
  BLOCKED: ['QUEUED', 'FAILED'],
};

/** เงื่อนไขเพิ่มเติมต่อการเปลี่ยน state */
export function validateTransition(task, from, to) {
  if (!STATES.includes(to)) return `unknown target state: ${to}`;
  if (!STATES.includes(from)) return `unknown current state: ${from}`;
  if (!TRANSITIONS[from]?.includes(to)) return `illegal transition ${from} -> ${to}`;

  if (from === 'PLANNING' && to === 'DEVELOPMENT') {
    const c = task.acceptance_criteria ?? [];
    if (c.length === 0) return 'PLANNING -> DEVELOPMENT requires acceptance_criteria >= 1';
  }
  if (from === 'RESEARCH' && to === 'DEVELOPMENT') {
    if (!task.handoff?.findings) return 'RESEARCH -> DEVELOPMENT requires handoff.findings';
  }
  if (from === 'DEVELOPMENT' && to === 'REVIEW') {
    const t = task.files_touched ?? [];
    if (t.length === 0 && !task.last_error) {
      return 'DEVELOPMENT -> REVIEW requires files_touched or last_error';
    }
  }
  if (from === 'REVIEW' && to === 'DEVELOPMENT') {
    if (!task.handoff?.qa_feedback) return 'REVIEW -> DEVELOPMENT (FAIL) requires qa_feedback';
  }
  if (from === 'TESTING' && to === 'COMPLETED') {
    if (!task.handoff?.test_evidence) return 'TESTING -> COMPLETED requires handoff.test_evidence';
  }
  if (from === 'FAILED' && to === 'QUEUED') {
    const a = task.attempts ?? 0;
    const m = task.max_attempts ?? 2;
    if (a >= m) return `FAILED -> QUEUED refused: attempts ${a} >= max ${m}`;
  }
  return null;
}

/* ────────────────────────── helpers ────────────────────────── */

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return fallback; }
}

/** atomic write: เขียน .tmp แล้ว rename ทับ */
function atomicWrite(path, data) {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

export function loadState() {
  return readJSON(STATE, { schema_version: 1, updated_at: null, updated_by: null, tasks: {} });
}

export function saveState(state, by = 'system') {
  state.updated_at = new Date().toISOString();
  state.updated_by = by;
  atomicWrite(STATE, JSON.stringify(state, null, 2));
  return state;
}

export function appendEvent(evt) {
  ensureDir(dirname(EVENTS));
  const line = JSON.stringify({ ts: new Date().toISOString(), ...evt }) + '\n';
  let prev = '';
  if (existsSync(EVENTS)) prev = readFileSync(EVENTS, 'utf8');
  atomicWrite(EVENTS, prev + line);
}

/* ────────────────────────── lock ────────────────────────── */

export function readLock() {
  const l = readJSON(LOCK, null);
  if (!l) return null;
  const ageMs = Date.now() - new Date(l.acquired_at).getTime();
  return { ...l, stale: ageMs > (l.ttl_seconds ?? LOCK_TTL_SECONDS) * 1000, age_ms: ageMs };
}

export function acquireLock(owner, taskId, ttl = LOCK_TTL_SECONDS) {
  const cur = readLock();
  if (cur && !cur.stale && cur.locked_by !== owner) {
    return { ok: false, reason: `lock held by ${cur.locked_by} (${Math.round(cur.age_ms / 1000)}s)` };
  }
  if (cur && cur.stale) {
    appendEvent({ event: 'LOCK_STALE_CLEARED', actor: owner, holder: cur.locked_by, age_ms: cur.age_ms });
  }
  atomicWrite(LOCK, JSON.stringify({
    locked_by: owner, task_id: taskId,
    acquired_at: new Date().toISOString(), ttl_seconds: ttl,
  }, null, 2));
  appendEvent({ event: 'LOCK_ACQUIRED', actor: owner, task_id: taskId });
  return { ok: true };
}

export function releaseLock(owner) {
  const cur = readLock();
  if (!cur) return { ok: true, note: 'no lock' };
  if (cur.locked_by !== owner) return { ok: false, reason: `not owner (${cur.locked_by})` };
  try { unlinkSync(LOCK); } catch {}
  appendEvent({ event: 'LOCK_RELEASED', actor: owner, task_id: cur.task_id });
  return { ok: true };
}

/* ────────────────────────── queue ────────────────────────── */

export function loadQueue() { return readJSON(QUEUE, { schema_version: 1, queue: [] }); }
export function saveQueue(q) { atomicWrite(QUEUE, JSON.stringify(q, null, 2)); return q; }

export function enqueue(task) {
  const q = loadQueue();
  const s = loadState();
  if (q.queue.some((t) => t.task_id === task.task_id) || s.tasks[task.task_id]) {
    return { ok: false, reason: `duplicate task_id: ${task.task_id}` };
  }
  q.queue.push({
    task_id: task.task_id,
    priority: task.priority ?? 5,
    level: task.level ?? 'feature',
    title: task.title ?? '',
    enqueued_at: new Date().toISOString(),
    status: 'QUEUED',
  });
  q.queue.sort((a, b) => a.priority - b.priority || a.enqueued_at.localeCompare(b.enqueued_at));
  saveQueue(q);
  appendEvent({ event: 'TASK_ENQUEUED', task_id: task.task_id, level: task.level });
  return { ok: true, queue_length: q.queue.length };
}

/* ────────────────────────── task ops ────────────────────────── */

export function createTask({ task_id, title, level = 'feature', model = 'deepseek-flash', acceptance = [] }) {
  const s = loadState();
  if (s.tasks[task_id]) return { ok: false, reason: `task exists: ${task_id}` };
  s.tasks[task_id] = {
    task_id, title, level,
    state: 'QUEUED',
    owner: null, writer: null, model,
    escalation: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    attempts: 0, max_attempts: 2,
    last_error: null,
    files_touched: [],
    acceptance_criteria: acceptance,
    handoff: null,
    history: [],
  };
  saveState(s, 'system');
  appendEvent({ event: 'TASK_CREATED', task_id, level, model });
  return { ok: true, task: s.tasks[task_id] };
}

export function transition(taskId, to, patch = {}) {
  const s = loadState();
  const t = s.tasks[taskId];
  if (!t) return { ok: false, reason: `unknown task: ${taskId}` };
  const from = t.state;
  const err = validateTransition({ ...t, ...patch }, from, to);
  if (err) {
    appendEvent({ event: 'STATE_REJECTED', task_id: taskId, from, to, reason: err });
    return { ok: false, reason: err };
  }
  Object.assign(t, patch, { state: to, updated_at: new Date().toISOString() });
  (t.history ??= []).push({ from, to, at: t.updated_at, by: patch.by ?? 'system' });
  saveState(s, patch.by ?? 'system');
  appendEvent({ event: 'STATE_CHANGED', task_id: taskId, from, to, by: patch.by ?? 'system' });
  return { ok: true, from, to, task: t };
}

/* ────────────────────────── heartbeat / watcher ────────────────────────── */

const HB = join(ROOT, 'runtime', 'heartbeat.json');

export function heartbeat(taskId, owner) {
  atomicWrite(HB, JSON.stringify({ task_id: taskId, owner, ts: new Date().toISOString() }, null, 2));
  return { ok: true };
}

/** ตรวจ stale task — ไม่เรียก LLM เลย (independent ของ model inference) */
export function watch({ staleMinutes = 15 } = {}) {
  const findings = [];
  const lock = readLock();
  if (lock?.stale) {
    findings.push({ kind: 'STALE_LOCK', holder: lock.locked_by, age_ms: lock.age_ms });
  }
  let hb = null;
  if (existsSync(HB)) {
    hb = readJSON(HB, null);
    if (hb) {
      const age = Date.now() - new Date(hb.ts).getTime();
      if (age > staleMinutes * 60_000) {
        findings.push({ kind: 'STALE_HEARTBEAT', task_id: hb.task_id, age_ms: age });
      }
    }
  }
  const s = loadState();
  for (const t of Object.values(s.tasks)) {
    if (['DEVELOPMENT', 'REVIEW', 'TESTING'].includes(t.state) && !t.writer && !t.owner) {
      findings.push({ kind: 'ORPHAN_TASK', task_id: t.task_id, state: t.state });
    }
  }
  return { ok: findings.length === 0, findings, checked_at: new Date().toISOString() };
}

/* ────────────────────────── CLI ────────────────────────── */

if (process.argv[1] && process.argv[1].endsWith('state.mjs')) {
  const [cmd, ...args] = process.argv.slice(2);
  const out = (o) => console.log(JSON.stringify(o, null, 2));
  switch (cmd) {
    case 'create': {
      const [task_id, title, level] = args;
      out(createTask({ task_id, title: title ?? '', level: level ?? 'feature' }));
      break;
    }
    case 'move': {
      const [task_id, to, by] = args;
      out(transition(task_id, to, { by: by ?? 'cli' }));
      break;
    }
    case 'list': out(loadState()); break;
    case 'lock': { const [owner, tid] = args; out(acquireLock(owner, tid)); break; }
    case 'unlock': { out(releaseLock(args[0])); break; }
    case 'enqueue': {
      const [task_id, title, level] = args;
      out(enqueue({ task_id, title, level }));
      break;
    }
    case 'watch': out(watch()); break;
    case 'heartbeat': { const [tid, ow] = args; out(heartbeat(tid, ow)); break; }
    default:
      console.log('usage: state.mjs create|move|list|lock|unlock|enqueue|watch|heartbeat [args]');
      process.exit(cmd ? 2 : 0);
  }
}
