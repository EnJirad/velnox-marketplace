# TEST_REPORT.md — Velnox AI Office 2.0

**วันที่รัน:** 2026-11-09
**ผู้รัน:** AI 01
**วิธี:** รันคำสั่งจริงทุกข้อ อ้าง exit code และ output จริง
**ห้ามอ่านรายงานนี้ว่า "ผ่าน" หากไม่มีหลักฐานในตาราง**

---

## สรุปผล

| ชุดทดสอบ | ผ่าน | ไม่ผ่าน | หมายเหตุ |
|----------|-----:|--------:|----------|
| Self-check (`verify.mjs`) | **16** | 0 | T01–T16 |
| Functional test (state machine) | **22** | 0 | ดู §2 |
| Routing test | **11** | 0 | ดู §3 |
| Usage reconciliation | **2/2 model** | 0 | กระทบยอดตรง CSV |
| Settings change | **2/2** | 0 | ยืนยันด้วย `app_settings_find` |
| **รวมที่ทดสอบได้** | **53** | **0** | |

**ยังทดสอบไม่ได้:** ต้นทุนจริงหลังเปลี่ยน model (ต้องใช้หลายวัน), tool schema จริงต่อ request (Harness ไม่เปิด), คุณภาพงานเทียบ pro

---

## 1. Self-check — `node .ai-office/tools/verify.mjs`

**คำสั่ง:** `node .ai-office/tools/verify.mjs`
**Exit code:** `0` (PASS)

```
"summary": { "total": 16, "pass": 16, "fail": 0 }
```

| ID | การทดสอบ | ผล | หลักฐาน |
|----|----------|:---:|---------|
| T01 | โครงสร้างโฟลเดอร์ครบ 6 | PASS | `6/6` |
| T02 | agent profile ครบ 4 ตัว | PASS | `4 found` |
| T03 | config JSON 4 ไฟล์ parse ได้ | PASS | `4/4 valid` |
| T04 | ทุก slot = flash | PASS | `default=deepseek-flash` |
| T05 | pro escalation มี gate + ต้องอนุมัติ | PASS | `gates=5, approval=true, default_is_pro=false` |
| T06 | state machine ปฏิเสธ transition ผิด | PASS | `QUEUED->COMPLETED=rejected; COMPLETED->DEV=rejected; QUEUED->BOGUS=rejected; QUEUED->DEV=ok` |
| T07 | PLANNING->DEV บังคับ acceptance criteria | PASS | `without=rejected; with=ok` |
| T08 | FAILED->QUEUED ปฏิเสธเมื่อ attempts ครบ | PASS | `attempts=2/2 → rejected; 1/2 → ok` |
| T09 | tool profile ครบ 4 role | PASS | `4 roles` |
| T10 | single-writer: เฉพาะ developer มี write tool | PASS | `writers=["developer"]` |
| T11 | usage.jsonl มีข้อมูล | PASS | `2 record(s)` |
| T12 | backup ครบ | PASS | `4 files` |
| T13 | backup ไม่มี secret | PASS | `clean` |
| T14 | `.ai/office` ไม่ถูกแก้ไข (sha256) | PASS | `63/63 files OK` |
| T15 | routing ครบ 6 ระดับ | PASS | `6 levels` |
| T16 | budget กำหนด retry limit | PASS | `implementation_retries_per_task=2, identical_request_retries=0` |

**หมายเหตุ T14:** รอบแรก FAIL ด้วย `spawnSync ... ENOENT` (เรียก shell ไม่ได้บนเครื่องนี้)
แก้โดยคำนวณ sha256 ด้วย `node:crypto` แทน `execSync` → ผ่านจริงในรอบที่ 2

---

## 2. Functional test — State Manager (`state.mjs`)

### 2.1 State machine gate

