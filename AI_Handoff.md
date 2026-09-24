# Velnox AI Handoff

**Last updated:** 2026-09-24 (TASK 004A isolation + fixture remediation, TASK 004B production R2 round-trip — bucket CORS repaired)
**Branch:** `main`

## Current Project State

Velnox Marketplace — 4 Vercel frontends (velshop, velseller, velcenter, velnox) + Render backend (Express + WebSocket) + Neon PostgreSQL + Cloudflare R2. Auth: Google OAuth + JWT `velnox_session` (httpOnly cookie). Velnox has **ONE** verification system: **SELLER / SHOP identity verification**. There is no product verification.

## Test Database Isolation (TASK 004A) — MANDATORY

```
Application runtime  →  DATABASE_URL            (unchanged)
Test process         →  TEST_DATABASE_URL only  (disposable; name must contain "test")
```

- `backend/db/database-guard.ts` resolves the connection and validates the test
  target: it is refused when it equals the application database (same
  host+port+database), carries a `prod|production|live|primary` host/database
  segment, or has a database name without `test`. A refused target **fails the
  suite closed** — no connection is attempted.
- `backend/tests/helpers/test-db.ts` is the only test entry point:
  `const testFn = integrationTest;`. Missing `TEST_DATABASE_URL` → integration
  tests **skip**; the old `Boolean(process.env.DATABASE_URL)` gate is forbidden
  and guarded by `backend/tests/test-database-isolation.test.ts`.
- Why: `bun test` auto-loads `.env`, so the suite used to write fixture shops
  (`so-test-*`, `inv-*`, `inv-cancel-*`, `inv-paid-*`) into the production Neon
  database, where `GET /api/shops` (`sellers.status = 'approved'`) exposed them.
- CI: `.github/workflows/backend-tests.yml` runs the suite on a throwaway
  `postgres:16` service bootstrapped from `db/run-sqleditor.sql`, with
  `TEST_DATABASE_URL` only.
- Already-contaminated rows were removed once by
  `backend/scripts/test-fixture-cleanup.ts` — see *Production Fixture
  Remediation* below. Never run the integration suite without
  `TEST_DATABASE_URL`.
- Full record (root cause, files, tests, production read-only check):
  `AI_HANDOFF.md`.

## Production Fixture Remediation (TASK 004A, step 2) — DONE

The rows the pre-isolation test runs had already written were **deleted on
2026-09-24** with owner authorization, after a read-only dry run. Do not repeat
this operation — it is a one-off remediation, and the tool is kept for audits.

Tool (read-only by default):

```bash
cd backend && bun run fixtures:audit                                        # dry run
cd backend && VELNOX_ALLOW_FIXTURE_CLEANUP=1 bun run fixtures:audit --apply  # deletes
```

`backend/scripts/test-fixture-cleanup.ts` discovers fixture roots from the
markers the test sources use (users with a `@test.local` email, plus the shop
slug prefixes the suites create), walks the **foreign-key closure** through
`information_schema` to compute an exact delete set, and refuses to delete when
any row in that set points at an entity outside it (a shared reference = real
data entangled with a fixture). All deletes run in one transaction and abort on
the first foreign key that cannot be cleared.

Result: **931 rows** removed — 167 users, 144 sellers, 144 shops, 123 products,
79 orders, 79 order_items, 88 inventory, 33 product_reviews, 21 notifications,
11 payments, and their `velrepeat_*` rows. Zero shared references were found
before deleting. Re-running the audit reports 0 fixture roots, and
`GET /api/shops` now returns only the legitimate shop. `categories` (platform
taxonomy) was deliberately not touched; no schema change.

## Production R2 Round-Trip (TASK 004B) — VERIFIED, one defect fixed

Tool: `backend/scripts/r2-roundtrip.ts` (`cd backend && bun run r2:roundtrip`).
It reproduces the real media pipeline — `createR2Client()` + the exact presign
command from `routes/upload.ts` → PUT the signed URL → `HeadObject` (what
`/api/upload/confirm` does) → fetch the object over `R2_PUBLIC_DOMAIN` (plain and
with the `?v=` cache-bust) → read the bucket CORS policy → delete the temporary
`healthcheck/roundtrip-<uuid>.webp` object. Never prints a credential.

Result: **11/11 checks pass.** Bucket `velnox-storage`, public domain
`https://pub-01da4cea98c140f98d0c20ec14acb608.r2.dev`. Production
`/api/health/r2` → `{configured:true,bucket:true,verify:true}`;
`POST /api/upload/presign` without a session → 401 (correct).

**Defect found and fixed — bucket CORS.** The bucket allowed only
`velshop|velseller|velcenter.vercel.app` plus `velnox-group.vercel.app`. That
last origin is **dead** (`velnox-group.vercel.app` → HTTP 404); the real
corporate origin is `https://velnox.vercel.app` (HTTP 200,
*"Velnox — Build. Solve. Grow."*), and **all four dev origins were missing**, so
browser uploads from `localhost:5173-5176` failed their preflight. Fixed with
`bun run r2:roundtrip --fix-cors`, which is additive — it appended the five
missing documented origins and kept the existing `PUT/GET/HEAD`, `AllowedHeaders:
*`, `ExposeHeaders: ETag`, `MaxAgeSeconds: 3600`. Bucket now allows **8/8**
documented origins; the dead origin was left in place (removing it is a separate
call).

Not scriptable: the Neon half — `media` row + `users.avatar` / shop `logo`
reference — needs an authenticated session against the deployed API.

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

## Category Picker (UI audit 2026-09-15)

- `packages/shared/src/components/seller/CategoryPicker.tsx` — hierarchical,
  Radix Dialog on top of `ProductFormDialog`, own scroll context (`max-h-[85dvh]`;
  header / search / breadcrumb / footer are `shrink-0`, only
  `min-h-0 flex-1 overflow-y-auto` list scrolls). Data comes from the canonical
  `/api/categories/tree` — no hard-coded taxonomy. All UI strings use
  `categoryPicker.*` (TH/EN/MY, verified at parity).

### Root cause — two close buttons

`packages/shared/src/components/ui/dialog.tsx` renders its own absolutely
positioned close button by default (`showCloseButton = true`) and
`CategoryPicker` also rendered a header X, so both were painted in the same
top-right corner.

**Fix (localized, shared component untouched):** `CategoryPicker` passes
`showCloseButton={false}` to `DialogContent` and keeps its own header button —
it sits in normal flow (cannot overlap the title), carries a localized
`aria-label` (`categoryPicker.close`) and closes through the same `handleCancel`
path as the Cancel button. Escape and Radix dismiss/focus behavior are
unchanged. Exactly one close X remains; the search field's clear “x” only appears
while a query is typed.

### Root cause — long category names escaped their container

The truncating text sat inside flex/grid chains that were missing an automatic
minimum-size reset, so a long name (Thai/Burmese names have no word breaks;
`Consumer Electronics Accessories and Smart Devices`) kept its intrinsic `nowrap`
width and painted outside the dialog — over the ProductFormDialog field/input
column behind it:

- `ProductFormDialog` category trigger: the button had `w-full` but no `min-w-0`, the
  loading/placeholder spans had neither `min-w-0` nor `truncate`, and the two
  `grid-cols-2` children had no `min-w-0`.
- `CategoryPicker` header: `justify-between` with no `min-w-0 flex-1` on the title,
  so a long title (longest is Burmese) could push the close button.
- `CategoryPicker` breadcrumbs: the wrapping row and the per-crumb `<span>` had no
  `min-w-0` / `overflow-hidden`.
- `CategoryPicker` category + search rows: row container had no `w-full min-w-0`,
  the text wrapper had no `overflow-hidden`, and the secondary line
  (`N subcategories`, search path) had no `truncate`.
- `CategoryPicker` list region used `overflow-y-auto` alone, which leaves the other
  axis `auto`, so an over-wide row scrolled horizontally instead of clipping.
- `apps/velseller/src/pages/MyShop.tsx` desktop product table: product name + category
  label sat in a flex row whose text column had no `min-w-0` / `truncate` — the same
  bug class.

**Fix — width constraints only (no redesign, no font shrinking, no hidden data):**

- every flex/grid container in those chains now has `min-w-0` (plus `w-full` on row
  containers), every icon is `shrink-0`, and every text node is `truncate` inside a
  `min-w-0 flex-1 overflow-hidden` wrapper; the list region is `overflow-x-hidden`.
- breadcrumbs keep the bounded `max-w-[8rem] sm:max-w-[14rem]` + `title` tooltip and
  still wrap, so one long crumb cannot consume the dialog width.
- the selected category keeps `title={selectedCategoryName}` so a truncated name stays
  readable.
- `overflow-hidden` is deliberately NOT set on the category row container: it would clip
  that row button's focus outline. The text chain constrains the width without it.

Interaction contract (unchanged): selecting a category only sets form state — it does
not close `ProductFormDialog`; Cancel and the header X discard the pending selection;
Escape closes through Radix `onOpenChange` without committing; clicking outside is
intentionally a no-op so a half-made selection cannot be lost.

### Files changed in this audit

- `packages/shared/src/components/seller/CategoryPicker.tsx` — single close button; header /
  search / breadcrumb / list / row / footer width constraints.
- `packages/shared/src/components/seller/ProductFormDialog.tsx` — category trigger
  (`min-w-0`, `overflow-hidden`, truncating spans, `title`) + `min-w-0` on the grid children.
- `apps/velseller/src/pages/MyShop.tsx` — desktop product-table text column `min-w-0`/`truncate`.
- No shared `ui/*` component, i18n key, API, or database object was changed.

## VelCenter Category Edit — overflow fix + verification audit (2026-09-15)

### Root cause — long parent-category name covered the “ลำดับ” field

`apps/velcenter/src/components/CategoriesManagement.tsx`, Create/Edit dialog. The
parent-category `<select>` and the sort-order field shared a plain
`grid grid-cols-2 gap-3`. Tailwind columns are `minmax(0, 1fr)`, so the *column*
was bounded — but each field sat in an inner `div.grid` whose single implicit
track is `auto`. An `auto` track is floored by its item's **min-content** width,
and a grid item's default `min-width` is `auto`, so the `<select>` could never
shrink below the width of its longest `<option>`. `grid` tracks are allowed to
overflow their container, so the select painted past the column and over the
“ลำดับ” input on the right. A Thai/English/Myanmar category name has no effective
word-break opportunity, which is why only long names reproduced it.

