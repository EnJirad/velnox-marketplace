# Velnox AI Handoff

**Last updated:** 2026-09-15
**Branch:** `main`

## Current Project State

Velnox Marketplace — 4 Vercel frontends (velshop, velseller, velcenter, velnox) + Render backend (Express + WebSocket) + Neon PostgreSQL + Cloudflare R2. Auth: Google OAuth + JWT `velnox_session` (httpOnly cookie). Velnox has **ONE** verification system: **SELLER / SHOP identity verification**. There is no product verification.

## The V Rule (single source)

```
seller.verification_status = 'verified'
        ↓
EVERY product owned by that seller
        ↓
the single green V badge
```

- No `products.is_v`, no per-product verification state in the V rule.
- `verified` is the canonical value in this repository (the task brief's
  "approved" maps to it). `sellers.status` (`approved`) is the *account*
  lifecycle; `sellers.verification_status` (`verified`) is the *trust badge* —
  they are deliberately different columns.
- The V means only “this shop passed Velnox identity verification”. It is NOT a
  product-quality, authenticity, or manufacturer-warranty claim.
- VBadge resolves V from the seller alone (`isProductVerified(undefined, sellerVerification)`),
  and the products API exposes `sellerVerificationStatus` from an
  `EXISTS (SELECT 1 FROM sellers …)` subquery on the catalog list — no N+1.

## Verification Lifecycle

```
Seller (Velseller)
  RequireRole onboarding: Store → Applicant → Identity documents → Review → Submit
        │  (each document: presign → R2 PUT → evidence confirm → media row in Neon)
        ↓
  seller_verifications row (status=pending) + sellers.verification_status='pending'
        ↓
VelCenter
  Sellers → การยืนยันร้านค้า (Verification) tab → filter All/Pending/Verified/Rejected/Suspended + search
        ↓
  VerificationReviewDialog  (applicant · store · address · signed identity documents · checklist · history)
        ↓
  Approve | Request correction | Reject | Suspend   (reason code REQUIRED unless approving)
        ↓
  notification → applicant sees reason → edit & resubmit → pending again
```

`sellers.status` state machine (enforced in `backend/routes/seller.ts`):

```
pending        → under_review, rejected
under_review   → approved, needs_correction, rejected, suspended
needs_correction → under_review, rejected
approved       → suspended
rejected       → pending      (re-application)
suspended      → pending      (re-activation)
```

Any other transition returns `400 INVALID_TRANSITION`. Self-approval returns
`403 SELF_ACTION_FORBIDDEN`. Approval requires a persisted verification record
with at least one evidence file.

## Submission Integrity (hard rule)

`NO SUCCESSFUL EVIDENCE PERSISTENCE = NO PENDING VERIFICATION`

`POST /api/seller/apply` runs in ONE transaction: validate auth → validate
seller ownership → validate required fields → validate the three identity
documents exist as media rows owned by the caller → upsert shop → upsert
`seller_settings` (durable R2 **object keys**, never `File` objects or blob URLs)
→ upsert `seller_verifications` (pending, with evidence) → **then** set
`sellers.verification_status='pending'` → append `seller_review_history` →
`COMMIT`. Any failure rolls everything back and returns an error; nothing shows
“pending” that the backend did not persist.

## Image Preview (root cause + fix)

**Root cause of the original bug:** the onboarding identity step stored a browser
`File` in React state and rendered only `✓ {file.name}` — no
`URL.createObjectURL()` was ever created, so no image could appear. Separately,
the evidence presign endpoint required an existing `sellers` row, which does not
exist yet during onboarding, so uploads could not complete either.

**Fix:** `packages/shared/src/components/seller/IdentityDocumentUploader.tsx`
— validate type → validate size → `URL.createObjectURL(file)` → render the real
image immediately → upload afterwards (presign → PUT with the exact signed
Content-Type → `evidence/confirm`). Object URLs are revoked on replace, remove
and unmount. Presign now falls back to the **user id** as the owner segment when
no seller row exists, and `evidence/confirm` accepts either the user id or the
seller id as the owner segment (both derived from the session).