| # | การทดสอบ | คำสั่ง | ผลที่คาด | ผลจริง | สถานะ |
|---|----------|--------|----------|--------|:-----:|
| 1 | สร้าง task | `create vnx-20261109-001` | ok | `ok:true` | PASS |
| 2 | สร้างซ้ำ (duplicate) | `create vnx-20261109-001` | ปฏิเสธ | `task exists: vnx-20261109-001` | PASS |
| 3 | QUEUED→COMPLETED | `move ... COMPLETED` | ปฏิเสธ | `illegal transition QUEUED -> COMPLETED` | PASS |
| 4 | QUEUED→PLANNING | `move ... PLANNING` | ผ่าน | `ok, QUEUED→PLANNING` | PASS |
| 5 | PLANNING→DEV ไม่มี criteria | `move ... DEVELOPMENT` | ปฏิเสธ | `requires acceptance_criteria >= 1` | PASS |
| 6 | PLANNING→DEV มี criteria | หลังเพิ่ม criteria | ผ่าน | `ok, PLANNING→DEVELOPMENT` | PASS |
| 7 | DEV→REVIEW ไม่มี files_touched | `move ... REVIEW` | ปฏิเสธ | `requires files_touched or last_error` | PASS |
| 8 | DEV→REVIEW มี files_touched | หลังเพิ่ม | ผ่าน | `ok` | PASS |
| 9 | REVIEW→DEV ไม่มี qa_feedback | `move ... DEVELOPMENT` | ปฏิเสธ | `(FAIL) requires qa_feedback` | PASS |
| 10 | REVIEW→TESTING | `move ... TESTING` | ผ่าน | `ok` | PASS |
| 11 | TESTING→COMPLETED ไม่มี evidence | `move ... COMPLETED` | ปฏิเสธ | `requires handoff.test_evidence` | PASS |
| 12 | TESTING→COMPLETED มี evidence | หลังเพิ่ม | ผ่าน | `ok` | PASS |
| 13 | COMPLETED→DEVELOPMENT | `move ... DEVELOPMENT` | ปฏิเสธ | `illegal transition COMPLETED -> DEVELOPMENT` | PASS |

### 2.2 Retry limit

| # | การทดสอบ | ผลจริง | สถานะ |
|---|----------|--------|:-----:|
| 14 | QUEUED→DEV→FAILED | `ok` ทั้ง 3 ขั้น | PASS |
| 15 | FAILED→QUEUED (attempts=0) | `ok, FAILED→QUEUED` | PASS |
| 16 | FAILED→QUEUED (attempts=2/2) | `refused: attempts 2 >= max 2` | PASS |

### 2.3 Lock / single-writer

| # | การทดสอบ | ผลจริง | สถานะ |
|---|----------|--------|:-----:|
| 17 | AI03 ถือ lock | `ok:true` | PASS |
| 18 | AI04 ขอ lock ขณะ AI03 ถือ | `lock held by AI03 (0s)` | PASS |
| 19 | AI04 ปลด lock ของ AI03 | `not owner (AI03)` | PASS |
| 20 | AI03 ปลด lock ตัวเอง | `ok:true` | PASS |
| 21 | stale lock (age 1 ชม., ttl 60s) | `[{kind:"STALE_LOCK", holder:"AI03", age_ms:3600322}]` | PASS |

### 2.4 Queue / duplicate

| # | การทดสอบ | ผลจริง | สถานะ |
|---|----------|--------|:-----:|
| 22 | enqueue 2 task | `queue_length:1` แล้ว `2` | PASS |
| 23 | enqueue task_id ซ้ำ | `duplicate task_id: vnx-20261109-003` | PASS |

### 2.5 Persistence (จำลอง restart)

อ่านไฟล์ใหม่ใน process ใหม่ (ไม่ใช่ in-memory):

```
{"task":"vnx-20261109-001","state":"COMPLETED","history_len":5}
queue: ["vnx-20261109-003","vnx-20261109-004"]
```

→ task state, history 5 รายการ, และ queue อยู่รอดหลัง process จบ **PASS**

---

## 3. Routing test — `route.mjs`

| # | คำอธิบายงาน | ไฟล์ | level ที่ได้ | agents | ถูกต้อง? |
|---|-------------|------|--------------|--------|:--------:|
| 1 | แก้ typo ข้อความ | – | `small` | developer | ✅ |
| 2 | ปรับ padding การ์ดสินค้า | ProductCard.tsx | `small` | developer | ✅ |
| 3 | แก้บั๊กปุ่ม checkout | ShopCheckout.tsx | `bugfix` | developer, qa | ✅ |
| 4 | แก้บั๊กหน้า login ค้าง | – | `bugfix` | developer, qa | ✅ |
| 5 | error ใน console | – | `bugfix` | developer, qa | ✅ |
| 6 | เพิ่มฟีเจอร์ wishlist sync | – | `feature` | planner, developer, qa | ✅ |
| 7 | เพิ่ม column ตาราง orders | db/schema.sql | `migration` | planner, research, developer, qa | ✅ |
| 8 | ไม่รู้สาเหตุ session หลุด | – | `debug` | research, developer, qa | ✅ |
| 9 | restructure data flow checkout | – | `architecture` | planner, research, developer, qa | ✅ |
| 10 | แก้ auth refresh token | backend/routes/auth.ts | `bugfix` | developer, qa | ✅ |
| 11 | แก้ typo (ซ้ำ ยืนยัน) | – | `small` | developer | ✅ |

