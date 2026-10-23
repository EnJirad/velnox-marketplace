# Repository cleanup inventory — classification, removals and the `db/` gate (2026-10-22)

**Request:** full-project cleanup of `EnJirad/velnox-marketplace` so only what the
Marketplace MVP actually uses remains; `db/` to end up with `schema.sql` +
`run-sqleditor.sql`; prove every removal, test what stays, never break the deployment or
touch production.

**Verdict:** the inventory is complete and every removal in this pass is proven
zero-consumer. The `db/` collapse is **the cutover** — it is gated on a new database that
this workspace cannot create, and executing it now would break the deployed Render build
and the CI bootstrap, which the brief itself forbids (`Phase 3` step 10, `Phase 7`). The
one non-obvious finding is that **no non-MVP module is reachable today**: VelRepeat,
Customer Memory and wholesale are all parked behind fail-closed flags, and that is now
pinned by a test instead of being an assumption.

Baseline: `321d02800b41ee1cd2883c840efae3e2d5e48226` = local `HEAD` = `origin/main`.

---

## 1. Baseline of what is actually live

| Layer | What runs today | Where it is decided |
|---|---|---|
| Storefront | 4 Vercel apps (`velshop`, `velseller`, `velcenter`, `velnox`) built from `apps/*` | `apps/*/vite.config.ts`, `vercel.json` |
| API | one Render Express + WebSocket service from `backend/` | `backend/server.ts` |
| Database | Neon PostgreSQL — **the pre-MVP 77-table schema** | `DATABASE_URL` in Render; `db/schema.sql` + `db/run-sqleditor.sql` |
| Storage | Cloudflare R2 (presign → PUT → confirm) | `backend/routes/upload.ts` |
| MVP stack (built, not deployed) | `backend/mvp/*` mounted at `/api/mvp` **only** when `MVP_API_ENABLED=true`, against `db/mvp/schema.sql` (20 tables) | `backend/mvp/index.ts`, `packages/shared/src/mvp/config.ts` |
| CI | `.github/workflows/test.yml` (bootstrap `db/run-sqleditor.sql`, no secret); `production-db-migrate.yml` / `production-db-verify.yml` (secret `NEON_PRODUCTION_DATABASE_URL`) | — |
| Verification commands | `bun run typecheck`, `cd backend && bun tsc --noEmit`, `bun run build:apps`, `bun run i18n:check`, `bun test backend/tests`, `bun run test:mvp`, `bun run db:verify:mvp` | `package.json` |

**Flags that decide what is reachable:** `MVP_API_ENABLED`, `VELREPEAT_ENABLED`,
`CUSTOMER_MEMORY_ENABLED`, `WHOLESALE_ENABLED`, `MVP_ORDER_EXPIRY_SCHEDULER` — all
fail-closed (only the exact string `"true"` opens anything; the two frontend halves are
compiled to `false`).

---

## 2. Classification

### A — needed and actually used (kept)

`backend/mvp/*` (MVP API), `backend/routes|lib|jobs|middleware|realtime|db` (the deployed
pre-MVP API), `packages/shared/src` (UI kit, i18n, api client, `mvp/`), all four apps'
`src/`, `db/mvp/*` (canonical MVP schema + reset/seed/verify/browser-E2E), `.github/workflows/*`,
`scripts/mvp-browser-e2e.ts`, `docs/*`, `INSTALLATION.md`, `AGENTS.md`, `.ai/*`.

### B — needed for build, test, deployment or recovery (kept)

`db/schema.sql` + `db/run-sqleditor.sql` (the deployed backend reads the schema they
describe; `test.yml` bootstraps the disposable CI database from the reconciler),
`db/migrations/*.sql` (62 files — `production-db-migrate.yml` applies them to the old
Neon and `server.ts` reads 028/034/035/036 at boot), `db/verify-reconciler.sh`,
`backend/tests/*` (77 files), `bun.lock`, `backend/package.json`, `bunfig.toml`
(`[test] preload` is the fail-closed test guard), the pre-MVP production workflows.

### C — redundant or retired, proven zero-consumer (removed this pass)

