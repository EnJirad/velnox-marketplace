# Velnox

The modern e-commerce marketplace. A monorepo containing three web applications backed by a unified API.

## Architecture

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

**Stack:**
- **Frontend:** React + TypeScript + Vite (deployed on Vercel)
- **Backend:** Node.js + Express + TypeScript (deployed on Render)
- **Database:** Neon PostgreSQL (single database, multiple domains)
- **File Storage:** Cloudflare R2
- **Realtime:** WebSocket on Render

## Repository Structure

```
velnox/
├── apps/
│   ├── shop/          # VelShop — Customer storefront
│   ├── seller/        # VelSeller — Seller management
│   └── center/        # VelCenter — Admin management
│
├── backend/
│   └── src/
│       ├── api/       # Express route handlers
│       ├── auth/      # Authentication logic
│       ├── db/        # Database connection & queries
│       ├── middleware/ # Auth, validation, error handling
│       └── utils/     # Shared utilities
│
├── packages/
│   ├── shared/        # Shared utilities, constants, helpers
│   ├── types/         # TypeScript type definitions
│   └── api-client/    # Shared API client for all apps
│
├── db/
│   ├── schema.sql         # Complete database schema
│   ├── run-sqleditor.sql  # Paste into Neon SQL Editor
│   └── migrations/        # Ordered migration files
│
└── docs/              # Architecture, API, and deployment docs
```

## Development

### Prerequisites

- [Bun](https://bun.sh) (package manager & runtime)
- [Node.js](https://nodejs.org) 18+
- [Neon PostgreSQL](https://neon.tech) account
- [Cloudflare R2](https://www.cloudflare.com/r2/) account
- [Google Cloud Console](https://console.cloud.google.com) (OAuth)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/EnJirad/velnox.git
cd velnox

# Install dependencies
bun install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Set up the database
# Paste db/run-sqleditor.sql into Neon SQL Editor

# Start the backend
cd backend
bun run dev

# Start the frontend (in a new terminal)
bun run dev
```

### Frontend Apps

| App | Purpose | URL |
|-----|---------|-----|
| VelShop | Customer storefront | http://localhost:5173 |
| VelSeller | Seller management | http://localhost:5174 |
| VelCenter | Admin management | http://localhost:5175 |

### Backend

The backend runs on port 3001 by default. See `backend/` for the Express API.

## Environment Variables

### Backend (Render)

```
DATABASE_URL=postgresql://...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
R2_PUBLIC_DOMAIN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
JWT_SECRET=...
PORT=3001
CORS_ORIGINS=http://localhost:5173
```

### Frontend (Vercel)

```
VITE_API_URL=https://your-backend.onrender.com/api
```

## Database

Velnox uses a **single Neon PostgreSQL database** with domain-separated tables:

- **Customer Domain:** users, addresses, carts, orders, notifications, behavioral_events
- **Seller Domain:** sellers, shops, products, inventory, analytics
- **Center Domain:** employees, departments, settings, audit_logs
- **Shared Domain:** media, categories, system_settings

See `docs/DATABASE.md` for the complete schema.

## Deployment

### Vercel (Frontend)

Each app deploys separately on Vercel with its own `VITE_API_URL`.

### Render (Backend)

The backend deploys as a Web Service on Render with all environment variables.

### Neon (Database)

Run `db/run-sqleditor.sql` in the Neon SQL Editor to create the database.

See `docs/DEPLOYMENT.md` for detailed instructions.

## License

Private — Velnox
