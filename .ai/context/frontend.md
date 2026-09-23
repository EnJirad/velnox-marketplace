# FRONTEND — Design, Theme, Responsive, i18n

Source of truth: `VELNOX_DESIGN_THEME.md` (v2.0). This file is the AI navigation layer.

## Where Frontend Code Lives

- Apps: `apps/velshop|velseller|velcenter|velnox` — `src/main.tsx` (router), `src/pages/`, `src/components/` (app-local only).
- Shared: `packages/shared/src` via the `@velnox/shared/*` Vite alias — `components/ui/` (shadcn/ui), `hooks/`, `lib/`, `pages/`.
- Reuse a shared component before writing an app-local one; never stand up a second component or theme system. Full map: `project-map.md`.

## Principles

White surfaces, `#f8fafc` page, `#0f172a` primary text/actions, `#10B981` emerald brand/Add-to-Cart, restrained borders/shadows, rounded cards (`rounded-2xl`/`rounded-[10px]`), mobile-first.

## Semantic Colors

| Use | Token |
|-----|-------|
| Buy Now | `bg-slate-900 text-white` |
| Add to Cart | `bg-[#10B981] text-white` |
| Success/active | emerald (`#10B981`, `#ECFDF5`) |
| Destructive/error | red (`#dc2626`) |
| Warning/pending | amber (`#f59e0b`) |
| Focus | emerald ring |

Do not invent brand colors; search existing tokens/components first.

## Building Blocks

- **Components:** `packages/shared/src/components/ui/` (shadcn/ui + Radix). Reuse `Button`, `Card`, `Badge`, `Input`, `Dialog`, `Sheet`.
- **Typography:** `Inter` + `Noto Sans Thai`/`Myanmar`; weights 400/500/600/700.
- **Spacing:** `px-4 py-8 sm:px-6 sm:py-10`, gaps `gap-2`–`gap-4`, `p-5`–`p-6` for cards.
- **Header:** `sticky top-0 z-40 bg-white/90 backdrop-blur border-b`; mobile tab bar `fixed bottom-0` with emerald active.
- **i18n:** `packages/shared/src/lib/i18n/` — `th`/`en`/`my`; never render raw keys; language switch updates UI without full reload.

## Product-Specific

- Options: IMAGE (thumbnail + emerald selected ring) vs TEXT (no thumbnail). Match by `optionValue.id`, never display text.
- Gallery: single unified state; variant selection drives image priority.
- Cart: image reflects selected variant; quantity `1` … `variant.stock`.

## Checklist Before Completing UI Work

Semantic colors correct, tokens reused, radius/shadows per system, mobile + TH/EN/MY checked, no duplicate component system, no raw i18n key, existing business logic preserved.

Full spec: `VELNOX_DESIGN_THEME.md`, `packages/shared/src/index.css`.
