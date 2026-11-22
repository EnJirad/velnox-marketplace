# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Production Cutover Verification Tooling & Runbook Ready

---

## 0. Current Project State: PRODUCTION CUTOVER READY
- **Milestones 1 through 8:** 100% COMPLETED & VERIFIED.
- **Stabilization & Verification Program (Milestones 7.1, 7.2, 7.3):** 100% COMPLETED.
  - Monorepo Typecheck: Clean across all 5 workspaces (`velshop`, `velseller`, `velcenter`, `velnox`, `backend`).
  - Production Builds: Clean across all 4 frontend apps (`tsc -b && vite build` passing).
  - Test Suite: 87/87 tests passed across 29 test suites (`bun run test:rebuild`).
  - Package Contracts: 28/28 tests passed (`bun test packages/*/tests`).
  - Concurrency Benchmark: Measured throughput up to 389.1 RPS with 0 errors.
- **Cutover Automation:**
  - Automated smoke testing tool added: `scripts/verify-cutover.ts` (`bun run cutover:verify`).
  - Cutover Runbook: `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`.
- **Key Artifacts:**
  - Cutover Tool: `scripts/verify-cutover.ts`
  - Stabilization Report: `.ai/rebuild/STABILIZATION_REPORT.md`
  - Stabilization Evidence: `.ai/rebuild/STABILIZATION_TEST_EVIDENCE.md`
  - Cutover Runbook: `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Production Cutover Execution Plan
1. **Cloudflare Pages Deployment:** Link GitHub repo to Cloudflare Pages for `apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`.
2. **Environment Secrets:** Configure production secrets on Cloudflare Dashboard & Render.
3. **DNS Proxy Cutover:** Point CNAMEs in Cloudflare DNS under `velnox.live` to `*.pages.dev` and `api.velnox.live` to backend.
4. **Automated Verification:** Run `bun run cutover:verify` to confirm live reachability and health.

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL is Single Source of Truth. Never test against production.
- **Canonical Parity:** `db/schema.sql` and `db/run-sqleditor.sql` must stay synchronized.
- **Financial Precision:** BigInt satang minor units only. No floats.
- **Double-Entry Balance:** Total Debits == Total Credits on every ledger posting.
- **Communication:** Thai language for all user-facing interactions (MANDATORY).