**Fix — width constraints at the root, category data untouched:**

- the field grid became `grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2` (one
  column on narrow screens, so the two controls can never race for space on a
  phone; unchanged two-column layout from `sm:` up);
- both field wrappers got `min-w-0`, which resets the automatic minimum size so
  they can shrink below their content;
- the `<select>` is now `w-full min-w-0 max-w-full truncate rounded-lg …` — the
  native control is finally size-constrained and ellipsizes its closed-state
  label (Chromium) instead of growing;
- the sort-order `Input` got `className="w-full min-w-0"` so it stays bounded too.

The stored category name is never shortened, truncated in data, or rewritten —
`<option>` keeps the full string, and the same full name still renders in the
category tree (`CategoryRow`), which was already `min-w-0 flex-1` and wraps
safely.

### Similar-pattern audit — no other real occurrences

Searched `<select`, `grid-cols-2`, and the category render surfaces across
`apps/velcenter`, `apps/velseller`, `packages/shared`:

- Only **two** native `<select>` elements exist in the repo. The other one
  (`apps/velshop/src/pages/ShopDetail.tsx`, sort dropdown) holds short fixed sort
  labels in a flex row and has no long-text neighbour — left untouched.
- The other `grid-cols-2` blocks in `apps/velcenter/src/pages/Center.tsx`
  (stat tiles, product stock summary, approve/reject button pairs, settings
  fields) pair inputs/buttons with `min-w-0`-safe shadcn `Input`s or short labels —
  no intrinsic-width bug.
- `packages/shared/src/components/seller/CategoryPicker.tsx` (breadcrumbs, rows,
  search results) and `ProductFormDialog` already carry the full `min-w-0` +
  `truncate` + `shrink-0` chain from the previous audit. No regression found.

### CategoryPicker close button — re-verified

`CategoryPicker` still passes `showCloseButton={false}` to `DialogContent` and
renders exactly **one** header X with `aria-label={t("categoryPicker.close")}`
(TH/EN/MY = 1287/1287/1287, at parity). The shared `ui/dialog.tsx` was not
touched. Hierarchy navigation, breadcrumbs, search, the isolated scroll region
(`max-h-[85dvh]`, only the list is `overflow-y-auto`) and selection semantics are
unchanged.

### Seller identity-verification architecture — confirmed, no change made

Audited against live source (no code change required):

- **One system.** `backend/routes/verification.ts` serves seller/shop identity
  verification; `GET /api/admin/verifications` still answers `products: []`. No
  `products.is_v` column and no product verification route/UI exists. V is
  derived from the seller only — `isProductVerified()` in
  `packages/shared/src/components/VBadge.tsx` returns
  `sellerVerification === "verified"` and ignores its product argument.
- **Two distinct columns.** `sellers.status` = account lifecycle
  (`pending|under_review|needs_correction|approved|rejected|suspended`);
  `sellers.verification_status` = trust badge
  (`unverified|pending|verified|rejected|suspended`).
- **Evidence security.** Private R2 bucket, keys owner-scoped as
  `verification/evidence/{sellerId|userId}/{purpose}_{ts}.ext`; upload-intent
  enforces a mime allow-list, a purpose allow-list and derives the owner segment
  from the session; confirm requires the `verification/evidence/` prefix **and**
  `keyOwner ∈ {session userId, session sellerId}`; `GET /api/seller/evidence`
  filters on `uploaded_by = $1`; the reviewer endpoint is gated by
  `assertReviewer` (`owner|admin|staff`) and issues **short-lived (300 s) signed
  GET URLs** only — no identity document is ever exposed as a public URL. The
  public `GET /api/shops/:shopId/verification` returns only
  `verificationStatus` + `verifiedAt`.
- **Submission integrity.** `POST /api/seller/verification` runs in one
  transaction: requires ≥1 evidence reference, `FOR UPDATE` on the seller row,
  ownership check against `media.uploaded_by`, upserts the
  `seller_verifications` row, and only **then** sets
  `sellers.verification_status='pending'` and writes the `submitted` history
  row. Any failure rolls back, so a false “pending” cannot be reported.
- **State machine enforced server-side.** Reviewer role is re-read from the DB
  (`assertReviewer`); a non-approve action without a valid structured reason code
  is rejected (`REASON_REQUIRED`); `approve` is refused when `evidence_urls` is
  empty (`EVIDENCE_REQUIRED`) and when the record is already
  `rejected`/`suspended` (`INVALID_TRANSITION`). The seller-application route
  additionally returns `SELF_ACTION_FORBIDDEN` for a user acting on their own
  seller row, and `VALID_TRANSITIONS` rejects undocumented jumps.
- **Reasons & history.** 12 canonical codes are mirrored in
  `packages/shared/src/lib/verification-reasons.ts` and the backend allow-list
  (a test asserts they match). Applicant-visible reason/code are persisted into
  `seller_settings.settings`, the reviewer's `note` stays internal, and every
  submit + decision writes `seller_review_history`.
- **Seller UX & separation.** Correction/rejection/suspension reasons surface in
  the onboarding gate (`packages/shared/src/components/RequireRole.tsx`: correction
  title/desc + “action required”), and resubmission returns the application to
  `pending` (shop is upserted, never duplicated). Store Profile editing stays a
  separate flow from the application/identity verification.

**No database change was required for this task.** `Database schema unchanged.`

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

### Category Picker audit — tests actually performed (2026-09-15)

| Command | Result |
|---|---|
| `bun run typecheck` | PASS — velshop, velseller, velcenter, velnox |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287, at parity (incl. every `categoryPicker.*` key) |
| `bun test backend/tests` | 207 pass / 10 fail — every failure is an `(integration)` suite hitting the live Neon DB (e.g. `orders_user_id_fkey` fixture collisions). This change is frontend-only; no backend test touches it, so those failures are pre-existing/environmental |
| `git diff --check` | CLEAN |

### VelCenter category-edit fix — tests actually performed (2026-09-15)

| Command | Result |
|---|---|
| `bun run typecheck` | PASS — velshop, velseller, velcenter, velnox |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287, at parity |
| `bun test backend/tests` | 206 pass / 11 fail — every failure is an `(integration)` suite needing live Neon (FK fixture violations, `23503`). This change is CSS/class-only inside one VelCenter component; no backend code or test touches it, so the failures are environmental/pre-existing |
| `git diff --check` | CLEAN |
| `git diff --stat` | 1 file changed, 5 insertions(+), 4 deletions(-) |

**NOT verified: no browser and no responsive measurement was performed** (no browser is
available here). The fix is structural (`min-w-0` on the grid items + a constrained
`<select>` + `truncate`), so it is viewport-independent, but the dialog should still
be eyeballed once on the deployed build at 320/375/390/768/desktop with a long Thai,
English and Myanmar parent-category name to confirm the select no longer reaches the
“ลำดับ” field. There is no component-test harness in the repo, so this stays manual.

**NOT verified: no browser and no visual/responsive measurement was performed** (no
browser is available in this environment). The layout result is derived from the CSS
width chain by source inspection. Because the fix is structural (`min-w-0` +
`truncate` + `overflow-hidden`, viewport-independent), it should hold at 320–414px and
on desktop, but it still needs one real-browser pass (open the picker, enter nested
categories, pick a very long name, search, cancel, X, Escape, count the X buttons).
Regression coverage for this UI is still manual only — there is no component test
harness in the repo.

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
- **`PATCH /api/admin/verifications/seller/:id` has no self-action guard.** A user
  whose role is `seller` cannot reach it (`assertReviewer` allows only
  `owner|admin|staff`), and the seller-application route does return
  `SELF_ACTION_FORBIDDEN`. But an `owner`/`admin` who also owns the shop being
  reviewed could approve their own identity verification — the checkout has no
  equivalent to the application route's `seller.user_id === userId` check. Report
  only; not changed here.

## VelCenter Operations Center Upgrade (2026-09-16)

### What was done

Upgraded VelCenter from a basic moderation view into a professional marketplace operations center with shop-grouped product moderation, full product review detail, seller verification queue with search/filters, self-approval security guard, shop revoke functionality, and realtime WebSocket updates.

### Backend changes

| Endpoint | Change |
|---|---|
| `GET /api/admin/products/moderation` | Added search (`q`), sort (`newest`/`oldest`), shop filter (`shopId`), and `shop_status`/`seller_verification_status` fields. Default ordering is newest-first. |
| `GET /api/admin/products/:productId/moderation-detail` | **NEW** — full product detail for moderation review: variants, attributes, option groups, images, inventory, shop info, moderation history. |
| `PATCH /api/admin/verifications/seller/:id` | Added self-approval guard: an `owner`/`admin` who also owns the reviewed shop cannot approve their own identity verification. Returns `403 SELF_ACTION_FORBIDDEN`. |
| `POST /api/admin/sellers/:id/revoke` | **NEW** — transactional shop revoke: unlists all products (sets to `archived`), suspends seller, records moderation + audit logs. Preserves financial/order records. |
| `GET /api/admin/dashboard/counts` | **NEW** — dashboard counters: pending sellers, under review sellers, pending products, total/verified/suspended shops, pending verifications. |

### Frontend changes

| Component | Change |
|---|---|
| `ProductModerationQueue.tsx` | **NEW** — search, status filter, sort order, shop grouping with expand/collapse, product cards with status badges and images. |
| `ProductReviewDetail` | Integrated into `ProductModerationQueue` — full review dialog with image gallery, product info, variants, attributes, shop info, moderation history, approve/reject actions. |
| `SellerVerificationQueue.tsx` | **NEW** — search, status filter, verification list with status badges, review dialog integration, shop revoke with confirmation dialog. |
| `Center.tsx` | Products and sellers tabs now use the new extracted components. Added WebSocket subscriptions for realtime updates (`product:updated`, `seller:updated` channels). Removed old inline verification state. |

