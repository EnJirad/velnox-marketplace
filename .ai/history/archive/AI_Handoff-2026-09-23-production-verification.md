# Archived: Production verification pass (2026-09-23)

Moved out of `.ai/AI_HANDOFF.md` §5 on 2026-09-27 to keep the live handoff under
the ~55 KB edit limit. The record below is kept verbatim as history. Its live rules
stay in [`.ai/context/testing.md`](../../context/testing.md) (the disposable-PostgreSQL
test recipe) and [`.ai/context/media.md`](../../context/media.md) (the R2 enforcement
it describes); the `releaseOrderInventory` fix it records is live in
`backend/lib/inventory.ts`.

---

### 2026-09-23 — production verification: DB tests executed, one real bug found, media hardened

1. **All 35 DB-gated tests now actually run.** Recipe: a disposable
   PostgreSQL 14 bootstrapped with `db/run-sqleditor.sql` (the fresh-DB
   contract is proven — the bootstrap completes under `ON_ERROR_STOP`), a
   test `DATABASE_URL` with an **explicit `?sslmode=disable`** (the pool only
   appends `sslmode=verify-full` when the URL has none, so production URLs are
   unaffected), plus `JWT_SECRET`. Result: **452 pass / 0 fail / 0 skip**,
   twice consecutively on the same database; without a database the suite
   stays green (415 pass / 37 skip / 0 fail). The self-approval guard was
   observed over real HTTP: owner → `403 SELF_ACTION_FORBIDDEN` with nothing
   written, different reviewer → `200` on the same record (negative control).
2. **Fixture defects fixed at the root** (they caused all 11 first-run
   failures — every one was 23503/23505, not an assertion):
   `backend/tests/helpers/purge.ts` removes the only two `ON DELETE NO ACTION`
   blockers (`orders`, `seller_verifications.reviewed_by`) in FK order before
   the user — every other FK back to `users` cascades or sets null (verified
   live against `pg_constraint`); `order-detail-reviews` seeds unique emails
   and purges per test (it used fixed `review-a@…`, colliding on its own 2nd
   seed); the income fixture seeds a real product because
   `order_items.product_id` is `NOT NULL` in the canonical schema.
3. **Real product bug found by those tests: `releaseOrderInventory` could
   double-release.** The `inventory_released` flag was read-then-write (the
   old code literally said "no lock yet"), so two concurrent callers — e.g.
   racing Stripe webhooks — both saw `false` and both restored stock
   (overselling). It is now claimed by ONE guarded UPDATE; under READ
   COMMITTED the loser re-evaluates, matches 0 rows, and is the idempotent
   no-op the docstring promised. `backend/lib/inventory.ts`.
4. **R2/media enforcement moved server-side.** `MAX_UPLOAD_BYTES` was
   imported but never checked — the 10 MB cap existed only in the frontend —
   and `POST /api/seller/evidence/confirm` never talked to R2 at all (it
   trusted client `publicUrl`/`contentType`/`fileSize` and upserted a media
   row even when the object did not exist). Every persistence point now
   HeadObjects via `backend/lib/r2-objects.ts`: missing object → `400
   R2_OBJECT_NOT_FOUND`, actual stored size >10 MB → `400 FILE_TOO_LARGE`,
   media rows record the stored object's type/size, the evidence URL is built
   from the configured domain + key (client URL ignored), and the
   shop-ownership 403 in `/api/upload/confirm` now runs BEFORE the upsert
   instead of after. Covered by `backend/tests/upload-security.test.ts`
   (unit + wiring + a real HTTP 401/403/400 round trip needing no R2).
   **Commits `2509aea` → `1be5620` → `d092b4a`.**
5. **Production Neon — verified read-only from the production database's own
   output (see §9).** The ledger matches `main` exactly (49 migrations, newest
   046) and 043/044/045/046 are recorded as applied; the live run logs prove
   `idx_media_owner_key`, the canonical `media` column names, the
   `under_review` / `needs_correction` constraint, `seller_review_history` and
   the `item_unavailable` constraints. What is still open is a fresh catalog
   read of four low-severity details (§9.4).
   `.github/workflows/diag-neon-schema.yml` (manual, SELECT-only) still cannot
   be dispatched from this workspace — `403 Resource not accessible by
   integration`. Owner: run it from the Actions tab (or grant the GitHub App
   `Actions: read/write`).
