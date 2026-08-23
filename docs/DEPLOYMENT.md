# Velnox Deployment

## Overview

| Component | Platform |
|-----------|----------|
| VelShop (frontend) | Vercel |
| VelSeller (frontend) | Vercel |
| VelCenter (frontend) | Vercel |
| Backend API | Render |
| Database | Neon PostgreSQL |
| File Storage | Cloudflare R2 |

## 1. Database (Neon)

1. Create a Neon project at https://neon.tech
2. Open the SQL Editor
3. Paste contents of `db/run-sqleditor.sql`
4. Run the query
5. Copy the connection string (Connection Details → Psql connection string)
6. Use this as `DATABASE_URL`

## 2. Backend (Render)

1. Create a new Web Service at https://render.com
2. Connect your GitHub repository
3. Configure:
   - **Root Directory:** `backend`
   - **Build Command:** `bun install && bun run build`
   - **Start Command:** `bun run start`
   - **Environment:** Node
4. Add environment variables:
   ```
   DATABASE_URL=postgresql://...
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=...
   R2_PUBLIC_DOMAIN=...
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   JWT_SECRET=<generate-random-string>
   PORT=3001
   CORS_ORIGINS=https://velshop.vercel.app,https://velseller.vercel.app,https://velcenter.vercel.app
   ```
5. Deploy
6. Update Google OAuth redirect URI to include your Render URL:
   ```
   https://your-backend.onrender.com/api/auth/google/callback
   ```

## 3. Frontend (Vercel)

### VelShop
1. Create a new Vercel project
2. Connect the repository
3. Configure:
   - **Root Directory:** `apps/shop` (or project root for monorepo)
   - **Framework:** Vite
   - **Build Command:** `bun run build`
   - **Output Directory:** `dist`
4. Add environment variable:
   ```
   VITE_API_URL=https://your-backend.onrender.com/api
   ```
5. Deploy

### VelSeller
Same as VelShop but with root directory `apps/seller`.

### VelCenter
Same as VelShop but with root directory `apps/center`.

## 4. Cloudflare R2

1. Create an R2 bucket at https://dash.cloudflare.com
2. Note Account ID from the R2 overview
3. Create API token with R2 read/write permissions
4. Configure public access (R2.dev subdomain or custom domain)
5. Add R2 credentials to Render environment variables

## 5. Google OAuth

1. Go to https://console.cloud.google.com
2. Navigate to Credentials
3. Update OAuth 2.0 Client redirect URIs:
   ```
   http://localhost:3001/api/auth/google/callback  (development)
   https://your-backend.onrender.com/api/auth/google/callback  (production)
   ```
4. Update authorized JavaScript origins:
   ```
   http://localhost:5173  (development)
   https://velshop.vercel.app  (production)
   ```

## Post-Deployment Checklist

- [ ] Database schema applied
- [ ] Backend health check returns `{"status":"ok"}`
- [ ] Google OAuth redirect URIs updated
- [ ] CORS_ORIGINS includes all frontend URLs
- [ ] VITE_API_URL points to backend
- [ ] R2 bucket is publicly accessible
- [ ] SSL enabled on all services
