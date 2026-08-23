# Velnox Security

## Principles

1. **Backend as Gatekeeper** — All database access through API
2. **No Secrets in Frontend** — Only VITE_API_URL is public
3. **Neon = Source of Truth** — No business data in browser storage
4. **Parameterized Queries** — No SQL string concatenation

## Authentication Security

- **httpOnly cookies** — Not accessible via JavaScript
- **Secure flag** — HTTPS only in production
- **SameSite=lax** — CSRF protection
- **JWT expiry** — 7 days, renewable
- **Google OAuth** — Industry-standard authentication

## API Security

- **CORS** — Configured for specific frontend origins
- **Helmet** — Security headers (X-Frame-Options, CSP, etc.)
- **Rate Limiting** — Planned (100 req/min unauthenticated, 300 authenticated)
- **Input Validation** — Zod schemas on all endpoints
- **Error Handling** — No sensitive data in error responses

## Database Security

- **SSL/TLS** — `sslmode=require` for all connections
- **Connection Pooling** — Max 20 connections, idle timeout 30s
- **Parameterized Queries** — pg library handles escaping
- **Least Privilege** — Database user has only required permissions
- **No Direct Browser Access** — Backend is the only DB client

## File Storage Security

- **Presigned URLs** — R2 credentials never exposed to browser
- **Time-limited** — Upload URLs expire after a short window
- **Content-Type Validation** — Only allowed image types
- **Size Limits** — Max 5MB per file

## Environment Variables

### Backend (Render) — SECRETS
```
DATABASE_URL          — Neon connection string
R2_ACCESS_KEY_ID      — R2 credentials
R2_SECRET_ACCESS_KEY  — R2 credentials
GOOGLE_CLIENT_SECRET  — OAuth secret
JWT_SECRET            — Token signing key
```

### Frontend (Vercel) — PUBLIC ONLY
```
VITE_API_URL          — Backend API URL (public, safe)
```

## What's NOT Allowed

- ❌ Database credentials in frontend code
- ❌ Google Client Secret in frontend
- ❌ JWT Secret in frontend
- ❌ R2 Secret Access Key in frontend
- ❌ SQL string concatenation
- ❌ Business data in LocalStorage
- ❌ Direct Neon connection from browser
- ❌ Secrets in git repository

## Audit Logging

The `audit_logs` table tracks:
- Who performed the action
- What action was taken
- Which entity was affected
- When it happened
- IP address

## Behavioral Events

The `behavioral_events` table tracks user behavior for analytics:
- Product views, searches, cart actions
- Session tracking via `session_id`
- Optional `user_id` (only when authenticated)
- No PII in metadata
