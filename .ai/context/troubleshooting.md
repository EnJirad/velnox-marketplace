# TROUBLESHOOTING

Only real project issues. Do not invent solutions.

## Build / TypeScript

- **Build fails:** `bun install`, then `bun run typecheck` for errors; check missing `VITE_*` or env.
- **Shared package breaks all apps:** wildcard `packages/shared` affects every app; typecheck all after touching it.

## Auth / Session

- **Can't stay logged in:** verify `velnox_session` cookie is `httpOnly` + `Secure` (prod) + `SameSite`, `JWT_SECRET` set, `GET /api/auth/me` called with `credentials: include`.
- **Duplicate users on login:** identity resolution must check `auth_identities (provider, provider_id)` then normalized `users.email`; use `ON CONFLICT`/transaction.
- **Google OAuth fails:** `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` must match Google Cloud redirect list.
- **Revoked session still accepted:** check `revoked_tokens` + `revokedJTIs` set; expired `jti` cleanup runs periodically.

## CORS / Cookies

- **Frontend can't reach API:** `VITE_API_URL` must match backend; `CORS_ORIGINS` must include all 4 frontend origins.

## R2 / Uploads

- **Presign fails:** verify `R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_DOMAIN` and allowed `Content-Type` (jpeg/png/webp/avif, ≤10 MB) and ownership check for shop/evidence.
- **Image not showing:** confirm `media` row + reference update after `POST /api/upload/confirm`; prod needs `R2_PUBLIC_DOMAIN` public access + CORS.

## Neon / Database

- **DB errors / idle:** Neon may sleep; wake it, verify `DATABASE_URL` and `sslmode=verify-full`; run `db/run-sqleditor.sql` for fresh DB.
- **Migration not applied:** run `.github/workflows/production-db-verify.yml` first — it prints which database it actually reached and names every missing object. Apply with `production-db-migrate.yml` (secret `NEON_PRODUCTION_DATABASE_URL`); `schema_migrations` tracks drift.
- **Workflow says `BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured`:** the canonical production secret is missing. Create it at Settings → Secrets and variables → Actions with the Neon connection string for the same project/branch Render's `DATABASE_URL` uses. It deliberately does not fall back to anything else.

## Deploy

- **Vercel:** 4 projects, each `bun run build:<app>` → `apps/<app>/dist`; `VITE_*` as **Config** (public).
- **Render:** `bun run api:start` must listen on `PORT`; `vercel.json` rewrites SPA to `index.html`.
- **Freebuff preview:** bind to `0.0.0.0` with injected `PORT`; use `freebuff-preview status`/`logs`.

## Routing / i18n

- **SPA refresh 404:** ensure hosting rewrite to `index.html`.
- **Raw translation keys:** run `bun run i18n:check`; fix missing key in `packages/shared/src/lib/i18n/`.

## Environment

- **Secrets leaked:** never put `DATABASE_URL`/`JWT_SECRET`/`R2_SECRET` in `VITE_*` or git; `VITE_API_URL` is the only public API URL.
