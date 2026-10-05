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

- **Stripe TEST round trips still unproven — the gate is the EXECUTION SURFACE, not configuration**
  (§64, §18). Runtime config re-verified live on the traffic host 2026-10-03: `{configured:true,
  mode:"test", webhookConfigured:true}`, CARD + PROMPTPAY (COD off), webhook refusing forgeries
  (400). Unproven: the checkout round trip itself (no PaymentIntent, PromptPay QR, webhook delivery
  or refund ever executed) — no `velnox_session` cookie can be minted from this workspace (no
  browser, no test account) and Checkout is Stripe-hosted. **CODE VERIFIED, never PASS.**
  `STRIPE_CONNECT_MISSING`: no Connect, no payout (checkout ≠ payout readiness). Variables:
  `INSTALLATION.md` §4 + `docs/ENVIRONMENT.md`; `.env.example` is owner-edit only.
- ~~**The DB-gated tests have never been executed in this workspace.**~~ **CLOSED** — they run
  against a disposable Postgres, including the two self-approval HTTP cases. **Production Neon is
  verified read-only (§9):** ledger matches `main`, 041–046 repairs applied. Remaining: a fresh
  catalog read of four low-severity details (§9.4); `diag-neon-schema.yml` still cannot be
  dispatched from a workspace (403).
- **`backend/tsconfig.json` excludes `tests`**, so `tsc` never validates test files — a syntax
  error or bad import surfaces only when `bun test` parses it. After editing a test, run that file.

- ~~**Closed gap records moved out of this file.**~~ **ARCHIVED 2026-09-29** →
  [`history/archive/AI_Handoff-closed-gaps-2026-09-29.md`](history/archive/AI_Handoff-closed-gaps-2026-09-29.md)
  (self-action guard, unbounded admin lists, unpaginated verification queue, DB constraint
  repairs, non-idempotent fixtures, corrupted revoke string). Closed items are not gaps.
- **`shops.seller_id` is not UNIQUE** (`idx_shops_seller` is a plain index), so a two-shop
  seller would make the verification queue list one verification twice (`COUNT(*) OVER()`
  counts it twice too). The app upserts one shop per seller, so it is latent, not observed.
  Fix if multi-shop sellers ever exist: `COUNT(DISTINCT sv.id)` + de-duplicated listing.
- ~~**VelCenter's verification queue labels are hardcoded Thai**~~ **CLOSED (2026-09-26, §20)** —
  every string renders through the existing `review.*` namespace. `ProductModerationQueue.tsx`'s copy
  is still hardcoded Thai (pre-existing).
- **Migration numbering has duplicates** (029, 030, 034, 035). A prefix-keyed runner applied only
  one file per number, which is how the V0035 repair was skipped. New migrations must use an unused
  number; consider renumbering.
