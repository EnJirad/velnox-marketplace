# Velnox AI Handoff — current state

**Last updated:** 2026-09-25 · **Branch:** `main` · **Latest pass:** startup-sync rule + root AI files removed (§12)
**Canonical location:** `.ai/AI_HANDOFF.md` — the root `AI_Handoff.md` is a pointer. **Workspace:** `.ai/README.md`

> **Keep this file small.** This environment's file-edit tools stop matching past
> roughly **55 KB** in a file, so a handoff that grows past that can no longer be
> edited in place. New work is appended at the bottom; if this file approaches
> ~40 KB, move the oldest dated section to the archive instead of growing it.
>
> - History index → [`.ai/history/AI_Handoff_Archive.md`](./history/AI_Handoff_Archive.md)
> - Full verbatim records → [`.ai/history/archive/`](./history/archive/)

---

## 1. What Velnox is

Multi-vendor marketplace. Four Vercel frontends → one Render backend (Express +
WebSocket) → Neon PostgreSQL (source of truth) + Cloudflare R2 (file storage).

| Piece | Path | Role |
|---|---|---|
| velShop | `apps/velshop` | customer storefront, cart, checkout, VelRepeat |
| velSeller | `apps/velseller` | seller workspace (products, orders, income, goals) |
| velCenter | `apps/velcenter` | staff / company operations console |
| velNox | `apps/velnox` | corporate site |
| API | `backend` | Express + `ws`; the only thing that talks to Neon |
| Shared | `packages/shared` | UI kit, i18n, api client, `api-routes.ts` |
| DB | `db/schema.sql`, `db/run-sqleditor.sql` | canonical, must stay structurally byte-identical |

- **Auth:** Google OAuth + JWT in the `velnox_session` httpOnly cookie, plus
  member-ID/password login for VelCenter staff (scrypt, `backend/lib/password.ts`).
- **Languages:** `th` (source of truth for the key shape), `en`, `my`. Parity is
  enforced by `bun run i18n:check`.
- **Source of truth chain:** Neon → backend API → frontend. Frontends never touch
  Neon and never hold server secrets.
- `db/run-update.sql` is **deprecated** — never create, edit or reference it.
- Schema changes update **both** `db/schema.sql` and `db/run-sqleditor.sql`.

## 2. Verification — exactly ONE system

Velnox has one verification system: **SELLER / SHOP identity verification**. There
is no product verification.

### The V rule

```
seller.verification_status = 'verified'
        ↓
EVERY product owned by that seller
        ↓
the single green V badge
```

