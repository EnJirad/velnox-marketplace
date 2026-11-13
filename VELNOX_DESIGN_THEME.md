# VELNOX_DESIGN_THEME.md — Velnox Design System v2.2

> SOURCE OF TRUTH for all Velnox UI/UX work.
>
> Any human or AI modifying UI in VelShop, VelSeller, VelCenter, or Velnox MUST read this file first.
>
> Purpose: prevent visual drift between screens and between different AI coding agents.

---

## 1. Design Direction

Velnox uses a clean, bright marketplace visual language:

- White surfaces
- Very light slate page backgrounds
- Deep slate / near-black for primary actions and strong text
- Emerald / mint as the Velnox brand accent and positive/action color
- Soft borders and restrained shadows
- Rounded cards and controls
- Mobile-first responsive design
- Inter + Thai/Myanmar-compatible typography

### Semantic meaning

**Dark = primary/important action**  
**Emerald = Velnox brand / positive / Add to Cart / success**  
**Slate = neutral/supporting UI**  
**Red = destructive/error**  
**Amber = warning/pending**

Do not invent additional brand colors without updating this document.

---

# 2. Core Color Tokens

## 2.1 Global surfaces and text

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#f8fafc` | Page background |
| `--foreground` | `#0f172a` | Primary text |
| `--card` | `#ffffff` | Card/surface background |
| `--card-foreground` | `#0f172a` | Card text |
| `--popover` | `#ffffff` | Dropdown/menu/sheet surface |
| `--popover-foreground` | `#0f172a` | Popover text |

Rules:
- Default page background: `#f8fafc`
- Main cards/surfaces: `#ffffff`
- Primary text: `#0f172a`
- Avoid pure `#000000` for normal UI text.

## 2.2 Primary / Buy

| Token | Hex | Usage |
|---|---|---|
| `--primary` | `#0f172a` | Primary buttons, Buy Now, strong headings |
| `--primary-foreground` | `#ffffff` | Text/icons on primary |
| Primary hover | `#1e293b` | Hover state |

**Buy Now / ซื้อทันที = dark primary.**

## 2.3 Velnox Emerald / Cart / Success

| Token | Hex | Usage |
|---|---|---|
| `--ring` | `#10b981` | Focus ring / brand accent |
| `--brand` | `#10b981` | **สีแบรนด์ตัวจริง** — เรียกผ่าน utility `text-brand` · `bg-brand` · `border-brand` · `ring-brand` · `via-brand` · `from-brand` · `to-brand` · `accent-brand` |
| `--brand-strong` | `#059669` | emerald เข้มสำหรับข้อความ/ไอคอนบนพื้นเขียวอ่อน — `text-brand-strong` (เดิมเขียนเป็น `[#059669]` 32 จุด) |
| `--brand-deep` | `#0f766e` | ปลายเข้มของ gradient แบรนด์ — `from-brand-deep` / `text-brand-deep` |
| `--brand-light` | `#34d399` | ปลายอ่อนของ gradient แบรนด์ — `to-brand-light` |
| Emerald Primary | `#10B981` | Brand, active state, Add to Cart |
| Emerald Dark | `#0f766e` | Strong emerald / gradient start |
| Emerald Mid | `#10B981` | Main gradient |
| Emerald Light | `#34d399` | Gradient end |
| Emerald BG | `#ECFDF5` | Soft emerald background |
| Emerald Text | `#047857` | Text on emerald-soft surfaces |

**Add to Cart / เพิ่มลงตะกร้า = Velnox emerald.**

⚠️ **ห้ามเขียน `text-[#10B981]` / `bg-[#10B981]` ตรง ๆ อีก** — ใช้ `*-brand` (เพิ่ม 2026-11-10
หลังแทนที่ของเดิม 302 จุด) การเขียน hex ซ้ำทำได้แค่ทำให้แก้สีแบรนด์ต้องไล่หา 300 กว่าที่

## 2.4 Secondary / Neutral

| Token | Hex | Usage |
|---|---|---|
| `--secondary` | `#f1f5f9` | Neutral background/control |
| `--secondary-foreground` | `#1e293b` | Text on secondary |
| `--muted` | `#f1f5f9` | Muted surface |
| `--muted-foreground` | `#64748b` | Secondary text |

## 2.5 Borders / Inputs

