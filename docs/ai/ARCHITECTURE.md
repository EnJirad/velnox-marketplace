# ARCHITECTURE

## System

```
4 Vercel frontends (velshop, velseller, velcenter, velnox)
        ↓  HTTPS + cookies (credentials: include)
1 Render backend — Express + WebSocket (backend/server.ts, listens on PORT)
        ↓  pg.Pool (SSL verify-full)
Neon PostgreSQL  +  Cloudflare R2 (S3-compatible)  +  WebSocket delivery
```

## Source-of-Truth Rules

| Concern | Truth | Cache / Delivery | Must not |
|---------|-------|-----------------|----------|
| Commerce, financial, critical data | Neon | — | Duplicate in another DB, localStorage, or R2 |
| Binary objects (images, docs) | R2 object | `media` table in Neon holds URL/key metadata | Treat R2 URL as commerce state |
| Realtime updates | Neon | WebSocket channels are delivery only | Treat WS state as persistent |
| Session | JWT + `revoked_tokens` table | In-memory `revokedJTIs` set per instance | Store token in localStorage |
| Frontend | Never source of truth | Calls `GET /api/auth/me` etc. | Direct Neon connection, server secrets |

## Frontend / Backend Boundary

- Frontend: React 19 + Vite 7 + Tailwind v4 + shadcn/ui. Never holds `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, `R2_SECRET_ACCESS_KEY`, `BOOTSTRAP_OWNER_SECRET`. Only `VITE_*` (public).
- Backend: sole gateway to Neon and R2. Validates auth/authz/ownership on every mutation. Returns JSON from `/api/*` only.
- Shared: `packages/shared` is the only shared package (`@velnox/shared/*` via Vite alias). `types` are shared; secrets never cross.

## Monorepo & Deployment

- `bun` workspaces (`apps/*`, `packages/*`, `backend`). Scripts in root `package.json`: `dev:velshop`, `api:dev`, `build:apps`, `typecheck`, `i18n:check`.
- Vercel: 4 independent projects, each `bun run build:<app>` → `apps/<app>/dist`. `VITE_*` env are type **Config** (public).
- Render: `bun run api:start` (`tsx server.ts`). Env from Render dashboard; `CORS_ORIGINS` lists all 4 frontends + corporate.
- `vercel.json` rewrites SPA to `index.html`.

## Data Ownership (enforced in backend)

- **Customer** owns own profile, addresses, cart, wishlist, orders.
- **Seller** owns own seller record, shop, products — only when `sellers.status = approved`.
- **Admin/owner** owns platform operations (seller approval, product moderation, categories, audit). Seller/customer cannot mutate admin resources.
- Identity: `auth_identities (provider, provider_id) UNIQUE` + normalized `users.email UNIQUE`. Same person never gets a duplicate user on re-login.

## Key Invariants

1. Neon is the only commerce source of truth.
2. Frontend ↔ backend via `VITE_API_URL` + `credentials: include`; backend checks `requireAuth`/`requireRole`.
3. `packages/shared` wildcard exports; apps import via `@velnox/shared/...`.
4. Profile images use fixed R2 keys (`profile/avatar/{userId}.webp`); uploads are presign → PUT → confirm.
5. `db/schema.sql` and `db/run-sqleditor.sql` are the only canonical schema files and must stay synchronized (see `DATABASE.md`).

Related: `docs/ai/DATABASE.md`, `docs/ai/AUTH.md`, `docs/ai/WORKFLOW.md`, `docs/ARCHITECTURE.md` (human doc).