No `products.is_v`, no per-product verification state. `verified` is the canonical
value (the brief's "approved" maps to it). `sellers.status` (`approved`) is the
**account** lifecycle; `sellers.verification_status` (`verified`) is the **trust
badge** — deliberately different columns. The V means only "this shop passed
Velnox identity verification" — not product quality, authenticity or warranty.
`VBadge` resolves V from the seller alone; the catalog exposes
`sellerVerificationStatus` via an `EXISTS (SELECT 1 FROM sellers …)` subquery (no
N+1).

### Lifecycle

```
Seller (VelSeller)
  RequireRole onboarding: Store → Applicant → Identity documents → Review → Submit
        │  (each document: presign → R2 PUT → evidence confirm → media row in Neon)
        ↓
  seller_verifications row (status=pending) + sellers.verification_status='pending'
        ↓
VelCenter
  Sellers → การยืนยันร้านค้า (Verification) tab → All/Pending/Verified/Rejected/Suspended + search
        ↓
  VerificationReviewDialog (applicant · store · address · signed docs · checklist · history)
        ↓
  Approve | Request correction | Reject | Suspend   (reason code REQUIRED unless approving)
        ↓
  notification → applicant sees reason → edit & resubmit → pending again
```

`sellers.status` state machine (enforced in `backend/routes/seller.ts`):

```
pending          → under_review, rejected
under_review     → approved, needs_correction, rejected, suspended
needs_correction → under_review, rejected
approved         → suspended
rejected         → pending      (re-application)
suspended        → pending      (re-activation)
```

Anything else → `400 INVALID_TRANSITION`. Self-approval → `403
SELF_ACTION_FORBIDDEN`. Approval requires a persisted verification record with at
least one evidence file.

### Submission integrity (hard rule)

`NO SUCCESSFUL EVIDENCE PERSISTENCE = NO PENDING VERIFICATION`

`POST /api/seller/apply` runs in ONE transaction: validate auth → validate seller
ownership → validate required fields → validate the three identity documents exist
as `media` rows owned by the caller → upsert shop → upsert `seller_settings`
(durable R2 **object keys**, never `File` objects or blob URLs) → upsert
`seller_verifications` (pending, with evidence) → **then** set
`sellers.verification_status='pending'` → append `seller_review_history` →
`COMMIT`. Any failure rolls everything back; nothing shows "pending" that the
backend did not persist.

### Structured review reasons

Canonical vocabulary: `packages/shared/src/lib/verification-reasons.ts` (mirrored
in the backend; `backend/tests/product-lifecycle.test.ts` asserts parity). Codes:
`id_card_unclear`, `id_card_incomplete`, `selfie_unclear`, `selfie_missing_id`,
`document_expired`, `applicant_mismatch`, `store_incomplete`, `contact_incomplete`,
`address_incomplete`, `duplicate_account`, `policy_violation`, `other`.

Corrections / rejections / suspensions require a valid code or the backend returns
`400 REASON_REQUIRED`. Internal reviewer notes live in `review_note` and are never
shown to the applicant; the applicant-visible reason is stored in
`seller_settings.{rejectionReason,correctionReason}` plus the matching
`…ReasonCode`.

### Review history

`seller_review_history` (seller_id, application_id, previous_status, new_status,
action, reason_code, reason, note, reviewer_id, created_at). Actions: `submitted`
| `resubmitted` | `under_review` | `needs_correction` | `approved` | `rejected` |
`suspended`. Written on every applicant submission and every reviewer decision.

### Identity evidence security

- Identity documents are never returned as public bucket URLs.
  - `GET /api/admin/verifications/seller/:id/evidence` and
    `GET /api/admin/sellers/:id/application` require `owner|admin|staff` and return
    **5-minute signed R2 GET URLs** generated server-side.
  - `GET /api/seller/evidence` signs URLs for the caller's own uploads only.
  - `GET /api/shops/:shopId/verification` is public and returns status +
    `verifiedAt` only.
- The applicant's own status payload exposes only an evidence **count**.
- The admin list strips `evidence_urls`.
- Ownership is enforced twice: `verification/evidence/{owner}/…` keys must match
  the caller, and every submitted key must exist as a `media` row with
  `uploaded_by = <caller>`.

### Self-action guard (reviewer ≠ applicant)

A VelCenter reviewer (`owner|admin|staff` with `sellers.manage`) may also own a
shop, and `PATCH /api/admin/verifications/seller/:id` with `approve` is the ONLY
write in the backend that sets `sellers.verification_status = 'verified'` — i.e.
the only way to earn the V. That decision is therefore refused when the reviewer
IS the applicant: `403 SELF_ACTION_FORBIDDEN`, rolled back before any write.

- Rule: `backend/lib/verification-guard.ts` → `isSelfApproval(action, actorUserId,
  sellerUserId)`. Pure and action-aware; ids are string-compared so a driver type
  change cannot silently disable it.
- Scope: **only `approve`**. `reject` / `suspend` / `needs_correction` can only
  lower the reviewer's own standing, so they stay allowed. The seller-application
  route (`PATCH /api/admin/seller-applications/:id`) keeps its own broader
  self-action check for `approved` / `rejected`.
- Ownership is resolved from the DB (`SELECT s.user_id FROM sellers s WHERE s.id
  = $1`), never from the request body; the actor id is always the session's.
- Tests: `backend/tests/verification-self-approval.test.ts` — 13 always-on cases
  (the rule exhaustively, wiring contracts that the guard runs BEFORE the status
  write, and an HTTP round trip proving the harness reaches the real route) plus
  2 DB-gated cases that drive `PATCH` for real: the owner gets 403 with nothing
  written, and a different reviewer gets 200 on the same record — the negative
  control that stops a broken fixture from passing as a fix. The DB cases need
  `DATABASE_URL` + `JWT_SECRET`, and the database must be bootstrapped with
  `db/run-sqleditor.sql` first.

### Verification API surface

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/seller/verification` | seller | own status (count only, no URLs) |
| POST | `/api/seller/verification` | seller | submit / resubmit (evidence required) |
| POST | `/api/seller/apply` | user | seller application (3 identity docs required) |
| GET | `/api/seller/status` | user | status + reasons + history |
| POST | `/api/seller/evidence/upload-intent` | user | presigned PUT (onboarding-safe) |
| POST | `/api/seller/evidence/confirm` | user | persist media row |
| GET | `/api/seller/evidence` | user | own evidence (signed URLs) |
| GET | `/api/admin/verifications?status=&q=&page=&limit=` | reviewer | seller queue (`all` supported; paginated, `pagination.total` is exact) |
| GET | `/api/admin/verifications/seller/:id/evidence` | reviewer | signed evidence |
| GET | `/api/admin/verifications/seller/:id/history` | reviewer | review history |
| PATCH | `/api/admin/verifications/seller/:id` | reviewer | approve/reject/suspend/needs_correction (self-approval → 403) |
| GET | `/api/admin/sellers?status=&q=` | reviewer | seller list (search + filter) |
| GET | `/api/admin/sellers/:id/application` | reviewer | full application + signed docs |
| PATCH | `/api/admin/sellers/:id/status` | owner/admin | account lifecycle status |
| GET | `/api/shops/:shopId/verification` | public | status only |

## 3. Realtime

One WebSocket per client at `/ws`. **Events are signals, never data** — every
consumer refetches from the API. No `setTimeout` fake-realtime anywhere.

Socket rules: authenticated by the session cookie at upgrade; revoked tokens are
swept every 30 s and closed with `4001`; a client may subscribe only to its own
`user:{id}` channel or to the public allowlist; frames >4 KB close the socket, and
>120 frames / 10 s closes with `1008`.

| Channel | Published by | Consumed by |
|---|---|---|
| `product:updated` | `products.ts` (`product:moderated`) | moderation queue · audit |
| `seller:updated` | `verification.ts` (`seller:status-changed`) | verification queue · seller list · audit |
| `order:updated` | `center.ts` · `cart.ts` · `seller-orders.ts` · `stripe.ts` | orders tab (via `orders` event) |
| `audit:created` | `lib/audit-log.ts` — the single choke point every audit writer goes through | audit tab |
| `config:updated` | `server.ts` — one scoped choke point for `/api/admin/categories[/…]` and `PATCH /api/admin/settings`, 2xx only | categories tree · settings form |
| `notification:created` | `center.ts` (employee create/update) · `verification.ts` / `chat.ts` (via `sendToUser`) | roster · directory · the user's own bell |

VelCenter fans one socket message out through
`apps/velcenter/src/lib/center-events.ts` (`products` · `sellers` · `orders` ·
`staff` · `audit` · `config`); each tab then re-reads from the API.

## 4. VelCenter authorization

One catalog, `backend/lib/permissions.ts` — `owner`/`admin` implicitly hold every
code, `staff` hold exactly `employees.permissions`, anyone else holds none.
`resolvePermissions()` is **deny-by-default** (missing row, malformed JSON or a DB
error returns `[]`, never throws).

| Code | Surface |
|---|---|
| `orders.view` | orders list |
| `orders.manage` | order status |
| `products.moderate` | product moderation — list · detail · decision |
| `sellers.manage` | seller administration + verification decisions |
| `users.manage` | customer / staff directory |
| `staff.manage` | employee roster (read-only for non-owners) |
| `audit.view` | audit logs |
| `settings.manage` | company / system settings (read + write) |

A code belongs in the catalog **only while an endpoint checks it** —
`center-rbac.test.ts` asserts that. Role / permission / employee mutations stay
owner-only. Hiding a tab is UX only; every endpoint re-checks.

## 5. Latest passes

### 2026-09-22 — two superseded passes

**Archived** (closed records, both pushed at the time) →
[`history/archive/AI_Handoff-2026-09-22-readiness-passes.md`](history/archive/AI_Handoff-2026-09-22-readiness-passes.md).
Moved 2026-09-25 to keep this file under the ~55 KB edit limit. Covers the
`/_diag` prefix guard, seller-verification queue pagination, the 029/030/034/035
migration-numbering proof, honest overview counters, the dead route mappings removed
from `api-routes.ts`, `order:updated` from every status writer, and `config:updated`.

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

## 6. Remaining gaps / open items

### Open, actionable

- ~~**The 35 DB-gated tests have never been executed in this workspace.**~~
  **CLOSED** — all 35 now run against a disposable Postgres (`452 pass /
  0 fail / 0 skip`, twice consecutively), including the two self-approval HTTP
  cases: the 403 was observed with nothing written, plus the 200 negative
  control. **Production Neon is now verified read-only — see §9:** the ledger
  matches `main` exactly and the 041–046 repairs are recorded as applied. What
  remains is a fresh catalog read of four low-severity details (§9.4); the
  SELECT-only `diag-neon-schema.yml` still cannot be dispatched from a
  workspace (403).
- **`backend/tsconfig.json` excludes `tests`**, so `tsc` never validates test
  files — a syntax error or a bad import in a test surfaces only when `bun test`
  parses it. After editing a test, run that file; a green `bun run typecheck`
  says nothing about it.

- ~~**`PATCH /api/admin/verifications/seller/:id` has no self-action guard.**~~
  **CLOSED.** The approval path now refuses a reviewer who owns the shop under
  review (`403 SELF_ACTION_FORBIDDEN` + `ROLLBACK`, before any write). The rule
  lives in `backend/lib/verification-guard.ts` (`isSelfApproval`) so it is a pure,
  exhaustively testable function, and `isSelfApproval` is the ONLY gate on the
  one write that sets `sellers.verification_status = 'verified'`. Covered by
  `backend/tests/verification-self-approval.test.ts` — the last two of its 12
  cases are the interesting ones: the guard must run *before* the status write,
  and no route may grant the badge with a literal `SET verification_status =
  'verified'`.
- ~~**`GET /api/admin/verifications` is unpaginated** (`LIMIT 200`).~~ **CLOSED**
  — see §5 (b) 2. It returns `pagination` ({page, limit, total, totalPages,
  hasMore}) and the queue has previous/next controls; `limit=1` is the exact-count
  read.
- **`GET /api/admin/products/moderation` is fully unbounded** (no `LIMIT` at all)
  and `ProductModerationQueue.tsx` renders the whole result client-side, so the
  moderation tab will grow without bound. **BLOCKED by tooling:** the handler is
  `backend/routes/products.ts:3456`, a 181 KB file this environment's edit tools
  cannot match past ~55 KB — the same limit that pushed the `config:updated`
  publish into `server.ts`. Next step: apply the `backend/lib/pagination.ts`
  helpers to that handler (and add controls to the queue) from a checkout without
  the size limit.
- **`GET /api/admin/sellers` is unbounded too** (`backend/routes/seller.ts:715`).
  Its only consumer is the overview counter in `Center.tsx`, so nothing is broken
  today, but it loads every seller (with joins) to count them. Paginating it
  changes the payload from a bare array (`data: [...]`) to an object, and the
  shared `apiGet` unwraps `data` — so it needs a consumer-side change in the same
  commit. Left as-is deliberately rather than half-done.
- **`shops.seller_id` is not UNIQUE** (`idx_shops_seller` is a plain index), so a
  seller with two shops would make the verification queue list one verification
  twice — and `COUNT(*) OVER()` would count it twice, consistently. The app
  upserts a single shop per seller, so this is latent, not observed. A `COUNT(DISTINCT
  sv.id)` + de-duplicated listing is the fix if multi-shop sellers ever exist.
- **VelCenter's verification queue labels are hardcoded Thai**, while the review
  dialog next to it (`VerificationReviewDialog.tsx`, 34 `t()` keys) is localized.
  Translating the queue is **BLOCKED by tooling**: those keys belong in
  `review.*`, defined in `packages/shared/src/lib/i18n/locales/index.ts`
  (`thReview` byte 57,892 / `enReview` 61,929 / `myReview` 64,284) and in
  `th.ts` (104 KB) / `my.ts` (98 KB) — every one of them past the ~55 KB match
  window, so the keys cannot be added here without breaking locale parity.
  Next step: extract the queue's strings to `review.*` with `i18n:check` run in a
  checkout that can edit those files.
- ~~**The DB constraint repairs must reach the deployed database.**~~ **CLOSED
  (2026-09-23):** production applied 043 (`under_review` / `needs_correction` on
  `sellers.status`) at 2026-09-16T14:41:27Z and 044 (`item_unavailable` on both
  `velrepeat_plans.status` and `velrepeat_runs.status`) at 14:43:58Z — both
  recorded in the production ledger and both observable in the runner log; 045
  restored the canonical `media` column names in the same window. See §9.
- **Migration numbering has duplicates** (029, 030, 034, 035). A prefix-keyed
  runner applied only one file per number, which is exactly how the V0035 repair
  was skipped. New migrations must use an unused number; consider renumbering.
- ~~**Non-idempotent integration fixtures.**~~ **CLOSED** (2026-09-23):
  unique per-seed emails/tags everywhere, FK-ordered cleanup via
  `backend/tests/helpers/purge.ts`, and two consecutive full runs on the same
  database are green — `23505 … users_email_key` and the `23503` teardown
  failures are gone.
- **Channels with no publisher.** `cart:updated`, `order:created` and
  `inventory:updated` are in the subscribe allowlist but nothing broadcasts them.
  Harmless today (no consumer subscribes), but they are dead entries.

### Known-accepted (deliberate, not to "fix" casually)

- **Legacy DB objects retained on purpose:** `product_verifications`,
  `products.verification_status`, `products.verified_at`. Deprecated and
  unwritten; drop only after confirming no historical rows matter.
- **Legacy i18n strings remain:** unused `productVerification*` keys in
  `th.ts`/`en.ts`/`my.ts`. Removing them from only some locales would break
  `i18n:check` parity, so leave them until those large files can be rewritten
  wholesale.
- **Evidence signed URLs expire after 5 minutes.** A reviewer who leaves the dialog
  open longer must reopen it; the dialog says so.

### Verification gaps (not defects)

- **No live browser E2E has ever been run from this environment.** Responsive
  behaviour at 320–430 px, the object-URL image preview, the R2
  presign→PUT→confirm round trip and the WebSocket round trips rest on source
  inspection plus contract tests.
- **The presign → PUT → confirm round trip is still not executed against
  production** (no safe production test account exists in this workspace).
  What IS now production-verified (TASK 002, 2026-09-23 — archived under
  `history/archive/AI_Handoff-2026-09-23-r2-media-verification.md`): R2 configured + bucket
  reachable via `GET /api/health/r2`, `R2_PUBLIC_DOMAIN` serving real objects
  (200 `image/jpeg`, missing key → 404), and the 401 auth boundary on all four
  upload endpoints. What remains source-only: the authenticated upload, the
  media row it would create, the failed-upload path, the 10 MB boundary,
  replace/delete, and the browser-side preview.

### Environment constraints (tooling, not product bugs)

- **Files above ~55 KB cannot be edited in place.** Matching stops past that
  offset, so `backend/routes/products.ts` (3,856 lines) cannot be changed by the
  edit tools at all — a change there currently has to be made another way (that is
  why the `config:updated` publish lives in `server.ts` rather than in each
  category handler).
- **Very large docs are read-only in practice.**
  `.ai/history/archive/AI_Handoff-2026-09-14.md` (~335 KB) and
  `…-2026-09-22-full.md` (~97 KB) are verbatim records — read them with windows,
  never as a whole file.

## 7. Where to look next

```
AGENTS.md → .ai/AI_RULES.md → .ai/context/project-map.md → .ai/context/<subsystem>.md → source
```

Subsystem docs (all under `.ai/context/`): `architecture`, `database`, `backend`,
`frontend`, `realtime`, `security`, `products`, `categories`, `seller`,
`customer`, `checkout`, `media`, `project-map`, `testing`, `workflow`,
`troubleshooting`. The repository is always authoritative over any document,
including this one.

## 8. Agent workspace moved to `.ai/` (2026-09-23)

**Archived** (closed structural record) →
[`history/archive/AI_Handoff-2026-09-23-ai-workspace-move.md`](history/archive/AI_Handoff-2026-09-23-ai-workspace-move.md).
Moved 2026-09-25. The layout it describes **is** the current state; the live
conventions are in `AGENTS.md` and `.ai/README.md`.

---

## 9. Production Neon — read-only verification (TASK 001, 2026-09-23)

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing
was connected to from this workspace (no database credentials are readable here,
by platform design). Every fact below is the **production database's own
response**, captured from the production migration runner (`migrate-neon.yml`,
secret `NEON_DATABASE_URL` — documented as the production DB in
`context/database.md`) — not a filename check, not a local/test database.

**Closed evidence (method, migration ledger, verified-object table) archived** →
[`history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md).
Moved 2026-09-25 to keep this file small. Headline result: the production
`schema_migrations` ledger matched `db/migrations/*.sql` **exactly** (49 rows /
49 files, none missing or orphaned), captured from `migrate-neon.yml` logs — no
credential was ever read or printed, and nothing was written.

