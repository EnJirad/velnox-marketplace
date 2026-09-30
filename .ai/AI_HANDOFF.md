# Velnox AI Handoff — current state

**Last updated:** 2026-09-30 · **Branch:** `main` · **Latest pass:** VelRepeat **V2 Phase 1 — domain + schema implemented** (**§53**) — additive only; payment linkage (Q13) + decisions **A–I** still BLOCKED; no migration file (auto-apply hazard)
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
  owner **completed the configuration step** — verified read-only 2026-09-27: production reports
  `{configured:true, mode:"test", webhookConfigured:true}` and `/api/payments/methods` offers
  **CARD + PROMPTPAY** (COD disabled); the key is a `pk_test_…`. What is still unproven is the
  round trip itself: no PaymentIntent, PromptPay QR, webhook delivery or refund has ever been
  executed **from this workspace** (`freebuff-env list` → `{"files":{}}`), so those remain
  **CODE VERIFIED, never PASS** — and driving them in production means taking money in the owner's
  own account. `STRIPE_CONNECT_MISSING`: no Connect, no payout (checkout ≠ payout readiness).
  Variables: `INSTALLATION.md` §4 + `docs/ENVIRONMENT.md`; `.env.example` is owner-edit only.
- ~~**The DB-gated tests have never been executed in this workspace.**~~ **CLOSED** — they now
  run against a disposable Postgres, including the two self-approval HTTP cases. **Production Neon is
  verified read-only (§9):** the ledger matches `main` and the 041–046 repairs are applied. What
  remains is a fresh catalog read of four low-severity details (§9.4); the SELECT-only
  `diag-neon-schema.yml` still cannot be dispatched from a workspace (403).
- **`backend/tsconfig.json` excludes `tests`**, so `tsc` never validates test files — a syntax
  error or bad import surfaces only when `bun test` parses it. After editing a test, run that file.

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
- **Migration numbering has duplicates** (029, 030, 034, 035). A prefix-keyed runner applied only
  one file per number, which is how the V0035 repair was skipped. New migrations must use an unused
  number; consider renumbering.
- **Channels with no publisher.** `cart:updated`, `order:created` and
  `inventory:updated` are in the subscribe allowlist but nothing broadcasts them.
  **Confirmed by measurement (2026-09-26, §19):** 0 `CHANNELS.*` publisher sites
  each (`order:updated` 14, `product:updated` 1, `seller:updated` 1). Harmless today
  (no consumer subscribes), but they are dead entries.
