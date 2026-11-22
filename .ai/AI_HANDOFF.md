# Velnox AI Handoff — Current State
**Last verified:** 2026-11-22 · **Branch:** `main` · **Focus:** Velnox Marketplace — Stabilization & Verification Program Complete

---

## 0. Current Project State: STABILIZATION & VERIFICATION COMPLETED
- **Milestone 7.1 (Reality Check & CI Recovery):** COMPLETED & VERIFIED
  - Monorepo Typecheck: Clean across all 5 workspaces (`apps/velshop`, `apps/velseller`, `apps/velcenter`, `apps/velnox`, `backend`).
  - RealtimeHub lifecycle mapping bug resolved with `socketToUser` map and user-channel authorization.
  - PushNotificationService updated with honest FCM HTTP v1 reporting (`blocked_missing_credentials`).
- **Milestone 7.2 (Security & API Integration Audit):** COMPLETED & VERIFIED
  - Full OWASP Top 10 compliance verified (`backend/tests/security/owasp-top10-rebuild.test.ts`).
  - Zero P0/P1 security vulnerabilities.
  - Financial Invariants verified: Minor Satang BigInt math, double-entry ledger Debits == Credits, conditional inventory guards.
- **Milestone 7.3 (Full E2E & Load Testing):** COMPLETED & VERIFIED
  - 87/87 tests passed across 29 test suites (`bun run test:rebuild`).
  - Safe Concurrency Benchmark measured across 9 tiers (C=1, 10, 25 for Health, Categories, WS) with 0 errors and throughput up to 389.1 RPS.
- **Key Artifacts:**
  - Stabilization Report: `.ai/rebuild/STABILIZATION_REPORT.md`
  - Stabilization Evidence: `.ai/rebuild/STABILIZATION_TEST_EVIDENCE.md`
  - Cutover Runbook: `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`
  - Latest Report: `.ai/reports/LATEST.md`

---

## 1. Production Cutover & Deployment Readiness
- Platform stabilization and verification gates are 100% satisfied.
- Database isolation guards verified (fail closed against Neon production connection strings during test runs).
- Staging / Production cutover runbook is documented in `docs/CLOUDFLARE_CUTOVER_RUNBOOK.md`.

---

## 2. Invariants & Rules
- **Database:** Neon PostgreSQL is Single Source of Truth. Never test against production.
- **Canonical Parity:** `db/schema.sql` and `db/run-sqleditor.sql` must stay synchronized.
- **Financial Precision:** BigInt satang minor units only. No floats.
- **Double-Entry Balance:** Total Debits == Total Credits on every ledger posting.
- **Communication:** Thai language for all user-facing interactions (MANDATORY).
