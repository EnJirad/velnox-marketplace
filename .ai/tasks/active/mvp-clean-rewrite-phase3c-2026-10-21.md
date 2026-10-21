# Phase 3c — staging readiness & deployment (2026-10-21)

**Verdict:**

| Area | Status |
|---|---|
| Staging **configuration** (env matrix, isolation, deployment steps) | **READY** — written, with every local proof passing |
| Staging **deployment** (Render + Neon + 3 Vercel projects) | **NOT PERFORMED** — no provider access/credentials in this workspace |
| **Product-scope readiness** | **BLOCKED** — retail sets/packs are absent from the MVP schema/API/UI (§2) |
| Browser E2E (real Chromium, real API, real DB) | **PASSED locally** (§5.1) |
| Stripe TEST round trip | **NOT VERIFIED** — no `STRIPE_SECRET_KEY` in this workspace |

- **Starting SHA (verified):** `9083127070d81c482ecfacb0604d330d0f79f07b`
  (`HEAD` = `origin/main` = `git ls-remote origin refs/heads/main`, tree clean).
- **Final SHA:** `dd6dbbb5101b4e3069f7ba43cfbc77f63e01b505` (`HEAD` = `origin/main` =
  GitHub `commits/main` after the push).
- Blueprint: [`docs/MVP_STAGING.md`](../../docs/MVP_STAGING.md).
- Previous passes: [Phase 3](../.ai/tasks/active/mvp-clean-rewrite-phase3-2026-10-21.md) ·
  [Phase 3b](mvp-clean-rewrite-phase3b-2026-10-21.md) · cutover (not executed):
  [`db/mvp/cutover.md`](../../db/mvp/cutover.md).

---

## 1. Repository verification

- Fetched, then compared `HEAD`, `origin/main`, `git ls-remote origin refs/heads/main`:
  all three `9083127…` before any edit. Working tree clean; no user changes to preserve.
- Read `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/AI_HANDOFF.md` (§87), the Phase 3b report,
  `db/mvp/schema.sql`, `db/mvp/cutover.md`, `db/README.md`.
- Deployment configuration inspected: **no `render.yaml`** (the Render service is
  dashboard-managed, as `cutover.md` §2 records), per-app `vercel.json` SPA rewrites,
  `.github/workflows/test.yml` (already runs `db/mvp/verify.sh`, `bun run test:mvp`,
  legacy suite, typechecks, `git diff --check` in a disposable PostgreSQL service).
  No CI change was needed.

## 2. Product scope — the blocking gap

**Required:** VelShop must sell the supported selling units — the base piece and any
retail **set/pack** at its own price, with stock counted in **base units**
(`base_units = quantity × pieces`).

**Finding: retail sets/packs are NOT preserved in the MVP.** Evidence:

| Check | Command / location | Result |
|---|---|---|
| MVP schema | `grep -c "selling_unit\|pieces\|pack" db/mvp/schema.sql` | **0** |
| MVP backend | `grep -rn "selling_unit\|sellingUnit\|pieces" backend/mvp/*.ts` | **1 hit**, and it is a comment naming the pre-MVP table as *forbidden* (`backend/mvp/http.ts:6`) |
| MVP client/UI | `grep -rn "sellingUnit\|selling_unit" packages/shared/src/mvp apps/*/src/mvp` | **0** |
| Legacy capability (still present, untouched) | `db/schema.sql` §“Selling units”, `backend/lib/inventory.ts` (`quantity × selling_unit_pieces`) | present |

So the MVP can sell a product or a **variant** at one price each, but cannot offer
“Set 6” at ฿1,200 while stock is 24 pieces, and its cart/order lines have no
`selling_unit_id` / `selling_unit_pieces` snapshot. **Staging can be provisioned and
exercised, but the retail scope must not be signed off until this exists.**

The rest of the required scope is present and was exercised end to end: browse,
variants, cart, checkout, order history (VelShop); apply/approve, products, inventory,
fulfilment (VelSeller); seller/product moderation, categories, metrics, expiry
(VelCenter). Wholesale/B2B stays parked (`WHOLESALE_ENABLED=false`, no MVP wholesale
column), VelRepeat and Customer Memory stay off, and **no existing code or database
object was removed**.