| Token | Hex | Usage |
|---|---|---|
| `--border` | `#e2e8f0` | Standard border |
| `--input` | `#e2e8f0` | Input border |

## 2.6 Destructive / Error

| Token | Hex | Usage |
|---|---|---|
| `--destructive` | `#dc2626` | Delete/destructive/error |
| Error background | `#fef2f2` | Error surface |
| Error border | `#fecaca` | Error surface border |

Red is for real error/destructive states only.

## 2.7 Warning / Pending

| Token | Hex | Usage |
|---|---|---|
| Warning | `#f59e0b` | Warning/pending |
| Warning background | `#fffbeb` | Warning surface |
| Warning text | `#b45309` | Warning text |

---

# 3. Semantic Action Color Map

| Action / State | Required treatment |
|---|---|
| Buy Now / ซื้อทันที | Dark primary `#0f172a` + white |
| Add to Cart / เพิ่มลงตะกร้า | Emerald `#10B981` + white where appropriate |
| Cancel | Neutral outline/slate |
| Back | Ghost/neutral |
| Edit | Neutral/contextual |
| Save | Dark primary unless a more specific semantic applies |
| Confirm | Dark primary unless a stronger semantic applies |
| Delete | Red/destructive |
| Error | Red |
| Warning/Pending | Amber |
| Success | Emerald |
| Disabled | Muted slate |
| Selected/Active | Emerald accent where appropriate |
| Focus | Emerald ring `#10B981` |

### Critical rule: action-entry color continuity

If the user enters a Selection Sheet through a specific action, that same action keeps its semantic color inside the Sheet.

- Buy button outside = dark → Buy inside = dark
- Add to Cart outside = emerald → Add to Cart inside = emerald
- Product Options opened directly → show all 3 actions, each using its own semantic color

Do not make all Selection Sheet buttons the same color.

---

# 4. Buttons

## Primary

```tsx
<Button className="bg-slate-900 text-white hover:bg-slate-800">
  Action
</Button>
```

Use for:
- Buy Now
- Main CTA
- Strong confirmation

## Add to Cart

Use the existing Button/design-token system with the Velnox emerald semantic treatment:

- Background: `#10B981`
- Foreground: white where contrast is appropriate
- Hover: darker emerald
- Focus: emerald ring

Do not scatter arbitrary green values throughout components when a shared token exists.

## Secondary / Outline

```tsx
<Button variant="outline" className="border-slate-200 text-slate-700">
  Cancel
</Button>
```

## Ghost

```tsx
<Button variant="ghost" size="icon" className="size-10 text-slate-600">
  <Icon />
</Button>
```

## Destructive

```tsx
<Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
  Delete
</Button>
```

Button rules:
- Buttons: `rounded-squircle` (14px) — see §7.1. Never a pill, never a hard corner
- Use existing Button component
- Do not create duplicate button systems
- Do not use random gradients for normal buttons
- Do not use red for ordinary actions
- Do not make every button emerald

---

# 5. Cards and Surfaces

Standard:

```tsx
<div className="rounded-2xl border border-slate-200 bg-white p-5">
  {/* content */}
</div>
```

Elevated:

```tsx
<div className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
  {/* content */}
</div>
```

Surface hierarchy:

1. Page: `#f8fafc`
2. Card: `#ffffff`
3. Popover/Sheet: `#ffffff`
4. Muted: `#f1f5f9`
5. Border: `#e2e8f0`

Do not add colored card backgrounds unless they communicate a clear semantic state.

---

# 6. Shadows / Elevation

Use restrained elevation:

| Level | Utility | Usage |
|---|---|---|
| 0 | `shadow-none` | Flat content |
| 1 | `shadow-sm` | Subtle cards/controls |
| 2 | `shadow-md` | Elevated surfaces |
| 3 | `shadow-lg` | Modal/Sheet/high elevation |

Do not invent heavy multi-layer shadows for ordinary UI.

---

# 7. Border Radius

| Component | Pattern | ค่าจริง |
|---|---|---|
| Base | `--radius: 0.75rem` | 12px |
| Buttons | `rounded-squircle` (sm: `-sm`, lg: `-lg`) | 14px / 10px / 18px |
| Inputs | `rounded-squircle` | 14px |
| Cards | `rounded-squircle-lg` | 18px |
| Badges | `rounded-squircle-xs` | 7px |
| Avatars | `rounded-full` | — |
| Media frames (gallery, product image) | `rounded-squircle-lg` | 18px |
| Circles (dots, spinners, progress, switch thumb) | `rounded-full` | — |

