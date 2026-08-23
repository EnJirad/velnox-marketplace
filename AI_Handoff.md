# AI_Handoff.md — Velnox Project Reference

## Project Overview

Velnox is an E-Commerce Marketplace with 3 frontend applications:
- **VelShop** — Customer storefront (src/)
- **VelSeller** — Merchant management (apps/seller/)
- **VelCenter** — Admin management (apps/center/)

## Architecture Rules (MUST FOLLOW)

1. **Neon = Source of Truth** — All business data lives in Neon PostgreSQL
2. **Render = Backend** — Express API, auth, business logic
3. **Vercel = Frontend** — React + Vite apps, no secrets
4. **R2 = File Storage** — Images, documents, media files
5. **NO Convex** — Do not add Convex to this project
6. **NO Cloudinary** — Do not add Cloudinary to this project
7. **NO additional databases** — Single Neon database only
8. **Browser cannot connect to Neon** — All DB access through backend API
9. **All schema changes require migration** — Update schema.sql, run-sqleditor.sql
10. **All API calls go through backend** — Frontend never talks to DB directly
11. **No secrets in frontend** — Only VITE_API_URL is public
12. **ONE PERSON = ONE USER** — Identity resolution prevents duplicate accounts
13. **i18n required** — All user-facing text uses t("key") pattern
14. **Default language = Thai** — SUPPORTED: th, en, my

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion |
| i18n | Custom context-based system (th, en, my) |
| Currency | THB, USD, MMK (separate from language) |
| Backend | Node.js, Express, TypeScript, pg |
| Database | Neon PostgreSQL (single DB, domain-separated) |
| Storage | Cloudflare R2 (presigned URLs) |
| Auth | Google OAuth 2.0 + JWT + httpOnly cookies |

## Frontend Apps

### VelShop (src/)
Customer-facing marketplace with:
- Landing page, product listings, product detail
- Cart, checkout, orders
- Profile, addresses, favorites
- Google OAuth authentication
- Mobile-first responsive design

### VelSeller (apps/seller/)
Merchant management with:
- Dashboard with stats
- Product management (CRUD)
- Order management
- Shop settings
- Desktop-first responsive design

### VelCenter (apps/center/)
Admin management with:
- Dashboard with platform stats
- User management
- Seller management
- Order management
- System settings
- Desktop-first responsive design

## Shared Packages

| Package | Purpose |
|---------|---------|
| `@velnox/i18n` | Translation system, language selector |
| `@velnox/api` | Centralized API client |
| `@velnox/types` | Shared TypeScript types |
| `@velnox/hooks` | useAuth, useCart, useIsMobile |
| `@velnox/utils` | formatPrice, formatDate, slugify |
| `@velnox/ui` | LoadingSpinner, EmptyState, ErrorState, Skeleton, LanguageSelector, CurrencySelector, ProductCard, AvatarUpload |

## i18n System

### Supported Languages
- **th** (Thai) — Default
- **en** (English)
- **my** (Burmese)

### Usage
```tsx
import { useI18n } from "@velnox/i18n";

function MyComponent() {
  const { t, locale, setLocale } = useI18n();
  return <button>{t("common.login")}</button>;
}
```

### Translation Files
- `packages/i18n/src/locales/th.json`
- `packages/i18n/src/locales/en.json`
- `packages/i18n/src/locales/my.json`

### Language Persistence
Stored in `localStorage` as `velnox_locale`.

## Currency System

Supported: THB, USD, MMK

Currency is independent from language. Changing language does NOT change currency.

Stored in `localStorage` as `velnox_currency`.

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | VelShop entry with I18nProvider |
| `src/pages/Landing.tsx` | Landing page (i18n-enabled) |
| `src/components/layout/Header.tsx` | Header with language/currency selectors |
| `packages/i18n/src/index.tsx` | i18n context and hook |
| `packages/api/src/index.ts` | Centralized API client |
| `packages/types/src/index.ts` | All shared types |
| `packages/hooks/src/index.ts` | useAuth, useCart hooks |
| `backend/src/index.ts` | Express server entry |

## Environment Variables

### Frontend (Vercel)
```
VITE_API_URL=
```

### Backend (Render)
```
DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET, R2_PUBLIC_DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
JWT_SECRET, PORT, CORS_ORIGINS
```

## Build Scripts

```bash
bun run dev:shop       # VelShop dev server (port 5173)
bun run dev:seller     # VelSeller dev server (port 5174)
bun run dev:center     # VelCenter dev server (port 5175)
bun run typecheck      # Typecheck all apps
bun run build:shop     # Build VelShop
bun run build:seller   # Build VelSeller
bun run build:center   # Build VelCenter
```