**บั๊กที่พบและแก้ระหว่างทดสอบ:**
รอบแรก "แก้บั๊กที่ปุ่ม checkout กดไม่ได้" ถูกจัดเป็น `feature` เพราะ `routing.json`
ไม่มี `bugfix_keywords` เลย — เพิ่ม `["บั๊ก","bug","แก้บั๊ก","ผิดพลาด","พัง","ไม่ทำงาน","error","exception","regression","กดไม่ได้","ค้าง"]`
และเพิ่มเงื่อนไขใน `route.mjs` → ผ่านในรอบที่ 2 (เคส 3,4,5)

---

## 4. Usage reconciliation — `usage.mjs`

**คำสั่ง:** `node .ai-office/tools/usage.mjs`
**Exit code:** `0`

| Model | Requests | Cache Hit | Cache Miss | Output | Hit rate | คำนวณได้ | CSV ระบุ | ตรง? |
|-------|---------:|----------:|-----------:|-------:|---------:|---------:|---------:|:----:|
| deepseek-flash | 111 | 34,913,536 | 413,358 | 25,068 | 98.83% | $0.181785 | $0.1817851080 | ✅ |
| deepseek-v4-pro | 26 | 4,720,000 | 2,529,557 | 12,614 | 65.11% | $1.798323 | $1.79832334 | ✅ |
| **รวม** | **137** | | | | | **$1.980108** | | ✅ |

`"all_reconcile": true`

**บั๊กที่พบและแก้ระหว่างทดสอบ:**
รอบแรกคำนวณได้ $0.000002 เพราะหาร 1e6 โดยที่คอลัมน์ `price` ใน CSV เป็นราคา **ต่อ 1 token** อยู่แล้ว
แก้เป็น `tokens * price` ตรง ๆ → กระทบยอดตรง 2/2 model

### 4.1 ความไม่สอดคล้องของข้อมูลที่ต้องรายงาน

| รายการ | ค่า |
|--------|-----|
| ชื่อไฟล์ | `cost-2026-10-11_2026-11-09.csv` (ช่วง 30 วัน) |
| เนื้อหาจริง | `2026-11-09` วันเดียว |
| ผลกระทบ | ห้ามตีความเป็นค่าเฉลี่ย 30 วัน |

### 4.2 Dashboard comparison

**สถานะ: BLOCKED** — ไม่มีช่องทางเข้าถึง provider usage dashboard จาก environment นี้
(ไม่มี MCP billing/usage, ไม่มี credential) จึงยืนยันได้เฉพาะตัวเลข CSV

---

## 5. Settings change verification

**คำสั่ง:** `app_settings_change` → `app_settings_find` เพื่อยืนยัน

| Setting | ก่อน | หลัง | ยืนยัน |
|---------|------|------|:------:|
| `max_context` | `2000000` | `200000` | ✅ อ่านค่ากลับได้ `200000` |
| `max_iterations` | `0` | `60` | ✅ อ่านค่ากลับได้ `60` |

ค่าอื่นไม่เปลี่ยน: `dual_planning=false`, `subagent_action_tools=true`,
`background_subagents=true`, `repo_map=true`, `steering=AH_AUTO`, `permission_mode=FULL_ACCESS`

---

## 6. Benchmark — `benchmark.mjs`

### 6.1 [MEASURED] จากข้อมูลจริง

| Model | Requests | Hit rate | ต้นทุน |
|-------|---------:|---------:|-------:|
| deepseek-flash | 111 | 98.83% | $0.181785 |
| deepseek-v4-pro | 26 | 65.11% | $1.798323 |
| **รวม** | **137** | | **$1.980108** |

### 6.2 [PROJECTED] ย้าย workload pro → flash

| รายการ | ค่า |
|--------|-----|
| pro ต้นทุนจริง | $1.798323 |
| workload เดียวกันบน flash | $0.401162 |
| ประหยัด | **$1.397161** |
| ยอดรวมใหม่ | **$0.582947** |
| ลดลง | **70.6%** |

**สมมติฐาน:** 100% ของ workload pro ย้ายไป flash ด้วยราคา flash และจำนวน token เท่าเดิม
**นี่คือการคำนวณ ไม่ใช่ผลที่วัดได้** — ต้องเก็บข้อมูลจริงหลายวันหลังใช้งาน

### 6.3 เทียบกับเป้าหมาย

| รายการ | ค่า |
|--------|-----|
| daily target | $0.28 |
| projected | $0.582947 |
| projected / target | **2.08 เท่า** |
| บรรลุเป้าหมาย? | ❌ **ยังไม่** |

