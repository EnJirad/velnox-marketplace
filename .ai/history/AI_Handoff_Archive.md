# Velnox Handoff Archive

**Reference only — do not load automatically.** Moved here from the repository root
when the agent workspace moved to `.ai/` (2026-09-23). Current state lives in
[`.ai/AI_HANDOFF.md`](../AI_HANDOFF.md); load that first.

This file is the **index** to completed, superseded and investigated work. The
long-form narrative for every entry below is kept verbatim (under version control,
unchanged) in:

| File | What it holds |
|---|---|
| [`archive/AI_Handoff-2026-09-22-full.md`](./archive/AI_Handoff-2026-09-22-full.md) | the complete handoff as it stood at 2026-09-22, before the split (1,594 lines) |
| [`archive/AI_Handoff-2026-09-14.md`](./archive/AI_Handoff-2026-09-14.md) | the earlier snapshot it replaced |

**Why the index exists:** this environment's file-edit tools stop matching past
roughly 55 KB in a file, so the single ~109 KB handoff could no longer be edited.
Nothing was discarded — the full text moved to the paths above and is durable in
git history.

Nothing here is guaranteed to describe the current code. The repository is always
authoritative; treat these entries as "what was done and why", and confirm against
source before relying on any of it.

---

## Index

Line numbers below point into `AI_Handoff-2026-09-22-full.md`.

### 2026-09-15 — the verification overhaul + category UI

| Lines | Entry | Covers |
|---|---|---|
| 15 | Product Verification — removed from the user workflow | the single-verification decision; `product_verifications` / `products.verification_status` retained but unwritten |
| 32 | Category Picker (UI audit 2026-09-15) | duplicate close button; long category names escaping their container; the `min-w-0` / `truncate` / `overflow-x-hidden` width chain; files changed |
| 106 | VelCenter Category Edit — overflow fix + verification audit (2026-09-15) | long parent-category name covering the “ลำดับ” field; the `auto`-track min-content root cause; similar-pattern audit; seller-verification architecture confirmed unchanged |
| 213 | Seller Navigation | the VelSeller tab set; why there is no standalone “V Verification” tab |
| 222 | Database | `sellers.status` CHECK widening, `review_reason_code` / `review_note`, `seller_review_history`, migrations 043/044 |
| 235 | VelRepeat `item_unavailable` — investigated and fixed | duplicated migration numbers 029/030/034/035 and the prefix-keyed runner that skipped the repair |
| 257 | Files Changed | the file-by-file list for the overhaul |
| 275 | Tests Actually Performed | plus the two per-audit test tables |
| 324 | Known Limitations | the limitation list as of 2026-09-15 — most items were carried forward into `AI_Handoff.md` §6 |

### 2026-09-16 — production incidents and the control-plane upgrade

| Lines | Entry | Covers |
|---|---|---|
| 359 | VelCenter Operations Center Upgrade | the first VelCenter console pass: backend, frontend, realtime, security |
| 442 | Recommended Next Steps | stale planning list, superseded |
| 459 | Product Visibility Root-Cause Audit | why previously created products stopped appearing; the read-only diagnostic endpoint |
| 517 | VelCenter Runtime Crash Fix | `Cannot read properties of undefined (reading 'icon')` |
| 575 | VelCenter Products & Sellers "No Data" Diagnosis | the "no data" symptom traced to real causes |
| 631 | Production SQL Error Fixes — `sh.status` + `sv.evidence_notes` | the root cause and the schema fix |
| 698 | Production 42703 root cause: the migration runner was blocked at V0040 | the schema-drift report and how it was cleared |
| 826 | VelCenter moderation detail (42P10) + VelSeller correction notifications | the `json_agg(DISTINCT … ORDER BY …)` aggregate failure; correction notifications |
| 954 | UX & Localization Round | V badge redesign; localized category names; responsive audit |
| 1013 | VelCenter control-plane upgrade | product inspection workspace, staff/customer split, audit logs, company settings |
| 1080 | Audit Logs SQL repair + mobile product inspection (round 2) | the empty Audit Logs root cause; the phone inspection layout |

### 2026-09-17 → 2026-09-18 — staff auth and the permission catalog

