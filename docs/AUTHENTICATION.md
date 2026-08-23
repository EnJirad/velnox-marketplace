# Authentication

## Flow

1. User clicks "Sign in with Google" in frontend
2. Frontend redirects to backend `/api/auth/google`
3. Backend redirects to Google OAuth consent screen
4. Google redirects back to backend with authorization code
5. Backend exchanges code for tokens, fetches user info
6. Backend resolves identity (see Identity Resolution)
7. Backend creates JWT, sets HttpOnly cookie
8. Backend redirects to frontend

## Identity Resolution

The same person MUST NEVER receive a new user record on repeated logins.

### Resolution Order
1. Look up `auth_identities` by (provider=google, provider_id)
2. If found → return existing user
3. If not found → normalize email (lowercase), look up `users.email`
4. If email found → create new auth_identity linking to existing user
5. If email not found → create new user + auth_identity

### Database Constraints
- `auth_identities` has UNIQUE(provider, provider_id)
- `users.email` has UNIQUE constraint
- Email is normalized before all comparisons

## Session

- JWT stored in HttpOnly, Secure, SameSite=strict cookie
- Cookie name: `session_token`
- NOT stored in localStorage
- Backend verifies on every authenticated request via `requireAuth` middleware

## Frontend Auth State

The `useAuth()` hook:
- Calls `/api/auth/me` on mount to check session
- Provides `login()`, `logout()`, `refresh()` methods
- Returns `{ user, isLoading, isAuthenticated }`