### Realtime integration

VelCenter now subscribes to the existing WebSocket channels:
- `product:updated` — triggers product queue refresh when a product is moderated
- `seller:updated` — triggers seller/verification queue refresh when seller status or verification status changes

Events are broadcast from:
- Product moderation action (`product:moderated`)
- Seller status change (`seller:status-changed`)
- Verification status change (`verification:status-changed`)

### Security

- **Self-approval guard**: `PATCH /api/admin/verifications/seller/:id` now checks `seller.user_id === reviewer identity` and returns `403 SELF_ACTION_FORBIDDEN` for self-approval attempts.
- **Shop revoke**: requires `owner` or `admin` role, requires a reason, runs in a transaction, records audit + moderation logs.
- **Product moderation detail**: admin-only, server-resolves product/shop relationship.
- **Identity documents**: remain private (short-lived signed URLs only, unchanged).

### Files changed

| File | Change |
|---|---|
| `backend/routes/products.ts` | Enhanced moderation list endpoint; added moderation-detail endpoint; added broadcast import |
| `backend/routes/seller.ts` | Added shop revoke endpoint; added broadcast import |
| `backend/routes/verification.ts` | Added self-approval guard; added broadcast import |
| `backend/routes/center.ts` | Added dashboard counters endpoint |
| `packages/shared/src/lib/api-routes.ts` | Added new endpoint definitions |
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | **NEW** |
| `apps/velcenter/src/components/SellerVerificationQueue.tsx` | **NEW** |
| `apps/velcenter/src/pages/Center.tsx` | Uses new components; WebSocket subscriptions; removed old inline verification state |
| `backend/tests/product-lifecycle.test.ts` | Updated test to check new component location |

### Tests

| Check | Result |
|---|---|
| `bun run typecheck` | PASS — all 4 apps + backend |
| `bun test backend/tests` | 205 pass / 12 fail — all failures are pre-existing integration tests requiring live Neon |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287 |
| `git diff --check` | CLEAN |

### Not verified (no browser available)

- Visual rendering of shop-grouped product queue
- Product review detail dialog on mobile/desktop
- Seller verification queue search/filter behavior
- Shop revoke confirmation dialog UX
- WebSocket realtime updates in production
- Responsive behavior at 320–414px widths

### Recommended next steps

1. Add pagination to product moderation and seller verification lists for large datasets.
2. Add dashboard counters to the overview tab UI (backend endpoint exists, frontend integration pending).
3. Add i18n keys for new moderation/verification UI strings (currently using Thai hardcoded strings in new components).
4. Add E2E tests for the product moderation and seller verification flows.
5. Apply the `idx_media_owner_key` composite index (migration 041) to production Neon.

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
6. Add the self-action guard (`seller.user_id === reviewer identity`) to
   `PATCH /api/admin/verifications/seller/:id` for parity with
   `PATCH /api/admin/sellers/:id`.
7. Eyeball the VelCenter Create/Edit Category dialog on the deployed build with a
   very long TH/EN/MY parent-category name at 320/375/390/768/desktop.

## Product Visibility Root-Cause Audit — "previously created products are no longer appearing" (2026-09-16)

**Reported problem:** previously created products were not appearing; "not even a single previously created product is visible".

### How this was investigated (no guessing)

- **Sandbox limitation:** this environment has **no `DATABASE_URL`**, so Neon could not be queried directly. `db/schema.sql` / `db/run-sqleditor.sql` were read for the real model, and the **deployed public API** (`https://velnox-api.onrender.com`) was probed read-only, the same method the TASK 2.5 audit used.
- **Live production evidence (2026-09-16):**
  - `GET /api/products/catalog?limit=200` → **43 published products**, of which **42 are test artefacts** (`so-test-*`, `inv-*`, `P1#6 Product`, `vr-test-*`, `Review Product A/B`) and **exactly 1 is a real product** (`HTC NE20 AI Translator …`, shop `Eloop`, category `headphones-speakers`).
  - `GET /api/shops/eloop` → `productCount: 1`, and the shop's published product list contains that single item.
  - `GET /api/products/4ec0f402-3070-4389-8384-255b1b695596` (the `STAR FRUIT …` product that earlier production logs reported as `status='published'`) → **404**, i.e. it is no longer `published` (that endpoint 404s for every non-published status **and** for a missing row).
  - `GET /api/categories/tree` → only `headphones-speakers -> 1` has a published count.
  - `GET /api/_diag/schema` → all V0040 artefacts exist (`seller_verifications`, `product_verifications`, `categories.is_active/names/…` = `true`). `schema_migrations` lists migrations only up to `039_seller_goals_and_center`; the V0040 DDL is applied but its bookkeeping row is absent (applied out-of-band).
  - **Conclusion:** the catalog endpoint itself is healthy. The real products have left the `published` state (or were archived / never approved) — a **state/data** problem sitting on top of the genuine pipeline defects below.

### Defects fixed in this pass

1. **`useQuery()` was a stub that always returned `undefined`** (`packages/shared/src/lib/api-routes.ts`). It never called anything, so every consumer read nothing: `Center.tsx` (`api.center.overview`, `api.products.listAll`, `api.users.listUsers`) and `SellerGoals.tsx` (`api.goals.list`). The VelCenter **Intelligence tab, Overview goal/low-stock/reorder sub-values and Staff user list were permanently empty** — "products not appearing" inside VelCenter. `useQuery` is now a real React hook (`useState` + `useEffect`) that GETs the mapped endpoint and returns the unwrapped payload; it accepts either a route key or the stable `ACTION_MAP` function, and still returns `undefined` while loading / on failure so existing callers keep working.
2. **The frontend silently dropped the verification filter.** `ShopProducts.tsx` passes `verified: true` for `/products?verified=true` (linked from the ShopCategories "VelShop Verified" card and the verified filter chip), but `api.commerce.catalogProductsAction` never forwarded it — so the verified surface rendered the **whole** catalog. It now sets `verified=true`.

### Re-verified as already correct upstream (no duplicate change committed)

- The catalog / product-detail / seller-list / shop-detail category join is already `LEFT JOIN categories c ON c.slug = p.category_id` (correct: `products.category_id` stores the canonical slug per V0015/V0029), and `/api/categories/tree|stats` already count on `c.slug`. Verified still correct.
- The customer-facing badge is already a single `V` with no `✓` in `ShopCategories.tsx` / `VBadge.tsx`. Verified still correct.
- `products.category_id` remains `TEXT` and there is still **no** `products.is_v` — the V rule stays derived (`## The V Rule` above).

### Diagnostics added (read-only, aggregate only)

`GET /api/_diag/schema` now also returns a `productVisibility` block: product counts by `status`, by `verification_status`, orphan-product / orphan-shop / orphan-seller join-integrity counts, category-join match counts for **slug vs uuid** (proves that bug class), and `productsWithoutImages`. No ids, names, evidence or PII.

**Next step to read the production state (needs one backend deploy):** open `https://velnox-api.onrender.com/api/_diag/schema` and read `productVisibility.byStatus`. If real products show `draft` / `pending_review` / `rejected` / `archived` rather than `published`, the remedy is an operator action in VelCenter (approve) or an explicit, reviewed data correction. **No blind mass-publish migration was written** — a product must not be made public merely to hide the problem, and no status was mass-rewritten.

### Files changed

- `packages/shared/src/lib/api-routes.ts` — real `useQuery` hook; `verified` forwarded in `catalogProductsAction`
- `backend/server.ts` — aggregate product-visibility diagnostics in `/api/_diag/schema`
- `backend/tests/product-visibility.test.ts` (NEW) — regression guards for the category key, the published-only catalog/detail contract, the `verified` passthrough, the `useQuery` implementation and the badge
- `apps/velshop/src/pages/ShopCategories.tsx` — removed two imports that had become unused

**Database changed:** NO migration. No `products.is_v`. No status rewritten. `db/schema.sql` / `db/run-sqleditor.sql` already agree on `products.category_id TEXT` and stay synchronized.

### Tests actually performed

- `cd backend && bun tsc --noEmit` → 0 errors
- `bun tsc -p apps/{velshop,velseller,velcenter,velnox}/tsconfig.json --noEmit` → 0 errors (all 4)
- `bun test backend/tests` → **200 pass / 26 skip (DB-gated) / 0 fail** (226 tests, 12 files)
- `bun test ./tests/product-visibility.test.ts` → 9 pass / 0 fail
- `bun run i18n:check` → `th=1287 en=1287 my=1287`, parity OK
- `git diff --check` → clean
- Live read-only probes against `https://velnox-api.onrender.com` — results recorded above

### Not verified / limitations

- **NOT VERIFIED (blocked):** production row-level state. No `DATABASE_URL` here, so the per-product statuses could not be read; `productVisibility.byStatus` is the instrument and only goes live after the next backend deploy.
- **NOT VERIFIED:** live browser E2E (no seeded seller/admin session, no headless browser). No credentials were fabricated.
- **Pre-existing, out of scope:** 42 published test artefacts (`so-test-*`, `inv-*`, `P1#6 Product`, `vr-test-*`, `Review Product A/B`) pollute the public catalog. Cleaning them needs a deliberate, reviewed archive step — not done here.
- **Pre-existing, out of scope:** `backend/lib/product-status.ts` is an untracked, unimported duplicate of the product lifecycle rules (AI_RULES §40). Left untouched because it is not part of the repository; flagged here so the next agent deletes it deliberately.

## VelCenter Runtime Crash Fix — `Cannot read properties of undefined (reading 'icon')` (2026-09-16)

### Problem

VelCenter crashed at runtime with `TypeError: Cannot read properties of undefined (reading 'icon')` on the Intelligence tab. The crash occurred in `Center.tsx` inside `.map()` over `intelRows`.

### Root cause

`PRODUCT_CATEGORY_META` in `packages/shared/src/lib/reorder.ts` is a hardcoded `Record` with only 6 old category keys: `general`, `food`, `daily`, `beauty`, `packaging`, `other`.

After the V0015/V0029 category migration, products now use database-backed category slugs (e.g. `headphones-speakers`, `fashion-clothing`). The catalog API returns `category: row.category_id || "general"`, which maps DB slugs through to the frontend.