| Path | Evidence |
|---|---|
| `apps/velshop/src/components/shop/ProductDetailModal.tsx` | no importer anywhere (`grep -rn "ProductDetailModal"` → only its own definition); the shop renders `ProductSelectionSheet.tsx` instead |
| `apps/velshop/src/components/shop/ImageUpload.tsx` | no importer; uploads go through `ProfileImageUpload.tsx` |
| `packages/shared/src/components/LogoDropdown.tsx` | no importer |
| `packages/shared/src/components/reorder/{ReorderDialog,StockDialog,ProductFormDialog}.tsx` | no importer anywhere (`grep -rn "components/reorder"` → empty); `apps/velseller/src/pages/Reorder.tsx` renders its own UI |
| `packages/shared/src/lib/customer-memory-core.ts` | no importer (`grep -rn "customer-memory-core"` → empty), not even by `lib/track.ts` |
| `public/logo.svg` | no reference in any source, config, workflow or doc; each app carries its own `public/logo.svg` |
| `package.json` → `db:smoke`, `db:consistency` | `echo` placeholders with no caller in any script, workflow or doc |

Every row was checked with an import/path grep plus a dynamic-`import(` pass; none is
referenced by a barrel, a lazy route, a package script or a workflow.

### D — cannot be confirmed yet (kept, reported)

| Item | Why it is kept |
|---|---|
| The frozen pre-MVP pair + 62 migrations | the deployed backend and the CI bootstrap require them (see §3) |
| `backend/routes/velrepeat*.ts`, `backend/jobs/velrepeat*.ts`, `lib/velrepeat-*.ts`, the legacy VelRepeat pages/dialogs | **parked, not dead**: `VELREPEAT_ENABLED=false` unmounts every route and worker, and the parking is now pinned by `backend/tests/parked-modules-parking.test.ts` |
| `packages/shared/src/lib/track.ts` + its 10 legacy call sites | customer memory is a compiled-out no-op; removing it means editing 10 legacy pages that the cutover deletes anyway |
| `packages/shared/src/components/ui/{empty,button-group,spinner,input-group,field,item,kbd}.tsx` | shadcn scaffolding with no importer; harmless and cheap — an owner call, not a provable defect |
| `VELNOX_DESIGN_THEME.md` (root, 714 lines) vs `docs/VELNOX_DESIGN_THEME.md` (1048 lines) | two different documents; `AGENTS.md` names the root one as the design source of truth. Consolidating is an owner decision |
| `apps/velnox/public/public/*` | not dead: Vite's `publicDir` is `apps/velnox/public`, so the corporate site serves `/public/robots.txt` etc. Fixing the nested path would change live URLs — flagged, not changed |
| `.ai/rebuild/*`, `.ai/audit/*`, `.ai/tasks/audits/*` | superseded design/audit records referenced by the handoff and the cutover plan; deleting them would remove the migration/rollback rationale |
| `apps/velshop/src/pages/{VelRepeatPage,VelRepeatV2Page,ShopTracking,ShopWishlist,ShopStoreAccount,ShopChat}.tsx`, `apps/velseller/src/pages/{Reorder,SellerChat,SellerGoals,Income}.tsx` | all routed in the legacy `main.tsx` and served by the deployed build; they leave with the legacy tree at cutover |

---

## 3. The `db/` target — why it is the cutover, and what gates it

`db/` today:

| Path | Role | Verdict |
|---|---|---|
| `db/mvp/schema.sql` | **canonical MVP schema** (20 tables, one order axis, one stock authority) | KEEP — becomes `db/schema.sql` at cutover |
| `db/mvp/reset.sql`, `reset.sh`, `seed.sql` | guarded dev/test rebuild + categories-only seed | KEEP |
| `db/mvp/verify.sh`, `test-run.sh`, `browser-e2e.sh`, `cutover.md` | the proofs and the cutover runbook | KEEP |
| `db/schema.sql`, `db/run-sqleditor.sql` | the **pre-MVP** snapshot + additive reconciler (77 tables) | KEEP — category B: the deployed service reads them |
| `db/migrations/*.sql` (62) | pre-MVP history, applied by `production-db-migrate.yml` | KEEP — category B |
| `db/verify-reconciler.sh` | proof for the pre-MVP pair | KEEP until the pair goes |
| `db/README.md` | the map of which file is true | KEEP |

