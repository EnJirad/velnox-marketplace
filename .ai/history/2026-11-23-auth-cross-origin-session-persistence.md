# Session History — Cross-Origin OAuth Session Persistence & Third-Party Cookie Resolution

**Date:** 2026-11-23
**Focus:** Fix post-login cancellation error ("การเข้าสู่ระบบถูกยกเลิก") across Google, LINE, and password login flows.
**Status:** COMPLETED & VERIFIED

---

## 1. Problem Description
- When users authenticated via Google or LINE OAuth, the consent screen completed successfully, but the browser returned to `/auth` and displayed: `"การเข้าสู่ระบบถูกยกเลิก"` (Sign-in was cancelled).
- Password and member login reloaded without retaining authentication state when deployed cross-origin.

## 2. Root Cause Analysis
1. **Third-Party Cookie Blocking Between Domains:**
   - Frontend is hosted on `https://velnox-shop-3mh.pages.dev` (eTLD+1: `pages.dev`).
   - Backend API is hosted on `https://velnox-api.ma0979354966-js91934.workers.dev` (eTLD+1: `workers.dev`).
   - Cookies issued by `workers.dev` are partitioned/blocked by modern browsers (Safari ITP, Chrome Privacy Sandbox, mobile WebViews) on cross-site fetch requests (`credentials: "include"`).
   - `fetch(`${API_BASE}/auth/me`)` returned 401 Unauthorized because the session cookie was omitted by the browser.
2. **Missing `frontendOrigin` in OAuth Initiation:**
   - `GET /auth/google` and `GET /auth/line` relied on `Referer` header which was stripped on cross-origin navigations, falling back to non-existent `https://shop.velnox.live`.
3. **Cancellation Timer Triggered on Unauthenticated Landing:**
   - In `Auth.tsx`, `sessionStorage` stored `GOOGLE_AUTH_START_KEY`. When the page reloaded and `isAuthenticated` was `false`, the 4000ms timer fired and set `t("auth.googleCancelled")`.

## 3. Solution Implemented
1. **Frontend Origin Preservation:**
   - `Auth.tsx` now passes `origin` parameter when redirecting to `/auth/google` and `/auth/line`.
   - `workers/api/src/routes/auth.ts` preserves `frontendOrigin` in base64 state payload, falling back to `https://velnox-shop-3mh.pages.dev`.
2. **Dual Transmission (Cookies + URL Token Fallback):**
   - On OAuth callback completion, the backend sets session cookies AND redirects with `?token=${accessToken}&refresh_token=${refreshToken}`.
   - `api-client.ts` synchronously ingests `token` from the URL, stores it in `localStorage`, cleans the URL using `window.history.replaceState`, and clears `GOOGLE_AUTH_START_KEY`.
   - `api-client.ts` and `api-routes.ts` attach `Authorization: Bearer <token>` to all API requests, providing full immunity against third-party cookie restrictions.
   - Automatic refresh token rotation via `POST /auth/refresh` when access token expires.
3. **Password & Member Login Token Storage:**
   - `handleEmailPasswordLogin`, `handleEmailPasswordRegister`, and `handleMemberLogin` store tokens directly from the response envelope and navigate without blind reload.
4. **Cookie Partitioning:**
   - Added `Partitioned;` attribute to session and refresh cookies for CHIPs compliance.

## 4. Verification Results
- `bun --filter @velnox/api test`: 94/94 tests PASS
- `bun run typecheck:worker`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors)
- `bun --filter @velnox/velshop typecheck`: PASS (0 errors)
- `bun run build:velshop`: PASS (built cleanly in 45.10s)
- `git diff --check`: PASS (clean)