When the Intelligence tab renders intel rows it does:

```typescript
const meta = PRODUCT_CATEGORY_META[product.category];
const Icon = meta.icon; // CRASH when category is e.g. "headphones-speakers"
```

Any product whose category slug doesn't match one of the 6 hardcoded keys produces `undefined` → crash.

### Fix

1. **`packages/shared/src/lib/reorder.ts`** — Added `FALLBACK_CATEGORY_META` (generic `Package` icon, slate color) and `resolveCategoryMeta(category)` function that returns the matching entry or the fallback. Exported both.

2. **`apps/velcenter/src/pages/Center.tsx`** — Replaced the two unsafe direct lookups (`PRODUCT_CATEGORY_META[product.category]`) with `resolveCategoryMeta(product.category)`. Changed import from `PRODUCT_CATEGORY_META` to `resolveCategoryMeta`.

### Why this is the correct fix

- The data contract (DB slugs ≠ hardcoded category map) is the real mismatch; adding optional chaining would merely hide the data error.
- `resolveCategoryMeta` is a single canonical resolver — all `.icon` access in the Intelligence tab now goes through it.
- Unknown categories still render with a safe `Package` icon + "สินค้า" label instead of crashing.
- No database changes. No schema changes. No new tables.

### Files changed

| File | Change |
|------|--------|
| `packages/shared/src/lib/reorder.ts` | Added `FALLBACK_CATEGORY_META`, `resolveCategoryMeta()` function |
| `apps/velcenter/src/pages/Center.tsx` | Replaced 2 unsafe `PRODUCT_CATEGORY_META[x]` lookups with `resolveCategoryMeta(x)` |

### Tests

| Check | Result |
|---|---|
| `bun tsc -p apps/velcenter/tsconfig.json --noEmit` | PASS |
| `bun tsc -p apps/velshop/tsconfig.json --noEmit` | PASS |
| `bun tsc -p apps/velseller/tsconfig.json --noEmit` | PASS |
| `cd backend && bun tsc --noEmit` | PASS |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287 |
| `bun test backend/tests` | 200 pass / 26 skip / 0 fail |
| `git diff --check` | CLEAN |

### Remaining

- The 6 hardcoded categories in `reorder.ts` are legacy. Eventually the reorder intelligence should resolve category labels/icons from the database-backed `categories` table. That's a separate task.
- No live browser E2E was run (no browser available).

## VelCenter Products & Sellers "No Data" Diagnosis (2026-09-16)

### Problem reported

- Products tab shows no product data
- Sellers tab shows no seller data
- Runtime error: `Cannot read properties of undefined (reading 'icon')`

### Diagnosis

**Products tab** — The default filter is `pending_review`. Live production data:
- 43 published products
- 4 archived products
- **0 pending_review products**

The empty state message ("ไม่มีสินค้ารอตรวจสอบในขณะนี้") is correct. The "All" filter shows all 47 products. The tab is working as designed; there are simply no products awaiting moderation review.

**Sellers tab** — The default filter is `pending`. The verification queue queries `seller_verifications` for each status. If no verifications are in `pending` state, the empty state is shown.

**`.icon` crash** — Already fixed in commit `c1b8d31` (`resolveCategoryMeta` with fallback). The production error came from an older deploy.

**Silent error handling** — Both `ProductModerationQueue` and `SellerVerificationQueue` had `catch { setProducts([]); }` / `catch { setRows([]); }` that silently converted any API failure (401, 403, 500) into an empty array. The user saw "no data" instead of an error.

### Fix

Added `error` state + error UI to both components:

- `ProductModerationQueue.tsx` — `catch` now captures the error message and displays a red error card with a retry button
- `SellerVerificationQueue.tsx` — same pattern: error message + retry button

API failures (auth, authorization, server error) are now visible instead of silently swallowed.

### Files changed

| File | Change |
|------|--------|
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | Added `error` state, error message in catch, error UI with retry |
| `apps/velcenter/src/components/SellerVerificationQueue.tsx` | Added `error` state, error message in catch, error UI with retry |

### Database

No changes. No products were mass-published. No seller statuses were changed.

### Tests

| Check | Result |
|---|---|
| `bun tsc -p apps/velcenter/tsconfig.json --noEmit` | PASS |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287 |
| `bun test backend/tests` | 200 pass / 26 skip / 0 fail |

### Remaining

- The `.icon` fix (`c1b8d31`) needs a Vercel deploy to reach production. The current production build still has the old code.
- No live browser E2E was run (no browser available).

## Production SQL Error Fixes — `sh.status` + `sv.evidence_notes` (2026-09-16)

### Problem

Production Render logs showed two SQL errors that caused VelCenter Products and Sellers tabs to return empty data:

```
[admin] product moderation list error:
error: column sh.status does not exist
code: 42703
hint: Perhaps you meant to reference the column "s.status".

[verification] admin list error:
error: column sv.evidence_notes does not exist
code: 42703
```

### Root cause

1. **`sh.status`** — `backend/routes/products.ts` selected `sh.status as shop_status` where `sh` aliases `shops`. The `shops` table has **no `status` column**. The query failed on every request, returning 500.

2. **`sv.evidence_notes`** — `backend/routes/verification.ts` selected `sv.evidence_notes` from `seller_verifications`. This column **does not exist** in the schema. The schema has `evidence_urls` (JSONB) and `review_note` (TEXT), but no `evidence_notes`.

### Schema (source of truth)

```
shops:          id, seller_id, name, slug, description, logo, cover, ...  (NO status column)
sellers:        id, user_id, status, verification_status, verified_at, ...
seller_verifications: id, seller_id, status, verification_type, evidence_urls,
                      submitted_at, reviewed_at, reviewed_by, rejection_reason,
                      suspension_reason, review_reason_code, review_note, ...
```

### Fix

1. **`backend/routes/products.ts`** — Replaced `sh.status as shop_status` → `s.status as shop_status` (2 occurrences: moderation list + moderation detail). `s` aliases `sellers`, which HAS a `status` column. Frontend contract (`shop_status` field name) preserved.

2. **`backend/routes/verification.ts`** — Removed `sv.evidence_notes` from SELECT (2 occurrences: admin list + seller own verification). Column doesn't exist; not used by frontend.

### Files changed

| File | Change |
|------|--------|
| `backend/routes/products.ts` | `sh.status` → `s.status` (2 occurrences) |
| `backend/routes/verification.ts` | Removed `sv.evidence_notes` from SELECT (2 occurrences) |

### Tests

| Check | Result |
|---|---|
| `cd backend && bun tsc --noEmit` | PASS |
| `bun tsc -p apps/velcenter/tsconfig.json --noEmit` | PASS |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287 |
| `bun test backend/tests` | 200 pass / 26 skip / 0 fail |

### Database

No schema changes. No data changes. The fix is purely in the SQL queries.

### Remaining

- Frontend error handling for Products/Sellers tabs was already improved in commit `3f7b761` (error state + retry button).
- The `.icon` crash was already fixed in commit `c1b8d31`.
- All three fixes need a Vercel deploy (frontend) + Render deploy (backend) to reach production.

---

## 2026-09-16 — Production 42703 root cause: the migration runner was blocked at V0040

### Problem

Render production kept raising:

```
[verification] admin list error:
error: column sv.review_reason_code does not exist   (code 42703)
at backend/routes/verification.ts:446
```

### Root cause (not a code bug)

`review_reason_code` / `review_note` ARE canonical: `db/schema.sql` ≡ `db/run-sqleditor.sql`
declare them, migration `V0043` adds them, `backend/routes/seller.ts` writes them and
`backend/routes/verification.ts` reads them. The production **database was simply
missing them**, because the migration workflow had been aborting one file earlier
since 2026-09-11 and therefore never applied `040`–`044`:

```
🔄 Applying: 040_verification_and_categories
ERROR: insert or update on table "categories" violates foreign key constraint
       "categories_parent_id_fkey"
DETAIL: Key (parent_id)=(a0000001-…-0001) is not present in table "categories".
Stopping. Fix the migration and re-run.
```

The subcategory seed referenced the hard-coded parent uuids from its own parent seed.
A database bootstrapped from `db/schema.sql` already holds those parents
(`electronics`, `food-beverage`, …) under the canonical `c0000001-*` uuids, so the
parent INSERT took the `ON CONFLICT (slug) DO UPDATE` path, kept the existing row id,
and the literal uuid pointed at a row that was never created. Because the runner uses
`--single-transaction` and stops on the first failure, `041`–`044` never ran — and
`041` and `044` were broken too, each hiding the next one.

### SCHEMA DRIFT REPORT (production vs canonical)

| Item | Finding |
|---|---|
| Missing in production | `seller_verifications.review_reason_code`, `review_note`; `seller_review_history`; the widened `sellers_status_check`; `shops` address columns; `idx_media_owner_key`. All were blocked behind V0040. |
| Extra in production | none found. |
| Different definitions | **critical** — V0008 renamed every `media` column to `cdn_url` / `object_key` / `mime_type` / `file_size` / `owner_id`, while every backend media statement and both canonical schema files use `url` / `key` / `content_type` / `size` / `uploaded_by`. Nothing in the repo ever used the renamed names. |
| Different definitions | **critical** — `velrepeat_plan_runs` was referenced by `V0044` and by `db/schema.sql` / `run-sqleditor.sql`, but no migration and no backend query ever created it. The run table is `velrepeat_runs` (V0034). |
| Safe / unrelated | 43 `published` + 4 `archived` products, all `product_verification = unverified`; 46/47 products have no `media` row (legacy of the broken insert). No orphan product→shop→seller→user rows (all 0). |

### Fix

1. **`db/migrations/040…`** — subcategory seed resolves parents **by slug** at apply time
   (`(SELECT id FROM categories WHERE slug = '…')`) instead of by seed uuid. Idempotent and
   immune to seed-id drift; Phase 4 guarantees each parent exists, so it can never be NULL.
2. **`db/migrations/041…`** — builds `idx_media_owner_key` over whichever owner/key columns
   the live table has (V0001 layout or V0008 layout) instead of hard-coding `uploaded_by, key`.
