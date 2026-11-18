# Velnox API

## Base URL

```
Production: https://your-backend.onrender.com/api
Development: http://localhost:3001/api
```

## Response Format

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

## Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/google` | No | Redirect to Google OAuth (browser) |
| GET | `/api/auth/google/callback` | No | OAuth callback handler (browser) |
| GET | `/api/auth/me` | Yes | Get current user |
| POST | `/api/auth/logout` | No | Clear session cookie |
| GET | `/api/auth/mobile/config` | No | Which native provider configurations are present |
| POST | `/api/auth/mobile/register` | No | Native email/password registration |
| POST | `/api/auth/mobile/login` | No | Native email/password login |
| POST | `/api/auth/mobile/google` | No | Native Google ID-token sign-in |
| POST | `/api/auth/mobile/line` | No | Native LINE ID-token sign-in |
| `/api/auth/forgot-password` | `{ "email": string }` | `200 { data: { requested: true } }` | Uniform answer for known and unknown addresses (no enumeration). Stores only the SHA-256 of a 32-byte single-use token, valid 30 minutes; requesting again invalidates the previous link. `503 EMAIL_NOT_CONFIGURED` when no mail transport is set. Rate limit: 3 per 15 min per IP. |
| `/api/auth/reset-password` | `{ "token": string, "password": string }` | `200 { data: { reset: true } }` | Consumes the token atomically (`used_at` guard), hashes the new password with scrypt and clears any other outstanding link for the account. Unknown, used and expired tokens all return `400 INVALID_RESET_TOKEN`. Rate limit: 5 per 15 min per IP. |

### Native authentication contract

All native routes use the same `velnox_session` cookie and the same
`{ success, data | error }` envelope as the web API. Callers must send the
cookie on every authenticated request (`Cookie: velnox_session=<jwt>`).

| Path | Request body | Success | Notes |
|------|--------------|---------|-------|
| `/api/auth/mobile/register` | `{ "name": string, "email": string, "password": string }` | `201 { data: { user } }` | Password must be 8–128 chars with a letter and a digit; hashed with scrypt. |
| `/api/auth/mobile/login` | `{ "email": string, "password": string }` | `200 { data: { user } }` | Generic `INVALID_CREDENTIALS` for unknown email, wrong password and password-less accounts. |
| `/api/auth/mobile/google` | `{ "idToken": string }` | `200 { data: { user } }` | ID token verified against Google tokeninfo; audience `MOBILE_GOOGLE_CLIENT_ID`, issuer and expiry checked server-side. A verified email matching an existing account is linked safely. |
| `/api/auth/mobile/line` | `{ "idToken": string, "nonce"?: string }` | `200 { data: { user } }` | ID token verified against `POST https://api.line.me/oauth2/v2.1/verify` with `LINE_CHANNEL_ID`; issuer, audience, expiry and nonce checked. An existing password account with the same email returns `ACCOUNT_CONFLICT`; no automatic linking. |

Error codes: `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`,
`EMAIL_EXISTS`, `EMAIL_NOT_VERIFIED`, `INVALID_GOOGLE_TOKEN`,
`INVALID_LINE_TOKEN`, `LINE_EMAIL_SCOPE_REQUIRED`, `ACCOUNT_CONFLICT`,
`GOOGLE_NOT_CONFIGURED`, `LINE_NOT_CONFIGURED`, `GOOGLE_UNAVAILABLE`,
`LINE_UNAVAILABLE`, `DB_ERROR`, `RATE_LIMITED`.

These routes replace the browser Turnstile challenge with per-IP rate limits
(register 5/min, login 8/min, social 10/min) in addition to the global security
limiter. Session restoration (`GET /api/auth/me`) and logout
(`POST /api/auth/logout`) are unchanged.

### Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/products` | No | List products (paginated, filterable) |
| GET | `/api/products/:id` | No | Get product by ID |
| GET | `/api/products/slug/:slug` | No | Get product by slug |

**Query Parameters for List:**
- `page` — Page number (default: 1)
- `pageSize` — Items per page (default: 12, max: 50)
- `search` — Text search in name/description
- `category` — Filter by category slug
- `featured` — Filter featured products (`true`)

### Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/categories` | No | List all categories |

### Cart

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/cart` | Yes | Get current user's cart |
| POST | `/api/cart/items` | Yes | Add item to cart |
| PATCH | `/api/cart/items/:itemId` | Yes | Update item quantity |
| DELETE | `/api/cart/items/:itemId` | Yes | Remove item from cart |

### Shops

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/shops` | No | List shops |
| GET | `/api/shops/:slug` | No | Get shop by slug |

### Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/orders` | Yes | List user's orders |
| POST | `/api/orders` | Yes | Create order |
| GET | `/api/orders/:id` | Yes | Get order by ID |

### Addresses

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/addresses` | Yes | List user's addresses |
| POST | `/api/addresses` | Yes | Create address |
| PUT | `/api/addresses/:id` | Yes | Update address |
| DELETE | `/api/addresses/:id` | Yes | Delete address |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check with DB status |

## Rate Limiting

Planned: 100 requests per minute per IP for unauthenticated, 300 for authenticated.

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Not authenticated |
| `INVALID_TOKEN` | Invalid or expired JWT |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `VALIDATION_ERROR` | Invalid request body |
| `CONFLICT` | Resource already exists |
| `INTERNAL_ERROR` | Server error |
