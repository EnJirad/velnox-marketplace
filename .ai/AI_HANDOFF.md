# Velnox AI Handoff — current state

**Last updated:** 2026-09-29 · **Branch:** `main` · **Latest pass:** inventory CRITICAL #1/#2 fixed (`8b89ecf`, **§43**) — §42 remains the full-system audit: what PASSED, what FAILED, what is **PRODUCTION BLOCKED** (migration 048 still unapplied)
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

### 2026-09-29 — payment ↔ customer-cancellation race hardened (shared LOCK ORDER)

The contradiction was already unreachable (the guarded `UPDATE orders … status = ANY(…)`
claims plus the `inventory_released` flag made exactly one writer win), but the two sides
took the rows in OPPOSITE orders: cancel = `orders` → `payments`, while
`markPaymentFailed` / `markPaymentCanceled` = `payments` → `orders` — an AB-BA deadlock
PostgreSQL breaks by aborting one side (a 500 on the customer's cancel, or a `failed` event
Stripe redelivers, with the winner decided by lock timing). `backend/lib/order-lock.ts` now
defines the ONE order: the order row is locked FIRST by the cancel route,
`markPaymentSucceeded`, `markPaymentFailed`, `markPaymentCanceled`, `syncRefundFromStripe`
and the reservation sweep. The cancel route also re-reads the payment state UNDER that lock,
so `paid`/`processing` still refuse (`ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`) instead of
trusting a pre-transaction read. A settlement after a cancellation is still recorded on the
payment row (refunding it) and never resurrects the order, re-reserves stock, or commits it.
No schema change; Stripe webhook architecture untouched.

Evidence: `backend/tests/payment-cancellation-race.test.ts` — **21 cases covering the whole
TEST 01–18 race matrix**: the structural lock-order contract; forced-interleave probes that
prove both sides wait on the SAME order row (and that no path holds the `payments` row while
waiting); cancel↔settlement both ways; `checkout.session.completed` ∥
`payment_intent.succeeded`; expiry ∥ settlement; cancel ∥ confirmed / packing / shipped —
each issued as **concurrent real HTTP** against the real routes behind one held lock, so the
winner is decided by PostgreSQL and never by issue order; the same event id delivered three
times at once; a duplicated retry after a cancellation; `reserved`/`sold_count` exactly-once;
a cancelled order refusing to return to fulfilment under concurrent pressure — plus a new
`cancel vs shipment` race in `order-fulfillment-state-machine.test.ts`. Full backend suite
**995 pass / 0 fail**; `tsc --noEmit`, `bun run typecheck` (4 apps) and `bun run build:apps`
green; `git diff --check` clean; CI `36547644881` success on `d4e184d`. The probe was proven
to have teeth: removing the lock from `markPaymentCanceled` makes it fail with PostgreSQL
`55P03`.

**Part ② (same day) — the 30-minute reservation lifecycle, audited + tested end to end.**
Nothing new was built: the system already existed (columns + index in both schema files,
`lib/payment-reservation.ts` = fixed `PAYMENT_RESERVATION_MINUTES = 30` from the SERVER clock,
the `payment-reservation-scheduler` worker wired at boot, countdown on both order surfaces with
the GREEN/YELLOW/RED/EXPIRED tone contract, `orderReservation` copy in th/en/my, `paymentExpiresAt`
+ `reservationMinutes` on both order read routes). What was missing was the TEST MATRIX, so 7
cases were added: expiry ∥ confirmation, expiry ∥ packing, expiry with a duplicated webhook,
`checkout.session.completed` ∥ expiry, a settlement 1.5 s before the deadline, a pay-again
attempt on an order the worker already ended, and the 1-reservation → at-most-1-terminal-
transition invariant (plus `confirmed`/`packing` added to the never-expired status list).
Stale "Dynamic Payment Reservation V1" wording (the deleted risk-band table) was corrected in
`checkout.md`, `database.md`, `payment.md`, `cart.ts`, `server.ts`, `commerce.ts`, `th.ts`.
Backend suite **1002 pass / 0 fail**, typecheck + `build:apps` + `i18n:check` green.
**Still unverified: the production Neon columns** — dispatching the read-only
`diag-neon-schema.yml` returns **403** (no `actions:write` on the app token) and `/api/_diag/schema`
is 401 without a production session, so migration 048's presence in production remains an
owner action, and the countdown is NOT claimed production-ready.

