# Velnox AI Handoff — current state

**Last updated:** 2026-09-28 · **Branch:** `main` · **Latest pass:** Fixed 30-minute payment reservation + countdown + pay-again UX — the reservation is a constant 30 min and both order surfaces count it down (§38, supersedes §36)
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

## 35. Customer order cancellation (2026-09-28) — archived

Full record: [`history/archive/AI_Handoff-2026-09-28-customer-cancellation.md`](./history/archive/AI_Handoff-2026-09-28-customer-cancellation.md)
(one shared cancel rule for button + server, the guarded claim, the ONE release path, the
`orderCancel` i18n namespace, the 55 KiB tooling finding). Still open there: re-run its 14
`TEST_DATABASE_URL`-gated cases; browser check of the dialog (th/en/my). The two failures that
reddened `main` were test-side and are fixed in **§37**.

---

## 36. Dynamic Payment Reservation V1 — an unpaid order holds stock for a risk-based window (2026-09-28) — superseded by §38

The v1 policy derived the window from stock cover, 7-day sales velocity and `products.featured`
(15/20/30/45/60 min). **Part 1 replaced it with a fixed 30 minutes** (§38): the duration must not
depend on demand, popularity or behaviour signals. The expiry sweep, the ONE release path, the race
guards and the columns it introduced all still stand. Full record:
[`history/archive/AI_Handoff-2026-09-28-dynamic-reservation-v1.md`](./history/archive/AI_Handoff-2026-09-28-dynamic-reservation-v1.md).

---

## 37. CRITICAL — production checkout down: migration 048 never applied (2026-09-28)

**Reported.** Render: `ERROR 42703 column "payment_expires_at" does not exist` and
`[stripe] checkout error: column "payment_expires_at" does not exist` → no Checkout Session could be
created, so no sale could be paid. OAuth unaffected.

**Two independent causes — neither is "the field is in the wrong table".**

1. **Production schema is behind the code.** `Migrate Neon Database` DID fire for migration 048
   (run `36371800184`, commit `df719fe`) and **failed at its first statement**: `psql: … "ep-super-bird-
   az88b4p7-pooler…neon.tech" failed: ERROR: Your account or project has exceeded the quota.`
   (the §22 Neon quota, again). So it is absent from `schema_migrations` and never applied.
2. **The read path had no deploy-order net.** `248db45` hardened the reservation **write** and the
   **sweep**, but the **checkout read** still named the column
   (`SELECT … payment_expires_at FROM orders WHERE id = $1`) → 42703 → 500 `STRIPE_ERROR`, before the
   reservation guard could run. A missing deadline took checkout down instead of not being enforced.

**Placement verified correct, not moved.** `payments` has no expiry column; the stock reservation IS
order-keyed (`inventory_released` + the ONE release path `releaseOrderInventory(orderId)`).
`orders.payment_expires_at` is the single source of truth already agreed across schema, migration,
sweep, index and UI. No new table, column, endpoint or reservation system.

**Fix — `fix(payments): survive a database that predates the reservation columns`.**

| Piece | Change |
|---|---|
| `backend/lib/payment-reservation.ts` | NEW `selectOrderPaymentRow()` reads the deadline as `to_jsonb(o) ->> 'payment_expires_at'`: a JSON key lookup is NULL when the column is absent, so ONE statement is correct against BOTH schemas and **cannot raise** 42703. Chosen over "catch 42703 and retry" because the webhook runs inside `withTransaction` — PostgreSQL aborts a whole transaction on the first failed statement (`25P02`), so a retry would trade a broken checkout for a broken webhook. Also `warnReservationSchemaMissing()` (once per process, names migration 048) |
| `backend/routes/stripe.ts` | Checkout's order read and the webhook's non-payable-order diagnostic both go through it; nothing names the column in a statement any more |
| `backend/tests/payment-reservation-expiry.test.ts` | NEW deploy-order cases, incl. a real-DB one that shadows a column-less `orders` into a throwaway schema **inside a transaction** and proves the error is real (42703), that it poisons the transaction (25P02) and that the read survives anyway; plus the canonical-schema happy path |
| `backend/tests/customer-order-cancel.test.ts` | `reservation_expired` → `reservationExpired` (the alias became a JS variable) |
| `db/` | **No change needed** — `schema.sql` / `run-sqleditor.sql` already carry both columns + the partial index and match on those lines; `run-update.sql` still absent |