- **The `velnox.com` zone does not resolve** (Google DoH `Status: 2`, "Name servers
  refused query (lame delegation?)"; `center.velnx.com` is NXDOMAIN). Production is unaffected —
  every Vercel project sets `VITE_*` overrides and no deployed bundle references `*.velnox.com` —
  but the `sites.ts` defaults point at dead hosts.
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
- Tooling note: both edits sat past the ~55 KB match window and were applied with a single-use
  `bun` anchor-asserting script.
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

## 37–48. Archived (moved 2026-09-30, edit-headroom housekeeping)

§37–§48 (migration 048 read path, the Stripe TEST-mode E2E attempts and their BLOCKED verdicts,
the CI guard fix, the §42 full-system audit, §43 inventory CRITICAL #1/#2, §44 the paid-order
cancellation guard, §46 HIGH #4 payment attempt identity, §47 HIGH #5 late-payment operator
flow, §48 MEDIUM #9 `orders.status` CHECK) moved **verbatim** to
[`history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md`](history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md)
(index row: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).

**Still live from them:** the reservation is a **CONSTANT 30 minutes** · **migrations 048, 049 and
050 are still NOT applied in production** (Neon quota, §14/§16/§21–22) · real Stripe TEST E2E and
browser E2E have **never** run · the current status of every audit finding is the compact index in
**§51**, with MEDIUM #10 / #11, LOW #13/#14 and HIGH #4/#5 still **open**.

---

## 49. LOW #12 — the dead `failed` order status removed (2026-09-30)

**Status: FIXED (Case A — dead confirmed).** `fix(order): remove dead failed status guard` ·
start `04ab7ea`. **Read-side guard cleanup only:** no schema, no migration, no new status, no
state-machine / cancellation / refund / retry change, no `payments.status` change, no Stripe change.

- **What it was.** `RELEASABLE_STATUSES` (`backend/lib/inventory.ts`) gates the atomic
  `inventory_released` claim so a paid / shipped / delivered / completed order can never have its
  stock returned. It listed `"failed"` — a value that **does not exist in the order domain**.
- **Proven dead, not assumed.** All **11** `orders.status` writers were enumerated; the three dynamic
  ones traced to their origin (`seller-orders.ts:617` and `center.ts:517` are `SET status = $1` but
  gated by `isFulfillmentStatus` + `canTransitionFulfillment`; the scheduler writes the constant
  `expired`). The union of reachable values is MEDIUM #9's exact 12-value set — **no `failed`**. Two
  files that *look* like writers are not: `inventory.ts:206` writes the **flag**,
  `payment-reservation.ts:139` the **reservation window**. `git log --all -S"UPDATE orders SET status
  = 'failed'"` returns **nothing** — never written, at any commit. It was in the *first* version of the
  guard (`707d1c0`): a `payments.status` value copied into an `orders.status` guard.
- **Removed; the const is now exported** so a test asserts the real value, not a copy. The claim SQL,
  its `$2`/`$3` binding, the idempotency claim and the settled-payment refusal are **byte-identical**;
  there is exactly **one** call site.
- **Every other `'failed'` is a different axis, left alone:** `payments.status` (`stripe.ts:592`,
  `:1259`, `payment-config.ts`), `payment_events.status` (`:1578`), the V0049 comment,
  `StorePaymentStatus`, and three **read-side** analytics guards now unreachable no-ops (out of scope).
- **Tests:** NEW `dead-order-status-failed.test.ts` — **26 local + 4 DB-gated**, incl. a whole-tree
  assertion that **no source file writes `orders.status = 'failed'`**, a table-resolution scan proving
  every SQL `status = 'failed'` write targets `payments`/`payment_events`, the MEDIUM #9 set still
  exactly 12 and still without `failed`, and (DB-gated) that **PostgreSQL refuses it with 23514 on
  both INSERT and UPDATE**. The pre-existing `not.toContain("failed")` assertion was **kept**.
  **Mutation-checked:** re-adding `"failed"` fails 6 of the new tests.
- **✅ Verification:** local `922 pass / 189 skip / 0 fail` (1111/51) — exactly +26/+4/+1 over
  `04ab7ea` · `tsc` 0 · `typecheck` 4/4 · `build:apps` 4/4 · i18n 1416×3 · schema parity OK ·
  `git diff --check` clean · `lint` = placeholder (no real lint script).
- **⚠️ First CI run FAILED (`36643103344`, `1106 pass / 3 fail`) — a defect in THIS task's own test
  fixture; no production file changed.** The `order_items` INSERT declares 4 placeholders but passed 5
  values; DB-gated, so only CI could catch it. Fixed in `b63610a`; **no assertion weakened.**
- **✅ CI GREEN on `b63610a`: `36643327528` → success, `1109 pass / 2 skip / 0 fail`** — all 26 local
  + all 4 DB-gated LOW #12 tests `(pass)`. Docs run `36643598261` (final HEAD `d21de22`) also green.
- **Production:** **048/049/050 still NOT APPLIED** (Neon quota — **OWNER ACTION**). No migration file
  changed, so `Migrate Neon Database` did not trigger. Safe to deploy before 050 exists.
- **Full evidence (10 sections, the 8-category classification, every writer, every command):**
  [`.ai/tasks/completed/dead-order-status-failed-2026-09-30.md`](tasks/completed/dead-order-status-failed-2026-09-30.md)
- **MEDIUM #9 and HIGH #5 both untouched.** The captured-charge-on-a-`failed`-**attempt** question
  remains an **OWNER DECISION** (it concerns `payments.status`, not modified here).
- **Next task:** MEDIUM #8 (now §50, done) → **MEDIUM #10** VelRepeat bypasses
  `releaseOrderInventory`.

---

## 50. MEDIUM #8 — the duplicated reservation-urgency contracts (2026-09-30)

**Status: FIXED (CASE C — one contract was provably dead).**
`fix(shared): resolve reservation urgency contract duplication` · start `d21de22` (= `origin/main`).
**Presentation only:** no order state, no payment state, no Stripe, no inventory, no DB, no migration,
no new status, no i18n key, no change to the 30-minute policy.

- **What M8 was.** `commerce.ts` carried two urgency scales: `PAYMENT_RESERVATION_URGENT_MS = 3 min`
  (phase → `urgent`) and `PAYMENT_RESERVATION_YELLOW_MS = 15 min` / `RED_MS = 5 min`
  (tone → green/yellow/red). Both were imported by `MyOrders.tsx` **and** `ShopOrderDetail.tsx`.
- **Proven duplicate vs distinct — from source, not names.** Every comparison against a phase value
  in the whole repository is `phase === "active" || phase === "urgent"` (3 sites), plus `=== "expired"`
  (3) and `=== "none"` (1). **No consumer ever distinguished `urgent` from `active`**, so the 3-minute
  tier could not change a pixel. The urgency users actually see is chosen from the **tone** on both
  pages (`criticalNote` at RED ≤5 min, `urgentNote` at YELLOW ≤15 min) and drives the colour maps.
- **Why it was dead (history).** §38 shipped the 3-minute phase tier; §39 (`8261152`) added the tone
  tiers and left the old one behind. Its own doc comment — *"the last three minutes stay 'urgent' too,
  which is what turns the hurry note on"* — had been **false since §39**; the note has been driven by
  `tone === "red"` (5 min). A superseded remnant, not an intentional second contract.
- **Removed:** `PAYMENT_RESERVATION_URGENT_MS` and the `"urgent"` member
  (`PaymentReservationPhase` is now `none | active | expired`). The phase is a pure window-visibility
  predicate; the tone is the single urgency authority. `MyOrders.tsx` (×2) and `ShopOrderDetail.tsx`
  (×1) drop `|| === "urgent"` — the countdown now renders **continuously** 30:00 → 00:01 while the
  note/colour escalate. The old pin `"only the last three minutes are urgent"` was **replaced**, not
  deleted: the new test asserts the phase stays `active` at six sample points, that `02:13` still
  formats identically, and that the urgency is carried by the tone.
- **Tests:** NEW `reservation-urgency-contracts.test.ts` — **34 DB-free tests** covering all eight
  required proofs, behavioural and cross-file (no tautologies). **Mutation-checked:** re-inserting
  `"urgent"` + the 3-minute branch fails 2 of them; reverting returns 34/34.
- **✅ Verification:** local `956 pass / 189 skip / 0 fail` (1145 tests / 52 files) — exactly
  +34 pass / +0 skip / +1 file over `d21de22` (`922/189`, 51 files) · backend `tsc` 0 · `typecheck`
  4/4 · `build:apps` 4/4 · i18n th=en=my=**1416** (unchanged) · `git diff --check` clean ·
  `lint` = `echo 'Lint not yet configured'` (**no real lint script**). The task brief's `pnpm …`
  commands are **NOT AVAILABLE** — this is a `bun` workspace (`bun.lock`, no `packageManager`);
  the repository's real commands were run per `.ai/context/testing.md`. No new DB-gated test (pure
  presentation logic, no SQL); the 189 skips are the pre-existing suites, unchanged.
- **✅ CI GREEN — `36648719460` (code `fcf250b`) and `36648733866` (final HEAD `fa10c52`), both
  success; `1143 pass / 2 skip / 0 fail`, 1145 tests / 52 files.** All **34** MEDIUM #8 tests report
  `(pass)`, zero failures. `Migrate Neon Database` did not trigger (no migration file changed).
- **Production: BLOCKED, unchanged by this task.** Migrations **048/049/050 are still NOT APPLIED**
  (Neon quota — **OWNER ACTION**), so production has no `orders.payment_expires_at` and **no
  countdown renders at all**; these tiers are only reachable once 048 lands. No migration file
  changed, so `Migrate Neon Database` will not re-trigger. The **browser pass over both order
  surfaces in th/en/my is still open** — "rendering is byte-identical" rests on source proof
  (one JSX branch) + 60 passing source-pinning tests, **not** on a browser run.
- **Full evidence (objective, baseline, the 15-symbol table, the 3 consumer comparisons, data flow,
  the 8 proofs, verification):**
  [`.ai/tasks/completed/reservation-urgency-contracts-2026-09-30.md`](tasks/completed/reservation-urgency-contracts-2026-09-30.md)
- **HIGH #4, HIGH #5, MEDIUM #9, LOW #12 all untouched** — no order/payment state, no `payments.status`,
  no Stripe semantics, no attempt identity, no incident handling, no inventory, no cancellation /
  refund / retry policy, no schema.

---

## 51. VelRepeat — Prepaid Repeat Commerce (2026-09-30) — CONTRACT COMPLETE, IMPLEMENTATION STOPPED

### Audit-finding index (current)

| Finding | State |
|---|---|
| HIGH #4 payment attempt identity | ✅ fixed (§46) |
| HIGH #5 late/unrecordable payment operator flow | ✅ fixed (§47) — `payment_incidents` (migration **049**) |
| MEDIUM #8 duplicated reservation-urgency contracts | ✅ fixed (§50) |
| MEDIUM #9 `orders.status` CHECK | ✅ fixed (§48) — migration **050** |
| LOW #12 dead `failed` order status | ✅ fixed (§49) |
| MEDIUM #10 VelRepeat commerce lifecycle | ⚠️ **audit DONE, fix BLOCKED** — see below |
| MEDIUM #11 · LOW #13 · LOW #14 · HIGH #4 residual | ⬜ open |

### What was done

1. **PHASE 0–2** — re-read every `.ai` doc and re-inspected the named source at `6f5a998`;
   full grep list run. **PHASE 25** — `.ai/context/velrepeat-contract.md` gained **Part II (§23–§38)**:
   a current-facts table for every business-model concept, the existing-tables-vs-required-concepts
   check, the prepaid-payment blocker, delivery cycles, package, price snapshot, schedule, commitment
   and tiering, the plan-vs-cycle inventory comparison, `sold_count` under prepaid, cancellation /
   pause / skip / modification, B2C/B2B, scheduler ownership, incidents and idempotency. Every row is
   tagged **[PROVEN]** / **[INTENT]** / **[DECISION]** / **[OWNER DECISION REQUIRED]** with `file:line`.
2. **One code change only** — the owner-approved PHASE 15 fix. `POST /api/subscriptions/process-due`
   (`backend/routes/seller-orders.ts`) selected due plans with **no user scope**, so any approved
   seller could force-run **any** customer's due plans. It is now scoped with the same ownership
   predicate the read path already uses (`EXISTS … velrepeat_items vi WHERE vi.plan_id = vp.id AND
   vi.seller_id = $1`). Tests: 3 structural + 3 DB-gated in `backend/tests/velrepeat-core.test.ts`.
3. **Housekeeping** — §37–§48 moved verbatim to
   `.ai/history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md` (this file 56.4 KB → 36.8 KB).

### Why the prepaid model is NOT implemented (STOP)

Three **structural** facts found in source, each of which alone blocks it:

- **`payments.order_id` is `NOT NULL`** (`db/run-sqleditor.sql:441`). There is no plan-level payment,
  and `POST /api/stripe/checkout` derives its amount from `orders.total_amount`. A charge for
  **N** cycles has **no canonical home**. The obvious "new VelRepeat payments table" is a **second
  payment authority** and is forbidden.
- **`commitOrderInventory` — the ONE `sold_count` authority — is reached only from the Stripe
  webhook** (`stripe.ts:559`), i.e. on payment settlement. Under prepaid, money settles **once at
  plan level, before any cycle order exists**, so the canonical authority becomes **unreachable**.
- **`velrepeat_runs` has no cycle identity** (`UNIQUE (plan_id, scheduled_for)` but no ordinal, no
  commitment, and one run creates **one order per shop**). "Cycle N ⇒ exactly one order" cannot be
  idempotently proven today.

Owner decisions resolved by the owner: **#1 Stripe is the VelRepeat rail and COD must respect
`COD_ENABLED`** (no VelRepeat bypass), **#7 the central scheduler owns global due-plan processing
and a seller may not trigger other customers' plans**. Note that #1 does **not** by itself wire
Stripe, and it does **not** enable COD.

**17 open owner decisions** — the owner's own PHASE 26 Q1–Q12 plus Q13 prepaid payment shape,
Q14 Stripe charge vs Stripe Subscriptions, Q15 the V1 `vrepeat_packages` table, Q16 plan timezone,
Q17 per-seller plan splitting — are listed in **contract §38**. Q1, Q2, Q3 and Q7 are the ones that
gate all financial/inventory code. **No financial, inventory, `sold_count`, payment-rail or schema
change was made.**

### Verification at this pass

`bun run test` **959 pass / 192 skip / 0 fail** (1151 tests, 52 files) · `cd backend && bunx tsc
--noEmit` 0 errors · `bun run typecheck` 4/4 · `bun run build:apps` 4/4 · `bun run i18n:check`
th=en=my=1416 · `git diff --check` clean. **DB-gated tests skip locally** — no PostgreSQL is
available; CI's `postgres:16` is the only real execution. **PRODUCTION = BLOCKED** (Neon quota;
migrations 048/049/050 still unapplied). `bun run lint` is `echo 'Lint not yet configured'` — no
lint script exists.