**ค่าจริงที่วัดจาก CSS ที่ build แล้ว** (อย่าเดาจากค่า default ของ Tailwind):

| Class | ค่าที่คำนวณได้ |
|---|---|
| `rounded-sm` | `calc(var(--radius) - 4px)` = **8px** |
| `rounded-md` | `calc(var(--radius) - 2px)` = **10px** |
| `rounded-lg` | `var(--radius)` = **12px** |
| `rounded-xl` | `calc(var(--radius) + 4px)` = **16px** |
| `rounded-2xl` | `var(--radius-2xl)` = **16px** |
| `rounded-3xl` | `var(--radius-3xl)` = **24px** |

⚠️ `rounded-xl` กับ `rounded-2xl` ให้ผลเท่ากัน (16px) ในโปรเจกต์นี้ เพราะ `--radius-xl` ถูก override
เป็น `radius + 4px` แต่ `--radius-2xl` ยังเป็นค่า default ⇒ **เลือกใช้ตัวเดียว** (`rounded-2xl`)

**ห้ามเขียน `rounded-[10px]` / `rounded-[12px]` / `rounded-[16px]`** — ทั้งสามค่าเป็นค่าเดียวกับ
`rounded-md` / `rounded-lg` / `rounded-xl` เป๊ะ ๆ (เดิมเอกสารนี้เองสั่งให้ใช้ `rounded-[10px]`
ซึ่งขัดกับประโยค "Avoid arbitrary radius values" ถัดมา — แก้ 2026-11-10 หลังรวม 262 จุด)

ถ้าต้องใช้ค่าที่ไม่มีในระบบ (เช่น 2px/4px/6px/14px) ให้เพิ่ม token ใน `index.css` ก่อน ไม่ใช่พิมพ์ค่าดิบ

## 7.1 Squircle — รูปร่างประจำตัวของ Velnox

Velnox ไม่ได้ใช้ "วงกลม" หรือ "สี่เหลี่ยมคม" เป็นภาษารูปร่างหลัก แต่ใช้ **squircle** —
สี่เหลี่ยมผืนผ้าที่มุมมนจนดูกลม แต่ยังอ่านออกว่าเป็นสี่เหลี่ยม (radius ≈ 30% ของด้านสั้น)

เหตุผล: วงกลมเต็ม (`rounded-full`) บนปุ่มไอคอนทำให้ทุกอย่างดูเหมือน "chip ของ iOS"
ส่วนมุมคมทำให้ดูแข็งและไม่เข้ากับการ์ดที่มนอยู่แล้ว squircle ทำให้ปุ่ม ไอคอน ป้าย และการ์ด
อยู่ในตระกูลรูปร่างเดียวกัน

### Scale (ประกาศใน `packages/shared/src/index.css` → `@theme inline`)

| Token | ค่า | ใช้กับ |
|---|---|---|
| `rounded-squircle-xs` | **7px** | `Badge`, chip เล็ก, ตัวนับ (`12`), `kbd` |
| `rounded-squircle-sm` | **10px** | ปุ่มเล็ก `size="sm"`, ช่องค้นหา, chip ตัวกรอง, ปุ่มไอคอน `size-8`/`size-10` เล็ก, ปุ่มหัวใจบนการ์ด |
| `rounded-squircle` | **14px** | ปุ่มมาตรฐาน (`h-11`), `Input`, ปุ่มไอคอน `size-10`/`size-11`, toolbar ของ lightbox |
| `rounded-squircle-lg` | **18px** | ปุ่ม `size="lg"`, `Card`, กรอบรูปสินค้า/แกลเลอรี |

### กฎ

1. **ทุก control ที่ไม่ใช่วงกลมจริง = squircle** — อย่าใช้ `rounded-md` / `rounded-lg` / `rounded-xl`
   กับ control ใหม่ (ยังใช้ได้กับของเดิมที่ยังไม่ migrate)
2. **`rounded-full` สงวนไว้ให้ของที่เป็นวงกลมจริงเท่านั้น**: avatar, status dot, spinner,
   progress bar/ring, switch thumb, ปุ่มปิดแบบลอย (ถ้าตั้งใจให้กลม)
