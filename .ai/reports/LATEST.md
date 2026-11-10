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

---

# เพิ่มเติม — UI Phase C2: `SegmentedOption` primitive

## ทำแล้ว

สร้าง `packages/shared/src/components/ui/segmented.tsx` และแทน `<button>` ที่เขียนซ้ำ **5 ไฟล์**
(`Income`, `IncomeCommissionDetail`, `IncomeGrossDetail`, `IncomePayoutDetail`, `IncomeReturnsDetail`)

```tsx
// เดิม — เขียนซ้ำ 5 ที่ ทุกไบต์เหมือนกัน
<button key={p} onClick={...}
  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
>{periodLabels[p]}</button>

// ใหม่
<SegmentedOption key={p} active={period === p} onClick={...}>{periodLabels[p]}</SegmentedOption>
```

**ได้อะไร:**
- `type="button"` — เดิม **ไม่มี** ทั้ง 5 ที่ (ถ้าย้ายเข้า `<form>` วันไหนจะ submit โดยไม่ตั้งใจ)
- `aria-pressed` — เดิม **ไม่มี** ⇒ screen reader ไม่รู้ว่าตัวไหนถูกเลือก
- สูตรสีอยู่ที่เดียว แก้ครั้งเดียวมีผลทั้ง 5 จอ
- หน้าตาเหมือนเดิมเป๊ะ (recipe คัดลอกมาจาก class string เดิมทุกตัวอักษร)

## ข้อเท็จจริงที่ต้องแก้คำพูดของผม

ตอนเสนอทางเลือก ผมบอกว่า segmented มี **2 แบบ** — พอมองปุ่มจริงทั้ง 40 ตัวพบ **3 สูตร**:

| recipe | ลักษณะ | ที่ใช้ | สถานะ |
|---|---|---|---|
| `tray` | chip ในรางสีเทา | `Income*` 5 ไฟล์ | ✅ แปลงแล้ว |
| `dark` | พื้นเข้ม | `SellerOrders:133`, `SellerProfile:190` | ❌ ยังไม่แปลง — **สองตัวนี้ยังไม่เหมือนกันเอง** (radius + text size + hover ต่างกัน) |
| `brand` | emerald + ไอคอน + จำนวน | `MyShop:499` และอื่น ๆ | ❌ ยังไม่แปลง |

`dark` มี 2 สูตรย่อย ⇒ แปลงตอนนี้ต้อง**เดาว่าอันไหนคือมาตรฐาน** ซึ่งเท่ากับเปลี่ยนดีไซน์แบบ disguising
เป็น refactor จึงหยุดที่ `tray` ที่ตรงกันจริง และเขียนอีก 2 recipe ไว้ในคอมเมนต์ของ primitive
เพื่อไม่ให้ใคร invent สูตรที่ 4

## ตรวจแล้ว

typecheck 4/4 exit 0 · `bun --filter @velnox/velseller build` ผ่าน · `bun run test` **1432 pass / 0 fail**
· `git diff --check` clean · **`.py-1\.5{` ยังถูก generate ใน CSS** (สำคัญ: class ย้ายจาก app ไป shared
แล้ว ต้องยืนยันว่า Tailwind v4 `@source "./"` สแกนเจอจริง ไม่งั้น chip จะเสียสี/ระยะ) ·
`<button key={p}>` ใน Income* เหลือ 0

---

# เพิ่มเติม — UI Phase C3 + การประเมิน C4

## C3: ปุ่ม action จริงที่เหลือ

สแกนทั้ง 4 แอป + shared หาปุ่มดิบที่ `className` เป็น string ตรง ๆ และมีพื้น `bg-slate-900` / `bg-brand`
ได้ **2 ตัว** — ตัวหนึ่งเป็น action จริง อีกตัวเป็น floating pill:

| ไฟล์ | ชนิด | การตัดสิน |
|---|---|---|
| `packages/shared/src/components/chat/chat-inbox.tsx:198` | ปุ่ม Retry ใน empty state | ✅ แปลงเป็น `<Button>` |
| `apps/velshop/src/pages/ShopChat.tsx:766` | floating pill "ข้อความใหม่" | ❌ คงไว้ — เป็น affordance ลอย |
| `apps/velseller/src/pages/SellerChat.tsx:746` | floating pill เลื่อนลงล่าง | ❌ คงไว้ |

การแปลงใช้ `h-10` override `h-11 sm:h-9` ของ Button เพื่อคงความสูง 40px เดิม (ถ้าไม่ใส่จะกลายเป็น
44px บนมือถือ), `rounded-xl` และสีเดิมทุกตัว

