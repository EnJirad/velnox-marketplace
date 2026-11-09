# ROLLBACK.md — Velnox AI Office 2.0

**Backup ที่เกี่ยวข้อง:** `.ai-office/backup/2026-11-09-pre-optimization/`
**วันที่สร้าง backup:** 2026-11-09

---

## 1. สิ่งที่ Backup ไว้

| ไฟล์ | เนื้อหา |
|------|---------|
| `mcp-snapshot.json` | tool count ต่อ MCP server ก่อนแก้ (473 total) |
| `mcp-servers-names.json` | ชื่อ + host ของ MCP server (ไม่มี credential) |
| `task-controls-snapshot.json` | provider/model/maxContext/maxIterations ของ 7 session |
| `office-files.txt` | sha256 ของ `.ai/office/**` 63 ไฟล์ |

**ตรวจแล้วว่าไม่มี secret ใน backup** (grep `Authorization` / `sk-` = 0 match จริง; ที่ match คือคำว่า "ta**sk-c**ontext" ในชื่อไฟล์)

---

## 2. ค่า Configuration ก่อนแก้ (baseline)

| Setting | ค่าเดิม | ค่าใหม่ |
|---------|---------|---------|
| `max_context` | `2000000` | `200000` |
| `max_iterations` | `0` | `60` |

ค่าอื่นทั้งหมด **ไม่เปลี่ยน**: `dual_planning=false`, `subagent_action_tools=true`,
`background_subagents=true`, `subagent_notifications=true`, `repo_map=true`,
`steering=AH_AUTO`, `code_start=LAST_CODE`, `permission_mode=FULL_ACCESS`,
`caveman=true`, `caveman_level=LITE`

---

## 3. ขั้นตอนย้อนกลับ

### 3.1 ย้อน Harness settings (ทำได้ทันที)

```
app_settings_change:
  max_context   = 2000000
  max_iterations = 0
```

### 3.2 ย้อน MCP (ถ้าผู้ใช้ปิดไป)

Settings → MCP → เปิด `vercel`, `neon` คืน
อ้างจำนวน tool เดิมได้จาก `mcp-snapshot.json`

### 3.3 ย้อน Model assignment (ถ้าผู้ใช้เปลี่ยน)

Settings → MODELS → ตั้งคืนตาม provider/model ที่ต้องการ
ค่าเดิมที่บันทึกไว้: ดู `task-controls-snapshot.json`
(พบ `deepseek-v4-flash` บน Tenixe และ `DeepSeek-V4-Flash-0731` บน Aiunlimit)

### 3.4 ลบไฟล์ AI Office ใหม่

```
rm -rf .ai-office/agents .ai-office/config .ai-office/runtime \
       .ai-office/queue .ai-office/logs .ai-office/tools
```

ไฟล์ที่ **ไม่ควรลบ** (เป็นเอกสาร):
`AUDIT_REPORT.md`, `DESIGN.md`, `IMPLEMENTATION.md`, `TEST_REPORT.md`, `DISCOVERY.md`, `backup/`

### 3.5 ตรวจว่าไม่มีอะไรเสียหาย

```
sha256sum -c .ai-office/backup/2026-11-09-pre-optimization/office-files.txt
```

ทุกบรรทัดต้อง **OK** — พิสูจน์ว่า `.ai/office/**` ไม่ถูกแตะเลย

---

## 4. สิ่งที่งานนี้ "ไม่แตะ" จึงไม่ต้อง rollback

- `.ai/office/**` — ไม่แก้ไขไฟล์ใดเลย (พิสูจน์ด้วย sha256)
- `.ai/AI_RULES.md`, `.ai/AI_HANDOFF.md`, `.ai/reports/**` — ไม่แตะ
- Production application code ทุกไฟล์ — ไม่แตะ
- Provider configuration / API key — ไม่แตะ
- MCP server list — agent แก้ไม่ได้ (needs_user)

---

## 5. ไฟล์ที่แก้ค้างอยู่ก่อนงานนี้ (ไม่ใช่ของงานนี้)

Working tree มีไฟล์แก้ค้าง **13 ไฟล์** ที่มีอยู่ก่อนเริ่มงานนี้:

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
```

**งานนี้ไม่แตะไฟล์เหล่านี้เลย** — ห้าม `git checkout --` หรือ `git reset --hard` เด็ดขาด
ถ้าต้องการย้อน ให้ย้อนเฉพาะ `.ai-office/**` ตามข้อ 3.4

---

## 6. Git

| รายการ | ค่า |
|--------|-----|
| Branch | `main` |
| HEAD ก่อนงาน | `73fff9c` |
| origin/main | `73fff9c` (ตรงกัน ไม่มี divergence) |
| การ commit | ดู `IMPLEMENTATION.md` §Git |