3. **เลือก step ตามขนาด ไม่ใช่ตามความชอบ** — badge 22px ต้องเป็น `-xs` (7px) ไม่ใช่ 14px
   เพราะ 14px บนกล่อง 22px จะกลายเป็นวงกลม
4. **ปุ่มไอคอนต้องจัดไอคอนกึ่งกลางด้วย `flex items-center justify-center`** — ถ้าไม่มี flex
   ไอคอน SVG จะวางบน text baseline แล้วลอยขึ้นบนในกรอบ (บั๊กที่เจอใน lightbox toolbar)
5. ห้ามเขียนค่า radius ดิบ (`rounded-[14px]`) — ใช้ token

### ตัวอย่าง

```tsx
// ปุ่มมาตรฐาน
<Button>ซื้อเลย</Button>                        // rounded-squircle (14px)

// ปุ่มไอคอนใน toolbar
<button className="flex size-10 items-center justify-center rounded-squircle border border-white/10 bg-white/10">
  <Share2 className="size-5" />
</button>

// ป้ายสถานะ
<Badge className="rounded-squircle-xs bg-emerald-50 text-emerald-700">Active</Badge>

// กรอบรูปสินค้า + แถบรูปย่อย (ต้อง radius เดียวกัน)
<div className="rounded-squircle-lg overflow-hidden">…</div>
```

### สถานะการ migrate

ทำแล้ว (2026-11-11): `Button`, `Badge`, `Input`, `Card`, `SegmentedOption`, `ProductGallery`
(กรอบหลัก + แถบ thumbnail), `GalleryLightbox` toolbar, `ShopHeader`, `CategoryStrip`,
`ProductCard`, `ProductActionBar`, `ShopProductDetail`.

ยังเหลือ (ทำเมื่อแตะหน้านั้นอยู่แล้ว): `Dialog`/`Sheet`/`Popover` surface, `Select`, `Textarea`,
`Tabs`, ตารางใน VelCenter, หน้า checkout/orders ของ VelShop, หน้า seller

---

# 8. Typography

Font:

```css
--font-sans: "Inter", "Noto Sans Thai", "Noto Sans Myanmar",
  system-ui, -apple-system, "Segoe UI", sans-serif;
```

Rules:
- Use `font-sans`
- Inter for Latin
- Noto Sans Thai for Thai
- Noto Sans Myanmar for Burmese
- Never use decorative fonts

### Type scale (แก้ 2026-11-10 — ตารางเดิมผิดทั้งหมด)

> **ตารางเดิมของเอกสารนี้บอก `text-xs` = 11px, `text-sm` = 12px, `text-base` = 14px ซึ่งผิด**
> Tailwind จริงคือ 12 / 14 / 16 ⇒ คนที่ทำตามเอกสารจึงต้องพิมพ์ `text-[11px]` เอง **295 ครั้ง**
> นี่คือต้นเหตุของความไม่สม่ำเสมอ

| ขนาดจริง | Class | ใช้เมื่อ |
|---|---|---|
| 11px | `text-2xs` | meta: badge, timestamp, helper, label ตัวพิมพ์ใหญ่ — **ตัวเล็กสุดที่อนุญาต** |
| 12px | `text-xs` | caption, secondary label |
| 14px | `text-sm` | **body หลักของ UI ทั้งระบบ** (ค่าเริ่มต้น) |
| 16px | `text-base` | เนื้อหายาวที่ต้องอ่านจริงจัง |
| 18px | `text-lg` | หัวข้อการ์ด / block |
| 20px | `text-xl` | หัวข้อ section |
| 24px | `text-2xl` | ชื่อหน้า |
| 30px | `text-3xl` | hero เท่านั้น |

### กฎที่ต้องจำ

1. **`text-2xs` ประกาศโดยไม่มี line-height คู่** ⇒ `text-2xs` ตั้งแค่ font-size เหมือน `text-[11px]`
2. **`text-xs` / `text-sm` / `text-base` ตั้ง line-height มาด้วย** ⇒ `text-[14px]` **ไม่เท่ากับ** `text-sm`
   (line-height ต่างกัน) ถ้าต้องการ pixels เดิมเป๊ะให้ใช้ชื่อ token ไม่ใช่ค่าดิบ