## 3. Staging isolation

- The disposable database used for every proof was created from `db/mvp/schema.sql`
  by the harnesses (`velnox_mvp_app_test`, `velnox_mvp_browser_test`). Identity
  recorded during Phase 3b and re-proven in this pass by the E2E guard: name ends in
  `_test`, `products.seller_id` present, `public.shops` absent, zero rows at start.
- `backend/db/test-database.ts` is what the harnesses run under
  (`NODE_ENV=test` + `TEST_DATABASE_URL`); it refuses a production-marked process and
  a production-looking target, and never reads `DATABASE_URL` for a test process.
- `db/mvp/reset.sh` keeps its fail-closed rules (explicit URL only, `_dev`/`_test`
  suffix, refuses `DATABASE_URL`, refuses a Neon host without the branch opt-in,
  refuses production markers). It was **not** run against any unidentified database.
- Production keeps `MVP_API_ENABLED` unset → no `/api/mvp` route, no expiry worker.
- `VITE_API_MODE=mvp` remains gated on `VITE_DEPLOY_ENV=staging` and a valid origin;
  a production build refuses it (`MVP_FORBIDDEN_IN_PRODUCTION`), tested.

## 4. Deployment preparation (no production change)

`docs/MVP_STAGING.md` now carries the complete runbook: architecture, the exact
Render variable table, the three Vercel variable sets, database bootstrap + identity
query, post-deploy verification order, scheduling, blockers and rollback.

**Owner actions (nothing else is missing):**

1. Create Neon `velnox_mvp_staging` and apply `db/mvp/schema.sql`; record
   `current_database()` / table count (19) / `shops` absent.
2. Create the Render staging service (build `bun install --frozen-lockfile`, start
   `bun --filter @velnox/backend start`, health `/api/health`) with
   `MVP_API_ENABLED=true`, the staging `DATABASE_URL`, a new `JWT_SECRET`,
   `MVP_COOKIE_SECURE=true`, and the three staging frontend origins in
   `CORS_ORIGINS`/`VITE_*_URL`.
3. Clone the three Vercel projects with `VITE_API_MODE=mvp`,
   `VITE_DEPLOY_ENV=staging`, `VITE_API_URL=https://<staging api>`.
4. Run the verification order in the runbook, including one Stripe TEST round trip
   if test keys are supplied.
5. Do **not** copy any of it to production.

## 5. Verification (exact results)

### 5.1 Real-browser E2E — **PASSED**

`TEST_DATABASE_URL=postgresql://…/velnox_test bun run test:mvp:browser` → **exit 0**,
`[mvp-browser] PASS`. It builds the three frontends with `VITE_API_MODE=mvp` +
`VITE_DEPLOY_ENV=staging`, serves each from its own `dist/` over local HTTPS against
the real API, and drives Chromium through:

| Step | Result |
|---|---|
| admin signs in through the VelCenter UI | PASS |
| seller signs up through VelSeller, applies | PASS |
| admin approves the seller in the review queue | PASS |
| seller creates a draft, adds a variant (stock 10), submits | PASS |
| admin approves the product | PASS |
| seller publishes | PASS |
| buyer signs up, browses catalogue, picks the variant, cart, checkout | PASS — order `017925997247982718` = **฿600.00** (server total) |
| reservation visible to the next buyer | PASS — 10 → 8 available |
| buyer cancels | PASS — order Cancelled, 8 → 10 available |
| second order expires via the admin sweep | PASS — Cancelled, 10 available |
| seller sees the order in their list | PASS |

The harness is `db/mvp/browser-e2e.sh` + `scripts/mvp-browser-e2e.ts`; it needs
`playwright` (added as a devDependency) and a Chromium download, and refuses to run
without `MVP_E2E_ALLOW=1`, a `*_test` database, and an empty database.

