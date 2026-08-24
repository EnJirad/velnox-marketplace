# VELNOX_DESIGN_THEME.md — Velnox Design System v1.0

**SOURCE OF TRUTH for all Velnox UI/UX work.**

Whenever an AI works on UI/UX, it MUST read this file before modifying or creating UI.

---

## Color Palette

### Primary Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#f8fafc` | Page background |
| `--foreground` | `#0f172a` | Primary text (slate-900) |
| `--primary` | `#0f172a` | Primary buttons, headings (slate-900) |
| `--primary-foreground` | `#ffffff` | Text on primary buttons |

### Secondary Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--secondary` | `#f1f5f9` | Secondary backgrounds (slate-100) |
| `--secondary-foreground` | `#1e293b` | Text on secondary (slate-800) |

### Accent Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#ecfdf5` | Accent backgrounds, highlights (emerald-50) |
| `--accent-foreground` | `#047857` | Accent text (emerald-700) |
| `--ring` | `#10b981` | Focus rings, primary accent (emerald-500) |

### Muted Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--muted` | `#f1f5f9` | Muted backgrounds (slate-100) |
| `--muted-foreground` | `#64748b` | Muted text (slate-500) |

### Destructive Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--destructive` | `#dc2626` | Delete actions, errors (red-600) |

### Border & Input Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--border` | `#e2e8f0` | Borders (slate-200) |
| `--input` | `#e2e8f0` | Input borders (slate-200) |

### Card Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--card` | `#ffffff` | Card backgrounds |
| `--card-foreground` | `#0f172a` | Card text |

### Popover Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--popover` | `#ffffff` | Popover/dropdown backgrounds |
| `--popover-foreground` | `#0f172a` | Popover text |

### Chart Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--chart-1` | `#10b981` | Chart primary (emerald-500) |
| `--chart-2` | `#0f172a` | Chart secondary (slate-900) |
| `--chart-3` | `#f59e0b` | Chart tertiary (amber-500) |
| `--chart-4` | `#64748b` | Chart quaternary (slate-500) |
| `--chart-5` | `#059669` | Chart quinary (emerald-600) |

### Brand Accent Colors (used in components)

| Color | Hex | Usage |
|-------|-----|-------|
| Emerald Primary | `#10B981` | Brand accent, active states, badges |
| Emerald Dark | `#0f766e` | Cover gradients start |
| Emerald Mid | `#10B981` | Cover gradients middle |
| Emerald Light | `#34d399` | Cover gradients end |
| Emerald BG | `#ECFDF5` | Badge backgrounds |
| Emerald Text | `#047857` | Badge text (emerald-700) |

---

## Typography

### Font Family

```css
--font-sans: "Inter", "Noto Sans Thai", "Noto Sans Myanmar", system-ui, -apple-system, "Segoe UI", sans-serif;
```

**Rules:**
- Use `font-sans` class for all text
- Inter for Latin characters
- Noto Sans Thai for Thai text
- Noto Sans Myanmar for Burmese text
- Never use decorative fonts

### Font Weights

| Weight | Class | Usage |
|--------|-------|-------|
| Regular (400) | `font-normal` | Body text |
| Medium (500) | `font-medium` | Labels, navigation |
| Semibold (600) | `font-semibold` | Subheadings, card titles |
| Bold (700) | `font-bold` | Headings, page titles |
| Extra Bold (800) | `font-extrabold` | Hero text (rare) |

### Font Sizes

| Size | Class | Usage |
|------|-------|-------|
| xs (11px) | `text-xs` | Timestamps, captions, badges |
| sm (12px) | `text-sm` | Secondary text, descriptions |
| base (14px) | `text-base` | Body text |
| lg (16px) | `text-lg` | Subheadings |
| xl (18px) | `text-xl` | Section headings |
| 2xl (24px) | `text-2xl` | Page titles |
| 3xl (30px) | `text-3xl` | Hero titles (responsive) |

---

## Spacing & Layout

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius` | `0.75rem` | Base radius |
| `--radius-sm` | `calc(var(--radius) - 4px)` | Small radius |
| `--radius-md` | `calc(var(--radius) - 2px)` | Medium radius |
| `--radius-lg` | `var(--radius)` | Large radius |
| `--radius-xl` | `calc(var(--radius) + 4px)` | Extra large radius |

**Common patterns:**
- Buttons: `rounded-[10px]`
- Cards: `rounded-2xl` or `rounded-3xl`
- Inputs: `rounded-[10px]`
- Badges: `rounded-full`
- Avatars: `rounded-full`

### Shadows

Use Tailwind shadow utilities:
- `shadow-sm` — Subtle card shadows
- `shadow-md` — Medium elevation
- `shadow-lg` — High elevation (modals)

### Common Spacing

- Page padding: `px-4 py-8 sm:px-6 sm:py-10`
- Section spacing: `mt-4`, `mt-6`, `mt-8`
- Card padding: `p-5`, `p-6`
- Gap between items: `gap-2`, `gap-3`, `gap-4`

---

## Component Patterns

### Buttons

```tsx
// Primary button
<Button className="bg-slate-900 text-white hover:bg-slate-800">
  Action