3. **ห้ามใช้ `text-[13px]` / `text-[15px]`** — ไม่มีในระบบ ถ้าจำเป็นให้เพิ่ม token ก่อน
4. **ห้ามใช้ `text-[8px]`** — เล็กกว่าขั้นต่ำที่อ่านออก (ยังเหลือ 2 จุดในโค้ด รอแก้ใน Phase D)
5. หนึ่งจอใช้ไม่เกิน 4 ขนาด — ถ้าเกินแปลว่าลำดับความสำคัญยังไม่ชัด
| 30px | `text-3xl` | Hero title |

Weights:
- 400 body
- 500 labels/navigation
- 600 card titles
- 700 headings
- 800 rare hero emphasis

---

# 9. Spacing and Layout

Preferred:
- Page: `px-4 py-8 sm:px-6 sm:py-10`
- Section: `mt-4`, `mt-6`, `mt-8`
- Card: `p-5`, `p-6`
- Item gaps: `gap-2`, `gap-3`, `gap-4`

Breakpoints:
- `sm:` 640px
- `md:` 768px
- `lg:` 1024px
- `xl:` 1280px

Mobile-first is mandatory.

---

# 10. Header and Navigation

## Header

- `sticky top-0 z-40`
- `bg-white/90 backdrop-blur`
- `border-b border-slate-200`
- approximately `h-14`

## Mobile Tab Bar

- `fixed bottom-0 inset-x-0 z-50`
- white background
- `border-t border-slate-200`
- Active: `text-[#10B981]`
- Inactive: `text-slate-400`

---

# 11. Product Options

Velnox distinguishes IMAGE and TEXT options.

## IMAGE option

Example: Color

- Show image thumbnail
- Show option label
- Selected state uses emerald accent/border/ring
- Image must come from the option-value/variant architecture

## TEXT option

Example: Storage, Version, Size

- Text only
- No thumbnail
- No empty image frame
- No broken image placeholder

## Variant identity

Always use IDs/UUIDs.

Never match by display text such as `Black`, `White`, `AI`.

Existing rule:

```text
optionValueImageMap[optionValue.id]
```

not:

```text
optionValueImageMap[optionValue.value]
```

---

# 12. Product Gallery

- Product Gallery is the normal product image source
- IMAGE option selection can determine the main image
- Thumbnail click/swipe returns control to unified gallery state
- Main image must remain synchronized with selected option
- Do not create a second independent gallery state
- Image priority must remain deterministic

---

# 13. Cart

Cart must visually communicate the selected Variant.

If a product has IMAGE options:
- Cart image must correspond to selected IMAGE option / Variant
- Do not always use `product.images[0]`
- Same product can have different Cart images for different variants

Quantity:
- Minimum: 1
- Maximum: current selected Variant stock
- Never hardcode maximum quantity as 1

Cart item identity must remain Variant-aware.

---

# 14. Selection Sheet

Current entry modes:

| Entry mode | Actions | Color |
|---|---|---|
| `options` | Buy + Add to Cart | Each action's semantic color |
| `buy` | Buy only | Dark primary |
| `cart` | Add to Cart only | Emerald |

Rules:
- Entry mode must be explicit
- Never infer mode from text, URL, or CSS
- Never use CSS hiding as a substitute for state
- Reuse existing action handlers
- Do not duplicate business logic

---

# 15. Notifications / Toasts

Use the existing central notification/toast system.

Preferred position:

**Top-left**

Desktop:
- roughly 16–24px from top/left

Mobile:
- roughly 12–16px
- respect safe-area insets

Semantic colors:
- Success = emerald
- Error = red
- Warning = amber
- Info/neutral = slate

UX:
- compact
- short
- non-blocking
- auto-dismiss when appropriate
- `aria-live`
- `role="status"` for routine status
- `role="alert"` for errors

Avoid long product names in success notifications.

Prefer:

`เพิ่มลงตะกร้าแล้ว (×2)`

Do not create multiple independent toast systems.

---

# 16. Badges / Status

Default:

```tsx
<Badge className="rounded-squircle-xs bg-slate-100 text-slate-600">
  Label
</Badge>
```

Success:

```tsx
<Badge className="rounded-squircle-xs bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
  Active
</Badge>
```

Warning:

```tsx
<Badge className="rounded-squircle-xs bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15">
  Pending
</Badge>
```

