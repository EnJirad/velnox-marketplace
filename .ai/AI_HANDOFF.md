# Velnox AI Handoff — current state

**Last updated:** 2026-09-28 · **Branch:** `main` · **Latest pass:** DB latency root cause — the pool idled down to zero, so connection establishment landed on the first statement of the minute (§34)
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

- **Stripe sandbox round trips have still never been driven by an agent** (§27, §18). The
  owner **completed the configuration step** — verified read-only 2026-09-27: production
  reports `{configured:true, mode:"test", webhookConfigured:true}` and
  `/api/payments/methods` offers **CARD + PROMPTPAY** (COD disabled); the key is a
  `pk_test_…`. What is still unproven is the round trip itself: no PaymentIntent, PromptPay
  QR, webhook delivery or refund has ever been executed **from this workspace**
  (`freebuff-env list` → `{"files":{}}`), so those remain **CODE VERIFIED, never PASS** —
  and driving them in production means taking money in the owner's own account, which is
  not a substitute for a sandbox test. `STRIPE_CONNECT_MISSING`: no Connect, no payout
  (checkout readiness ≠ payout readiness). Variable names: `INSTALLATION.md` §4 + reference
  table and `docs/ENVIRONMENT.md`; `.env.example` is protected from agent edits (owner edit).
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
guard is `backend/db/test-database.ts`. Still-open items stayed in §6. The variable names
are now documented in `INSTALLATION.md` §4 + its *Backend (ALL secrets)* table and
`docs/ENVIRONMENT.md` (§27); `.env.example` still lacks them — that path is in the agent
tooling's protected set, so it stays an owner edit.

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