| Lines | Entry | Covers |
|---|---|---|
| 1180 | Password Auth + Auto-Refresh + Variant Images + Mobile Nav Removal | member-ID/password login (`users.password_hash`, scrypt), auto-refresh, variant images, removing the VelCenter bottom nav |
| 1270 | VelCenter Final Gap Fix / Verification | the permission catalog as the single source of truth; the dead force-password-change gate; realtime → UI; errors must not render as "no data" |
| 1407 | Catalog enforced at every endpoint (follow-up) | every business surface gated by its catalog code; deny-by-default resolution; `payouts.process` removed |
| 1484 | Remaining gaps closed (round 2) | the `staff.manage` read path; realtime dead ends; silent empty states |

### 2026-09-23 → 2026-09-25 — production verification, and why test data reached production

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-23-r2-media-verification.md`](./archive/AI_Handoff-2026-09-23-r2-media-verification.md) | Production R2 / media — read-only verification (TASK 002) | the live R2/media evidence (health, bucket, object read, 401 boundary) and findings 1–7. Findings 1–6 were fixed in TASK 003; finding #7 (integration fixture shops visible via public `/api/shops`) was root-caused to test/database isolation and closed by TASK 004A (`.ai/AI_HANDOFF.md` §13) |
| [`archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](./archive/AI_Handoff-2026-09-23-neon-readonly-verification.md) | Production Neon — closed evidence, read-only verification (TASK 001) | the method (`gh run view --log` on `migrate-neon.yml`), the migration ledger (49 rows / 49 files, none missing or orphaned), and the verified-object table. Split out of `.ai/AI_HANDOFF.md` §9 on 2026-09-25 to keep the live handoff small; §9.4/§9.5 open items stayed live |
| [`archive/AI_Handoff-2026-09-23-ai-workspace-move.md`](./archive/AI_Handoff-2026-09-23-ai-workspace-move.md) | Agent workspace moved to `.ai/` | the full old→new layout table, the six renamed context entries, the pointer-vs-duplicate decision, the `6187bcd` reconciliation, the root cause, and the validation table. Moved out of `.ai/AI_HANDOFF.md` §8 on 2026-09-25; the described layout IS the current state, documented live in `AGENTS.md` and `.ai/README.md` |
| [`archive/AI_Handoff-2026-09-25-docs-consolidation.md`](./archive/AI_Handoff-2026-09-25-docs-consolidation.md) | Startup-sync rule + root AI files removed | the §0 “GitHub remote is the source of truth” startup rule and the removal of root `AI_RULES.md` / `AI_Handoff.md`. Moved out of `.ai/AI_HANDOFF.md` §12 on 2026-09-25; the rules are live in `.ai/AI_RULES.md` §0 and `AGENTS.md` rule 0 |
| [`archive/AI_Handoff-2026-09-22-readiness-passes.md`](./archive/AI_Handoff-2026-09-22-readiness-passes.md) | 2026-09-22 production-readiness pass (b) + the three open gaps closed (a) | the `/_diag` prefix guard, seller-verification queue pagination (and the 201-row badge bug), the 029/030/034/035 migration-numbering proof, honest overview counters, the dead `api-routes.ts` mappings, `order:updated` from every status writer, and `config:updated`. Moved out of `.ai/AI_HANDOFF.md` §5 on 2026-09-25 to keep the live handoff under the ~55 KB edit limit; both passes were pushed at the time (`96dd2c7` for (b)) |
| [`archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md`](./archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md) | Production R2 authenticated round-trip (TASK 004B) — **BLOCKED** | the full two-pass evidence narrative: the read-only production probes, the ~4-minute transient 500 window (never reproduced, no root cause), the account hard gate that blocks steps 9–23, the TASK 004A fail-closed re-check, and the step-24 regression search. Moved out of `.ai/AI_HANDOFF.md` §14 on 2026-09-25; §14 keeps a live stub with the BLOCKED state — TASK 004B is **not** closed |