---

## 52. VelRepeat **V2 — Prepaid Repeat Commerce Contract** (2026-09-30) — CONTRACT COMPLETE (design only)

**What was done:** `.ai/context/velrepeat-contract.md` upgraded in place to the **V2 contract**
(Revision 2.0) preserving Parts I–II and adding **Part III §39–§64**: business definition; Product /
Package / Repeat Plan / Delivery Cycle / Order / Payment / Fulfillment distinctions; quantity per cycle
vs total commitment; schedule + explicit timezone semantics; commitment vs schedule; pricing pipeline
(tiers in data — no hardcoded percentages); immutable price snapshot; one prepaid payment per plan
(฿93 × 4 = ฿372 once); payment authority (1A/2A/5A); payment vs fulfillment; plan → Cycle 1..N → per-cycle
order(s); inventory Model A/B comparison (not chosen); `sold_count` invariants (3A); cancellation /
pause / skip / modification with owner decisions reserved; B2C+B2B single model; authorization (7B);
idempotency incl. *same Plan + Cycle + execution ⇒ one Order*; HIGH #5 incidents; **V2 OWNER DECISIONS**
(approved 1A–7B + new **A–I** + Q13–Q17); 14-area gap analysis; Phases 1–10 roadmap; acceptance
criteria; prohibited actions. Audit: `.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md`.