Status meanings must remain consistent across all Velnox apps.

---

# 17. Inputs / Forms

Default:

```tsx
<Input className="rounded-squircle border-slate-200" />
```

Error:

```tsx
<Input className="rounded-squircle border-red-500 focus-visible:ring-red-500" />
```

Rules:
- Normal border: slate-200
- Focus: emerald ring where appropriate
- Error: red
- Disabled: muted slate

---

# 18. Loading / Empty States

Spinner:

```tsx
<Loader2 className="size-4 animate-spin" />
```

Skeleton:

```tsx
<Skeleton className="h-32 rounded-2xl" />
<Skeleton className="h-6 w-44" />
```

Skeletons should remain neutral slate.

Empty-state icon container:
- `bg-slate-100`
- icon `text-slate-400`
- heading `text-slate-900`
- description `text-slate-500`
- CTA uses primary dark unless another semantic applies

---

# 19. Icons

Use Lucide React consistently.

Standard sizes:
- `size-3`
- `size-3.5`
- `size-4`
- `size-5`
- `size-7`

Typical colors:
- Inactive: `text-slate-400`
- Neutral active: `text-slate-600`
- Brand/selected: `text-[#10B981]`
- Error: red
- Warning: amber

---

# 20. Gradients

Gradients are reserved for branded visual areas.

Cover fallback:

```tsx
className="bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399]"
```

Avatar fallback:

```tsx
className="bg-[#ECFDF5] text-3xl font-bold text-[#10B981]"
```

Do not introduce additional gradient palettes for ordinary UI.

---

# 21. Dark Mode

Dark-mode tokens exist, but the current Velnox product experience is primarily light mode.

Do not redesign the product around dark mode unless explicitly requested.

When touching dark-mode code, preserve the existing token architecture.

---

# 22. Accessibility

Every color must have a functional reason.

Requirements:
- readable text/background contrast
- visible focus state
- distinguish disabled from active
- do not communicate important state by color alone
- errors need readable text, not only red borders
- labels must remain readable in TH/EN/MY

---

# 23. Internationalization

Supported:
- Thai: `th`
- English: `en`
- Burmese: `my`

All user-facing text must use the existing i18n system.

Never render raw translation keys such as:

`productDetail.addToCart`

If a translation is missing, fix the dictionary/key mapping.

Language changes must update visible UI without requiring a full page refresh.

---

# 24. App Scope

This design system applies to:

- **VelShop** — customer marketplace
- **VelSeller** — merchant dashboard
- **VelCenter** — administration
- **Velnox** — main ecosystem application

Screens can differ in layout, but semantic colors and visual language should remain consistent.

---

# 25. AI Rules — DO NOT

Before changing UI, search for existing components and tokens.

Do NOT:
1. Invent colors when an existing semantic token applies
2. Replace Velnox emerald with another green
3. Replace Buy dark with green
4. Make Add to Cart dark just because it is inside a Sheet
5. Use random radius values
6. Add heavy custom shadows
7. Create duplicate Button/Card/Toast systems
8. Hardcode user-facing text
9. Match variants by display names instead of IDs
10. Reintroduce Convex
11. Reintroduce Cloudinary
12. Create a new storage system
13. Break unified Product Gallery state
14. Break Selection Sheet entry modes
15. Break Variant stock logic
16. Treat product-level stock as source of truth when variants exist
17. Add product-level inventory UI back into Seller

---

# 26. AI UI Change Checklist

Before finishing a UI task:

- [ ] Read this file
- [ ] Search for existing component/token
- [ ] Use semantic colors
- [ ] Buy = dark primary
- [ ] Add to Cart = emerald
- [ ] Error = red
- [ ] Warning = amber
- [ ] Success = emerald
- [ ] Focus = emerald ring
- [ ] Cards = white/slate surfaces
- [ ] Borders = slate-200 family
- [ ] Radius follows system
- [ ] **Control ใหม่ทุกตัวเป็น squircle** (`rounded-squircle-xs|sm|` / `-lg`) ตาม §7.1
- [ ] `rounded-full` ใช้เฉพาะของที่เป็นวงกลมจริง (avatar, dot, spinner, progress, switch thumb)
- [ ] ปุ่มไอคอนมี `flex items-center justify-center` ให้ไอคอนอยู่กลางกรอบ
- [ ] Shadows follow system
- [ ] **ไม่มี arbitrary value `[...]` สำหรับสี / radius / font-size** — ใช้ token
      (`*-brand`, `rounded-md|lg|xl|2xl`, `text-2xs|xs|sm|base|lg|xl|2xl|3xl`)