</Button>

// Secondary button
<Button variant="outline" className="border-slate-200 text-slate-700">
  Cancel
</Button>

// Ghost button
<Button variant="ghost" size="icon" className="size-10 text-slate-600">
  <Icon />
</Button>

// Destructive button
<Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
  Delete
</Button>
```

### Cards

```tsx
<div className="rounded-2xl border border-slate-200 bg-white p-5">
  {/* Card content */}
</div>

{/* Elevated card */}
<div className="rounded-3xl border border-slate-200 bg-white overflow-hidden">
  {/* Content with header/body */}
</div>
```

### Inputs

```tsx
<Input
  className="rounded-[10px] border-slate-200"
  placeholder="..."
/>

{/* With error state */}
<Input
  className="rounded-[10px] border-red-500 focus-visible:ring-red-500"
/>
```

### Badges

```tsx
// Default badge
<Badge className="rounded-full bg-slate-100 text-slate-600">
  Label
</Badge>

// Success badge
<Badge className="rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
  Active
</Badge>

// Warning badge
<Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15">
  Pending
</Badge>
```

### Skeleton Loading

```tsx
<Skeleton className="h-32 rounded-2xl" />
<Skeleton className="h-6 w-44" />
```

### Empty States

```tsx
<div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
  <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
    <Icon className="size-7 text-slate-400" />
  </span>
  <h2 className="mt-5 text-lg font-semibold text-slate-900">Title</h2>
  <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">Description</p>
  <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800">
    Action
  </Button>
</div>
```

---

## Navigation Patterns

### Header

- Sticky top: `sticky top-0 z-40`
- Border: `border-b border-slate-200`
- Background: `bg-white/90 backdrop-blur`
- Height: `h-14`

### Mobile Tab Bar

- Fixed bottom: `fixed bottom-0 inset-x-0 z-50`
- Background: `bg-white border-t border-slate-200`
- Active color: `text-[#10B981]`
- Inactive color: `text-slate-400`

### Profile Menu

- Uses `SECTIONS` array with `to`, `labelKey`, `descKey`, `icon`
- Each row: icon in rounded square + label + description + chevron
- Active state: `hover:bg-[#F8FAFC]`

---

## Loading & Error States

### Loading Spinner

```tsx
<Loader2 className="size-4 animate-spin" />
```

### Error Toast

```tsx
toast.error("Error message")
```

### Success Toast

```tsx
toast.success("Success message")
```

---

## Responsive Design

### Breakpoints

- `sm:` — 640px (small tablets)
- `md:` — 768px (tablets)
- `lg:` — 1024px (desktops)
- `xl:` — 1280px (large screens)

### Common Patterns

- Mobile-first: base styles are mobile, `sm:` and above for larger
- Page max-width: `max-w-4xl` or `max-w-6xl`
- Grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- Hide on mobile: `hidden md:block`
- Show on mobile only: `md:hidden`

---

## Gradients

### Cover Image Gradient (when no cover image)

```tsx
className="bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399]"
```

### Avatar Fallback

```tsx
className="bg-[#ECFDF5] text-3xl font-bold text-[#10B981]"
```

---

## Icon Usage

- Use Lucide React icons consistently
- Standard sizes: `size-3`, `size-3.5`, `size-4`, `size-5`, `size-7`
- Colors: `text-slate-400` (inactive), `text-slate-600` (active), `text-[#10B981]` (brand)

---

## Dark Mode

Dark mode tokens are defined in `.dark` CSS class using oklch color space. The system supports dark mode via the `dark:` Tailwind variant, but the current Velnox apps use light mode primarily.

---

## Design Rules

1. **NEVER invent colors** — use only tokens defined above
2. **NEVER use random border-radius** — use the defined patterns
3. **NEVER create custom components** when shadcn/ui has one
4. **ALWAYS use existing design tokens** from `index.css`
5. **ALWAYS follow the spacing patterns** above
6. **ALWAYS use consistent typography** — don't mix font sizes
7. **ALWAYS match existing component styles** in the codebase
8. **Search for existing components** before creating new ones