**Also repaired — pre-existing red `main`, NOT caused by this bug.** CI run `36372222449` on the
pre-fix tip already failed 6 tests this workspace reproduced exactly. `payment-reservation-expiry`'s
HTTP harness mounted neither `stripeWebhookRawBody` nor `cookieParser`, so its checkout cases answered
**401** and its webhook cases never verified a signature — they had never tested what they claimed;
both are now mounted in `server.ts`'s real order. Two `customer-order-cancel` failures were test-side
too: scenario 9's fixture never set `inventory_released` (its own premise, "markPaymentFailed already
released this stock", was unrepresentable) and scenario 11 filtered on `cancelled` — the ORDER's state,
which scenario 10 pins as `true` for a cancel that moved nothing — instead of `alreadyFinal`. Stock had
in fact been released exactly once in both.

**Verification (executed here).** Disposable PostgreSQL bootstrapped from `db/run-sqleditor.sql`, then
`psql --single-transaction -f db/migrations/048_payment_reservation.sql` + a `schema_migrations` row
(mirroring the workflow): full backend suite **911 pass / 2 skip / 0 fail** (913, 41 files); the two
touched suites **83 pass / 0 fail**; backend `tsc` 0; `typecheck` 4/4; `i18n:check` th=en=my=1338;
`git diff --check` clean. The local DB was still pre-migration when the fix first ran and the new tests
passed against it, i.e. the read genuinely survives the schema production is in today.

**OWNER ACTION — production schema (BLOCKED for an agent).** `gh workflow run migrate-neon.yml` →
**403 `Resource not accessible by integration`** (the GitHub App has no `actions: write`). Either
**Actions → Migrate Neon Database → Run workflow** with `migration_file = 048_payment_reservation.sql`
(clear the quota of `36371800184` first), **or** in the Neon SQL Editor:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_policy JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
INSERT INTO schema_migrations (migration_name)
  VALUES ('048_payment_reservation') ON CONFLICT (migration_name) DO NOTHING;
