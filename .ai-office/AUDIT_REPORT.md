# AUDIT_REPORT.md — Velnox AI Office 2.0 (Phase 1)

**วันที่ตรวจ:** 2026-11-09
**ผู้ตรวจ:** AI 01 (Main Agent)
**ขอบเขต:** Audit เท่านั้น — ยังไม่มีการแก้ไข configuration ใด ๆ
**สถานะ:** Phase 1 เสร็จสมบูรณ์ พร้อมส่งต่อ Phase 2

---

## 0. สรุปผู้บริหาร (Executive Summary)

| หัวข้อ | ผล |
|--------|-----|
| AI Office ที่ติดตั้งจริง | เป็น **TypeScript library + เอกสาร** ไม่มี runtime process ทำงาน |
| จำนวน Agent ที่มีจริง | **2** (developer + architect) ไม่ใช่ 4 |
| MCP tools ที่โหลดอยู่ | **473** + built-in **79** = **552** — เกิน 128 limit |
| Model ที่ใช้จริง | `deepseek-v4-flash` (Tenixe) และ `DeepSeek-V4-Flash-0731` (Aiunlimit) |
| ค่าใช้จ่ายวันที่ตรวจ | **$1.9801** / วัน (จาก CSV จริง) |
| สาเหตุหลักของค่าใช้จ่าย | **`deepseek-v4-pro` = 19% ของ request แต่กิน 90.8% ของเงิน** |
| การลดต้นทุนที่เป็นไปได้ | **−70.6%** ถ้าย้ายงาน pro ไป flash (คำนวณจากข้อมูลจริง) |
| max_context ที่ตั้งไว้ | 2,000,000 แต่ model รับได้ 1,048,576 และ gateway รับได้ 200,000 |
| สถานะ working tree | **มีไฟล์แก้ค้าง 13 ไฟล์** — ห้ามแตะ |

---

## 1. สภาพแวดล้อม Android Harness

| รายการ | ค่าที่ตรวจได้ | วิธีตรวจ |
|--------|--------------|----------|
| Android | 16 (API 36) | `getprop ro.build.version.release` |
| Package | `com.androidharness.app` | `pm list packages` |
| App UID | `u0_a622` (10622) | `ls -la` ไฟล์ใน workspace |
| ABI | arm64-v8a | env |
| Bun | 1.4.4 | `bun --version` |
| Linux prefix | `/data/user/0/com.androidharness.app/files/linux` | `$PREFIX` |
| Code mode | `ACT`, permission `FULL_ACCESS` | task-controls JSON |
| maxContext | `2000000` | task-controls + app_settings_find |
| maxOutput | `32768` | task-controls |
| maxIterations | `0` (ไม่จำกัด) | app_settings_find |

**ข้อสรุป:** Harness ไม่มี external CLI, ไม่มี PM2/systemd/tmux และไม่มี process supervisor ภายนอก ทุกอย่างขับเคลื่อนด้วย tool call ของ agent เอง

---

## 2. สถาปัตยกรรม AI Office ที่มีอยู่จริง

### 2.1 สิ่งที่มี (ไฟล์จริง)

```
.ai/office/
├── ARCHITECTURE.md          ← อธิบาย 2-agent model
├── QUICK_START.md           ← entry point
├── ESSENTIAL_RULES.md       ← กฎความปลอดภัย
├── DECISIONS.md             ← บันทึกการตัดสินใจ
├── RUNBOOK.md               ← คู่มือปฏิบัติการ
├── agents/
│   ├── developer.md         ← AI 01 (main, implementer)
│   └── architect.md         ← AI 02 (planner + QA รวมกัน)
├── context-management/      ← 6 TS modules (ไม่ถูก execute)
│   ├── task-router.ts
│   ├── context-budget.ts
│   ├── context-compaction.ts
│   ├── task-context-selector.ts
│   └── *.test.ts
├── scheduler/               ← 5 TS modules (ไม่ถูก execute)
│   ├── request-scheduler.ts
│   ├── agent-wrapper.ts
│   ├── workflow-orchestrator.ts
│   ├── status-display.ts
│   └── *.test.ts
├── report-manager.ts
├── handoffs/                ← 12 ไฟล์ handoff (Markdown)
├── reviews/                 ← 11 ไฟล์ QA report (Markdown)
├── tasks/active/            ← 7 ไฟล์ task (Markdown)
└── tests/                   ← 6 test files (ไม่รันใน CI)
```

