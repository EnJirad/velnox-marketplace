# Archived: Production-readiness audit, risk-ordered (TASK 009, 2026-09-26)

Moved out of `.ai/AI_HANDOFF.md` §19 on 2026-09-27 to keep the live handoff under
the ~55 KB edit limit. The record below is kept verbatim as history; the verdict
(**PRODUCTION: NOT READY**) and the still-open blockers stay live in
`.ai/AI_HANDOFF.md` §6, and the per-gate evidence lives in
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](../../tasks/completed/production-readiness-audit-2026-09-26.md).

---

## 19. Production-readiness audit — risk-ordered (TASK 009, 2026-09-26)

The 13 release gates were walked high-risk → low-risk. **PRODUCTION: NOT READY.**
Per-gate evidence, the measured tooling window, and every BLOCKED reason:
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md).
**PRODUCTION PAYMENT READINESS: NOT CLAIMED.**

**Fixed (code, executed).** `GET /api/admin/sellers` was unbounded *because* its only
consumer counted a badge from the whole list. It now pages (`lib/pagination.ts` helpers,
`COUNT(*) OVER()`, `ORDER BY created_at DESC, id DESC`, `LIMIT/OFFSET`, a fallback count
query, `data: { sellers, pagination }`), the shared action forwards `page`/`limit`, and
`Center.tsx` reads `pagination.total` for sellers + `GET /api/admin/dashboard/counts`
for products — so the dashboard no longer downloads either queue to count it.
Executed: `backend/tests/admin-sellers-pagination.test.ts` **8 pass / 0 fail** (real
route, real session cookies, disposable DB: 401/403, exact total at `limit=1`, default
page 25, clamp 100, disjoint pages, page-past-end total, no `total_count` leak) plus 9
static guards in `admin-queue-pagination.test.ts` (**30 pass**).

**BLOCKED, unchanged.** Stripe TEST E2E — this workspace *and* production answer
`STRIPE_NOT_CONFIGURED` (`/api/stripe/configured`) with every method disabled
(`/api/payments/methods`), so no Card / PromptPay / webhook / refund / idempotency
flow was run and no mock was substituted (§16/§18 stand). Browser E2E, Google OAuth
E2E and R2 authenticated E2E: no browser and no authorized account. The
`products/moderation` handler and the locale `review:` blocks are past the edit window
(162,487 B; 70,035 / 55,934 / 57,528 B).

**Verified this pass (production, read-only, zero writes).** `/api/health` 200 ·
`/api/health/r2` 200 · four frontends 200 (`velshop|velseller|velcenter.vercel.app`,
`velnox-theta.vercel.app`) with SPA deep routes 200 · nine protected endpoints → **401
`UNAUTHORIZED`** · public reads 200 · **0** secret patterns across all four deployed
bundles (1.27 MB). **New findings (owner actions, no code change):** (1) the `velnox.com`
zone is unresolvable (lame NS delegation) and `center.velnx.com` is NXDOMAIN —
production is unaffected because the Vercel projects set `VITE_*` overrides and no
deployed bundle references `*.velnox.com`; (2) `SellerVerificationQueue.tsx:177`
carries the repository's only corrupted copy string (`ลบrêtailer`), left for an owner
wording decision.

**Regression (this tree).** Disposable PostgreSQL + `JWT_SECRET`: **577 pass / 2 skip /
0 fail** (579 tests, 25 files; both skips are the pre-existing R2-credential cases).
No database configured: **533 pass / 46 skip / 0 fail**. Backend `tsc` exit 0 · 4/4
apps exit 0 · i18n 1295/1295/1295 · `db/schema.sql` ≡ `db/run-sqleditor.sql` · no
`db/run-update.sql` · `git diff --check` clean.

---
