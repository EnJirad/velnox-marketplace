# Velnox Installation Guide

Step-by-step guide from `git clone` to a running development environment.

## Prerequisites

1. **Bun** — `curl -fsSL https://bun.sh/install | bash`
2. **Node.js** 18+ — `brew install node` or download from nodejs.org
3. **Git** — `brew install git` or download from git-scm.com

## External Services

You need accounts for:

| Service | Purpose | URL |
|---------|---------|-----|
| Neon | PostgreSQL database | https://neon.tech |
| Cloudflare R2 | File storage | https://www.cloudflare.com/r2/ |
| Google Cloud | OAuth | https://console.cloud.google.com |
| Render | Backend hosting | https://render.com |
| Vercel | Frontend hosting | https://vercel.com |

## Step 1: Clone & Install

```bash
git clone https://github.com/EnJirad/velnox.git
cd velnox
bun install
```

## Step 2: Database Setup (Neon)

1. Create a new Neon project
2. Copy the connection string
3. Open the Neon SQL Editor
4. Paste the contents of `db/run-sqleditor.sql`
5. Click "Run" to create all tables

## Step 3: Google OAuth Setup

1. Go to https://console.cloud.google.com
2. Create a new project (or select existing)
3. Enable "Google+ API" or "Google OAuth2 API"
4. Go to Credentials → Create OAuth 2.0 Client ID
5. Set authorized redirect URI to:
   ```
   https://your-backend.onrender.com/api/auth/google/callback
   ```
   For local development:
   ```
   http://localhost:3001/api/auth/google/callback
   ```
6. Note the Client ID and Client Secret

## Step 4: Cloudflare R2 Setup

1. Create an R2 bucket in Cloudflare
2. Note the Account ID, Access Key ID, and Secret Access Key
3. Configure a public domain for the bucket (or use R2.dev subdomain)

## Step 5: Environment Variables

### Backend

Create `backend/.env`:

```env
DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/velnox?sslmode=require
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=your-bucket-name
R2_PUBLIC_DOMAIN=pub-xxx.r2.dev
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
JWT_SECRET=generate_a_strong_random_string
PORT=3001
CORS_ORIGINS=http://localhost:5173
```

### Frontend

Create `.env` in the project root:

```env
VITE_API_URL=http://localhost:3001/api
```

## Step 6: Run Development

### Terminal 1 — Backend

```bash
cd backend
bun run dev
```

Backend runs at http://localhost:3001

### Terminal 2 — Frontend (VelShop)

```bash
bun run dev
```

Frontend runs at http://localhost:5173

## Step 7: Verify

1. Open http://localhost:5173 — you should see the Velnox landing page
2. Open http://localhost:3001/health — you should see `{"status":"ok"}`
3. Click "Sign in" — Google OAuth flow should work (with proper redirect URI)

## Troubleshooting

### Database connection failed
- Verify `DATABASE_URL` is correct
- Ensure Neon database is running
- Check that `sslmode=require` is in the connection string

### Google OAuth not working
- Verify redirect URI matches exactly (including protocol and port)
- Ensure Client ID and Secret are correct
- Check that the OAuth consent screen is configured

### Frontend can't reach backend
- Verify `VITE_API_URL` points to the backend
- Check CORS_ORIGINS includes the frontend URL
- Ensure the backend is running

### R2 upload failing
- Verify R2 credentials are correct
- Check bucket permissions
- Ensure public domain is configured