### 2.2 ข้อค้นพบสำคัญ: เป็น Library ไม่ใช่ Runtime

**ยืนยันแล้ว:** TypeScript ทั้ง 18 modules ใน `.ai/office/` **ไม่ถูก import หรือ execute ที่ runtime ใด ๆ** ไม่มี entry point, ไม่มี build step, ไม่มี process ที่รันอยู่

สถาปัตยกรรมการทำงานจริงคือ:
1. Harness เปิด **1 model session ต่อ 1 chat**
2. session นั้น (AI 01) เรียก tool ตาม schema ที่ Harness ให้
3. subagent รันผ่าน `task` tool — **foreground เท่านั้น** (background เป็น read-only)
4. ไม่มี `.ai/office/*.ts` ถูกโหลดเลย

**นัยสำคัญ:** `request-scheduler.ts` (singleton ที่อ้างว่าควบคุม concurrency) ไม่ได้ทำงานจริง การควบคุม concurrency ที่มีผลจริงคือ Harness เองที่รันได้ทีละ turn

### 2.3 จำนวน Agent — ของจริงมี 2 ไม่ใช่ 4

| Agent | มีจริง? | บทบาทปัจจุบัน |
|-------|---------|---------------|
| AI 01 | ✅ | Main Developer — implement + verify + ship |
| AI 02 | ✅ | Architect / Planner / **QA รวมในตัวเดียว** |
| AI 03 (Research) | ❌ | ไม่มี |
| AI 04 (QA แยก) | ❌ | ไม่มี (QA ฝังใน AI 02) |

**ข้อจำกัดเชิงสถาปัตยกรรม:** Harness มี **2 execution slot** เท่านั้น (main + subagent) การมี "4 agent" จึงทำได้เฉพาะในรูป **4 role profile ที่ invoke ทีละตัวแบบ sequential** ไม่ใช่ 4 agent ที่รันพร้อมกัน

---

## 3. การตรวจสอบ Usage Data (1.1)

### 3.1 ไฟล์ที่พบ

| ไฟล์ | ขนาด | ที่อยู่ |
|------|------|--------|
| `cost-2026-10-11_2026-11-09.csv` | 389 B | `/sdcard/Download/` |
| `amount-2026-10-11_2026-11-09.csv` | 1,720 B | `/sdcard/Download/` |

### 3.2 ความไม่สอดคล้องที่ต้องรายงาน ⚠️

| รายการ | ค่าจริง |
|--------|---------|
| ช่วงวันที่ตาม**ชื่อไฟล์** | 2026-10-11 → 2026-11-09 (30 วัน) |
| ช่วงวันที่ตาม**เนื้อหา** | 2026-11-09 เท่านั้น (**1 วัน**) |

**สรุป:** ชื่อไฟล์ไม่ตรงกับเนื้อหา ข้อมูลที่มีคือ **วันเดียว** คือ 2026-11-09 ห้ามตีความว่าเป็นค่าเฉลี่ย 30 วัน

### 3.3 การเปรียบเทียบกับ Dashboard

**สถานะ: BLOCKED — NOT VERIFIED**

ไม่สามารถเข้าถึง provider usage dashboard ได้จาก environment นี้ (ไม่มี MCP server สำหรับ billing/usage, ไม่มี web credential) จึง **ไม่สามารถยืนยันความตรงกันของ Dashboard กับ CSV ได้** ตัวเลขทั้งหมดในรายงานนี้อ้างอิง CSV เพียงแหล่งเดียว

### 3.4 Baseline ที่ยืนยันได้ (2026-11-09, วันเดียว)

**ส่วนลดและราคาต่อ unit** (ตรงกับ `models-dev.json` 100%):

| Model | input (cache miss) | cache read (hit) | output | context |
|-------|-------------------|------------------|--------|---------|
| `deepseek-flash` | $0.15/M | $0.003/M | $0.60/M | 1,048,576 |
| `deepseek-v4-flash` | $0.15/M | $0.003/M | $0.60/M | 1,048,576 |
| `deepseek-v4-pro` | $0.66/M | $0.022/M | $1.98/M | 1,048,576 |

**ปริมาณการใช้:**

