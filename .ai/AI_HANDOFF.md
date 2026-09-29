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

## 5. Latest passes — archived (moved 2026-09-29, edit-headroom housekeeping)

The chronological "Latest passes" narratives moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-29-latest-passes.md`](history/archive/AI_Handoff-2026-09-29-latest-passes.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)) so the current
records could be appended. It describes **completed** work only — the live list of what is
still open is **§6 below**, which stayed inline, and the current work is **§43–§46**.

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
- ~~**The DB-gated tests have never been executed in this workspace.**~~ **CLOSED** — they now
  run against a disposable Postgres, including the two self-approval HTTP cases. **Production Neon is
  verified read-only (§9):** the ledger matches `main` and the 041–046 repairs are applied. What
  remains is a fresh catalog read of four low-severity details (§9.4); the SELECT-only
  `diag-neon-schema.yml` still cannot be dispatched from a workspace (403).
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
- ~~**VelCenter's verification queue labels are hardcoded Thai**~~ **CLOSED (2026-09-26, §20)** —
  every string renders through the existing `review.*` namespace. `ProductModerationQueue.tsx`'s copy
  is still hardcoded Thai (pre-existing).
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

## 11. Media security fixes (TASK 003, 2026-09-24) — archived

**Archived** (full table + validation) →
[`history/archive/AI_Handoff-2026-09-29-media-security-t003.md`](history/archive/AI_Handoff-2026-09-29-media-security-t003.md).
Closed: the `profile-image` route deleted, the presign `purpose` allowlist, server-derived
reference targets, WebP enforcement, `IMAGE_SAVE_FAILED` before any write, and the two
un-awaited `deleteR2Object` calls. **Still OPEN: finding #7 — production data cleanup**
(a data task, not a code path; its root cause is closed by §13). No DB change.

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

**Archived** (full text) → [`history/archive/AI_Handoff-2026-09-25-payment-foundation.md`](history/archive/AI_Handoff-2026-09-25-payment-foundation.md).
Live reference: [`.ai/context/payment.md`](context/payment.md) — read that, not this line.

Built ON the existing Stripe code (V0023) — no second payment system, no duplicate table.
**Stripe: TEST MODE ONLY; COD stays disabled.** The audit found the pre-existing code unsafe
(no PromptPay, no idempotency, sync `constructEvent`, any key accepted, `payment_events` marked
seen before processing, COD as the checkout DEFAULT, `refunds` a table with no code) and
`backend/lib/payment-config.ts` became the ONE decision point: test-mode-only key classification,
fail-closed COD flags, Card + PromptPay checkout, `constructEventAsync`, DATABASE-BACKED
idempotency (`checkout_requests` + `idx_payments_one_active_stripe` + atomic `payment_events`
claim/re-arm), separate order↔payment lifecycles, and refunds capped at the paid amount
(`orders.manage`). Schema: migration 047 + both canonical files; `run-update.sql` **not** created.

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
with a dated index at [`.ai/history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md) — §5, §8, §10, §11,
§12, §14's TASK 004B narrative, §15–§19 (incl. §2's verification system → `.ai/context/verification.md` and
§15–§16 → `.ai/context/payment.md`), §20–§36, §37–§41, **§42.1–§42.5** and **§5 "Latest passes"** (pointers above). The file-edit
tools stop matching past ~55 KB (measured 2026-09-26: ≤54.8 KB edits, ≥68.2 KB does not), so when appending
a record, move a superseded one to `history/archive/` and point at it. **Done 2026-09-29:** §42.1–§42.5 →
`AI_Handoff-2026-09-29-audit-findings-detail.md` (made room for §44/§45), §5 →
`AI_Handoff-2026-09-29-latest-passes.md` (§46), and §11 → `AI_Handoff-2026-09-29-media-security-t003.md`
plus a compressed §15 (made room for §48). Keep §6 (gaps), §9.4/§9.5, the §14 stub,
§18's BLOCKED statements and §42's verdicts.

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