### 2026-09-26 — payment verification round and the §2 split

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-25-verification-system.md`](./archive/AI_Handoff-2026-09-25-verification-system.md) | handoff §2 — "Verification — exactly ONE system" | the single seller/shop V system: the V rule, `sellers.status` vs `sellers.verification_status`, the transactional submission rule, structured review reasons, review history, evidence-URL security, the self-approval guard, and the verification API surface. Moved out of `.ai/AI_HANDOFF.md` §2 on 2026-09-26 (TASK 007) because the handoff had reached ~54 KB against the ~55 KB edit limit; the **live copy is now `.ai/context/verification.md`** and the handoff keeps a pointer stub |
| [`archive/AI_Handoff-2026-09-25-payment-foundation.md`](./archive/AI_Handoff-2026-09-25-payment-foundation.md) | handoff §15 (payment foundation, TASK 005) + §16 (Stripe TEST-mode E2E, TASK 006 — **BLOCKED**) | the audit-first findings on the pre-existing Stripe code, what the foundation changed, the DB-backed idempotency model, order↔payment lifecycles, webhook-confirmed refunds, the schema/migration, the COD-stays-off rules; then TASK 006's probe table, evidence tiers, secret audit, and unblock steps. Moved out on 2026-09-26 (TASK 007) when the handoff crossed 55 KB; the **live rules are now `.ai/context/payment.md`** and the **live verification status is `.ai/AI_HANDOFF.md` §18**. Contains one corrected claim (TASK 006 wrongly reported no PostgreSQL binary in the sandbox; §18 executed the DB-gated suites) |

| [`archive/AI_Handoff-2026-09-25-test-database-isolation.md`](./archive/AI_Handoff-2026-09-25-test-database-isolation.md) | handoff §13 — "Test database isolation" (TASK 004A) | the root cause (the one `pg.Pool` built from `DATABASE_URL`, which in this repo *is* production), the fatal-or-safe `decideTestDatabase()` guard in `backend/db/test-database.ts`, the `bunfig.toml` fail-fast preload, the fixture migration to `hasTestDatabase()`, `test-database-isolation.test.ts`, and the first CI test job (`.github/workflows/test.yml`). Moved out on 2026-09-26 (§20) to keep the live handoff under the ~55 KB edit limit; the **live rules are `.ai/context/testing.md`** and the still-open items stayed in `.ai/AI_HANDOFF.md` §6 |
| [`archive/AI_Handoff-2026-09-23-production-verification.md`](./archive/AI_Handoff-2026-09-23-production-verification.md) | handoff §5 — the 2026-09-23 production-verification pass | the first real execution of all 35 DB-gated tests on a disposable PostgreSQL (`452 pass / 0 fail / 0 skip`), the `releaseOrderInventory` double-release root cause and its one-guarded-UPDATE fix, and the server-side R2/media enforcement (`MAX_UPLOAD_BYTES`, HeadObject at every persistence point). Moved out of `.ai/AI_HANDOFF.md` §5 on 2026-09-27 to keep the live handoff under the ~55 KB edit limit; the live rules are `.ai/context/testing.md` and `.ai/context/media.md` |
| [`archive/AI_Handoff-2026-09-25-ci-guard-fix.md`](./archive/AI_Handoff-2026-09-25-ci-guard-fix.md) | handoff §17 — the CI "guard refuses production" fix | the wrong assertion (the job-level `TEST_DATABASE_URL` made the probe vacuous), the corrected probe (`env -u TEST_DATABASE_URL`), the added accepted-target assertion, the 7 new regression cases, and the CI rerun that restored the previously skipped test suite. Moved out of `.ai/AI_HANDOFF.md` §17 on 2026-09-27 to keep the live handoff under the ~55 KB edit limit; the fix is live in `.github/workflows/test.yml` and the rules in `.ai/context/testing.md` |
| [`archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](./archive/AI_Handoff-2026-09-26-production-readiness-audit.md) | handoff §19 — production-readiness audit (TASK 009) | the 13 release gates walked high-risk → low-risk, the unbounded `/api/admin/sellers` fix and its executed tests, the BLOCKED payment/browser/OAuth/R2 E2E gates, and the read-only production probes with the two new owner findings. Moved out of `.ai/AI_HANDOFF.md` §19 on 2026-09-27; the verdict (**PRODUCTION: NOT READY**) and open blockers stay live in §6, per-gate evidence in `.ai/tasks/completed/production-readiness-audit-2026-09-26.md` |

Work after 2026-09-18 continues in `.ai/AI_HANDOFF.md`, whose older sections are
archived by the same rules as above.

**Structural note (2026-09-26).** The V-badge implementation itself is unchanged;
this was a documentation move only, verified by the full test suite (`.ai/AI_HANDOFF.md` §18).

