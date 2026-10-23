# Deployment

## Frontend (Vercel)

Four independent Vercel projects from one GitHub repository.

| Project | Root Directory | Build Command | Output |
|---------|---------------|---------------|--------|
| velshop | `.` | `bun run build:velshop` | `apps/velshop/dist` |
| velseller | `.` | `bun run build:velseller` | `apps/velseller/dist` |
| velcenter | `.` | `bun run build:velcenter` | `apps/velcenter/dist` |
| velnox | `.` | `bun run build:velnox` | `apps/velnox/dist` |

### Environment Variables (Vercel)
```
VITE_API_URL=https://velnox-api.onrender.com/api
```

## Backend (Render)

Single Render Web Service: `velnox-api`

### Build
```bash
bun install
bun run build
```

### Start
```bash
bun run api:start
```

### Environment Variables (Render)
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
CORS_ORIGINS=https://velshop.vercel.app,https://velseller.vercel.app,https://velcenter.vercel.app,https://velnox.vercel.app
PORT=3001
```

## Database (Neon)

1. Create Neon project
2. Run `db/run-sqleditor.sql` in SQL Editor
3. Set DATABASE_URL in Render environment

## CORS

Backend must allow all four frontend origins:
- https://velshop.vercel.app
- https://velseller.vercel.app
- https://velcenter.vercel.app
- https://velnox.vercel.app
