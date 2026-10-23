# VELNOX_DESIGN_THEME.md — Velnox Design System v2.0

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
| Emerald Primary | `#10B981` | Brand, active state, Add to Cart |
| Emerald Dark | `#0f766e` | Strong emerald / gradient start |
| Emerald Mid | `#10B981` | Main gradient |
| Emerald Light | `#34d399` | Gradient end |
| Emerald BG | `#ECFDF5` | Soft emerald background |
| Emerald Text | `#047857` | Text on emerald-soft surfaces |

**Add to Cart / เพิ่มลงตะกร้า = Velnox emerald.**

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
| VelRepeat | Existing VelRepeat component/brand styling |
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
- VelRepeat outside = VelRepeat color → VelRepeat inside = same color
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
- Buttons: approximately `rounded-[10px]`
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

| Component | Pattern |
|---|---|
| Base | `0.75rem` |
| Buttons | `rounded-[10px]` |
| Inputs | `rounded-[10px]` |
| Cards | `rounded-2xl` / `rounded-3xl` |
| Badges | `rounded-full` |
| Avatars | `rounded-full` |
| Pills | `rounded-full` |

Avoid arbitrary radius values unless an existing component specifically requires them.

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

| Size | Class | Usage |
|---|---|---|
| 11px | `text-xs` | Caption/badge/timestamp |
| 12px | `text-sm` | Secondary text |
| 14px | `text-base` | Body |
| 16px | `text-lg` | Subheading |
| 18px | `text-xl` | Section heading |
| 24px | `text-2xl` | Page title |
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
| `options` | Buy + Add to Cart + VelRepeat | Each action's semantic color |
| `buy` | Buy only | Dark primary |
| `cart` | Add to Cart only | Emerald |
| `velrepeat` | VelRepeat only | Existing VelRepeat color |

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
<Badge className="rounded-full bg-slate-100 text-slate-600">
  Label
</Badge>
```

Success:

```tsx
<Badge className="rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
  Active
</Badge>
```

Warning:

```tsx
<Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15">
  Pending
</Badge>
```

Status meanings must remain consistent across all Velnox apps.

---

# 17. Inputs / Forms

Default:

```tsx
<Input className="rounded-[10px] border-slate-200" />
```

Error:

```tsx
<Input className="rounded-[10px] border-red-500 focus-visible:ring-red-500" />
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
- [ ] VelRepeat = existing VelRepeat style
- [ ] Error = red
- [ ] Warning = amber
- [ ] Success = emerald
- [ ] Focus = emerald ring
- [ ] Cards = white/slate surfaces
- [ ] Borders = slate-200 family
- [ ] Radius follows system
- [ ] Shadows follow system
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

**Velnox Design System v2.0**

Based on the current `VELNOX_DESIGN_THEME.md` in `EnJirad/velnox-marketplace` and the project's current documented UI architecture.
