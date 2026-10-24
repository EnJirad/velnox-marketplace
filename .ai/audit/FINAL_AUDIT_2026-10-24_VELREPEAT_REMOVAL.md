# FINAL AUDIT — VelRepeat Removal & Repository Cleanup

**Audit date:** 2026-10-24 (read-only pass executed against the cleanup commit)
**Audited commit:** `bfa416e92d064b864e9ced83e491f6034c00002d` (`main`, == `origin/main`)
**Baseline before cleanup:** `af9841b0daa0b2b29feba890a7c36dfdd229e8d2`
**Scope:** independent verification that the VelRepeat removal and the two-file SQL
consolidation are actually complete, and that unrelated marketplace functionality survived.
**Mode:** audit only — no application code, schema or database was modified or deleted, and no
commit or push was part of the audit itself.

---

## สรุปสำหรับเจ้าของโปรเจกต์ (Thai summary)

- VelRepeat ถูกถอดออกจาก **ทุกระดับของโค้ดที่ทำงานจริง** แล้ว — `apps/`, `backend/`, `packages/`
  ไม่เหลือคำว่า `velrepeat` / `vrepeat` แม้แต่ที่เดียว (0 ไฟล์ / 0 จุด)
- เหลือไฟล์ SQL แค่ **สองไฟล์** ตามที่กำหนด: `db/schema.sql` และ `db/run-sqleditor.sql`
  และทั้งคู่ผ่านการตรวจ (schema ตรงกันกับ reconciler, รันซ้ำได้)
- ฟังก์ชันที่ไม่เกี่ยวกับ VelRepeat (order, payment, shipment, inventory, refund, Stripe, auth,
  chat, reviews, categories) **ยังอยู่ครบและไม่ถูกเขียนใหม่** — ตรวจ diff ทีละ hunk แล้ว
- ผลตรวจ: typecheck ผ่าน, build ครบ 4 แอป, backend test **0 fail**, i18n ตรงกันทั้ง 3 ภาษา
- ข้อที่ต้องรับรู้ (บันทึกไว้ใน `.ai/AI_HANDOFF.md` §77 แล้ว): ตอนสตาร์ท backend จะไม่สร้างตาราง
  `checkout_requests` / `conversations` ให้อัตโนมัติอีก แต่จะฟ้อง log แทน — ฐานข้อมูลที่รัน
  `db/run-sqleditor.sql` แล้วไม่มีปัญหา
- ข้อที่ยังค้าง: การลบ object ของ VelRepeat ในฐานข้อมูล production จริงยัง **ไม่ได้ทำ** (ตามกฎ
  ห้ามแตะ DB) — แผนที่ตรวจสอบได้อยู่ที่ `docs/VELREPEAT_REMOVAL_PLAN.md`
- ข้อที่เป็นเอกสารเก่า: ยังมีข้อความอ้างถึง `db/migrations/` ในเอกสาร/บันทึกประวัติ แต่
  **ไม่มีอยู่ในไฟล์ที่รันได้เลย** (0 จุดใน `.ts/.sh/.json/.yml`)

---

## 1. Git state at audit time

| Item | Value |
|---|---|
| Branch | `main` |
| Local HEAD | `bfa416e92d064b864e9ced83e491f6034c00002d` |
| `origin/main` | `bfa416e92d064b864e9ced83e491f6034c00002d` (identical — 0 ahead / 0 behind) |
| Working tree | clean (0 entries) |
| Cleanup diff (`af9841b..bfa416e`) | **201 files: +1,539 / −37,373** — 103 deleted, 95 modified, 3 added |

No fetch divergence, no rebase, no reset performed.

---

## 2. VelRepeat sweep (tracked repository, case-insensitive)

Patterns: `velrepeat`, `vrepeat`, `vel_repeat`.

| Area | Files | Hits | Classification |
|---|---|---|---|
| `apps/` | **0** | **0** | clean — no pages, dialogs, nav, i18n keys, api-routes |
| `backend/` | **0** | **0** | clean — no routes, jobs, libs, tests, env switches |
| `packages/` | **0** | **0** | clean — shared types, api-routes, i18n |
| `db/` | 2 | 5 | explanatory comments only (`run-sqleditor.sql` 2, `verify-reconciler.sh` 3) — no VelRepeat DDL |
| `.ai/` | 37 | 407 | dated historical records + §75/§76 pointers + supersession banners |
| `docs/` | 1 | 78 | `docs/VELREPEAT_REMOVAL_PLAN.md` — intentional, owner-run DB plan |