### 2026-09-27 — the §19 and §18 splits (edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](./archive/AI_Handoff-2026-09-26-production-readiness-audit.md) | handoff §19 — production-readiness audit (TASK 009) | the 13-gate risk-ordered audit narrative. Moved out of `.ai/AI_HANDOFF.md` §19 on 2026-09-27; the verdict (**PRODUCTION: NOT READY**; Stripe TEST E2E and browser / OAuth / R2-authenticated E2E **BLOCKED**) stayed live in §19's stub, §6, and the evidence report [`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](../tasks/completed/production-readiness-audit-2026-09-26.md) |
| [`archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md`](./archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md) | handoff §18 — Stripe TEST-mode E2E (TASK 007) + TASK 008 re-gate — **BLOCKED** | the credential gate (`freebuff-env list` → `{"files":{}}`, `stripeStatus()` → `STRIPE_NOT_CONFIGURED`, COD off), the executed tier (live-key refusal, webhook signature reject/accept, webhook idempotency, DB-gated *refused COD writes nothing*), the CODE-VERIFIED-only tier (request-key replay, single-active-session race), CI run ids, and the unblock steps. Moved out of `.ai/AI_HANDOFF.md` §18 on 2026-09-27 to keep the live handoff under the ~55 KB edit limit; the **BLOCKED statements are mirrored in `.ai/context/payment.md`** and §18 keeps a stub |

### 2026-09-27 - the §21 split (postgres 53000, first pass)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-postgres-53000.md`](./archive/AI_Handoff-2026-09-27-postgres-53000.md) | handoff §21 - production PostgreSQL 53000: provider quota (BLOCKED evidence) + the one real pool leak fixed | the first pass: 53000 = a provider-side Neon consumption quota, the read-only production evidence (`/api/shops`, `/api/categories` 500 while `/api/health` 200), the measured single-`pg.Pool` analysis, the `POST /api/admin/sellers/:id/revoke` connection leak fixed with `finally { client.release(); }`, the safe DB failure logging, and the executed proof (`db-client-release.test.ts`). Moved out on 2026-09-27 after §22 re-verified and classified the same incident; the code fix + logging stay live in §21's stub and §22 |

### 2026-09-27 - the §20 and §21 splits (edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md`](./archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md) | handoff §20 - moderation-queue pagination + verification-queue i18n | the bounded `GET /api/admin/products/moderation` (pagination envelope, one consumer moved), the `review.*` localization of `SellerVerificationQueue.tsx` (24 keys in th/en/my), the corrupted `ระงับและลบrêtailer แล้ว` string fix, the executed 9-case pagination suite, and the single-use `bun` anchor-asserting tooling escape hatch. Moved out on 2026-09-27 as the documented NEXT SPLIT; the live bullets or blockers stay in §20's stub, §19 and §6 |

### 2026-09-27 - the §22 split (postgres 53000 classified)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-postgres-53000-classified.md`](./archive/AI_Handoff-2026-09-27-postgres-53000-classified.md) | handoff §22 - PostgreSQL 53000 classified as a provider consumption quota; provider action required | the second pass on the same incident: `53000` observed on BOTH `connect` and `query`, the Neon FAQ quotation that matches both, why the connection-limit (`53300`), storage and provider-wide hypotheses were excluded, the VelRepeat 60 s poll arithmetic (~182 CU-hours vs the 100 CU-hour Free allowance), the read-only production probes (`/api/shops`, `/api/categories`, `/api/products` → 500 `DB_ERROR`) and the owner action (Neon Console → Usage → upgrade or wait for the monthly reset). Moved out on 2026-09-27 as the documented NEXT SPLIT to make room for §27 (the Stripe sandbox audit); a stub stays in `.ai/AI_HANDOFF.md` §22, the owner action is mirrored into §6, and §27 records that production serves again |

### 2026-09-27 - the §27 split (Stripe sandbox audit superseded by the live re-probe)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-stripe-sandbox-audit.md`](./archive/AI_Handoff-2026-09-27-stripe-sandbox-audit.md) | handoff §27 - Stripe Sandbox/Test-Mode audit (audit PASS, sandbox E2E BLOCKED) | the full audit: the credential gate (`freebuff-env list` → `{"files":{}}`), the executed-evidence log against the real route stack (an unverifiable webhook **refused with 503** rather than acknowledged, both checkout endpoints **401** without a session cookie) and `payment-foundation.test.ts` (**59 pass / 2 skip**), the CI run `36305688863` on `4bf0002` that executed the two DB-gated payment cases, the env-var documentation change in `INSTALLATION.md` §4 + `docs/ENVIRONMENT.md`, and the Connect finding. Moved out of `.ai/AI_HANDOFF.md` §27 on 2026-09-27 by the §28 pass, which re-probed production and **superseded its headline production claim** — the owner had since completed the configuration (`{configured:true, mode:"test", webhookConfigured:true}`, CARD + PROMPTPAY enabled, no live credential). The BLOCKED and Connect statements stay live in §27's stub, §6, and `.ai/context/payment.md` |

