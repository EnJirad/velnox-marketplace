# AI_Handoff.md — Velnox Marketplace

> Current state as of 2026-09-24.
> Updated after TASK 004A — production test-fixture pollution fix (test database isolation).

---

## TASK 004A — Fix Production Test Fixture Pollution

**Branch:** `fix/velcenter-password-gate-and-audit-realtime`
**Scope:** stop integration-test fixtures (`so-test-*`, `inv-*`, `inv-cancel-*`,
`inv-paid-*`, `lifecycle-test-*`, …) from reaching the production catalog.

### Root cause

The backend test suite had **one** database source: `process.env.DATABASE_URL`
(`backend/db/index.ts`). Every "integration" test gated itself with
`const hasDb = Boolean(process.env.DATABASE_URL); const testFn = hasDb ? test : test.skip;`
and then inserted users / sellers / shops / products / orders directly.

`bun test` auto-loads `.env` from the working directory, and this repository's
runtime `.env` holds the **production Neon** `DATABASE_URL`. There is (was) no
test database, no `.env.test`, no CI test job, and no environment assertion — so
`bun test backend/tests` ran with `DATABASE_URL` = production and wrote real
fixture rows there. Those shops are created with `sellers.status = 'approved'`,
which is exactly the visibility rule of `GET /api/shops`
(`JOIN sellers … WHERE s.status = 'approved'`), and the fixture products use
`status = 'published'`, i.e. the public catalog rule. Result: test fixtures
appeared in the production catalog.

Contributing factor: cleanup is only best-effort per test (`finally { DELETE FROM
users … }`), so any aborted/failed run leaves rows behind permanently.

Not a product-status bug: no production row was hidden, and no `/api/shops`
filter needed to change. This was a **test/database targeting** bug.

### Fix — files changed

| File | Change |
|------|--------|
| `backend/db/database-guard.ts` **(new)** | Credential-free database targeting + validation. Resolves the connection per environment; classifies targets (`test` / `local-development` / `production` / `unknown`); redacts hosts for diagnostics. |
| `backend/db/index.ts` | The pool is now created from `resolveApplicationDatabaseUrl()`. Application runtime → `DATABASE_URL` (unchanged, same `sslmode=verify-full` hardening). Test process → `TEST_DATABASE_URL` only; otherwise **no pool is created** and `query()/getClient()/withTransaction()` throw the guard reason instead of connecting. |
| `backend/tests/helpers/test-db.ts` **(new)** | Test-facing helper: `integrationTest` (= `test` when a disposable DB is configured, `test.skip` otherwise), `hasTestDatabase`, `requireTestDatabase()`, one-line credential-free banner. A *configured but rejected* URL throws — the suite fails closed. |
| 9 integration test files | Gate replaced: `const testFn = integrationTest;` instead of `Boolean(process.env.DATABASE_URL)`. |
| `backend/tests/test-database-isolation.test.ts` **(new)** | 38 guard tests: parsing/redaction, production refusal, same-endpoint refusal, name allowlist, runtime-vs-test resolution, plus static guards that no test file re-reads the application URL and that the pool resolves through the guard. |
| `.github/workflows/backend-tests.yml` **(new)** | Runs the suite against a throwaway `postgres:16` service container bootstrapped from `db/run-sqleditor.sql`, with `TEST_DATABASE_URL` only (no `DATABASE_URL`). |
| `docs/ai/TESTING.md`, `INSTALLATION.md` | Documented the isolation contract, the disposable database requirement, and the CI job. (`.env.example` is write-protected by the workspace — the variable is documented in `INSTALLATION.md` instead.) |
| `backend/tests/product-lifecycle.test.ts` | Stale source-level assertion removed: it still expected the role-check message `"Only owner or admin can moderate products"`, which commit `9c7b541` replaced with the permission catalog. It now asserts `userHasPermission(userId, "products.moderate")`. |

### Isolation mechanism (why it cannot recur)

1. **Explicit only** — tests never read `DATABASE_URL`; there is no fallback.
2. **Fail closed** — a `TEST_DATABASE_URL` that is, looks like, or is not
   provably distinct from production (`same host+port+database` as
   `DATABASE_URL`, or a `prod|production|live|primary` host/database segment, or a
   database name without `test`) aborts the run before any connection.
3. **Skip, never assume** — with no `TEST_DATABASE_URL`, integration tests skip
   and print why; the guarded pool still refuses access, so a forgotten gate
   fails loudly instead of writing to the application database.
4. **CI runs isolated by construction** — the Postgres service container is the
   only database the job can see.
5. **Regression guards** — `test-database-isolation.test.ts` fails if any test
   file reintroduces the old gate, or if `backend/db/index.ts` starts reading the
   application URL directly.

### Tests actually executed (2026-09-24, `bun test backend/tests`)

```
357 pass · 29 skip · 0 fail · 386 tests across 17 files
```