⇒ **ปุ่ม action ที่เป็น `<Button>` ตอนนี้ครบแล้ว** เหลือแต่ widget ที่ไม่ควรเป็น Button (ตามที่
วิเคราะห์ไว้ใน C1)

## C4: การประเมิน overlay ที่ประกาศเอง 5 ไฟล์

ตรวจว่าจัดการ keyboard/screen reader หรือไม่:

| ไฟล์ | Escape | Focus | Trap | tabIndex | inert |
|---|---|---|---|---|---|
| `NotificationBell.tsx` | ✓ | **✗** | **✗** | **✗** | **✗** |
| `SellerNotificationBell.tsx` | ✓ | **✗** | **✗** | **✗** | **✗** |
| `chat-image.tsx` | ✓ | ✓ | ✓ | ✗ | ✗ |
| `emoji-picker.tsx` | ✓ | ✓ | ✗ | ✓ | ✗ |
| `GalleryLightbox.tsx` | ✓ | ✓ | ✗ | ✗ | ✗ |

**สรุป:** ทั้ง 5 ปิดด้วย Escape ได้ แต่ **notification bell 2 ตัวไม่ย้าย focus เข้าไปเลย** ⇒ คนที่ใช้
คีย์บอร์ดหรือ screen reader เปิดแผงแล้วยังTab อยู่ข้างหลัง

**ยังไม่แก้ในรอบนี้ และไม่ควรแก้แบบเหวี่ยง:** bell ทั้งสองเป็น **popover ที่ผูกกับปุ่ม** ไม่ใช่ modal
⇒ primitive ที่ถูกคือ Radix Popover (focus trap + focus return + outside click ให้ฟรี) ไม่ใช่ Dialog
หรือ Sheet ที่มีอยู่ — ถ้าเอา Dialog มาแทนจะได้ backdrop ทึบและ scroll lock ซึ่งผิดบริบท
จัดเป็นงานแยกที่ต้องทดสอบทีละตัว

## ตรวจแล้ว

typecheck 4/4 · `build:apps` 4/4 exit 0 · `bun run test` **1432 pass / 0 fail** · `git diff --check` clean

---

# เพิ่มเติม — C4 ตัวแรก: focus management ของ `NotificationBell` (velshop)

## สิ่งที่ขาด

วัดแล้ว: ไฟล์นี้มี `role="dialog"` และจัดการ Escape กับคลิกข้างนอกได้ **แต่ไม่เคยย้าย focus เข้าแผง**
⇒ คนที่ใช้คีย์บอร์ดหรือ screen reader กดกระดิ่งแล้ว focus ยังอยู่ที่กระดิ่ง กด Tab ต่อก็เดินไป
element ข้างหลังแผง และ `role="dialog"` ไม่ถูกประกาศให้ใครฟัง

## ทำไมไม่ใช้ Radix Popover ตามที่ผมเสนอไว้ตอนแรก

ผมเสนอ `ui/popover.tsx` แต่พออ่านจริงพบว่า `PopoverContent` ห่อ `PopoverPrimitive.Content` ที่**จัดตำแหน่ง
ด้วย Popper** ⇒ จะทับ layout ที่โค้ดนี้ตั้งใจทำไว้: บนมือถือแผงเป็น `fixed inset-x-3` ที่ตรึงกับขอบ viewport
(คอมเมนต์ในไฟล์ระบุว่าเวอร์ชันเดิมที่ใช้ `absolute right-0` ล้นขอบจอ 320px ไป ~80px)

ถ้าเปลี่ยนไปใช้ Radix ตอนนี้ ผมจะ**แก้สิ่งที่ไม่ได้พัง (ตำแหน่ง) และทำให้สิ่งที่พัง (focus) ดีขึ้น
โดยที่ยืนยันผลไม่ได้** ⇒ เลือกแก้เฉพาะ focus management บน layout เดิม

## สิ่งที่แก้

| เปลี่ยน | ผล |
|---|---|
| `panelRef` + `tabIndex={-1}` + `outline-none` บนแผง | โฟกัสย้ายเข้าแผงเมื่อเปิด ⇒ screen reader อ่านชื่อแผง |
| effect `if (open) panelRef.current?.focus()` | เปิดด้วยคีย์บอร์ดแล้วอยู่ "ใน" แผงทันที |
| Escape → `setOpen(false)` **+** `triggerRef.current?.focus()` | ปิดแล้วโฟกัสกลับไปที่กระดิ่ง ไม่ตกไปที่ `<body>` |
| `triggerRef` บนปุ่มกระดิ่ง | ปลายทางของการคืนโฟกัส |

