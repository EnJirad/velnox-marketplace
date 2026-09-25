# Archived — 2026-09-22 readiness passes

**Reference only.** Moved verbatim out of `.ai/AI_HANDOFF.md` §5 on 2026-09-25, when
the live handoff was at risk of passing this environment's ~55 KB file-edit limit and
both entries were already superseded by later passes.

Nothing here is guaranteed to describe the current code. The repository is always
authoritative. Index row: `.ai/history/AI_Handoff_Archive.md`.

Both passes were pushed to `main` at the time; the commits remain in git history.

---

## 2026-09-22 (b) — production-readiness pass

Uncommitted-turned-committed work, in risk order:

1. **`/api/_diag/schema` was publicly reachable.** It exposed the schema shape,
   the applied migration set, product counts by status and audit-log row counts
   to any anonymous caller. It is now guarded at the **prefix**
   (`backend/middleware/diag-guard.ts` → `requireDiagAccess`, owner|admin only,
   deny-by-default), so a diagnostic route added later is guarded by default
   rather than by remembering. Covered by `backend/tests/diag-endpoint-auth.test.ts`
   (pure rule + a real HTTP round trip: anonymous/invalid → 401/403).
2. **The seller-verification queue is paginated** (`page` 1-based, `limit`
   clamped 1..100 default 25, deterministic order, `pagination` metadata) via
   `backend/lib/pagination.ts`. The old `LIMIT 200` also made the VelCenter
   overview badge wrong at 201 pending rows, because the badge was the length of
   a truncated page: it now asks for `limit: 1` and reads `pagination.total`
   (an exact `COUNT(*) OVER()`, not a second endpoint). The queue also searches on
   the server now (`q`), so a search no longer only covers the current page, and
   it no longer merges four per-status requests. Tests:
   `backend/tests/admin-queue-pagination.test.ts`.
3. **Migration numbering** — the duplicates (029/030/034/035) are safe: the
   deployed runner keys `schema_migrations.migration_name` on the FULL filename
   (UNIQUE), so both files are applied and recorded. `AI_Handoff.md` previously
   blamed a prefix keying; `backend/tests/migration-numbering.test.ts` now pins
   the real behaviour and fails if a new duplicate prefix appears.
4. **Overview counters cannot read as a lie.** The queue-based badges already
   rendered nothing on failure; the people counters rendered a literal `0`.
   They now hold display text that starts at `—` and only becomes a number when
   the API answered.

Validation for (b): `tsc` clean on backend + all four apps; `bun test
backend/tests` **405 pass / 0 fail** (35 DB-gated skips); `i18n:check` parity
(th=en=my=1289); all four apps build; `git diff --check` clean; **no database
change** — this pass touched no schema, so `db/schema.sql` and
`db/run-sqleditor.sql` are unchanged and stay identical.

**Landed in `96dd2c7`** (2026-09-22), pushed to `main`.

## 2026-09-22 (a) — the three open gaps closed

1. **Dead client route mappings removed.** Ten entries in
   `packages/shared/src/lib/api-routes.ts` declared paths no backend route serves
   and that no screen called (`customerRegulars`; the `memory`
   `recommendForCustomer`/`dueReorderReminders`/`myMemory`/`flushToNeon`; the whole
   `api.sellerOps` block incl. `updateShopLocation`, which PATCHed
   `/api/seller/shop/:id/location` while only `PATCH /api/seller/shop` exists).
   `api.memory.marketInsights` stays — `/api/memory/insights` is real and used.
2. **Every order-status writer publishes `order:updated`.** `cart.ts` (buyer
   cancel) and `seller-orders.ts` (seller fulfilment) broadcast after COMMIT with
   the real `from`→`to`; `stripe.ts` broadcasts on paid / expired / payment_failed
   only when the guarded UPDATE actually moved the row (`rowCount`).
3. **Categories and platform settings publish `config:updated`.** New channel,
   added to the subscribe allowlist, published from one scoped choke point in
   `server.ts` (2xx only, payload carries `scope` alone — never a value or name),
   consumed by the category tree and the settings form.

Validation: backend + all four apps `tsc` clean; `bun test backend/tests`
**355 pass / 0 fail** (29 DB-integration skips); `i18n:check` pass
(th=en=my=1289); `git diff --check` clean; `db/schema.sql` ↔
`db/run-sqleditor.sql` identical; **no database change**.
