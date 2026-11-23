# Latest Task Execution Report — OAuth Redirect URI Alignment & Dynamic State Preservation

**Execution Timestamp:** 2026-11-23
**Task:** Resolve Google "redirect_uri_mismatch" and LINE "Invalid redirect_uri value" Errors
**Status:** COMPLETED & VERIFIED
**Initiative:** Velnox Clean Rebuild Initiative

---

## 1. Summary of Work Completed
- **OAuth State Redirect URI Preservation:** Added `redirectUri` to the state parameter round-trip in `workers/api/src/routes/auth.ts` for both Google and LINE OAuth flows. This guarantees that whatever URI was registered and sent during the authorization request is character-for-character identical during the token exchange code grant step.
- **Dynamic & Configurable Redirect URIs:** Added `GOOGLE_REDIRECT_URI` and `LINE_REDIRECT_URI` to `Bindings` in `workers/api/src/types.ts`. If explicitly defined, the worker will use the exact configured URI; otherwise it dynamically falls back to the active request origin and pathname.
- **Callback Alignment Runbook:** Documented the exact Authorized Redirect URIs that must be added to Google Cloud Console and LINE Developers Console to resolve 400 Bad Request errors.
- **All Verifications Green:** 94/94 Workers tests pass, all monorepo typechecks clean (`@velnox/api`, `@velnox/validation`, `@velnox/api-contract`, `@velnox/api-client`, `@velnox/ledger`, `@velnox/velshop`).

---

## 2. Verification Summary
- `bun --filter @velnox/api test`: 94/94 tests PASS
- `bun run typecheck:worker`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors)
- `bun --filter @velnox/velshop typecheck`: PASS (0 errors)
- `git diff --check`: PASS (clean)