**Archived** (closed record; conclusions unchanged) →
[`history/archive/AI_Handoff-2026-09-27-postgres-53000-classified.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000-classified.md).
Moved 2026-09-27 to make room for §27 (this was the documented NEXT SPLIT). What stays live:
production threw `53000` on **connect AND query** (a provider consumption quota had
suspended the project's compute, not a connection-limit or storage failure); the DB is
**reachable again** (verified read-only 2026-09-27 08:09Z — `/api/shops` 200 with real
rows, where §22 saw 500 `DB_ERROR`). The VelRepeat 60 s poll (≈182 CU-h/month vs the
100 CU-hour Free-plan allowance) is still an **owner cadence decision**, and the plan's
Usage figures are still unreadable from a workspace — see §27 for the current owner action.

**Housekeeping:** superseded material lives in [`history/archive/`](history/archive/)
(dated index: `.ai/history/AI_Handoff_Archive.md`) — §5's 2026-09-22 passes and 2026-09-23
production-verification pass, §8,
§10, §12, §14's TASK 004B narrative, §17 and §19 (moved 2026-09-27), and (2026-09-26)
§2's verification system →
`.ai/context/verification.md` plus §15/§16's payment narratives →
`.ai/context/payment.md` + §18. 55 KB is the hard limit where editing stops working
(measured 2026-09-26: ≤54.8 KB edits, ≥68.2 KB does not). **NEXT SPLIT: done — §27 archived 2026-09-27 by §31** (an archived record); §28/§29/§30 are the live records. **Done
2026-09-27:** §21–§22 stubs above, and §23–§26 moved verbatim to
[`history/archive/AI_Handoff-2026-09-27-closed-records.md`](history/archive/AI_Handoff-2026-09-27-closed-records.md).
Keep §6 (gaps), §9.4/§9.5, the §14 stub, and §18's BLOCKED statements.

## 27. Stripe Sandbox/Test-Mode audit (2026-09-27) — archived; configuration since COMPLETED

**Archived verbatim** → [`history/archive/AI_Handoff-2026-09-27-closed-records.md`] (the
audit table, credential-gate proof, executed-evidence log incl. CI run `36305688863`, the
env-var documentation change, and the Connect finding). Configuration is DONE (owner);
`.env.example` still lacks the Stripe/COD lines (protected file — owner edit). That pass
ended: audit PASS, no code changed, sandbox E2E BLOCKED — §31 is the live settlement
record.

## 28. velShop MyOrders status contract + velShop cart selection (2026-09-27) — archived

**Archived verbatim** → [`history/archive/AI_Handoff-2026-09-27-velshop-orders-cart.md`](history/archive/AI_Handoff-2026-09-27-velshop-orders-cart.md)
(sections 28 and 29 together, 2026-09-28, for edit headroom). What still stands: render
`orders.status` only through `getOrderStatusMeta()` (the column is free text and also carries the
payment-lifecycle values this backend writes), and cart selection is derived client state that
calls no API. Both are pinned by `order-status-contract.test.ts` / `cart-selection.test.ts`.
Browser E2E for `/orders` and `/cart` stayed open (a signed-in Google session is needed).

---

## 29. velShop cart — marketplace selection + sticky summary (2026-09-27) — archived

Moved together with §28 → [`history/archive/AI_Handoff-2026-09-27-velshop-orders-cart.md`](history/archive/AI_Handoff-2026-09-27-velshop-orders-cart.md).

---

## 30. VelShop checkout → Stripe in ONE press + resume payment (2026-09-27) — archived

**Archived verbatim** (2026-09-27, to keep this file editable) →
[`history/archive/AI_Handoff-2026-09-27-velshop-checkout-onepress.md`](history/archive/AI_Handoff-2026-09-27-velshop-checkout-onepress.md).
One-press CARD/PromptPay checkout + the shared `ResumePaymentButton`, and the rule it
established that still stands: `POST /api/payments/stripe/webhook` is the **only** writer of
`orders.status = 'paid'`. Its browser E2E against Stripe remained open, and the payment
narrative lives in `.ai/context/payment.md`.

---

## 31. PromptPay settlement diagnostic — order stuck `pending_payment` (2026-09-27)

**Task:** explain why a customer's successful sandbox PromptPay payment left the order at
`pending_payment` / "รอชำระเงิน" with a "ชำระเงินต่อ" button instead of `paid`.
**Diagnostic only — no production code was changed** (the brief forbids fixing before the
root cause is classified, and every code-contract check passed).

**Verified from here (evidence):**
- Deployed backend: `GET /api/stripe/configured` → `{configured:true, mode:"test",
  webhookConfigured:true}`; `GET /api/payments/methods` → `CARD→card`,
  `PROMPTPAY→promptpay`, COD disabled. Test mode only; **no `STRIPE_*` credential exists in
  this workspace** (`freebuff-env list`: DATABASE_URL, Google, JWT, R2 only).
- `backend/routes/stripe.ts` has every settlement handler: `checkout.session.completed`
  guarded by `sessionConfirmsPayment` (an unpaid PromptPay completion never marks paid),
  `async_payment_succeeded` → `markPaymentSucceeded`, `async_payment_failed`,
  `expired`, `payment_intent.succeeded|payment_failed|canceled`; the session sets
  `metadata.orderId` **and** `payment_intent_data.metadata`. Local
  `payment-foundation.test.ts`: **59 pass / 2 skip / 0 fail**.
- Render runs **≥2026-09-25 code** (its responses carry `webhookConfigured` /
  `stripePaymentMethodType`, both introduced in `b806be1`), so the async handlers are live.
- Webhook endpoint probed live: no signature → 400 "Missing stripe-signature header";
  forged signature → 400 "Invalid signature" ⇒ route reachable, Stripe configured (a missing
  config answers 503 first) and `constructEventAsync` executes and rejects.
- §28 above: a production order moved `pending_payment → paid` "seconds after a successful
  test-mode checkout" the same day ⇒ endpoint URL, signing secret, handler and DB write
  path have **demonstrably worked at least once** — a global webhook failure is ruled out.
- The stuck order was created **2026-09-27 11:23:09Z** (public catalog `lastOrderedAt` on
  the only published product = `MAX(orders.created_at)` over its non-cancelled orders),
  i.e. minutes after the one-press checkout shipped (`cfee0bd`, 11:20Z).

**Classification (best fit, NOT final):** the global path works, so the failure is on the
**PromptPay-specific leg** — leading **B: `checkout.session.async_payment_succeeded` never
delivered** (its `enabled_events` selection is unknown from here; if the endpoint was
created with only `checkout.session.completed`, PromptPay can never settle — the full event
list was only documented in `docs/ENVIRONMENT.md` today, `86211a2`). Alternates: **A**
(the test payment never reached `payment_status=paid` on Stripe's side) and **E** (a
per-event handler failure recorded in `payment_events`). Ruled out: D/global signature or
wrong endpoint URL (§28 settled an order), H/I/J (nothing diverges below the DB), and any
application-code defect (the code both refuses the unpaid-session trap and would settle the
async event if it arrived).

**Blocked reads — both owner-side:**
1. **Stripe side.** No test key here ⇒ endpoint `enabled_events`, delivery attempts and the
   stuck session's real `payment_status` cannot be inspected. Unblock: add the **test**
   `STRIPE_SECRET_KEY` (`sk_test_…`) under Settings → Environment (it is never printed), or
   paste Dashboard → Developers → Webhooks → endpoint → enabled events + the delivery
   attempt (HTTP status/response) for the stuck session.
2. **Database side.** Every credential available here is refused by the provider 53000
   quota (§22): workspace `.env` `DATABASE_URL` **and** the Actions secret
   `NEON_DATABASE_URL` fail on pooler *and* direct endpoints (local trace + Actions run
   `36318662893`, 2026-09-27), while the deployed backend serves fresh DB reads ⇒ whether
   those URLs are even the project Render uses is itself an owner check. Unblock: restore
   the Neon quota, then re-run the trace workflow below.

**New tool (kept):** `.github/workflows/diag-stripe-payment-trace.yml` (commit `da39976`,
push-verified) — SELECT-only aggregates: payments by rail/status, the `payment_events`
delivery record by type/status, failed-handler errors, settlement mismatches. **Aggregates
only, because this repository is PUBLIC**; the secret is referenced as
`psql "$NEON_DATABASE_URL"` and never echoed. It triggers on push of the file itself
(`workflow_dispatch` is 403 for the app token). Its first run produced the quota evidence
above.

**Decisive next reads (any one settles B vs A vs E):** (i) does the Stripe endpoint list
`checkout.session.async_payment_succeeded` in `enabled_events`? (ii) does `payment_events`
contain any async row dated 2026-09-27? (iii) what is the stuck Checkout Session's
`payment_status`? Official PromptPay test procedure (docs.stripe.com/payments/promptpay):
in test mode click **Generate QR code**, scan it with any QR app, then **authorize** on the
Stripe-hosted test page — only that authorization completes the payment.

**Doc hazard spotted (recommendation, not fixed):** `INSTALLATION.md` (§4 example and the
`VITE_API_URL` table) uses `https://velnx-api.onrender.com`, which answers **404 on every
route**; the real backend — confirmed from the deployed `velshop.vercel.app` bundle — is
`https://velnox-api.onrender.com`. A Stripe webhook pointed at the `velnx` host would
deliver nothing.

---

## 32. Stripe webhook never answers in production — unbounded DB waits (2026-09-27)

**Reported.** A REAL signed event forwarded to `POST /api/payments/stripe/webhook`
(`velnox-api.onrender.com`) times out — *"context deadline exceeded (Client.Timeout exceeded
while awaiting headers)"* — while `GET /api/stripe/configured`, `/api/payments/methods` and the
DB read `/api/shops` all answer 200.

