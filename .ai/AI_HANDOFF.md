# Velnox AI Handoff — current state

**Last updated:** 2026-09-28 · **Branch:** `main` · **Latest pass:** Dynamic Payment Reservation V1 — unpaid orders hold stock for a risk-based window, then the sweep releases it exactly once (§36)
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

## 31. PromptPay settlement diagnostic — order stuck `pending_payment` (2026-09-27) — archived

Full record: [`history/archive/AI_Handoff-2026-09-27-promptpay-settlement.md`](history/archive/AI_Handoff-2026-09-27-promptpay-settlement.md)
— diagnostic only (nothing was changed): the global webhook path had demonstrably settled an
order (§28), so the failure was on the PromptPay-specific leg, and the decisive reads
(endpoint `enabled_events`, `payment_events` rows, the session's `payment_status`) are all
owner-side. Superseded for current state by §33. Archived 2026-09-28 for edit headroom.

---

## 32. Stripe webhook never answers — unbounded DB waits (2026-09-27) — archived

**Root cause:** the pool bounded only connection ACQUISITION; node-postgres has no per-query
deadline, so a statement the server never finished left the webhook pending until the caller
gave up (the Stripe CLI aborts at 30 s) — and `pool.on("error")` called `process.exit(-1)`.
**Fix:** `query_timeout: 15000` (in-process only) + a non-fatal pool error handler; the webhook
logs secret-free stage timings. Full record:
[`history/archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md`](./history/archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md).

---

## 33. Webhook 400 "No signatures found matching the expected signature" (2026-09-27) — archived

**Verdict:** the raw body was correct (`express.raw` really is in front of this route — proven by
a 150 KB body answering 500 there and 404 elsewhere); a CLI `stripe listen` forward **must** 400
because it signs with its own per-session secret, so the only real-delivery cause is a
`STRIPE_WEBHOOK_SECRET` value mismatch. Full record:
[`history/archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md`](./history/archive/AI_Handoff-2026-09-27-stripe-webhook-stall-and-signature.md).

---

## 34. DB latency — the pool idled down to zero (2026-09-28) — archived

**Root cause:** connection establishment, not a slow query and not a missing index. `pool.query()`
reported checkout + execution as ONE number, so the ~1.3 s TCP/TLS/auth handshake to Neon was
charged to whichever statement opened an empty pool (measured in production: 1.627/1.738 s cold →
0.388/0.357 s warm on the same endpoint). **Fix:** `min: 1` warm floor + `maxLifetimeSeconds:
1800` + acquire/execute split logging (`classifySlowQuery()`). No index was added. Full record:
[`history/archive/AI_Handoff-2026-09-28-db-pool-latency.md`](./history/archive/AI_Handoff-2026-09-28-db-pool-latency.md).

---

## 35. Customer order cancellation — unpaid orders get a way out (2026-09-28)

**Reported:** after a failed or abandoned Stripe payment the order page offered only
"ชำระต่อ" — there was no way to cancel an order the customer no longer wanted, even though a
`pending_payment` order is holding stock and its Checkout Session is still open at Stripe.

**Root cause (code, not policy):** `PATCH /api/customer/orders/:orderId/cancel` accepted
only `pending` / `confirmed`, and the order page kept its **own** second copy of that list
(`new Set(["pending", "confirmed"])`). `pending_payment` — the status `POST
/api/stripe/checkout` writes, and the one a customer returns with — matched neither.

**Fix (one endpoint, one rule, no new system):**

| Piece | Change |
|---|---|
| `packages/shared/src/lib/commerce.ts` | `CUSTOMER_CANCELABLE_ORDER_STATUSES` = `pending` \| `pending_payment` \| `confirmed`, `isOrderCancelableByCustomer()`, `orderCustomerCancelability()` (refuses when a payment is `paid`/`processing`). ONE rule for button and server |
| `backend/routes/cart.ts` | Same route, widened: ownership in the `WHERE` (404, never 403), status check, payment-state check (`409 ORDER_ALREADY_PAID` / `409 PAYMENT_IN_PROGRESS`), then ONE transaction = guarded `UPDATE … status = ANY($2)` claim + abandon the `pending`/`requires_action` payment row + `releaseOrderInventory()`; terminal states are idempotent no-ops |
| `backend/routes/stripe.ts` | New `expireStripeCheckoutSession()` — the abandoned session is expired **before** the order is cancelled, so the old Stripe tab can no longer charge it. `markPaymentSucceeded` now logs (order id only) when funds land on a non-payable order |
| `backend/lib/order-read.ts` | NEW. `fetchOrderItemsForOrders()` / `fetchShipmentsForOrder()` moved out of `routes/cart.ts` verbatim (pure readers) — see the tooling note below |
| `apps/velshop/src/pages/ShopOrderDetail.tsx` | Reads the shared rule; cancel button + confirm dialog now appear for an unpaid order next to "ชำระต่อ"; cancelled orders show `orderCancel.cancelledNotice` and never a pay button |
| i18n (`th`/`en`/`my`) | NEW top-level `orderCancel` namespace: `back`, `dialogDescUnpaid`, `cancelledNotice` (i18n:check th=en=my=**1334**) |

**State machine (unchanged except where it was broken):**

```
pending ──┐
pending_payment ──┼── cancel  → cancelled  (stock released once, session expired)
confirmed ──┘
paid / shipped / delivered / completed / refunded  → REFUSED (400 INVALID_STATUS)
payment paid (order row lagging)                   → REFUSED (409 ORDER_ALREADY_PAID)
payment processing                                 → REFUSED (409 PAYMENT_IN_PROGRESS)
already cancelled / payment_failed / expired       → 200 no-op (nothing released twice)
```

**Stock:** reserve at creation (`reserveInventoryStock` for non-variant, immediate
`product_variants.stock -= qty` for variants); release through the ONE path,
`releaseOrderInventory()`. Cancellation adds NO second mechanism — it calls that function
inside its transaction, so the `inventory_released` claim keeps a repeated, concurrent,
retried or webhook-driven cancel from returning stock twice, and its status guard refuses to
release for an order that became `paid` meanwhile.

**Webhook when the order is cancelled:** `markPaymentSucceeded` only moves orders from
`pending`/`pending_payment`, so a cancelled order can never become `paid` — the money stays on
the payment row (that is what makes it refundable) and the new log line names the case.
`checkout.session.expired` and duplicate deliveries stay idempotent. Signature verification,
raw body and the event claim are untouched.

**Verification (executed here):** `backend/tests/customer-order-cancel.test.ts` NEW —
**23 pass / 14 skip / 0 fail** (the 14 are `TEST_DATABASE_URL`-gated; no Postgres/docker
exists in this workspace, and CI `.github/workflows/test.yml` provisions `postgres:16`, bootstraps
`db/run-sqleditor.sql` and runs the full suite). Full backend suite **732 pass / 107 skip / 0
fail** (839 tests, 39 files); payment/webhook/order suites **170 pass / 28 skip / 0 fail**;
backend `tsc` 0; `typecheck` 4/4; `build:apps` 4/4; `i18n:check` 1334 each; `git diff --check`
clean. **No DB-gated case is claimed as passing** — run them with `TEST_DATABASE_URL` or watch CI.

**Tooling finding (important for the next agent):** this workspace's `str_replace` only matches
inside roughly the first **55 KiB** of a file. `backend/routes/cart.ts` was 70 KB and its cancel
handler sat at byte 56,594 — **unmatchable**, which is why `lib/order-read.ts` was extracted (a
real cleanup, not a workaround for its own sake). The same limit is why the new copy became a
top-level `orderCancel` namespace instead of living in `orderDetail`: in `th.ts` (106 KB) and
`my.ts` (100 KB) that block is past the window — the existing `myAuthPatch` / `myShopPatch` /
`myOrderPatch` precedent.**Open / owner-side.** (1) Re-run the 14 DB-gated cases (CI or a disposable Postgres). (2)
A browser check of the new dialog in velShop (th/en/my) — not executable here. (3) The `min: 1`
reservation cost (§34) is unchanged; `INSTALLATION.md` still carries the wrong `velnx-api` host (§31).

---

## 36. Dynamic Payment Reservation V1 — an unpaid order holds stock for a risk-based window (2026-09-28)

**Reported.** Stock reserved at order creation had NO deadline: an order abandoned at Stripe held
its units until someone cancelled it or Stripe expired the session (~24 h), so the last unit of a
scarce product sat behind an abandoned order. Asked for: risk-based reservation windows (MIN 10,
MAX 60, default 30 min), an expiry mechanism that releases exactly once, no resurrection by a late
webhook, a countdown in the order UI, and tests.

**Architecture as found (inspected, not assumed).** Stock is reserved inside the
order-creation transaction (`backend/routes/cart.ts`): variant items → guarded
`product_variants.stock -= qty`; non-variant → `reserveInventoryStock()` (`inventory.reserved +=`).
ONE release path exists, `releaseOrderInventory()` (`backend/lib/inventory.ts`), whose atomic
`inventory_released` claim + status guard already made release at-most-once for cancel / payment
failure / session expiry. Schedulers exist (`backend/jobs/velrepeat-scheduler.ts`, 60 s tick,
DB-as-source-of-truth). `orders.status` had no deadline column; COD/VelRepeat orders are settled by
the carrier (VelRepeat inserts its own orders and never touches Stripe). **No reservation system
was duplicated — this extends the existing one.**

**Policy (new `backend/lib/payment-reservation.ts`, pure + deterministic).** Signals from real
columns only: `inventory.quantity - reserved`, `product_variants.stock`, `products.featured`
(the platform's promotion flag — the schema has NO flash-sale field, so none is invented), and
7-day sales velocity from `order_items ⋈ orders` over real sold statuses
(`paid|confirmed|shipped|delivered|completed`, covering the Stripe and COD rails). Scarcest line
wins (`MIN(available_stock)`).

| Risk | Window | Fires when |
|---|---|---|
| CRITICAL | 15 min | ≤2 available · ≤5 available with ≥1 unit/day · <1.5 days of cover · promoted AND ≤5 available |
| HIGH | 20 min | ≤10 available · ≤20 available with ≥1 unit/day · <3 days of cover |
| NORMAL | 30 min | everything else (the default; also "stock unknown") |
| LOW | 45 min | ≥20 available, <1 unit/day, ≥10 days of cover, not promoted |
| VERY_LOW | 60 min | ≥50 available, ≤0.2 units/day, ≥30 days of cover, not promoted |

Windows are clamped to 10–60 and the whole policy (riskLevel, minutes, reason, signals) is stored
on the order.

**Changes.**

| Piece | Change |
|---|---|
| `backend/lib/payment-reservation.ts` | NEW — the ONE policy: thresholds, `calculatePaymentReservationPolicy()` (pure), `gatherOrderReservationSignals()` (one SQL round trip), `applyPaymentReservationPolicy()`. COD → no window |
| `backend/jobs/payment-reservation-scheduler.ts` | NEW — scan (`payment_expires_at <= NOW()`, expirable statuses, `inventory_released = FALSE`) → guarded claim `pending|pending_payment → expired` → payment row `cancelled` (`PAYMENT_RESERVATION_EXPIRED`) → `releaseOrderInventory()` → then close the Stripe session. `paid`/`processing` payments block the claim entirely |
| `backend/routes/cart.ts` | Checkout takes the window INSIDE the order-creation transaction; both read routes expose `paymentExpiresAt` (ms) |
| `backend/routes/stripe.ts` | `markPaymentSucceeded` guard now also requires `inventory_released = FALSE` (a paid-after-release order can never be resurrected) and logs the reason (incl. `reservation_expired`); checkout refuses a lapsed window with **400 `PAYMENT_RESERVATION_EXPIRED` BEFORE** any session is created; the session is created with `expires_at` = the deadline (Stripe's 30 min–24 h bound applied) and the response carries `paymentExpiresAt` |
| `backend/server.ts` | `startPaymentReservationScheduler()` beside the VelRepeat scheduler |
| `backend/routes/seller-orders.ts` | `expired` maps to `cancelled` (the seller has nothing to fulfil; the default branch would have invited a confirmation) |
| `packages/shared/src/lib/commerce.ts` | `expired` status + meta + terminal transitions; `orderStripePayability` now returns `expired` and refuses a lapsed window; NEW `paymentReservationState()` + `formatPaymentCountdown()` |
| `apps/velshop/.../ShopOrderDetail.tsx` | Countdown strip ("ชำระเงินภายใน MM:SS"), one-second presentation-only tick, one refetch when it lapses, expired notice replacing the steps, no pay button |
| `apps/velshop/.../ShopCheckoutSuccess.tsx` | `expired` is terminal for polling and has a status meta |
| i18n | NEW top-level `orderReservation` namespace (th/en/my): `payWithin` (`{time}`), `windowNote`, `expiredTitle`, `expiredDesc` — i18n:check th=en=my=**1338** |
| DB | `orders.payment_expires_at TIMESTAMPTZ`, `orders.reservation_policy JSONB`, `idx_orders_payment_expires_at` (partial on `IS NOT NULL`) in **both** `db/schema.sql` and `db/run-sqleditor.sql` (+ new `db/migrations/048_payment_reservation.sql`, additive/idempotent) |

**Deploy order (safety).** The columns arrive with migration `048`, and the host deploys on push,
so the two can cross: the reservation write is therefore wrapped in a `SAVEPOINT` and tolerates
**only** `undefined_column` (42703) — otherwise a missing column would abort the order-creation
transaction and break EVERY checkout. A backend newer than its database keeps serving, orders get
no window (like legacy rows), the write logs the exact migration to apply, and the sweep logs once
and resumes by itself on the first scan that succeeds after the migration lands.

**Race handling (the invariant: no order is ever resurrected, no unit released twice).** Sweep,
webhook and customer cancel all write the same row through guarded UPDATEs, so the row lock picks
exactly one winner and the losers re-evaluate to 0 rows. A payment that arrives before the
deadline wins (stock becomes SOLD, `inventory_released` stays FALSE, the sweep then skips it). A
payment that arrives after the order expired cannot reclaim stock and cannot set `paid` — the money
stays on the payment row and is logged as **manual review/refund required** (the reconciliation
path; no refund is invented in code). A `paid`/`processing` payment blocks the automatic expiry, so
a live charge is never expired out from under the customer. Nothing under
`backend/middleware/stripe-raw-body.ts` or the webhook's signature/`payment_events` handling
changed.

**Verified here.** NEW `payment-reservation-policy.test.ts` **26 pass/0 fail** (the full risk
table, MIN/MAX clamps over every signal combination, determinism, JSONB round trip, the
42703-only tolerance) · NEW `payment-reservation-expiry.test.ts` **23 pass / 16 skip / 0 fail**
(countdown + i18n + wiring + source contracts; the 16 skips are the `TEST_DATABASE_URL`-gated
expiry/concurrency/webhook/savepoint cases; `payment-reservation` both files = 49 pass/16 skip) ·
full backend suite **788 pass / 118 skip / 0 fail** (906 tests, 41 files; was 732/107/839)
· `checkout-payment-flow.test.ts` 38 pass / 4 skip (shapes updated for the additive `expired`
field) · backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1338 · `diff
db/schema.sql db/run-sqleditor.sql` identical · `git diff --check` clean.

**NOT verified here (owner-side).** (1) The 15 DB-gated cases need `TEST_DATABASE_URL` or CI
(`.github/workflows/test.yml` provisions `postgres:16` and bootstraps `db/run-sqleditor.sql`);
apply migration `048` to production (Neon SQL Editor) **before** the backend that writes the
column deploys. (2) A browser pass on the countdown and the expired notice (th/en/my). (3) No real
Stripe delivery was reproduced here, so the "late payment after expiry → manual refund" path is
proven at the state level in tests, not against a live charge.