## Identity Evidence Security

- Identity documents are never returned as public bucket URLs.
  - `GET /api/admin/verifications/seller/:id/evidence` and
    `GET /api/admin/sellers/:id/application` require `owner|admin|staff` and
    return **5-minute signed R2 GET URLs** generated server-side.
  - `GET /api/seller/evidence` signs URLs for the caller's own uploads only.
  - `GET /api/shops/:shopId/verification` is public and returns status +
    `verifiedAt` only.
- The applicant's own status payload exposes only an evidence **count**.
- The admin list strips `evidence_urls` (`evidence_urls: undefined`).
- Evidence ownership is enforced in two places: `verification/evidence/{owner}/…`
  keys must match the caller, and every submitted key must exist as a `media` row
  with `uploaded_by = <caller>`.

## Structured Review Reasons

Canonical vocabulary: `packages/shared/src/lib/verification-reasons.ts`
(mirrored in the backend; `backend/tests/product-lifecycle.test.ts` asserts
parity). Codes: `id_card_unclear`, `id_card_incomplete`, `selfie_unclear`,
`selfie_missing_id`, `document_expired`, `applicant_mismatch`,
`store_incomplete`, `contact_incomplete`, `address_incomplete`,
`duplicate_account`, `policy_violation`, `other`.

Corrections / rejections / suspensions require a valid code or the backend
returns `400 REASON_REQUIRED`. Internal reviewer notes live in `review_note` and
are never shown to the applicant; the applicant-visible reason is stored in
`seller_settings.{rejectionReason,correctionReason}` plus the matching
`…ReasonCode`.

## Review History

`seller_review_history` (seller_id, application_id, previous_status,
new_status, action, reason_code, reason, note, reviewer_id, created_at).
Actions: `submitted` | `resubmitted` | `under_review` | `needs_correction` |
`approved` | `rejected` | `suspended`. Written on every applicant submission and
every reviewer decision; surfaced to the reviewer in the dialog and to the
applicant via `GET /api/seller/status` → `reviewHistory`.

