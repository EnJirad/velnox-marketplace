# AI_Handoff.md — Velnox Project Reference

## Architecture

```
                    Vercel (Frontend)
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       VelShop     VelSeller    VelCenter
          │           │           │
          └───────────┼───────────┘
                      ▼
                Render Backend
                 REST API
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
       Neon DB                 Cloudflare R2
    PostgreSQL              Images / Files
```

## Apps

| App | Purpose | Port | Root |
|-----|---------|------|------|
| VelShop | Customer storefront (Mobile-first) | 5173 | `apps/shop/` or root `src/` |
| VelSeller | Merchant management (Desktop-first) | 5174 | `apps/seller/` |
| VelCenter | Admin management (Desktop-first) | 5175 | `apps/center/` |

## Backend

- **Stack:** Express + TypeScript
- **Runtime:** Bun (development), Node.js (production)
- **Deploy:** Render
- **Root:** `backend/`

## Database

- **Engine:** Neon PostgreSQL (single database)
- **Schema:** `db/schema.sql`
- **Migrations:** `db/migrations/`
- **SQL Editor Bootstrap:** `db/run-sqleditor.sql`

### Tables (27 across 4 domains)

**Customer Domain:** users, user_auth_identities, customer_profiles, addresses, carts, cart_items, orders, order_items, notifications, behavioral_events

**Seller Domain:** sellers, shops, products, product_images, inventory, seller_settings, seller_analytics

**Center Domain:** employees, departments, company_settings, platform_settings, audit_logs, moderation_records

**Shared Domain:** media, categories, system_settings

## Shared Packages

| Package | Purpose |
|---------|---------|
| `@velnox/i18n` | Translation system (th, en, my) |
| `@velnox/api` | Centralized API client |
| `@velnox/types` | Shared TypeScript types |
| `@velnox/hooks` | useAuth, useCart, useIsMobile |
| `@velnox/utils` | formatPrice, formatDate, etc. |
| `@velnox/ui` | LanguageSelector, CurrencySelector, ProductCard, etc. |

## Rules (MANDATORY)

1. **Neon = Source of Truth** — all business data lives in PostgreSQL
2. **Render = Backend** — API, Auth, Business Logic, Realtime
3. **Vercel = Frontend** — 3 independent deployments
4. **R2 = File Storage** — images, avatars, documents
5. **NO Convex** — never add Convex to this project
6. **NO Cloudinary** — never add Cloudinary to this project
7. **NO additional databases** — Neon is the single database
8. **Browser never connects to Neon** — all access through Backend API
9. **ONE PERSON = ONE USER** — identity resolution on login
10. **All API calls through Backend** — frontend uses REST API only
11. **No secrets in frontend** — only `VITE_API_URL` is public
12. **i18n required** — all user-facing text must use `t()` function
13. **Every schema change** must update: `schema.sql`, `run-sqleditor.sql`, migration file, `docs/DATABASE.md`, this file

## i18n

- **Thai (th)** = default language
- **English (en)**
- **Burmese (my)**
- **Currency:** THB, USD, MMK (independent from language)
- **Translation files:** `packages/i18n/src/locales/*.json`
- **Language selector** in header (desktop + mobile)
- **Preference** persisted in localStorage

## Authentication

- Google OAuth 2.0 → JWT → httpOnly Cookie (`velnox_session`)
- Identity resolution: provider+id → email → create new
- Cookie: httpOnly, Secure (prod), SameSite=lax

## Key Files

- `src/main.tsx` — VelShop entry (root)
- `apps/shop/src/main.tsx` — VelShop entry (standalone)
- `apps/seller/src/main.tsx` — VelSeller entry
- `apps/center/src/main.tsx` — VelCenter entry
- `backend/src/index.ts` — Backend entry
- `packages/i18n/src/locales/*.json` — Translations
- `packages/api/src/index.ts` — API client
- `packages/hooks/src/index.ts` — Auth & cart hooks
- `packages/types/src/index.ts` — All shared types
- `vite.config.ts` — Root Vite config
- `db/schema.sql` — Complete database schema

## Build

```bash
bun install                # Install all dependencies
bun run build:shop         # Build VelShop (root)
bun run build:seller       # Build VelSeller (apps/seller)
bun run build:center       # Build VelCenter (apps/center)
bun run typecheck          # Typecheck all apps + packages
```

## Environment Variables

### Frontend (Vercel) — Only 1 variable
```
VITE_API_URL=https://your-backend.onrender.com/api
```

### Backend (Render) — All secrets
```
DATABASE_URL=                     # Neon PostgreSQL connection string
GOOGLE_CLIENT_ID=                 # Google OAuth client ID
GOOGLE_CLIENT_SECRET=             # Google OAuth client secret
JWT_SECRET=                       # JWT signing secret (64+ chars)
R2_ACCOUNT_ID=                    # Cloudflare account ID
R2_ACCESS_KEY_ID=                 # R2 API access key
R2_SECRET_ACCESS_KEY=             # R2 API secret key
R2_BUCKET=                        # R2 bucket name
R2_PUBLIC_DOMAIN=                 # R2 public URL (e.g., pub-xxx.r2.dev)
PORT=3001                         # Server port
CORS_ORIGINS=                     # Comma-separated allowed origins
```

### What is NEVER in the frontend
- DATABASE_URL
- JWT_SECRET
- GOOGLE_CLIENT_SECRET
- R2_SECRET_ACCESS_KEY
- Any server-side credentials
