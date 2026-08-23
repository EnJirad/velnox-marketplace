# Velnox Architecture

## Overview

Velnox is a monorepo e-commerce marketplace with three frontend applications, a unified backend API, a single PostgreSQL database, and cloud file storage.

## High-Level Architecture

```
                    INTERNET
                       │
                       ▼
                  CLOUDFLARE (CDN + DDoS Protection)
                       │
             ┌─────────┴─────────┐
             │                   │
          VERCEL              RENDER
          (Frontend)          (Backend)
             │                   │
       ┌─────┼─────┐             │
       │     │     │             │
   VelShop VelSeller VelCenter   API + WebSocket
                                     │
                              ┌──────┼──────┐
                              │             │
                             Neon           R2
                           PostgreSQL    Cloud Storage
```

## Design Principles

1. **Single Source of Truth** — Neon PostgreSQL holds all business data
2. **Backend as Gatekeeper** — All database access goes through the API
3. **Frontend as Presentation** — React apps handle UI, routing, and local state
4. **Domain Separation** — Database tables grouped by business domain
5. **Shared Code** — Types, API client, and utilities shared via packages

## Frontend Architecture

### Apps

Each app is an independent Vite + React application deployable to Vercel:

- **VelShop** — Customer-facing storefront
- **VelSeller** — Seller management dashboard
- **VelCenter** — Admin/management dashboard

### Shared Packages

- `@velnox/types` — TypeScript type definitions
- `@velnox/api-client` — HTTP client with auth, retry, timeout
- `@velnox/shared` — Utilities, constants, helpers

### Component Structure

```
src/
├── components/
│   ├── layout/    # Header, Footer, Layout
│   ├── products/  # ProductCard, ProductGrid
│   ├── cart/      # CartDrawer
│   └── ui/        # shadcn/ui components
├── hooks/         # useAuth, useCart
├── lib/           # API client, utilities
├── pages/         # Route components
└── types/         # App-specific types
```

## Backend Architecture

### Express Server

```
backend/src/
├── index.ts       # Server entry, middleware, routes
├── db/
│   └── index.ts   # PostgreSQL connection pool
├── api/
│   ├── auth.ts    # Google OAuth, JWT, session
│   ├── products.ts
│   ├── categories.ts
│   ├── cart.ts
│   ├── shops.ts
│   ├── orders.ts
│   └── addresses.ts
└── middleware/
    └── auth.ts    # JWT verification, optional auth
```

### Middleware Chain

1. **Helmet** — Security headers
2. **CORS** — Cross-origin configuration
3. **JSON Parser** — Body parsing
4. **Request Logger** — Console logging
5. **Auth Middleware** — JWT verification (where required)
6. **Route Handler** — Business logic
7. **Error Handler** — Catch-all error response

## Database Architecture

### Single Database, Multiple Domains

```
Neon PostgreSQL (velnox)
├── Customer Domain
│   ├── users
│   ├── user_auth_identities
│   ├── customer_profiles
│   ├── addresses
│   ├── carts / cart_items
│   ├── orders / order_items
│   ├── notifications
│   └── behavioral_events
├── Seller Domain
│   ├── sellers
│   ├── shops
│   ├── products / product_images
│   ├── inventory
│   ├── seller_settings
│   └── seller_analytics
├── Center Domain
│   ├── employees / departments
│   ├── company_settings
│   ├── platform_settings
│   ├── audit_logs
│   └── moderation_records
└── Shared Domain
    ├── media
    ├── categories
    └── system_settings
```

## Security Architecture

- **Authentication:** Google OAuth 2.0 → JWT → httpOnly cookie (`velnox_session`)
- **Authorization:** Middleware checks JWT on protected routes
- **CORS:** Configured for frontend origins only
- **SQL:** Parameterized queries (no string concatenation)
- **Secrets:** Backend only (Render env vars), never in frontend
- **File Upload:** Presigned URLs (R2 keys never exposed to browser)

## Realtime Architecture

```
Frontend → API → Neon (write) → WebSocket event → Frontend (update)
```

WebSocket delivers events:
- `PROFILE_UPDATED`
- `CART_UPDATED`
- `ORDER_CREATED` / `ORDER_UPDATED`
- `PRODUCT_UPDATED`
- `INVENTORY_UPDATED`
- `NOTIFICATION_CREATED`

## Performance

- **Frontend:** Code splitting, lazy loading, optimized chunks
- **Backend:** Connection pooling (20 max), query optimization
- **Database:** Strategic indexes on all query patterns
- **CDN:** Cloudflare for static assets and DDoS protection