**What this pass is.** A read-only, end-to-end audit of Velnox at **`2c52bfc`** covering Part 1
(payment ↔ customer cancellation race hardening) and Part 2 (30-minute payment reservation +
automatic expiry + stock release). **No code, schema, migration, API, state-machine or UI change was
made by this pass.** Evidence tiers used strictly: **LOCAL VERIFIED** (a command ran here, output
quoted) · **PRODUCTION VERIFIED** (a live production read) · **PRODUCTION BLOCKED** (not observable
from a workspace) · **CODE-VERIFIED ONLY** (read from source, not executed).

**§0 startup sync — the sandbox was 34 commits stale.** `git fetch` put `origin/main` at `2c52bfc`
(**behind 34 / ahead 0**), so `git pull --ff-only` fast-forwarded HEAD to
`2c52bfc734428232ed67dbde3a07b9985d4a506d` == `origin/main`, tree clean, no local work lost and **no
commit created**. **Any handoff or context text written before `2c52bfc` is not verified against the
audited code.**

### 42.1 What was checked, and the result

**The 18-row audit table moved 2026-09-29 (edit headroom)** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md)
(§42.1). What still binds today, restated: **#8/#10** (two release paths, `quantity` never
consumed) → **fixed §43** · **#12 / #6** migration 048 → **still PRODUCTION BLOCKED** ·
**#13** production Stripe is `mode:"test"` with **COD disabled** · **#18** `db/schema.sql` ↔
`db/run-sqleditor.sql` byte-identical, head `048`. The three rows that cannot be claimed from a
workspace — #15 real Stripe E2E, #16 browser E2E, #17 DB-gated suites (no `postgres`/`psql`/`docker`
here; CI is the only execution) — are restated in **§45**.

**Verdicts on the ten architecture questions — ARCHIVED 2026-09-29** → verbatim in
`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md` (§42.1). Headline: authorities were
each single-sourced, but `quantity` was never consumed, the seller path double-released, `paid →
cancelled` existed, production schema mismatched. (2)+(6) ✅ §43 · (7) ✅ refused §44 · (5) ✅ §47 ·
(9) ✅ §48.

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
| H5 | A payment arriving after the order died has no auto-refund and no operator queue (only `console.warn`) | ✅ **FIXED** §47 |
| H6 | PRODUCTION BLOCKED: migration 048 unapplied (Neon quota) → Part 2 inert in production | ⛔ **OWNER ACTION** |
| M7 | The payment-success path ignores variants | ✅ resolved by §43 (`commitOrderInventory` leaves `product_variants.stock` to the reservation) |
| M8 | Two overlapping urgency contracts in `commerce.ts` (3-minute vs GREEN/YELLOW/RED) | ❌ **OPEN** |
| M9 | `orders.status` has no CHECK constraint | ✅ **FIXED** §48 (migration 050) |
| M10 | VelRepeat bypasses the order-creation guards (COD row, `sold_count` at creation, uncommittable hold) | ❌ **OPEN** |
| M11 | Inventory-row AB-BA deadlock → generic 500 `CHECKOUT_FAILED` | ❌ **OPEN** |
| L12 | `"failed"` is dead in `RELEASABLE_STATUSES` | ❌ **OPEN** |
| L13 | `inventory-race` concurrency evidence exists only in CI (LOCAL tier) | ℹ️ evidence note |
| L14 | Settlement is per shop/order row → one multi-shop checkout can end partially paid / expired | ❌ **OPEN** |

### 42.3–42.5 Archived (moved 2026-09-29, edit-headroom housekeeping)

The cancellation matrix, the race verdicts and the prioritized action list moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md),
which now holds all of §42.2–§42.5. The matrix and the race verdicts are fully superseded: their only two
❌ cells were fixed by §43 and §44. **The current open list is §42.2** — do not work from 42.5.