### 2026-09-29 — fulfilment state machine hardened: `packing` + payment/shipment gates

ONE authority: `backend/lib/order-fulfillment.ts` — `pending → confirmed → packing →
shipped → delivered → completed` + terminal `cancelled`. `confirmed` = the shop accepted the
order (packing NOT started, the customer may still cancel); `packing` = fulfilment started
(NOBODY may cancel: the table has no `packing → cancelled` edge). The seller route and the
VelCenter admin route both apply it, each under `FOR UPDATE` on the order row. Two gates now
run inside that transaction: shifting to `confirmed` needs a SETTLED payment (`paid`
`payments` row — the Stripe webhook is the only writer; COD passes only while its disabled
rail is on), and `packing → shipped` needs a `shipments` row carrying a carrier + tracking
number (the seller ship dialog and VelCenter's collect them and send them WITH the
transition, so status + shipment are one transaction). Customer cancellation is unchanged
(`pending|pending_payment|confirmed`, still the guarded `UPDATE` in `cart.ts`) and the two
paths serialize on the row. Seller reads now take the recipient name/phone from
`orders.shipping_address` (account row = legacy fallback only). **NO schema change:**
`orders.status` has no CHECK constraint, so `packing` needs no migration.

Evidence: `backend/tests/order-fulfillment-state-machine.test.ts` (24 cases — real DB for
both gates and for the cancel-vs-packing race in both orders), full backend suite **973
pass / 0 fail**, `bun run typecheck` (4 apps) + `bun run build:apps` + `i18n:check`
(th=en=my=1414) green. i18n note: the `packing` label lives in the new top-region
`orderFulfillment` namespace because th/my's `orderStatus`/`orderSteps` blocks sit past the
safe edit window; `orderStatusI18nKey()` / `orderProgressStageI18nKey()` are the ONE mapping.

**Measured correction to the workspace rule:** the file-edit window is the first
**32 768 bytes** (~32 KB), not ~55 KB — a match at byte 32 748 succeeds, one at 35 778 is
"not found", so this handoff's own sections past ~32 KB (§37+) are no longer editable in
place. Archive/split before growing further.

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

- ~~**Closed gap records moved out of this file.**~~ **ARCHIVED 2026-09-29** →
  [`history/archive/AI_Handoff-closed-gaps-2026-09-29.md`](history/archive/AI_Handoff-closed-gaps-2026-09-29.md)
  (verification self-action guard, unbounded admin product/seller lists,
  unpaginated verification queue, DB constraint repairs, non-idempotent fixtures,
  the corrupted revoke string). Closed items are neither current state nor a gap.
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
- **Migration numbering has duplicates** (029, 030, 034, 035). A prefix-keyed
  runner applied only one file per number, which is exactly how the V0035 repair
  was skipped. New migrations must use an unused number; consider renumbering.
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

## 21–22. PostgreSQL 53000 — first pass + provider-quota classification (2026-09-27) — archived

Both are **archived** (closed records; conclusions unchanged) →
[`history/archive/AI_Handoff-2026-09-27-postgres-53000.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000.md)
and [`…-postgres-53000-classified.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000-classified.md).
What stays live: production threw `53000` on **connect AND query** (a provider consumption quota, not a
connection or storage limit) and is **reachable again** (verified read-only 2026-09-27 08:09Z — `/api/shops`
200 with real rows); the VelRepeat 60 s poll (≈182 CU-h/month vs the 100 CU-hour Free-plan allowance) is
still an **owner cadence decision**, and the plan's Usage figures are still unreadable from a workspace.
One unrelated fix from that pass is kept: `POST /api/admin/sellers/:id/revoke` leaked one pool connection
per call (the only unreleased lease in the backend) and now releases it in `finally`
(`backend/routes/seller.ts`, guarded by `backend/tests/db-client-release.test.ts`). `backend/db/index.ts`
logs failed queries/connects with `operation` + PG `code`/`severity`/`message` only — never credentials or
parameters. Pool: exactly one `pg.Pool` (`max: 20`) shared by HTTP + WS + scheduler.

