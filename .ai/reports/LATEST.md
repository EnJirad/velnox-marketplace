# LATEST — 2026-11-10 · UI Phase A: รวม token (ไม่เปลี่ยนพิกเซล)

**Branch:** `main` · **Status:** DONE — verified ด้วยค่าที่ Tailwind generate จริง
**ที่มา:** `.ai/tasks/active/ui-simplification-plan.md` (owner เลือกแนวทางที่ 2: "เรียบขึ้นจริง")

## 1. ปัญหาที่แก้

Design system มีอยู่แล้ว แต่โค้ดไม่ทำตาม — ค่า radius / สีแบรนด์ / ขนาดตัวอักษร ถูกเขียนเป็น
**ค่าดิบ** กระจายอยู่ ทำให้แต่ละจอรู้สึกไม่เป็นชุดเดียวกัน และแก้สีแบรนด์ต้องไล่หา ~300 ที่

## 2. สิ่งที่ทำ

| งาน | จำนวน | ผล |
|---|---|---|
| `rounded-[10px]` → `rounded-md` | 241 | = `calc(var(--radius) - 2px)` = 10px |
| `rounded-[12px]` → `rounded-lg` | 14 | = `var(--radius)` = 12px |
| `rounded-[8px]` → `rounded-sm` | 7 | = `calc(var(--radius) - 4px)` = 8px |
| `text/bg/border/ring/via/from/to/accent/border-t-[#10B981]` → `*-brand` | 302 | สีเดียวกับ `--brand: #10b981` |
| `text-[11px]` → `text-2xs` | 295 | `font-size: .6875rem` = 11px |
| **รวม** | **859 จุด / 94 ไฟล์** | |

เพิ่ม token ใหม่ 2 ตัวใน `packages/shared/src/index.css`:
- `--color-brand: var(--brand)` + `--brand: #10b981`
- `--text-2xs: 0.6875rem` — **ไม่ประกาศ line-height คู่** เพื่อให้เหมือน `text-[11px]` เดิมเป๊ะ

## 3. สิ่งที่ **ไม่ทำ** ในรอบนี้ (และเหตุผล)

- `text-[12px]` → `text-xs` (5 จุด), `text-[14px]` → `text-sm` (1 จุด): Tailwind **ตั้ง line-height
  มาด้วย** ⇒ จะเปลี่ยนพิกเซล ขัดสัญญา "Phase A ไม่เปลี่ยนหน้าตา" → เก็บให้ owner ตัดสินใน Phase D
- `text-[8px]` (2 จุด), `text-[13px]` (14), `text-[15px]` (8): ไม่มี token ตรง → คงไว้
- `rounded-[2px]/[4px]/[6px]/[9px]/[14px]` (8 จุด): ไม่มี token ตรง → คงไว้
- `background: #10B981` (inline style 2 จุด) และ `fill="#10B981"` (SVG 1 จุด): ไม่ใช่คลาส → คงไว้

## 4. ตรวจแล้ว

| Gate | ผล |
|---|---|
| `rounded-[10/12/8px]` เหลือ | **0** |
| `#10B981` ในคลาสเหลือ | **0** |
| `text-[11px]` เหลือ | **0** |
| typecheck 4 แอป + backend | exit 0 |
| `bun run test` | **1432 pass / 0 fail** (1857 tests) |
| i18n | th/en/my 2235 parity |
| `build:apps` | 4/4 exit 0 |
| คลาสใหม่ใน CSS ที่ build จริง | ครบ 8 คลาส **ทั้ง 4 แอป** |

**หลักฐานว่าไม่เปลี่ยนพิกเซล** (อ่านจาก CSS ที่ Tailwind generate ไม่ใช่อ่านโค้ด):
```
.text-2xs{font-size:.6875rem}          ← เดิม text-[11px]
.rounded-md{border-radius:calc(var(--radius) - 2px)}   ← เดิม rounded-[10px]
--radius:.75rem;   --brand:#10b981;
```

## 5. Test ที่ต้องแก้ 1 ไฟล์

`backend/tests/velcenter-nav.test.ts:55` ใช้ `rounded-[10px]` เป็น **ตัวระบุตำแหน่ง** ของ
`<TabsTrigger value="staff">` (เจตนาคือ "ห้ามมี selectTab") ⇒ อัปเดต marker เป็น `rounded-md`
ไม่ได้ลบการตรวจ

## 6. บทเรียนที่ต้องจำ

**ตัวเลขในแผนฉบับแรกผิด** (884 radius / 233 สี) เพราะ regex ใน shell loop ถูกตีความเป็น character
class (`[10px]` = ตัวอักษร 1,0,p,x) วัดใหม่ด้วย `rounded(-[a-z]+)*-\[[0-9]+px\]` ได้ **270 / 302**
— ทิศทางเดิมถูก แต่ขนาดงานเล็กกว่าที่เคยบอก ~3 เท่า บันทึกไว้ในแผนแล้ว

## 7. ต่อไป

- **Phase B** — แก้ตาราง Type scale ใน `VELNOX_DESIGN_THEME.md` (ระบุ xs=11px แต่ Tailwind จริง 12px
  เป็นต้นเหตุที่ทำให้เกิด `text-[11px]` 295 ครั้ง) + กฎห้าม arbitrary value
- **Phase C** — `<button>` ดิบ 204 → `<Button>` ทีละแอป เริ่ม `velnox` (5 ไฟล์)
- **Phase D** — ลดความหนาแน่น 4 จอใหญ่