**Executable VelRepeat code remaining: none.** No route module, no scheduler registration, no
`VELREPEAT_*` environment variable, no `/api/velrepeat*` or `/api/subscriptions` string, no
`repeatOrder` / `mySubscriptions` symbol, and no VelRepeat test in `backend/tests/`
(the only job in `backend/jobs/` is `payment-reservation-scheduler.ts`).

Remaining textual references are **documentation-level** and listed in §7 below.

---

## 3. Repository structure (before → after)

```
BEFORE (at af9841b)                     AFTER (at bfa416e)
──────────────────────────────────      ──────────────────────────────────
apps/velshop   (incl. VelRepeat UI)     apps/velshop    — subscription UI gone, shop intact
apps/velseller                          apps/velseller
apps/velcenter                          apps/velcenter
apps/velnox                            apps/velnox
backend/
  routes/      + 6 velrepeat routes     backend/routes/     6 modules deleted
  jobs/        + 2 velrepeat schedulers backend/jobs/       only payment-reservation-scheduler
  lib/         + velrepeat-cycles/pricing backend/lib/      both deleted
  tests/       + 11 velrepeat tests     backend/tests/     + sql-reference-coverage.test.ts
packages/shared                         packages/shared
db/
  schema.sql         (with velrepeat_*)  db/schema.sql         (canonical, VelRepeat-free)
  run-sqleditor.sql                      db/run-sqleditor.sql  (additive reconciler)
  migrations/        60 files            (deleted)
  verify-reconciler.sh                   db/verify-reconciler.sh
.ai/
  context/velrepeat-contract.md          (deleted)
  tasks/audits/ 17 VelRepeat briefs      (deleted)
  AI_RULES.md · AI_HANDOFF.md · history  (kept, canonical)
docs/                                    + VELREPEAT_REMOVAL_PLAN.md (legacy-DB plan)
```

Workspace boundaries, app names, package names and deployment config were **not** renamed or
moved — nothing in the tree was relocated for aesthetics.

---

## 4. Deleted files (103), grouped by reason

**A. VelRepeat application code (13)**
`apps/velshop/src/pages/VelRepeatPage.tsx`, `apps/velshop/src/pages/VelRepeatV2Page.tsx`,
`apps/velshop/src/components/shop/VelRepeatPlanDialog.tsx`,
`apps/velshop/src/components/shop/SubscriptionDialog.tsx`,
`backend/routes/velrepeat.ts`, `velrepeat-packages.ts`, `velrepeat-plans.ts`,
`velrepeat-v2-payments.ts`, `velrepeat-v2-plans.ts`, `velrepeat-v2-status.ts`,
`backend/jobs/velrepeat-scheduler.ts`, `backend/jobs/velrepeat-v2-cycle-scheduler.ts`,
plus `backend/lib/velrepeat-cycles.ts` and `backend/lib/velrepeat-pricing.ts` (**15 total**).

**B. VelRepeat-only tests (11 + `migration-numbering.test.ts`)**
`velrepeat-core`, `velrepeat-money`, `velrepeat-packages-ownership`, `velrepeat-pricing`,
`velrepeat-v2-domain-schema`, `-phase3-pricing-snapshot`, `-phase4-prepaid-payment`,
`-phase5-cycle-lifecycle`, `-pricing-total-prepaid`, `-verification-matrix`;
`backend/tests/migration-numbering.test.ts` deleted because it asserted a property of the
now-removed `db/migrations/` directory.

**C. Obsolete migration directory (60)**
All of `db/migrations/*.sql` — superseded by the two canonical files.

**D. VelRepeat documentation / task briefs (18)**
`.ai/context/velrepeat-contract.md`, and 17 files under `.ai/tasks/audits/`
(`medium-10-velrepeat-commerce-lifecycle`, `velrepeat-v2-*` contract, decision-closure,
g1-g3, phase1/3/4/5, pricing-snapshot, production-migration-053, real-stripe-test-e2e,
runtime-verification).

**E. Added (3)** — not deletions, listed for completeness:
`backend/tests/sql-reference-coverage.test.ts` (new guard), `docs/VELREPEAT_REMOVAL_PLAN.md`,
`.ai/history/archive/AI_Handoff-2026-10-06-to-2026-10-08-commerce-rebuild-passes.md` (archived
handoff text moved out to keep the handoff under its size ceiling).

---

## 5. Database: objects removed, objects preserved