**Housekeeping (do not grow this file).** Superseded records live in [`history/archive/`](history/archive/)
with a dated index at [`.ai/history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md) — §5, §8, §10,
§12, §14's TASK 004B narrative, §15–§19 (incl. §2's verification system → `.ai/context/verification.md` and
§15–§16 → `.ai/context/payment.md`), §20–§36, §37–§41, and **§42.1–§42.5** (pointers above). The file-edit
tools stop matching past ~55 KB (measured 2026-09-26: ≤54.8 KB edits, ≥68.2 KB does not), so when appending
a record, move a superseded one to `history/archive/` and point at it. **Done 2026-09-29:** §42.1–§42.5 →
`AI_Handoff-2026-09-29-audit-findings-detail.md`, which is what made room for §44 and §45. Keep §6 (gaps),
§9.4/§9.5, the §14 stub, §18's BLOCKED statements and §42's verdicts.

**§27–§36 pointer (2026-09-27 → 2026-09-28).** Stripe sandbox audit; the velShop order-status contract +
cart selection; one-press checkout; the PromptPay settlement diagnostic; the webhook stall + signature
boundary; DB pool latency; customer order cancellation (its two owner-side items still open); the
superseded risk-based reservation v1. Each is recorded in full in `history/archive/` per the index above
(the per-file list was replaced by this pointer on 2026-09-29).

---

## 37. Migration 048 never applied — checkout read path repaired (2026-09-28)

**Archived for length** → `.ai/history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md`.
In one line: production Neon still had no `orders.payment_expires_at`, the migration run died on the
§22 quota, and the checkout READ named the column so a missing deadline took checkout down instead of
being unenforced. Fixed by `selectOrderPaymentRow()` (`to_jsonb(o) ->> 'payment_expires_at'`: one
statement that is correct against both schemas and cannot raise 42703). Still open — see §40.

**OWNER ACTION (unchanged, still required).** Clear the Neon quota, then **Actions → Migrate Neon
Database → Run workflow** with `migration_file = 048_payment_reservation.sql` (`gh workflow run`
answers 403 — the GitHub App has no `actions: write`), **or** run the SQL in the archive file, section
**OWNER ACTION** ([`history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md`](history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md))
in the Neon SQL Editor. It is additive and nullable, so existing orders keep `NULL` (= "no window",
what the sweep ignores).

**Current status (§42 #6, still true):** unapplied in production; the 30-minute countdown is therefore
invisible to customers and the expiry sweep claims nothing.

---

## 38–41. Archived (moved 2026-09-29, edit-headroom housekeeping)

§38 (fixed 30-minute reservation + countdown + pay-again UX), §39 (order UX polish — status, progress,
address, language), §40 (countdown invisible in production — migration 048) and §41 (order-surface
refactor: shared `OrderStatusBadge`, new seller order detail, `generateOrderNumber()`) moved **verbatim**
to [`history/archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md`](history/archive/AI_Handoff-2026-09-29-part2-and-order-surfaces.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)) so §42 could be appended.

**Still live from them.** The reservation is a **CONSTANT 30 minutes** (`PAYMENT_RESERVATION_MINUTES`;
§36's risk bands are deleted) · the tier UI is GREEN >15:00 / YELLOW ≤15:00 / RED ≤5:00 · **migration
048 is still NOT applied in production** (§42 #6) · the browser pass over both order surfaces in th/en/my
is still open. **One correction to §38:** its "the ONE release path" holds for the PAYMENT paths only —
§42 #2 records the second (seller) release path that bypasses `releaseOrderInventory()`.

---

## 42. Full-system audit — Part 1 (cancellation race) + Part 2 (30-min reservation) (2026-09-29)

**What this pass is.** A read-only, end-to-end audit of Velnox at **`2c52bfc`**
("feat(payment): implement reservation expiry and stock release") covering Part 1 (payment ↔ customer
cancellation race hardening) and Part 2 (30-minute payment reservation + automatic expiry + stock
release). **No code, schema, migration, API, state-machine or UI change was made by this pass.** Evidence
tiers used strictly: **LOCAL VERIFIED** (a command ran here, output quoted) · **PRODUCTION VERIFIED**
(a live production read) · **PRODUCTION BLOCKED** (not observable from a workspace) · **CODE-VERIFIED
ONLY** (read from source, not executed).

**§0 startup sync — the sandbox was 34 commits stale.** `git fetch` put `origin/main` at `2c52bfc`
(**behind 34 / ahead 0**), so `git pull --ff-only` fast-forwarded HEAD to
`2c52bfc734428232ed67dbde3a07b9985d4a506d` == `origin/main`, tree clean, no local work lost and **no
commit created**. The 34 commits carry Part 1 (`d4e184d`, `a2eb2be`, `ad7bae9`), Part 2 (`34e8891`,
`d7282bb`, `8261152`, `2c52bfc`) and the order surfaces (`31c0d19`, `dcceffd`). **Any handoff or context
text written before `2c52bfc` is not verified against the audited code.**

### 42.1 What was checked, and the result

**The 18-row audit table moved 2026-09-29 (edit headroom)** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md)
(§42.1). What still binds today, restated: **#8/#10** (two release paths, `quantity` never
consumed) → **fixed §43** · **#12 / #6** migration 048 → **still PRODUCTION BLOCKED** ·
**#13** production Stripe is `mode:"test"` with **COD disabled** · **#18** `db/schema.sql` ↔
`db/run-sqleditor.sql` byte-identical, head `048`. The three rows that cannot be claimed from a
workspace — #15 real Stripe E2E, #16 browser E2E, #17 DB-gated suites (no `postgres`/`psql`/`docker`
here; CI is the only execution) — are restated in **§45**.

**Verdicts on the ten architecture questions.** (1) reservation source of truth ✅ one
(`backend/lib/payment-reservation.ts`) · (2) inventory source of truth ❌ variant vs `quantity - reserved`,
and `quantity` is never consumed · (3) payment source of truth ✅ one · (4) order-state authority ✅ one
(`backend/lib/order-fulfillment.ts`) · (5) lock strategy ✅ compatible — every writer of `orders` +
`payments` takes `lockOrderRow()` (`backend/lib/order-lock.ts`) first (`stripe.ts:350/454/487/573`,
`cart.ts:1350`, `payment-reservation-scheduler.ts:161`) · (6) double commit/release ❌ the seller path ·
(7) an impossible transition exists: `paid → cancelled` · (8) dead code: `RELEASABLE_STATUSES."failed"`
(`inventory.ts:73`) and the duplicated urgency model (#8) · (9) production schema mismatch ❌ (048 missing) ·
(10) **no new authz hole** — the real exposure of this pass is integrity/financial, not access control.

### 42.2 PROBLEMS — severity ordered (index; full write-ups archived)

**Archived 2026-09-29** → `.ai/history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`
(the verbatim §42.2 paragraphs — source lines, SQL, and the test that pinned the wrong behaviour —
plus §42.3–§42.5). One line per finding, with its current status:

| # | Finding (one line) | Status |
|---|---|---|
| C1 | Non-variant `inventory.quantity` never consumed on payment → a paid unit stays sellable | ✅ **FIXED** §43 |
| C2 | Seller cancellation was a SECOND release path (inline restore, no claim) → double release / phantom units | ✅ **FIXED** §43 |
| H3 | A seller/center can cancel a PAID order: money kept, no refund, no alert | ✅ **FIXED** §44 |
| H4 | `payment_intent.payment_failed` is per-ATTEMPT but terminal at ORDER level → a later successful retry is refused | ❌ **OPEN** |
| H5 | A payment arriving after the order died has no auto-refund and no operator queue (only `console.warn`) | ❌ **OPEN** |
| H6 | PRODUCTION BLOCKED: migration 048 unapplied (Neon quota) → Part 2 inert in production | ⛔ **OWNER ACTION** |
| M7 | The payment-success path ignores variants | ✅ resolved by §43 (`commitOrderInventory` leaves `product_variants.stock` to the reservation) |
| M8 | Two overlapping urgency contracts in `commerce.ts` (3-minute vs GREEN/YELLOW/RED) | ❌ **OPEN** |
| M9 | `orders.status` has no CHECK constraint | ❌ **OPEN** |
| M10 | VelRepeat bypasses the order-creation guards (COD row, `sold_count` at creation, uncommittable hold) | ❌ **OPEN** |
| M11 | Inventory-row AB-BA deadlock → generic 500 `CHECKOUT_FAILED` | ❌ **OPEN** |
| L12 | `"failed"` is dead in `RELEASABLE_STATUSES` | ❌ **OPEN** |
| L13 | `inventory-race` concurrency evidence exists only in CI (LOCAL tier) | ℹ️ evidence note |
| L14 | Settlement is per shop/order row → one multi-shop checkout can end partially paid / expired | ❌ **OPEN** |

### 42.3–42.5 Archived (moved 2026-09-29, edit-headroom housekeeping)

The cancellation matrix, the race verdicts and the prioritized action list moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md),
which now holds all of §42.2–§42.5. The matrix and the race verdicts are fully superseded: their only
two ❌ cells were fixed by §43 (#2, the double release) and §44 (#3, `paid → cancelled`), so every
✅ verdict in §42.4 still holds and the two ❌ ones are closed. The current open list is **§44's
"Still open"** — do not work from 42.5.

**Not claimable from a workspace (do not treat as verified anywhere).** Real Stripe E2E (no PaymentIntent,
PromptPay QR, webhook delivery or refund has ever been executed from this sandbox); the production schema
query (401); browser E2E of `/orders`, `/cart` and the seller order pages (no signed-in session); and any
DB-gated case locally (see 42.1 #17 — CI is the only execution).

---

## 43. Inventory integrity — audit CRITICAL #1 + #2 fixed (2026-09-29)

**Task** `fix(inventory): harden settlement and release` · **commit `8b89ecf`** (pushed, == `origin/main`)
· audited base `2c52bfc` (§42) · start `829347e`. **No schema change, no migration touched, no
reservation/policy/frontend change.**

- **CRITICAL #1 PASS — settlement now CONSUMES stock.** NEW `commitOrderInventory()`
  (`backend/lib/inventory.ts:115`, called only from `stripe.ts:429`, inside the same transaction as the
  order claim) does `quantity −N, reserved −N` for a non-variant line, leaves a variant's
  `product_variants.stock` where the reservation put it (and never touches the parent's hold), and
  counts `sold_count +N` exactly once. Availability `quantity - reserved` is unchanged by a sale;
  `GREATEST(0, …)` keeps stock non-negative.
- **CRITICAL #2 PASS — ONE release authority.** `seller-orders.ts:613` now calls
  `releaseOrderInventory()` and that route writes no inventory row at all. The release claim also
  refuses an order whose money settled (`PAYMENT_SETTLED_STATUSES` from `order-lock.ts`), so
  COMMIT+RELEASE and RELEASE+COMMIT are impossible for one reservation — the same rule the expiry
  sweep already applies.
- **Verified (real numbers):** local `857 pass / 161 skip / 0 fail` · **CI run `36564425934` green:
  `1016 pass / 2 skip / 0 fail`** (1018 tests / 47 files, disposable `postgres:16`) — the +14 over the
  audited baseline (`1002`) are the NEW `backend/tests/inventory-settlement.test.ts` (Tests A–J +
  races), all individually `(pass)`. backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 0 ·
  `i18n:check` th=en=my=**1414** · `git diff --check` clean · `lint` = placeholder (no real linter).
- **Wrong invariants corrected (the assertion, not the number):** four tests in
  `payment-reservation-expiry.test.ts` (`:979`/`:1374`/`:1476`) and `payment-cancellation-race.test.ts`
  (`:834`/`:1149`/`:1177`/`:1203`) pinned the old "quantity is never consumed" bug; they now assert
  `quantity −N` on commit and unchanged on release.
- **Still blocked / open:** migration 048 **PRODUCTION BLOCKED** (§42 #6) · HIGH #4, #5 ·
  MEDIUM #8–#11 (VelRepeat is still the only non-lib stock writer).
  ~~HIGH #3~~ — fixed by §44 (a PAID order can no longer be cancelled) ·
  ~~`center.ts` released NOTHING on an admin cancellation~~ — also fixed by §44 (it now calls the ONE
  release authority, so the leak closed). The §43 reading of #3 — "cancelling a PAID order keeps the
  money and returns no stock" — was a *consequence* of the missing guard, not a refund policy; the
  refund question itself only opens if a cancellation is ever allowed after payment.
- **Full evidence (sections A–N, race matrix, every command):**
  [`.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md`](tasks/completed/inventory-integrity-fix-2026-09-29.md)

---

## 44. Paid-order cancellation guard + the center release leak (2026-09-29)

**Task** `fix(orders): refuse cancelling a paid order (audit HIGH #3)` · **commit `895cebf`**
**Task** `fix(center): release the reservation on an admin cancellation` · **commit `3d77254`**
(both pushed, == `origin/main`). Base `c9fd09b` (§43). **No schema change, no migration touched.**
Two commits because they are two independent defects.

- **HIGH #3 PASS — money outranks a staff cancellation.** NEW
  `assertNoSettledPaymentForCancellation(client, orderId)`
  (`backend/lib/order-fulfillment.ts`, the ONE fulfilment authority) reads `orders.status` plus every
  `payments.status` in `PAYMENT_SETTLED_STATUSES` (`order-lock.ts` = `paid`, `processing`) in **one**
  statement, under the caller's existing `lockOrderRow`, and throws `FulfillmentError(409,
  "ORDER_ALREADY_PAID")` when the order is `paid` or a `paid` payment row exists, else `(409,
  "PAYMENT_IN_PROGRESS")`. Gated on `status === "cancelled"` in `seller-orders.ts` (after the `shipped`
  gate, **before** the UPDATE) and on `to === "cancelled" && to !== rawFrom` in `center.ts`.
  This is required because `normalizeOrderStatusToFulfillment` maps `paid → pending`, so a paid order
  looked cancellable.
- **The codes are the customer's.** `cart.ts:1314/1324` already refused this with the same two codes;
  reusing them gives ONE vocabulary across every cancel surface instead of a staff-only one.
- **Center release leak (NEW from §43) — CLOSED.** `center.ts` wrote `cancelled` and released nothing,
  so an operator cancelling an UNPAID order stranded the hold forever: the customer path refuses an
  already-cancelled order, and the sweep only claims `PAYMENT_RESERVATION_EXPIRABLE_STATUSES`. It now
  imports `releaseOrderInventory` from `backend/lib/inventory.ts` and calls it after the UPDATE — the
  same single release authority `seller-orders.ts` uses, so CRITICAL #2's "ONE release authority" now
  really is one.
- **Deliberately NOT changed:** `NEXT_ORDER_STATUSES` (`packages/shared/src/lib/commerce.ts:461`) —
  it is pinned by `order-status-contract.test.ts` / `seller-order-ux.test.ts` and cannot know about
  money. The button is still offered and the localized 409 refusal is what stops the write.
- **UI / i18n:** `SellerOrderDetail.tsx` `fulfillmentErrorMessage` maps both new codes; new
  `orderFulfillment.cancelPaidOrder` / `cancelPaymentInProgress` in th/en/my. VelCenter
  (`Center.tsx:784`) already toasts `error.message`, so operators see the refusal with no new code.
- **Verified (real numbers):** `NODE_ENV=test bun test backend/tests` → **860 pass / 162 skip /
  0 fail** (1022 tests, 47 files; the DB-gated paid-cancel test runs in CI only) · backend `tsc` 0 ·
  `typecheck` 4/4 · `i18n:check` th=en=my=**1416** · `git diff --check` clean · `lint` = placeholder.
  New tests: a DB-gated "a paid order is refused a staff cancellation; an unpaid one is not" and
  describe block **"9. Cancellation gate — money outranks a staff cancellation"** (3 source-contract
  tests: the codes match `cart.ts`; both routes run the gate under the lock before the UPDATE and never
  write `payments`; the seller page translates the refusal in th/en/my). Test J in
  `inventory-settlement.test.ts` (seller-cancel ∥ settlement) now accepts `[200, 400, 409]`.
- **Still open (not started — await an owner "continue"):** **HIGH #4** `payment_intent.payment_failed`
  is terminal at ORDER level while the payment row is per-attempt (`stripe.ts:447-473`) · **HIGH #5** a
  late payment landing after the order died is only a `console.warn`, never an operator queue
  (`stripe.ts:392-414`) · **MEDIUM #8** two urgency contracts in `commerce.ts:783-898` · **#9** no
  CHECK on `orders.status` · **#10** VelRepeat bypasses `releaseOrderInventory`
  (`velrepeat-scheduler.ts:267-350`) · **#11** inventory AB-BA deadlock (`cart.ts:1027-1034`) ·
  **LOW #12–#14** · **#6** migration 048, **PRODUCTION BLOCKED** on the Neon quota (owner action —
  never report Part 2 as live in production until it is applied). Full text of all fourteen findings:
  [`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md).