| Model | Requests | Cache Miss | Cache Hit | Output | Cache Hit Rate |
|-------|---------:|-----------:|----------:|-------:|---------------:|
| `deepseek-flash` | 111 | 413,358 | 34,913,536 | 25,068 | **98.83%** |
| `deepseek-v4-pro` | 26 | 2,529,557 | 4,720,000 | 12,614 | **65.11%** |
| **รวม** | **137** | 2,942,915 | 39,633,536 | 37,682 | — |

**ค่าใช้จ่าย (คำนวณซ้ำจาก token × ราคา และกระทบยอดกับ CSV):**

| Model | คำนวณได้ | CSV ระบุ | ตรงกัน? |
|-------|---------:|---------:|:-------:|
| flash | $0.181785 | $0.1817851080 | ✅ |
| pro | $1.798323 | $1.7983233400 | ✅ |
| **รวม/วัน** | **$1.980108** | — | — |

**API Key filter:** ทั้งหมดมาจาก key เดียว ชื่อ `AGENT` (`sk-5126b…d5db`) — ไม่มี filter ปนกัน
**วันที่:** 2026-11-09T00:00:00+07:00 → 2026-11-10T00:00:00+07:00 (timezone +07)

### 3.5 ข้อค้นพบที่สำคัญที่สุด

```
pro  = 26 requests  (19.0% ของทั้งหมด)
pro  = $1.798323   (90.8% ของค่าใช้จ่ายทั้งหมด)
```

แยกต้นทุน pro:
- cache miss 2,529,557 tokens × $0.66/M = **$1.6695** ← คิดเป็น **84.3% ของค่าใช้จ่ายทั้งวัน**

**การจำลอง:** ถ้า 26 request ของ pro รันบน flash ด้วยราคา flash
- ต้นทุนที่จะเป็น: **$0.401162** (จาก $1.798323)
- ยอดรวมทั้งวัน: **$0.582947** (จาก $1.980108)
- **ลดลง 70.6%**

**ข้อสังเกตเพิ่ม:** cache hit rate ของ pro (65.11%) ต่ำกว่า flash (98.83%) มาก แปลว่า prompt prefix ของ pro ไม่เสถียร — เปลี่ยนทุกครั้งที่เรียก ทำให้จ่ายที่ราคา cache miss ($0.66/M) เกือบเต็ม

**ไม่มี Search/Fetch charge ในไฟล์ export** — ไม่พบ type ที่เป็น search หรือ fetch

---

## 4. MCP และ Tool Count

### 4.1 ที่เชื่อมต่ออยู่จริง (`mcp-status.json`)

| Server | Tools |
|--------|------:|
| vercel | 246 |
| neon | 139 |
| github | 46 |
| render | 28 |
| stripe-sandbox | 10 |
| cloudflare | 4 |
| **รวม MCP** | **473** |

### 4.2 Built-in tools

นับจาก schema ที่แนบมากับ request นี้: **79 tools**
(total = 473 + 79 = **552**)

### 4.3 สถานะ 128-tool limit

**สถานะ: NOT VERIFIED (ของจริงทำงานได้ แต่พิสูจน์กลไกไม่ได้)**

| ข้อเท็จจริง | หลักฐาน |
|-------------|---------|
| MCP tools ที่เชื่อมอยู่ = 473 | `mcp-status.json` |
| Session ปัจจุบันทำงานได้ | request นี้สำเร็จ |
| ไม่สามารถตรวจ array ที่ส่งจริงต่อ request ได้ | ไม่มี API/tool ให้ inspect request payload |
| ไม่สามารถ filter MCP tool ต่อ task ได้ | ตัวเลือกอยู่ที่หน้า MCP = `needs_user` |

**การตีความ:** ตัวเลข 473 tools ที่ "connected" ไม่เท่ากับ 473 tools ที่ "ส่งไปในทุก request" — Harness อาจทำ lazy expose หรือ subset ต่อ request แต่ **ยืนยันไม่ได้จากภายใน** สิ่งที่ยืนยันได้คือ: **ไม่มี mechanism ใดที่ agent เรียกใช้ได้เพื่อจำกัด tool per task**

---

## 5. Harness Settings ที่ควบคุมได้จริง vs ไม่ได้

### 5.1 ควบคุมได้ผ่าน `app_settings_change`