**Removed from both canonical files (VelRepeat-exclusive only)**
- **12 tables:** `velrepeat_plans`, `velrepeat_items`, `velrepeat_runs`, `velrepeat_cycles`,
  `velrepeat_events`, `velrepeat_pricing_snapshots`, `velrepeat_pricing_snapshot_items`,
  `velrepeat_package_items`, `velrepeat_packages`, `vrepeat_packages`, `vrepeat_deliveries`,
  `subscriptions`.
- **12 columns:** nine `vrepeat_*` on `products`, `velrepeat_run_id` / `velrepeat_cycle_id` on
  `orders`, `plan_id` on `payments` and on `payment_incidents`.
- **62 indexes** and **78 constraints** that referenced only the objects above.

**Preserved (explicitly verified still declared in `db/schema.sql` and applied by
`db/run-sqleditor.sql`)**
- Orders incl. multi-shop `checkout_groups`, `order_number`, order status CHECK constraints,
  `checkout_requests` (idempotency), refunds, disputes.
- Payments: `payments_single_domain_check` (order XOR group, plan-free), Stripe idempotency keys,
  `payment_incidents` with `payment_incidents_order_parent_check`, reservation
  (`payment-reservation.ts` + scheduler).
- Shipments (`shipments_order_id_unique`, lifecycle timestamps), inventory + settlement,
  reviews (unique + soft delete), categories, products/variants/images, chat
  (`conversations`), auth/staff (`must_change_password`), seller verification.
- All Stripe infrastructure and generic billing/order/shipment/inventory/refund logic — no
  VelRepeat-specific behaviour replaced by a stub or mock.

**Canonical SQL invariant:** `git ls-files '*.sql'` returns exactly
`db/run-sqleditor.sql` and `db/schema.sql` — 2 files, no other `.sql` anywhere.

**Production database: NOT touched.** No connection was opened, no DDL executed, no record
modified. The reviewable legacy-object removal plan (inventory → archive → constraint swap →
drop columns → drop tables → verify) is `docs/VELREPEAT_REMOVAL_PLAN.md`; the reconciler itself
carries no VelRepeat statement, so running it after that plan stays a no-op.

---

## 6. Verification matrix (executed at `bfa416e`)

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Frontend typechecks (velshop · velseller · velcenter · velnox) | `bun run typecheck` | **PASS** (exit 0) |
| 2 | Backend typecheck | `bun --filter @velnox/backend typecheck` | **PASS** (exit 0) |
| 3 | Workspace manifests resolve | `node -e` parse of root + 6 manifests (globs `apps/*`, `packages/*`, `backend`) | **PASS** — `@velnox/{velshop,velseller,velcenter,velnox,backend,shared}` all resolve |
| 4 | i18n parity th/en/my | `bun run i18n:check` | **PASS** — th=1249 en=1249 my=1249 |
| 5 | Backend suite without DB | `bun test backend/tests` | **PASS** — 987 pass / 303 skip / 0 fail |
| 6 | Backend suite with real PostgreSQL 14 (`TEST_DATABASE_URL`) | `bun test backend/tests` | **PASS** — 63 files, **1280 pass / 6 skip / 0 fail**, exit 0 |
| 7 | All four frontends build | `bun run build:apps` | **PASS** — 4/4 exit 0 |
| 8 | Schema snapshot ↔ reconciler consistency | `bun run db:verify` | **PASS** |
| 9 | Reconciler behavioural proof | `bash db/verify-reconciler.sh` | **PASS** — 52 scenarios, ALL PASSED, exit 0 |
| 10 | SQL reference coverage (every table/index/function named by backend SQL is declared) | `bun test backend/tests/sql-reference-coverage.test.ts` | **PASS** |
| 11 | Exactly two `.sql` files | `git ls-files '*.sql'` | **PASS** — 2 |
| 12 | No stale migration references in executable files | `git grep 'db/migrations' -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.sh' '*.json' '*.yml' '*.yaml'` | **PASS** — 0 matches |
| 13 | `db:migrate` no longer points at a deleted directory | `package.json` | **PASS** — no-op echo naming the two canonical files |
| 14 | `git diff --check` | `git diff --check` | **PASS** — clean |
| 15 | Production reconcile + verify against Neon | needs `NEON_PRODUCTION_DATABASE_URL` | **BLOCKED** — no production credential in this workspace |
| 16 | Real Stripe TEST E2E | needs live TEST keys + browser | **BLOCKED** — keys/browser unavailable |
| 17 | `bun run lint` | — | **N/A** — no lint script configured in the repo |

