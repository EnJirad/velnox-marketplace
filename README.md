# Velnox Marketplace

A modern multi-vendor marketplace platform with four independent frontend applications, centralized backend, and Neon PostgreSQL database. UI/UX based on the Velnox V2 design system.

## Architecture

```
4 Frontend Apps (Vercel)
    ↓
1 Backend API (Render)
    ↓
1 Neon PostgreSQL + Cloudflare R2 + WebSocket
```

## Applications

| App | Description | URL |
|-----|-------------|-----|
| **velshop** | Customer marketplace | velshop.vercel.app |
| **velseller** | Seller management | velseller.vercel.app |
| **velcenter** | Admin management | velcenter.vercel.app |
| **velnox** | Corporate website | velnox.vercel.app |

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS v4
- **UI:** shadcn/ui (70+ components), Radix UI, Framer Motion, Lucide icons
- **Backend:** Express, TypeScript, Node.js
- **Database:** Neon PostgreSQL
- **Storage:** Cloudflare R2
- **Auth:** Google OAuth + JWT httpOnly session cookies
- **i18n:** Thai, English, Burmese (default: Thai)
- **Package manager:** Bun

## Getting Started

```bash
# Install dependencies
bun install

# Run development servers
bun run dev:velshop      # Port 5173
bun run dev:velseller    # Port 5174
bun run dev:velcenter    # Port 5175
bun run dev:velnox       # Port 5176
bun run api:dev          # Port 3001

# Build all apps
bun run build:apps

# Typecheck all apps
bun run typecheck
```

## Project Structure

```
velnox-marketplace/
├── apps/
│   ├── velshop/       # Customer marketplace (V2 UI)
│   ├── velseller/     # Seller management (V2 UI)
│   ├── velcenter/     # Admin management (V2 UI)
│   └── velnox/        # Corporate website (V2 UI)
├── backend/           # Express API server
│   ├── routes/
│   │   ├── auth.ts    # Google OAuth routes
│   │   └── index.ts   # API routes
│   ├── middleware/     # Auth, error handling
│   ├── db/            # PostgreSQL pool
│   └── realtime/      # WebSocket server
├── packages/
│   └── shared/        # All shared code
│       └── src/
│           ├── components/ui/     # 70+ shadcn/ui components
│           ├── components/        # Logo, AppHeader, MobileTabBar, RequireAuth, etc.
│           ├── hooks/             # use-auth, use-mobile
│           ├── lib/               # commerce, sites, track, i18n, auth-flow, etc.
│           ├── pages/             # Auth, NotFound
│           └── index.css          # Velnox Design Theme v1.0
├── db/
│   ├── schema.sql     # Complete database schema
│   └── migrations/    # Migration files
├── docs/              # Documentation
└── AI_Handoff.md      # AI agent handoff document
```

## Shared Package

All 4 apps share a single `packages/shared` package via wildcard exports:
```json
"exports": { ".": "./src/index.ts", "./*": "./src/*" }
```

Apps import shared code via `@velnox/shared/...` resolved through Vite aliases.

## Environment Variables

### Frontend (Vercel)
```
VITE_CORPORATE_URL=
VITE_VELSHOP_URL=
VITE_VELSELLER_URL=
VITE_VELCENTER_URL=
```

### Backend (Render) — ALL secrets
```
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
JWT_SECRET=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_DOMAIN=
CORS_ORIGINS=
```

See `.env.example` for details.

## Deployment

### Frontend (Vercel) — 4 independent projects
Each app builds independently with `bun run build:<app>`.

### Backend (Render)
- Service: velnox-api
- Start: `tsx server.ts`
- Must listen on `process.env.PORT`

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Environment](docs/ENVIRONMENT.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Realtime](docs/REALTIME.md)
- [Media](docs/MEDIA.md)
- [I18N](docs/I18N.md)
- [AI Handoff](AI_Handoff.md)
