# Velnox Authentication

## Overview

Velnox uses Google OAuth 2.0 with JWT tokens stored in httpOnly cookies.

## Flow

```
1. User clicks "Sign in with Google"
2. Frontend redirects to /api/auth/google
3. Backend redirects to Google OAuth consent screen
4. User approves
5. Google redirects to /api/auth/google/callback with authorization code
6. Backend exchanges code for tokens with Google
7. Backend fetches user info from Google
8. Backend resolves user identity (find or create)
9. Backend signs JWT with user ID and email
10. Backend sets httpOnly cookie: velnox_session
11. Backend redirects to frontend
12. Frontend fetches /api/auth/me to get user data
```

## Identity Resolution (ONE PERSON = ONE USER)

The system ensures that one Google account always maps to the same user:

### Step 1: Provider Lookup
```sql
SELECT user_id FROM user_auth_identities
WHERE provider = 'google' AND provider_id = $1
```

### Step 2: Email Fallback
```sql
SELECT id, email, name, avatar FROM users
WHERE LOWER(email) = $1
```
If found, link the new auth identity to the existing user.

### Step 3: Create New
If no match found, create:
1. New `users` row
2. New `user_auth_identities` row
3. New `customer_profiles` row
4. New `carts` row

## JWT Token

```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "iat": 1234567890,
  "exp": 1234567890
}
```

- **Secret:** `JWT_SECRET` environment variable
- **Expiry:** 7 days
- **Algorithm:** HS256

## Cookie

| Property | Value |
|----------|-------|
| Name | `velnox_session` |
| HttpOnly | true |
| Secure | true (production) |
| SameSite | lax |
| MaxAge | 7 days |
| Path | / |

## Middleware

### `authenticate`
Requires valid JWT. Returns 401 if missing/invalid.

### `optionalAuth`
Attaches user if JWT is valid, but doesn't require it.

## Security Notes

- Google Client Secret is NEVER exposed to frontend
- JWT secret is backend-only
- Cookie is httpOnly (not accessible via JavaScript)
- Cookie is Secure in production (HTTPS only)
- SameSite=lax prevents CSRF on most requests