- The 29 skips are the DB-backed integration tests: they **skipped by design**
  because no disposable database exists in this workspace. They were NOT
  executed — this sandbox has no PostgreSQL/psql/docker.
- `cd backend && bun tsc --noEmit` → **PASS** (tests are excluded from
  `backend/tsconfig.json`, same as before).
- Fail-closed proof: `TEST_DATABASE_URL=…/neondb bun test …` aborts with
  `[test-db] refusing to run the test suite: … does not contain "test"` and
  `0 pass · 1 fail`, before any connection.
- `git diff --check` → clean.
- CI workflow: **not executed** here (no Docker/GitHub runner in the sandbox); it
  runs on push to `main` / PRs touching `backend/**` or `db/**`.

### Production verification — remediation (step 2, owner-authorized)

The rows the earlier runs had already written were **deleted on 2026-09-24**,
after a read-only dry run and an explicit owner confirmation.

- Tool: `backend/scripts/test-fixture-cleanup.ts` (`bun run fixtures:audit`).
  Read-only by default; deletion needs `--apply` **and**
  `VELNOX_ALLOW_FIXTURE_CLEANUP=1`.
- Detection is evidence-based, not heuristic: roots are users with a
  `@test.local` email (the marker every DB-backed suite uses) plus the shop slug
  prefixes read off the test sources (`inv-`, `so-test-`, `p14-shop-`,
  `p16-shop-`, `lifecycle-test-`, `vr-test-`, `review-shop-`).
- The delete set is the **foreign-key closure** of those roots, walked through
  `information_schema` — no hand-written table list that can rot.
- Safety gates: a row that references an entity outside the delete set (shared
  reference) is reported and blocks `--apply`; deletes run in one transaction
  and abort on the first foreign key that cannot be cleared; the script
  re-verifies afterwards and exits non-zero if any fixture root survives.
- **Dry run: 0 shared references.** Nothing real was entangled, so the closure
  needed no `--allow-shared` override.
- **Result: 931 rows deleted** in one transaction — users 167, sellers 144,
  shops 144, products 123, orders 79, order_items 79, inventory 88,
  product_reviews 33, notifications 21, payments 11, velrepeat_plans 11,
  velrepeat_items 11, velrepeat_runs 10, velrepeat_events 10. (`sellers`/`shops`
  reported 0 direct deletes because deleting `users` cascades into them.)
- Before → after: shops 145 → **1** (only `eloop`), users 170 → 3, products
  124 → 1, orders 79 → 0, inventory 89 → 1, product_reviews 34 → 1,
  categories 125 → 125 (untouched, platform taxonomy).
- Post-checks: audit re-run reports **0 fixture roots**; `GET /api/shops`
  returns only the legitimate `eloop` shop (`/api/health` 200).
- **No schema change**, no DML beyond the fixture closure, nothing deleted from
  `categories`.

### Database changes

**None.** No schema change, therefore `db/schema.sql` and `db/run-sqleditor.sql`
are untouched (still byte-identical) and `db/run-update.sql` was not recreated.

### Next task

1. ~~Controlled cleanup of the already-contaminated production fixture
   shops/products.~~ **DONE** — see *Production verification (step 2)* above.
2. ~~**TASK 004B** — the separate production R2 upload round-trip.~~ **DONE** —
   `backend/scripts/r2-roundtrip.ts`, 11/11 checks pass; the bucket CORS policy
   was missing the real corporate origin and all four dev origins and was
   repaired additively. Recorded in `AI_Handoff.md` and `docs/ai/MEDIA.md`.
3. Optional follow-up: the bucket CORS still lists `velnox-group.vercel.app`,
   which returns 404. Removing it is safe but is a separate, deliberate change.
4. The Neon half of the media contract (`media` row + `users.avatar` / shop
   `logo`/`cover` reference) still needs an authenticated production check.

---

## Previous cycle — VelCenter Final Gap Fix / Verification (2026-09-18, `main`)

Condensed status (unchanged, all PASS at the time; not re-verified in this task):

| Area | Status |
|---|---|
| Product inspection desktop + mobile (`ProductModerationQueue.tsx`) | PASS |
| Variant images (`loadProductExtras()` → `product_variant_images`) | PASS |
| Product moderation refresh (`onCenterEvent("products")`) / seller verification refresh | PASS |
| Global realtime (`center-events.ts` + Center.tsx WS) | PASS |
| RBAC (`permissions.ts` catalog + `userHasPermission()`) | PASS |
| Staff/customer split, audit logs, company/system settings, commission | PASS |
| Staff login (member ID + scrypt), forced password change | PASS |
| Mobile UX, loading/empty/error states, mutation UX | PASS |

Key architecture notes: one WebSocket owned by `Center.tsx` and fanned out via
`center-events.ts`; one permission catalog; one audit writer (`writeAuditLog()`);
one verification system (seller/shop identity); commission is a constant in
`seller-stats.ts`; platform settings live in `platform_settings`.
