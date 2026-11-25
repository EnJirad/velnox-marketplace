# DESIGN.md — Velnox AI Office 2.0 (Phase 2)

**วันที่:** 2026-11-09
**สถานะ:** รอการอนุมัติก่อน Phase 3 (Backup) และ Phase 4 (Implement)
**อ้างอิง:** `.ai-office/AUDIT_REPORT.md`

---

## 1. หลักการออกแบบ

| หลักการ | เหตุผล |
|---------|--------|
| **File-based ไม่มี daemon** | Harness ไม่มี process ที่รอด app kill; daemon = เปราะ |
| **4 role profile ไม่ใช่ 4 runtime** | Harness มี 2 execution slot จริง |
| **Stable prefix ก่อน task content** | ใช้ประโยชน์ DeepSeek prompt cache (flash hit 98.83% พิสูจน์แล้วว่าได้ผล) |
| **Single writer** | มีเพียง Developer ที่เขียนโค้ด |
| **ไม่แตะ `.ai/office/`** | คงของเดิมไว้; ของใหม่แยกที่ `.ai-office/` |
| **ไม่แตะ production code** | งานนี้เป็น AI Office optimization |

---

## 2. โครงสร้างไฟล์

```
.ai-office/
├── DOCS
│   ├── AUDIT_REPORT.md          ✅ มีแล้ว (Phase 1)
│   ├── DESIGN.md                ← ไฟล์นี้
│   ├── IMPLEMENTATION.md        ← Phase 7
│   ├── TEST_REPORT.md           ← Phase 7
│   └── DISCOVERY.md             (งานก่อนหน้า)
│
├── agents/                      ← 4 role profile (prompt-level)
│   ├── 01-planner.md
│   ├── 02-research.md
│   ├── 03-developer.md
│   └── 04-qa.md
│
├── config/
│   ├── routing.json             ← กติกาเลือก agent ตามระดับงาน
│   ├── model-policy.json        ← flash default / pro escalation gate
│   ├── tool-profiles.json       ← tool ที่แต่ละ role ควรใช้
│   └── budget.json              ← เพดานต้นทุน + threshold
│
├── runtime/
│   ├── state.json               ← state ปัจจุบัน (single authority)
│   ├── lock.json                ← single-writer lock
│   └── heartbeat.json           ← heartbeat ของ task ที่กำลังทำ
│
├── queue/
│   └── tasks.json               ← คิวงาน (เรียงลำดับ)
│
├── logs/
│   ├── events.jsonl             ← append-only event log
│   └── usage.jsonl              ← usage ต่อ task/agent/model
│
└── tools/
    ├── state.mjs                ← state อ่าน/เขียน + atomic + lock
    ├── event.mjs                ← append event
    ├── route.mjs                ← task classification
    ├── usage.mjs                ← แปลง CSV → usage.jsonl + cache rate
    └── verify.mjs               ← self-check (Phase 5)
```

---

## 3. State Manager

### 3.1 Schema (`runtime/state.json`)

```json
{
  "schema_version": 1,
  "updated_at": "<ISO8601>",
  "updated_by": "AI01|AI02|AI03|AI04",
  "tasks": {
    "<task_id>": {
      "task_id": "vnx-20261109-001",
      "title": "…",
      "level": "small|bugfix|feature|architecture|migration|debug",
      "state": "QUEUED|PLANNING|RESEARCH|DEVELOPMENT|REVIEW|TESTING|COMPLETED|FAILED|BLOCKED",
      "owner": "AI01|AI02|AI03|AI04|null",
      "writer": "AI03|null",
      "model": "deepseek-flash|deepseek-v4-pro",
      "escalation": null,
      "created_at": "…",
      "updated_at": "…",
      "attempts": 0,
      "max_attempts": 2,
      "last_error": null,
      "files_touched": [],
      "acceptance_criteria": [],
      "handoff": null
    }
  }
}
```

### 3.2 State machine (บังคับใช้)

```
QUEUED ──► PLANNING ──► DEVELOPMENT ──► REVIEW ──► TESTING ──► COMPLETED
              │              ▲              │           │
              │              │              │           │
              ▼              └──────────────┘           │
           RESEARCH        (FAIL → กลับ DEV)            │
                                                         ▼
                                                     FAILED / BLOCKED
```

**กติกาการเปลี่ยน state ที่ต้องผ่าน validation:**

