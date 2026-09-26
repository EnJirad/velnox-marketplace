# Velnox AI Handoff — current state

**Last updated:** 2026-09-26 · **Branch:** `main` · **Latest pass:** production-readiness audit — seller queue bounded, Stripe E2E still BLOCKED (§19)
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

**Live content moved to [`.ai/context/verification.md`](context/verification.md)**
(2026-09-26, TASK 007) to keep this file under the ~55 KB edit limit. Velnox has ONE
verification system — SELLER/SHOP identity verification, no product verification:
`seller.verification_status = 'verified'` is what gives every product of that seller
the single green V badge. The context doc carries the V rule, the `sellers.status`
state machine, the transactional submission rule (`NO SUCCESSFUL EVIDENCE
PERSISTENCE = NO PENDING VERIFICATION`), structured review reasons, review history,
evidence-URL security, the self-approval guard, and the verification API surface.
Pre-move text (verbatim):
[`history/archive/AI_Handoff-2026-09-25-verification-system.md`](history/archive/AI_Handoff-2026-09-25-verification-system.md).

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
- **`GET /api/admin/products/moderation` is still fully unbounded** (no `LIMIT`),
  and `ProductModerationQueue.tsx` still renders the whole result client-side.
  **BLOCKED by tooling — now measured (2026-09-26, §19):** the handler is
  `backend/routes/products.ts:3458` at byte **162,487** of a 181 KB file; the edit
  tool matched at 54,710 B and failed at 68,200 B. Its *dashboard* caller is gone
  (the counter reads `GET /api/admin/dashboard/counts` — one COUNT query), so the
  remaining caller is the queue UI itself. Next step: apply
  `backend/lib/pagination.ts` to that handler + add controls to the queue from a
  checkout without the size limit.
- ~~**`GET /api/admin/sellers` is unbounded too.**~~ **CLOSED (2026-09-26, §19).**
  The endpoint is bounded (default 25 / max 100, exact `pagination.total`, fallback
  count for a page past the end) and its only consumer — the VelCenter overview
  counter — reads that count instead of measuring a fetched list. Executed:
  `backend/tests/admin-sellers-pagination.test.ts` (8 cases, real DB + real HTTP).
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
  **Confirmed by measurement (2026-09-26, §19):** 0 `CHANNELS.*` publisher sites
  each (`order:updated` 14, `product:updated` 1, `seller:updated` 1). Harmless today
  (no consumer subscribes), but they are dead entries.
