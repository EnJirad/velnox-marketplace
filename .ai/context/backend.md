# BACKEND

Express API + WebSocket in one Node process (`backend/`, deployed on Render). It is the sole gateway to Neon and R2 — the frontends never connect to either.

## Process & Middleware Order

`backend/server.ts` — order matters:

1. `helmet()`
2. `app.set("trust proxy", 1)` — Render's single proxy hop, so `req.ip` stays honest for IP-keyed rate limits
3. `cookieParser()`
4. Raw-body branch for `POST /api/payments/stripe/webhook` (signature verification) — **before** `express.json`
5. `express.json({ limit: "1mb" })` — file bytes go to R2 via presigned URLs and never transit the API
6. `cors({ origin: allOrigins, credentials: true })` — `CORS_ORIGINS` + known prod URLs + dev `5173`–`5176`
7. `createOriginGuard(allOrigins)` — Origin validation for state-changing requests (CSRF guard for cookie auth)
8. `rateLimitSecurity` — differentiated per-route-class limits
9. Route mounts (below), then `errorHandler` last
10. `server.listen(PORT, "0.0.0.0")` — `PORT` from env, default `3001`
11. WebSocket server on path `/ws`, `maxPayload` 16 KB

Known deviation: `ensureVariantTables()` runs at startup from `server.ts`, while `AI_RULES.md` §6 says startup must never run DDL. Tracked in `.ai/AI_HANDOFF.md`; do not copy the pattern.

## Route Modules (`backend/routes/`)

Each module exports a `setup*Routes(app)` (verification exports `registerVerificationRoutes`); `server.ts` calls them in this order:

| Module | Owns | ~registrations |
|--------|------|----------------|
| `auth.ts` | Google OAuth, `/api/auth/me`, logout | 6 |
| `upload.ts` | R2 presign + confirm | 6 |
| `index.ts` | Customer profile, public product/category reads, and the `errorHandler` mount | 7 |
| `seller.ts` | Onboarding, approval, shop, profile | 8 |
| `seller-orders.ts` | Seller order list/detail/status/subscriptions | 5 |
| `products.ts` | Product CRUD, images, catalog, moderation | 40 |
| `cart.ts` | Cart, wishlist, orders | 15 |
| `stripe.ts` | Stripe payment sessions + webhook | 5 |
| `product-options.ts` | Option groups/values, variant mapping, attributes | 22 |
| `velrepeat.ts` / `velrepeat-plans.ts` | VelRepeat V1 (buy-ahead) / V2 (recurring) | 7 / 12 |
| `chat.ts` | Conversations, messages, notifications | 13 |
| `admin.ts` | Bootstrap / owner claim, platform settings, employees | 4 |
| `center.ts` | VelCenter: overview, orders, staff, audit, settings | 17 |
| `verification.ts` | Seller verification (evidence, review decisions) | 10 |
| `seller-intelligence.ts` | Goals, income, reorder suggestions | 7 |

The client-side route table is `packages/shared/src/lib/api-routes.ts` — keep it in step with the server, and never add a second endpoint for a resource that already has one.

## Authorization

VelCenter authorization is `ROLE + PERMISSION + RESOURCE`, implemented in `backend/lib/permissions.ts`:

- `PERMISSION_CATALOG` — 8 codes: `orders.view`, `orders.manage`, `products.moderate`, `sellers.manage`, `users.manage`, `staff.manage`, `audit.view`, `settings.manage`
- `ALL_PERMISSION_CODES` — what `owner`/`admin` implicitly hold
- `CENTER_ROLES` = `owner | admin | staff`
- `roleOf(userId)`, `isCenterMember(userId)` — deny by default
- `resolvePermissions(userId, role?)` — owner/admin → every code; `staff` → `employees.permissions` (JSONB); anyone else → `[]`. A missing row, malformed JSON, or a DB error returns `[]`, never a throw
- `userHasPermission(userId, code, role?)` — **the check every guarded endpoint runs**

Catalog rule: a code exists only while at least one endpoint enforces it. A code that guards nothing is a checkbox that lies to the owner who ticks it.

Frontend hiding is UX only. The API is the boundary; without the permission the answer is `403`.

Owner-only by design (not a gap): changing roles, granting permissions, creating/deleting staff, and password resets. Holders of `staff.manage`/`users.manage` get a read-only roster.

## Session & Errors

- `backend/middleware/auth.ts` — `requireAuth`, `optionalAuth`, `revokeToken`, `isTokenRevokedSync` (in-memory `revokedJTIs` + `revoked_tokens` DB fallback). Details: `security.md`.
- `backend/middleware/error.ts` — `AppError(statusCode, code, message)` → `{ success: false, error: { code, message } }`; anything else → `500 INTERNAL_ERROR` with a generic message so internals never leak.
- `backend/middleware/rate-limit.ts` — bounded in-memory fixed-window limiter, per-process only (no Redis). Rule classes: auth (IP-keyed) → money/order mutations → reviews → chat → verification → uploads → customer/seller/admin mutations → public reads (300/min) → 600/min catch-all. `429` returns `RATE_LIMITED` + `Retry-After`.
- `backend/middleware/origin-guard.ts` — trusted-origin enforcement for cookie-authenticated mutations.

## Domain Libraries (`backend/lib/`)

`categories.ts` (taxonomy), `product-lifecycle.ts` (status transitions), `variant-options.ts` (option/variant mapping), `inventory.ts` (stock, race-safe), `media-config.ts`, `password.ts` (scrypt `$scrypt$N$r$p$salt$hash`, timing-safe verify), `permissions.ts`, `reviews.ts`, `seller-stats.ts` (the single commission source), `audit-log.ts` (`writeAuditLog`, `sanitizeAuditDetails` redaction, `auditClientIp`).

`backend/jobs/velrepeat-scheduler.ts` — scheduled VelRepeat runs. `backend/db/index.ts` — single `pg.Pool` (SSL `verify-full`) and the `query()` helper; all SQL is parameterized.

## Verification

```bash
cd backend && bun tsc --noEmit
cd backend && bun test tests
```

For a route change: hit the affected endpoint, confirm `403` without the required permission, confirm the error shape, and confirm a DB failure is not rendered as an empty success.

Related: `architecture.md`, `database.md`, `security.md`, `realtime.md`, `project-map.md`, `docs/API.md`.
