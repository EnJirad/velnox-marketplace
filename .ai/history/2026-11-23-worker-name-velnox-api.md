# Worker Name Reversion & Multi-Frontend Deployment Runbook

**Execution Date:** 2026-11-23
**Branch:** `main`
**Task:** Revert Cloudflare Worker name from `velnox-marketplace` to `velnox-api` across all configurations, and document comprehensive access and deployment runbook for all frontends and the API.

---

## 1. Modifications
- **`wrangler.jsonc` (Repo Root):** Set `"name": "velnox-api"`
- **`workers/api/wrangler.jsonc`:** Set `"name": "velnox-api"`
- **`packages/shared/src/lib/sites.ts`:** Updated production fallback API URL to `https://velnox-api.ma0979354966-js91934.workers.dev`

## 2. Verification
- `git diff --check`: PASS (clean)
- `bun --filter @velnox/api test`: 94/94 PASS (391 expect calls)
- `bun --filter @velnox/api typecheck`: PASS (0 errors)
- `bun run typecheck:packages`: PASS (0 errors across validation, api-contract, api-client, ledger)
