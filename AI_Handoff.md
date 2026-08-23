# AI_Handoff.md — Velnox Project Reference

This document describes the entire Velnox project for AI assistants working on the codebase.

## Project Overview

Velnox is an E-Commerce Marketplace with 3 web applications:
- **VelShop** — Customer storefront (apps/shop)
- **VelSeller** — Seller management (apps/seller)
- **VelCenter** — Admin management (apps/center)

## Architecture Rules (MUST FOLLOW)

1. **Neon = Source of Truth** — All business data lives in Neon PostgreSQL
2. **Render = Backend** — Express API, auth, business logic, realtime
3. **Vercel = Frontend** — React + Vite apps, no secrets
4. **R2 = File Storage** — Images, documents, media files
5. **NO Convex** — Do not add Convex to this project
6. **NO Cloudinary** — Do not add Cloudinary to this project
7. **NO additional databases** — Single Neon database only
8. **Browser cannot connect to Neon** — All DB access through backend API
9. **All schema changes require migration** — Update schema.sql, run-sqleditor.sql, and migration file
10. **All API calls go through backend** — Frontend never talks to DB directly
11. **No secrets in frontend** — Only VITE_API_URL is public
12. **ONE PERSON = ONE USER** — Identity resolution prevents duplicate accounts

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion |
| Backend | Node.js, Express, TypeScript, pg (PostgreSQL driver) |
| Database | Neon PostgreSQL |
| Storage | Cloudflare R2 (presigned URLs) |
| Auth | Google OAuth 2.0 + JWT + httpOnly cookies |
| Realtime | WebSocket on Render |
| Package Manager | Bun |
| Monorepo | Workspaces (bun) |

## Directory Structure

```
velnox/
├── apps/shop/          # VelShop (customer storefront)
├── apps/seller/        # VelSeller (seller management)
├── apps/center/        # VelCenter (admin management)
├── backend/            # Express API server
│   └── src/
│       ├── api/        # Route handlers (auth, products, cart, orders, etc.)
│       ├── db/         # PostgreSQL connection pool
│       └── middleware/  # Auth, error handling
├── packages/
│   ├── types/          # Shared TypeScript types
│   ├── api-client/     # Shared API client class
│   └── shared/         # Shared utilities and constants
├── db/
│   ├── schema.sql      # Complete database schema
│   ├── run-sqleditor.sql # Paste into Neon SQL Editor
│   └── migrations/     # Ordered migration files
└── docs/               # Detailed documentation
```

## Database Domains

### Customer Domain
- `users` — User accounts (ONE PERSON = ONE USER)
- `user_auth_identities` — OAuth provider links (Google)
- `customer_profiles` — Customer preferences
- `addresses` — Shipping addresses
- `carts` / `cart_items` — Shopping carts
- `orders` / `order_items` — Purchase history
- `notifications` — User notifications
- `behavioral_events` — User behavior tracking

### Seller Domain
- `sellers` — Seller accounts
- `shops` — Storefronts
- `products` / `product_images` — Product listings
- `inventory` — Stock tracking
- `seller_settings` / `seller_analytics` — Seller tools

### Center Domain
- `employees` / `departments` — Staff management
- `company_settings` / `platform_settings` — Configuration
- `audit_logs` / `moderation_records` — Admin tools

### Shared Domain
- `media` — File metadata (R2 stores the files)
- `categories` — Product categories
- `system_settings` — Global settings

## Authentication Flow

```
User → VelShop → /api/auth/google → Google → /api/auth/google/callback
→ Find or create user (identity resolution) → Sign JWT → Set httpOnly cookie
→ Redirect to frontend
```

### Identity Resolution (ONE PERSON = ONE USER)

1. Find by `provider + provider_id` (Google sub ID)
2. If not found, find by normalized email
3. If email exists, link new auth identity to existing user
4. If nothing found, create new user + identity + profile + cart

## API Format

All responses use:
```json
{ "success": true, "data": { ... } }
```
or
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "Human readable" } }
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | VelShop entry point |
| `src/index.css` | Velnox Modern theme (CSS variables) |
| `src/lib/api.ts` | Frontend API client |
| `src/hooks/use-auth.ts` | Authentication state |
| `src/hooks/use-cart.ts` | Cart state |
| `backend/src/index.ts` | Express server entry |
| `backend/src/db/index.ts` | PostgreSQL connection pool |
| `backend/src/middleware/auth.ts` | JWT verification |
| `db/schema.sql` | Complete database schema |
| `db/run-sqleditor.sql` | Neon SQL Editor paste file |

## Environment Variables

### Backend (Render)
```
DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
R2_BUCKET, R2_PUBLIC_DOMAIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
JWT_SECRET, PORT, CORS_ORIGINS
```

### Frontend (Vercel)
```
VITE_API_URL
```

## Deployment

1. **Database:** Paste `db/run-sqleditor.sql` into Neon SQL Editor
2. **Backend:** Deploy `backend/` to Render as Web Service
3. **Frontend:** Deploy each app in `apps/` to Vercel
4. **Configure:** Set environment variables in each platform

## Testing Checklist

- [ ] Login with Google creates new user
- [ ] Logout clears session
- [ ] Login with same Google account returns same user ID
- [ ] Products list loads with pagination
- [ ] Product detail shows images, shop, price
- [ ] Cart add/update/remove works
- [ ] Orders can be created
- [ ] No Convex references in codebase
- [ ] No Cloudinary references in codebase
- [ ] No hardcoded secrets in frontend