3. **`db/migrations/045_media_column_naming.sql` (new)** — renames the V0008 columns back to the
   canonical names. Guarded by `information_schema`, metadata-only, idempotent, no DROP/TRUNCATE/DELETE;
   a no-op on a database bootstrapped from `db/schema.sql`.
4. **`db/migrations/044…`, `db/schema.sql`, `db/run-sqleditor.sql`** — retarget the run-status CHECK
   from the phantom `velrepeat_plan_runs` to the real `velrepeat_runs` (same value set V0034 declares).

No `db/run-update.sql` was created or touched (it does not exist in this architecture).
`db/schema.sql` and `db/run-sqleditor.sql` remain **byte-identical**; no schema *shape* change was
needed because the canonical files were already correct — production had simply never applied them.

### PRODUCTION VERIFICATION (Neon, via `GET /api/_diag/schema`)

```
migrations: … 040 041 042 043 044 045            ← runner clean, all applied
seller_verifications.review_reason_code  true
seller_verifications.review_note         true
seller_review_history                    true
media.url / key / content_type / size / uploaded_by   true
media.owner_id / object_key / cdn_url / mime_type / file_size   false
```

`043_seller_review_lifecycle`, `044_velrepeat_plans_status_constraint` and `045_media_column_naming`
report `applied successfully` in the GitHub Actions run for `988f356`.

### Files changed

| File | Change |
|---|---|
| `db/migrations/040_verification_and_categories.sql` | subcategory parents resolved by slug |
| `db/migrations/041_media_cover_lookup_index.sql` | index built for either media naming |
| `db/migrations/044_velrepeat_plans_status_constraint.sql` | `velrepeat_plan_runs` → `velrepeat_runs` |
| `db/migrations/045_media_column_naming.sql` | **new** — restores canonical media column names |
| `db/schema.sql`, `db/run-sqleditor.sql` | phantom-table reference corrected (kept identical) |
| `backend/server.ts` | `_diag/schema` reports the seller-verification and media columns |
| `backend/tests/schema-drift.test.ts` | **new** — media-naming / phantom-table / canonical-schema guards |
| `backend/tests/category-validation.test.ts`, `product-lifecycle.test.ts` | drift guards for V0040 parents and `sv.<column>` vs schema |

### Tests

| Check | Result |
|---|---|
| `cd backend && bun tsc --noEmit` | PASS |
| `bun tsc -p apps/velcenter/tsconfig.json --noEmit` | PASS |
| `bun run i18n:check` | PASS — th=1287 en=1287 my=1287 |
| `bun test backend/tests` | 253 pass / 26 skip / 0 fail |
| `git diff --check` | CLEAN |
| `diff db/schema.sql db/run-sqleditor.sql` | identical |
| Migrate Neon workflow | SUCCESS (`35110482872`) |

### Production data

No product, seller, order or verification row was modified. No status was mass-changed.
V0040 does seed its canonical category taxonomy (that is what the migration is for); the only
rows it touched were updated by slug, and existing ids were preserved.

### Commits

`7c63734` (V0040 unblock) · `2aaed54` (V0041 + V0045 media naming) · `988f356` (V0044 velrepeat retarget).

### Remaining issues

- **Seller verification is now unblocked but not yet exercised end-to-end.** The DB now has every
  column the reviewer queue and the applicant flow use; a real submit → approve run should be
  performed in the UI to confirm.
- 46 of 47 products still have no `media` row: images uploaded while the media insert was failing
  were never recorded. New uploads work now; the old ones need re-upload.
- `product_verifications` still exists for historical data (Velnox runs ONE verification system —
  seller/shop identity). It is intentionally untouched.
- `GET /api/_diag/schema` is unauthenticated. It returns metadata only (table/column existence,
  counts, migration names), but it should be gated or removed before public launch.
- 42 published catalogue entries are test artefacts (`so-test-*`, `inv-*`, `P1#6 Product`, …) —
  data hygiene, out of scope here.

---

## 2026-09-16 — VelCenter moderation detail (42P10) + VelSeller correction notifications

### 1. Product moderation detail — PostgreSQL 42P10

**Problem** (`backend/routes/products.ts`):

```
[admin] product moderation detail error: error: in an aggregate with DISTINCT,
ORDER BY expressions must appear in argument list   (code 42P10)
GET /api/admin/products/:productId/moderation-detail
```

**Root cause.** The option-group aggregation was

```sql
json_agg(DISTINCT jsonb_build_object(… 'sort_order', pov.sort_order …)
         ORDER BY pov.sort_order)
```

PostgreSQL requires every ORDER BY expression of a **DISTINCT** aggregate to also be
an aggregate argument, and `pov.sort_order` only appeared *inside* the jsonb payload.
The statement was therefore rejected and the entire detail request 500'd whenever the
product had option groups — i.e. almost always.

**Fix.** Drop the `DISTINCT`. It was pointless — the aggregated jsonb includes `id`, so
it could never merge two rows — and the join is 1:N from a single table, so duplicates
are structurally impossible. Without DISTINCT the ORDER BY is legal.
Nothing else changed: option groups still `ORDER BY pog.sort_order`, values still
`ORDER BY pov.sort_order`, all five fields (`id`/`value`/`label`/`sort_order`/
`is_enabled`) are still returned, and the LEFT JOIN still returns groups with no values
(the frontend keeps filtering the null row).

**Runtime verification (production Neon)** — `GET /api/_diag/schema`:

```
optionAggregation: { productId: 62f6bbe4-57f8-4aa9-86b7-fa8157d44098,
                     ok: true, groups: 2, values: 6 }
```

The shipped statement now executes against the live database for the product with the
most option groups (2 groups / 6 values). Unauthenticated calls to the endpoint return
**401** (auth precedes the query), so the endpoint itself was verified at the SQL level,
not through an admin session.

### 2. VelSeller correction notifications

**What already existed — reused, not rebuilt:**

| Piece | Where |
|---|---|
| `notifications` table | `db/schema.sql` |
| `GET /api/customer/notifications`, `PATCH …/:id/read`, `PUT …/read-all` | `backend/routes/chat.ts` — all `requireAuth`, scoped to `req.user!.userId`; mark-read enforces `WHERE id = $1 AND user_id = $2` |
| `needs_correction` writes `seller_verification_needs_correction` with `data = { verificationId, action, reasonCode, reason }` | `backend/routes/verification.ts` (after COMMIT, non-fatal) |
| realtime fan-out primitive | `sendToUser(userId, "", CHANNELS.NOTIFICATION_CREATED, …)` in `chat.ts` / `backend/realtime/index.ts` |
| applicant-visible reason | `correctionReason` + `correctionReasonCode` (`/api/seller/status`), `reviewReasonCode` (`/api/seller/verification`) |
| VelShop had `NotificationBell`; **VelSeller had no notification UI at all** | `apps/velshop/src/components/shop/NotificationBell.tsx` |

**Root cause of “the seller never sees it”:** the notification row was written but
**never pushed**, and VelSeller had no surface to read it. The two halves were missing by
design of the upgrade, not broken code.

**Added:**

1. `backend/routes/verification.ts` — publish the row over the **existing** realtime
   fan-out (`INSERT … RETURNING id` then `sendToUser(targetUserId, "", CHANNELS.NOTIFICATION_CREATED, …)`).
   No new channel, no new socket subsystem, no new table.
2. `packages/shared/src/components/SellerNotificationBell.tsx` (new) — unread badge + panel,
   mark-one-read / mark-all, reason code rendered through the shared `reviewReason.*`
   vocabulary (`reasonCodeKey`), relative time, realtime refresh **plus a 60 s polling
   fallback**, and a deep link.
3. `packages/shared/src/components/AppHeader.tsx` — mounts the bell next to `UserMenu`, so it
   appears on every VelSeller page (`AppHeader` is used only by velseller).
4. `apps/velseller/src/pages/MyShop.tsx` — honours
   `/seller/shop?verification=<id>[&correction=1]` by opening the verification wizard,
   then strips the params from the URL.
5. i18n — `notifications.sellerEmptyDesc`, `notifications.tapToFix` in th/en/my
   (parity 1289 × 3).

**Destination mapping:** verification → `/seller/shop?verification=<verificationId>`
(`&correction=1` for a correction request) · order → `/seller/orders` · chat → `/seller/chat`.
No hard-coded seller/user id — ownership comes from the session cookie server-side. A seller
gated with `sellers.status = 'needs_correction'` also sees the reason on the existing
`RequireRole` gate.

**API added:** none. **DB changed:** none.

### Tests

| Command | Result |
|---|---|
| `cd backend && bun tsc --noEmit` | PASS |
| `bun tsc -p apps/{velseller,velshop,velcenter,velnox}/tsconfig.json --noEmit` | PASS ×4 |
| `bun test backend/tests` | 263 pass / 29 skip / 0 fail |
| `bun run i18n:check` | th = en = my = 1289 |
| `git diff --check` | CLEAN |

New `backend/tests/notification-flow.test.ts` guards: no `json_agg(DISTINCT …, ORDER BY x)`
regression; the route statement and the DB-gated probe statement must stay identical; the
option query keeps its joins/ordering/fields; the bell reuses the single existing
notification API (asserted to have exactly one definition); the list route never takes a
user id from the client; mark-read keeps its ownership clause; the bell maps reason codes
and deep-links; no second notification table/API exists. DB-dependent cases are the usual
`skipIf(!DATABASE_URL)` integration block.

### Production evidence (real data)

```
notifications.byType: [ { velrepeat_order_created: 4 },
                        { seller_verification_needs_correction: 1 } ]
notifications.unread: 5
```

A real, unread `seller_verification_needs_correction` row exists in production, so the
reviewer → notification half is confirmed with live data and the new bell will surface it.

### Remaining

- End-to-end click-through (VelSeller session → badge → reason → wizard) needs a signed-in
  seller; the seller-session render path could not be executed here.
- VelShop keeps its own customer bell: the destinations differ (orders/products vs seller
  flows). Deliberately not merged, to avoid changing velShop behaviour.
- `GET /api/_diag/schema` is still unauthenticated (metadata + aggregate counts only).
  Gate or remove it before launch.