- [ ] สีแบรนด์ใช้ `*-brand` ไม่ใช่ `[#10B981]`
- [ ] ขนาดตัวอักษรมาจาก type scale เท่านั้น (ไม่มี `text-[13px]` / `text-[15px]` / `text-[8px]`)
- [ ] Mobile checked
- [ ] TH/EN/MY checked
- [ ] No raw translation key in UI
- [ ] No duplicate system created
- [ ] Existing business logic preserved

---

# 27. Source-of-Truth Principle

When implementation and this document disagree:

1. Inspect the current implementation and shared tokens.
2. Determine whether the implementation contains an intentional newer design decision.
3. If it is correct and should become standard, update this document in the same change.
4. Otherwise restore the documented design token/pattern.

The goal is not just to make one screen look good. The goal is to keep all Velnox applications visually consistent as the project grows and different AI agents modify the code.

---

## Version

**Velnox Design System v2.2** (2026-11-11)

### Changelog v2.1 → v2.2 — Squircle shape language

รอบนี้เป็นการ**เปลี่ยนรูปร่างจริง** (ไม่ใช่แค่แก้เอกสาร) — กำหนด squircle เป็นรูปร่างประจำตัว
ของ Velnox และเปลี่ยน primitive ที่ทุกหน้าใช้ร่วมกัน

| แก้ | เดิม | ใหม่ |
|---|---|---|
| Radius tokens (§7.1) | ไม่มี | `--radius-squircle-xs/sm//lg` = 7 / 10 / 14 / 18px |
| `Button` (§4) | `rounded-md` (10px) | `rounded-squircle` (14px) · sm → 10px · lg → 18px |
| `Badge` (§16) | `rounded-full` (pill) | `rounded-squircle-xs` (7px) |
| `Input` (§17) | `rounded-md` (10px) | `rounded-squircle` (14px) |
| `Card` (§5) | `rounded-xl` (16px) | `rounded-squircle-lg` (18px) |
| Gallery frames (§12) | `rounded-2xl` (16px) | `rounded-squircle-lg` (18px) — กรอบหลัก + แถบ thumbnail ใช้ตัวเดียวกัน |
| `SegmentedOption` | `rounded-md` / `rounded-full` | `rounded-squircle-sm` / `rounded-squircle` |
| Shop header, category chips, product card, action bar | ผสม `rounded-full` / `rounded-md` | squircle ตามขนาด |
| Checklist (§26) | ไม่มีข้อเรื่องรูปร่าง | เพิ่ม 3 ข้อ (squircle / circle exception / icon centring) |

`rounded-full` ยังใช้ได้ แต่**เฉพาะของที่เป็นวงกลมจริง**: avatar, status dot, spinner,
progress bar/ring, switch thumb

### Changelog v2.0 → v2.1

ทั้งหมดนี้เกิดจากการวัดโค้ดจริง ไม่ใช่การรีดีไซน์ — **ไม่มีพิกเซลใดเปลี่ยน**

| แก้ | เดิม | ใหม่ |
|---|---|---|
| Type scale (§8) | `text-xs`=11px · `text-sm`=12px · `text-base`=14px (ผิดทั้งหมด) | 12 / 14 / 16 ตาม Tailwind จริง + เพิ่ม `text-2xs`=11px |
| Radius (§7) | สั่งใช้ `rounded-[10px]` ทั้งที่บรรทัดถัดมาห้าม arbitrary | `rounded-md` (ค่าเท่ากันเป๊ะ) |
| สีแบรนด์ (§2.3) | ไม่มี token | `--brand` + `*-brand` utilities |
| Checklist (§26) | ไม่มีข้อห้าม arbitrary | เพิ่ม 3 ข้อ |

**ผลที่วัดได้:** 262 ค่า radius · 302 ค่า hex · 295 ขนาดตัวอักษร ถูกแทนด้วย token ใน Phase A

Based on the current `VELNOX_DESIGN_THEME.md` in `EnJirad/velnox-marketplace` and the project's current documented UI architecture.
