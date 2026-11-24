# Session History — User Schema Resolution & Auth Bounce Elimination

**Date:** 2026-11-24
**Focus:** Fix post-login bounce to `/auth` and "การเข้าสู่ระบบถูกยกเลิก" caused by schema mismatch in `fetchCurrentUser()` and `/auth` loop.
**Status:** COMPLETED & VERIFIED

---

## 1. Problem Description
- Users completed Google or LINE login, but the browser returned to `/auth` and displayed: `"การเข้าสู่ระบบถูกยกเลิก"`.

## 2. Root Cause Identified
1. **Schema Mismatch in `fetchCurrentUser()`:**
   - In `workers/api/src/routes/auth.ts`, `GET /me` returned `{ success: true, data: user }`.
   - In `packages/shared/src/lib/api-client.ts`, `raw` was extracted via:
     `const raw = json?.data?.user ?? json?.user ?? json;`
     Notice `json?.data` was completely missing from the fallback chain.
   - Because `json.data.user` did not exist, `raw` became the outer JSON object `{ success: true, data: { id: ... } }`.
   - Since `raw.id` was undefined on the envelope, `fetchCurrentUser()` returned `null`.
   - As a result, `isAuthenticated` remained `false` even though the API request returned HTTP 200 OK!
2. **Post-Login Bounce to `/auth`:**
   - When `returnTo` was `/auth` (or began with `/auth`), both the Worker OAuth redirects and `Auth.tsx` redirected the browser back to `/auth`.
   - Because `isAuthenticated` remained `false`, the 4000ms timer in `Auth.tsx` fired and displayed `"การเข้าสู่ระบบถูกยกเลิก"`.
3. **Promise Caching in `initAuth()`:**
   - When a token arrived in URL query parameters, `authInitPromise` had already resolved to `null` on initial page load, preventing re-fetching.

## 3. Solution Implemented
1. **Support Direct Data Unwrap in `api-client.ts`:**
   - Updated `const raw = json?.data?.user ?? json?.data ?? json?.user ?? json;` so both `{ data: user }` and `{ data: { user } }` resolve cleanly.
   - In `initAuth()`, reset `authInitPromise = null` when a new token is consumed from the URL.
   - In `useAuth()`, trigger auth fetch if a Bearer token exists in `localStorage` while not yet authenticated.
2. **Dual Schema Compatibility in Backend `GET /me`:**
   - Updated `authRoutes.get("/me")` to return `{ success: true, data: { ...user, user } }`, ensuring `data.id` and `data.user` are both available.
3. **Eliminate `/auth` Return Loop:**
   - If `returnTo` begins with `/auth`, both `/google` and `/line` fall back to `"/"`.
   - In `Auth.tsx`, post-auth navigation ignores `/auth` return targets and lands on the user's role home.
   - In `Auth.tsx`, cancellation timer check immediately skips if `getStoredAccessToken() !== null`.

## 4. Verification Results
- `bun --filter @velnox/api test`: 94/94 tests PASS
- `bun run typecheck:worker`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors)
- `bun --filter @velnox/velshop typecheck`: PASS (0 errors)
- `bun run build:velshop`: PASS (built cleanly in 1m 9s)
- `git diff --check`: PASS (clean)