**Not claimable from a workspace (do not treat as verified anywhere).** Real Stripe E2E (no PaymentIntent,
PromptPay QR, webhook delivery or refund has ever been executed from this sandbox); the production schema
query (401); browser E2E of `/orders`, `/cart` and the seller order pages (no signed-in session); and any
DB-gated case locally (CI is the only execution).

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
- **Still open:** the **live** index is **§42.2** (one line per finding, with its current status) —
  do not work from an older list. Since this section was written: **HIGH #4 ✅ §46**, **HIGH #5 ✅
  §47**, **MEDIUM #9 ✅ §48**. Still open: **MEDIUM #8** (two urgency contracts in
  `commerce.ts:783-898`), **#10** VelRepeat bypasses `releaseOrderInventory`
  (`velrepeat-scheduler.ts:267-350`), **#11** inventory AB-BA deadlock (`cart.ts:1027-1034`),
  **LOW #12–#14**, and **#6** migration 048/049 — **PRODUCTION BLOCKED** on the Neon quota (owner
  action; never report Part 2 as live in production until it is applied). Full text of all fourteen
  findings: [`history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md`](history/archive/AI_Handoff-2026-09-29-audit-findings-detail.md).

---## 45. CI follow-up — the paid-cancellation assertion was the bug, not the code (2026-09-29)

**CI failure: FIXED.** Implementation changed: **NO** (zero source files touched).
`test(orders): fix paid cancellation regression assertion` · start `08d6d68` · runs
`36580595287` (`2a725d3`) and `36580934430` (`c313244`) both **success, 1020 pass / 2 skip / 0 fail**.

- **Root cause:** a stale assertion that contradicted its own fixture, in the DB-gated test §44
  added (`order-fulfillment-state-machine.test.ts`): it seeds `paidRow` at `orders.status='paid'`
  on purpose (the raw webhook-written status must be refused, not just a `paid` payment row), then
  swept ALL rows asserting `'confirmed'` — `Expected: "confirmed"` / `Received: "paid"`. The gate is
  a read-only `SELECT` and the `ORDER_ALREADY_PAID` assertion just before it PASSED, so the
  implementation was never wrong. Fix: assert each row against its OWN seeded status, and add
  `unpaid` so the allowed path is covered too.
- **CI is the proof, not the local run** (the fixed test is one of 5 DB skips — no Postgres here).
  Full evidence incl. both CI logs: `.ai/tasks/completed/inventory-integrity-fix-2026-09-29.md`
  → "CI Failure Follow-up".

---

## 46. HIGH #4 — payment ATTEMPT identity (2026-09-29)

**Status: FIXED** · `fix(payment): separate failed attempts from order payment state` · start
`c313244`. **One production file: `backend/routes/stripe.ts`.** No schema, no migration, no
inventory file, no frontend, no new business rule.

- **Root cause — every write to `payments` chose its row by a NEWEST-ROW HEURISTIC, not by the
  attempt the Stripe event names.** All three sync writers (and the completed-but-unpaid
  `checkout.session.completed` branch) used `SELECT id … WHERE order_id=$1 AND provider='stripe'
  AND status <> 'x' ORDER BY created_at DESC LIMIT 1`, discarding `paymentIntent.id` / `session.id` —
  in hand at every call site and already stored in `provider_payment_id` /
  `provider_checkout_session_id`. An order **legitimately has several payment rows** (checkout
  retires one attempt and opens another), so a **LATE event about a dead attempt landed on the live
  one**: a late `payment_intent.payment_failed` failed the customer's still-open session, flipped the
  ORDER to `payment_failed` and released their stock; a late `payment_intent.succeeded` recorded
  captured money against an attempt that was never charged (that row is what a refund is built from).
  Both are Invariant F.