So the two-file end state is **not** a tidying step, it is `db/mvp/cutover.md` §3: swap the
pair for `db/mvp/schema.sql`, retire the 62 migrations and their workflow, and point
Render at a database that has the MVP schema. The brief forbids exactly the two things that
step needs: leaving the existing deployment broken (`Phase 3` step 10) and touching
production (`Phase 7`). With no Neon credential and no empty database in this workspace,
**the gate is not satisfiable here**; everything else in the brief is done.

What *is* provable now, and was proved: a fresh database becomes the complete MVP schema by
running `db/mvp/schema.sql` **once**, and running it again changes nothing
(`db/mvp/verify.sh` A: 93/93), i.e. the MVP `schema.sql` already satisfies the rerunnable
bootstrap contract the target `run-sqleditor.sql` is meant to have — no second file is
needed, and inventing one would be the duplicate the brief forbids.

---

## 4. What changed in this pass

| Change | Kind |
|---|---|
| 8 files removed (§2 C) | deletion, proven zero-consumer |
| `package.json`: `db:smoke`, `db:consistency` placeholders removed | deletion |
| `backend/tests/parked-modules-parking.test.ts` added (15 tests, no DB) | verification — pins that VelRepeat / Customer Memory / wholesale are unreachable: every VelRepeat setup mounted exactly once and only inside `if (VELREPEAT_ENABLED)`, the customer and seller subscription surfaces return before registering, both schedulers and the boot DDL are flag-gated, `/api/events/track` refuses while parked, the tracking client is a no-op, and the MVP trees name no parked table, endpoint or import |
| `db/README.md` + `.ai/AI_HANDOFF.md` §91 | documentation of the gate |

No route, schema, payment, auth or deployment behaviour changed.

---

## 5. Verification (2026-10-22, PostgreSQL 14.24 disposable)

**Executed:**

| Check | Result |
|---|---|
| `bun run typecheck` | 4/4 apps, exit 0 |
| `cd backend && bun tsc --noEmit` | exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| `bun run i18n:check` | `th=1535 en=1535 my=1535` |
| `bun test backend/tests` (real pre-MVP DB) | **2182 pass / 16 skip / 0 fail**, 77 files — +15 from the new parking test, zero regressions after the deletions |
| `bun run test:mvp` (disposable MVP DB) | 113 pass / 0 fail, 13 files |
| `bun run db:verify:mvp` | 93/93 |
| `git diff --check` | clean |

**Static / source review only:** no VelRepeat or Customer Memory surface is reachable with
the default flags (source-level, pinned by the new test); the MVP tree references no
VelRepeat / wholesale / `order_state` object; no mock API or fake data feeds a production
path.

**Not tested (no access here):** any deployment (Render/Vercel/Neon), the real Stripe TEST
round trip (no keys in this workspace), the R2 presign→PUT→confirm round trip, a real
browser pass, and the production database itself.

---

## 6. Findings to act on

1. **The Stripe webhook still runs the VelRepeat V2 plan dispatcher unconditionally**
   (`backend/routes/stripe.ts` → `handleVelRepeatV2PaymentEvent(event)`). While the module
   is parked no new plan sessions can be created, so it only affects in-flight commitments —
   but it means a parked module still executes on the production payment path, and it would
   500 (Stripe retries) on a deployment whose database lacks the VelRepeat tables. Left
   unchanged deliberately: changing webhook behaviour is payment semantics, which this task
   may not alter.
2. **Production schema drift is unchanged** — `order_state` / `product_selling_units` 42703
   errors come from the Render database never having received 056/058/059
   (`.ai/tasks/active/mvp-database-audit-2026-10-22.md`). No `ADD COLUMN` was invented.
3. **VelCenter's MVP console has no Orders or Users tab**, while the MVP scope lists them.
   A scope gap, not a database defect; nothing was invented in this pass.
4. **Image upload is not MVP-compatible** (legacy writes `media.key`, the MVP table is
   `media.object_key`) — MVP sellers paste URLs. Proven incompatible, not silently wired.