**Files changed:** `.ai/context/velrepeat-contract.md`,
`.ai/tasks/audits/velrepeat-v2-contract-2026-09-30.md`, `.ai/AI_HANDOFF.md`. **No production code,
schema, migration, payment, inventory or scheduler change.**

**Gates for implementation (NOT STARTED):** §60.2 decisions **A–I** (inventory model; prepaid
cancellation; skip; pause; future price change; out-of-stock cycle; modification; B2B stacking;
prepaid fulfillment failure) + §60.3 **Q13–Q17** + Q2 residual (`sold_count` moment). Approved:
**1A–7B**. The three structural blockers (§51) remain and are folded into contract §61.

**Verification:** `git diff --check` clean · docs-only (no typecheck/test impact; DB-gated tests still
skip locally) · remote `main` = `94888dc` (push verified) · CI **Tests** run
[`36665766003`](https://github.com/EnJirad/velnox-marketplace/actions/runs/36665766003) **success**
(1m11s) · **PRODUCTION = BLOCKED** (Neon quota; migrations 048/049/050 unapplied).

**Next step:** owner answers A–I (+Q13–Q17) → then contract §62 **Phase 1** (domain + schema) may
start; nothing before.

---

## 53. VelRepeat **V2 Phase 1 — domain + schema implemented** (2026-09-30)

**What was done (additive, both canonical SQL files, byte-identical).** `velrepeat_packages` +
`velrepeat_package_items` (composition of real products/variants; owns no stock);
`velrepeat_plans.commitment_cycles` (nullable, CHECK > 0); `velrepeat_pricing_snapshots` +
`velrepeat_pricing_snapshot_items` (append-only checkout snapshot: commitment, currency, discount,
totals, rule key/version, per-line qty/price); `velrepeat_cycles` (**UNIQUE (plan_id, cycle_number)** —
the idempotency key for “same plan + cycle ⇒ one order”); `orders.velrepeat_cycle_id` + FK + partial
index. Tests: `backend/tests/velrepeat-v2-domain-schema.test.ts` (structural everywhere + DB-gated, run
by CI’s `postgres:16`). Analysis/audit:
`.ai/tasks/audits/velrepeat-v2-phase1-dependency-analysis-2026-09-30.md`.

**No migration file** — deliberately. `.github/workflows/migrate-neon.yml` applies **all pending
migrations** (048–050 still unapplied — owner action, Neon quota) on any push touching
`db/migrations/*.sql`; adding Phase 1 as `051` would trigger unattended production DDL. Next number: `051`.

**BLOCKED — OWNER DECISION REQUIRED (unchanged):** Q13 payment linkage (no payment DDL) · Decision A
inventory (Phase 6) · H/Q11 pricing rules (Phase 2) · plan prepaid statuses Q13/Q14 (Phase 4) ·
B/C/D/G/I lifecycle (Phase 9) · Q15–Q17. Nothing was guessed.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** (1164 tests, 53 files) · backend tsc 0 ·
typecheck 4/4 · build:apps 4/4 · `git diff --check` clean · `cmp` schema files identical · **PRODUCTION =
BLOCKED** (Neon quota; migrations 048/049/050 unapplied — the new objects are absent in prod and unread
by any code, so behavior is unchanged).

**Next step:** Phase 2 (Package + Pricing) is **gated on H/Q11** and the package-authoring ownership
question; Phase 3/4 additionally on Q13/Q14. Do not start a phase whose gates are open.

---

## 54. VelRepeat **V2 Decision Closure + Architecture Gate** (2026-09-30)

**What was done (analysis only — no code, no schema, no migration, no decision answered).** New audit
`.ai/tasks/audits/velrepeat-v2-decision-closure-2026-09-30.md` (20 sections): Q13 options A/B/C with
Option B's full surface (payments + refunds + incidents + reservation mapping; 88 `payments` occurrences
across 13 backend non-test files — 44 SQL lines; **Option B does not create a second payment authority**
— finding, not implementation); Q14 (one large canonical charge per plan; not per-cycle; not Stripe
Subscriptions unless the owner redefines); inventory Model A/B across all 15 required axes
(variant/non-variant asymmetry `velrepeat-scheduler.ts:328` vs `:341`; 30-min window meaningless for a
long hold `payment-reservation.ts:44`); pricing as rule rows (no hardcoded 1/2/4/8/16 → 0/3/7/10/15 %);
Q15–Q17; lifecycle decision matrix with **separate Plan / Payment / Cycle / Order / Fulfillment axes**
(PAID PLAN ≠ FULFILLED PLAN; PAID CYCLE ≠ DELIVERED ORDER); invariants with proof (cycle uniqueness
implemented; one-order-per-cycle still unprovable; `sold_count` violation `:344`); migration safety;
dependency graph; Decision Matrix (15 rows, every one `OWNER DECISION REQUIRED`). Contract Revision 2.2
pointer added. **No migration 051; no production source changes; Phases 2–10 still NOT STARTED.**