- **The order-level half was NOT the bug and was NOT changed.** `payment_failed` is terminal for
  payment by design — `PAYABLE_ORDER_STATUSES = ['pending','pending_payment']`, enforced at
  `stripe.ts:886`, and `.ai/context/payment.md` says the answer is "buy again". **No retry policy
  was invented**; the brief's "customer retries the same order" scenario is impossible here by
  design. The supported retry is the one INSIDE the payment window — that is where the defect was.
- **Solution:** NEW `resolvePaymentAttemptRow()` resolves the row by `provider_payment_id` OR
  `provider_checkout_session_id` (order + `provider='stripe'` scoped), keeping the newest-row
  heuristic ONLY as a fallback for an event carrying no stored identifier, so nothing that resolves
  today changes. The terminal guards moved onto the **outer** UPDATE, and `markPaymentFailed` /
  `markPaymentCanceled` now require **this attempt to have actually transitioned**
  (`status NOT IN ('paid','failed','cancelled')`, read from `rowCount`) before the order moves and
  stock is released — that is what stops the order-level damage.
- **Inventory impact: none.** `commitOrderInventory()` / `releaseOrderInventory()` unmodified; no
  new helper, no direct stock restore. `releaseOrderInventory` is simply no longer *reached* by an
  event about a dead attempt. CRITICAL #1/#2 and HIGH #3 stand.