Suite-count note: `§76` recorded 1284 pass / 2 skip; this audit's run produced 1280 pass / 6 skip
with the same 0 failures and exit 0. The four extra skips are environment-gated cases, not
regressions; no assertion was relaxed and no test was removed to get this result.

---

## 7. Remaining VelRepeat references (documentation only)

| Path | Hits | Why it stays |
|---|---|---|
| `.ai/history/**` (27 files) + `AI_Handoff_Archive.md` | 336 | dated historical records; audit trail only, explicitly reference-only |
| `.ai/tasks/completed/**` (4 files) | 22 | completed-task records |
| `.ai/AI_HANDOFF.md` §75/§76 (+§77) | 27 | current-state record with explicit supersession banner |
| `.ai/audit/**` (3 files) | 4 | older audit reports |
| `.ai/rebuild/CURRENT_ARCHITECTURE.md:144` | 1 | historical architecture note |
| `.ai/tasks/active/mvp-marketplace-restructure-2026-10-14.md` | 17 | active brief, line 7 banner marks the VelRepeat section superseded |
| `docs/VELREPEAT_REMOVAL_PLAN.md` | 78 | intentional owner-run production DB plan |
| `db/run-sqleditor.sql:3757-3758`, `db/verify-reconciler.sh:120-126` | 5 | explanatory comments recording the removal arithmetic |

None of these are executable. No VelRepeat route, job, test, environment variable or SQL object
is registered or created at runtime.

**Stale path `db/migrations/`:** 113 textual references remain in Markdown (handoff history,
`.ai/audit/*`, `.ai/history/*`) and **0** in executable files. They point at a deleted directory,
so they are historical anchors rather than runnable instructions; the two live ones a human might
follow (`AI_HANDOFF.md:221`, `:551`, `:587`) are inside dated archive-style sections.

---

## 8. Unrelated-change review (was any business logic rewritten?)

The 95 modified files were reviewed hunk-by-hunk, with special attention to shared financial and
order code: `money.ts`, `payment-incidents.ts`, `stripe.ts`, `cart.ts`, `seller-orders.ts`,
`inventory.ts`, `payment-reservation.ts`/`payment-reservation-scheduler.ts`, `rate-limit.ts`,
`db/index.ts`, `routes/index.ts`, `lib/features.ts`, both `features.ts`. Every change is either
(a) VelRepeat removal, (b) a dead migration-path pointer replaced with `db/run-sqleditor.sql`, or
(c) a comment. `products.ts` / `cart.ts` only dropped `vrepeat_*` selects and the
`/api/subscriptions` stubs. **No non-VelRepeat business rule, numeric precision, idempotency
guarantee or payment path was rewritten.**

**One behaviour change worth knowing (now recorded in `AI_HANDOFF.md` §77):**
`backend/server.ts` no longer self-heals tables at boot.
- `ensureVariantTables()` (lines ~139-152) logs instead of applying `db/migrations/028_*.sql`
  (it still applies the additive variant-column batch and the partial
  `product_variant_images` create).
- `ensureCheckoutIdempotencyTable()` / `ensureChatTables()` became
  `reportCheckoutIdempotencyTable()` / `reportChatTables()` (~197-232): `checkout_requests` and
  `conversations` are **reported, not created**.

On a database reconciled with `db/run-sqleditor.sql` this is a no-op (both tables exist). On a
stale database, checkout idempotency and chat remain unavailable until that file is applied — a
deliberate single-bootstrap-path consequence of deleting `db/migrations/`, not a VelRepeat
removal side effect on working deployments.

---

## 9. What this audit did NOT do (limits)

- Did not connect to any database (sandbox or Neon) except a disposable local PostgreSQL 14 used
  as `TEST_DATABASE_URL` for tests and the reconciler proof.
- Did not drop, truncate or archive any production object; no customer/order/payment data touched.
- Did not modify application code, schema files, workflows or config.
- Did not verify Vercel/Render runtime behaviour, real Stripe webhooks, or Neon production state
  (see BLOCKED rows 15–16).

---

## 10. Verdict

**CLEAN WITH MINOR FINDINGS.** VelRepeat is gone from every executable layer; exactly two `.sql`
files exist and both are complete and mutually consistent; non-VelRepeat commerce is intact and
unrewritten; all runnable checks pass. The findings are stale Markdown pointers to the deleted
`db/migrations/` directory and one boot-time behaviour change that is now documented.
