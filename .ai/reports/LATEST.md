# Latest Task Execution Report — Auth Me Schema Alignment & Post-Login Bounce Fix

**Execution Timestamp:** 2026-11-24
**Task:** Resolve Post-Login Bounce to `/auth` and "การเข้าสู่ระบบถูกยกเลิก"
**Status:** COMPLETED & VERIFIED
**Initiative:** Velnox Clean Rebuild Initiative

---

## 1. Summary of Work Completed
- **Fixed `fetchCurrentUser()` Schema Resolution:** Added `json?.data` into the data extraction chain in `packages/shared/src/lib/api-client.ts`. Previously, `{ success: true, data: { id, email } }` from the Workers API skipped straight to `json` (envelope), resulting in `undefined` id and returning `null`.
- **Backend Dual-Envelope Support:** Updated `workers/api/src/routes/auth.ts` `/me` endpoint to return `{ success: true, data: { ...user, user } }` satisfying both direct property readers and nested `.user` readers.
- **Prevented `/auth` Self-Redirect Loop:** Normalized `returnTo` in `/google`, `/line`, and `Auth.tsx` so that redirect targets starting with `/auth` automatically redirect to the home page or dashboard instead of bouncing back to the login page.
- **Reset Auth Singleton Promise on Token Consumption:** In `initAuth()`, invalidates `authInitPromise` when a token is extracted from the URL query so the user is immediately fetched and authenticated.
- **Immediate Cancellation Timer Clearance:** Updated `Auth.tsx` to clear `GOOGLE_AUTH_START_KEY` immediately when a token exists in `localStorage`.

---

## 2. Verification Summary
- `bun --filter @velnox/api test`: 94/94 tests PASS
- `bun run typecheck:worker`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors)
- `bun --filter @velnox/velshop typecheck`: PASS (0 errors)
- `bun run build:velshop`: PASS (built in 1m 9s)
- `git diff --check`: PASS (clean)