---

## 45. CI follow-up — the paid-cancellation assertion was the bug, not the code (2026-09-29)

**CI failure: FIXED.** Implementation changed: **NO** (zero source files touched).
**Task** `test(orders): fix paid cancellation regression assertion` · start `08d6d68`.

- **Root cause: a stale assertion that contradicted its own fixture.** The one failure left after §44
  was in the DB-gated test §44 itself added —
  `order-fulfillment-state-machine.test.ts` → `"a paid order is refused a staff cancellation; an
  unpaid one is not"`. It seeds `paidRow` at `orders.status = 'paid'` on purpose (that is the fourth
  case: the raw webhook-written status must be refused, not just a `paid` **payment row**), and then
  three lines later swept **all** rows asserting `'confirmed'` — `Expected: "confirmed"` /
  `Received: "paid"`. `assertNoSettledPaymentForCancellation` is a single `SELECT`
  (`order-fulfillment.ts:311-319`, no write), so it could never restore `confirmed`; and no code
  anywhere writes `confirmed` onto a `paid` order. The refusal assertion one line earlier
  (`:769`, `ORDER_ALREADY_PAID`) **passed** — the gate was correct. Fix = compare each row against
  **its own seeded status** (`paidRow` → `paid`, the other three → `confirmed`) and add `unpaid` to
  the select so the ALLOWED path is covered too. No test deleted, no `.only`/`.skip`, no rule changed.
