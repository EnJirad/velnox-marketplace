# Velnox Installation

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Node.js](https://nodejs.org/) 18+
- [Git](https://git-scm.com/)

## Quick Start

```bash
git clone https://github.com/EnJirad/velnox-marketplace.git
cd velnox-marketplace
bun install
```

## Frontend Environment

Each frontend app needs a single environment variable. Create `.env` files:

### Root (VelShop — development)
```
VITE_API_URL=http://localhost:3001/api
```

### apps/seller/.env
```
VITE_API_URL=http://localhost:3001/api
```

### apps/center/.env
```
VITE_API_URL=http://localhost:3001/api
```

### Production (Vercel)
```
VITE_API_URL=https://your-backend.onrender.com/api
```

## Backend

```bash
cd backend
bun install
cp .env.example .env    # Copy and fill in your values
bun run dev
```

### Backend Environment Variables (.env)

```env
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/velnox?sslmode=require

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# JWT
JWT_SECRET=your-very-long-random-secret-min-64-characters

# Cloudflare R2
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=your-bucket-name
R2_PUBLIC_DOMAIN=https://pub-xxx.r2.dev

# Server
PORT=3001
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://localhost:5175
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URIs:
   - Development: `http://localhost:3001/api/auth/google/callback`
   - Production: `https://your-backend.onrender.com/api/auth/google/callback`

### Neon Database Setup

1. Create a [Neon](https://neon.tech/) account
2. Create a new project
3. Copy the connection string
4. Open Neon SQL Editor
5. Paste and run `db/run-sqleditor.sql`

### Cloudflare R2 Setup

1. Create a [Cloudflare](https://dash.cloudflare.com/) account
2. Enable R2
3. Create a bucket
4. Generate API tokens with R2 read/write permissions
5. Set up a custom domain or use the public R2.dev URL

## Running All Frontends

```bash
# Terminal 1 — VelShop (port 5173)
bun run dev:shop

# Terminal 2 — VelSeller (port 5174)
bun run dev:seller

# Terminal 3 — VelCenter (port 5175)
bun run dev:center
```

## Build & Typecheck

```bash
bun run typecheck      # Typecheck all apps + packages
bun run build:shop     # Build VelShop
bun run build:seller   # Build VelSeller
bun run build:center   # Build VelCenter
```

## Deployment

### Vercel (Frontend)

Each app deploys independently:

| App | Vercel Project | Root Directory |
|-----|---------------|----------------|
| VelShop | velshop | `apps/shop/` or `/` (root) |
| VelSeller | velseller | `apps/seller/` |
| VelCenter | velcenter | `apps/center/` |

Environment variable: `VITE_API_URL=https://your-backend.onrender.com/api`

### Render (Backend)

- Build command: `cd backend && bun install && bun run build`
- Start command: `cd backend && bun run start`
- Set all backend environment variables in Render dashboard

## Languages

- **Thai (th)** = default
- **English (en)**
- **Burmese (my)**

Selector in header. Language persists in localStorage.

## Currencies

- **THB** (Thai Baht)
- **USD** (US Dollar)
- **MMK** (Myanmar Kyat)

Currency is independent from language selection.