**Measured (read-only; `freebuff-env list` → `{}`).** The Stripe CLI aborts a forwarded
delivery after **30s** (stripe-cli#710). Production answers every pre-DB path fast (no/forged
signature → 400, chunked → 400, 300 KB body → 500, all ≤0.3s), so routing, the raw-body
branch and `constructEventAsync` are healthy. The stall is the only work between the
signature check and `res.json()`: the `payment_events` claim, `handleStripeEvent`, and the
payment/order writes.

**Root cause.** `backend/db/index.ts` bounded only ACQUIRING a connection
(`connectionTimeoutMillis`); node-postgres applies no per-query deadline, so a statement the
server never finishes (Neon compute scaled to zero, pooler restart, blocked row lock) left the
webhook pending until the CALLER gave up. Second cause: `pool.on("error")` called
`process.exit(-1)`, so a routine Neon idle-close restarted the service mid-request.

**Fix.** `query_timeout: 15000` (in-process; NOT `statement_timeout`/`lock_timeout`/
`idle_in_transaction_session_timeout` — startup parameters PgBouncer on Neon rejects). Pool
error handler logs safe fields and keeps the pool alive; the webhook logs secret-free stage
timings. No schema change, `db/` untouched, no payment state altered.

**Verified.** `webhook-resilience.test.ts` 10 pass/0 fail · backend suite 676 pass/91 skip/0
fail · backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `diff
--check` clean. **NOT production-verified** (no credential/DB here). Owner: after redeploy,
`stripe trigger payment_intent.succeeded` via `stripe listen --forward-to …/api/payments/
stripe/webhook` must return 2xx with no timeout and log the stage lines; never copy the CLI
signing secret into `STRIPE_WEBHOOK_SECRET`.