### 9.4 Still NOT VERIFIED (needs a fresh catalog read)

1. `notifications.user_id` nullability — canonical is `NOT NULL`, no migration
   loosens it, and all four writers pass a recipient.
2. The canonical index **names** `idx_notifications_user` / `idx_notifications_read`
   — no migration creates them (only the bootstrap files do); the proven
   functional equivalents are `idx_notifications_user_id` + `idx_notifications_unread`.
3. `shops.idx_shops_seller` — present only in the bootstrap files and absent from
   every run log. Low/latent: a plain index, relevant only if a seller ever gets
   two shops.
4. The full `audit_logs` column list and its FK to `users` — the app writes 6 of
   the 7 canonical columns and has been served in production.

### 9.5 Next action

Run `.github/workflows/diag-neon-schema.yml` from **Actions → Velnox Neon Schema
Diagnostic → Run workflow**. It has **never** been dispatched
(`gh run list --workflow=diag-neon-schema.yml` is empty) and cannot be dispatched
from a workspace (`403 Resource not accessible by integration`); granting the
GitHub App **Actions: read/write** would allow it. Extend the probe with the two
notification index names if item 2 above is to be closed.

### 9.6 Safety notes from this pass

Never run `bun test backend/tests` where `DATABASE_URL` could point at production:
the DB-gated fixtures **delete** rows (`backend/tests/helpers/purge.ts`). No
credential, URL, password, token or hash was printed — the workflow references the
secret only as `psql "$NEON_DATABASE_URL"` and never echoes it.