```

Additive, nullable, no backfill, no rewrite; existing orders keep `NULL` (= "no window", exactly what
the sweep ignores). Until applied the reservation feature is inert — but checkout works.

**Still open.** Production schema unverified from an agent (no credentials; `diag-neon-schema.yml`
cannot be dispatched for the same 403) — **do not report the column as verified until an owner read
confirms it**. Stripe TEST E2E still BLOCKED (§16/§18). The 15/20/30/45/60 min windows come from the
policy service; none is hard-coded in a route.

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

---

## 38. Fixed 30-minute payment reservation + countdown + pay-again UX (2026-09-28)

**Reported (Part 1 FINAL, before VelRepeat).** Finish the unpaid-order / payment-reservation
experience and make the Order UI production-ready: the reservation is **exactly 30 minutes** (no
dynamic duration), the customer sees a countdown in the order list and on the order page, and can
pay again — choosing the payment method again — while the window is valid. VelRepeat, customer
memory, traffic/sales signals and personalization are explicitly OUT of scope.

**The window is now a CONSTANT — this supersedes §36's risk-based windows.** `backend/lib/payment-reservation.ts`
was rewritten so the duration is `PAYMENT_RESERVATION_MINUTES = 30` for every eligible order
(`payment_expires_at = created_at + 30 min`). Part 1 forbids deriving it from popularity, views,
clicks, sales velocity, demand or behaviour — the exact inputs the v1 policy read — so the risk
table, the signal query (`gatherOrderReservationSignals`) and `deriveDemandMetrics()` are GONE and
the policy is now a pure function of `now`. Everything else is unchanged: `orders.reservation_policy`
still records the policy that produced a deadline (`version: "v2"`, `reservationMinutes: 30`,
`reason`), so a v1 row stays distinguishable; the SAVEPOINT deploy-order guard, the expiry sweep,
the ONE release path, the "a paid-after-release order is never resurrected" guard and the Stripe
session `expires_at` bound all stand. Side benefit: order creation no longer runs the signal query
at all — one round trip less on the checkout path that §32/§34/§37 were about.

**Countdown — ONE rule for both surfaces.** NEW `paymentReservationPhase()` and
`PAYMENT_RESERVATION_URGENT_MS = 3 min` in `packages/shared/src/lib/commerce.ts`, returning
`active` / `urgent` (last 3 minutes, the documented `02:13` case) / `expired` / `none`. `MyOrders.tsx`
and `ShopOrderDetail.tsx` both read it, so an order can never look active on one surface and expired
on the other. The **list** now counts down per order (it previously had only the button), refetches
once when a window lapses, and refetches on `visibilitychange`; the **detail page** turns the
countdown into the hero (order no + status, "Payment expires in" + a big `MM:SS` + the note) with the
pay action beside it. Paid/cancelled orders show no countdown; a lapsed one shows the expired notice,
never `-00:23`. The clock is presentation only — the backend deadline is the source of truth and the
backend enforces it (checkout answers `400 PAYMENT_RESERVATION_EXPIRED`).

**Order page restructured into a production hierarchy.** Header card (status, countdown, pay) →
progress → items → **delivery** (address + carrier/tracking; there is no shipping-method column, so
none is invented) → **payment** (method, status, payment rows) → **order summary** (subtotal,
shipping, discount only when > 0, total) → shop → **actions** (pay now, back, buy again, cancel
order). Mobile first: `tabular-nums` clock, wrapping address, no horizontal overflow. Every string
lives in the dictionaries (th/en/my).

**Pay again = choose the method AGAIN.** `ResumePaymentButton` no longer auto-uses the recorded rail:
one press always opens a chooser listing the rails the BACKEND reports enabled
(`GET /api/payments/methods` → CARD/PROMPTPAY), preselects the recorded one, and continues with the
one the customer picks. (The backend already abandons a stale open session for a different method
instead of charging the wrong rail.) A `pageshow` listener re-enables the button when the customer
comes Back from Stripe; `onUnknownMethod` is gone from all four surfaces.

**Migration headroom + production state.** `db/migrations/048_payment_reservation.sql` — comment
updated only (the DDL is byte-identical, additive, idempotent): the runner fires only when a
`db/migrations/*.sql` file changes, and `048` has never applied. **Production Neon therefore still
has NO `payment_expires_at`/`reservation_policy`** (§37, quota `36371800184`), so in production the
reservation and the countdown are INERT — `orders` keeps answering `paymentExpiresAt: null`, the
pages simply render no countdown, and checkout is unaffected (that is the deploy-order net from
§37 working). Do not report the reservation as live in production until an owner read confirms the
columns.

**Verified here.** backend `tsc` 0 · `typecheck` 4/4 · `build:velshop` 0 · `i18n:check`
th=en=my=**1350** · `git diff --check` clean · `payment-reservation-policy` +
`payment-reservation-expiry` **49 pass / 19 skip / 0 fail** — new coverage: the 30:00 start, the
`02:13` urgent case, the full phase matrix (paid/cancelled/shipped → none, sweep-written `expired` →
expired, COD/legacy → none, lapsed → 00:00 never negative), the policy module's "no dynamic input"
source contract (no `riskLevel`/velocity/`featured` in code), the order-API deadline data contract
over HTTP (`29:xx` back out of a fresh 30-minute row), and source contracts for the list countdown
and the pay-again chooser · `checkout-payment-flow` 38 pass / 4 skip (its chooser case now pins
"every rail", not "unknown rail") · full backend suite **789 pass / 119 skip / 1 fail**, the single
failure being the pre-existing `test-database-isolation` child probe, which re-reads this sandbox's
`.env` (production `DATABASE_URL`); it passes in CI, where no `.env` exists and `DATABASE_URL` is unset.

**NOT verified here (owner-side).** (1) The 19 `TEST_DATABASE_URL`-gated cases — the fixed-30 write,
release-exactly-once, the concurrency/duplicate-webhook races and the new API deadline contract —
need a disposable database (CI `test.yml` provisions `postgres:16`). (2) A browser pass over the new
order page, the list countdown and the chooser in th/en/my. (3) Production schema as above.