| Key | ค่าปัจจุบัน | ค่าที่อนุญาต | ผลต่อต้นทุน |
|-----|-------------|--------------|-------------|
| `max_context` | **2000000** | 8000–2000000 | **สูง** — ลดแล้วประหยัดจริง |
| `max_iterations` | **0** (ไม่จำกัด) | 0–1000 | **สูง** — จำกัดเพื่อกัน loop |
| `dual_planning` | false | true/false | กลาง |
| `subagent_action_tools` | true | true/false | ต่ำ (ควบคุม single-writer) |
| `background_subagents` | true | true/false | ต่ำ |
| `repo_map` | true | true/false | ต่ำ (ช่วย accuracy) |
| `steering` | AH_AUTO | AH_AUTO / AFTER_TASK | ต่ำ |
| `code_start` | LAST_CODE | NEW_CODE / LAST_CODE | กลาง |
| `permission_mode` | FULL_ACCESS | 4 ค่า | ไม่เกี่ยวต้นทุน |
| `caveman` | true | true/false | **กลาง** (ลด output token) |
| `caveman_level` | LITE | OFF/LITE/FULL/ULTRA | กลาง |

### 5.2 ควบคุมไม่ได้ — ต้อง `needs_user`

| รายการ | หน้า Settings | เหตุผล |
|--------|--------------|--------|
| Model assignment (main / planning / subagent) | **MODELS** | ต้องผู้ใช้เลือกเอง |
| Provider config / API key | **MODELS** | ความลับ |
| MCP server list + tool enable/disable | **MCP** | ต้องผู้ใช้ตัดสิน |
| Usage dashboard | **USAGE** | อ่านอย่างเดียว |
| GitHub token | **GITHUB** | ความลับ |

**สรุปเชิงนโยบาย:** การเปลี่ยน default model เป็น flash และการจำกัด tool profile **เป็นสิ่งที่ agent ทำเองไม่ได้** ต้องให้ผู้ใช้ดำเนินการผ่านหน้า Settings

---

## 6. ปัญหา Configuration ที่พบ (เรียงตามความรุนแรง)

### P1 — CRITICAL: `max_context` เกินขีดจำกัดจริง 10 เท่า

- ตั้งไว้ `2,000,000`
- model รองรับ `1,048,576`
- gateway ที่ใช้จริง (`context-budget.ts` ระบุ `tenixe: 200000`) รองรับเพียง **200,000**

**ผลกระทบ:** compaction ไม่ทำงานก่อนถึงขีดจำกัดจริง → request ใหญ่มาก → ต้นทุนพุ่ง และอาจเกิด silent failure ที่ gateway แล้วระบบ retry ซ้ำ = จ่ายซ้ำ
**นี่คือสาเหตุที่เป็นไปได้ของ cache miss สูงใน pro**

### P2 — CRITICAL: `deepseek-v4-pro` ถูกใช้เป็นงานประจำ

- 26 requests = 90.8% ของค่าใช้จ่าย
- cache hit เพียง 65.11%
- ไม่มีบันทึกว่าเป็นการ escalate ที่ได้รับอนุมัติ

### P3 — HIGH: `max_iterations = 0` (ไม่จำกัด)

ไม่มีเพดานกัน agent วนซ้ำ = เสี่ยง retry loop ที่เผาเงินโดยไม่มีขอบเขต

### P4 — HIGH: ไม่มี usage/telemetry ภายในระบบ

ไม่มีไฟล์หรือ script ใดที่บันทึก token/cost ต่อ task ต่อ agent — ข้อมูลมีเฉพาะ CSV จาก provider (รายวัน) ทำให้ **attribute cost ต่อ task ไม่ได้**

### P5 — HIGH: MCP tools 473 ตัวโหลดพร้อมกันทั้งหมด

ไม่มี tool profile ต่อ role — ตรงตามที่โจทย์ระบุ แต่ยืนยันแล้วว่า **agent แก้เองไม่ได้**

### P6 — MEDIUM: ไม่มี State/Event/Queue/Lock

ไม่มีไฟล์ state กลาง, ไม่มี event log, ไม่มี queue, ไม่มี lock → multi-agent coordination พึ่งพา prompt ล้วน ๆ

### P7 — MEDIUM: Working tree มีไฟล์แก้ค้าง 13 ไฟล์