---

## 10. Production R2 / media — read-only verification (TASK 002, 2026-09-23)

**Archived** → [`history/archive/AI_Handoff-2026-09-23-r2-media-verification.md`](history/archive/AI_Handoff-2026-09-23-r2-media-verification.md).
Moved 2026-09-25 to keep this file small. Its findings were all fixed in §11
except #7; #7's **root cause** is now closed by §13, and only its production
*data* cleanup (an owner action needing no code) remains open there.

---

## 11. Media security fixes (TASK 003, 2026-09-24)

Every Task 002 finding is closed except #7's production data cleanup (archived
copy: [`history/archive/AI_Handoff-2026-09-23-r2-media-verification.md`](history/archive/AI_Handoff-2026-09-23-r2-media-verification.md));
its root cause is closed by §13. No DB change (`db/` untouched).

| # | Fix |
|---|---|
| 1 | `PATCH /api/customer/profile-image` **deleted** — no replacement; the canonical `save` route already writes the same reference after HeadObject + media persistence. `api.users.patchUserImage` and its only caller dropped. |
| 2 | Presign `purpose` allowlist (`avatar｜cover｜shop-logo｜shop-cover`); unknown → `400 INVALID_PURPOSE` before any URL is signed; avatar/cover mint `profile/{kind}/{userId}.webp`, shop purposes keep the shop-ownership query. |
| 3 | `ImageUpload.tsx` converts to WebP, presigns with the allowlisted purpose, and confirms with `objectKey` only (server derives the target). Still no screen renders it. |
| 4 | `confirm` and `save` answer `500 IMAGE_SAVE_FAILED` and return before any `users`/`shops` write when the media row cannot be persisted. |
| 5 | `compressImage` hands back the original untouched when the browser cannot encode (never relabels bytes); all three uploaders refuse non-WebP; `confirm`/`save` re-check the **stored** content type against the allowlist. |
| 6 | Both `deleteR2Object` call sites in `backend/routes/products.ts` (product-image delete, variant-image delete) now await. |
| 7 | **OPEN** — production data cleanup, not a code path. |

