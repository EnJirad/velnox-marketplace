# Phase 2 — Design Direction & Implementation Plan

**Scope:** VelShop first (primary e-commerce storefront) → Velseller → VelCenter → Velnox Corporate

---

## 1. VelShop Design Direction

### Brand Promise
> "Professional marketplace that feels trustworthy, fast, and easy — competitive with Lazada/Shopee on UX quality, not just features."

### Visual Language (from existing tokens)
- **Background**: `#f8fafc` (slate-50) page, `#ffffff` cards
- **Primary text**: `#0f172a` (slate-900)
- **Buy Now / primary action**: `bg-slate-900 text-white` (dark, weighty)
- **Add to Cart / brand accent**: `bg-[#10B981] text-white` (emerald)
- **Focus ring**: `#10b981` emerald
- **Radius**: `rounded-xl` (10px) for cards, `rounded-2xl` for hero
- **Shadows**: restrained `shadow-sm` cards, `shadow-xl` modals
- **Typography**: Inter + Noto Sans Thai/Myanmar, weights 400/500/600/700
- **Spacing scale**: 4, 6, 8, 12, 16, 24, 32, 48 (Tailwind defaults)

### Key UX Principles
1. **Server-driven data** — no client-side pagination of full catalog
2. **One visual grammar** — shared section-header, empty-state, skeleton components
3. **Keyboard-first** — visible focus on every interactive element
4. **Touch targets ≥ 44px** — mobile buttons, tabs, cards
5. **No dead code** — remove unused imports, dead feature flags

---

## 2. Page-by-Page Redesign Priority (VelShop)

### P0 — Critical (Broken/Unusable)
| Page | Problem | Fix |
|------|---------|-----|
| `/products` | Client-side pagination of 100 items | Server pagination + cursor |
| `/products/:id` | No image zoom/lightbox | Add gallery lightbox |
| `/checkout` | 1238 lines monolith | Split: AddressStep, PaymentStep, SummarySidebar |

### P1 — Major Usability
| Page | Problem | Fix |
|------|---------|-----|
| `/` (Home) | 5 rails with duplicated header code | Shared `SectionHeader` component |
| `/cart` | Selection UX inconsistent | Unify select-all/shop/item |
| All pages | Focus-visible missing on cards/buttons | Global `focus-visible:ring-2 ring-emerald-500/40` |
| `/products` | Filter panel UX poor on mobile | Sheet-based filter drawer |

### P2 — Visual Hierarchy
| Page | Problem | Fix |
|------|---------|-----|
| All | `rounded-[10px]` scattered | Replace with `rounded-xl` |
| All | `ShopFooter` imported but null | Remove dead imports |
| `/profile` | "Session" group label | Rename to user-facing term |

### P3 — Polish
| Page | Problem | Fix |
|------|---------|-----|
| `/help` | Static content only | Acceptable v1 |
| All | Unused Lucide imports | Tree-shake |

---

## 3. Shared Component Library (New)

| Component | Purpose | Location |
|-----------|---------|----------|
| `SectionHeader` | Icon + title + desc + "View all" link | `packages/shared/components/ui/section-header.tsx` |
| `EmptyState` | Icon circle + title + description + optional CTA | `packages/shared/components/ui/empty-state.tsx` |
| `LoadingSkeleton` | Consistent skeleton for cards/tables/lists | `packages/shared/components/ui/loading-skeleton.tsx` |
| `ProductGrid` | Server-paginated grid with loading/error/empty | `packages/shared/components/shop/ProductGrid.tsx` |
| `GalleryLightbox` | Pinch-zoom, swipe, keyboard nav | `packages/shared/components/shop/GalleryLightbox.tsx` |

---

## 4. Implementation Sequence (VelShop)

### Group 1: Foundation (1-2 days)
1. Create shared components above
2. Add global focus-visible CSS
3. Replace `rounded-[10px]` → `rounded-xl` project-wide
4. Remove dead `ShopFooter` imports

### Group 2: Homepage & Catalog (2-3 days)
5. Refactor `/` using `SectionHeader`, `ProductGrid`
6. Server-paginate `/products` (API already supports cursor)
7. Mobile filter drawer (Sheet)

### Group 3: Product Detail (2 days)
8. Integrate `GalleryLightbox`
9. Variant selection UX polish
10. Reviews section — load on demand

### Group 4: Cart & Checkout (3-4 days)
11. Split `ShopCheckout.tsx` into step components
12. Cart selection UX unify
13. Address form — inline validation
14. Payment method selector — radio group with icons
15. Order summary sidebar (sticky on desktop)

### Group 5: Account & Polish (1-2 days)
16. Profile page — rename "Session" group
17. Wishlist — use `ProductGrid`
18. Orders list — `ProductGrid` pattern
19. Final accessibility audit

---

## 5. Acceptance Criteria Per Group

| Group | Must Pass |
|-------|-----------|
| 1 | Typecheck ✓, no console errors, focus ring visible on all buttons/links/cards |
| 2 | `/products` loads 24 items/page, infinite scroll or pagination works, mobile filter drawer opens/closes |
| 3 | Product images open lightbox, pinch-zoom works, keyboard arrows navigate |
| 4 | Checkout completes in < 5 steps, address validation inline, payment method clear, summary sticky |
| 5 | Lighthouse accessibility ≥ 95, no horizontal overflow at 320-1440px |

---

## 6. Velseller / VelCenter / Velnox — Preview

### Velseller (after VelShop)
- Fix 768-1023px nav gap (show tab bar until `lg`)
- Split `SellerOrderDetail` → `OrderHeader` + `OrderItems` + `FulfilmentActions` + `ShipmentDialog`
- KPI cards on Goals/Income with visual hierarchy
- Mobile order table → card layout

### VelCenter (after Velseller)
- **Split `Center.tsx` (2708 lines)** → route per tab: `/users`, `/sellers`, `/products`, `/orders`, `/categories`, `/chat`, `/audit`, `/settings`
- Lazy-load each tab
- Add mobile hamburger + drawer nav
- Constrain content `max-w-7xl`

### Velnox Corporate (parallel, quick)
- Add i18n (th/en/my) — reuse shared `LanguageProvider`
- Add hero imagery/illustrations
- Dynamic meta tags per page
- Content pages: card-based layout instead of text blocks

---

## 7. Technical Constraints

- **No new dependencies** — use existing: Radix UI, Tailwind v4, lucide-react, sonner
- **Preserve all API contracts** — `useAction`, `apiRoutes`, backend unchanged
- **No mock data** — every number from real API
- **i18n parity** — `bun run i18n:check` must pass (1702 × 3 keys)
- **Typecheck** — `bun run typecheck` must pass all 4 apps

---

## 8. Start Signal

**Ready to begin Group 1 (Foundation)** — creating shared components and global focus styles.

First deliverable: `packages/shared/components/ui/section-header.tsx`, `empty-state.tsx`, `loading-skeleton.tsx` + global CSS focus-visible.