- **Channels with no publisher.** `cart:updated`, `order:created` and
  `inventory:updated` are in the subscribe allowlist but nothing broadcasts them
  (**measured 2026-09-26, §19:** 0 `CHANNELS.*` publisher sites each; `order:updated` 14,
  `product:updated` 1, `seller:updated` 1). Harmless today (no consumer subscribes),
  but they are dead entries.
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
  `…-2026-09-22-full.md` (~97 KB) are verbatim records — read with windows, never whole-file.

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

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing was
connected to from this workspace (no database credentials are readable here, by
platform design). Method, migration ledger and verified-object table archived →
[`history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md).

**⚠️ Its headline conclusion was wrong and is superseded by §66.** This pass reported the
ledger matching `db/migrations/*.sql` **exactly** (49 rows / 49 files, none missing or
orphaned) and was taken to be the production ledger. It was not: the secret it read
(`NEON_DATABASE_URL`) pointed at a *different* Neon than Render uses. "49/49, nothing
missing" was a true statement about the wrong database — which is exactly why the ledger
is no longer treated as evidence about production. Never draw a production conclusion
from a ledger read without proving the identity first.

### 9.4 Still NOT VERIFIED (needs a fresh catalog read, now against the right database)

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

Run `.github/workflows/production-db-verify.yml` from **Actions → Production DB Verify
→ Run workflow**; it prints the database identity and a row-count fingerprint first,
so a run against the wrong Neon is visible in the log rather than inferred later. Items
1–4 above still need `diag-neon-schema.yml`, whose probes cover them. Neither workflow
can be dispatched from a workspace (`403 Resource not accessible by integration`);
granting the GitHub App **Actions: read/write** would allow it.

### 9.6 Safety notes from this pass

Never run `bun test backend/tests` where `DATABASE_URL` could point at production:
the DB-gated fixtures **delete** rows (`backend/tests/helpers/purge.ts`). No
credential, URL, password, token or hash was printed — the workflows reference the
secret only as `psql "$NEON_PRODUCTION_DATABASE_URL"` and never echo it.

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

## 37–48 + 51–64. Archived (verbatim)

§37–§48 → [`history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md`](history/archive/AI_Handoff-2026-09-30-payments-and-audit-record.md)
· §51 → `.ai/history/archive/AI_Handoff-2026-09-30-velrepeat-prepaid-contract-stopped.md` · §52–§63 →
[`history/archive/AI_Handoff-2026-10-04-sections-52-63.md`](history/archive/AI_Handoff-2026-10-04-sections-52-63.md) · §64 →
[`history/archive/AI_Handoff-2026-10-04-section-64-velrepeat-053.md`](history/archive/AI_Handoff-2026-10-04-section-64-velrepeat-053.md)
(index: [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).

**Still live from them:** the reservation is a **CONSTANT 30 minutes** · **migrations 048/049/050 were never applied in
production** (Neon quota, §14/§16/§21–22) · real Stripe TEST E2E and browser E2E have **never** run · MEDIUM #10/#11,
LOW #13/#14 and HIGH #4/#5 audit findings remain open.

**Superseded, do not read as current:** §51's three blockers were closed by §52–§58, Phase 3, Phase 4 and §62, and its
"048/049/050 still unapplied" line is **stale**. §52–§64's "production applied + verified" claims are **RETRACTED** —
they rested on the Actions ledger, and §66 proves that ledger describes a different database from the one Render serves.
Current state: §65–§69.

---

## §65. Multi-shop checkout, numeric order numbers, VelRepeat V2 customer UI (2026-10-04)

Three headline goals delivered end to end.

### 54.1 Public order numbers are DIGITS ONLY

`generateOrderNumber()` (`backend/lib/order-number.ts`) now returns **18 decimal digits**
(`^[0-9]{18}$`): 14-digit ms timestamp + 4 digits from `crypto.randomInt()`. No prefix, no letters,
no separator. The value is a **string everywhere** (18 digits > `Number.MAX_SAFE_INTEGER`); the
column stays `TEXT`. Legacy `VNX-YYYYMMDD-XXXXXX` rows keep their value — the column is nullable and
`idx_orders_number_unique` is partial — and `isLegacyOrderNumber()` recognises them.
VelRepeat cycle orders now carry a public number too (savepoint retry `cycle_order_number_attempt`).

### 54.2 One purchase, N fulfillment orders

- New `checkout_groups` table; `orders.checkout_group_id`; migration
  `db/migrations/054_checkout_groups_numeric_order_number.sql` (additive, idempotent).
  **Corrected 2026-10-04 (§66): the earlier "not yet applied — Neon quota blocker" note here was
  wrong.** 054 *was* applied (Actions run `37170858966`, 2026-10-04T02:22:59Z) and the table is
  fully present — on the **wrong database**. See §66.
- `payments.checkout_group_id` is a third payment parent.
  `payments_exactly_one_parent_check` → `payments_at_least_one_parent_check` +
  `payments_single_domain_check`; `idx_payments_one_active_stripe_group` enforces one active
  session per purchase. Both canonical SQL files updated identically.
- **`POST /api/stripe/checkout` accepts `checkoutGroupId` OR `orderId`.** The group path reads the
  group through the OWNER scope, re-derives the amount from the member ORDER rows, and requires every
  member to still be payable. **The previous bug** — reconciling against ONE order's `total_amount`,
  so a 3-shop cart charged only shop A — is fixed.
- Settlement: `settleCheckoutGroup()` locks every member row FIRST
  (`lockCheckoutGroupOrderRows`, one statement, `id ASC`), writes the group payment row, then claims
  each order with the same guarded UPDATE + `commitOrderInventory` a single-order payment uses. One
  charge, N orders, one transaction. The webhook routes via `checkoutGroupIdForAttempt()`, OUTSIDE
  any transaction, so the lock-order invariant (`backend/tests/payment-cancellation-race.test.ts`)
  still holds — `settleCheckoutGroup` is now a case in that suite.
- `markPaymentSucceeded` was restored to its original single-order shape; the dispatcher is at the
  webhook call sites. This is why `late-payment-incidents.test.ts` and
  `payment-attempt-identity.test.ts` pass **unmodified**.

### 54.3 VelRepeat V2 customer UI (`/velrepeat/v2`)

New read endpoints (`backend/routes/velrepeat-v2-status.ts`): `GET /api/velrepeat/v2/packages`,
`GET /api/velrepeat/v2/plans`, `GET /api/velrepeat/v2/plans/:planId` (owner-scoped; pricing from the
FROZEN snapshot; cycles from `readPlanCycles`; per-cycle orders with shop, shipping status and
tracking). Stripe success/cancel now return to `/velrepeat/v2?velrepeat_v2_payment=…&plan=<id>`.

`apps/velshop/src/pages/VelRepeatV2Page.tsx`: package → commitment → frequency → review → draft plan →
Stripe TEST Checkout → return → server-decided status → cycles → per-shop orders (each openable, each
with its own tracking). It **never** computes an authoritative price (renders the server's frozen
figures), **never** treats the Stripe redirect as proof of payment (polls the server while it says
`draft`), and sends only `packageId` / `commitmentCycles` / `frequencyType` / `intervalValue`.
Commitment options and frequencies mirror the backend's own vocabulary.

### 54.4 Order history grouped by purchase

`checkoutGroupId` is exposed on the customer, seller and center order lists. VelShop groups the
history by it so one purchase reads as one thing with N per-shop orders underneath. VelCenter can see
the whole purchase tree; seller ownership is unchanged (`WHERE sh.seller_id = $1` still scopes it).
Tracking stays per ORDER / per SHIPMENT — never per group.

### 54.5 Tests

`backend/tests/multi-shop-checkout.test.ts` (17) covers split cases 1–4, group totals, ownership in
both directions, cross-customer refusal, one-charge/no-duplicate settlement via the real signed
webhook, stock committed once, group invisibility, and concurrent number generation.
Suite: **1908 pass / 2 skip / 0 fail** (baseline 1882/2/0).

## §66. Production `checkout_groups` 42P01 — ROOT CAUSE: migrations reach the WRONG database (2026-10-04)

**Symptom.** Real production checkout fails:
`[checkout] error: relation "checkout_groups" does not exist` / `PostgreSQL code: 42P01` /
`backend/routes/cart.ts:919`. (The route is `POST /api/customer/checkout`; the log names the
failing statement, not the path.) Line 919 of `cart.ts` at HEAD is exactly the
`INSERT INTO checkout_groups` — so Render **is** running current code.

**The migration was never missing.** Read-only probes against the Actions `NEON_DATABASE_URL`
(run `37173839460`) prove the whole 054 substrate is present there:

```
checkout_groups            | present
checkout_groups.columns    | created_at:…! currency:text! id:uuid! item_count:integer!
                            shop_count:integer! total_amount:numeric! user_id:uuid!
checkout_groups.pk         | id
checkout_groups.fk_to_users| FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
checkout_groups.indexes    | checkout_groups_pkey, idx_checkout_groups_user
orders.checkout_group_fk   | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.checkout_group_fk | FOREIGN KEY (checkout_group_id) REFERENCES checkout_groups(id) ON DELETE SET NULL
payments.order_id nullable | YES
payments.parent CHECKs     | payments_at_least_one_parent_check, payments_single_domain_check
schema_migrations.count    | 57   (ends … > 053 > 054_checkout_groups_numeric_order_number)
```

**Root cause — proven by data, not inferred.** That database is **not** the one Render connects
to. Identity probes (run `37174025731`) vs. the live host:

| | Actions `NEON_DATABASE_URL` | production `velnox-api.onrender.com` |
|---|---|---|
| `current_database` | `neondb` | not exposed |
| shops | **1** — `5d56f6f8…/eloop` | **2** — `26d65318…/home-tech`, `91f4b9bf…/velnox-support` |
| users/products/sellers | 3 / 1 / 1 | — |
| orders/payments | 0 / 0 | real purchases |

Disjoint sets. So **`054` was applied successfully to a database that checkout never touches**,
and every prior conclusion drawn from the Actions ledger about "production schema" is suspect.
This finally identifies the §22/§31 anomaly recorded in `payment.md`: it was never a quota
error, it was the wrong target.

**Fix — owner action, cannot be done from the agent workspace.** Create the Actions secret
`NEON_PRODUCTION_DATABASE_URL` holding the Neon connection string for the project/branch Render's
`DATABASE_URL` uses (Settings → Secrets and variables → Actions), then dispatch
`production-db-migrate.yml` once; its `schema_migrations` ledger is per-database, so it will
apply the genuinely-pending migrations (054 and any earlier ones) to production. The repo token
gets `403` on both `secrets` and `workflow_dispatch`, and the production URL exists only in
Render. **Do not** hand-apply `054` through any other route, and do not delete `checkout_groups`
usage to silence the error — the table is correct, its target is not. The in-repo half of this
fix is done: see "Canonical production DB + GitHub Actions alignment" below.

**Not verified: the live smoke test.** `POST /api/customer/checkout` returns `401` without a
`velnox_session` cookie, and no authorized test account is available here, so checkout has NOT
been observed progressing past the `checkout_groups` query in production. Verdict for this item is
**BLOCKED**, not PASS. After re-pointing the secret, verify by logging in and checking out for
real: no 42P01, one `checkout_groups` row, N orders by shop, one Stripe TEST payment, one
settlement, stock committed once per order. The full local proof is
`backend/tests/multi-shop-checkout.test.ts` (17) + `payment-cancellation-race.test.ts` +
`payment-attempt-identity.test.ts` — 1908 pass / 2 skip / 0 fail.

---

## `42703 checkout_group_id` — the retracted "stale build" verdict (2026-10-04) — **ARCHIVED**

**Archived 2026-10-05** → [`history/archive/AI_Handoff-2026-10-04-42703-correction.md`](history/archive/AI_Handoff-2026-10-04-42703-correction.md).
The durable rule is in [`context/database.md`](context/database.md) and applies to §66/§67/§68:
`ERROR: column "x" does not exist` is emitted both when no relation in scope owns `x` AND when the
relation in scope simply lacks `x` — byte-identically. **The error text can never prove a query is
unqualified or that a build is stale.** Ask the catalog, or ask which database you are on.

## Boot-time database identity + PART 8 shape assertions + the reproduced incident (2026-10-04) — **ARCHIVED**

**Archived** (all COMPLETE; the contracts live in [`.ai/context/database.md`](context/database.md)
— the boot-time `describeDatabaseIdentity()` probe, PART 7/8's type/index/FK-shape assertions,
and `db/verify-reconciler.sh` scenarios H and I) →
[`history/archive/AI_Handoff-2026-10-04-db-identity-and-part8.md`](history/archive/AI_Handoff-2026-10-04-db-identity-and-part8.md).
Moved 2026-10-04 to keep the current-state file small while adding the payment-integrity
section. The owner action it recorded (run `db/run-sqleditor.sql` against Render's actual
database) is restated there and in §6.

## Canonical production DB + GitHub Actions alignment (2026-10-04)

The Actions↔Render split is closed **in the repository**; the secret itself is still an owner
action. `NEON_PRODUCTION_DATABASE_URL` is now the one name GitHub Actions uses to reach the
production Neon, and the two workflows that touch production are named for that role:

* **`production-db-verify.yml`** (new) — read-only. `repository` job validates the schema
  contract and proves no workflow carries a credential, a remote connection string or a silent
  fallback; `production` job prints `current_database` / `current_schema` /
  `server_version` / `current_user` plus a row-count fingerprint, then checks 11 objects —
  both group columns **with their type**, both `ON DELETE SET NULL` group FKs, the group
  indexes, the payment parent CHECKs and the migration ledger. `gates` job runs the real
  commands against a throwaway postgres container. `verdict` prints one PASS/BLOCKED/FAIL.
* **`production-db-migrate.yml`** (was `migrate-neon.yml`, same engine, renamed) — the only
  workflow that writes to production. It now prints the database identity **before** applying
  anything and tells the operator to stop if it is not production.
* `diag-neon-schema.yml` and `diag-stripe-payment-trace.yml` follow the canonical secret.
  `test.yml` is unchanged and still references **no** secret.

**Verification never repairs.** A missing object FAILs the job and names the fix; the workflow
never creates it. **A missing secret is BLOCKED, never substituted** —
`BLOCKED: NEON_PRODUCTION_DATABASE_URL is not configured.`

Both properties were proven, not asserted: the check SQL was executed against a real reconciled
database (**11/11 PASS**) and against a database with `payments.checkout_group_id` dropped — the
reported production condition — where it reported **5 FAIL** naming exactly what was missing and
exited non-zero without writing. The workflow guards were run against the real tree (clean) and
against a planted violation file (all three fire, exit 1). The `repository` guards were written
after three of them false-positived on the current tree, which is the only reason the planted
`ep-ci-guard-check` fixture and the `test.yml` comment are now explicitly excluded.

Suite after this change: **1962 pass / 2 skip / 0 fail**, typecheck 4/4 + backend 0, build 4/4,
`db:verify` 9/9 exit 0, `git diff --check` clean.

**Renaming `migrate-neon.yml` broke `backend/tests/migration-numbering.test.ts`** (it reads that
workflow by name), which is the guard that pins the runner's filename-keyed ledger. Caught by
running the suite rather than by inspection; the reference now points at the renamed file.

**Two further defects only the real Actions run could find.**

1. The new `repository` job runs the schema-contract tests with **no database**, and
   `backend/tests/checkout-group-sql-scope.test.ts` had one test inside a *static* `describe`
   that still executed its statement through `query()` — so it passed in `test.yml` (which
   always has a container) and failed in the new job. That assertion is now gated on
   `hasTestDatabase()` exactly like every other DB-backed one: 71 pass / 11 skip with no
   database, and it still runs and passes when one is present.
2. `db/verify-reconciler.sh` defaulted to hard-coded `velnox_test` / `velnox_test`
   credentials and ignored `TEST_DATABASE_URL`, so in a CI job whose container uses
   `postgres` / `postgres` every scenario failed on
   `password authentication failed` — and, worse, it had been verifying against different
   credentials than it tested against. It now derives `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`
   and the admin database from `TEST_DATABASE_URL` (query string stripped, never echoed),
   with explicit `PG*` / `VELNOX_VERIFY_ADMIN_DB` still winning. Verified against three
   shapes: the CI credentials, the local credentials, and explicit overrides; plus a
   credential-less URL, which must not corrupt the parse. `test.yml` never ran
   `db:verify`, which is why this survived until now.

Both were found by inspecting the GitHub run, not locally — which is the whole argument for
verifying on Actions.

---

## Payment integrity — a captured Stripe charge could never settle in production (2026-10-04)

**Reported symptom.** Checkout → first attempt seen as failed → customer retried → the NEW Stripe
attempt was genuinely charged → Velnox still showed "รอดำเนินการชำระ" and offered payment again.
Retrying made it worse: every retry captured another real charge that also could not settle.

**Root cause: failure class H (production schema ≠ backend code), surfacing as class D
(`handleStripeEvent()` throws).** `checkoutGroupIdForAttempt()` (`backend/routes/stripe.ts`) decided
which parent a charge belongs to by reading `payments.checkout_group_id` — added by migration
**054**, which production never received. Naming an absent column raises `undefined_column` (42703),
which is a THROWN ERROR, and it was thrown on the one query **every** order's settlement runs,
before the order or payment row is touched:

```
payment_intent.succeeded → checkoutGroupIdForAttempt() throws 42703 → handleStripeEvent() throws
  → payment_events.status = 'failed' → HTTP 500 → Stripe redelivers → the identical error
  → payments.status and orders.status NEVER move → the storefront keeps offering payment
```

**Why partial application, not total absence.** `POST /api/customer/checkout` writes
`checkout_groups` + `orders.checkout_group_id` unconditionally, so checkout demonstrably worked in
production ⇒ 054's sections 1–2 landed ⇒ only section 3 (`payments.checkout_group_id`) did not.
That is exactly the state `db/verify-reconciler.sh` scenario H reproduces, and it is the
direct consequence of §66 (migrations reaching a different Neon than Render's `DATABASE_URL`).

**Ruled out with live evidence, not reasoning.** `GET /api/stripe/configured?selfTest=1` on
`velnox-api.onrender.com` → `configured: true, mode: "test", webhookConfigured: true`,
`webhookSecretHealth.shapeUsable: true`, `webhookSignatureSelfTest.verified: true` ⇒ **A** (not
sent) and **B** (signature) are out; an unsigned `POST /api/payments/stripe/webhook` → 400 ⇒ the
endpoint is live and refusing. **G** is out too: `ShopCheckoutSuccess.tsx` polls
`GET /api/orders/:orderId` until the payment settles, so the UI reported the truth.

**The fix (code).** The column is read as a JSON KEY — `to_jsonb(p) ->> 'checkout_group_id'` —
so ONE statement is correct against both schemas and cannot raise 42703; the companion `?`
operator distinguishes "no group" from "no column" so the process can say so ONCE, naming
`db/run-sqleditor.sql`. This is the same pattern `selectOrderPaymentRow()` already uses for
`orders.payment_expires_at` in `lib/payment-reservation.ts`. It is **not** a bypass: the
signature check, the `payment_events` claim, the 500-on-failure redelivery policy and the
`status IN ('pending','pending_payment')` settlement guards are unchanged, and NULL is the safe
answer — the column is what links a payment to a purchase, so on a database without it there is
no group payment to route.

**Tests.** `backend/tests/payment-webhook-schema-lag.test.ts` (new, 12 cases): the production
routing SQL executed against a `payments`-shaped table **without** the column returns NULL and
detects the absence where the pre-fix statement raises 42703 (the regression, demonstrated); a real
group payment is still routed; attempt A failed then attempt B succeeds settles B and the order;
a duplicate delivery settles nothing twice; an UNPAID `checkout.session.completed` never marks paid;
an event identifying no attempt writes nothing; a processing failure answers **500** and records the
event `failed`; and Stripe's retry of that same event id re-processes it. Suite: **1974 pass /
2 skip / 0 fail** (67 files). `checkout-group-sql-scope.test.ts` was updated to pin the new
statement (in scope for `payments`, no bare column reference left).

**STILL BLOCKED — owner action, unchanged.** Production `payments` has no `checkout_group_id`, so a
MULTI-SHOP checkout still cannot be paid for until `db/run-sqleditor.sql` is run against the
database Render's `DATABASE_URL` actually points at. Confirm with `Production DB Verify`
(`backend/routes/stripe.ts` is in its trigger paths), which needs the
`NEON_PRODUCTION_DATABASE_URL` secret. Live `payment_events` / `payments` / `orders` reads are
likewise BLOCKED in this workspace (no production DB access). **Real Stripe TEST E2E is BLOCKED,
not PASS**: Stripe TEST mode is configured and verifiable in production, but payment is a Stripe
**hosted** Checkout Session, so only a human in a browser can complete it and only then can Stripe
deliver the webhook; this workspace has no browser and no test account.

---

## §68. Multi-shop PromptPay — "Failed to create checkout session" (2026-10-05) — **ARCHIVED**

**The fix is SHIPPED and LIVE; the record moved verbatim** →
[`history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md`](history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md)
(2026-10-05, edit-headroom housekeeping; index row in [`history/AI_Handoff_Archive.md`](history/AI_Handoff_Archive.md)).

**Still live from it:** order `46d6e39b-…` / `017911592602649656` could not start a payment because `openCheckoutGroupSession()` names
`payments.checkout_group_id` as a bare column, which 42703s **after** Stripe already created the session — the shipped
guard `paymentsCheckoutGroupColumnExists()` (a `pg_attribute` probe, cached, `__resetPaymentsGroupColumnCache()` seam) now
answers **503 `CHECKOUT_GROUP_UNAVAILABLE` BEFORE `sessions.create`**, so no orphan payable URL is ever opened;
`logCheckoutSessionFailure()` (async) emits one JSON line with `failure_stage`/`order_id`/`checkout_group_id`/
`payment_attempt_id`/`stripe_session_id`/`provider_request_id`/… while the CLIENT still sees only the generic text; a failed
group INSERT logs the session id and **expires** it; and the **request key is now claimed on the group path** too, after
ownership is verified. Suite then: 1988 pass / 2 skip / 0 fail. Its "STILL BLOCKED" owner action is restated by **§69**
with a second incident on the same column and the CI run proving the production secret is still absent.

---

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05)

**Second, independent incident on the same missing column.** Order
`2aa736e9-0010-43c2-8f0e-19142b25189b` / `017911658804352200`, PromptPay, group
`c86fb8fe-758d-4907-aedf-3e8f6bde8de2`. Production logged `[checkout-group] payments.checkout_group_id is
missing — apply db/run-sqleditor.sql (migration 054).` with `code: 42703`, `failure_stage:
group_column_missing`, `stripe_session_id: null`. **That log line is the §68 guard working** — production ran the
fixed build, the probe saw the column absent, and it refused with 503 *before* Stripe. The build is current; the
**database** is not.

**Root cause confirmed: production Neon never received migration 054 §3.**

**Source of truth for `payments.checkout_group_id`** — from `db/migrations/054_…sql` §3, `db/schema.sql:460` and
`db/run-sqleditor.sql:461,1378,3416-3421,4035-4036`: `UUID`, **nullable** (no `NOT NULL`), FK
`payments_checkout_group_id_fkey` → `checkout_groups(id) ON DELETE SET NULL`; indexes `idx_payments_checkout_group`
(partial) and the unique partial `idx_payments_one_active_stripe_group`; it participates in
`payments_at_least_one_parent_check` + `payments_single_domain_check`; and `payments.order_id` becomes NULLABLE.
§3 also drops `payments_exactly_one_parent_check`. **Nothing was changed** — the repository was already consistent,
and no datatype, constraint or index was invented.

**Repository side: COMPLETE.** `db/schema.sql` ↔ `db/run-sqleditor.sql` declaration parity passes
(`backend/tests/helpers/canonical-schema.ts`), `db/run-update.sql` does not exist, and `db/verify-reconciler.sh`
**scenario H reproduces this exact production shape** — a populated `payments` with real Stripe rows and the column
dropped — then proves the statement 42703s before, runs clean after, leaves the payment row, its provider ids and its
`paid` settlement state untouched, never re-points it at the group, and is idempotent on a second run. `bun run
db:verify` → `RECONCILER PROOF: ALL SCENARIOS PASSED` (52 PASS / 0 FAIL).

**New regressions (4, `backend/tests/checkout-group-session-open.test.ts`, 14 → 18).** The single-shop rail was
**uncovered**, which is the risk 054 §3 itself creates — it makes `order_id` nullable and swaps the parent CHECK:
**(1)** one order still opens a session and records `order_id` with `checkout_group_id IS NULL`, the session id, and a
row satisfying `payments_at_least_one_parent_check` (old constraint gone); **(2)** a retry with a FRESH idempotency key
reuses that session — one `sessions.create`, one active attempt; **(3)** the reported order's exact state (group +
orders, **no** payment row) reads **not paid** on `GET /api/orders/:orderId`; its retry opens exactly one attempt with
the session recorded and `paid_at` null, a second retry reuses it, and no order is ever `paid`; **(4)** static — the
open path between the two `app.post` registrations contains **no** `paid` write at all, so a missing column can never be
"fixed" by paying an order Stripe never charged. Suite: **1992 pass / 2 skip / 0 fail**, typecheck 4/4 + backend 0,
build 4/4, `db:verify` 52/0, `git diff --check` clean.

**PRODUCTION: NOT APPLIED — BLOCKED, and it must be reported as such.** `NEON_PRODUCTION_DATABASE_URL` is absent:
`freebuff-env list` returns no keys, the GitHub App token gets **403** on both `secrets` and `workflow_dispatch`, and
CI run **37249675032** of `Production DB Verify` fails with `##[error]BLOCKED: NEON_PRODUCTION_DATABASE_URL is not
configured.` — the identical pre-change baseline. The repository therefore **cannot prove** the migration reaches the
same Neon Render serves, and no Stripe TEST E2E was executed. **The payment architecture was not changed**: no
multi-shop removal, no single-shop fallback, no bypassed column, no session-before-payment-row, no disabled schema
validation, no 42703 catch-and-pass, no frontend "paid", no blind retry, no sleep, no disabled idempotency.

**Owner action — unchanged, and still the whole remaining gap.** Create the `NEON_PRODUCTION_DATABASE_URL` secret
pointing at the SAME Neon project/branch Render's `DATABASE_URL` uses, confirm the printed identity against the
backend's boot `[db]` line, then run `db/run-sqleditor.sql` (or `db/migrations/054_*.sql`) via
`production-db-migrate.yml`; `Production DB Verify` must then go BLOCKED → PASS on all 11 objects. Only then can a
real PromptPay TEST round trip be attempted. **STATUS: BLOCKED — never PASS.**