### Commits

`1d3d361` (moderation detail + notification flow) · `eb7c183` (notification count probe).

## UX & Localization Round (2026-09-16)

### V Badge Redesign
**From:** circular green circle with `rounded-full` + `bg-emerald-500`
**To:** rounded rectangle with `rounded-lg` + `bg-emerald-600/90` + `backdrop-blur-sm`

- `VOverlayBadge`: sizes changed from square (`size-6/7/8`) to rectangular (`h-5 w-6.5`, `h-6 w-8`, `h-7 w-9`)
- `SellerOnlyBadge`: `rounded-full` → `rounded-lg`
- Hover: added `hover:scale-105` for interactive feedback
- V letter shape unchanged — only container styling changed

### Category Localization Fix
**Root cause:** VelShop displayed category names in the base language (Thai) regardless of
user-selected locale because:
1. `categoryStatsAction` and `categoryTreeAction` in `api-routes.ts` didn't accept/pass a `lang` query parameter
2. `ShopCategories.tsx` used `name` (base field) instead of `display_name` (COALESCE with lang fallback)
3. `ShopHome.tsx` and `ShopProducts.tsx` used hardcoded `PRODUCT_CATEGORY_META[id].label` instead of database-backed localized names

**Fix:**
- `packages/shared/src/lib/api-routes.ts`: `categoryTreeAction` and `categoryStatsAction` now accept `{ lang?: string }` and pass it as `?lang=` query param
- `apps/velshop/src/pages/ShopCategories.tsx`: Uses `display_name ?? name` from API response, passes `lang` from `useLanguage()`
- `apps/velshop/src/pages/ShopHome.tsx`: Fetches category tree with `lang`, builds `catNameMap` (slug → display_name), uses it for popular category labels
- `apps/velshop/src/pages/ShopProducts.tsx`: Same pattern — localized category names in filter dropdown, SEO titles, and analytics tracking

Backend API (`/api/categories/stats` and `/api/categories/tree`) already supported `?lang=` via
`COALESCE(c.names->>$1, c.name)` — the fix is entirely frontend.

### Files Changed
| File | Change |
|------|--------|
| `packages/shared/src/components/VBadge.tsx` | Circle → rounded rectangle badge |
| `packages/shared/src/lib/api-routes.ts` | category actions accept lang param |
| `apps/velshop/src/pages/ShopCategories.tsx` | Uses `display_name` + lang param |
| `apps/velshop/src/pages/ShopHome.tsx` | Localized category labels via catNameMap |
| `apps/velshop/src/pages/ShopProducts.tsx` | Localized category filter + SEO + tracking |

### VelCenter / VelSeller Responsive Audit
- VelCenter Product Detail dialog: already responsive (`max-h-[92dvh]`, `w-[calc(100vw-1.5rem)]`, `lg:grid-cols-2`, `overflow-y-auto`)
- VelSeller Income.tsx: already has mobile card view (`md:hidden`) + desktop table (`md:block`)
- VelSeller SellerOrders.tsx: already has mobile card view + desktop table
- VelSeller MyShop.tsx: horizontal scroll pattern already present
- No responsive regressions found

### Database
- No DB changes

### Tests
| Check | Result |
|---|---|
| velshop tsc | ✅ |
| velcenter tsc | ✅ |
| velseller tsc | ✅ |
| backend tsc | ✅ |
| i18n:check | ✅ th=1289 en=1289 my=1289 |
| backend tests | ✅ 263 pass / 29 skip / 0 fail |
| git diff --check | ✅ CLEAN |

---

## VelCenter control-plane upgrade (product inspection · staff/customer · audit logs · company settings)

Scope: VelCenter only. **No database change** — every value used already existed
(`audit_logs`, `platform_settings`, `users.role`, `seller_verifications`).

### 1. Product inspection workspace (responsive)
`apps/velcenter/src/components/ProductModerationQueue.tsx`
- Shell is now a **full-screen sheet on phones** (`h-[100dvh] w-full max-w-none rounded-none`) and a **large 6xl dialog on desktop** (`sm:max-w-6xl sm:max-h-[92dvh]`), with a pinned header (name + shop + status) and a pinned action bar; only the body scrolls.
- Gallery stage is height-bounded on every breakpoint (`h-[38dvh] max-h-[420px] sm:h-[420px]`) so a tall photo can no longer stretch the dialog; thumbnails scroll horizontally with snap.
- `optionGroups` were typed in the interface but **never rendered** — they now render (name, display type, required, values) alongside variants (table on desktop, stacked cards on mobile), attributes, inventory, category, seller/shop card and moderation history. Nothing was removed to shrink mobile.
- Approve / reject moved into the pinned action bar (reject keeps its required reason), so the controls are reachable without scrolling on mobile.
- A failed detail load now shows a **real error state with retry** instead of an empty dialog.

### 2. V mark = the letter V
- Removed the `"V ✓"` badge from the shop-group header; VelCenter now renders the shared `VBadge` (`sellerOnly`) which shows the bare letter **V**, matching VelShop.
- Guarded by tests: no `V ✓` anywhere, and the badge markup contains no check icon.

### 3. Staff / Customer split (permissions enforced server-side)
- `GET /api/admin/users` now takes `?segment=staff|customer|seller|all` and resolves the segment from **explicit `users.role` values** — a customer is a customer because the role says so, never "everything that is not staff". Unknown roles return `role: null` instead of being defaulted. It also returns per-segment counts.
- VelCenter's tab is now **ผู้ใช้ & ลูกค้า → [พนักงาน | ลูกค้า]** with count badges, search, real error state + retry, and `isStaff` from the API.
- Employee management (create / reset / permissions) stays **owner-only through the API** (`isOwner`), and now also owner-only in the UI; owner/admin can read the customer directory. Tab visibility widened to owner+admin is UX only — every endpoint re-checks the role.

### 4. Audit logs for staff actions
- New shared writer `backend/lib/audit-log.ts`: sanitizes sensitive keys (password/secret/token/hash/api-key/credential/authorization/cookie → `[redacted]`), records the client IP, and is best-effort so an audit failure never breaks the business transaction. `center.ts` now uses it (its private copy was removed).
- `GET /api/admin/audit-logs` (owner/admin only) now resolves **who** (`actor_name`, `actor_email`, `actor_role`), **what** (`target_label` joined from products/sellers/users/shops/orders), `before`/`after` from the `details` `from`/`to` pair, the `ip_address`, and supports server-side filters `action`, `entityType`, `actorId`, `from`, `to`, `q` plus `limit`/`offset` and a `total` count.
- Missing events were added: `SETTINGS_UPDATE` (with `from`/`to`), `SELLER_VERIFICATION_*` for every reviewer decision (approve/reject/suspend/needs_correction), and `USER_ACCESS_UPDATE` now stores the previous role/department.
- `AuditLogTab.tsx` rewritten: readable Thai action labels (with a prettified fallback — never inventing an event), filters, desktop table + mobile cards, expandable detail, "load more", and an error state with retry instead of a silent empty list.

### 5. Shop Settings → Company / System Settings
- Tab renamed to **ตั้งค่าระบบ** and restructured with a section nav: บริษัท/แพลตฟอร์ม, ตลาด & การอนุมัติ, ค่าธรรมเนียมผู้ขาย, ภาษา & ท้องถิ่น, ไฟล์ & สื่อ, สิทธิ์การเข้าถึง.
- **Contract bug fixed:** `GET /api/admin/settings` returned a flat key→value map while VelCenter read `res.settings`, so the form had **always loaded empty**. The endpoint now returns `{ settings: [{key,value,description,updatedAt,updatedBy}], meta }` and JSON-encoded values are normalised on read (`unwrapSettingValue`, for DBs where the column is JSONB).
- Only **changed** values are written, so the audit trail has no noise from re-saving untouched fields.
- Read-only values come from their real owner, never duplicated: commission (`SELLER_COMMISSION_RATE` / `SELLER_RETURN_COVERAGE` from `backend/lib/seller-stats.ts`), upload limits (`backend/lib/media-config.ts`, now the single source for `MAX_UPLOAD_BYTES` / `ALLOWED_UPLOAD_TYPES` which `routes/upload.ts` imports), and supported languages (shared i18n config).
- Commission is displayed **read-only** on purpose: the payout engine owns it, so the settings UI cannot create a second source of truth for money.
- Sections the backend has no configuration for (Notifications, Security, Customer) were **not** invented.

### Files changed
| File | Change |
|---|---|
| `backend/lib/audit-log.ts` | NEW — shared sanitizing audit writer + client-IP helper |
| `backend/lib/media-config.ts` | NEW — single source for upload limits |
| `backend/routes/center.ts` | segmented `/api/admin/users`, enriched `/api/admin/audit-logs`, uses shared audit writer |
| `backend/routes/admin.ts` | settings payload `{settings, meta}`, JSONB-tolerant read, audited writes |
| `backend/routes/verification.ts` | audits every reviewer decision |
| `backend/routes/upload.ts` | imports limits from `lib/media-config.ts` |
| `packages/shared/src/lib/api-routes.ts` | `buildQuery`; audit-log filters + `segment` passthrough |
| `apps/velcenter/src/pages/Center.tsx` | staff/customer tabs, company settings sections, `canSeeTab("staff")` = owner\|admin |
| `apps/velcenter/src/components/AuditLogTab.tsx` | rewritten |
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | responsive inspection workspace + bare V |
| `backend/tests/center-admin-audit.test.ts` | NEW — 24 regression guards |

### Database
- **No schema change.** `db/schema.sql` and `db/run-sqleditor.sql` are untouched and stay in sync; `db/run-update.sql` was not created, edited or used.

### Tests
| Check | Result |
|---|---|
| backend tsc | ✅ |
| velcenter / velshop / velseller / velnox tsc | ✅ all pass |
| i18n:check | ✅ th=1289 en=1289 my=1289 |
| backend tests | ✅ 287 pass / 29 skip / 0 fail (incl. 24 new) |
| git diff --check | ✅ CLEAN |

