# AI Handoff archive — CLEAN MVP REWRITE Phase 0 audit and Phase 1 foundation (2026-10-21)

Moved out of `.ai/AI_HANDOFF.md` on 2026-10-22 (edit-headroom housekeeping) to make room
for §90. Verbatim record; both phases are complete and their full reports are linked below.

---

## §83. Phase 0 audit for the CLEAN MVP REWRITE (2026-10-21)

**Status: Phase 0 complete — WAITING FOR OWNER DECISIONS. No code changed.**
Full report: [`.ai/tasks/active/mvp-clean-rewrite-phase0-audit-2026-10-21.md`](../../tasks/active/mvp-clean-rewrite-phase0-audit-2026-10-21.md).

Audited at `d653a37` (local == `origin/main`, tree clean): **77 tables**, **≥165 API paths**, **22
route modules**, **62 migrations**. The rewrite is deletion-led. Proven parts to preserve: server-
authoritative checkout pricing/stock, guarded reservation, `checkout_requests` idempotency, Stripe
raw-body signature + event claim, seller `status='approved'` gate, JWT revocation/origin/rate-limit,
R2 presign, test-DB fail-closed. **No mock/fake production data, no TODO/FIXME**; 16 dead tables,
boot-time DDL and an unsigned OAuth `state` were found. Decisions D1–D12 (reset target, approval,
sets/packs, multi-shop, Stripe-only, Google-only, admin roles, drop reviews/wishlist/chat/goals,
`apps/velnox`, one schema, 3 languages, seller approval) are recorded in the report; the ones that
mattered downstream were answered by Phases 2–3.

---

## §84. Phase 1 — CLEAN MVP FOUNDATION (2026-10-21)

**Status: Phase 1 complete — `84b3767` → `54c10ae56b5060049faa87a845786cfe4659d35e`
(local == `origin/main` == `ls-remote`). No schema, endpoint, payment, auth or app change.**
Full report: [`.ai/tasks/active/mvp-clean-rewrite-phase1-2026-10-21.md`](../../tasks/active/mvp-clean-rewrite-phase1-2026-10-21.md).

Baseline verified against GitHub (`ls-remote`), not local state: `84b3767` == `origin/main`.
Phase 1 delivered the three maps the rewrite needs — dependency map (VelRepeat, Customer
Memory, wholesale, chat, reviews/wishlist, seller intelligence, WebSocket, 3 workers, Convex
= **absent**, `apps/velnox`, boot DDL), core domain map (9 domains: table authority → API →
frontend → tests), and the REMOVE/PARK/KEEP/REWRITE plan with the blocking decision named
per item.

**Removed (zero-reference only):** `zod` (backend), `framer-motion` (velshop + shared), dead
`chart.tsx`/`form.tsx` (they imported `recharts`/`react-hook-form`, which no package.json
declares), and the barrel re-exports. **Moved:** `leaflet` + `@types/leaflet` from root/shared
to `apps/velshop`, the only consumer. `bun.lock` regenerated; −559 lines total.

**Deliberately NOT deleted** — every one is load-bearing or decision-bound: 62 migrations
(`production-db-migrate.yml` applies them on push; `production-db-verify.yml` asserts the
ledger; `server.ts` reads **028/034/035/036** at boot; CI pins the numbering), 16 dead tables
(needs D1+D10), all parked routes (already 404 behind fail-closed flags), `apps/velnox` (D9,
external Vercel project + OAuth URLs), boot DDL (creating tables a fresh DB still needs).

Verification: `bun install` ok · `bun run typecheck` **4/4** · backend typecheck **0** ·
`i18n:check` **1535×3 parity** · `build:apps` **4/4** · suite **1741 pass / 414 skip /
1 fail**. That failure is pre-existing and environmental: `checkout-group-payment-visibility`
has an ungated `beforeAll` that hits `127.0.0.1:5432` without a database (CI provisions one).
No test was skipped or weakened to make the run green; no `DATABASE_URL` exists in this
workspace.

**Next = Phase 2 (database), blocked on D1/D3/D4/D10.** Do not start route deletion before it.
