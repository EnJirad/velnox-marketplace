# SECURITY — Auth, Session, Roles

## Purpose

Google OAuth + JWT httpOnly session cookies. Backend is the gatekeeper. Password-based staff login uses scrypt (`backend/lib/password.ts`).

## Source Locations

- `backend/routes/auth.ts` — `GET /auth/google`, `GET /auth/google/callback`, `GET /api/auth/me`, `POST /api/auth/logout`
- `backend/middleware/auth.ts` — `requireAuth`, `optionalAuth`, JWT verify, `revoked_tokens` check (in-memory `revokedJTIs` set + DB fallback)
- `backend/db/index.ts` — `revoked_tokens` table
- `packages/shared/src/hooks/use-auth.ts`, `packages/shared/src/components/RequireAuth.tsx`, `packages/shared/src/components/RequireRole.tsx` — frontend auth state
- `packages/shared/src/lib/api-routes.ts` — `api.auth.*`

## Data Flow

```
Frontend → /auth/google?returnTo=… → backend → Google consent
→ /auth/google/callback (code) → backend exchanges code, verifies identity
→ identity resolution (auth_identities → users.email normalized)
→ JWT (jti) + httpOnly Secure SameSite cookie (velnox_session)
→ redirect to frontend → GET /api/auth/me (credentials: include)
```

Identity is never duplicated: lookup `(provider, provider_id)` → else normalized `email` → else create. DB enforces `UNIQUE(provider, provider_id)` and `UNIQUE(email)`.

## Important Files

`backend/routes/auth.ts`, `backend/middleware/auth.ts`, `backend/db/index.ts`, `packages/shared/src/hooks/use-auth.ts`.

## Important Rules

- JWT in httpOnly cookie only — never localStorage. `requireAuth` on every authenticated route.
- Logout revokes by `jti` in `revoked_tokens` + in-memory set; expired JTIs cleaned periodically.
- Frontend `login()` redirects to backend; `useAuth()` polls `/api/auth/me`.
- Roles: `customer`, `seller`, `admin`/`owner`/`staff` (see `users.role`). Seller actions require `sellers.status = approved`. Admin/owner checked server-side — UI hiding is not security.
- CORS via `CORS_ORIGINS`, Helmet, `GOOGLE_REDIRECT_URI` must match registered redirect.

## Common Failure Modes

- Redirect URI mismatch, `CORS_ORIGINS` missing frontend origin, cookie `Secure`/`SameSite` misconfig, expired JWT, revoked `jti`, concurrent logins creating duplicate users (use transactional resolution).

## Verification

Test: login, logout, `GET /api/auth/me` with/without cookie, OAuth state, role-gated routes, CORS. Typecheck backend + affected app.

Related: `seller.md`, `backend.md`, `docs/SECURITY.md`, `docs/AUTHENTICATION.md`.
