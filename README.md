# Velnox Marketplace

A modern multi-vendor marketplace platform with four independent frontend applications, centralized backend, and Neon PostgreSQL database.

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
- **UI:** shadcn/ui, Radix UI, Framer Motion
- **Backend:** Express, TypeScript, Node.js
- **Database:** Neon PostgreSQL
- **Storage:** Cloudflare R2
- **Auth:** Google OAuth + JWT cookies
- **i18n:** Thai, English, Burmese

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

# Typecheck
bun run typecheck
```

## Project Structure

```
velnox-marketplace/
├── apps/
│   ├── velshop/       # Customer marketplace
│   ├── velseller/     # Seller management
│   ├── velcenter/     # Admin management
│   └── velnox/        # Corporate website
├── backend/           # Express API server
├── packages/
│   ├── ui/            # Shared UI components
│   ├── api-client/    # API client
│   ├── i18n/          # Internationalization
│   ├── shared/        # Types, constants
│   ├── types/         # TypeScript types
│   ├── hooks/         # React hooks
│   ├── utils/         # Utilities
│   └── config/        # Configuration
├── db/
│   ├── schema.sql     # Complete database schema
│   └── migrations/    # Migration files
├── docs/              # Documentation
└── AI_Handoff.md      # AI agent handoff document
```

## Environment Variables

See `.env.example` for required variables.

- **Frontend:** Only `VITE_API_URL`
- **Backend:** All secrets (DATABASE_URL, GOOGLE_CLIENT_ID, JWT_SECRET, R2 keys, etc.)

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