**Outcome:** all gates stay open (A–I, Q13–Q17, Q2 residual, package-authoring ownership, cycle-identity
reconciliation, rounding). The audit states the recommendation **and** the owner decision for each —
never presenting one as the other.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** (1164 tests, 53 files) · backend tsc 0 ·
typecheck 4/4 · build:apps 4/4 · `git diff --check` clean. Docs-only — DB-gated tests skip locally (no
PostgreSQL); CI's `postgres:16` remains the only real DB execution. **PRODUCTION = BLOCKED** (Neon
quota; 048–050 unapplied; new objects absent in prod and unread by any code).

---

## 55. VelRepeat **V2 Owner Decision Closure + Architecture Consistency Gate** (2026-09-30)

**Docs only — no code, no schema, no migration 051, no production behavior change.** New audit
`.ai/tasks/audits/velrepeat-v2-owner-decision-closure-2026-09-30.md` (12 sections) records the owner's
binding decisions: **Q13=B** (plan-level linkage inside the existing `payments` authority),
**Q14** (one canonical Stripe prepaid charge per plan, not Subscriptions), **A/Q1=B** (reserve per
cycle), **Q2** (`sold_count` on actual cycle settlement, canonical writer only), **B/C/D/E/F/G**
(refund future unfulfilled only · skip future only · pause future only · price snapshot at purchase ·
no oversell / no auto-substitute), **H/Q11** (platform-controlled, data-driven pricing; the
1/2/4/8/16 → 0/3/7/10/15 % ladder is examples only), **Q15** (V1 coexists as legacy), **Q16**
(scheduling = UTC, `timezone` is display-only), **Q17** (multi-seller plan, one payment, per-seller
fulfillment), plus the cycle-identity direction (`velrepeat_cycles` = identity, `velrepeat_runs` =
execution attempt). Contract Revision 2.3 pointer added.