Server-derived now: `confirm` reads the reference target from the server-minted key
(a body `purpose`/`cdnUrl` can no longer steer which reference is written);
`upload-intent` requires an allowlisted `kind` (no default); `save` derives the
kind from the key.

**Validation:** backend `tsc` clean; `bun test backend/tests` **419 pass / 41
skip / 0 fail**; all four apps typecheck clean; `i18n:check` (th=en=my=1289);
`git diff --check` clean; no DB change. New cases in
`backend/tests/upload-security.test.ts` cover the removed route, the purpose
allowlist, arbitrary namespaces at presign/confirm, and the intent `kind`
allowlist.

**Tooling:** `backend/routes/products.ts` (181 KB) is past the edit tools'
match window, so finding 6 was applied as a `patch -p1` diff and verified with
`git diff`.

---

## 12. Startup-sync rule + root AI files removed (2026-09-25)

**Archived** (closed docs record) →
[`history/archive/AI_Handoff-2026-09-25-docs-consolidation.md`](history/archive/AI_Handoff-2026-09-25-docs-consolidation.md).
Moved 2026-09-25. The rules are live in `.ai/AI_RULES.md` §0, `AGENTS.md` rule 0.

---

## 13. Test database isolation (TASK 004A, 2026-09-25)

**Root cause.** `backend/db/index.ts` built the one `pg.Pool` from `DATABASE_URL`,
which in this repository *is* the production Neon connection string
(`.env.example`); no test-database variable existed. Every DB-gated test opened on
`Boolean(process.env.DATABASE_URL)` and then wrote real rows — `so-test-*`,
`inv-*`, `inv-cancel-*`, `inv-paid-*` and the `*@test.local` users → sellers →
shops → products → orders. A plain `bun test` on any machine carrying the
production URL therefore seeded production: a silent fallback, no guard, no CI
test job. Closes the **root cause** of archived finding #7.

**Guard (new).** `backend/db/test-database.ts` — pure metadata, never connects.
`TEST_DATABASE_URL` is preferred; a hard throw refuses a production env marker
(`NODE_ENV`/`APP_ENV`/`ENVIRONMENT`/`VERCEL_ENV` = `production`, `RENDER=true`), a
Neon host (`*.neon.tech`), and the production `DATABASE_URL` endpoint. A Neon
*branch* needs `TEST_DATABASE_ALLOW_NEON_BRANCH=1` and still may not be the
production endpoint. `decideTestDatabase()` is **fatal or safe — never a fallback
to production**; nothing configured means the DB-gated tests skip, as before.
`resolveConnectionString()` is now the pool factory's only source of a connection
string; loopback targets keep their own sslmode (a disposable Postgres has no
TLS). Fail-fast: `backend/tests/setup.ts` via root `bunfig.toml` `[test] preload`
aborts before any file loads, and `helpers/test-db.ts` asserts the same at import
so `cd backend && bun test tests` is covered too. No message ever contains a
credential — host/database only.

**Fixtures.** All 11 DB-gated files gate on `hasTestDatabase()`
(`backend/tests/helpers/test-db.ts`) instead of the raw check. **No filtering was
added to `/api/shops` or the frontend** — the fix is at the database boundary.
`helpers/purge.ts` unchanged.

**Regression test.** `backend/tests/test-database-isolation.test.ts`, 32 cases:
metadata parsing, production refusal, the no-fallback decision, the pool-factory
path, sslmode, a real `bun` subprocess proving fail-closed, and source-level
guards that the old gate cannot return.

**CI (new).** `.github/workflows/test.yml` — disposable `postgres:16` service,
`TEST_DATABASE_URL` on localhost, `db/run-sqleditor.sql` bootstrapped once, then
typecheck + `bun test backend/tests`. It references **no secret at all**;
`NEON_DATABASE_URL` is never a test database. Previously no test job existed.
`upload-security.test.ts` now gates its 2 bucket-dependent cases on R2 config
(`itR2`) rather than JWT alone (missing R2 credentials produced a 500, not the
behaviour under test), and the "arbitrary namespace" confirm case accepts
`R2_OBJECT_NOT_FOUND` — the storage check legitimately runs before the shop
ownership query and reaches no write either way.

**Verification (actually run).** Backend `tsc` clean; 4/4 apps typecheck clean.
Against a disposable local PostgreSQL 14 cluster (created, bootstrapped from
`db/run-sqleditor.sql` → 59 tables, then dropped and stopped): **491 pass / 2
skip / 0 fail** (493 tests, 23 files; both skips are the R2-credential cases).
Guard proof against the **real suite**: with a production-looking `DATABASE_URL`
it exits **1** with **0 pass / 23 fail** and `REFUSING TEST AGAINST PRODUCTION
DATABASE` — no test body runs; identical with `RENDER=true`; a disposable target
exits 0. `git diff --check` clean.

**Production read-only verification (no writes, no credentials read).**
`GET /api/health` → 200 `{"status":"ok"}`. `GET /api/shops` → 200 with exactly
one shop (“Eloop”, active); scanning the response for `so-test` / `inv-test` /
`inv-cancel` / `inv-paid` / `test.local` / `test@` returns **0 matches**. **EXISTING
PRODUCTION TEST DATA FOUND: none on this surface.** A `SELECT` cannot be run (no
production credentials here, by design), so rows no public endpoint surfaces are
unverified; **nothing was deleted or modified**.

**Still open.** (a) Archived finding #7's data half — historical fixture rows
remain an owner cleanup action. (b) `.env.example` is protected from the agent's
edit tools, so its `TEST_DATABASE_URL` entry could not be added; the variable is
documented in `INSTALLATION.md` and `.ai/context/testing.md` — add the line
manually. (c) A dev machine carrying a production `DATABASE_URL` now fails the
whole run instead of silently writing to production — the intended fail-closed
behaviour; set `TEST_DATABASE_URL` to run tests.

**Next task:** TASK 004B — production R2 authenticated round-trip.

---

## 14. Production R2 authenticated round-trip (TASK 004B, 2026-09-25) — **BLOCKED**

**Overall: BLOCKED at the account hard gate.** Every read-only / unauthenticated /
code-level check passed; the authenticated production chain (presign → R2 PUT →
confirm/save → media row → API read → UI → replace → delete → cleanup) **was not
executed at all** and must not be reported as PASS. **Zero production writes**,
no production DB touched, no credential read.