**Bug found and fixed by writing it:** the shared auth panel navigated
client-side after sign-in, but the MVP session provider reads `/auth/me` once per
mount — so the header and every guard kept the pre-login snapshot. Sign-in now does a
hard navigation to the return path, and sign-out reloads, so the server is always
the source of the session. A second discovery: Chromium rejects
`SameSite=None` without `Secure`, so `backend/mvp/session.ts` gained
`MVP_COOKIE_SECURE=true` — a one-way switch that can only *add* `Secure` (production
is always secure; it can never be turned off).

### 5.2 Suites, typechecks, builds, hygiene

| Command | Result |
|---|---|
| `TEST_DATABASE_URL=… bun run test:mvp` | **90 pass / 0 fail**, 12 files — exit 0 |
| `TEST_DATABASE_URL=… bun test backend/tests` | **2166 pass / 16 skip / 0 fail**, 76 files — exit 0 |
| `bun run typecheck` | 4/4 apps — exit 0 |
| `bun --filter @velnox/backend typecheck` | exit 0 |
| builds: velShop / velSeller / velCenter (MVP env) + velnox | 4/4 — exit 0 |
| `bun run i18n:check` | `th=1535 en=1535 my=1535` parity — exit 0 |
| `git diff --check` | clean — exit 0 |

The 16 skips are the legacy suite's credential/DB-gated tests (unchanged set). The
MVP suite's growth (86 → 90) is the four new session-cookie tests.

### 5.3 Stripe, media, expiry

- **Stripe: NOT VERIFIED end to end.** No `STRIPE_SECRET_KEY` exists in this
  workspace (`freebuff-env list` is empty). Contract tests still prove: live keys are
  refused, `payments/status` reports `usable:false`, `payment-session` answers 503
  when unconfigured, forged/duplicate webhooks are rejected, amount/currency are
  checked, and a browser return can never mark an order paid. **No live key was
  used or requested.**
- **Image upload: still blocked.** Legacy upload writes
  `INSERT INTO media (url, key, …)` (`backend/routes/upload.ts`), while the MVP
  `media` table is `object_key` with no `key` column (`db/mvp/schema.sql` §4) and no
  MVP route references `media`. MVP images remain URL-only; the seller editor says
  so. A real upload needs an MVP-aware presign route writing `media.object_key`, and
  R2 credentials to verify it.
- **Order expiry: verified** — API suite (expire, release, idempotent re-run), the
  scheduler guard test, and the browser E2E (admin sweep → Cancelled → stock back).

## 6. Rollback (staging only)

Remove `VITE_API_MODE` on the three projects (legacy returns) · set
`MVP_API_ENABLED=false` on the staging service (routes unmount, worker stops) · drop
the disposable staging database. Production: nothing to roll back.

## 7. Git

| SHA | Commit | Scope |
|---|---|---|
| `49b7651` | `fix(mvp): make the shell re-read the session after sign-in and sign-out` | session-staleness fix, `MVP_COOKIE_SECURE` seam + 4 cookie tests |
| `a8865e5` | `test(mvp): drive the whole MVP flow in Chromium against the real API` | Playwright harness + wrapper + script + devDependency |
| `dd6dbbb` | `docs(ai): Phase 3c staging runbook, report and handoff` | this file, handoff §88, `docs/MVP_STAGING.md`, archive |

Pushed to `main` without force; `HEAD` = `origin/main` = GitHub `commits/main`
(`dd6dbbb5101b4e3069f7ba43cfbc77f63e01b505`) re-verified after the push. The browser
E2E was re-run on that exact tree afterwards: `[mvp-browser] PASS`, exit 0.

## 8. Production confirmation

No production database, `DATABASE_URL`, Render/Vercel environment, Stripe mode, DNS
or deployment was read, modified or triggered. No destructive reset was run. No
secret is in the diff (the only credentials added are test-mode strings inside the
E2E harness).

## 9. Next task

**Phase 3d — restore retail sets/packs in the MVP** (schema + API + client + seller
UI + tests): `product_selling_units`, cart/order line snapshots
(`selling_unit_id`, `selling_unit_pieces`, `selling_unit_name`), server-priced pack
lines, `base_units = quantity × pieces` reservation/commit/release, and the piece /
set / pack selector on the product page. After that, deploy the §4 staging stack and
run the browser + Stripe TEST pass on it.
