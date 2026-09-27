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

**Archived** (closed record) →
[`history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md`](history/archive/AI_Handoff-2026-09-26-production-readiness-audit.md).
Moved 2026-09-27 to make room for §22. **PRODUCTION: NOT READY** and **PRODUCTION
PAYMENT READINESS: NOT CLAIMED** still stand; per-gate evidence is in
[`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md);
Stripe TEST E2E and production Browser / Google-OAuth / R2-authenticated E2E stay
**BLOCKED** (§6, §18).

## 20. Moderation-queue pagination + verification-queue i18n (2026-09-26)

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

## 21. Production PostgreSQL 53000 — provider quota (BLOCKED evidence); one real pool leak found and fixed (2026-09-27)

**Report.** Render logs: `code: '53000'` — *"Your account or project has exceeded
the quota. Upgrade your plan to increase limits."* — at `backend/routes/auth.ts:133`
(`resolveUser()`) and `backend/jobs/velrepeat-scheduler.ts:445` (`processDuePlans()`),
both through `backend/db/index.ts` (pg-pool). Google OAuth callbacks failed after
reaching the backend.

**1. `53000` = a provider-side Neon quota, not this codebase.** `53000` is PostgreSQL
`insufficient_resources` (class 53, generic). That exact message is Neon's quota
rejection: `neon.com/docs/guides/consumption-limits` — when any configured/plan
consumption metric (`active_time_seconds`, `compute_time_seconds`,
`written_data_bytes`, `data_transfer_bytes`, or the account/project cap) is met,
Neon suspends every compute of the project, and the suspension persists until the
next billing period unless the quota is raised. In the wild the same code + message
appears for the data-transfer variant (`Code: 53000 … Your project has exceeded the
data transfer quota`) and through the driver as HTTP 402. **Which quota** cannot be
read from this workspace — `freebuff-env list` is empty (no `DATABASE_URL`, no Neon
key) → **BLOCKED — provider quota/usage evidence unavailable**; the owner must read
Neon Console → project → Usage/Billing (or the Neon API `Get project` metrics). No
code change can lift a suspended compute, and none was attempted.

**Live production evidence (read-only, 2026-09-27).** `/api/health` 200 (it does not
touch the DB); `/api/health/r2` 200; **`/api/shops` → 500 `DB_ERROR`** and
**`/api/categories` → 500 `DB_ERROR`** — the DB path is failing *now*, consistent
with a persistent suspension. Render logs are not reachable from this workspace.

**2. The code did not exhaust that quota (measured, not assumed).** Exactly ONE
`pg.Pool` (`backend/db/index.ts:16`; repo-wide grep finds no second pool or client);
`max: 20`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 5000`. HTTP +
WebSocket + the VelRepeat scheduler share it in one process (`server.ts` starts
`startVelRepeatScheduler()` at `server.ts:521`). The repo has no `render.yaml`; docs
describe a single Render web service (`docs/DEPLOYMENT.md:21`) — the live instance
count is dashboard-only → BLOCKED. Scheduler: an in-process `running` mutex, a
bounded `LIMIT 25` batch processed sequentially, cross-instance safety via
`FOR UPDATE` + `UNIQUE (plan_id, scheduled_for)`; no overlapping ticks, no unbounded
batch. A connection-limit problem would surface as `53300` `too_many_connections` or
a node-postgres pool timeout — not `53000`.

**3. One real connection leak existed — found and fixed (proven by source, then by
executed test).** `POST /api/admin/sellers/:id/revoke` (`backend/routes/seller.ts`,
lease at :1263) was `try/catch` with **no `finally`**: every call — 403, 400, 404,
success and error — permanently consumed one of the pool's 20 connections until the
process restarted. It was the only unreleased lease (the other ten `getClient()`
sites release in `finally`; `withTransaction` always did). A real latent service-wide
outage trigger (it would eventually starve auth too), but **NOT** the 53000: it
produces pool timeouts, not a provider quota error, and it is unrelated to the OAuth
callback path. Fixed with `finally { client.release(); }`; pool `max` unchanged.
`pool.on("error") → process.exit(-1)` (`db/index.ts:23`) is left as the documented
upstream pattern, flagged here: during a provider suspension that kills idle
connections it converts the outage into process restarts.

**4. Safe failure logging.** `backend/db/index.ts` now logs every failed
query/connect with `operation`, the statement keyword, and PostgreSQL
`code`/`severity`/`message` only — never the connection string, credentials,
cookies, or parameters (which may carry PII). The next 53000 is classifiable
straight from Render logs. No behavior change.

**Changes.** `backend/routes/seller.ts` (+5), `backend/db/index.ts` (+31/−3), new
`backend/tests/db-client-release.test.ts` (7 cases). No schema change (`db/`
untouched).

**Tests (executed).** Disposable PostgreSQL 14 `velnox_test` (59 tables) +
`JWT_SECRET`: full suite **602 pass / 2 skip / 0 fail** (604 tests, 27 files) — 7 of
them new; the 2 skips are the pre-existing R2-credential cases. The static guard is
proven non-vacuous: against the committed pre-fix `seller.ts` it reports
`{leases:[168,836,1263], releases:[328,1107], guardWouldPass:false}`. Runtime proof:
the revoke returns 200 + `sellers.status='suspended'` and `pool.idleCount` returns to
baseline; the 403 path does too; the negative control shows the probe detects a
deliberately unreleased client (idleCount one lower) and recovers after `release()`.
Backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 · `i18n:check` th=en=my=1319 ·
`db/schema.sql` ≡ `db/run-sqleditor.sql` · no `db/run-update.sql` · `git diff --check`
clean.

**Production tiers.** DB HEALTH **FAIL** (two DB-backed GETs 500 while `/api/health`
stays 200) · AUTH DB PATH **BLOCKED** (same suspension; no authorized account) ·
GOOGLE OAUTH **BLOCKED** (no test account + no deploy) · SCHEDULER **BLOCKED** (needs
Render logs). Clearing the 53000 needs the provider quota raised/reset — not a code
deploy. **Not claimed:** the quota is not fixed and OAuth was not verified in
production.

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
`.ai/context/payment.md` + §18. This file sits **~51 KB against a ~40 KB soft
ceiling; 55 KB is the hard limit where editing stops working — measured 2026-09-26:
≤54.8 KB edits, ≥68.2 KB does not.
NEXT SPLIT: §18** — only after its BLOCKED statements are mirrored into
`.ai/context/payment.md`. Text edits are measured safe to ≤54.8 KB; ≥68 KB fails. Keep §6 (gaps), §9.4/§9.5, and the §14
stub — and keep §18's BLOCKED statements.
