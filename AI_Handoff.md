# AI_Handoff.md — Velnox Marketplace

**LAST UPDATED: 2026-08-23**

---

## Project Purpose

Velnox is a modern multi-vendor marketplace platform supporting Thai, English, and Burmese languages. It connects customers with independent sellers through a curated shopping experience.

## Architecture

```
4 Frontend Apps (Vercel)
    ↓
1 Backend API (Render)
    ↓
1 Neon PostgreSQL (source of truth)
+ 1 Cloudflare R2 (file storage)
+ 1 WebSocket (realtime delivery)
```

## Frontend Applications

### apps/velshop
- Customer marketplace storefront
- Product browsing, search, categories
- Cart, checkout, orders
- Customer account, profile, addresses
- Routes: /, /products, /products/:id, /auth, /cart, /orders, /profile, /addresses

### apps/velseller
- Seller management dashboard
- Shop management, product management
- Orders, sales analytics
- Routes: /, /products, /orders, /settings

### apps/velcenter
- Company/admin management
- User management, seller management
- Platform analytics, system settings
- Routes: /, /users, /sellers, /orders, /settings

### apps/velnox
- Corporate/public landing page
- Company information, about, contact
- NO marketplace logic — pure marketing site

## Backend Architecture

### backend/server.ts
- Express server with Helmet, CORS, cookie-parser
- Listens on process.env.PORT

### backend/middleware/
- auth.ts: JWT session verification, requireAuth, optionalAuth
- error.ts: AppError class, global error handler

### backend/db/
- index.ts: PostgreSQL pool via pg, query helper

### backend/routes/
- index.ts: All API routes organized by domain

### backend/realtime/
- index.ts: WebSocket server, channel subscriptions, broadcast helper

## Database Architecture

Neon PostgreSQL is the ONLY source of truth.

### Tables by Domain

**Customer:** users, auth_identities, customer_profiles, addresses, carts, cart_items
**Seller:** sellers, shops, categories, products, product_images, inventory
**Commerce:** orders, order_items, payments, refunds, commissions, settlements, subscriptions
**Company:** departments, employees, company_settings, audit_logs
**Media:** media
**Analytics:** behavioral_events
**Notifications:** notifications

### Key Files
- db/schema.sql — Complete schema
- db/run-sqleditor.sql — Idempotent bootstrap for Neon SQL Editor
- db/migrations/ — Sequential migration files

## Authentication

- Google OAuth handled by backend
- HttpOnly, Secure, SameSite=strict session cookies
- JWT tokens stored in cookies (NOT localStorage)
- Backend generates session_token cookie on successful auth

## User Identity — CRITICAL RULES

The same person MUST NEVER receive a new user record every time they log in.

### Identity Resolution Flow
1. Check auth_identities for Google provider_id
2. If found → use existing user
3. If not → normalize email, check users.email
4. If email exists → link Google identity to existing user
5. If new → create new user

Database enforces uniqueness on (provider, provider_id).
Email is normalized (lowercase) before comparison.

### Rules
- NEVER blindly INSERT a new user on every login
- Use INSERT ... ON CONFLICT or transactional strategy
- Handle concurrent login requests safely

## Cloudflare R2

Binary file storage for avatars, covers, product images, documents.
- Backend generates presigned upload URLs
- Neon stores media metadata in `media` table
- Never expose R2 secrets to frontend

## Realtime

WebSocket delivery via backend/realtime/
- Neon is source of truth, WebSocket is delivery mechanism
- Channels: cart:updated, order:created, order:updated, product:updated, inventory:updated

## Behavioral Tracking

Stored in Neon `behavioral_events` table.
Events: product_view, category_view, search, add_to_cart, remove_from_cart, purchase, shop_view, session_start, session_end

## i18n

- packages/i18n — Centralized translation system
- Languages: th (default), en, my
- Locale persisted in localStorage (velnox_locale)
- All apps use @velnox/i18n

## Environment Variables

### Frontend (Vercel) — ONLY
```
VITE_API_URL=https://your-backend.onrender.com/api
```

### Backend (Render) — ALL secrets
```
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
JWT_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_DOMAIN=
CORS_ORIGINS=
PORT=3001
```

### What is NEVER in the frontend
- DATABASE_URL
- JWT_SECRET
- GOOGLE_CLIENT_SECRET
- R2_SECRET_ACCESS_KEY
- Any server-side credentials

## Deployment

### Frontend (Vercel) — 4 independent projects
- velshop: `bun run build:velshop` → apps/velshop/dist
- velseller: `bun run build:velseller` → apps/velseller/dist
- velcenter: `bun run build:velcenter` → apps/velcenter/dist
- velnox: `bun run build:velnox` → apps/velnox/dist

### Backend (Render)
- Service: velnox-api
- Start: `bun run api:start` or `node dist/server.js`
- Must listen on process.env.PORT

## Migration Rules

1. Every schema change → create migration file in db/migrations/
2. Update db/schema.sql
3. Update db/run-sqleditor.sql
4. NEVER use DROP TABLE/TRUNCATE in migrations
5. All migrations must be idempotent (IF NOT EXISTS)

## Coding Rules

- Bun for package management
- TypeScript strict mode
- React 19, Vite 7, Tailwind v4
- shadcn/ui components
- Framer Motion for animations
- Each app is fully isolated
- Shared code goes in packages/

## Security Rules

- Never commit .env files
- Never put server secrets in frontend code
- Use HttpOnly cookies for auth tokens
- CORS configured via environment variable
- Input validation with Zod
- Rate limiting on auth endpoints

## Important Invariants

1. Neon PostgreSQL is the ONLY source of truth
2. Frontend NEVER connects directly to Neon
3. Frontend NEVER contains DATABASE_URL
4. User identity resolution prevents duplicate accounts
5. WebSocket state is NOT permanent database state
6. R2 stores binaries, Neon stores metadata
7. All four frontend apps must build independently
8. Backend is the ONLY server-side gateway

## Things Future AI Agents MUST NOT Change

1. Remove Convex from the system (it's already gone)
2. Add direct database access from frontend apps
3. Store auth tokens in localStorage
4. Create duplicate user records on login
5. Use DROP TABLE or TRUNCATE in migrations
6. Expose server secrets via VITE_ variables
7. Mix application-specific code between apps
8. Change the package naming convention (@velnox/*)

## Things That MUST Be Updated When Architecture Changes

1. This file (AI_Handoff.md)
2. docs/ARCHITECTURE.md
3. docs/DATABASE.md
4. db/schema.sql
5. db/run-sqleditor.sql
6. README.md