- **The brief's filename was wrong, and I did not guess.** `backend/tests/fulfilment-gates-and-races.test.ts`
  **does not exist**; the failure is the describe block `"fulfilment gates and races (requires
  TEST_DATABASE_URL)"` at `order-fulfillment-state-machine.test.ts:414` (British spelling). Found by
  grepping the describe title.
- **Test result (real numbers):** targeted `24 pass / 5 skip / 0 fail` · 12 related files
  `189 pass / 83 skip / 0 fail` · **full `bun test backend/tests` = `860 pass / 162 skip / 0 fail`,
  1022 tests / 47 files, 4992 expect calls, exit 0 — identical to the §44 baseline** · backend `tsc` 0 ·
  `typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` th=en=my=**1416** · `git diff --check` clean ·
  `lint` = placeholder. Full evidence: `.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md`
  → "CI Failure Follow-up".
- **⚠️ Read this before trusting any DB-gated result.** That 5th skip IS the fixed test. It is
  `test.skip` unless `TEST_DATABASE_URL` is set, and this workspace has no Postgres and no container
  runtime (`docker`/`podman`/`pg_ctl`/`postgres`/`initdb`/`psql` all absent). So the local run proves
  only that the file still parses and the other 24 tests pass — **the fix is verified by the CI run,
  not locally.** This is the same LOCAL/CI split as audit row #17, and it is why the disposable
  `postgres:16` job in `.github/workflows/test.yml` is the only real evidence.
- **Still blocked (unchanged):** migration 048 **PRODUCTION BLOCKED** on the Neon quota (owner) ·
  real Stripe E2E ⛔ · browser E2E ⛔ · audit HIGH #4/#5, MEDIUM #8–#11, LOW #12–#14 open (§44's list).