**Why BLOCKED.** No safe authorized production test account exists; this
workspace holds **no** `DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET` or R2
credential, and the only login is Google OAuth in a browser. Minting a production
user by SQL, reusing a real account, or fabricating a JWT are forbidden → steps
9–23 are **BLOCKED / NOT TESTED**, not failed. **UI/browser E2E has still never
been run from this environment** → `UI NOT VERIFIED`.

**Still-live observation:** a ~4-minute window on 2026-09-25 where every
POST/PATCH with a JSON body returned 500 (even on a non-existent route) while
GETs stayed 200 — never reproduced, **no root cause proven**, likely a Render
cold-start. Production logs are unreachable from this workspace.

**Verified (read-only):** `/api/health` 200, `/api/health/r2`
`{configured:true,bucket:true,verify:true}`, `/api/shops` 200; removed
`PATCH /api/customer/profile-image` → 404; six canonical media endpoints → 401
without a cookie; untrusted `Origin` → 403.

**Provision to unblock:** an owner-provisioned production test account (a
dedicated customer, no real orders/payments) plus a live browser.

**Full evidence narrative (both passes) archived** →
[`history/archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md`](history/archive/AI_Handoff-2026-09-25-t004b-r2-authenticated.md)
— moved 2026-09-25 to stay under the ~55 KB edit limit.

---

## 15. Payment foundation — Stripe test mode, Card + PromptPay, COD OFF (TASK 005, 2026-09-25)

Built ON the Stripe code that already existed (`backend/routes/stripe.ts`, V0023)
— no second payment system, no duplicate table. **Stripe: TEST MODE ONLY.**

**Audit-first findings (the pre-existing state, re-verified from source).**
`POST /api/stripe/checkout` set **no `payment_method_types`** (dashboard default,
no PromptPay) and had **no idempotency boundary** — a double-click opened two
Checkout Sessions, i.e. two PaymentIntents. The webhook used **sync
`constructEvent`**, and outside Node the Stripe SDK picks a WebCrypto verifier
whose sync API **throws for every event, valid or not** — so signature
verification could never succeed and every webhook was silently dropped. Any
secret key was accepted, live included. `payment_events` was written **before**
processing and never updated, so an event whose handler threw was left marked
seen and Stripe's retry was skipped. **COD was the DEFAULT** on
`POST /api/customer/checkout` (`body.paymentMethod ?? "cod"`) and was offered as
a normal VelShop radio option. `refunds` existed as a table with no code.