**ข้อสรุปตรงไปตรงมา:** การเลิกใช้ pro ลดได้ 70.6% แต่ยังไม่ถึงเป้า $0.28/วัน
ต้องลด token ต่อ request หรือจำนวน request เพิ่มอีก

### 6.4 [MEASURED] น้ำหนัก prompt

| ไฟล์ | tokens |
|------|-------:|
| old developer.md | 1146 |
| old architect.md | 1098 |
| new 01-planner.md | 873 |
| new 02-research.md | 1075 |
| new 03-developer.md | 1304 |
| new 04-qa.md | 1239 |

**ผลตรงไปตรงมา: ค่าเฉลี่ยเท่าเดิม (1122 tokens)** — role ใหม่ไม่ได้เล็กกว่าเดิม
ประโยชน์ที่ได้จากการแยก role คือ **เลือกเรียกเฉพาะ role ที่จำเป็น** ไม่ใช่ prompt ที่สั้นลง

---

## 7. สิ่งที่ทดสอบไม่ได้ (NOT VERIFIED / BLOCKED)

| # | รายการ | สถานะ | เหตุผล |
|---|--------|-------|--------|
| 1 | ต้นทุนจริงหลังเปลี่ยนเป็น flash | **NOT VERIFIED** | ต้องเก็บข้อมูลหลายวันหลังใช้งานจริง |
| 2 | จำนวน tool schema ต่อ request | **NOT VERIFIED** | Harness ไม่เปิดให้ inspect payload |
| 3 | การลด tool ลงต่ำกว่า 128 | **BLOCKED** | หน้า MCP เป็น `needs_user` — agent ทำไม่ได้ |
| 4 | คุณภาพงาน flash เทียบ pro | **NOT VERIFIED** | ต้องรันงานเดียวกันคู่ขนาน |
| 5 | เปรียบเทียบ provider dashboard | **BLOCKED** | เข้าไม่ถึง dashboard |
| 6 | Four-agent concurrency จริง | **NOT APPLICABLE** | Harness มี 2 execution slot — ระบบนี้ออกแบบเป็น sequential ตามข้อจำกัด |
| 7 | `background_subagents` ทำงานข้าม app kill | **NOT VERIFIED** | ต้องทดสอบด้วยการ kill app จริง |

---

## 8. ข้อบกพร่องที่พบระหว่างทดสอบและแก้แล้ว

| # | ปัญหา | ไฟล์ | การแก้ | ยืนยัน |
|---|-------|------|--------|:------:|
| 1 | `verify.mjs` ใช้ `require` ใน ESM | tools/verify.mjs | เขียนใหม่เป็น ESM + top-level await | T14 ผ่าน |
| 2 | `execSync` หา shell ไม่ได้ (`spawnSync ENOENT`) | tools/verify.mjs | เปลี่ยนเป็น `node:crypto` คำนวณ sha256 เอง | T14 ผ่าน 63/63 |
| 3 | `usage.mjs` คำนวณต้นทุนผิด (หาร 1e6 ซ้ำ) | tools/usage.mjs | CSV price เป็น per-token → คูณตรง | กระทบยอด true |
| 4 | `check()` เป็น sync แต่ T06/T07 เป็น async | tools/verify.mjs | เขียนใหม่ให้ import module ที่ top-level | 16/16 |
| 5 | ทดสอบแล้ว copy `mcp-servers.json` (มี token) เข้า workspace | backup/ | ลบทิ้งทันที + เขียนใหม่เฉพาะ name/host | T13 = clean |
| 6 | routing ไม่มี `bugfix_keywords` | config/routing.json + tools/route.mjs | เพิ่ม keyword + เงื่อนไข | เคส 3,4,5 ผ่าน |

---

## 9. ข้อจำกัดที่ยังเหลือ

1. **Single-writer บังคับได้ที่ระดับ config/prompt เท่านั้น** — ไม่มีการบังคับที่ runtime
   เพราะ Harness ไม่มี API ให้บล็อก tool ของ subagent
2. **Lock TTL 60 วินาที** อาจสั้นเกินสำหรับงานที่ใช้เวลานาน — ต้องต่อ TTL ด้วยมือ
3. **Event log ไม่ใช่ atomic append จริง** — ใช้ read+write ภายใต้ lock; ถ้า process ตายกลางอาจเสียบรรทัดสุดท้าย
4. **Watcher ทำงานเฉพาะเมื่อ agent ถูกเรียก** — ไม่มี daemon ตรวจจับเอง
5. **ไม่มีการทดสอบด้วย multi-day data** — ตัวเลขทั้งหมดมาจากวันเดียว