**ไม่ทำ focus trap** — แผงนี้เป็น non-modal popover (ไม่มี backdrop, ไม่ล็อก scroll) การกัก Tab ไว้จะขัด
ธรรมชาติของผู้ใช้ มาตรฐานของ popover คือย้ายโฟกัสเข้าแล้วปล่อยให้ Tab ออกได้

**ไม่แตะ:** ตรรกะโหลด/มาร์คอ่าน/นำทาง, realtime subscription, layout มือถือ, สี

## ตรวจแล้ว

typecheck 4/4 exit 0 · `bun --filter @velnox/velshop build` ผ่าน · `bun run test` **1432 pass / 0 fail**
(รวม `notification-flow.test.ts` ที่อ้างไฟล์นี้) · `git diff --check` clean

**ยังไม่ได้ทดสอบด้วยคีย์บอร์ดจริง** — ต้องให้ owner กด Tab ดู (ผมทดสอบ interaction ในเบราว์เซอร์ไม่ได้)

---

# เพิ่มเติม — C4 ตัวที่สอง: `SellerNotificationBell` (shared)

แก้แบบเดียวกับตัวแรก ทุกจุด — ตรวจแล้วทั้งสองไฟล์มี pattern ตรงกันทั้ง 5 ตัว:
`triggerRef` · `panelRef` · `tabIndex={-1}` · `panelRef.current?.focus()` · `triggerRef.current?.focus()`

เพราะไฟล์นี้อยู่ใน `packages/shared` ⇒ **velseller ได้ผลทันที** (และแอปอื่นที่ใช้ bell นี้)

## ตรวจแล้ว

typecheck 4/4 · `build:apps` 4/4 exit 0 · `bun run test` **1432 pass / 0 fail** · `git diff --check` clean

## สี hex ที่ยังเขียนดิบ — งานถัดไปที่วัดได้

Phase A เก็บเฉพาะ `#10B981` (302 จุด) ยังเหลือ **183 จุด** ที่เป็นสีอื่น:

| สี | จำนวน | ควรเป็น |
|---|---|---|
| `bg-[#F8FAFC]` | 57 | `bg-background` (เท่ากับ `--background`) |
| `bg-[#ECFDF5]` | 54 | `bg-accent` (เท่ากับ `--accent`) |
| `text/bg-[#059669]` | 32 | emerald-600 — ต้องเพิ่ม token |
| `text-[#047857]` | 13 | `text-accent-foreground` (เท่ากับ `--accent-foreground`) |
| `bg-[#F0FDF9]` | 9 | ไม่มี token — ต้องตัดสินใจ |
| `from-[#0f766e]` / `to-[#34d399]` | 8 | gradient stops — ต้องเพิ่ม token |
| อื่น ๆ | 10 | — |

**ยังไม่ทำ** เพราะบางตัวเป็นการตัดสินใจเรื่องสี (เช่น `#F0FDF9` กับ `#ECFDF5` ใกล้กันมากจนอาจตั้งใจให้ต่าง
หรืออาจเป็นความไม่สม่ำเสมอ) — ต้องดูของจริงก่อน ไม่ใช่แทนที่ตามตัวเลข

---

# เพิ่มเติม — UI Phase A2: สี hex ที่เหลือ 156 จุด

## ทำอะไร

Phase A เก็บเฉพาะ `#10B981` (302 จุด) รอบนี้เก็บ 4 สีที่ **พิสูจน์ได้ว่าเท่ากับ token ที่มีอยู่แล้ว**
หรือที่เพิ่มใหม่:

| เดิม | ใหม่ | จำนวน | หลักฐานว่าเท่ากัน |
|---|---|---|---|
| `bg-[#F8FAFC]` | `bg-background` | 57 | `--background: #f8fafc` |
| `bg-[#ECFDF5]` | `bg-accent` | 54 | `--accent: #ecfdf5` |
| `text-[#047857]` | `text-accent-foreground` | 13 | `--accent-foreground: #047857` |
| `text-[#059669]` / `bg-[#059669]` | `text/bg-brand-strong` | 32 | เพิ่ม token ใหม่ `--brand-strong: #059669` |

เพิ่ม `--color-brand-strong` + `--brand-strong` ใน `index.css` และบันทึกใน `VELNOX_DESIGN_THEME.md` §2.3

## ตรวจ dark mode ก่อนแตะ

การเปลี่ยน `bg-[#F8FAFC]` เป็น `bg-background` จะเปลี่ยนสีใน dark mode ถ้ามีคนเปิดใช้ — ตรวจแล้ว
**ไม่มีโค้ดสลับ `.dark` ที่ไหนเลย** (มี `dark:` utility 44 จุดเตรียมไว้ แต่ class ไม่เคยถูกใส่) ⇒ ไม่มีผลวันนี้
และถ้าเปิด dark ในอนาคต สีจะตาม theme อย่างถูกต้อง (ดีกว่าเขียน hex ทับ)

