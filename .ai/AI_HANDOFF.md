# Velnox AI Handoff — current state

**Last updated:** 2026-09-23 · **Branch:** `main` · **Latest pass:** production Neon read-only verification (§9)
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

### 2026-09-22 (b) — production-readiness pass

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

### 2026-09-22 (a) — the three open gaps closed

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
- **No live R2 round trip has ever been executed** (needs real R2
  credentials). The server-side boundary up to and including HeadObject is
  tested over HTTP — without credentials HeadObject reports `found: false` and
  every persistence point correctly refuses — but an actual
  presign → PUT → confirm against the bucket, object deletion, and the
  browser-side preview remain source-inspected only.

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

The agent documentation layer moved from the repo root plus `docs/ai/` into one
canonical workspace, **`.ai/`**. Nothing was discarded and no second copy was left
behind.

### Layout

| New | Was | Role |
|-----|-----|------|
| `.ai/AI_RULES.md` | `AI_RULES.md` | canonical rulebook |
| `.ai/AI_HANDOFF.md` | `AI_Handoff.md` | this file |
| `.ai/README.md` | `docs/ai/README.md` | startup protocol + context-loading policy |
| `.ai/context/*.md` | `docs/ai/*.md` | 16 context docs (renames below) |
| `.ai/history/AI_Handoff_Archive.md` | `AI_Handoff_Archive.md` | dated history index — kept as-is |
| `.ai/history/README.md` | `docs/ai/history/README.md` | the three-layer history policy |
| `.ai/history/archive/*.md` | `docs/ai/history/archive/*.md` | verbatim long-form records |
| `.ai/tasks/` | *new* | `TEMPLATE.md` + `active/` + `completed/` |

### The six named context entries

| New | Was |
|-----|-----|
| `context/architecture.md` | `ARCHITECTURE.md` |
| `context/database.md` | `DATABASE.md` |
| `context/backend.md` | **new** — API, middleware order, authz, audit, jobs, derived from backend source |
| `context/frontend.md` | `DESIGN.md` (+ where frontend code lives) |
| `context/realtime.md` | `REALTIME.md` |
| `context/security.md` | `AUTH.md` |

Subsystem docs kept their names, lowercased: `products.md`, `categories.md`,
`seller.md`, `customer.md`, `checkout.md`, `media.md`, `project-map.md`,
`testing.md`, `workflow.md`, `troubleshooting.md`.

### Pointers, not duplicates

Root `AI_RULES.md` and `AI_Handoff.md` remain as short pointer files, so older
references and agent sessions cannot recreate a second rulebook or handoff. They
hold no rules and no state — edit the `.ai/` originals. `AGENTS.md` and root
`README.md` point into `.ai/`; `docs/` keeps the human-facing docs (`API.md`,
`ARCHITECTURE.md`, `SECURITY.md`, `DEPLOYMENT.md`, and the rest).

### Reconciled with `6187bcd`

`main` advanced 12 commits while this move was in flight, including a handoff
split (current state here, dated index in `AI_Handoff_Archive.md`, verbatim
records in `docs/ai/history/archive/`). Those commits are the base: their
structure was carried over unchanged into `.ai/history/`, together with the
handoff-size policy in `AI_RULES.md` §15 and `context/workflow.md` §8, the
upload-size / object-existence enforcement, the atomic inventory release, the
seller-verification pagination and self-approval guard, and the `/api/_diag`
guard beneath them. No force push; `main` was not rewritten.

### Root cause

The rulebook, handoff, and context docs were reached through three competing
schemes (repo-root files, `docs/ai/*.md`, and the `AGENTS.md` tables) with no
single entry point and no defined task scope. The workspace now has one canonical
location, a startup protocol, a context-loading policy, and a task-brief format
that carries a stop-and-clarify rule.

### Validation

| Check | Result |
|-------|--------|
| link integrity — every `.ai/` and `docs/` path referenced across the workspace | resolves; the only non-resolving paths are deliberate or descriptive: `db/run-update.sql` (must never exist), the old `docs/ai/*` paths quoted as the source of this move, `db/index.ts` (relative to `backend/` in the project map), and one dated historical note about a deleted `backend/lib/product-status.ts` |
| `git diff --check` | CLEAN |
| git rename detection | the doc moves are recorded as renames — history preserved |
| backend `tsc --noEmit` | pass |
| velShop / velSeller / velCenter / velNox typecheck | pass |
| backend tests | 415 pass / 37 skip / 0 fail (452 across 22 files) |
| DB | unchanged — `db/schema.sql` · `db/run-sqleditor.sql` untouched, still synchronized |
| code | unchanged by this pass — documentation only |