## API Surface (verification)

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/seller/verification` | seller | own status (count only, no URLs) |
| POST | `/api/seller/verification` | seller | submit / resubmit (evidence required) |
| POST | `/api/seller/apply` | user | seller application (3 identity docs required) |
| GET | `/api/seller/status` | user | status + reasons + history |
| POST | `/api/seller/evidence/upload-intent` | user | presigned PUT (onboarding-safe) |
| POST | `/api/seller/evidence/confirm` | user | persist media row |
| GET | `/api/seller/evidence` | user | own evidence (signed URLs) |
| GET | `/api/admin/verifications?status=&q=` | reviewer | seller queue (`all` supported) |
| GET | `/api/admin/verifications/seller/:id/evidence` | reviewer | signed evidence |
| GET | `/api/admin/verifications/seller/:id/history` | reviewer | review history |
| PATCH | `/api/admin/verifications/seller/:id` | reviewer | approve/reject/suspend/needs_correction |
| GET | `/api/admin/sellers?status=&q=` | reviewer | seller list (search + filter) |
| GET | `/api/admin/sellers/:id/application` | reviewer | full application detail + signed docs |
| PATCH | `/api/admin/sellers/:id/status` | owner/admin | account lifecycle status |
| GET | `/api/shops/:shopId/verification` | public | status only |

## Product Verification — removed from the user workflow

Gone: `GET/POST /api/seller/products/:productId/verification`,
`PATCH /api/admin/verifications/product/:verificationId`, the product branch of
`GET /api/admin/verifications`, the `product-verification` rate limiter,
`api.seller.productVerificationStatus`, `api.seller.submitProductVerification`,
`api.admin.productVerificationAction`, and the VelCenter product verification
queue / `EvidenceCell` / `VerificationActions` / `reviewDialogKind`.

`GET /api/admin/verifications` still returns `products: []` so existing callers
do not break.

**The `product_verifications` and `products.verification_status` tables were NOT
dropped** — they are legacy, unreferenced by any route after this change, and are
kept for historical rows only (per the “do not delete DB structures blindly”
rule). Nothing writes to them.

## Category Picker

- `packages/shared/src/components/seller/CategoryPicker.tsx` — hierarchical,
  Radix Dialog on top of `ProductFormDialog`, own scroll context (`max-h-[85dvh]`,
  only the list scrolls). No scroll bleed, no horizontal overflow.
- Long names: breadcrumbs `min-w-0 flex-wrap` with `max-w-[8rem] truncate
  sm:max-w-[14rem]` + `title`; rows `min-w-0 flex-1 truncate` + `title`; the
  chevron/check stay `shrink-0`. The full name is always reachable via the
  `title` tooltip.
- All UI strings use `categoryPicker.*` (TH/EN/MY). The selected category in
  `ProductFormDialog` truncates (`min-w-0 flex-1 truncate` + `shrink-0` chevron).
- Data comes from the canonical `/api/categories/tree` — no hard-coded taxonomy.

## Seller Navigation

`apps/velseller/src/main.tsx` primary tabs: Goals · My Shop · Orders · Income ·
Profile. No “V Verification” tab and no standalone post-registration identity
page. Identity verification lives inside the seller application onboarding
(`RequireRole`); a *seller verification* request (the V trust badge) remains
available from the My Shop seller-verification card, which is the single
canonical seller-verification surface.

## Database

Changed (three places, all synchronized):

| File | Change |
|---|---|
| `db/schema.sql` | `sellers.status` CHECK widened to the review lifecycle; `seller_verifications.review_reason_code` / `review_note`; new `seller_review_history` table + index; idempotent constraint-repair block at the end |
| `db/run-sqleditor.sql` | byte-identical to `db/schema.sql` (asserted by a test) |
| `db/migrations/043_seller_review_lifecycle.sql` | new — seller status constraint + review columns + history table |
| `db/migrations/044_velrepeat_plans_status_constraint.sql` | new — re-asserts the VelRepeat constraint (see below) |

`db/run-update.sql` was **not** created or modified.

## VelRepeat `item_unavailable` — investigated and fixed (separate issue)

**Finding:** the repository state machine is NOT stale. `db/schema.sql`,
`db/run-sqleditor.sql`, `db/migrations/035_velrepeat_plans_status_fix.sql` and
`backend/jobs/velrepeat-scheduler.ts` (`RUN_STATUSES`) all already allow
`item_unavailable`. The scheduler legitimately writes it to BOTH
`velrepeat_plan_runs.status` and `velrepeat_plans.status`.

**Root cause:** two migrations share the number 035
(`035_checkout_idempotency.sql` and `035_velrepeat_plans_status_fix.sql`), and
029/030/034 are also duplicated. A runner keyed on the numeric prefix applied
only one file per number, so the constraint repair never ran and the deployed
database kept the pre-V0035 CHECK.

**Fix:** `db/migrations/044_velrepeat_plans_status_constraint.sql` gives the
repair an unused number so it cannot be skipped, and the same idempotent
`ALTER TABLE … DROP CONSTRAINT IF EXISTS / ADD CONSTRAINT` statements were
appended to both bootstrap files (widening only — no data can violate it, no
normalization needed). The VelRepeat plan-status label map in
`apps/velshop/src/pages/VelRepeatPage.tsx` now also renders
`item_unavailable`.

## Files Changed

- `packages/shared/src/components/seller/IdentityDocumentUploader.tsx` — **NEW** (real preview + R2 upload)
- `packages/shared/src/lib/verification-reasons.ts` — **NEW** (canonical reason codes + checklist)
- `packages/shared/src/components/RequireRole.tsx` — onboarding identity step now uses the uploader; evidence sent with the application; TH/EN/MY copy
- `packages/shared/src/components/seller/CategoryPicker.tsx` — long-name safety + `categoryPicker.*` i18n
- `packages/shared/src/lib/i18n/locales/index.ts` — `gate` / `identityDoc` / `reviewReason` / `review` copy for TH/EN/MY
- `packages/shared/src/lib/api-routes.ts` — product verification keys removed; seller review + evidence endpoints added
- `backend/routes/verification.ts` — seller-only rewrite (no product routes), signed evidence, structured reasons, history
- `backend/routes/seller.ts` — transactional application, backend identity validation, structured reasons, history, search/filter, application-detail endpoint
- `backend/middleware/rate-limit.ts` — product limiter removed; seller-apply + seller-evidence limits added
- `apps/velcenter/src/components/VerificationReviewDialog.tsx` — rewritten review workspace
- `apps/velcenter/src/pages/Center.tsx` — All filter + search, detail action, product queue removed, dead code pruned
- `apps/velseller/src/pages/MyShop.tsx` — stale dual-verification comment corrected
- `apps/velshop/src/pages/VelRepeatPage.tsx` — `item_unavailable` plan label
- `db/schema.sql`, `db/run-sqleditor.sql`, `db/migrations/043_*.sql`, `db/migrations/044_*.sql`
- `backend/tests/product-lifecycle.test.ts` — dual-verification tests replaced with single-system + preview/evidence/state-machine/reason/history/security tests

## Tests Actually Performed

| Command | Result |
|---|---|
| `bun run typecheck` | PASS — velshop, velseller, velcenter, velnox |
| `bun --filter @velnox/backend typecheck` | PASS |
| `bun test backend/tests` | **191 pass / 26 skip / 0 fail** (681 assertions) |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287, at parity |
| `git diff --check` | CLEAN |
| `diff db/schema.sql db/run-sqleditor.sql` | identical (also asserted by a test) |

Tests are static + unit + DB-gated integration. The 26 skipped suites require a
`DATABASE_URL` and a live R2 bucket.

## Known Limitations

- **No live browser E2E was executed.** The image preview, the R2
  presign→PUT→confirm round trip and the VelCenter reviewer flow were verified
  by typecheck, unit tests over the real source, and source inspection — not by
  driving a browser or a real bucket. The object-URL preview path is guarded by
  regression tests over the component source.
- **The DB constraint repairs must reach the deployed database.** Append-`ALTER`
  blocks in `db/schema.sql` / `db/run-sqleditor.sql` (or migrations 043/044) must
  be applied; a stale database will still reject `under_review` /
  `needs_correction` on `sellers.status` and `item_unavailable` on
  `velrepeat_plans.status`.
- **Legacy i18n strings remain.** `th.ts` / `en.ts` / `my.ts` still contain the
  now-unused `productVerification*` keys. They are unreferenced; leave them until
  those large files can be rewritten wholesale (removing them from only some
  locales would break `i18n:check` parity).
- **Legacy DB objects retained on purpose.** `product_verifications`,
  `products.verification_status`, `products.verified_at` are deprecated and
  unwritten. Drop them only after confirming zero historical rows matter.
- **Migration numbering has duplicates** (029, 030, 034, 035). New migration
  files should use an unused number; consider renumbering the duplicates so a
  prefix-keyed runner cannot skip one again.
- **`GET /api/admin/verifications` is unpaginated** (LIMIT 200) and VelCenter
  loads it per status (4 requests). Fine at current volume; add pagination before
  the queue grows.
- **The evidence signed URLs expire after 5 minutes.** A reviewer who leaves the
  dialog open longer must reopen it; the dialog says so.

## Recommended Next Steps

1. Apply migrations 043 and 044 (or re-run `db/run-sqleditor.sql`) in Neon, then
   re-run the seller → R2 → Neon → VelCenter flow against the live database.
2. Drive a real browser E2E: select an image on Android Chrome + iOS Safari and
   confirm the preview, replace, remove; then submit and review in VelCenter.
3. Renumber the duplicated migrations (029/030/034/035) so the runner is
   unambiguous.
4. Add pagination to the VelCenter verification queue.
5. Decide the fate of the legacy `product_verifications` table and the
   `productVerification*` locale keys, then remove them together.