- **The `velnox.com` zone does not resolve** (Google DoH `Status: 2`, "Name servers
  refused query (lame delegation?)"; `center.velnx.com` is NXDOMAIN). Production is
  unaffected — every Vercel project sets `VITE_*` overrides, and no deployed bundle
  references `*.velnox.com` — but the `sites.ts` defaults point at dead hosts.
  Owner action: fix the NS delegation or stop treating those defaults as live.
  See §19 finding 1.
- **One corrupted UI string:** `SellerVerificationQueue.tsx:177`
  (`toast.success("ระงับและลบrêtailer แล้ว")` — the only `ê` in the repository).
  Not rewritten: the correct wording is a copy decision. See §19 finding 2.

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

**Summary (full pre-move text: [`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md); live reference: [`.ai/context/payment.md`](context/payment.md)).**
The pre-existing Stripe code was audited first and found unsafe: no
`payment_method_types` (no PromptPay, dashboard default), **no idempotency** (a
double-click opened two Checkout Sessions = two PaymentIntents), sync
`constructEvent` (which throws for every event outside Node, so all webhooks were
silently dropped), any secret key accepted (live included), `payment_events`
marked seen before processing, **COD as the DEFAULT** on
`POST /api/customer/checkout`, and `refunds` as a table with no code.

Built on that same code — no second payment system, no duplicate table —
`backend/lib/payment-config.ts` became the ONE decision point (test-mode-only key
classification, no fallback, fail-closed COD flags, `assertPaymentMethodUsable`),
with `GET /api/payments/methods` discovery, a Card + PromptPay checkout whose
charge is DERIVED from `orders.total_amount`, an ownership-checked payment-status
route, `constructEventAsync` webhook verification, DATABASE-BACKED idempotency
(`checkout_requests` scope + `idx_payments_one_active_stripe` + atomic
`payment_events` claim/re-arm), separate order↔payment lifecycles (PromptPay is
delayed-notification, so an unpaid completed session never marks an order paid),
and webhook-confirmed refunds capped at the paid amount (`orders.manage`).
Schema: `db/migrations/047_payment_foundation.sql` + both canonical files;
`run-update.sql` **not** created. **Stripe is TEST MODE ONLY; COD stays disabled.**

---

## 16. Stripe TEST-mode E2E verification (TASK 006, 2026-09-25) — **BLOCKED**

**Status: BLOCKED — Stripe TEST credentials unavailable** (unchanged). `freebuff-env
list` → `{"files":{}}`; no Stripe API call, PaymentIntent, PromptPay QR, webhook
delivery or refund has ever been executed. Pre-move evidence (probe table, tier
table, secret audit, unblock steps) is archived:
[`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
**Correction:** its claim that this sandbox has no `postgres`/`psql` binary was
wrong — PostgreSQL 14 IS installed there, and §18 records the DB-gated payment
tests executing (**560 pass / 2 skip / 0 fail**). Only the credential half stands.

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

## 18. Stripe TEST-mode E2E — independent re-verification (TASK 007, 2026-09-26)

**Status unchanged where it matters: STRIPE E2E IS STILL BLOCKED.** This pass did
not (and could not) execute a Stripe API call. What it changed is the *evidence tier*
of everything that does not need Stripe, plus one new executed test.

**Startup sync.** The sandbox was **stale by 10 commits** (`b31e67b` → `origin/main`
`42f6ae3`): a prior session had already landed the payment foundation (§15), the
TASK 006 BLOCKED record (§16), and the CI guard fix (§17). `git pull --ff-only` →
HEAD == `origin/main` == `42f6ae3d0ca705993e3969db1bd2235fb0efab2e`, tree clean.
This section re-verifies that state from source rather than trusting it.

**Credential check (no secret read).** `freebuff-env list` → `{"files":{}}` — no
`STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_MODE`
/ `COD_*` / `TEST_DATABASE_URL` exists in this workspace → **BLOCKED — Stripe TEST
credentials unavailable**: no PaymentIntent, no PromptPay QR, no Stripe-hosted
webhook delivery, no Stripe refund. No mock, stub, or fake Stripe response was
substituted, and none may be reported as E2E.

**Executed here — the DB-gated half now RUNS (what §16 wrongly called impossible).**
Disposable local PostgreSQL 14 (`pg_ctlcluster 14 main start` — the sandbox stopped
the cluster once mid-session; restart it and re-run rather than reading
`ECONNREFUSED` as a test failure), database `velnox_test` bootstrapped from
`db/run-sqleditor.sql` (**59 tables**),
`TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/velnox_test?sslmode=disable`:

| Run | Result |
|---|---|
| `bun test backend/tests` **with** disposable DB | **560 pass / 2 skip / 0 fail** (562 tests, 24 files) |
| `backend/tests/payment-foundation.test.ts` **with** DB | **61 pass / 0 fail** (was 59 pass / 1 skip) |
| `bun test backend/tests` **no DB** (skip path intact) | **523 pass / 39 skip / 0 fail** |
| `bun test backend/tests/test-database-isolation.test.ts` | **39 pass / 0 fail** |
| backend `bunx tsc --noEmit` | exit 0 |
| `bun run typecheck` (4 apps) | 4/4 exit 0 |
| `bun run i18n:check` | **th=1295 en=1295 my=1295**, parity |
| `git diff --check` | clean |
| `db/schema.sql` vs `db/run-sqleditor.sql` | **identical** |
| `db/run-update.sql` | absent (stays absent) |

The 2 remaining skips are the R2-credential upload cases, not payment. Provisioning
the DI cluster needed one local-only step: this sandbox cluster uses SCRAM auth, so
`ALTER USER postgres PASSWORD 'postgres'` was set on the **throwaway** cluster (the
same convention as CI's `postgres:16`; no repository secret involved or read).

**New executed test (+59 lines, `backend/tests/payment-foundation.test.ts`).**
`a refused COD attempt writes nothing (DB-gated)` closes the one gap §16 could only
mark CODE: the brief requires proof of **no order/payment/shipment/settlement
write**, which an HTTP status alone cannot show. It fires `method=COD` at BOTH
checkout endpoints with fresh UUIDs, expects **403 `PAYMENT_METHOD_DISABLED`**
(rather than 404 `NOT_FOUND` / 403 `ADDRESS_NOT_FOUND`, which is what an order or
address lookup would answer — so the refusal provably precedes the first DB read),
then reads the rows back: `orders`, `payments`, `shipments`, `settlements`, and
`checkout_requests` are all **0** for that caller, order id, and request key.
**Non-vacuity control:** the identical count expression returns **1** when a matching
order is inserted, and 0 after cleanup — so the zero is real, not a broken query.
COD safety is therefore **TEST VERIFIED**, not merely code-read.

**Idempotency — what is actually proven.** Webhook event idempotency is **TEST
VERIFIED**: a duplicated `event.id` is claimed once (`payment_events` = 1 row,
`status = processed`) and the second delivery answers `{duplicate: true}` — executed
against the real DB locally and in CI. The **checkout request-key replay** and the
`idx_payments_one_active_stripe` single-active-session race are **CODE VERIFIED
only**: both sit behind `getStripe()`, which answers 503 without a credential, so no
automated test can drive them here. **BLOCKED for E2E.**

**CI — not concluded from local tests.** GitHub Actions on `42f6ae3`: `Tests`
**success** (run `36177228483`, 1m15s); the step *Typecheck + tests (disposable
PostgreSQL)* logged `[test-db] integration tests will use localhost/velnox_test`,
executed the payment suites (stripe configuration, webhook signature accept **and**
reject, COD bypass 403, webhook idempotency) and finished **559 pass / 2 skip / 0
fail**. The two runs before the §17 fix (`68197ab`, `b6d8e5e`) had **failed**, which
is why "CI is green" must be checked per commit rather than assumed.

**Security audit (read-only).** `sk_live_` / `pk_live_` / `rk_live_` appear only as
zero-filled placeholders in `payment-foundation.test.ts` (they prove live keys are
*refused*) and as the classifier regex in `payment-config.ts`. No credential
identifier is logged in the payment code. Only `.env.example` is tracked; no `.env`.
This task changed **0 lines** of `backend/routes/stripe.ts`,
`backend/lib/payment-config.ts`, or `db/migrations/` — the only code delta is the
new test.

**Tier summary — do not read BLOCKED as PASS.**

| Area | Tier |
|---|---|
| Stripe test-mode E2E (Card, PromptPay, refund, webhook delivery) | **BLOCKED** — no credential |
| Live-key refusal, mode/key ordering, fail-closed COD flags | TEST VERIFIED (executed) |
| Webhook signature: forged rejected **and** valid accepted | TEST VERIFIED (local HMAC) |
| Webhook duplicate delivery / `payment_events` claim | **TEST VERIFIED** (real DB, local + CI) |
| COD disabled + direct-API bypass → 403, **no writes** | **PASS** (executed, DB-backed, with control) |
| Checkout request-key replay · single-active-session race · method switching | **CODE VERIFIED only → BLOCKED** |
| Charge derived from `orders.total_amount` (tamper resistance) | TEST VERIFIED (6 cases) |
| Refund arithmetic + over-refund rejection + duplicate replay | TEST VERIFIED (pure/replay) · provider-side **BLOCKED** |
| Inventory/stock transitions, order↔payment sync | **BLOCKED** — needs a configured Stripe session |
| Production payment readiness | **NOT CLAIMED** |

**Docs moved in this pass.** §2 (verification system) was mirrored into the new
[`.ai/context/verification.md`](context/verification.md) and the handoff now carries
a stub → file down from ~54 KB to ~47 KB. A new
[`.ai/context/payment.md`](context/payment.md) records the payment subsystem, its
non-negotiables, and the exact unblock steps. `AGENTS.md`, `.ai/README.md`, and
`.ai/context/project-map.md` gained pointer rows for both.

**Unblock (owner action, unchanged from §16).** Add test-mode `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` (optionally `STRIPE_MODE=test`) in
Settings → Environment, plus `TEST_DATABASE_URL` for a disposable PostgreSQL. Note
`.env.example` still does **not** list `STRIPE_*` / `COD_*` / `TEST_DATABASE_URL`;
agent tooling cannot edit that file, so add them by hand while you are there.

**Re-gate (2026-09-26, TASK 008 — close-out attempt).** Re-verified at `0712c70`
(= `origin/main`, tree clean): the credential gate is **unchanged** —
`freebuff-env list` is still empty, and the app's own `stripeStatus()` still reports
`{"usable":false,"mode":null,"reason":"STRIPE_NOT_CONFIGURED"}` with COD off. So
**Stripe TEST E2E stays BLOCKED** and flows 1–7 were not run. Phases 2/3/6 were
re-executed: production-looking `DATABASE_URL` refused (disposable target accepted),
isolation suite 39 pass, full suite **560 pass / 2 skip / 0 fail**, payment file
**61 pass / 0 fail**, schema-drift + migration-numbering **57 pass**, backend `tsc`
exit 0, 4/4 apps exit 0, i18n 1295/1295/1295, schema sync intact, `diff --check`
clean. All eight required payment properties were located in source with file:line
citations (nothing needed changing → nothing changed).
Full flow-by-flow evidence report:
[`.ai/tasks/completed/stripe-test-mode-e2e-gate.md`](tasks/completed/stripe-test-mode-e2e-gate.md).

**Not claimed.** Stripe E2E remains **BLOCKED**; production payment readiness is
**NOT claimed**. No live key, no real card, no real money, and no production database
was touched — the only database used was the disposable local one above.

---

## 19. Production-readiness audit — risk-ordered (TASK 009, 2026-09-26)

The 13 release gates were walked high-risk → low-risk. **PRODUCTION: NOT READY.**
Per-gate evidence, the measured tooling window, and every BLOCKED reason:
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md).
**PRODUCTION PAYMENT READINESS: NOT CLAIMED.**

**Fixed (code, executed).** `GET /api/admin/sellers` was unbounded *because* its only
consumer counted a badge from the whole list. It now pages (`lib/pagination.ts` helpers,
`COUNT(*) OVER()`, `ORDER BY created_at DESC, id DESC`, `LIMIT/OFFSET`, a fallback count
query, `data: { sellers, pagination }`), the shared action forwards `page`/`limit`, and
`Center.tsx` reads `pagination.total` for sellers + `GET /api/admin/dashboard/counts`
for products — so the dashboard no longer downloads either queue to count it.
Executed: `backend/tests/admin-sellers-pagination.test.ts` **8 pass / 0 fail** (real
route, real session cookies, disposable DB: 401/403, exact total at `limit=1`, default
page 25, clamp 100, disjoint pages, page-past-end total, no `total_count` leak) plus 9
static guards in `admin-queue-pagination.test.ts` (**30 pass**).

**BLOCKED, unchanged.** Stripe TEST E2E — this workspace *and* production answer
`STRIPE_NOT_CONFIGURED` (`/api/stripe/configured`) with every method disabled
(`/api/payments/methods`), so no Card / PromptPay / webhook / refund / idempotency
flow was run and no mock was substituted (§16/§18 stand). Browser E2E, Google OAuth
E2E and R2 authenticated E2E: no browser and no authorized account. The
`products/moderation` handler and the locale `review:` blocks are past the edit window
(162,487 B; 70,035 / 55,934 / 57,528 B).

**Verified this pass (production, read-only, zero writes).** `/api/health` 200 ·
`/api/health/r2` 200 · four frontends 200 (`velshop|velseller|velcenter.vercel.app`,
`velnox-theta.vercel.app`) with SPA deep routes 200 · nine protected endpoints → **401
`UNAUTHORIZED`** · public reads 200 · **0** secret patterns across all four deployed
bundles (1.27 MB). **New findings (owner actions, no code change):** (1) the `velnox.com`
zone is unresolvable (lame NS delegation) and `center.velnx.com` is NXDOMAIN —
production is unaffected because the Vercel projects set `VITE_*` overrides and no
deployed bundle references `*.velnox.com`; (2) `SellerVerificationQueue.tsx:177`
carries the repository's only corrupted copy string (`ลบrêtailer`), left for an owner
wording decision.

**Regression (this tree).** Disposable PostgreSQL + `JWT_SECRET`: **577 pass / 2 skip /
0 fail** (579 tests, 25 files; both skips are the pre-existing R2-credential cases).
No database configured: **533 pass / 46 skip / 0 fail**. Backend `tsc` exit 0 · 4/4
apps exit 0 · i18n 1295/1295/1295 · `db/schema.sql` ≡ `db/run-sqleditor.sql` · no
`db/run-update.sql` · `git diff --check` clean.

---

**Housekeeping:** superseded material lives in [`history/archive/`](history/archive/)
(dated index: `.ai/history/AI_Handoff_Archive.md`) — §5's 2026-09-22 passes, §8,
§10, §12, §14's TASK 004B narrative, and (2026-09-26) §2's verification system →
`.ai/context/verification.md` plus §15/§16's payment narratives →
`.ai/context/payment.md` + §18. This file sits **~45 KB against a ~40 KB soft
ceiling; 55 KB is the hard limit where editing stops working — measured 2026-09-26:
≤54.8 KB edits, ≥68.2 KB does not. NEXT SPLIT: §5 and
§13** once their content is mirrored into `.ai/context/`. Keep §6 (gaps),
§9.4/§9.5, and the §14 stub — and keep §18's BLOCKED statements.