**Implemented.** `backend/lib/payment-config.ts` is the ONE decision point:
test-mode-only key classification (`sk_/rk_test_`; live **and** unrecognized
refused), "payment unavailable" instead of any fallback, fail-closed COD flags,
method normalization, and `assertPaymentMethodUsable` — the guard every payment
route runs. Routes: `GET /api/payments/methods` (backend-driven discovery; the
storefront renders THIS list), `POST /api/stripe/checkout` (Card + PromptPay;
charged amount reconciled to `orders.total_amount` **exactly** — a remainder
becomes its own line item, never a client-supplied total),
`POST /api/payments/stripe/webhook`, `GET /api/stripe/payment-status/:id` (now
ownership-checked — it leaked any session's status before),
`POST /api/admin/orders/:orderId/refund` (`orders.manage`),
`GET /api/orders/:orderId` (payment + refunds). The webhook now uses
`constructEventAsync`.

**Idempotency — DATABASE-BACKED (no in-memory Map).** Two layers.
`checkout_requests` gained `scope`, so checkout and payment keys share ONE
idempotency store via `UNIQUE (user_id, scope, request_key)`; and the partial
unique index `idx_payments_one_active_stripe` allows at most one live Stripe
attempt per order, so the loser of a concurrent insert is answered with the
winner's session. Webhook events are claimed with `INSERT … ON CONFLICT DO
NOTHING`; a duplicate is acknowledged without re-running, a `failed` event is
**re-armed** so Stripe's retry really re-processes, and a throwing handler
returns **500** so Stripe redelivers instead of the sync being lost.

**Order↔Payment sync — separate lifecycles.** Payment carries its own state
(`pending` / `requires_action` / `paid` / `failed` / `cancelled`) plus
`refunded_amount` + `refund_status`. Only paired transitions are written:
`paid`→`paid`, `failed`→`payment_failed`, expired/canceled→`cancelled`, full
refund→`refunded`; each releases reserved stock exactly once. **PromptPay is a
delayed-notification method**, so `checkout.session.completed` with
`payment_status != "paid"` does **not** mark an order paid — only
`async_payment_succeeded` / `payment_intent.succeeded` / a `paid` session do.

**Refunds — webhook-confirmed.** Submit records a `pending` row and calls Stripe
with a deterministic idempotency key; final state comes from the provider
response and the webhook (`charge.refunded`, `refund.updated|failed`) running the
same idempotent sync, which **recomputes** `refunded_amount` from succeeded rows
rather than incrementing. Over-refund is rejected before Stripe is called.
Authorization is the EXISTING `orders.manage` permission.

**Follow-up hardening (same commit lineage).** The charge is DERIVED, never
accepted: `buildCheckoutLineItems` builds the Stripe lines from `orders.total_amount`
so a tampered `amount`/`price`/`quantity` cannot move money (shipping remainder →
its own line; discount → one line for the authoritative total). An **open session
for a different method is expired**, never handed back, and a race winner is only
reused when `metadata.method` matches — otherwise our own session is expired and
the caller gets **409 `DUPLICATE_PAYMENT_IN_PROGRESS`**, not a fabricated success.
A refund request matching an existing `pending`/`succeeded` refund **replays** it
(`duplicate: true`) instead of issuing a second one. `sessionConfirmsPayment`
(only `payment_status === "paid"`) and `refundableMinorFor` (never negative) are
exported pure helpers.

**Schema.** `db/migrations/047_payment_foundation.sql` + both canonical files
(`db/schema.sql` ↔ `db/run-sqleditor.sql` verified byte-identical; the canonical
files alter no table they do not create). `db/run-update.sql` was **not**
created.

**COD: IMPLEMENTED = YES, ENABLED = NO, CUSTOMER_SELECTABLE = NO.**
`COD_ENABLED` / `COD_CUSTOMER_SELECTABLE` default off and fail closed (only
literal `true`/`1` counts; `"yes"`, `"'true'"`, empty, misspelled all stay off).
`method=COD` → **403 `PAYMENT_METHOD_DISABLED`** *before* any
order/payment/shipment/settlement write and **independently of Stripe's state**.
VelShop renders only backend-enabled methods and shows COD as a non-selectable
"Coming soon" row. No carrier, no settlement, no fake collection.

**Verified HERE (actually executed).** Backend `bunx tsc --noEmit` clean;
`bun run typecheck` 4/4 apps exit 0; full suite **511 pass / 43 skip / 0 fail**
(new `backend/tests/payment-foundation.test.ts`: 59 pass / 1 DB-gated skip —
config, live-key refusal, COD fail-closed, webhook signature reject **and
accept**, COD bypass 403 on both endpoints, line-item total reconciliation,
refundable arithmetic, PromptPay unpaid-session trap, secret-leak checks); `i18n:check`
**1295 / 1295 / 1295**; `git diff --check` clean; schema-drift +
migration-numbering tests pass.

**NOT verified — limitations (do not read these as PASS).** No Stripe credential
exists in this workspace, so **no live test-mode PaymentIntent, no PromptPay QR,
no webhook delivery and no Stripe refund was ever executed** → those paths are
**CODE VERIFIED / BLOCKED**. The DB-gated webhook-idempotency test and every
DB-gated payment integration test **skip** here (no `TEST_DATABASE_URL`) and run
only in CI (`postgres:16`). VelShop checkout was typechecked but **never opened
in a browser** → `UI NOT VERIFIED`. Money is held in 2-decimal minor units.

**Safety — explicit.** Stripe remains **Test Mode**; no live credential, no live
endpoint, no real card, no real money, **no production payment was enabled** and
**no real customer funds were processed**; no production payment fixture; no
secret read, printed, logged or committed — only the **test publishable** key can
reach a browser. COD remains disabled.

**Next recommended task.** Add test-mode `STRIPE_SECRET_KEY` (test),
`STRIPE_WEBHOOK_SECRET` (test) and `STRIPE_PUBLISHABLE_KEY` (test) in
Settings → Environment, then run the live test-mode round trip (Card + PromptPay
+ `stripe listen` webhook + a refund) and point `TEST_DATABASE_URL` at a
disposable PostgreSQL so the DB-gated payment tests actually execute.

---

## 16. Stripe TEST-mode E2E verification (TASK 006, 2026-09-25) — **BLOCKED**

**Environment — no credential, no database.** `freebuff-env list` → `{"files":{}}`.
Every key unset: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_MODE`, `COD_ENABLED`, `COD_CUSTOMER_SELECTABLE`,
`DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`. No `postgres`/`initdb`/`psql`
binary and no docker/podman, so no disposable DB can be provisioned either. **No
Stripe API call, PaymentIntent, PromptPay QR, webhook delivery or refund has ever
been executed — not by this pass, not by any prior pass.**

**Executed here** (real HTTP against the real route stack, in an in-process
listening server; probe deleted, tree left clean):

| Probe | Observed |
|---|---|
| `GET /api/stripe/configured` | `configured:false, mode:null, publishableKey:null, reason:STRIPE_NOT_CONFIGURED` — no secret leak |
| `GET /api/payments/methods` | CARD/PROMPTPAY/COD all `enabled:false`; `cod.customerSelectable:false` |
| `POST /api/customer/checkout` `COD` / `cod` / `cash_on_delivery` | **403 `PAYMENT_METHOD_DISABLED`** — no DB connection attempted |
| `POST /api/stripe/checkout` `method=COD` | **403 `PAYMENT_METHOD_DISABLED`** |
| `POST /api/stripe/checkout` `method=CARD`, unconfigured | **503 `STRIPE_NOT_CONFIGURED`** — no fabricated success |
| webhook, unconfigured | **503** — refuses rather than acking an unverifiable event |
| webhook, forged signature | **400 `Invalid signature`** |
| webhook, correctly signed | passes verification, then fails at the DB → **500** (correctly re-deliverable) |

The configure-shape row (`CARD`/`PROMPTPAY` enabled, `COD` disabled) was also
observed with placeholder keys, but **placeholders are not credentials**, so it is a
shape check only — never reported as configuration verification.

**Status / evidence tier.** CODE = source read · AUTO = test really executed here ·
BLOCKED = could not execute.

| Area | Tier |
|---|---|
| Stripe TEST configuration | AUTO (key ordering/refusal) · **BLOCKED** (no credential) |
| Card / PromptPay TEST E2E | **BLOCKED** |
| Webhook signature | AUTO (local HMAC, forged rejected **and** valid accepted) |
| Real webhook delivery / retry / idempotency | **BLOCKED** (DB-gated) |
| Checkout idempotency, method switching | **BLOCKED** |
| Price tampering | AUTO (6 cases — charge is the order total) |
| Stock safety, order↔payment sync, inventory sync | **BLOCKED** (DB-gated) |
| Full / partial / over-refund | AUTO (arithmetic + route rejection) |
| Duplicate refund | AUTO (replay path) · **BLOCKED** (provider) |
| COD disabled | **PASS** (executed) |
| COD direct API bypass 403 | **PASS** (executed) |
| No COD order/payment/shipment/settlement | CODE — the guard precedes the transaction and no DB touch occurred |
| Secret audit | **PASS** |
| Automated tests | **PASS** |
| Browser E2E | **BLOCKED** — no framework in any package.json, no test account |
| Production E2E | **BLOCKED** |

**Secret audit (clean).** No live key anywhere: `sk_live_` / `pk_live_` / `rk_live_`
appear only as zero-filled placeholders in `backend/tests/payment-foundation.test.ts`
(used to prove live keys are *refused*). `git log -S` over all 222 commits: only
`b806be1` ever touched those strings. No hardcoded `Authorization`/`Bearer` token. No
`console.*` or response body in the payment code references a credential identifier.
`.env`/`.env.*` are gitignored and untracked; only `.env.example` is tracked and it
holds placeholders only.

**Full verification run.** backend `tsc --noEmit` exit 0 · `bun run typecheck` 4/4
exit 0 · `bun test backend/tests` **511 pass / 43 skip / 0 fail** ·
`payment-foundation.test.ts` **59 pass / 1 skip / 0 fail** · `i18n:check`
**1295/1295/1295** · `git diff --check` clean · `schema.sql` ≡ `run-sqleditor.sql` ·
no `run-update.sql`.

**No defect found → no code change.** Verification-only, as the brief requires.

**Unblock.** Add test-mode `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` /
`STRIPE_WEBHOOK_SECRET` (+ `STRIPE_MODE=test`) in Settings → Environment, and point
`TEST_DATABASE_URL` at a disposable PostgreSQL (`psql "$TEST_DATABASE_URL" -f
db/run-sqleditor.sql`). CI (`.github/workflows/test.yml`) already runs every
DB-gated suite against a throwaway `postgres:16` and references no repo secret.

**Doc gap (recorded, deliberately not fixed).** `STRIPE_*` / `COD_*` are documented
nowhere outside the code — absent from `.env.example`, `docs/ENVIRONMENT.md`,
`INSTALLATION.md` and `README.md`. Out of scope for a verification-only pass.

---

---

## 17. CI guard fix — "Verify the guard refuses production" (2026-09-25)

**The failure.** `.github/workflows/test.yml` step *Verify the guard refuses
production* failed on every `main` run since the workflow landed. Real run
`36172693661` (for `68197ab`), job `Typecheck + tests (disposable PostgreSQL)`,
step 8 → `❌ The guard did not refuse a production database.` → exit 1. Because
`bash -e` aborts the job, **steps 9 "Run the test suite" and 10 were SKIPPED** —
CI had not been running the test suite at all on those commits.

**Root cause — the check contradicted a guard rule that is deliberately pinned.**
`TEST_DATABASE_URL` is a **job-level `env:`** (the disposable container), so it
was visible to every step — the run log prints it in the step's own `env:` block.
`decideTestDatabase()` **prefers `TEST_DATABASE_URL` over `DATABASE_URL` on
purpose**, and `test-database-isolation.test.ts` already asserts "an explicit
TEST_DATABASE_URL is preferred and wins over DATABASE_URL". The probe injected a
production-looking `DATABASE_URL`, but with the job variable still set the guard
never consulted it, correctly resolved to the disposable target, and printed
nothing — so `grep -q` matched nothing and the step reported a broken guard. **The
guard was correct; the CI assertion was wrong.** (GitHub runs `shell:
/usr/bin/bash -e {0}` — no `pipefail` — so the pipeline was not a factor.)

Reproduced locally: identical command + job env → **empty output, exit 0**.
Negative control (variable cleared) → `REFUSING TEST AGAINST PRODUCTION DATABASE`,
exit 1.

**Fix — CI wiring only; `backend/db/test-database.ts` untouched.** The probe now
clears the job variable with `env -u TEST_DATABASE_URL`, so it really models
"a test process whose only configured database is production". The step also
gains the other half of the contract: a second assertion that the disposable
target is still **ACCEPTED**, so it can no longer pass if the guard simply starts
refusing everything.

**Files changed (2 code, both CI-guard).** `.github/workflows/test.yml` (+26/−1)
and `backend/tests/test-database-isolation.test.ts` (+80); plus the handoff and
archive docs. **Payment code untouched**
— `backend/routes/stripe.ts`, `backend/lib/payment-config.ts`,
`db/migrations/047_payment_foundation.sql`, `backend/routes/cart.ts` and both
schema files verified unchanged; no schema change, no `db/run-update.sql`.

**Regression coverage — 7 new tests (39 pass / 0 fail in the file).** Subprocess:
(CI-shaped env: safe `TEST_DATABASE_URL` + production `DATABASE_URL` → **ACCEPTED**,
pinning the root cause), (D: Neon branch + `TEST_DATABASE_ALLOW_NEON_BRANCH=1` →
**ACCEPTED**; same opt-in on the production endpoint → **REFUSED**; branch without
opt-in → **REFUSED**). Source-level: the workflow must grep the documented refusal,
must contain `env -u TEST_DATABASE_URL`, must use only the reserved
`ep-ci-guard-check…neon.tech` host (never real production Neon), and must still
assert the disposable target is accepted.

**Full verification actually run (no production DB — nothing configured here,
so DB-gated suites skip as designed).** backend `bunx tsc --noEmit` **exit 0** ·
`bun run typecheck` **4/4 exit 0** · `bun test backend/tests` **518 pass / 43 skip /
0 fail** · payment tests **59 pass / 1 skip / 0 fail** · schema-drift +
migration-numbering + security-hardening **75 pass / 0 fail** · `i18n:check`
**1295/1295/1295** · `db/schema.sql` ≡ `db/run-sqleditor.sql` · no
`db/run-update.sql` · `git diff --check` clean · no secrets in the diff.

**GitHub Actions rerun — PASS (run `36176830888`, commit `85d2f48`).** Job
`Typecheck + tests (disposable PostgreSQL)` → **success**. Step 8 *Verify the
guard refuses production* → **success**, printing both `✅ Production database
refused as expected.` and `✅ Disposable test database accepted as expected.`
Step 9 *Run the test suite* → **success** (it had been **skipped** on every
previous failing run) and step 10 *Whitespace hygiene* → success.

**The suite now actually runs in CI: 559 pass / 2 skip / 0 fail** (561 tests,
24 files) against the disposable PostgreSQL — versus **518 pass / 43 skip**
locally where no test database exists. **41 DB-gated integration tests ran in CI
for the first time** (inventory reservation/concurrency, checkout + webhook
idempotency, refund/order paths) and all of them pass.

**Push.** `6f365b8 fix(ci): repair production database guard verification` +
`85d2f48 docs(ai): …` → `git push origin main` → **PUSH VERIFIED**, local
`85d2f480af036b7942982f1ce2675dc0ad865cf3` == `origin/main`, 0/0, tree clean.

**Not claimed.** Stripe Test Mode E2E is still **BLOCKED** (no credential) and
production payment readiness is **NOT claimed** — §16 stands unchanged.

---

**Housekeeping:** superseded material lives in [`history/archive/`](history/archive/)
(dated index: `.ai/history/AI_Handoff_Archive.md`) — §5's 2026-09-22 passes, §8,
§10, §12, and §14's TASK 004B narrative (its BLOCKED state stays live in §14).
This file sits **~54 KB against a ~40 KB soft ceiling; 55 KB is the hard limit
where editing stops working. NEXT SPLIT: §2**, after its live content is mirrored
into `.ai/context/`. Keep §6 (gaps), §9.4/§9.5, and the §14 stub.
