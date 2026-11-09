# IMPLEMENTATION.md — Velnox AI Office 2.0

**วันที่:** 2026-11-09
**ขอบเขต:** AI Office optimization เท่านั้น — ไม่แตะ production code
**สถานะ:** Phase 1–7 เสร็จสมบูรณ์ (มีข้อจำกัดตาม §8)

---

## 1. สถาปัตยกรรมเดิมที่พบ (สรุปจาก AUDIT_REPORT.md)

| รายการ | สภาพจริง |
|--------|----------|
| AI Office | TypeScript library + เอกสาร **ไม่มี runtime process** |
| Modules | 18 ไฟล์ `.ts` ไม่ถูก import/execute ที่ไหนเลย |
| Agent | **2 ตัว** (developer + architect ที่รวม Planner+QA) |
| Model | `deepseek-v4-flash` (Tenixe), `DeepSeek-V4-Flash-0731` (Aiunlimit) |
| MCP tools | 473 connected + 79 builtin = **552** |
| State/Queue/Lock/Event | **ไม่มีเลย** |
| Usage tracking | ไม่มี — ข้อมูลอยู่แค่ CSV จาก provider |
| ต้นทุนจริง | $1.980108/วัน (2026-11-09) โดย pro กิน 90.8% |

### ปัญหาวิกฤต 3 ข้อ

1. `max_context = 2,000,000` เกินขีดจำกัด gateway จริง (200,000) **10 เท่า**
2. `deepseek-v4-pro` ถูกใช้เป็นงานประจำ — 26 requests แต่กิน 90.8% ของเงิน
3. `max_iterations = 0` ไม่มีเพดานกัน loop

---

## 2. สถาปัตยกรรมใหม่

```
.ai-office/
├── agents/          4 role profile (prompt-level, sequential)
│   ├── 01-planner.md       873 tokens   read-only
│   ├── 02-research.md    1,075 tokens   read-only  (ใหม่ — ไม่มีในระบบเดิม)
│   ├── 03-developer.md   1,304 tokens   single writer
│   └── 04-qa.md          1,239 tokens   read-only  (แยกจาก architect)
│
├── config/
│   ├── routing.json        6 ระดับงาน → เลือก agent
│   ├── model-policy.json   flash default, pro escalation gate 5 ข้อ
│   ├── tool-profiles.json  tool ต่อ role + ข้อจำกัดที่ยืนยันแล้ว
│   └── budget.json         daily target + retry limits
│
├── runtime/                state.json · lock.json · heartbeat.json
├── queue/tasks.json
├── logs/                   events.jsonl · usage.jsonl
│
└── tools/
    ├── state.mjs      10.3 KB  state machine + lock + queue + watcher
    ├── route.mjs       3.5 KB  task classifier
    ├── usage.mjs       6.1 KB  CSV → usage.jsonl + cache rate
    ├── verify.mjs      7.8 KB  self-check 16 ข้อ
    └── benchmark.mjs   4.4 KB  before/after + projection
```

### หลักการสำคัญ

| หลักการ | การนำไปใช้ |
|---------|-----------|
| File-based ไม่มี daemon | ทุก state เป็น JSON/JSONL; Watcher คือ tool-loop probe |
| Sequential ไม่ใช่ concurrent | Harness มี 2 execution slot เท่านั้น |
| Single writer | เฉพาะ `03-developer` มี write tool (บังคับระดับ config) |
| State manager เป็น authority เดียว | ทุก transition ผ่าน `validateTransition()` |
| Atomic write | tmp → rename + lock TTL 60s |

---

## 3. Agent Responsibility Matrix