**Verdict: `PHASE 2 = BLOCKED`** on three customer-visible money / authority questions — pricing-rule
resolution (stack vs one-wins), rounding & currency, package-authoring ownership.

**Stop tokens issued (nothing guessed):** `OWNER FORMULA REQUIRED` for the **B** refund formula, **C**
skip monetary consequence, **D** paused-cycle monetary consequence, **F** out-of-stock monetary
consequence → **Phase 9 STOPPED** (the repository has no per-cycle amount or discount allocation to
refund from). `OWNER DECISION REQUIRED` for the **Q2 recognition moment**, multi-seller money
attribution, seller eligibility, plan status `pending_payment`, cycle status `due`/`reserved`/
`fulfilled`, and the 4A plan-level reservation-window mapping.

**New source-verified findings:** (1) **Q2 conflicts with existing commerce semantics** — canonical
`sold_count` is committed at *payment settlement* (`inventory.ts:141` ← `stripe.ts:559`, gated by
`orders.status → 'paid'`), and a prepaid cycle order never has one, so the recognition moment is
ambiguous → reported and STOPPED, not resolved. (2) The release guard's "settled payment outranks
cancellation" protection is keyed to per-order payments (`inventory.ts:226-232`) and disappears for
cycle orders under Q14 → a cycle-state claim is required in Phase 6. (3) `paymentAllowsConfirmation`
(`order-fulfillment.ts:218-235`) would refuse every cycle order, because it looks only at that order's
payment history → Phase 8 must extend the gate, not bypass it. (4) Per-seller money attribution is
**unrepresentable today**: `commissions.order_id NOT NULL`, `settlements` has no plan/cycle reference,
neither table has any backend writer, and there is no Stripe Connect / payout rail
(`.ai/context/payment.md:239-250`). (5) `velrepeat_runs` and `velrepeat_cycles` have **no relation** to
each other and `orders` references both → the dual cycle-identity hazard.

**Verification:** `bun run test` **968 pass / 196 skip / 0 fail** (1164 tests, 53 files) · backend tsc 0
· typecheck 4/4 · build:apps 4/4 · `git diff --check` clean · `cmp` schema files identical ·
`db/migrations/` still ends at `050`. Docs-only — DB-gated tests skip locally (no PostgreSQL); CI's
`postgres:16` is the only real DB execution. **PRODUCTION = BLOCKED** (Neon quota; 048–050 unapplied).