**Open:** a `payment_events` row left `processing` is re-armed only on a `failed` retry (§31).
§30 is archived; §§28–§29 joined it on 2026-09-28 (§34).

---

## 33. Stripe webhook 400 "No signatures found matching the expected signature" — the boundary made self-identifying (2026-09-27)

**Reported.** `stripe listen --forward-to …/api/payments/stripe/webhook` → `[400]`, Render log
`[stripe webhook] signature verification failed: No signatures found matching the expected
signature for payload.` (A different symptom from §32's timeout — same route.)

**Proven in production by probe (executed, read-only):** no signature → 400, forged signature →
400 (routing + `constructEventAsync` alive), and — the decisive discriminator — a **150 KB
valid-JSON body on the webhook path answers 500** (body-parser `entity.too.large`, the *raw*
parser's 100 KB default) while the same body on another path answers 404 (the JSON parser's 1 MB
limit accepts it). So the deployed revision really does read this route's body with
`express.raw`: **verification sees the exact signed bytes.** The production `pk_test_…` and the
reported `pi_3UKKDBKp4iwMdWLy0TvMGUuZ` also share the token `Kp4iwMdWLy` (one test-mode account;
corroborating only).

**Root cause of the reported 400.** A `stripe listen --forward-to <production-url>` session signs
with its **own per-session secret**, which is a different secret *by design* from the Dashboard
endpoint's — so forwarding a CLI session into production **must** 400 unless production's
`STRIPE_WEBHOOK_SECRET` is that session's secret, which the rules forbid. The one cause that
would break **real** deliveries is a **value mismatch**: the variable is not `velpay`'s signing
secret (leftover CLI secret, a secret from a deleted/recreated endpoint or another account, or a
value pasted with wrapping quotes). `webhookConfigured: true` cannot distinguish them — it is
true for a value that verifies nothing — and Stripe's API cannot either: an endpoint's `secret`
is **returned only at creation** (`GET /v1/webhook_endpoints` never re-exposes it), so alignment
is a Dashboard read.

**Fix (code, minimal — no schema, no payment-logic, no auth/CORS change).**
- `backend/middleware/stripe-raw-body.ts` (new) — the raw-body gate as an exported, testable
  module: matches the path as Express routes it (case-insensitive, trailing slash) and does
  **not** gate on `Content-Type`. Mounted in `server.ts` before `express.json()`; the inline copy
  it replaces is gone (tests used to mirror that copy, so a `server.ts` regression could not fail).
- `backend/routes/stripe.ts` — a non-raw body is refused with **500 "Webhook body was not
  preserved for signature verification"** instead of the misleading 400, and the stages
  `webhook_received` (body kind + byte count only) → `signature verified` → `claimed —
  dispatching` → `processed` are logged with elapsed ms. Never a secret/signature/payload/cookie.
- `backend/lib/payment-config.ts` — `webhookSecretHealth()`: shape-only (`shapeUsable`, `whsec_`
  prefix, coarse length bucket, wrapping quotes, interior vs surrounding whitespace), returned by
  `GET /api/stripe/configured`. No character of the value is derivable from it.
- `GET /api/stripe/configured?selfTest=1` → `webhookSignatureSelfTest`, which signs a throwaway
  payload with the deployed secret and verifies it through the same SDK call the webhook uses:
  `verified: true` rules out the raw-body cause and any WebCrypto/runtime defect, `false` is a
  code defect. (Found on the way: `generateTestHeaderString` has the same sync/async trap as
  `constructEvent` — the async form is required.)

**Verified here.** new `stripe-webhook-raw-body.test.ts` **13 pass/0 fail** ·
`payment-foundation.test.ts` 67 pass/2 skip/0 fail (`buildApp` now uses the real middleware) ·
full backend suite **697 pass / 91 skip / 0 fail** (788 tests/37 files; was 676/91/767) · backend
`tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `git diff --check` clean.
Docs: `docs/ENVIRONMENT.md` + `.ai/context/payment.md` (the three causes, in the order to check
them); **`INSTALLATION.md` wrong host fixed** (`velnx-api` → `velnox-api`) — the §31 hazard.

**NOT verified here (owner-side: no Stripe credential, no Render env, no DB reach).** Proof chain
after the redeploy carrying this commit: (1) `GET /api/stripe/configured` contains
`webhookSecretHealth` ⇒ the host runs this revision; (2) `?selfTest=1` → `verified: true`;
(3) Dashboard → Developers → Webhooks → `velpay` → **resend a real delivery** → `2xx` + a
`signature verified`/`processed` line in Render's log; (4) the DB row changes. **Step (3) is the
only authoritative E2E — a CLI forward is not**, by definition.

**DB read verdict:** CI's only URL is quota-refused while production's own DB read serves — see
`.ai/context/payment.md`. Still no `payment_events`/`payments`/`orders` row reachable here.

**DB perf (that brief's §12) — investigated, no change made.** The `velrepeat_plans` due-query is
covered by the matching partial index `idx_velrepeat_plans_due (status, next_run_at) WHERE status
= 'active'` in **both** `db/schema.sql` and migration `034`, and it is the FIRST query of every
`startVelRepeatScheduler()` tick: interval **60 s** vs pool `idleTimeoutMillis: 30000`, so each
tick's first query pays a fresh TCP+TLS+Neon handshake (~1.2–1.5 s) over the ~0.2 s baseline. Not
a plan problem and **not** the webhook cause; an index/pool change needs a measurement that
separates connect time from execute time. **That measurement was made in §34 — the diagnosis
above was right about the handshake and was fixed there.**

---

## 34. DB latency — the pool idled down to zero, so connection establishment landed on the first statement (2026-09-28)

**Reported (production log).** The order-detail `refunds` query (`SELECT id, amount, status,
reason, created_at, refunded_at FROM refunds WHERE order_id = $1 ORDER BY created_at ASC`) at
**1519–1538 ms** and the VelRepeat due-plan scan (`SELECT id FROM velrepeat_plans WHERE status =
'active' AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT $1`) at **1515 ms**, while other
statements in the same window ran **205–225 ms**.

**Root cause: connection acquisition — neither query is slow, and neither needs an index.**
`idx_refunds_order (order_id)` matches the refunds predicate exactly;
`idx_velrepeat_plans_due (status, next_run_at) WHERE status = 'active'` (in **both**
`db/schema.sql` and migration `034`) matches the VelRepeat WHERE + ORDER BY exactly. The two slow
statements share no table, index or SQL — the only thing they shared was *being the first
statement to run on an empty pool*. With `max: 20`, `idleTimeoutMillis: 30000` and **no floor**,
this bursty low-traffic workspace left the pool empty for most of every minute, and
`pool.query()` reported checkout **+** execution as ONE number, so the ~1.3 s TCP/TLS/auth
handshake to Neon was logged as if it were query time. The 60 s VelRepeat tick (> the 30 s reap)
paid it once a minute; any request arriving after the pool idled out paid the same cost.

**Proven in production by measurement** (executed read-only from this workspace; three pairs of
`GET /api/shops?cb=…` — a DB-backed route, *not either reported query* — each after 40 s of no
traffic): pair 2 **1.627 s cold → 0.388 / 0.357 s warm**; pair 3 **1.738 s cold → 0.379 / 0.376 s
warm**; `/api/health` (no DB) 0.144–0.193 s throughout; pair 1 landed while the pool was still
warm (0.393 / 0.489 / 0.395 s) — itself consistent with the mechanism. A fixed ~1.3 s that
vanishes on an immediate repeat is connection establishment, and it is the same number as the two
reported queries.

**Fix — `backend/db/index.ts` only** (no schema, no index, no payment code):
- **`min: 1`** warm floor. pg-pool arms its idle-reap timer only while `_clients.length > min`, so
the last client is never reaped and the next caller (including the scheduler tick) reuses it;
a burst still trims back to one. No proactive refill: a server-closed client is replaced and kept
warm again by the next query.
- **`maxLifetimeSeconds: 1800`** bounds that now-persistent connection's age (pg-pool client-side
timer — no startup parameter) so it cannot outlive a Neon pooler maintenance window.
- **`query()` times the lease and the statement separately** and logs `acquire Xms + execute Yms =
Zms, layer=pool-connection|statement, pool idle/total/waiting` — the measurement §33 asked for.
`layer` comes from the new exported `classifySlowQuery()`. Deliberately NOT added: `keepAlive`
(pg turns it into the `keepalives` startup parameter, which Neon's PgBouncer rejects — the hazard
that already keeps `statement_timeout` off this pool).

**No index added, on evidence.** `(order_id, created_at)` was the other candidate; the ~1.3 s is
not in the plan, both access paths are already covered, and an index whose cost is dominated by
something else only adds write cost. Owner can re-confirm with `EXPLAIN (ANALYZE, BUFFERS)`
(read-only procedure in `.ai/context/database.md`).

**Verified here.** new `db-latency.test.ts` **12 pass / 2 skip / 0 fail** · full backend suite
**709 pass / 93 skip / 0 fail** (802 tests/38 files; was 697/91/788) · backend `tsc` 0 ·
`typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `git diff --check` clean. Nothing under
`backend/routes/` changed, so the webhook's raw body, signature verification, `payment_events`
idempotency and state machine are as §32–§33 left them — re-proved by re-running that suite.

**After the fix — measured in production, executed** (post-deploy; one `GET /api/shops` after each
idle gap, then an immediate repeat): 5 s → **0.356 / 0.352 s**; 20 s → **0.400 / 0.354 s**; 40 s →
**0.482 / 0.401 s**; 70 s → **0.420 / 0.399 s**. The same 40 s gap that read **1.627 / 1.738 s**
before the fix now reads **0.48 s**, and the penalty stays gone at 70 s — the signature of
`min: 1` (pg-pool arms no reap timer for the last client, so the pool cannot idle down to zero).
One 0.895 s sample taken while the deploy was still settling is exactly why the sweep, not a
single sample, is the evidence. Webhook negatives re-run on the deployed revision: no signature →
**400**, forged signature → **400**. **Deploy proof is behavioral**: `git merge-base --is-ancestor
4832750 origin/main` is true and the GitHub deployments API records `4832750` for the four Vercel
production environments, but Render records nothing there — the latency change itself, plus
`/api/stripe/configured` still exposing §33's `webhookSecretHealth`, is what shows the backend
runs a revision at least as new as this commit.

**Open / owner-side.** (1) The two reported queries can only be re-logged by the owner (the
order-detail route needs a customer session, the VelRepeat tick is internal), but the mechanism
that produced their 1.5 s is the one measured and removed above. (2) New log lines for `refunds` /
the VelRepeat tick should read
`layer=statement` with a small acquire; a line still reading `layer=pool-connection` means
something else is emptying the pool (a Neon-side idle close), and the new line says so directly.
(3) `EXPLAIN (ANALYZE, BUFFERS)` on both queries confirms index scans. (4) The ~1.5 s was never a
Stripe webhook cause; the webhook budget is unchanged.
