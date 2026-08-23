# Velnox Architecture

## Overview

Velnox is a modern e-commerce marketplace with 3 independent frontend applications backed by a unified REST API.

## System Architecture

```
                    INTERNET
                       │
                       ▼
                  CLOUDFLARE
                       │
             ┌─────────┴─────────┐
             │                   │
          VERCEL              RENDER
             │                   │
       ┌─────┼─────┐             │
       │     │     │             │
   VelShop VelSeller VelCenter   API
                               │
                        ┌──────┼──────┐
                        │             │
                       Neon           R2
                     PostgreSQL    Cloud Storage
```

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite + TypeScript | 3 SPA applications |
| UI | shadcn/ui + Tailwind CSS | Design system |
| Routing | React Router v7 | Client-side routing |
| Animation | Framer Motion | UI animations |
| Backend | Express + TypeScript | REST API server |
| Database | Neon PostgreSQL | Single source of truth |
| File Storage | Cloudflare R2 | Images, documents |
| Realtime | WebSocket (Render) | Live updates |
| Auth | Google OAuth + JWT | httpOnly cookie session |

## Monorepo Structure

```
velnox/
├── src/                    # VelShop (root — customer storefront)
├── apps/
│   ├── shop/              # VelShop (standalone build for Vercel)
│   ├── seller/            # VelSeller (merchant management)
│   └── center/            # VelCenter (admin management)
├── packages/
│   ├── i18n/              # Translation system (th, en, my)
│   ├── api/               # Shared API client
│   ├── types/             # Shared TypeScript types
│   ├── hooks/             # useAuth, useCart, useIsMobile
│   ├── utils/             # formatPrice, formatDate, etc.
│   └── ui/                # Shared UI components
├── backend/
│   └── src/
│       ├── api/           # Route handlers
│       ├── auth/          # Google OAuth + JWT
│       ├── db/            # PostgreSQL connection pool
│       ├── middleware/     # Auth, rate limiting, CORS
│       ├── services/      # Business logic
│       └── validation/    # Zod schemas
├── db/
│   ├── schema.sql         # Complete database schema (27 tables)
│   ├── run-sqleditor.sql  # Neon SQL Editor bootstrap
│   └── migrations/        # Ordered migration files
└── docs/                  # Documentation
```

## Data Flow

### API Request
```
Frontend → VITE_API_URL/api/* → Render Backend → Neon PostgreSQL → Response
```

### Authentication
```
Frontend → /api/auth/google → Google OAuth → Backend callback
→ Identity resolution (ONE PERSON = ONE USER) → JWT → httpOnly cookie → Frontend
```

### Image Upload
```
Frontend → Backend API → Generate presigned URL → Frontend uploads to R2
→ Frontend notifies Backend → Backend creates media record in Neon
```

### Realtime
```
Frontend → API → Neon (write) → WebSocket event → Connected clients receive update
```

## Security Model

- **Frontend** → Only `VITE_API_URL` (public)
- **Backend** → All secrets: DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_SECRET, R2 keys
- **httpOnly cookies** → Session token not accessible via JavaScript
- **CORS** → Only allowed origins
- **Parameterized queries** → No SQL injection
- **Rate limiting** → API abuse prevention

## Build Commands

```bash
bun run typecheck          # Typecheck all
bun run build:shop         # Build VelShop
bun run build:seller       # Build VelSeller
bun run build:center       # Build VelCenter
```

## Deployment

| Service | Platform | What |
|---------|----------|------|
| VelShop | Vercel | Customer storefront |
| VelSeller | Vercel | Merchant management |
| VelCenter | Vercel | Admin management |
| Backend API | Render | REST API + WebSocket |
| Database | Neon | PostgreSQL |
| File Storage | Cloudflare R2 | Images, documents |