- **Tests:** NEW `payment-attempt-identity.test.ts` — 7 DB-free contract tests (local proof; **4
  failed before the fix**) + 6 DB-gated behavioural tests driving the real webhook with locally
  signed events (CI-only). Local full suite **867 pass / 168 skip / 0 fail**, 1035 tests / 48 files ·
  backend `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · i18n 1416×3.
- **⚠️ First CI run FAILED (`36585376063`, `1031 pass / 2 fail`) — both were defects in the NEW
  TESTS, not the fix, and no production file changed in response:** one test asked for a `failed`
  attempt to become `paid` (the opposite of Invariant A), and one fixture seeded two attempts inside
  `idx_payments_one_active_stripe`'s predicate (the legal shape is one active + one retired). Both
  corrected and re-verified — details in the audit doc §22.
- **✅ CI GREEN on `c599606`: run `36586188271` → success, `1033 pass / 2 skip / 0 fail`**, and all six
  DB-gated attempt-identity tests report `(pass)` — the only place they can execute.
- **Full evidence (25 sections, state map, every command):**
  [`.ai/tasks/completed/payment-failed-retry-2026-09-29.md`](tasks/completed/payment-failed-retry-2026-09-29.md)
- **Remaining blockers:** migration 048 **PRODUCTION BLOCKED** (owner, Neon quota) · Stripe E2E ⛔
  · browser E2E ⛔ · MEDIUM #8–#11, LOW #12–#14 open.

---

## 47. HIGH #5 — late / unrecordable payment operator flow (2026-09-29)

**Status: FIXED** · `fix(payment): add operator handling for late payments` · start `fd4ba52`.
**No refund policy, no reopen policy, no order resurrection, no order-lifecycle change.**

- **Root cause — "money arrived that the system cannot act on" was a `console.warn`, not a record.**
  `markPaymentSucceeded` treated `!moved` as the only exceptional outcome, and a log line cannot be
  listed, filtered, assigned or acknowledged. Worse, the sharpest case was **structurally invisible**:
  a captured charge for an attempt already recorded `failed` on an order that is still
  `pending_payment` **moves the order to `paid` and commits the stock** while the payment row stays
  `failed` — and `POST /api/admin/orders/:orderId/refund` then refuses it (`409
  PAYMENT_NOT_REFUNDABLE`; that route requires `status = 'paid'`). Reachable via
  `SESSION_NOT_REUSABLE` (customer switches rail) followed by paying the old tab.
- **Solution:** NEW `backend/lib/payment-incidents.ts` — the ONE authority — records
  `payment_incidents` (migration **049**) whenever money is received that cannot safely settle.
  Detection widened from `!moved` to `!moved || !attemptRecorded`, **minus duplicate deliveries**
  (Stripe fires two events per charge). Order guards and both inventory functions are untouched.
- **No policy invented:** `.ai/context/payment.md` already fixes it — "never resurrect … No refund is
  invented in code — an operator decides". The resolve route updates only `payment_incidents` (pinned
  by test: no `UPDATE orders/payments/refunds`, no inventory work).
- **Idempotency:** `dedupe_key` = `provider:orderId:attempt:reason`, UNIQUE, enforced by
  `ON CONFLICT DO NOTHING` (not check-then-insert) — 3 redeliveries leave exactly 1 row.
- **Authorization:** `orders.view` to list, `orders.manage` to resolve — the **existing** catalog, no
  new permission, no new auth. New VelCenter tab `incidents`, with **no refund and no reopen button**.
- **Schema-tolerant on purpose:** 049 is unapplied in production for the same Neon-quota reason as 048,
  so the write swallows `42P01`/`42703` and the list route answers `schemaMissing: true` instead of
  500-ing a webhook or the dashboard.
- **Tests:** NEW `late-payment-incidents.test.ts` — 10 contract (local) + 8 behavioural, covering
  cases A–D, dedupe, authorization, and that resolving changes nothing but the incident. Local full
  suite **878 pass / 176 skip / 0 fail**, 1054 tests / 49 files · backend `tsc` 0 · `typecheck` 4/4 ·
  `build:apps` 4/4 · i18n 1416×3 · schema parity.
- **⚠️ First CI run FAILED (`36590962144`, `1033 pass / 19 fail`) — a test-helper gap, NOT a
  production defect.** `payment_incidents.order_id` is a NO ACTION FK on `orders`, but
  `backend/tests/helpers/purge.ts` enumerates every NO ACTION child of a user's orders before
  deleting them, and the new table was missing from that list. Incidents are written
  **automatically** by the webhook, so all 13 pre-existing late-payment suites started failing too —
  in their own `finally` block, with all assertions passed. Fixed by adding the table to that loop;
  no assertion weakened, no test skipped, schema unchanged.
- **⚠️ Second CI run FAILED (`36591311016`, `1050 pass / 2 fail`) — a test-fixture gap in THIS task's
  own tests, not a product defect.** Both were `Expected: 200 / Received: 403`: the fixture inserted
  only an `employees` row, but `resolvePermissions` takes the role from **`users.role`** (default
  `'customer'`) and reads the permission list only for a `staff` account, so both seeded "operators"
  resolved an empty one. Fixed by inserting the role on `users`; the 403 assertions were **not**
  weakened.
- **✅ CI GREEN on the third run — `36592289354` (`b9551b8`): `1052 pass / 2 skip / 0 fail`,
  1054 tests / 49 files, job success.** All 18 tests of the new file executed against the
  disposable PostgreSQL (the 2 skips are the unrelated R2 cases). Both fixes are confirmed by
  execution, not by reasoning.
- **Full evidence (28 sections):**
  [`.ai/tasks/completed/late-payment-operator-2026-09-29.md`](tasks/completed/late-payment-operator-2026-09-29.md)
- **⚠️ OWNER DECISION, not solved here:** in Case A the charge sits on a `failed` row, so the
  existing refund route still cannot move it. What a captured charge on a failed attempt **is**
  (refund, or keep against a delivered order) is a refund policy no source or doc states.
- **Remaining blockers:** migrations 048 **and 049 PRODUCTION BLOCKED** (owner, Neon quota) ·
  Stripe E2E ⛔ · browser E2E ⛔ · MEDIUM #8–#11, LOW #12–#14 open.

## 48. MEDIUM #9 — `orders.status` CHECK constraint (2026-09-29)

**Status: FIXED** · `fix(db): constrain order status values` · start `08e72e1`.
**No state machine change, no new status, no application source file touched.**

- **Root cause — the only status column in the schema without a CHECK.** `orders.status` was
  `TEXT NOT NULL DEFAULT 'pending'`, while `sellers.status`, `verification_status`,
  `velrepeat_plans.status` and `velrepeat_runs.status` all have one. Free text lets a typo or a
  retired path store a value nothing knows, and `normalizeOrderStatusToFulfillment()` answers
  `pending` for anything unrecognised — so the row looks un-actioned, not broken.
- **The allowed set was DERIVED from the writers, not chosen:** the 7 `FULFILLMENT_STATUSES`
  (`lib/order-fulfillment.ts`) ∪ 5 payment-lifecycle values `routes/stripe.ts` writes
  (`pending_payment`/`paid`/`payment_failed`/`refunded`) ∪ `expired` (the reservation sweep — a real
  orders.status value). The two parameterized writers (`seller-orders.ts:617`, `center.ts:517`)
  cannot escape the set: `canTransitionFulfillment()` gates them in-transaction.
- **Deliberately excluded:** `failed` (dead in `RELEASABLE_STATUSES`, audit LOW #12 — no writer
  produces it) and every `payments.status` value (`processing`, `requires_action`,
  `partially_refunded`). Payment state stays a separate axis.
- **History — this is a RE-ADD, not an invention:** V0003 declared a narrower list (no `packing`,
  no `completed`, no payment values), the real writers began failing, and **V0016 dropped it**
  (`016_sync_schema_discrepancies.sql:26`). V0050 restores it with the correct list.
- **Constraint:** `orders_status_check` — inline on `CREATE TABLE orders` plus an idempotent `ALTER`
  in the schema's self-heal section; both canonical files byte-identical. **Migration V0050** —
  DROP IF EXISTS + ADD, two statements, no trigger/enum/table. `db/run-update.sql` untouched.
- **It is NOT the state machine, and a test proves it:** `completed → pending` (no edge in
  `FULFILLMENT_TRANSITIONS`) is **accepted** by the database. `canTransitionFulfillment()`,
  `lockOrderRow()`, and the payment/shipment/cancellation gates remain the only transition
  authority; none was weakened.
- **Tests:** NEW `order-status-check-constraint.test.ts` — 17 contract (local) + 9 DB-gated
  (PostgreSQL only). The DB-gated ones assert the **real error** (`23514`,
  `constraint = orders_status_check`), every allowed value on INSERT *and* UPDATE, near-misses
  (`PAID`, `" pending"`, `ship`, `payed`), and that the guarded cancel/expiry shapes still write.
  One pre-existing test asserted the CHECK's **absence**; it was rewritten to the new truth with
  **stronger** assertions, never skipped or weakened.
- **✅ Verification:** local `896 pass / 185 skip / 0 fail` (1081 tests / 50 files) · backend `tsc` 0
  · `typecheck` 4/4 · `build:apps` 4/4 · i18n 1416×3 · schema parity OK · `git diff --check` clean ·
  `lint` is `echo 'Lint not yet configured'` (no real lint script in the repo).
- **⚠️ Production NOT verified, and this migration NARROWS the set.** If any historical production
  row carries an out-of-set value, V0050 **fails loudly by design** rather than rewriting a live
  order's status — the diagnostic `SELECT` is in the migration header. 048/049 are still unapplied,
  so 050 has not run either and production `orders.status` is still unconstrained.
- **Full evidence (30 sections):**
  [`.ai/tasks/completed/order-status-check-2026-09-29.md`](tasks/completed/order-status-check-2026-09-29.md)
- **HIGH #5 untouched** — no refund policy, no refund-route change, no reopen. The captured-charge
  -on-`failed`-attempt question remains an **OWNER DECISION**.
- **Next task:** MEDIUM #8 — collapse the two overlapping reservation-urgency contracts in
  `packages/shared`'s `commerce.ts`.
