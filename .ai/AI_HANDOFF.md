# Velnox AI Handoff — current state

**Last updated:** 2026-09-26 · **Branch:** `main` · **Latest pass:** moderation queue paginated + verification queue localized (§20); Stripe E2E still BLOCKED (§19)
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

**Archived** (closed record, pushed at the time) →
[`history/archive/AI_Handoff-2026-09-23-production-verification.md`](history/archive/AI_Handoff-2026-09-23-production-verification.md).
Moved 2026-09-27 to keep this file under the ~55 KB edit limit. Headline: all 35
DB-gated tests executed for the first time on a disposable PostgreSQL (`452 pass /
0 fail / 0 skip`), the `releaseOrderInventory` double-release was found and fixed by
one guarded UPDATE, and R2/media enforcement moved server-side (10 MB cap + HeadObject
at every persistence point). The still-open catalog read stayed in §9.4.

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
- ~~**`GET /api/admin/products/moderation` is still fully unbounded**~~ **CLOSED
  (2026-09-26, §20).** Bounded via `backend/lib/pagination.ts` (default 25 / max 100,
  `p.created_at DESC, p.id DESC`, exact `pagination.total`, fallback count past the
  end); the queue renders one page with previous/next controls, and the executed
  evidence (9 real-DB/HTTP cases + 9 static guards) is in §20.
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
- ~~**VelCenter's verification queue labels are hardcoded Thai**~~ **CLOSED
  (2026-09-26, §20).** `SellerVerificationQueue.tsx` now renders every string through
  the existing `review.*` namespace (24 keys added to `thReview`/`enReview`/`myReview`;
  `i18n:check` **th=en=my=1319**). `ProductModerationQueue.tsx`'s copy is still
  hardcoded Thai (pre-existing; §20 added only its pagination bar).
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
- ~~**One corrupted UI string:** `SellerVerificationQueue.tsx:177`~~ **CLOSED
  (2026-09-26, §20).** Now `review.revokeSuccess` — `ระงับและลบร้านค้าแล้ว`
  ("Shop suspended and removed"): the revoke action's own copy names the **shop**
  (`ร้านค้า`), not a transliterated "retailer".
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
  category handler). **Working recipe (2026-09-26, §20):** a small `bun` script that
  asserts each anchor occurs exactly once, rewrites the file, and is deleted right
  after `git diff` + the tests confirm the result.
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

**Archived** (closed structural record) →
[`history/archive/AI_Handoff-2026-09-25-test-database-isolation.md`](history/archive/AI_Handoff-2026-09-25-test-database-isolation.md).
Moved 2026-09-26 (§20) to stay under the ~55 KB edit limit. The live rules are
[`.ai/context/testing.md`](context/testing.md) and `.github/workflows/test.yml`; the
guard is `backend/db/test-database.ts`. Still-open items stayed in §6 (add
`TEST_DATABASE_URL` to `.env.example` by hand if it is still missing).

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

**Archived** (closed record, pushed at the time) →
[`history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md`](history/archive/AI_Handoff-2026-09-25-ci-guard-fix.md).
Moved 2026-09-27 to make room for §22. The fix is live in
`.github/workflows/test.yml` (`env -u TEST_DATABASE_URL` plus the
accepted-target assertion) and CI has been green on every push since, including
`c2d3639` (run 36283775266). Live rules: [`.ai/context/testing.md`](context/testing.md).

## 18. Stripe TEST-mode E2E — independent re-verification (TASK 007, 2026-09-26)

**Archived** (BLOCKED record; its statements are mirrored into
[`.ai/context/payment.md`](context/payment.md)) →
[`history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md`](history/archive/AI_Handoff-2026-09-26-stripe-e2e-tasks.md).
Moved 2026-09-27 to make room for §23. **Stripe TEST E2E stays BLOCKED** (§6, §22):
credential gate unchanged, no PaymentIntent / PromptPay QR / webhook delivery / refund
ever executed, production payment readiness **NOT claimed**.

## 19. Production-readiness audit — risk-ordered (TASK 009, 2026-09-26)