## ตรวจแล้ว

typecheck 4/4 · `build:apps` 4/4 exit 0 · `bun run test` **1432 pass / 0 fail** · `grep` ค่าเดิมเหลือ **0**
ทั้ง 5 pattern · `git diff --check` clean

**ยืนยันจาก CSS ที่ build จริง (ทั้ง 4 แอป):**
`.bg-background{background-color:var(--background)}` · `--accent:#ecfdf5` · `--accent-foreground:#047857`
· `--brand-strong:#059669` · `.text-brand-strong{color:var(--brand-strong)}`

## บทเรียนการตรวจ (สำคัญ)

ตอนแรกผมตรวจด้วย `grep -F ".bg-accent{"` แล้วขึ้น ✗ ทั้งที่คลาสมีอยู่จริง — เพราะ Tailwind v4
**รวม selector ที่ค่าตกผลึกเหมือนกัน** เป็น `.bg-accent,.bg-accent\/50{...}` ทำให้ `{` ไม่ได้ตามหลังทันที
และ `.bg-brand-strong` ไม่มีจริง ๆ ก็เพราะทั้ง 16 จุดเป็น `hover:bg-brand-strong`
⇒ ต้องตรวจด้วย pattern ที่ทน `,` `{` `:` ไม่ใช่ยึด `{` อย่างเดียว

---

# เพิ่มเติม — UI Phase A3: gradient แบรนด์เป็น token (14 จุด)

## เหตุผลที่เลือกกลุ่มนี้ก่อน (owner ถามว่าเลือกอะไรก่อนระหว่างสี 27 vs radius/text 38)

เกณฑ์คือ **"ทำได้โดยไม่ต้องตัดสินใจเชิงดีไซน์"** ไม่ใช่จำนวน:

**radius/text 38 จุด — ต้องตัดสินใจ**
- `text-[13px]`(14) · `text-[15px]`(8) ไม่มี token ตรง → ต้องเลือกว่าจะเพิ่ม token แปลก ๆ หรือ**ปรับขนาดจริง**
- `text-[12px]`/`[14px]`(6) เท่ากับ `text-xs`/`text-sm` แต่สองตัวนั้น **ตั้ง line-height มาด้วย** ⇒ เปลี่ยนพิกเซล
- radius 8 จุด (2/4/6/9/14px) → ต้องประดิษฐ์ 5 token เพื่อ 8 จุด ไม่คุ้ม

**สี hex — มีปัญหาจริงซ่อนอยู่:** gradient แบรนด์ `#0f766e → #059669 → #34d399`
ถูกเขียนซ้ำใน **5 จอ** ของ velshop ⇒ แก้ที่หนึ่ง อีก 4 ที่ไม่ตาม

## ทำอะไร

เพิ่ม token 2 ตัวและแทน 14 จุด:

| เดิม | ใหม่ | จำนวน |
|---|---|---|
| `from-[#0f766e]` | `from-brand-deep` | 5 |
| `text-[#0f766e]` | `text-brand-deep` | 3 |
| `to-[#34d399]` | `to-brand-light` | 5 |
| `via-[#059669]` | `via-brand-strong` | 1 |

(`--brand-strong` มีอยู่แล้วจากรอบก่อน — ใช้ซ้ำ ไม่สร้างใหม่)

## ตรวจแล้ว

typecheck 4/4 · `build:apps` 4/4 exit 0 · `bun run test` **1432 pass / 0 fail** · `diff --check` clean

**ตรวจว่าแอปที่ไม่มีคลาสไม่ได้แค่สแกนไม่ถึง:** `from-brand-deep` อยู่ใน 5 ไฟล์ของ velshop ทั้งหมด
และ velseller/velcenter/velnox มี **0 จุด** ที่ใช้ gradient นี้ ⇒ การที่ CSS ของสามแอปไม่มีคลาสนี้
ถูกต้อง ไม่ใช่ของหาย

`--brand-deep:#0f766e` และ `--brand-light:#34d399` ยืนยันจาก CSS ที่ build จริง

## เหลือ 13 จุดที่ตั้งใจไม่แตะ

`bg-[#F0FDF9]`(9) · `bg-[#EF4444]`(1) · `bg-[#D1FAE5]`(1) · `from-[#ECFDF5]`(1) · `from-[#065f46]`(1)

`#F0FDF9` ใกล้ `#ECFDF5` (accent) มาก — อาจตั้งใจให้ต่างระดับหรืออาจเป็นความไม่สม่ำเสมอ
ต้องดูของจริงก่อนตัดสิน ส่วนที่เหลือเป็นค่าใช้ครั้งเดียว
