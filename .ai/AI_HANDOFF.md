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
(measured 2026-09-26: ≤54.8 KB edits, ≥68.2 KB does not). **Done 2026-09-27:** §21–§22 stubs above, and §23–§26 moved verbatim to
[`history/archive/AI_Handoff-2026-09-27-closed-records.md`](history/archive/AI_Handoff-2026-09-27-closed-records.md).
**Done 2026-09-28:** §27–§36 collapsed into the ONE pointer note below (each already had a full
record in `history/archive/`), which is what kept this file editable for §39. When appending, move a
superseded record to `history/archive/` and point at it — do not grow this file.
Keep §6 (gaps), §9.4/§9.5, the §14 stub, and §18's BLOCKED statements.

## 27–36. Archived records (2026-09-27 → 2026-09-28)

Each is recorded in full under [`history/archive/`](history/archive/) (dated index:
[`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)): §27 the Stripe sandbox/test-mode
audit (`AI_Handoff-2026-09-27-stripe-sandbox-audit.md`); §28–§29 the velShop order-status contract
and the cart selection UI (`…-velshop-orders-cart.md`); §30 checkout → Stripe in one press + resume
payment (`…-velshop-checkout-onepress.md`); §31 the PromptPay settlement diagnostic
(`…-promptpay-settlement.md`); §32–§33 the webhook stall + signature boundary
(`…-stripe-webhook-stall-and-signature.md`); §34 the pool-latency finding (`…-db-pool-latency.md`);
§35 customer order cancellation (`…-customer-cancellation.md`, its two owner-side items still open);
§36 the superseded risk-based reservation v1 (`…-dynamic-reservation-v1.md`). The deploy-order net
they led to is §37; the order surfaces themselves are recorded by §38 and §39.

---

## 37. Migration 048 never applied — checkout read path repaired (2026-09-28)

**Archived for length** → `.ai/history/archive/AI_Handoff-2026-09-28-migration-048-read-path.md`.
In one line: production Neon still had no `orders.payment_expires_at`, the migration run died on the
§22 quota, and the checkout READ named the column so a missing deadline took checkout down instead of
being unenforced. Fixed by `selectOrderPaymentRow()` (`to_jsonb(o) ->> 'payment_expires_at'`: one
statement that is correct against both schemas and cannot raise 42703). Still open — see §40.

**OWNER ACTION (unchanged, still required).** Clear the Neon quota, then **Actions → Migrate Neon
Database → Run workflow** with `migration_file = 048_payment_reservation.sql` (`gh workflow run`
answers 403 — the GitHub App has no `actions: write`), **or** run this in the Neon SQL Editor:

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_policy JSONB;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
INSERT INTO schema_migrations (migration_name)
  VALUES ('048_payment_reservation') ON CONFLICT (migration_name) DO NOTHING;
```

Additive and nullable; existing orders keep `NULL` (= "no window", what the sweep ignores).

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


**CI then verified the DB-gated half — `34e8891`, run `36437470190` GREEN: 907 pass / 2 skip / 0 fail**
(909 tests, 41 files) against the disposable `postgres:16` from `test.yml`. All 19 reservation cases
executed and passed, including the ones this sandbox can only skip: "the window written at creation
is a FIXED 30 minutes for every order, stored and auditable", "the order API exposes the deadline, so
a refresh rebuilds the same countdown" (NEW), "five concurrent sweeps still release exactly once",
"a late payment cannot resurrect an expired order — the reconciliation path",
"checkout refuses a lapsed reservation with `PAYMENT_RESERVATION_EXPIRED`", the SAVEPOINT
deploy-order case and "the expiry sweep only ever touches the pre-payment statuses it declares".

**Production — still NOT active, re-confirmed this pass.** The push re-queued the migration runner
(it fires only when `db/migrations/*.sql` changes) and `Migrate Neon Database` run `36437470328`
**failed again** on the same provider condition: `psql: … ERROR: Your account or project has exceeded
the quota. Upgrade your plan to increase limits.` (§22/§37). So `orders.payment_expires_at` /
`reservation_policy` are still absent from production Neon, and the reservation + countdown remain
inert there — orders answer `paymentExpiresAt: null`, the pages render no countdown, and checkout is
unaffected (the §37 deploy-order net). **Owner action to make it live:** clear the Neon quota, then
Actions → Migrate Neon Database → Run workflow (or paste the four statements from §37 into the Neon
SQL Editor).

**Still open (owner-side).** (1) A browser pass over the new order page, the list countdown and the
method chooser in th/en/my. (2) The production migration above.

## 39. Order UX polish — status, progress, address, language (2026-09-28)

**Reported (ORDER UX FINAL POLISH — the last task before VelRepeat).** Make the order list and order
page clear, consistent and multilingual for every unpaid order: per-order countdowns, readable
status, ONE simple progress line, the ORDER's own address, a clearer retry, and no hard-coded Thai.
The 30-minute reservation, the sweep and the release path are untouched.

**Countdown position + states.** Each list card keeps its OWN countdown, placed at the bottom-left of
THAT card (status badge, then the countdown, then one hurry note inside the last 3 minutes) so a
running clock is never ambiguous. ONE presentation clock per page: every card derives its own
remaining time from its own `paymentExpiresAt`. A lapsed card shows the expired state and refetches
once (the sweep may already have released the stock); `visibilitychange` still re-reads the API.
Nothing in the browser writes an order status or a deadline.

**Readable, localized status.** The order-status text came from `ORDER_STATUS_META.label`, which is
Thai-only — so English/Myanmar rendered Thai on both surfaces. NEW `orderStatusI18nKey()` (shared)
maps `orders.status` → `orderStatus.*`, NEW `orderStatus` namespace (th/en/my) covers all 11
statuses + `unknown`, and both pages render the translated label. The payment pill now uses the
semantic badge tokens (`getPaymentStatusBadge`) instead of a white-on-white badge. The Burmese table
also gained the six order-page strings that were still English (`myOrderPatch.orderDetail` in
`locales/index.ts`; that patch object can no longer carry the outer `satisfies Partial<Dict>`,
which a partially-filled namespace cannot satisfy).

**ONE progress line, real statuses.** The old five-icon stepper (no payment stage) is replaced by
`ORDER_PROGRESS_STAGES` = placed → payment → processing → shipped → delivered, with
`orderProgressStageIndex()` as the single mapping (`pending`/`pending_payment` → 1,
`paid`/`confirmed` → 2, `shipped` → 3, `delivered`/`completed` → 4). Terminal orders
(`cancelled`, `expired`, `payment_failed`, `refunded`) return -1 and get the notice that explains
them instead of a line implying progress. One `<ol>`, no nested bars; on a narrow screen only the
current stage label shows (all five names stay in the DOM for screen readers) and
`aria-current="step"` marks the stage. Order status and payment status are separate concepts, each
with its own visible caption.

**Address = the order's snapshot.** The delivery section renders `orders.shipping_address` exactly as
stored (`addressSnapshot`), one line per real field, omitting fields the snapshot lacks, with a
labelled recipient and the country translated only for `TH`. It never reads the profile/address
book, so changing the default address later cannot rewrite an existing order.

**Retry + terminal states.** `ResumePaymentButton` reads "Pay again" (`orderReservation.payAgain`)
and still opens the chooser from `GET /api/payments/methods`. A `payment_failed` order gets its own
notice and NO countdown and NO pay button — the backend released the stock at that point, so a
deadline or a pay button would promise a payment the server refuses; "buy again" is the way forward.

**Verified here.** `typecheck` 4/4 · backend `tsc` 0 · `build:velshop` 0 · `i18n:check`
th=en=my=**1369** · `git diff --check` clean · NEW `backend/tests/order-ux-polish.test.ts`
**10 pass / 0 fail** (one-line progress contract + stage mapping, terminal → -1, a localized label
for every status in all three locales, readable badge tokens incl. the unknown case, both surfaces
render the localized label, the detail page uses the order's OWN snapshot and never a profile
address, a failed payment keeps the original deadline and no fabricated one, per-card countdown) ·
reservation + checkout suites **97 pass / 23 skip / 0 fail** · full backend suite **799 pass /
119 skip / 1 fail**, the same pre-existing `test-database-isolation` sandbox probe (it re-reads this
workspace's `.env`; CI, with no `.env`, passes).

**Still open (owner-side).** (1) The browser pass over both order surfaces and the method chooser in
th/en/my. (2) The production migration (§37): without `payment_expires_at` there is no countdown in
production, and the polish only changes what is rendered when the column exists.

## 40. Countdown invisible in production — migration 048 never applied (2026-09-28)

**Root cause: production Neon has no `orders.payment_expires_at`.** Three migration runs died on
`exceeded the quota` (02:57Z, 14:38Z, 16:56Z); last success 2026-09-25, before 048 existed. The write
is then skipped by the deploy-order guard, `SELECT o.*` maps the absent column to
`paymentExpiresAt: null`, phase `none`, both pages render nothing — silent by design (§37's net).
Logic, API mapping and
deploy ruled out (the bundle carries the code); CI `d7282bb` green with the regression tests. Full
trace + owner check: `.ai/context/payment.md` → *Countdown not visible in production*.

**Shipped anyway:** the tier UI (`8261152`) — GREEN >15:00, YELLOW ≤15:00, RED ≤5:00, dark expired —
plus a bar measured against `orders.reservation_policy.reservationMinutes` (now on both read routes),
never a hard-coded 30; deployed on Vercel (chunks carry `reservationMinutes`/`progressbar`/
`criticalNote`).

**Owner action:** clear the quota → apply 048 (re-queued as `d7282bb`, comment-only, still failing)
→ place a NEW order. Rows created earlier keep `NULL` by design and will never show a countdown.

## 41. Order UX refactor — customer + seller order surfaces (2026-09-29)

**Scope.** VelShop Orders / Order Detail and VelSeller Orders + a NEW seller Order Detail. The payment
reservation, countdown, Stripe webhook, inventory release and the database schema were **not** touched
(§38/§39/§40 carry them unchanged) — this pass moves and repaints the surfaces only. No migration, no
new endpoint, no second timer, no second state machine.

**One status vocabulary, one badge.** NEW `packages/shared/src/components/order/OrderStatusBadge.tsx`
owns the icon + palette for every `orders.status` (11 values + `unknown`) and the five progress-stage
icons. Both apps render it, so their statuses cannot drift. `lib/shop.ts`'s `ORDER_STATUS_ICONS` stays
velcenter's six-status fulfilment map (its `shipped` label means something else), so the two were
deliberately NOT merged.

**VelShop.** Orders list: order number on the left and the status badge TOP RIGHT of the same header row
(was: the badge sat in the money footer, where it read as part of the total); every product row is its
OWN link to `/products/:id` (the whole card used to be one order link, so a product could never be
opened from here), and an unavailable product renders unlinked with `orderDetail.productUnavailable`.
Order Detail: the order number is the `h1`; the shop/seller block is REMOVED from the customer surface
(`shopId`/`shopName` stay in the API — the seller page and velcenter still render them); the progress
line keeps ONE ordered list and gains stage icons (done = check, current = the stage icon, not reached =
outline), laid out vertically on a phone and horizontally from `sm`; a 401/403 load and a 404 now get
different copy (`orderDetail.noAccess`/`noAccessDesc` vs `notFound`).

**VelSeller.** `SellerOrders` becomes a management surface: server-side status filter chips
(`?status=`, the six fulfilment statuses), an eight-column desktop table and tappable mobile cards,
every order number linking to the new route. NEW `SellerOrderDetail` at `/seller/orders/:orderId`
inside `RequireRole role="seller"`: customer, items (each product links to the storefront product page —
there is no seller-side product route, and creating one was not this task), the order's OWN address
snapshot, real shipment/tracking events newest-first with an honest empty state, payment, summary, and
status buttons built from `NEXT_ORDER_STATUSES` = the backend's `SELLER_ORDER_STATUS_TRANSITIONS`
(terminal orders explain themselves; cancelling confirms first because it restores stock server-side).
It reads `GET /api/seller/orders/:id`, which resolves the seller from the SESSION and verifies ownership
inside the query — the page passes no seller id.

**Shared API client.** `api-routes.ts` now throws `ApiError` carrying the HTTP status (still an `Error`
with the same message, so every existing `catch (err) { err.message }` is unchanged) — that is what lets
the order page tell "not yours" (403) from "not found" (404).

**Order numbers.** `generateOrderNumber()` moves to `backend/lib/order-number.ts`: ONE definition
(cart.ts plus a dead copy in stripe.ts collapsed), `crypto.randomInt` instead of `Math.random`, and an
alphabet without `0/O`, `1/I/L`, `U/V`. The format is unchanged — `VNX-YYYYMMDD-XXXXXX`, never
sequential, no UUID exposed to a customer. `orders.order_number` was already guarded by
`idx_orders_number_unique` (both schema files), so checkout now retries that ONE collision under a
SAVEPOINT, and `isOrderNumberCollision()` refuses to treat any other unique violation as retryable.

**New i18n.** `sellerOrders.*` (30 keys), `orderDetail.noAccess`/`noAccessDesc`,
`trackingLabels.none` — in th, en and my.

**Verified here.** `order-number` 7 pass · `seller-order-ux` 12 pass · `order-ux-polish` 22 pass (was
20; two assertions moved onto the shared badge) · full backend suite **830 pass / 119 skip / 1 fail**, the
single failure the pre-existing sandbox-only `.env` guard that passes in CI · backend `tsc` 0 ·
`typecheck` 4/4 · `i18n:check` th=en=my=**1404** · `build:velshop` and `build:velseller` green, with
`SellerOrderDetail` emitted as its own chunk · `git diff --check` clean.

**Not verified here.** (1) A browser pass over both apps at 390/430/1280/1440 px — the sandbox has no
session and no dev server is started per policy, so layout is pinned by contract tests, not observed.
(2) The production schema: migration 048 is still unapplied (§40), so the countdown still renders only
where `payment_expires_at` exists. (3) The seller list no longer carries an inline status dropdown —
status changes are made on the order detail page, which is the redesigned flow (list → detail → change →
back).