**Archived** (closed record) →
[`history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md).
Moved 2026-09-27 to make room for §22. **PRODUCTION: NOT READY** and **PRODUCTION
PAYMENT READINESS: NOT CLAIMED** still stand; per-gate evidence is in
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md);
Stripe TEST E2E and production Browser / Google-OAuth / R2-authenticated E2E stay
**BLOCKED** (§6, §18).

## 20. Moderation-queue pagination + verification-queue i18n (2026-09-26) — archived

Full narrative: [`history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md`](history/archive/AI_Handoff-2026-09-26-moderation-pagination-i18n.md)
(this was the documented NEXT SPLIT; moved out on 2026-09-27). What stays live:

- `GET /api/admin/products/moderation` is bounded and returns `{products, pagination}`;
  `ProductModerationQueue.tsx` pages it (25) and its badge reads `pagination.total`.
- `SellerVerificationQueue.tsx` renders through the `review.*` namespace (24 keys added in
  th/en/my); the corrupted `ระงับและลบrêtailer แล้ว` string is fixed.
- Tooling note: both edits sat past the ~55 KB match window and were applied with a
  single-use `bun` anchor-asserting script (same idea as §11's `patch -p1`).
- Still open / unchanged: §19's release blockers (Stripe TEST E2E, browser/OAuth/R2 E2E,
  `velnox.com` NS delegation, §9.4 catalog reads, dead realtime channels);
  `ProductModerationQueue.tsx`'s other copy is still hardcoded Thai (pre-existing).

## 21. Production PostgreSQL 53000 — first pass (2026-09-27) — archived, see §22

Superseded by §22 (same incident, re-verified and classified as a provider-side Neon
consumption quota) and moved to
[`history/archive/AI_Handoff-2026-09-27-postgres-53000.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000.md).
What stays live:

- **Code fix from this pass — kept:** `POST /api/admin/sellers/:id/revoke` leaked one
  pool connection per call (no `finally`) — the only unreleased lease in the backend.
  Now releases in `finally` (`backend/routes/seller.ts`); `backend/tests/db-client-release.test.ts`
  guards it (non-vacuous against the pre-fix source). Unrelated to 53000, but a real
  service-wide outage trigger.
- **`backend/db/index.ts`** logs failed queries/connects with `operation` + statement
  keyword + PG `code`/`severity`/`message` only — never credentials or parameters.
- Pool: exactly one `pg.Pool` (`max: 20`) shared by HTTP + WS + scheduler; no schema
  change in that pass.

## 22. PostgreSQL 53000 — provider-side quota classified; provider action required (2026-09-27)