| Agent | บทบาท | เขียนโค้ด? | Model | Tools โดยประมาณ |
|-------|-------|:----------:|-------|----------------:|
| **AI 01 Planner** | วางแผน + acceptance criteria | ❌ | deepseek-flash | 11 |
| **AI 02 Research** | สืบสวน root cause + หลักฐาน | ❌ | deepseek-flash | 19 |
| **AI 03 Developer** | ลงมือแก้โค้ด | ✅ **เท่านั้น** | deepseek-flash | 28 |
| **AI 04 QA** | ตรวจ diff + รัน test | ❌ | deepseek-flash | 14 |
| **Main (Coordinator)** | ถือ state, route, handoff | ⚠️ งาน small เท่านั้น | deepseek-flash | ตามงาน |

**การเปลี่ยนแปลงจากระบบเดิม:**
- เดิม AI 02 = Planner + QA รวมกัน → แยกเป็น AI 01 Planner และ AI 04 QA
- **เพิ่ม AI 02 Research** (role ใหม่) เพื่อดึงงานสืบสวนออกจาก pro
- **คงไฟล์เดิม `.ai/office/agents/` ไว้ทั้งหมด** — ไม่ลบ ไม่แก้

---

## 4. Model Routing

```json
"default_model": "deepseek-flash",
"slots": { "main":"deepseek-flash", "planning":"deepseek-flash",
           "subagent":"deepseek-flash", "research":"deepseek-flash", "qa":"deepseek-flash" }
```

### Pro escalation — gate 5 ข้อ (ต้องผ่านทั้งหมด)

1. flash ล้มเหลว ≥ 2 ครั้งกับปัญหาเดียวกัน
2. พิสูจน์ได้ว่าต้องใช้ reasoning ที่ flash ทำไม่ได้
3. คาดว่าจะได้ผลดีขึ้นจริง ไม่ใช่ "อาจจะดีกว่า"
4. ยืนยันราคา/availability แล้ว
5. ได้รับอนุมัติจากผู้ใช้

ต้องอธิบายก่อน escalate: ทำไม flash ไม่พอ · pro จะแก้อะไร · ค่าใช้จ่ายเพิ่มเท่าไร

**ราคาที่ตรวจสอบแล้ว (จาก `models-dev.json`):**

| Model | input | cache_read | output | แพงกว่า flash |
|-------|------:|-----------:|-------:|--------------:|
| deepseek-flash | $0.15/M | $0.003/M | $0.60/M | — |
| deepseek-v4-pro | $0.66/M | $0.022/M | $1.98/M | 4.4× / 7.3× / 3.3× |

---

## 5. Tool Profiles

**ข้อจำกัดที่ยืนยันแล้ว:** agent **ไม่สามารถ** filter MCP tool ได้ — หน้า MCP ใน Settings เป็น `needs_user`

| Role | Tool ที่อนุญาต | ห้าม |
|------|---------------|------|
| Planner | 11 ตัว (read/grep/codegraph/git-read) | write, shell, MCP ทั้งหมด |
| Research | 19 ตัว (+ web_search, http_request, read_logcat) | write, shell_background, MCP deploy |
| Developer | 28 ตัว (write/edit/patch/shell/git_commit/pkg) | git_push, vercel/render/cloudflare |
| QA | 14 ตัว (diff/test/logs, shell เฉพาะ test) | write ทุกชนิด, git_commit |

### เส้นทางลด tool ลงต่ำกว่า 128 (ต้องผู้ใช้ทำ)

```
ปิด vercel(246) + neon(139) + render(28) + stripe(10) + cloudflare(4)
→ เหลือ github 46 + builtin 79 = 125 < 128  ✅
```

agent ทำขั้นนี้เองไม่ได้ — ต้องแจ้งผู้ใช้

---

## 6. การ Optimize Context

implement ผ่าน 3 ชั้น:

| ชั้น | เนื้อหา | ที่เก็บ |
|------|---------|---------|
| **A Stable** | agent profile + กฎโปรเจค | `.ai-office/agents/*.md` (คงที่ ไม่เปลี่ยนต่อ task) |
| **B Task** | task_id, objective, files, criteria | handoff payload `
≤1,500 tokens` |
| **C Runtime** | tool results, errors, test output | อยู่ใน conversation ตามธรรมชาติ |

