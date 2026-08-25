# INSTALLATION.md — Velnox Marketplace

Complete guide to install, configure, develop, test, build, and deploy Velnox Marketplace from scratch.

---

## System Requirements

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | 18+ (LTS recommended) | Required by Vite and Express |
| **Bun** | 1.1+ | Package manager and script runner |
| **Git** | 2.x | Version control |
| **Neon PostgreSQL** | Serverless | Database (free tier available) |
| **Cloudflare R2** | — | File storage (free tier available) |
| **Vercel** | — | Frontend hosting |
| **Render** | — | Backend hosting |
| **Google Cloud Console** | — | OAuth credentials |

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/EnJirad/velnox-marketplace.git
cd velnox-marketplace

# 2. Install dependencies
bun install

# 3. Configure environment
cp .env.example backend/.env
# Edit backend/.env with your credentials

# 4. Initialize database
# Run db/run-sqleditor.sql in Neon SQL Editor

# 5. Start development
bun run dev:velshop      # Port 5173
bun run api:dev          # Port 3001
```

---

## Project Structure

```
velnox-marketplace/
├── apps/
│   ├── velshop/         # Customer marketplace (Port 5173)
│   ├── velseller/       # Seller management (Port 5174)
│   ├── velcenter/       # Admin management (Port 5175)
│   └── velnox/          # Corporate website (Port 5176)
├── backend/             # Express API server (Port 3001)
│   ├── routes/          # API route handlers
│   ├── middleware/       # Auth, error handling
│   ├── db/              # PostgreSQL connection pool
│   └── realtime/        # WebSocket server
├── packages/shared/     # Shared code (components, hooks, lib, pages)
├── db/
│   ├── schema.sql       # Complete database schema (canonical reference)
│   ├── run-sqleditor.sql # Bootstrap SQL for Neon (must sync with schema.sql)
│   ├── run-update.sql    # Incremental migration history (NEVER overwrite)
│   └── migrations/      # Sequential migration files
└── docs/                # Documentation
```

---

## Step-by-Step Installation

### 1. Clone Repository

```bash
git clone https://github.com/EnJirad/velnox-marketplace.git
cd velnox-marketplace
```

### 2. Install Bun (if not installed)

```bash
curl -fsSL https://bun.sh/install | bash
```

### 3. Install Dependencies

```bash
bun install
```

This installs all workspace packages:
- Root devDependencies (TypeScript)
- `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`
- `packages/shared`
- `backend`

### 4. Configure Environment Variables

#### Backend Environment

Create `backend/.env`:

```bash
cp .env.example backend/.env
```

Edit `backend/.env`:

```env
# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/velnox?sslmode=require

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback

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

#### Frontend Public Environment Variables

All `VITE_*` variables are **PUBLIC** — they are intentionally exposed to the browser.
Never store secrets in `VITE_*` variables.

```env
# Backend API base URL
VITE_API_URL=http://localhost:3001

# Sub-path basename (leave empty for root deployment)
VITE_SITE_BASENAME=

# Cross-application URLs (local dev ports)
VITE_VELSHOP_URL=http://localhost:5173
VITE_VELSELLER_URL=http://localhost:5174
VITE_VELCENTER_URL=http://localhost:5175
VITE_CORPORATE_URL=http://localhost:5176
```

For Vercel deployment, set in the Vercel dashboard for each project.

**IMPORTANT:** In Vercel, set these as type **Config** (NOT Secret), since `VITE_*` values are intentionally exposed to the browser by Vite.

### 5. Set Up Neon PostgreSQL Database

1. Create a Neon project at https://neon.tech
2. Create a database
3. Copy the connection string to `DATABASE_URL` in `backend/.env`
4. Open Neon SQL Editor
5. Run the contents of `db/run-sqleditor.sql`

This creates all tables, indexes, and constraints.

**Important:** `db/run-sqleditor.sql` and `db/schema.sql` must always be synchronized.
For incremental updates to an existing database, use `db/run-update.sql`.

### 6. Set Up Google OAuth

1. Go to https://console.cloud.google.com
2. Create a project (or use existing)
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. Add authorized redirect URIs:
   - `http://localhost:3001/auth/google/callback` (development)
   - `https://your-backend.onrender.com/auth/google/callback` (production)
6. Copy Client ID and Client Secret to environment variables

### 7. Set Up Cloudflare R2 (Optional — for file uploads)

1. Create a Cloudflare account
2. Enable R2 storage
3. Create a bucket
4. Generate API tokens (S3-compatible)
5. Configure public access or custom domain
6. Set CORS rules to allow frontend origins
7. Copy credentials to environment variables

### 8. Start Development

#### Start Backend

```bash
bun run api:dev
# Server runs on http://localhost:3001
```

#### Start Frontend Apps (in separate terminals)

```bash
bun run dev:velshop      # http://localhost:5173
bun run dev:velseller    # http://localhost:5174
bun run dev:velcenter    # http://localhost:5175
bun run dev:velnox       # http://localhost:5176
```

---

## Available Scripts

### Root Scripts (package.json)