**New production evidence (with §21's safe logging deployed as `c2d3639`).** Render
logs now show `53000` on BOTH paths: `operation: connect` from
`backend/db/index.ts:70` (the `getClient()` failure logger) called by
`backend/routes/auth.ts:133` (`const poolClient = await getClient();` inside
`resolveUser()`), AND `operation: query` / `statement: SELECT`; the VelRepeat
scheduler fails the same way. ⇒ new connections are refused AND existing
connections are dropped. No OAuth code was touched.

**Classification — (B)+(E): a provider consumption quota was exhausted and Neon
suspended the project's compute. Not (A) connection limit, not (C) storage, not
(F) provider-wide.**
- Neon FAQ *"What are the limits and quotas for Neon's Free plan?"*
  (`neon.com/faqs/free-plan-limits-and-quotas`): *"CU-hours or network transfer
  used up: the project's compute is suspended until the next billing period or
  until you upgrade. **Existing connections drop and new ones can't open.**"* —
  a verbatim match to the two observed operations. Free-plan budget: **100 CU-hours
  per project per month** and **5 GB per project per month public network
  transfer**; computes scale to zero only after **5 minutes** of inactivity.
- **(A) excluded:** Postgres connection exhaustion is `53300` *"remaining
  connection slots are reserved for non-replication superuser connections"* —
  a different code and message (Neon's own support write-up uses `53300` for
  connection limits); the pool is 20 connections in one process (§21).
- **(C) excluded:** per the same FAQ, storage above 0.5 GB fails *inserts, updates
  and deletes that would increase storage* — connections and SELECTs keep working.
  A refused connect plus a refused SELECT contradict it.
- **(F) excluded:** the message is account/project-scoped.
- **Which of the two Free-plan metrics tripped is BLOCKED:** it needs Neon Console
  → project → Usage (or the Neon API). No credential exists in this workspace
  (`freebuff-env list` → `{}`), and the SELECT-only diagnostic workflow still cannot
  be dispatched — `gh workflow run diag-neon-schema.yml` → **HTTP 403 Resource not
  accessible by integration** (re-confirmed 2026-09-27; Actions *read* works —
  `gh run list` — Actions *write* does not). Last *proven* production-DB workflow
  connection: `migrate-neon.yml` run `36167403209` success at
  **2026-09-25T17:29:05Z**.

**Contributing factor (arithmetic, not a guess).** `startVelRepeatScheduler()`
(`server.ts:521`) polls with the default **60 s** interval
(`VELREPEAT_SCHEDULER_INTERVAL_MS`, floor 10 s) and every tick runs at least one
SELECT (`processDuePlans(25)`), forever. Neon's Free plan scales a compute to zero
only after **5 minutes** of inactivity, so a 60-second poll never allows an idle
window: the compute stays active 24/7 ≈ 0.25 CU × ~730 h ≈ **~182 CU-hours/month** —
~1.8× the 100 CU-hour allowance, enough to suspend the project ~16–17 days into a
monthly window with zero customer traffic. (Conditional on the project being on the
Free plan, which this workspace cannot read.) **No scheduler change was made:** the
root cause is a provider quota, and the brief forbids application-code changes that
hide that; the cadence is an owner decision.

**Connection findings (re-verified, unchanged).** Still exactly one `pg.Pool`
(`max: 20`, idle 30 s, connect timeout 5 s); THE one real leak (shop revoke) was
fixed in §21; every other lease releases in `finally`; the scheduler has no
overlapping ticks, no unbounded batches, no long-running transactions.

**Production verification (read-only, 2026-09-27).** `/api/health` 200 (it does not
touch the DB) · `/api/shops` → 500 `DB_ERROR` · `/api/categories` → 500 `DB_ERROR` ·
`/api/products` → 500 `DB_ERROR`. **DB CONNECT: FAIL** (provider-suspended) ·
**DB QUERY: FAIL** · **Google OAuth: BLOCKED** (downstream symptom; no authorized
test account) · **Scheduler: BLOCKED** (needs Render logs; same 53000 in the
reported logs).

**Owner action (PROVIDER ACTION REQUIRED).** Neon Console → project → **Usage**:
read CU-hours and public network transfer against the plan allowance (100 CU-hours /
5 GB on Free), then either upgrade to Launch or wait for the monthly reset —
compute resumes automatically and no data is lost. If the project came from the
Vercel Neon integration, the same limits are adjustable from Vercel → Integrations
→ Neon → manage → settings.

**Housekeeping:** superseded material lives in [`history/archive/`](history/archive/)
(dated index: `.ai/history/AI_Handoff_Archive.md`) — §5's 2026-09-22 passes and 2026-09-23
production-verification pass, §8,
§10, §12, §14's TASK 004B narrative, §17 and §19 (moved 2026-09-27), and (2026-09-26)
§2's verification system →
`.ai/context/verification.md` plus §15/§16's payment narratives →
`.ai/context/payment.md` + §18. This file sits **~46 KB against a ~40 KB soft
ceiling; 55 KB is the hard limit where editing stops working — measured 2026-09-26:
≤54.8 KB edits, ≥68.2 KB does not.
NEXT SPLIT: §22** — mirror its owner action (Neon console quota) into §6 first,
then archive the narrative; §20 and §21 are already archived (stubs above).
Text edits are measured safe to ≤54.8 KB; ≥68 KB fails. Keep §6 (gaps), §9.4/§9.5,
the §14 stub — and keep §18's BLOCKED statements, now mirrored in
`.ai/context/payment.md` (stub above). §21's first pass was archived
2026-09-27 (stub above) after §22 re-verified it; §25 is the newest record.

## 23. Seller application rejected documents it already had — evidence purpose parser fixed (2026-09-27)

**Symptom.** Applicant presigned + uploaded all three identity documents
(`purpose=id_card|id_card_back|selfie_id`, one `INSERT INTO media` each), then
`POST /api/seller/apply` → `400 IDENTITY_EVIDENCE_REQUIRED` — *"Missing required
identity documents: id_card, id_card_back, selfie_id"*.

**Root cause (reproduced with a real DB + HTTP test BEFORE the fix).** Evidence keys are
minted `verification/evidence/{owner}/{purpose}_{Date.now()}.{ext}`, so the purpose is the
filename text before the trailing `_{timestamp}`. Four call sites recovered it with
`filename.split("_")[0]`, which keeps only the first fragment: `id_card_back_1758….jpg` →
`"id"`, `id_card_…` → `"id"`, `selfie_id_…` → `"selfie"`. Submit therefore never saw any
of the three required purposes and rejected a complete application (`id_card_back` was
unreachable by construction). Upload, `media` rows (`uploaded_by`/`key`) and R2 objects
were all correct — OAuth, the DB outage and the confirm flow were not involved.

**Fix (no bypass, no new endpoint, no schema change).** New `backend/lib/evidence-purpose.ts`
— `evidencePurposeFromKey()` parses everything before `_{≥6 digits}` (fallback: leading
segment, the pre-fix behaviour). Wired into `/api/seller/apply`, `GET /api/seller/evidence`,
`GET /api/admin/verifications/seller/:id/evidence` and the reviewer evidence detail in
`seller.ts` (VelCenter document labels resolve again). Validation itself is untouched:
missing or foreign documents are still rejected, including the `media` ownership check.

**Verification (actually run).** New executed suite
`backend/tests/seller-apply-identity-evidence.test.ts` (real disposable PostgreSQL + real
HTTP): **4 fail / 2 pass before** the fix, **6 pass / 0 fail after** — all three documents
uploaded through the real evidence flow → 200, `sellers.status='pending'`,
`sellers.verification_status='pending'`, `seller_verifications.evidence_urls` = the 3 keys;
one document missing → 400 naming exactly `selfie_id`, no seller row created; no documents →
400 naming all three; another account's keys → 403. Full suite **608 pass / 2 skip / 0 fail**
(610 tests, 28 files; was 597/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`git diff --check` clean. The production applicant can resubmit: the failed attempt created
no seller row, and the three existing `media` rows now satisfy submit.

## 24. Seller access = approved application only — tab bar, authorization, revision flow (2026-09-27)

**Rule (unchanged, now enforced in ONE place).** `sellerAccess = true ⇔ sellers.status = 'approved'`.
`users.role` is a cached promotion, never the check; client-supplied `role` / `approved` /
`sellerAccess` / `userId` is never read.

**What was wrong.** velseller rendered its bottom tab bar unconditionally (static
`<MobileTabBar items={SELLER_TABS} />`), so the seller navigation was visible to signed-out users and
to every `pending` / `needs_correction` / `rejected` applicant. `GET /api/seller/profile` and
`PATCH /api/seller/shop` had no status check at all (any account with a `sellers` row could read its
profile and edit its shop), and `GET /api/seller/velrepeat/deliveries`, its delivery PATCH and
`/api/seller/velrepeat/overview` only checked that a `sellers` row existed. Product option
management resolved the seller with no status filter. A `needs_correction` resubmission also started
from an EMPTY form — previous shop data, applicant data and the three identity documents were never
reloaded.

**Changes.** New `backend/middleware/seller.ts` — `resolveSellerAccess(userId)` and
`requireApprovedSeller` (403 `SELLER_NOT_APPROVED`) — applied to `GET /api/seller/profile`,
`PATCH /api/seller/shop`, the three `/api/seller/velrepeat/*` dashboard routes and the
product-options seller lookup. The applicant flow (`apply`, `status`, `evidence*`, `verification`)
stays open by design: it is how an application is created, corrected and resubmitted.
`GET /api/seller/status` now returns a top-level server-computed `sellerAccess` plus `shop{…}` and
`applicantInfo.idNumber` for prefill. Frontend: `packages/shared/src/lib/seller-access.ts`
(fail-closed decision helpers) + `hooks/use-seller-application.ts` (own application from the cookie
session; refetch on focus/visibility so an approval lands without re-login); the velseller tab bar
renders only through `shouldShowSellerTab({sellerAccess, loading, error})` — hidden while loading, on
API error, and for every non-approved status; `RequireRole` prefills the previous application and
hydrates the three documents from `GET /api/seller/evidence` (own rows, matched by purpose), so a
correction resubmits the SAME application with the SAME documents.

**Verification (actually run).** New `backend/tests/seller-access-authorization.test.ts` (15 cases;
real disposable PostgreSQL + real HTTP): `sellerAccess` false for no-application / pending /
under_review / needs_correction / rejected / suspended, true only for approved; `GET /api/seller/profile`
and `PATCH /api/seller/shop` → 403 `SELLER_NOT_APPROVED` for every non-approved status (the shop is
provably unmodified) and 200 for approved; a pending applicant injecting
`role`/`approved`/`sellerAccess`/`status`/`userId=<approved account>` in the body still gets 403;
ownership isolation (an applicant cannot read the approved account's status, shop slug or documents —
the evidence list only ever returns the caller's rows). Full suite **624 pass / 2 skip / 0 fail**
(626 tests, 29 files; was 610/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`bun run build:apps` 4/4 exit 0 · `git diff --check` clean · **no schema change** (`db/` untouched,
no new field: `sellers.status` was already authoritative).

**Deliberately not changed.** No new endpoint, no new realtime channel (the WS client is chat-only;
the tab refetches on focus/visibility instead), and no change to the applicant-side endpoints. A
rejected applicant still re-applies with prefilled data (existing business rule); a suspended seller
simply loses the tab and the seller APIs. Stripe TEST E2E and browser/OAuth E2E remain BLOCKED
(§6, §22).

## 25. Verification queue: new vs resubmitted + realtime state sync (2026-09-27)

1. **Queue separates new from resubmitted (server-side).** `GET /api/admin/verifications` now returns
   `application_type` (`new|resubmitted`) and `resubmission_count`, counted in the SAME query from
   `seller_review_history` (`COUNT(*) … WHERE action = 'resubmitted'`, `LEFT JOIN LATERAL`) — per seller,
   never from the request, the page, or local state. `resubmission_count = 0 ⇒ "new"`; the brief's
   example (submitted → needs_correction → resubmitted ×2) reports **2** and can never fall back to "new".
2. **The history now records the truth.** `POST /api/seller/verification` wrote `submitted` on every
   submit, so a resubmit through MyShop was invisible; it now writes `resubmitted` whenever the seller
   already has review history (`POST /api/seller/apply` already did). Rejection → re-apply counts too.
3. **Missing broadcasts wired.** `POST /api/seller/apply` and `POST /api/seller/verification` emit
   `CHANNELS.SELLER_UPDATED` / `seller:status-changed` after COMMIT (`routes/seller.ts` imported
   `broadcast` but never called it), so an open VelCenter refetches the queue the moment an applicant
   submits or resubmits.
4. **ROOT CAUSE of "toast says done, UI unchanged": the shared GET cache.** `packages/shared/src/lib/api-routes.ts`
   caches every `apiGet` for 60 s but only `apiPost` invalidated it — `apiPatch`/`apiPut`/`apiDelete`
   left the stale body in place, so the refetch each mutation already performed replayed PRE-write data
   (category on/off toggle, review decisions, seller status, settings). All four mutation helpers now
   clear the cache before their request, and mounted `useQuery` readers re-run through a mutation
   invalidation bus — no new fetch layer, no optimistic UI, server stays the source of truth.
5. **UI.** VelCenter queue rows show a type chip (existing `review.actionSubmitted` /
   `review.actionResubmitted` ×N — all three locales, no new copy needed) next to the status badge;
   `useSellerApplication` also listens to `notification:created` on the EXISTING per-user chat socket and
   refetches on `seller*` notifications, so a reviewer decision reaches an open seller session without
   logout/login (still one socket per app; VelCenter still owns the only one in velcenter).

**Tests (executed, disposable PostgreSQL + real routes).** New `backend/tests/seller-resubmission-queue.test.ts`
(8 cases: new=0, resubmitted=1/2 through the REAL submit → needs_correction → submit cycle, per-seller
isolation, rejection → re-apply = 1, reviewer-only 403, no `evidence_urls` leak) and
`backend/tests/center-seller-state-sync.test.ts` (15 cases: executed cache test proving GET→PATCH→GET
hits the network again and returns the post-mutation body, failed mutation still reconciles, plus the
broadcast/event-bus/refetch wiring contracts and “one socket per app”). Full suite **647 pass / 2 skip /
0 fail** (649 tests, 31 files; was 624/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`bun run build:apps` 4/4 exit 0 · `i18n:check` th=en=my=1319 · `git diff --check` clean.

**No new system:** no endpoint, no channel, no table, no schema change (`db/` untouched), no mock data.
**Still not verified:** no browser/preview run and no paid-provider E2E — Stripe TEST + DNS blockers
(§6) are unchanged.

## 26. Approval = ONE decision: seller access + reviewer badge (2026-09-27)

**Root cause of both reported symptoms (a single cause).** The two VelCenter Approve
buttons each wrote HALF of the same decision:

- `PATCH /api/admin/verifications/seller/:id` (`action=approve`) set
  `seller_verifications.status='verified'` + `sellers.verification_status='verified'`
  and left **`sellers.status='pending'`** — the authoritative field
  (`GET /api/seller/status` → `data.status`; `sellerAccess = status==='approved'`;
  `RequireRole` gates on it). An approved applicant therefore still got `pending`: the
  "รอตรวจสอบ 1–3 วัน" screen (VelSeller workspace blocked) and a seller the badge kept
  counting.
- `PATCH /api/admin/sellers/:id/status` → `approved` left the verification record
  `pending`, so the verification queue/badge kept a row a reviewer had decided.

Copy, JWT claims, in-memory auth state and Next/React caches were NOT the bug — the
database said `pending`.

**Fix (state, not text).** (1) the verification-queue approve now writes BOTH sides in
one transaction — `sellers.status='approved'`, `verification_status='verified'`,
`verified_at`, plus the same `users.role='seller'` promotion the account path does —
and refuses to approve a `rejected`/`suspended` ACCOUNT (400 `INVALID_TRANSITION`)
before any write. (2) the account approve resolves the verification record
(`status='verified'`), gated on `status IN ('pending','unverified')` AND
`jsonb_array_length(evidence_urls) > 0` (no V without proof) and parameterised, so the
"no literal grant" guard still holds. (3) The sidebar badge is the reviewer-work
COUNT: `pendingReviewSellers = COUNT(*) WHERE status IN ('pending','under_review')`,
added to the EXISTING `/api/admin/dashboard/counts`; `approved` is excluded by the
query itself and the page reads that field instead of a fetched list — no frontend
decrement, no new endpoint. (4) The queue raises the existing center-events "sellers"
signal after a confirmed decision and the Center page re-reads its counters, so the
badge drops immediately in the acting tab as well as in other tabs (`seller:updated`).

**Tests (executed; disposable PostgreSQL + real routes).** New
`backend/tests/seller-approval-access.test.ts` (10 cases): pending → `sellerAccess:false`
+ 403 `SELLER_NOT_APPROVED`; verification-queue approve → DB both-sides approved +
`role='seller'`, `sellerAccess:true`, `GET /api/seller/profile` **200**, reviewer-work
count −1, queue row gone; `needs_correction`/`rejected` → 403; suspended account
unapprovable (400, nothing written); account approve resolves the verification record;
the count excludes approved/rejected/needs_correction and equals the DB's
`IN ('pending','under_review')` count; badge wiring guards. Updated:
`verification-self-approval.test.ts` (two guarded, evidence-gated badge paths, still no
literal grant), `admin-queue-pagination.test.ts`,
`center-seller-state-sync.test.ts`. Full suite **658 pass / 2 skip / 0 fail** (660 tests,
32 files; was 647/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 ·
`build:apps` 4/4 · `i18n:check` th=en=my=1319 · `git diff --check` clean · no schema
change, no new endpoint/table/socket.

**Notes.** No browser run here (no browser/test account), so the UI change is verified
at typecheck + build + the executed API/DB layer, not visually. Applicants approved by
the OLD code still have `sellers.status='pending'` (their verification record is
`verified`): re-approving once — from either button — converges the state.
