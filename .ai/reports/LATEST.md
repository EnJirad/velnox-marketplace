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

---

# เพิ่มเติม — UI Phase B: แก้เอกสาร design system (v2.1)

งานเอกสารล้วน **ไม่มีไฟล์โค้ดถูกแตะ** — commit นี้เปลี่ยนแค่ `VELNOX_DESIGN_THEME.md` และ
`.ai/context/frontend.md`

## สาเหตุที่ต้องทำก่อน Phase C

ตาราง Type scale ใน §8 ของเอกสารบอกว่า `text-xs` = 11px, `text-sm` = 12px, `text-base` = 14px
แต่ Tailwind จริงคือ **12 / 14 / 16** ⇒ ทุกคนที่ทำตามเอกสารและอยากได้ 11px ต้องพิมพ์ `text-[11px]`
เอง 295 ครั้ง นั่นคือรากของความไม่สม่ำเสมอที่ Phase A เพิ่งเก็บกวาดไป **ถ้าไม่แก้เอกสาร agent ตัวถัดไป
จะสร้างมันกลับมา**

## สิ่งที่แก้

| § | เดิม | ใหม่ |
|---|---|---|
| 7 Border Radius | สั่งใช้ `rounded-[10px]` ทั้งที่บรรทัดถัดมาห้าม arbitrary | ชื่อ token + **ตารางค่าจริงที่วัดจาก CSS ที่ build แล้ว** |
| 8 Typography | ตัวเลขผิดทั้งตาราง | ตรงตาม Tailwind + เพิ่ม `text-2xs` (11px) + กฎ 5 ข้อ |
| 2.3 Emerald | ไม่มี token สีแบรนด์ | `--brand` + รายชื่อ utility `*-brand` |
| 26 Checklist | ไม่มีข้อห้าม arbitrary | เพิ่ม 3 ข้อ |
| Version | v2.0 | v2.1 + changelog |

## ข้อค้นพบใหม่ระหว่างเขียน

**`rounded-xl` กับ `rounded-2xl` ให้ผลเท่ากัน (16px) ในโปรเจกต์นี้** — เพราะ `index.css` override
`--radius-xl: calc(var(--radius) + 4px)` = 16px ขณะที่ `--radius-2xl` ยังเป็นค่า default ของ
Tailwind (1rem = 16px) เอกสารจึงระบุให้เลือกใช้ตัวเดียว (`rounded-2xl`) และบันทึกไว้เป็นงานเก็บกวาด
ในอนาคต — ถ้าไม่เขียนไว้ คนอ่านจะเดาว่า Tailwind ปกติ (xl=12px) แล้วใช้ผิด

## ตรวจแล้ว

`git diff --check` clean · ไม่มีไฟล์โค้ดเปลี่ยน (`git status` = 2 ไฟล์เอกสาร) ·
ตรวจว่าเอกสารไม่ขัดความจริง: ไม่มี `| Buttons | rounded-[10px]` เหลือ (0) · ไม่มี `| 11px | text-xs`
เหลือ (0) · มี `text-2xs` 4 จุด · มี `--brand` 2 จุด

---

# เพิ่มเติม — UI Phase C (เริ่ม): velnox + การแก้เป้าของแผน

## ทำแล้ว

ปุ่มดิบ 2 ตัวใน `velnox` → `<Button>` โดยคงหน้าตาเดิมด้วยการ override ผ่าน `tailwind-merge`
(`cn()` = `twMerge(clsx(...))` ⇒ class ที่ส่งไปทีหลังชนะ):

| ไฟล์ | เดิม | ใหม่ |
|---|---|---|
| `Contact.tsx:118` | `<button className="… rounded-xl bg-slate-900 px-6 py-3.5 …">` | `<Button className="h-12 … rounded-xl bg-slate-900 …">` (h-12 = 48px = py-3.5 + line-height 20px เดิม) |
| `CorporateLayout.tsx:102` | `<button className="… size-10 rounded-lg …">` | `<Button variant="ghost" size="icon" className="size-10 …">` (+ `hover:text-slate-700` เพื่อ neutralize ghost's text color) |

`velnox` เหลือ `<button>` ดิบ **0** · typecheck 4/4 · build ผ่าน · test 1432/0

## ข้อค้นพบที่ทำให้ต้องแก้เป้าของ Phase C

แผนเดิมเขียนว่า "`<button>` ดิบ 204 → 0" ผมแยกประเภทจริงก่อนลงมือ แล้วพบว่าตัวเลขนั้นทำให้เข้าใจผิด:

| ประเภท | จำนวน | ควรเป็น `<Button>`? |
|---|---|---|
| segmented / pill toggle (className เป็น template literal + ternary) | **40** | ไม่ |
| filter chip ที่มี `aria-pressed` | **10** | ไม่ |
| list row / disclosure / upload wrapper / floating pill | ~145 | ไม่ |
| action button จริง (`bg-slate-900` / `bg-brand`) | **5** | ใช่ (บางตัวเป็น floating pill) |

`Button` มี base class `h-11 px-4 py-2 rounded-md text-sm font-medium` ซึ่งจะทับ layout ของ
filter chip / list row / overlay ⇒ **บังคับให้ครบ 204 จะทำให้ UI แย่ลง**

**ปัญหาจริงคือ pattern เดียวกันถูกเขียนซ้ำ ~40 ที่** (period picker ใน `Income*.tsx` 5 ไฟล์,
status filter ใน `SellerOrders.tsx` + `MyShop.tsx`, segment tab ใน `SellerProfile.tsx`)
⇒ Phase C2 ควรสร้าง primitive กลาง (2 variant: pill / tab) แทนที่จะไล่เปลี่ยนเป็น `Button`

## ยังไม่ได้ทำ

- primitive segmented/toggle (C2) — ต้องตัดสินใจเรื่องหน้าตาก่อน
- ปุ่ม action จริงที่เหลือ ~5 ตัวใน `velshop` / `velcenter`
- dialog/sheet ที่ประกาศเอง 5 ไฟล์ (C4)