| จาก | ไปได้ | เงื่อนไข |
|-----|-------|---------|
| QUEUED | PLANNING, DEVELOPMENT | level=small ข้าม PLANNING ได้ |
| PLANNING | RESEARCH, DEVELOPMENT | ต้องมี acceptance_criteria ≥ 1 |
| RESEARCH | PLANNING, DEVELOPMENT | ต้องมี findings |
| DEVELOPMENT | REVIEW, FAILED | ต้องมี files_touched หรือ last_error |
| REVIEW | TESTING, DEVELOPMENT, BLOCKED | FAIL ต้องมี feedback |
| TESTING | COMPLETED, FAILED | ต้องมี test evidence |
| FAILED | QUEUED | เฉพาะเมื่อ attempts < max_attempts |
| ใด ๆ | BLOCKED | ผู้ใช้ intervenes |

**การเปลี่ยนที่ไม่ผ่านตาราง = ปฏิเสธ** (single authority)

### 3.3 Atomic write

```
1. อ่าน lock.json → ถ้า locked && ยังไม่หมด TTL → ปฏิเสธ
2. เขียน lock.json (owner, task_id, ts, ttl=60s)
3. write_file state.json.tmp
4. move_file state.json.tmp → state.json  (atomic rename)
5. ลบ/ปลด lock
```

ใช้ `write_file` + `move_file` ของ Harness (ทั้งคู่เป็น tool call เดี่ยว) — ไม่ใช้ shell redirect เพราะไม่ atomic

---

## 4. Event Log (`logs/events.jsonl`)

Append-only, 1 บรรทัด = 1 event:

```json
{"ts":"<ISO>","seq":1,"task_id":"vnx-…","actor":"AI01","event":"STATE_CHANGED","from":"QUEUED","to":"PLANNING","meta":{}}
```

ประเภท event: `TASK_CREATED`, `STATE_CHANGED`, `AGENT_INVOKED`, `TOOL_CALLED`, `RETRY`, `ERROR`, `LOCK_ACQUIRED`, `LOCK_RELEASED`, `HEARTBEAT`, `COMPLETED`, `ESCALATION_REQUESTED`

**การ append:** `read_file` → ต่อบรรทัด → `write_file` (ทำภายใต้ lock เพื่อกัน lost update)
**ข้อจำกัดที่รับทราบ:** ไม่ใช่ true O_APPEND — ถ้า process ตายกลางwrite อาจเสียบรรทัดสุดท้าย (ยอมรับได้ เพราะเป็น log ไม่ใช่ source of truth)

---

## 5. Task Queue (`queue/tasks.json`)

```json
{
  "schema_version": 1,
  "queue": [
    {"task_id":"vnx-…","priority":1,"enqueued_at":"…","level":"feature","status":"QUEUED"}
  ]
}
```

- `task_id` format: `vnx-YYYYMMDD-NNN` (unique, ตรวจซ้ำก่อน insert)
- priority ต่ำ = ก่อน
- duplicate guard: ถ้า `task_id` มีอยู่แล้วใน state หรือ queue → **ปฏิเสธ**

---

## 6. Lock Manager (`runtime/lock.json`)

```json
{"locked_by":"AI03","task_id":"vnx-…","acquired_at":"<ISO>","ttl_seconds":60}
```

- **Single-writer:** เฉพาะ AI03 (Developer) ที่เขียน production code
- lock หมดอายุอัตโนมัติเมื่อ `now - acquired_at > ttl`
- lock ค้าง (stale) → บันทึก `LOCK_STALE` event แล้วปลด

---

## 7. Watcher (ไม่มี daemon)

**Watcher = ขั้นตอนที่ agent รันเองทุกครั้งที่เริ่ม turn** ไม่ใช่ process:

```
watcher check:
 1. อ่าน heartbeat.json
 2. ถ้า now - heartbeat.ts > 15 นาที และ state ยังเป็น DEVELOPMENT/REVIEW
    → บันทึก STALE_TASK event, ตั้ง state = BLOCKED, last_error = "heartbeat expired"
 3. อ่าน lock.json
    → ถ้า stale → ปลด + บันทึก
 4. อ่าน state.json
    → ถ้ามี task ที่ state=DEVELOPMENT แต่ writer=null → ตั้ง BLOCKED
 5. คืนผลเป็น JSON สั้น ๆ ให้ agent ใช้ตัดสินใจ
```

**Independent ของ model inference:** ทั้งหมดเป็นการอ่านไฟล์ ไม่มีการเรียก LLM

---

## 8. Runtime Adapter

ตัวเชื่อมระหว่าง role profile กับ Harness tool:

```
1. อ่าน routing.json + state.json
2. ตรวจว่า task พร้อมให้ใครทำ
3. สร้าง handoff payload (บีบอัดตาม §10)
4. ถ้าเป็น subagent → task(prompt=handoff, ...)
5. ถ้าเป็น main → ทำเอง
6. บันทึก AGENT_INVOKED event + usage
```

---

## 9. Recovery Manager

เมื่อเริ่ม turn ถ้าพบ `runtime/recovery.json`:

```
 1. task ที่ state=DEVELOPMENT และ attempts < max → กลับเป็น QUEUED
 2. task ที่ attempts >= max → FAILED + last_error
 3. lock ค้าง → ปลด
 4. heartbeat เก่า → ล้าง
 5. บันทึก RECOVERY event
 6. ลบ recovery.json หลังสำเร็จ
```

---

## 10. Agent Handoff Protocol (บีบอัด)

**every handoff ≤ 1,500 tokens** ประกอบด้วย 9 ฟิลด์เท่านั้น:

```
TASK <task_id> | LEVEL <level> | MODEL <model>
OBJECTIVE: <1-3 บรรทัด>
RULES: <เฉพาะกฎที่เกี่ยวกับงานนี้ — อ้าง path ไม่ copy>
FILES: <path:line ที่เกี่ยวข้อง>
FINDINGS: <ข้อเท็จจริงที่ยืนยันแล้ว>
DECISIONS: <สิ่งที่ตัดสินไปแล้ว>
OPEN: <ประเด็นค้าง>
ACCEPTANCE: <เกณฑ์ที่วัดได้>
NEXT: <action ถัดไป>
```

**ห้ามส่ง:** conversation history, reasoning transcript, ไฟล์เต็ม (อ้าง path แทน)

---

## 11. Tool Profiles (prompt-level)

**ข้อจำกัดจริง:** agent filter MCP tool เองไม่ได้ (หน้า MCP = needs_user)
**สิ่งที่ทำได้:** ระบุใน prompt ของแต่ละ role ว่า "ใช้เฉพาะ tool กลุ่มนี้" และห้ามใช้กลุ่มอื่น

| Role | Tools ที่อนุญาต | จำนวน |
|------|----------------|------:|
| Planner | read_file, list_dir, grep, search_files, codegraph_*, git_status, git_log, git_diff | ~15 |
| Research | ข้างบน + web_search, web_fetch, http_request, mcp__github__search_code | ~20 |
| Developer | read/write/edit/patch, shell, git_*, pkg_*, multi_edit, move_file, create_dir | ~30 |
| QA | read_file, grep, git_diff, git_show, shell (test only), read_logcat | ~12 |

**Safety margin:** แม้Harness ส่ง 552 tools ไปทุกครั้ง แต่ prompt บอกให้แต่ละ role ใช้แค่ subset → ลด tool call ที่ไม่เกี่ยว (ซึ่งเป็นตัวกิน token จริง)

**MCP reduction ที่ต้องขออนุมัติผู้ใช้:** ปิด `vercel` (246) และ `neon` (139) เมื่อไม่ได้ทำงาน deploy/db → เหลือ 88 tools

---

## 12. Model Routing Policy (`config/model-policy.json`)

```json
{
  "default": "deepseek-flash",
  "slots": {"main": "deepseek-flash", "planning": "deepseek-flash", "subagent": "deepseek-flash"},
  "pro": {
    "enabled": false,
    "requires_user_approval": true,
    "gates": [
      "flash ล้มเหลว ≥ 2 ครั้งกับปัญหาเดียวกัน",
      "งานต้องใช้ reasoning ที่ flash ทำไม่ได้ชัดเจน",
      "คาดว่าจะได้ผลลัพธ์ที่ดีขึ้นจริง",
      "ยืนยันราคา/availability แล้ว",
      "ผู้ใช้อนุมัติ"
    ]
  }
}
```

**ห้าม** ตั้ง pro เป็น default ของ slot ใด ๆ

---

## 13. Budget Governance (`config/budget.json`)

```json
{
  "daily_usd": 0.28,
  "reference_budget_usd": 2.00,
  "warn_at_percent": 80,
  "hard_stop_at_percent": 100,
  "measured_baseline_usd_per_day": 1.98
}
```

- คำนวณจาก `logs/usage.jsonl` สะสมรายวัน
- เกิน 80% → เตือนในรายงาน
- เกิน 100% → หยุดงานใหม่ที่ไม่จำเป็น (ไม่หยุดงานที่ unsafe-to-stop)
- **ห้าม** เติม credit หรือแก้ billing

---

## 14. Usage Analytics (`tools/usage.mjs`)

อ่าน `cost-*.csv` + `amount-*.csv` แปลงเป็น `logs/usage.jsonl`:

```json
{"date":"2026-11-09","model":"deepseek-flash","requests":111,
 "in_miss":413358,"in_hit":34913536,"out":25068,
 "cache_hit_rate":98.83,"cost_usd":0.181785}
```

รายงาน: ต่อวัน, ต่อ model, ต่อ task (ถ้ามี attribution)
**ถ้า metric ไม่มีใน CSV → ระบุ `unavailable` ห้ามเดา**

---

## 15. การเปลี่ยนแปลง Configuration ที่เสนอ