### Not verified / remaining
- The 320/375/390/430/768/1024px behaviour is code-inspected (fluid layout, no fixed widths, stacked cards under `md`, pinned bars) but was **not** driven in a real browser from this environment.
- Section-level settings that need new backend configuration (Notifications, Security, Customer/loyalty) are intentionally absent until the backend owns them.

## Audit Logs SQL repair + mobile product inspection (2026-09-16, round 2)

### Root cause — Audit Logs were empty because the endpoint 500'd

Render production log:

```
[center] audit logs error: error: column s.name does not exist
code: 42703
file: backend/routes/center.ts
```

`GET /api/admin/audit-logs` resolved the human-readable target of each entry with

```sql
COALESCE(p.name, s.name, su.name, su.email, sh.name, o.order_number) AS target_label
...
LEFT JOIN sellers s ON al.entity_type = 'seller' AND s.id = al.entity_id
```

`s` is **`sellers`**, and `sellers` has **no `name` column** (verified in `db/schema.sql`:
`sellers(id, user_id, status, verification_status, verified_at, created_at, updated_at)` — the
seller's display name lives on `users.name`, reached through `sellers.user_id`). PostgreSQL
rejects the whole statement with `42703`, so the route returned HTTP 500 for **every** request
and VelCenter could only ever show an empty state. This was never a "no data" problem —
`audit_logs` has rows (see the production probe below).

### Fix — correct table/column, one statement, one source

- The seller label now resolves through real columns: the seller's **shop name**
  (`LEFT JOIN LATERAL (SELECT sh2.name FROM shops sh2 WHERE sh2.seller_id = s.id ORDER BY sh2.created_at LIMIT 1)`)
  then the **owning account name** (`LEFT JOIN users seller_user ON seller_user.id = s.user_id`).
  The LATERAL is `LIMIT 1`, so a seller with several shops cannot duplicate audit rows.
- The statement moved into one exported builder, `auditLogsListSql(whereSql, limitParam, offsetParam)`,
  used by the route **and** by the read-only diagnostics probe, so a probe can never pass while the
  endpoint still fails.
- `_diag/schema` now reports `auditLogs: { ok, totalRows, sampled }` — it executes the exact
  exported statement against live Neon and returns **aggregate counts only** (no actor names,
  emails, IPs or row data).
- VelCenter `AuditLogTab` labels extended for the codes the backend really writes
  (`SELLER_PENDING`, `SELLER_UNDER_REVIEW`, `SELLER_NEEDS_CORRECTION`).

Real action codes in the trail (verified in source, not invented): `product_moderation`,
`product_status_change`, `shop_revoked`, `SELLER_<STATUS>`, `SELLER_VERIFICATION_<ACTION>`,
`SETTINGS_UPDATE`, `USER_ACCESS_UPDATE`, `EMPLOYEE_CREATE`, `EMPLOYEE_ACTIVE_UPDATE`,
`STAFF_PROFILE_UPDATE`, `ORDER_STATUS_UPDATE`.

Permission (unchanged, enforced server-side): `canWriteCenter()` = owner|admin on the endpoint,
and `canSeeTab("audit")` is the same owner|admin check. `audit.view` exists in the permission
catalog for staff assignment but is not yet honored by the endpoint — see Known Limitations.

### Product inspection — phone layout rebuilt

| Before | After |
|---|---|
| gallery stage `38dvh / max 420px` on phones — a tall photo drove the sheet height | `30dvh` with `max-h-60` / `min-h-36` on phones; desktop stage unchanged (`sm:h-[420px] sm:max-h-none`) |
| one long column: gallery → rejection → shop → history → **then** name/price | mobile-first order: gallery → identity (name · V · shop · status · price · category) → rejection → stock → long sections |
| long sections always expanded | `description`, option groups, variants, attributes and moderation history collapse **on phones only**, each showing a count; `lg:block` forces them open on desktop |
| dialog's built-in 16px close button | pinned header with a `size-10` close control; actions fill the row width on phones with `env(safe-area-inset-bottom)` padding |
| desktop two-column grid by DOM order | identical desktop arrangement via explicit `lg:col-start-* / lg:row-start-*` placement |

No data was removed from any breakpoint and the moderation-detail backend query was **not** touched.

### Files changed
| File | Change |
|---|---|
| `backend/routes/center.ts` | `s.name` removed; exported `auditLogsListSql`; route uses it |
| `backend/server.ts` | `_diag/schema` `auditLogs` probe (aggregate-only, exact statement) |
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | mobile inspection layout, compact gallery, collapsible sections, explicit close/actions |
| `apps/velcenter/src/components/AuditLogTab.tsx` | labels for the `SELLER_*` codes actually written |
| `backend/tests/center-admin-audit.test.ts` | guards: no `s.name`, seller label via shop/user, probe == endpoint statement, mobile order/gallery/close assertions |

### Database
- **No schema change.** `db/schema.sql` / `db/run-sqleditor.sql` untouched and still in sync; no migration added; `db/run-update.sql` not created/edited/used.
- **No production rows were modified** — the repair is read-path only (a SELECT that previously raised 42703).

### Tests performed
| Check | Result |
|---|---|
| `backend bun tsc --noEmit` | pass |
| `velcenter / velshop / velseller tsc` | pass |
| `bun run i18n:check` | pass - th=1289 en=1289 my=1289 |
| `bun test backend/tests` | pass - 291 pass / 29 skip / 0 fail (28 in `center-admin-audit.test.ts`, 4 new) |
| `git diff --check` | CLEAN |

### Production verification
- `GET https://velnox-api.onrender.com/api/_diag/schema` returned
  `auditLogs = {"totalRows": 4, "ok": true, "sampled": 4}` one Render deploy after `a94d03b`:
  the exact exported statement (the one the endpoint runs) now executes against live Neon, and
  the trail really does contain rows — so the empty VelCenter tab was the 500, not missing data.
- The `/api/admin/audit-logs` route itself needs an owner/admin session, which this environment does
  not have; the probe runs the **identical** statement, and `backend/tests/center-admin-audit.test.ts`
  fails if the route stops using that builder.
- VelCenter Audit Logs then renders real rows through `GET /api/admin/audit-logs`; a failed request still shows the error + retry state, never "no records".

### Known Limitations
- **Resolved (2026-09-18):** `GET /api/admin/audit-logs` is now permission-checked, so a staff member the owner granted `audit.view` can open Audit Logs — see the "VelCenter Final Gap Fix" round below.
- Phone/tablet behaviour (320/360/375/390/430/768px) is code-verified (fluid order, bounded gallery, collapsibles, width-filling actions) but not driven in a real browser from this environment.


## Password Auth + Auto-Refresh + Variant Images + Mobile Nav Removal (2026-09-17)

### What was done

**1. Password-based login for VelCenter staff**
- Added `password_hash TEXT` column to `users` table (both `db/schema.sql` and `db/run-sqleditor.sql` synced, identical structure).
- Backend password hashing utility: `backend/lib/password.ts` using Node.js built-in `crypto.scrypt` (no external deps). Format: `$scrypt$N$r$p$salt$hash`. Timing-safe verification.
- `POST /api/auth/member-login` — accepts `identifier` (email or employee_id) + `password`. Validates: account active, role is owner/admin/staff, password hash exists, password matches. Returns JWT session cookie.
- `POST /api/auth/change-password` — authenticated staff can change own password.
- `POST /api/admin/employees` — now accepts `password` field, hashes server-side, stores in `password_hash`. Returns plain password once to admin (shown in dialog, never logged).
- `POST /api/admin/employees/:userId/reset-password` — now works (generates new hash, stores it).
- Employee list endpoint now exposes `passwordAuth: true/false` based on whether `password_hash` is set.

**2. Auto-refresh / Realtime across VelCenter**
- Center.tsx WebSocket subscriptions expanded: `product:updated`, `seller:updated`, `notification:created`, `order:updated`.
- `product:moderated` / `product:updated` → reloads product moderation list.
- `seller:status-changed` / `verification:status-changed` → reloads seller + verification lists.
- Backend broadcast calls added:
  - `verification.ts`: `broadcast(CHANNELS.SELLER_UPDATED, "seller:status-changed", ...)` after every verification action.
  - `center.ts`: `broadcast(CHANNELS.NOTIFICATION_CREATED, ...)` after employee create/update/profile change.
- Existing `product:updated` broadcast in product moderation was already in place.

**3. Variant images in Product Inspection**
- Backend moderation-detail endpoint already fetches `product_variant_images` per variant.
- `VariantList` component now renders:
  - Desktop: image column with stacked thumbnails (+overflow count).
  - Mobile: first variant image as card thumbnail, or "ไม่มีรูป" fallback.
- No fake/fallback images — empty state is honest.

**4. Mobile bottom navigation removed from VelCenter**
- Removed `MobileTabBar` import and `<MobileTabBar items={mobileTabs} />` from Center.tsx.
- Removed `mobileTabs` array definition.
- VelCenter now uses only the top tab strip on all breakpoints.

**5. Auth page — Member ID login form**
- Shared `Auth.tsx` detects `currentSite() === "velcenter"` and shows "เข้าสู่ระบบด้วย Member ID" toggle below the Google button.
- Toggles to a form with: Email/Member ID input, password input, submit button, cancel link.
- Calls `POST /api/auth/member-login`, sets session cookie, reloads page.

**6. EmployeeManager — password field**
- Create employee form now includes "รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" password input.
- Password is sent to backend, hashed server-side, never stored in plaintext.
- Admin sees the password once in a dialog after creation (existing `tempCredential` flow).

### Files changed
| File | Change |
|---|---|
| `db/schema.sql` | Added `password_hash TEXT` to users table |
| `db/run-sqleditor.sql` | Same (synchronized) |
| `backend/lib/password.ts` | NEW — scrypt hashing utility |
| `backend/routes/auth.ts` | `POST /api/auth/member-login` + `POST /api/auth/change-password` |
| `backend/routes/center.ts` | Employee creation accepts password, reset-password works, broadcasts added |
| `backend/routes/verification.ts` | Broadcast after verification action |
| `packages/shared/src/lib/api-routes.ts` | `api.auth.memberLogin` + `api.auth.changePassword` |
| `packages/shared/src/pages/Auth.tsx` | Member ID login form for VelCenter |
| `apps/velcenter/src/pages/Center.tsx` | WebSocket expanded, mobile nav removed |
| `apps/velcenter/src/components/EmployeeManager.tsx` | Password field in create form |
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | Variant images in desktop table + mobile cards |

### Database
- **Schema change:** Added `password_hash TEXT` to `users` table. Existing Google OAuth users have NULL (no password). Password-auth users have a `$scrypt$...` hash.
- Both `db/schema.sql` and `db/run-sqleditor.sql` updated and synchronized.

### Security
- Passwords hashed with scrypt (N=16384, r=8, p=1) + timing-safe comparison.
- No plaintext passwords stored, logged, or returned in API responses (except once to admin at creation time).
- Member login validates: active status, center role, password hash existence, password match.
- Self-role-change and self-permission-escalation not possible — endpoints enforce ownership server-side.

### Tests
| Check | Result |
|---|---|
| backend tsc | pass |
| velcenter/velshop/velseller tsc | pass |
| i18n:check | pass (th=1289 en=1289 my=1289) |
| backend tests | 291 pass / 29 skip / 0 fail |
| git diff --check | CLEAN |

### Commit
- `4cbf702` — feat(velcenter): password auth, auto-refresh, variant images, mobile nav removal
- Pushed, local == remote.

### Known Limitations
- Password reset for self-service (forgot password flow) is not implemented — admin must reset via EmployeeManager.
- The `change-password` flow requires knowing the current password — no forgot-password email flow.
- WebSocket auth in the existing realtime layer uses the same JWT cookie, so password-auth sessions work automatically.
- RBAC: `backend/lib/permissions.ts` now resolves the permission catalog server-side (owner/admin hold every code, `staff` hold what was granted) and the audit trail honours `audit.view`; see the "VelCenter Final Gap Fix" round below. Owner/admin still short-circuit through the existing role helpers for the surfaces that are owner-only by design.

---

## VelCenter Final Gap Fix / Verification (2026-09-18)

Final-gap round on top of the previous session. Nothing was rewritten; every item
below reuses what already existed.

### 1. The permission catalog became the single source of truth

**Root cause:** the catalog lived inline in `backend/routes/center.ts` as a constant
that only the *grant* UI could read, while the guards decided with role helpers
(`canWriteCenter`, `isOwner`). A `staff` member granted `audit.view` therefore could
never open Audit Logs, and the role helper treated "is a admin" as "may read the trail".

- **NEW `backend/lib/permissions.ts`** — `PERMISSION_CATALOG` (the same 9 codes, now the
  only copy), `ALL_PERMISSION_CODES`, `resolvePermissions(userId, role?)`,
  `userHasPermission(userId, code, role?)`. `owner`/`admin` implicitly hold every code;
  `staff` hold exactly `employees.permissions`; anyone else (customer, seller) holds none.
- `backend/routes/center.ts` imports it instead of declaring its own copy — the tab a
  user is offered and the endpoint behind it can no longer disagree.
- `GET /api/admin/audit-logs` is now guarded by `userHasPermission(…, 'audit.view')`
  instead of `canWriteCenter()`. That is the real boundary; hiding the tab is UX only.

### 2. The force-password-change gate was dead code

**Root cause:** the column did not exist, `/api/auth/me` never returned the flag, and
`change-password` demanded the *current* password — which a first-login employee
being handed a temporary password does not have.

- `users.must_change_password BOOLEAN NOT NULL DEFAULT FALSE` (schema + bootstrap +
  migration 046). The `FALSE` default means no backfill and existing staff unaffected.
- `POST /api/admin/employees` creates staff with the flag TRUE; the owner's reset also
  sets it TRUE, so a handed-over temporary password must be replaced.
- `POST /api/auth/change-password` skips the current-password proof **only** while the
  flag is set, then clears the flag, invalidates the cached profile and writes an audit
  row. Any other change still has to prove the old password.
- `/api/auth/me` now returns `department`, `mustChangePassword` and `permissions`;
  `packages/shared/src/lib/api-client.ts` maps them (it previously mapped neither the
  flag nor department, which is why the gate never ran).
- `ChangePasswordScreen` calls `refetchCurrentUser()` after a successful change — the
  shared auth state is a cached singleton, so without it the employee stayed stuck.

### 3. Realtime → UI (a subscription alone is not a fix)

**Root cause:** the Center page owned the WebSocket and refreshed *its own* state, but
`ProductModerationQueue`, `SellerVerificationQueue` and `AuditLogTab` load their own
data and were never notified — and no audit event existed at all.

- `backend/lib/audit-log.ts` broadcasts a new `audit:created` channel from
  `writeAuditLog`, the single choke point every audit writer goes through, so no route
  can write a row silently. The payload carries `action` + `entityType` only — no
  details, credentials, tokens or hashes.
- `backend/realtime/index.ts` registers `AUDIT_CREATED` and allows subscription.
- **NEW `apps/velcenter/src/lib/center-events.ts`** — a small app-local bus. The Center
  page's WS handler fans one message out to the tabs (`products` · `sellers` ·
  `orders` · `audit`); each consumer refetches from the API, so the event is only a
  signal and the data still comes from the backend.