**handoff format บังคับ 9 ฟิลด์** — ห้ามส่ง reasoning/transcript/ไฟล์เต็ม (อ้าง path แทน)

---

## 7. Cache Efficiency

### [MEASURED] 2026-11-09

| Model | Cache Hit tokens | Cache Miss tokens | Hit rate |
|-------|-----------------:|------------------:|---------:|
| deepseek-flash | 34,913,536 | 413,358 | **98.83%** |
| deepseek-v4-pro | 4,720,000 | 2,529,557 | **65.11%** |

**การตีความ:**
- flash ใช้ cache ได้ดีมาก (98.83%) — prompt prefix เสถียร
- pro แย่กว่า 33.7 จุด → prefix เปลี่ยนทุกครั้ง → จ่ายที่ราคา cache miss ($0.66/M)
- cache miss ของ pro 2,529,557 tokens = **$1.6695 = 84.3% ของค่าใช้จ่ายทั้งวัน**

**มาตรการที่ใช้:** คง stable prefix (agent profile) ให้เหมือนเดิมทุกครั้ง, วาง task content ไว้หลัง stable block, ห้ามใส่ timestamp/random id ใน stable prefix

**ยืนยันได้แค่จาก CSV** — provider dashboard เข้าไม่ถึง (BLOCKED)

---

## 8. Configuration Changes

### 8.1 เปลี่ยนแล้ว (ยืนยันด้วย `app_settings_find`)

| Setting | ก่อน | หลัง | เหตุผล |
|---------|------|------|--------|
| `max_context` | `2,000,000` | **`200,000`** | ตรงกับ gateway จริง; ลด token ที่ส่งจริง |
| `max_iterations` | `0` (ไม่จำกัด) | **`60`** | กัน loop เผาเงิน |

### 8.2 ยังไม่ได้เปลี่ยน — ต้องผู้ใช้ทำที่ Settings

| รายการ | หน้า | ผล |
|--------|------|-----|
| default model ทุก slot → `deepseek-flash` | MODELS | — |
| หลีกเลี่ยง `deepseek-v4-pro` | MODELS | **−$1.40/วัน** |
| ปิด MCP `vercel` (246 tools) | MCP | tool ≤ 128 |
| ปิด MCP `neon` (139 tools) | MCP | tool ≤ 128 |

**เหตุผลที่ agent ทำเองไม่ได้:** ทั้งสองหน้าเป็น `needs_user` ตาม schema ของ `app_settings_change`

---

## 9. ผลลัพธ์ที่วัดได้ vs คาดการณ์

| Metric | ก่อน [MEASURED] | หลัง [PROJECTED] | สถานะ |
|--------|----------------:|-----------------:|--------|
| ต้นทุน/วัน | $1.980108 | $0.582947 | PROJECTED −70.6% |
| pro requests/วัน | 26 | 0 | PROJECTED |
| flash cache hit | 98.83% | ≥98.83% | คงเดิม |
| Tool ที่โหลด | 552 | 552 (ยังไม่ลด) | BLOCKED — needs_user |
| max_context | 2,000,000 | **200,000** | ✅ VERIFIED |
| max_iterations | 0 | **60** | ✅ VERIFIED |
| State/Event/Queue/Lock | ไม่มี | มี (ทดสอบแล้ว) | ✅ VERIFIED |
| Usage attribution | ไม่มี | ต่อ model/วัน | ✅ VERIFIED |

**เป้าหมาย $0.28/วัน — ยังไม่บรรลุ**: projected $0.582947 = **2.08 เท่าของเป้า**

---

## 10. ไฟล์ที่สร้าง (27 ไฟล์)

```
.ai-office/AUDIT_REPORT.md          DISCOVERY.md (งานก่อน)
.ai-office/DESIGN.md                ROLLBACK.md
.ai-office/IMPLEMENTATION.md        TEST_REPORT.md
.ai-office/agents/01-planner.md     02-research.md  03-developer.md  04-qa.md
.ai-office/config/routing.json      model-policy.json  tool-profiles.json  budget.json
.ai-office/tools/state.mjs          route.mjs  usage.mjs  verify.mjs  benchmark.mjs
.ai-office/logs/usage.jsonl         runtime/state.json  runtime/lock.json(deleted)
.ai-office/queue/tasks.json
.ai-office/backup/2026-11-09-pre-optimization/ (4 ไฟล์)
```

