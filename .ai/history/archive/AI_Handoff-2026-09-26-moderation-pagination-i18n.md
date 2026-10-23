# Handoff §20 — Moderation-queue pagination + verification-queue i18n (2026-09-26)

Moved out of `.ai/AI_HANDOFF.md` on 2026-09-27 (it was the documented NEXT SPLIT:
a closed record kept at ~55 KB, where in-place edits stop matching). The live
bullets stay in §20's stub; §19's blockers and §6 hold the open items.

Closes the three items §6 had recorded as BLOCKED by the ~55 KB edit window. No new
endpoint, no second i18n system, **no schema change** (`db/` untouched;
`schema.sql` ≡ `run-sqleditor.sql`).

**1. `GET /api/admin/products/moderation` is bounded — same route, same authz.**
`backend/routes/products.ts` now uses `parsePage`/`parseLimit`/`pageOffset` from
`backend/lib/pagination.ts` (default 25, hard max 100), `COUNT(*) OVER() AS
total_count`, `ORDER BY p.created_at DESC, p.id DESC` (the `id` tie-break is what
keeps LIMIT/OFFSET from skipping or repeating a row), `LIMIT … OFFSET …`, a fallback
count query for a page past the end, and `data: { products, pagination }`. The
response shape moved from a bare array to the same `{ rows, pagination }` envelope
`/api/admin/sellers` and `/api/admin/verifications` already use; its ONE consumer
moved with it — `packages/shared/src/lib/api-routes.ts` (forwards `page`/`limit`) and
`apps/velcenter/src/components/ProductModerationQueue.tsx` (bounded `PAGE_SIZE = 25`,
previous/next bar, step-back off an emptied last page, and the pending badge reads
`pagination.total` instead of counting the fetched page). The dashboard counter was
already on `GET /api/admin/dashboard/counts` (§19 gate 7).

**2. `SellerVerificationQueue.tsx` is localized.** Every user-facing string (toasts,
filters, search placeholder, empty/error states, row label, pagination bar, revoke
dialog) now renders through the existing `review.*` namespace: 24 new keys in
`thReview`/`enReview`/`myReview` (`packages/shared/src/lib/i18n/locales/index.ts`) —
the rest were pre-existing `review.*` keys the queue had never been wired to. No raw
Thai remains in the component.

**3. The corrupted string is fixed.** `toast.success("ระงับและลบrêtailer แล้ว")` →
`t("review.revokeSuccess")` = `ระงับและลบร้านค้าแล้ว` ("Shop suspended and removed").
The wording is the action's own copy, not a guess: the dialog title, its bullets
(`ระงับบัญชีผู้ขาย`, `นำสินค้าทั้งหมดออกจากร้าน`) and the `revokeShop` endpoint all
describe suspending the **shop** (`ร้านค้า`); the transliterated Latin token was the
corruption (§19 finding 2).

**Verification (actually run).** Disposable local PostgreSQL 14 (`velnox_test`,
bootstrapped from `db/run-sqleditor.sql` → 59 tables, reached only through
`TEST_DATABASE_URL`; the guard refuses a production target): **595 pass / 2 skip /
0 fail** (597 tests, 26 files) vs **577 / 2 / 0** before this pass. No database
configured: **543 pass / 54 skip / 0 fail** (vs 533 / 46). The new suite
`backend/tests/product-moderation-pagination.test.ts` (9 cases, real DB + real HTTP)
proves: 401 without a cookie; 403 for an account without `products.moderate`; the
exact `pagination.total` under `limit=1`; an absent limit is one default page (25 of
30 rows); `limit=100000` clamps to 100; pages 1 and 2 (limit 10) are disjoint; three
pages cover all 30 seeded rows exactly once in `(created_at DESC, id DESC)` order —
including a deliberate `created_at` tie; `page=99` reports the real total with no
rows; and the response body never contains `total_count`.
`backend/tests/admin-queue-pagination.test.ts` gained 9 static guards (39 pass) so the
unbounded tail cannot return. Backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`i18n:check` **th=en=my=1319** · `db/schema.sql` ≡ `db/run-sqleditor.sql` · no
`db/run-update.sql` · `git diff --check` clean.

**Tooling (the escape hatch, now documented).** Both edits sit past the ~55 KB match
window (the moderation handler at byte 162K of `products.ts`; the `review` blocks at
bytes 56.7K–69.5K of `locales/index.ts`). Each was applied as a small `bun` script
that asserts every anchor occurs exactly once, rewrites the file, and is deleted
immediately; the result was then verified by `git diff`, `tsc`, `i18n:check` and the
DB-backed suite. Same idea as §11's `patch -p1` — prefer it over moving a handler into
another file.

**Still open / unchanged.** §19's release blockers stand: Stripe TEST E2E **BLOCKED**
(no credential), production Browser / Google-OAuth / R2-authenticated E2E **BLOCKED**
(no test account + no browser), the `velnox.com` NS delegation, §9.4's four
low-severity catalog reads, and the dead realtime channels.
`ProductModerationQueue.tsx`'s remaining copy is still hardcoded Thai (pre-existing;
this pass added only its pagination bar, in that file's language). **PRODUCTION: NOT
READY** — this pass removes two tooling-blocked defects and one corrupted string; it
does not change the verdict.