### 2026-09-27 — the §23–§26 split (closed records, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-closed-records.md`](./archive/AI_Handoff-2026-09-27-closed-records.md) | handoff §23–§26 — the seller-verification records of 2026-09-27 | §23 the identity-evidence purpose parser (`c12185c`); §24 seller access = an approved application only, across the tab bar, the seller APIs and the revision flow; §25 the verification queue's new-vs-resubmitted counts + realtime state sync; §26 approval as ONE decision (seller access + reviewer badge). Moved out on 2026-09-27 as the documented NEXT SPLIT, together with §24–§26; §6 keeps the open items |

### 2026-09-27 — the §30 split (VelShop one-press checkout, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-velshop-checkout-onepress.md`](./archive/AI_Handoff-2026-09-27-velshop-checkout-onepress.md) | handoff §30 — checkout → Stripe in ONE press + resume payment | the one-press CARD/PromptPay checkout, the shared `ResumePaymentButton`, and the rule it established that still stands: the webhook is the **only** writer of `orders.status = 'paid'`. Its browser E2E against Stripe stayed open. Moved out on 2026-09-27 as edit-headroom housekeeping (§28–§29 remain live) |

### 2026-09-28 — the §28–§29 split (velShop order-status contract + cart selection, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-velshop-orders-cart.md`](./archive/AI_Handoff-2026-09-27-velshop-orders-cart.md) | handoff §28–§29 — the velShop order-status contract and the cart selection UI | §28 `getOrderStatusMeta()` as the only safe renderer of the free-text `orders.status` column (which also carries the payment-lifecycle values `backend/routes/stripe.ts` writes) plus the refunded-order seller-status fix and its production bundle proof; §29 `shop_id`-grouped cart selection derived from one `Set` of item ids, calling no API. Moved out on 2026-09-28 for edit headroom so §34 (DB latency) could be appended; browser E2E for `/orders` and `/cart` stayed open |

### 2026-09-28 — the §31 split (PromptPay settlement diagnostic, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-promptpay-settlement.md`](./archive/AI_Handoff-2026-09-27-promptpay-settlement.md) | handoff §31 — PromptPay settlement diagnostic (order stuck `pending_payment`) | A diagnostic-only pass (no code changed) that ruled out a global webhook failure and pointed at the PromptPay-specific leg; its decisive reads — the endpoint's `enabled_events`, the `payment_events` delivery rows, the stuck session's `payment_status` — remain owner-side. Moved out on 2026-09-28 so §35 (customer order cancellation) could be appended; superseded for current state by §33 |

### 2026-09-28 — the §§32–33 split (Stripe webhook stall + signature boundary, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md`](./archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md) | handoff §32–§33 — the webhook that never answered, and the signature 400 made self-identifying | §32 the unbounded-DB-wait root cause (`query_timeout: 15000`, non-fatal pool error handler, stage timings) — fixed and committed on `main`; §33 the raw-body boundary proof (`middleware/stripe-raw-body.ts`, `webhookSecretHealth()`, `?selfTest=1`, the `INSTALLATION.md` host fix) and why a `stripe listen` forward *must* 400. Moved out on 2026-09-28 so §36 (dynamic payment reservation) could be appended |

### 2026-09-28 — the §34 split (DB pool latency, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-28-db-pool-latency.md`](./archive/AI_Handoff-2026-09-28-db-pool-latency.md) | handoff §34 — the pool idled down to zero, so connection establishment landed on the first statement | The production measurement that separated connect time from execute time (1.627/1.738 s cold → 0.388/0.357 s warm on the same endpoint), why neither reported query needed an index, the `min: 1` + `maxLifetimeSeconds: 1800` fix, and the post-deploy latency sweep. Moved out on 2026-09-28 for edit headroom |

### 2026-09-28 — the §35 split (customer order cancellation)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-28-customer-cancellation.md`](./archive/AI_Handoff-2026-09-28-customer-cancellation.md) | handoff §35 — unpaid orders get a way out | The one shared cancel rule for button + server, the guarded claim + the ONE `releaseOrderInventory()` path, the `orderCancel` i18n namespace, and the 55 KiB matching-window tooling finding. Moved out on 2026-09-28 so §37 (production checkout down — migration 048 never applied) could be appended. Its two test-side failures were fixed in §37 |