- event → receiver → refetch → UI, verified per tab: `ProductModerationQueue`
  (`products`), `SellerVerificationQueue` (`sellers`), Orders tab (`orders`),
  `AuditLogTab` (`audit`). Approve/reject additionally reloads as soon as the backend
  confirms, so the pending count drops without waiting for a socket round trip.

### 4. Errors must not render as "no data"

- The Orders tab swallowed a failed request into an empty list; it now has an explicit
  error card with a retry button.
- `AuditLogTab` returns `null` (not an empty table, and not a guaranteed 403 fetch)
  when `audit.view` is absent — and it does so *after* all hooks, so the hook count
  stays stable while the shared auth state is still loading.

### Files changed

| File | Change |
|---|---|
| `backend/lib/permissions.ts` | **NEW** — the permission catalog + resolvers |
| `backend/routes/center.ts` | catalog imported; audit endpoint permission-checked; profile-cache invalidation on role / department / permission / password changes; real `mustChangePassword` in the staff list |
| `backend/routes/auth.ts` | `/me` returns `department` + `mustChangePassword` + `permissions`; forced first password change |
| `backend/lib/audit-log.ts` | broadcasts `audit:created` |
| `backend/realtime/index.ts` | `AUDIT_CREATED` channel |
| `packages/shared/src/lib/api-client.ts` | `ApiUser.permissions`, `userHasPermission()`, `mustChangePassword` mapping |
| `apps/velcenter/src/lib/center-events.ts` | **NEW** — WS → tab event bus |
| `apps/velcenter/src/pages/Center.tsx` | permission-aware `canSee()`, audit subscription, event fan-out, orders error state |
| `apps/velcenter/src/components/AuditLogTab.tsx` | self-gates on `audit.view`, listens for `audit` events |
| `apps/velcenter/src/components/ProductModerationQueue.tsx` | listens for `products` events |
| `apps/velcenter/src/components/SellerVerificationQueue.tsx` | listens for `sellers` events |
| `apps/velcenter/src/components/ChangePasswordScreen.tsx` | refetches the profile so the gate unmounts |
| `db/schema.sql`, `db/run-sqleditor.sql` | `users.must_change_password` (byte-identical) |
| `db/migrations/046_staff_must_change_password.sql` | **NEW** |
| `backend/tests/staff-must-change-password.test.ts` | **NEW** |
| `backend/tests/center-admin-audit.test.ts` | audit endpoint asserted permission-checked |

### Database

- `users.must_change_password BOOLEAN NOT NULL DEFAULT FALSE` — three places, in sync:
  `db/schema.sql`, `db/run-sqleditor.sql` (asserted byte-identical) and migration 046.
  `db/run-update.sql` was **not** created, edited or used.
- **No production data was modified.** No staff was created, no password was reset, no
  product / seller / order status was mass-changed.

### Security notes

- Passwords stay scrypt-only (`backend/lib/password.ts`); never logged, returned or
  audited. `writeAuditLog` strips any `password|token|secret|hash|credential|cookie`
  key at write time, and a test asserts the payload never carries credentials.
- Self-escalation stays blocked server-side: role and department are read from the
  `users` row and permissions from `employees.permissions` — never from the request
  body. `PATCH /api/admin/users/:id/access` remains owner-only.

### Tests performed

| Check | Result |
|---|---|
| `cd backend && bun tsc --noEmit` | 0 errors |
| `bun tsc --noEmit` in velcenter / velshop / velseller / velnox | 0 errors (all four) |
| `bun test ./tests/staff-must-change-password.test.ts ./tests/center-admin-audit.test.ts` | **55 pass / 0 fail** |
| `bun test ./tests/schema-drift.test.ts` | **50 pass / 0 fail** |
| `bun test tests` (whole suite) | 337 pass / **11 fail** — every failure is a DB-touching `(integration)` suite (below); none is in a file this diff touches |
| `bun run i18n:check` | PASS — th=1289 en=1289 my=1289 |
| `git diff --check` | CLEAN |
| `diff db/schema.sql db/run-sqleditor.sql` | identical |

**The 11 integration failures are environmental, not regressions.**
`tests/order-detail-reviews.test.ts`, `tests/inventory-race.test.ts`,
`tests/seller-center-apis.test.ts` and `tests/velrepeat-core.test.ts` seed fixed fixture
emails with a plain `INSERT INTO users (email, name)` and no cleanup, so a second run
against the same Neon database dies on
`23505 duplicate key value violates unique constraint "users_email_key" (review-a@test.local)`
or times out. The failing files are untouched by this diff (auth / permissions / audit /
VelCenter UI only). Those fixtures are the only writes these tests make to shared data —
non-idempotent seeding is a separate test-hygiene defect worth fixing.

### Not verified (no browser, no live session from this environment)

- Member ID + password sign-in against a real seeded account, and the forced first-login
  password change end-to-end in a browser.
- The `audit:created` broadcast arriving in a deployed browser (the channel allowlist and
  the writer are code-verified; a deployed socket was not driven).
- Phone/tablet rendering of the inspection workspace at 320–430px.
