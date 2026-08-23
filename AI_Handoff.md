# AI_Handoff.md — Velnox Project Reference

## Architecture

3 frontend apps → Render Backend API → Neon PostgreSQL + Cloudflare R2

| App | Purpose | Port | Build |
|-----|---------|------|-------|
| VelShop | Customer storefront | 5173 | `apps/shop/` or root `src/` |
| VelSeller | Merchant management | 5174 | `apps/seller/` |
| VelCenter | Admin management | 5175 | `apps/center/` |

## Shared Packages

| Package | Purpose |
|---------|---------|
| `@velnox/i18n` | Translation system (th, en, my) |
| `@velnox/api` | Centralized API client |
| `@velnox/types` | Shared TypeScript types |
| `@velnox/hooks` | useAuth, useCart, useIsMobile |
| `@velnox/utils` | formatPrice, formatDate, etc. |
| `@velnox/ui` | LanguageSelector, CurrencySelector, ProductCard, etc. |

## Rules

1. Neon = Source of Truth
2. Render = Backend
3. Vercel = Frontend
4. R2 = File Storage
5. NO Convex, NO Cloudinary
6. ONE PERSON = ONE USER
7. All API calls through backend
8. No secrets in frontend
9. i18n required for all user-facing text

## i18n

- Thai (th) = default
- English (en)
- Burmese (my)
- Currency: THB, USD, MMK (independent from language)

## Key Files

- `src/main.tsx` — VelShop entry (root)
- `apps/shop/src/main.tsx` — VelShop entry (standalone)
- `packages/i18n/src/locales/*.json` — Translations
- `packages/api/src/index.ts` — API client
- `packages/hooks/src/index.ts` — Auth & cart hooks
- `packages/types/src/index.ts` — All shared types

## Build

```bash
bun run build:shop     # Root VelShop
bun run build:seller   # apps/seller
bun run build:center   # apps/center
bun run typecheck      # All
```