### 2026-09-28 — the §36 split (dynamic reservation superseded by a fixed 30-minute window)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-28-dynamic-reservation-v1.md`](./archive/AI_Handoff-2026-09-28-dynamic-reservation-v1.md) | handoff §36 — Dynamic Payment Reservation V1 (risk-based window) | The v1 policy that derived the stock-hold window from stock cover / 7-day sales velocity / `products.featured` (CRITICAL 15 · HIGH 20 · NORMAL 30 · LOW 45 · VERY_LOW 60, clamped 10–60), what it changed (the policy module, the expiry sweep, the two read routes, the Stripe `expires_at` bound, the `orderReservation` i18n namespace, migration 048) and the race invariants it established: no order is ever resurrected, no unit released twice. Moved out on 2026-09-28 because **§38 superseded its duration rule** with a CONSTANT 30 minutes (Part 1 forbids deriving the window from demand or behaviour signals); the sweep, the ONE release path and the race guards it describes are still live |
### 2026-09-29 — the §37 split (migration 048 / checkout read path)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-28-migration-048-read-path.md`](./archive/AI_Handoff-2026-09-28-migration-048-read-path.md) | handoff §37 — production checkout down: migration 048 never applied | The two independent causes (the `Migrate Neon Database` run dying on the §22 Neon quota, and the checkout READ naming `payment_expires_at` so a missing deadline took checkout down instead of being unenforced), the `selectOrderPaymentRow()` fix (`to_jsonb(o) ->> 'payment_expires_at'`, chosen over "catch 42703 and retry" because pg poisons the whole transaction), the repair of the pre-existing red `main` (two HTTP harnesses that had never mounted `stripeWebhookRawBody` / `cookieParser`), and the disposable-PostgreSQL verification. Moved out on 2026-09-29 for edit headroom so §41 (order UX refactor) could be appended; §40 restates the same root cause with the resolution, and the OWNER SQL stayed inline in the handoff |

### 2026-09-29 — the §38–§41 split (payment reservation + order surfaces, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md`](./archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md) | handoff §38–§41 — the fixed 30-minute payment reservation + countdown, the order UX polish, the production-invisible countdown, and the order-surface refactor | §38 the CONSTANT 30-minute reservation (`PAYMENT_RESERVATION_MINUTES = 30`, which superseded §36's risk bands) plus the countdown and the pay-again method chooser; §39 the order UX polish (localized `orderStatus.*` namespace, ONE progress line, the order's own address snapshot, no hard-coded Thai); §40 the countdown invisible in production because migration 048 was never applied; §41 the customer + seller order-surface refactor (shared `OrderStatusBadge`, the NEW `SellerOrderDetail`, `generateOrderNumber()` in `backend/lib/order-number.ts`, `ApiError` carrying the HTTP status). Moved out on 2026-09-29 so §42 (the full-system audit of Part 1 + Part 2) could be appended; **§42 restates their current status**, including the still-unapplied migration 048 and the seller stock-release path that bypasses `releaseOrderInventory()` |

### 2026-09-29 — the §42.1–§42.5 split (audit findings detail, edit-headroom housekeeping)

| File | Entry | Covers |
|---|---|---|
| [`archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](./archive/AI_Handoff-2026-09-29-audit-findings-detail.md) | handoff §42.1–§42.5 — the eighteen-row "what was checked" audit table, the fourteen findings (CRITICAL #1–#2, HIGH #3–#5, MEDIUM #6–#11, LOW #12–#14), the cancellation matrix, race verdicts and action list | The verbatim audit text: what was checked and how (the 18-row table, including the three rows that cannot be claimed from a workspace — real Stripe E2E, browser E2E, DB-gated suites), then every finding with its exact file/line and the proposed fix, then the §42.3 cancellation matrix, §42.4 race verdicts and §42.5 prioritized actions. #1/#2 fixed by §43, #3 by §44, #6 owner-blocked on the Neon quota; the rest (#4, #5, #8–#14) are still open and are listed in §44's "Still open". The matrix and race verdicts are fully superseded — their only two ❌ cells were closed by §43 and §44. Moved out on 2026-09-29 so §43, §44 and §45 could be appended; the handoff keeps a 14-row status index plus the architecture verdicts |

### Beyond the archive

Work after 2026-09-18 is recorded in `.ai/AI_HANDOFF.md` and in git history. When an
`.ai/AI_HANDOFF.md` section becomes superseded, append it here as an index row and
(if it is long) move its full text into `.ai/history/archive/`.