### Files changed (this pass)

`.ai/**` (workspace) · `AGENTS.md` · `README.md` · `AI_RULES.md` (pointer) ·
`AI_Handoff.md` (pointer) · `docs/ai/**` (moved into `.ai/`) ·
`AI_Handoff_Archive.md` (moved into `.ai/history/`).

---

## 9. Production Neon — read-only verification (TASK 001, 2026-09-23)

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing
was connected to from this workspace (no database credentials are readable here,
by platform design). Every fact below is the **production database's own
response**, captured from the production migration runner (`migrate-neon.yml`,
secret `NEON_DATABASE_URL` — documented as the production DB in
`context/database.md`) — not a filename check, not a local/test database.

### 9.1 Method

```
gh run list --workflow=migrate-neon.yml        # locate the runs that applied migrations
gh run view <id> --log | grep -i NOTICE        # live statement responses from production
gh run view <id> --log ... | diff - <(ls db/migrations/*.sql)   # ledger == main
gh workflow run diag-neon-schema.yml           # → 403, App lacks Actions write
```

### 9.2 Migration ledger

- `diff` of the production `schema_migrations` names against
  `db/migrations/*.sql` on `main` → **identical**: 49 rows, 49 files, none
  missing, none orphaned, nothing pending. Newest: `046_staff_must_change_password`
  @ 2026-09-18T00:05:39Z.
- A recorded row is **transactional proof**, not a list entry: the runner applies
  each file with `ON_ERROR_STOP=1 --single-transaction` and inserts the row only
  on exit 0. Observed live on the same database: `044 … ERROR: relation
  "velrepeat_plan_runs" does not exist` → `❌ FAILED`, and 044 stayed unrecorded
  until the retargeted file ran at 14:43:58Z.
- Rows 001–035 all carry one 2026-09-15 15:33–15:35 timestamp with a matching
  `already exists, skipping` NOTICE: the runner's first pass was a **backfill**
  over objects that already existed. Treat those timestamps as *not* creation
  dates — the NOTICEs are the existence evidence.

### 9.3 Verified in the production database (live responses)

| Item | Evidence |
|---|---|
| `sellers.status` admits `under_review` / `needs_correction` | 043 @ 2026-09-16T14:41:27Z — `UPDATE 0` + 4×`ALTER TABLE` + `CREATE TABLE` + `CREATE INDEX`, recorded |
| `seller_verifications.review_reason_code` / `review_note`, `seller_review_history` | same 043 run |
| `seller_verifications` + `idx_seller_verifications_seller` / `_pending` | NOTICE `already exists` (040) |
| `item_unavailable` on `velrepeat_plans.status` **and** `velrepeat_runs.status` | 044 @ 14:43:56Z, 4×`ALTER TABLE`, recorded 14:43:58Z |
| `media` canonical columns `uploaded_by`/`key`/`url`/`content_type`/`size` | 045 @ 14:44:00Z — five `V0045: media.<old> renamed to <new>` NOTICEs |
| `idx_media_owner_key` | **EXISTS** — NOTICE `relation "idx_media_owner_key" already exists, skipping` (041 @ 14:41:17Z); it indexed the owner/key columns before 045 renamed them, and Postgres carries an index across `RENAME COLUMN` |
| `notifications` + `body` / `metadata` + `idx_notifications_unread` | NOTICEs (003, 016) |
| `audit_logs` + `idx_audit_logs_entity` + `idx_audit_logs_created` | NOTICEs (005) |
| `products`, `shops`, `orders`, `moderation_records`, `platform_settings`, `revoked_tokens`, `product_variants`, `product_variant_images` (+`idx_variant_images_variant`), `product_option_groups`/`_values`, `product_variant_values`, `option_value_images`, `product_attributes`, `product_images.variant_id`/`image_type`, `products.featured_variant_id` | NOTICEs across 001–037 |
| `users.must_change_password` | 046 @ 2026-09-18T00:05:39Z — `ALTER TABLE` |

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

Never run `bun test backend/tests` in an environment whose `DATABASE_URL` could
point at production: the DB-gated fixtures **delete** rows
(`backend/tests/helpers/purge.ts`). No credential, URL, password, token or hash
was printed in this pass — the workflow references the secret only as
`psql "$NEON_DATABASE_URL"` and never echoes it.