| Command | Description |
|---------|-------------|
| `bun run dev:velshop` | Start velshop dev server (port 5173) |
| `bun run dev:velseller` | Start velseller dev server (port 5174) |
| `bun run dev:velcenter` | Start velcenter dev server (port 5175) |
| `bun run dev:velnox` | Start velnox dev server (port 5176) |
| `bun run api:dev` | Start backend dev server (port 3001) |
| `bun run api:start` | Start backend in production mode |
| `bun run build:velshop` | Build velshop for production |
| `bun run build:velseller` | Build velseller for production |
| `bun run build:velcenter` | Build velcenter for production |
| `bun run build:velnox` | Build velnox for production |
| `bun run build:apps` | Build all 4 frontend apps |
| `bun run typecheck` | Typecheck all 4 frontend apps |

---

## Typecheck and Build

### Typecheck

```bash
# All apps
bun run typecheck

# Single app
cd apps/velshop && bun tsc --noEmit
cd apps/velseller && bun tsc --noEmit
cd apps/velcenter && bun tsc --noEmit
cd apps/velnox && bun tsc --noEmit

# Backend
cd backend && bun tsc --noEmit
```

### Build

```bash
# All apps
bun run build:apps

# Single app
bun run build:velshop
bun run build:velseller
bun run build:velcenter
bun run build:velnox
```

Build output goes to `apps/<app>/dist/`.

---

## Deployment

### Frontend — Vercel (4 independent projects)

Each app is deployed as a separate Vercel project from the same repository.

| Project | Root Directory | Build Command | Output Directory |
|---------|---------------|---------------|------------------|
| velshop | `.` | `bun run build:velshop` | `apps/velshop/dist` |
| velseller | `.` | `bun run build:velseller` | `apps/velseller/dist` |
| velcenter | `.` | `bun run build:velcenter` | `apps/velcenter/dist` |
| velnox | `.` | `bun run build:velnox` | `apps/velnox/dist` |

**Environment Variables (Vercel) — set as type Config (NOT Secret):**
```
VITE_API_URL=https://velnx-api.onrender.com
VITE_SITE_BASENAME=
VITE_VELSHOP_URL=https://shop.velnx.com
VITE_VELSELLER_URL=https://seller.velnx.com
VITE_VELCENTER_URL=https://center.velnx.com
VITE_CORPORATE_URL=https://velnx.com
```

All 4 Vercel projects use the same `VITE_*` values.

### Backend — Render

Single Render Web Service: `velnox-api`

**Build Command:**
```bash
bun install
```

**Start Command:**
```bash
bun run api:start
```

**Environment Variables (Render):**
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
CORS_ORIGINS=https://shop.velnx.com,https://seller.velnx.com,https://center.velnx.com,https://velnx.com
PORT=3001
```

### Database — Neon

1. Create Neon project
2. Run `db/run-sqleditor.sql` in SQL Editor (or apply `db/run-update.sql` for incremental updates)
3. Set `DATABASE_URL` in Render environment

### CORS Configuration

Backend must allow all four frontend origins:
- `https://velshop.vercel.app`
- `https://velseller.vercel.app`
- `https://velcenter.vercel.app`
- `https://velnox.vercel.app`

---

## Environment Variables Reference

### Backend (ALL secrets)

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | Neon PostgreSQL connection string | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | Yes |
| `JWT_SECRET` | JWT signing secret (64+ chars) | Yes |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Yes |
| `R2_ACCESS_KEY_ID` | R2 API access key | Yes |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key | Yes |
| `R2_BUCKET` | R2 bucket name | Yes |
| `R2_PUBLIC_DOMAIN` | R2 public URL | Yes |
| `CORS_ORIGINS` | Comma-separated allowed origins | Yes |
| `PORT` | Server port (default: 3001) | No |

### Frontend (ALL PUBLIC — type Config in Vercel)

| Variable | Description | Example |
|----------|-------------|--------|
| `VITE_API_URL` | Backend API base URL | `https://velnx-api.onrender.com` |
| `VITE_SITE_BASENAME` | Sub-path basename (empty = root) | `/center` |
| `VITE_VELSHOP_URL` | VelShop full URL | `https://shop.velnx.com` |
| `VITE_VELSELLER_URL` | VelSeller full URL | `https://seller.velnx.com` |
| `VITE_VELCENTER_URL` | VelCenter full URL | `https://center.velnx.com` |
| `VITE_CORPORATE_URL` | Corporate website URL | `https://velnx.com` |

**NEVER put server secrets in frontend environment variables.**
`VITE_*` values are intentionally exposed to the browser by Vite.

---

## Troubleshooting

### Common Issues

**Backend won't start:**
- Check `backend/.env` exists and has all required variables
- Verify `DATABASE_URL` is correct and Neon is running
- Check port 3001 is not in use

**Frontend can't connect to API:**
- Verify `VITE_API_URL` matches backend URL
- Check CORS_ORIGINS includes frontend origin
- Verify backend is running and accessible

**Database errors:**
- Run `db/run-sqleditor.sql` to ensure schema is up to date
- Check `DATABASE_URL` connection string
- Verify Neon database is active (may need to wake from idle)

**Build fails:**
- Run `bun install` to ensure all dependencies are installed
- Run `bun run typecheck` to identify type errors
- Check for missing environment variables