### 15.1 ที่ agent ทำได้เอง (ไม่ต้องอนุมัติ)

| Setting | จาก | ไป | เหตุผล |
|---------|-----|-----|--------|
| `max_context` | 2,000,000 | **200,000** | ตรงกับ gateway จริง (tenixe 200K); ลด token ที่ส่งจริง |
| `max_iterations` | 0 | **60** | กัน loop เผาเงิน |

### 15.2 ที่ต้องอนุมัติผู้ใช้ (`needs_user`)

| รายการ | ปัจจุบัน | เสนอ | ผลประหยัด |
|--------|----------|------|-----------|
| Main model | `deepseek-v4-flash` | `deepseek-flash` | ราคาเท่ากัน — เปลี่ยนเพื่อความสม่ำเสมอของ cache |
| Subagent model | (ตรวจไม่พบ) | `deepseek-flash` | — |
| ปิด MCP `vercel` | 246 tools | ปิดเมื่อไม่ deploy | ลด schema |
| ปิด MCP `neon` | 139 tools | ปิดเมื่อไม่ทำงาน DB | ลด schema |
| หลีกเลี่ยง `deepseek-v4-pro` | ใช้อยู่ 26 req/วัน | ใช้เฉพาะเมื่ออนุมัติ | **−$1.40/วัน (−70.6%)** |

---

## 16. Backup Plan (Phase 3)

ก่อนแก้อะไร สำรอง:

```
.ai-office/backup/2026-11-09-pre-optimization/
├── settings-snapshot.json      ← ค่า app_settings_find ทั้งหมด
├── task-controls-snapshot.json ← provider/model ที่ใช้จริง
├── mcp-snapshot.json           ← mcp-status.json
├── office-files.txt            ← sha256 ของ .ai/office/**
└── ROLLBACK.md                 ← ขั้นตอนย้อนกลับ
```

ใช้ `write_file` (ไม่ใช้ `cp` เพื่อความชัดเจนว่าเป็น artifact ที่ตั้งใจสร้าง)

---

## 17. Rollback Procedure

| การเปลี่ยนแปลง | วิธีย้อน |
|----------------|---------|
| `max_context` 200K | `app_settings_change` กลับเป็น 2000000 |
| `max_iterations` 60 | `app_settings_change` กลับเป็น 0 |
| Model assignment | ผู้ใช้ตั้งคืนที่หน้า MODELS |
| MCP servers | ผู้ใช้เปิดคืนที่หน้า MCP |
| ไฟล์ `.ai-office/**` | `rm -rf .ai-office` (ไม่ได้ track ใน git) หรือ `git checkout .ai-office` ถ้า commit แล้ว |

**ไม่มีการแตะ `.ai/office/**`, `.ai/AI_HANDOFF.md`, production code → ไม่ต้อง rollback ส่วนนั้น**

---

## 18. สิ่งที่ออกแบบนี้ "ไม่ทำ"

| ไม่ทำ | เหตุผล |
|-------|--------|
| สร้าง 4 concurrent agent | Harness ทำไม่ได้ |
| แก้ `.ai/office/` | คงของเดิมตามกฎ |
| แก้ production code | อยู่นอกขอบเขต |
| สร้าง daemon/watcher process | รอด app kill ไม่ได้ |
| แก้ `.ai/AI_HANDOFF.md` ที่มีไฟล์แก้ค้าง | มี uncommitted work ของผู้ใช้ |
| สร้าง `harness.json` | ไม่รู้ schema — ห้ามเดา |
| ตั้ง `deepseek-v4-pro` เป็น default | ผิดนโยบายต้นทุน |

---

## 19. ผลลัพธ์ที่คาดหวัง (คาดการณ์ ไม่ใช่การรับประกัน)

| Metric | ก่อน | เป้าหมาย |
|--------|------|----------|
| ต้นทุน/วัน | $1.9801 | ≤ $0.58 (−70.6%) |
| pro requests | 26/วัน | 0 (เว้นแต่ escalate) |
| flash cache hit | 98.83% | ≥ 95% |
| Tool ที่โหลด | 552 | ≤ 140 (ถ้าปิด vercel+neon) |
| Usage attribution | ไม่มี | ต่อ model ต่อวัน |
| Retry loop | ไม่จำกัด | max 2 + iterations 60 |

**หมายเหตุ:** ตัวเลขเป้าหมายมาจากการคำนวณ baseline จริง + จำลองการย้าย pro→flash เท่านั้น ไม่ใช่การรับประกันว่าจะได้ผลจริง ต้องวัดซ้ำใน Phase 6

---

**จบ Phase 2** — รอการอนุมัติเพื่อเข้าสู่ Phase 3 (Backup) และ Phase 4 (Implement)