```
M .ai/AI_HANDOFF.md
M .ai/reports/LATEST.md
M apps/velseller/src/main.tsx
M apps/velseller/src/pages/SellerOrders.tsx
M apps/velshop/src/components/shop/ProductCard.tsx
M backend/routes/auth.ts
M backend/tests/center-seller-state-sync.test.ts
M backend/tests/marketing-surface.test.ts
M backend/tests/proxy-security.test.ts
M backend/tests/proxy-write-mode.test.ts
M backend/tests/seller-order-ux.test.ts
M db/verify-reconciler.sh
M packages/shared/src/lib/commerce.ts
?? .ai-office/
?? .ai/history/2026-11-09-automatic-migration-system.md
```

**ห้ามแตะหรือ commit ไฟล์เหล่านี้** — เป็นงานค้างของผู้ใช้
`HEAD == origin/main == 73fff9c` (ไม่มี divergence)

---

## 7. ข้อจำกัดที่ยืนยันแล้ว (สำหรับวางแผน Phase 2)

| # | ข้อจำกัด | ผลต่อการออกแบบ |
|---|----------|----------------|
| 1 | Harness มี 2 execution slot | "4 agent" = 4 role profile sequential ไม่ใช่ concurrent |
| 2 | Subagent ไม่ recursive, ถามกลับไม่ได้ | handoff ต้อง self-contained |
| 3 | Background subagent เป็น read-only | งานเขียนโค้ดต้อง foreground |
| 4 | `per-call model override` ไม่ทำงาน (probe 2026-11-02) | เปลี่ยน model ต่อ call ไม่ได้ → ต้องตั้งที่ Settings |
| 5 | Model assignment = `needs_user` | agent เปลี่ยนเองไม่ได้ |
| 6 | MCP tool filtering = `needs_user` | tool profile ทำได้แค่ระดับ prompt |
| 7 | Provider dashboard เข้าไม่ถึง | cache/cost ยืนยันได้จาก CSV เท่านั้น |
| 8 | ไม่มี process ที่รันข้าม app kill | Watcher ต้องเป็น tool-loop probe |
| 9 | ไม่มี `harness.json` | named agent profile (`task.agent`) ใช้ไม่ได้จนกว่าจะสร้าง |
| 10 | Working tree dirty 13 ไฟล์ | ต้องแยก commit ให้ชัด |

---

## 8. สิ่งที่ Phase 2 จะเสนอ (สรุป)

1. **4 role profile** ใน `.ai-office/agents/` (Planner / Research / Developer / QA) — prompt-level ไม่แตะของเดิมใน `.ai/office/agents/`
2. **Task router** ตามระดับงาน — ไม่ invoke ทุก agent ทุกงาน
3. **State/Event/Queue/Lock** เป็น JSON + JSONL ใน `.ai-office/` (file-based, ไม่มี daemon)
4. **Usage tracker** อ่าน CSV → JSONL ต่อ task/agent/model + คำนวณ cache hit rate จริง
5. **Config changes ที่ agent ทำได้:** `max_context` 2M→200K, `max_iterations` 0→60
6. **Config changes ที่ต้องอนุมัติผู้ใช้:** default model = flash ทุก slot, MCP tool disable

---

## 9. ผลการทดสอบใน Phase 1

| การทดสอบ | ผล | หลักฐาน |
|----------|-----|---------|
| อ่าน Harness settings | ✅ VERIFIED | `app_settings_find` คืนค่าจริง 3 ครั้ง |
| อ่าน task-controls | ✅ VERIFIED | JSON 4 ไฟล์ |
| อ่าน MCP status | ✅ VERIFIED | `mcp-status.json` |
| อ่าน usage CSV | ✅ VERIFIED | กระทบยอด cost ตรง 2/2 model |
| คำนวณ cache hit rate | ✅ VERIFIED | สูตรจากโจทย์ ข้อ 6 |
| จำลองย้าย pro→flash | ✅ VERIFIED | −70.6% |
| เปรียบเทียบ Dashboard | ❌ BLOCKED | เข้าไม่ถึง provider dashboard |
| นับ tool ที่ส่งต่อ request | ❌ NOT VERIFIED | ไม่มี API ให้ inspect |
| รัน `bun test` ของ office | ⏭️ NOT RUN | ไม่ใช่ส่วนของ Phase 1 |

---

**จบ Phase 1** — ยังไม่มีการแก้ไขไฟล์ configuration หรือไฟล์โปรเจคใด ๆ
ไฟล์เดียวที่สร้างคือ `.ai-office/AUDIT_REPORT.md` (และ `.ai-office/DISCOVERY.md` จากงานก่อนหน้า)