**ไฟล์ที่แก้ไข:** `routing.json` (+bugfix_keywords), `route.mjs` (+เงื่อนไข), `usage.mjs` (แก้หน่วยราคา), `verify.mjs` (เขียนใหม่ 2 รอบ)

**ไฟล์ที่ "ไม่แตะ" (พิสูจน์ด้วย sha256):** `.ai/office/**` 63/63 OK

---

## 11. Git

| รายการ | ค่า |
|--------|-----|
| Branch | `main` |
| HEAD ก่อนงาน | `73fff9c` |
| origin/main | `73fff9c` (ตรงกัน) |
| สถานะ `.ai-office/` | **untracked** (ไม่ commit) |
| ไฟล์ production ที่แตะ | **ไม่มี** |

**ยังไม่ commit** — `.ai-office/` เป็น untracked และ working tree มีไฟล์ค้างของผู้ใช้ 13 ไฟล์
การ commit ต้องได้รับการอนุมัติแยก (ไม่ควรปนกับงานค้างของผู้ใช้)

---

## 12. ข้อจำกัดที่ยังเหลือ

| # | ข้อจำกัด | ผลกระทบ | ทางแก้ |
|---|----------|---------|--------|
| 1 | Single-writer บังคับได้แค่ระดับ config | agent อาจยังเขียนทับกันได้ | Harness ไม่มี API ให้บล็อก — ต้องพึ่งวินัยของ prompt |
| 2 | Lock TTL 60s | งานยาวอาจถูกมองว่า stale | ต่อ TTL ด้วยมือเมื่องานยาว |
| 3 | Event log ไม่ atomic จริง | process ตายอาจเสียบรรทัดสุดท้าย | ยอมรับได้ (log ไม่ใช่ source of truth) |
| 4 | Watcher ไม่มี daemon | ต้องมี agent ถูกเรียกถึงจะตรวจ | ตามข้อจำกัด Harness |
| 5 | Tool count 552 ยังเกิน 128 | อาจ error ถ้า Harness ส่งทั้งหมด | ต้องผู้ใช้ปิด MCP |
| 6 | ข้อมูล usage มีวันเดียว | ไม่มีแนวโน้ม | เก็บต่อเนื่องหลายวัน |
| 7 | ยังไม่ถึงเป้า $0.28/วัน | ต้นทุนยังสูงกว่าเป้า 2.08 เท่า | ต้องลด request/token เพิ่ม |

---

## 13. ขั้นตอนถัดไปที่แนะนำ

1. **ผู้ใช้:** Settings → MODELS → ตั้ง `deepseek-flash` ทุก slot, เลิกใช้ `deepseek-v4-pro`
2. **ผู้ใช้:** Settings → MCP → ปิด `vercel`, `neon`, `render`, `stripe-sandbox`, `cloudflare` เมื่อไม่ใช้
3. **เก็บข้อมูล 3–7 วัน** แล้วรัน `node .ai-office/tools/benchmark.mjs` เทียบผลจริง
4. **ตัดสินใจ:** commit `.ai-office/` หรือเพิ่มเข้า `.gitignore`
5. ถ้าต้องลดต้นทุนอีก: วิเคราะห์ว่าทำไมถึง 137 requests/วัน และ 34.9M cache-hit tokens/วัน

---

## 14. Rollback

ดู `.ai-office/ROLLBACK.md` — สรุปสั้น:

```
app_settings_change: max_context=2000000, max_iterations=0
rm -rf .ai-office/{agents,config,runtime,queue,logs,tools}
```

`.ai/office/**` และ production code ไม่ถูกแตะ → ไม่ต้อง rollback
