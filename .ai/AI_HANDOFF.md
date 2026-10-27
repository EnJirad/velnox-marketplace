# Velnox AI Handoff — current state

**Last updated:** 2026-10-25 · **Branch:** `main` · **Latest pass:** **Production Neon READ-ONLY audit + the change-audit-trail rules made permanent** (**§78**) — repo-side checks **PASS** (0 VelRepeat in executable code, 2 `.sql` files, 19/19 required tables declared, `sql-reference-coverage` 5/5); **Production Neon live inspection NOT RUN / BLOCKED** by rule §17 (owner must run the read-only queries); **production reconcile, real Stripe TEST E2E remain BLOCKED**
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
| velShop | `apps/velshop` | customer storefront, cart, checkout |
| velSeller | `apps/velseller` | seller workspace (products, orders, income, goals) |
| velCenter | `apps/velcenter` | staff / company operations console |
| velNox | `apps/velnox` | corporate site |
| API | `backend` | Express + `ws`; the only thing that talks to Neon |
| Shared | `packages/shared` | UI kit, i18n, api client, `api-routes.ts` |
| DB | `db/schema.sql`, `db/run-sqleditor.sql` | canonical snapshot + additive reconciler (declaration parity); the ONLY two `.sql` files in the repo |

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

## 15–20. Payment foundation, Stripe E2E records, CI guard, readiness audit, moderation queue — ARCHIVED

**Moved verbatim on 2026-10-06** to
[`history/archive/AI_Handoff-2026-09-25-to-2026-09-26-payment-and-e2e-records.md`](history/archive/AI_Handoff-2026-09-25-to-2026-09-26-payment-and-e2e-records.md)
(handoff edit-ceiling housekeeping; made room for §70). **Still-live claims, unchanged:**

- **Stripe TEST E2E stays BLOCKED** — no `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
  (`freebuff-env list` → `{"files":{}}`); no PaymentIntent, PromptPay QR, webhook delivery or
  refund has ever been executed. Production payment readiness **NOT claimed**.
- **PRODUCTION: NOT READY**; §19's per-gate evidence is in
  [`.ai/tasks/completed/production-readiness-audit-2026-09-26.md`](tasks/completed/production-readiness-audit-2026-09-26.md).
- The moderation queue is bounded/paginated and `SellerVerificationQueue.tsx` renders through
  `review.*` (th/en/my). Live rules: [`.ai/context/payment.md`](context/payment.md),
  [`.ai/context/testing.md`](context/testing.md), and the code.

---


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

## §65. Multi-shop checkout, numeric order numbers, VelRepeat V2 customer UI (2026-10-04) — **ARCHIVED**

**Moved verbatim on 2026-10-07** (edit-headroom housekeeping; made room for §72) →
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md).
**Still live from it:** public order numbers are 18 digits, digits only, and a string everywhere
(`generateOrderNumber()`) · one purchase = one `checkout_groups` row + N per-shop orders
(`orders.checkout_group_id`), one charge settled as ONE transaction with every member row locked
first · VelShop groups order history by the purchase, and the seller scope is unchanged.

## §66. Production `checkout_groups` 42P01 — ROOT CAUSE: migrations reach the WRONG database (2026-10-04) — **ARCHIVED**

**Moved verbatim on 2026-10-07** (same housekeeping) →
[`history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md`](history/archive/AI_Handoff-2026-10-04-sections-65-66-multi-shop-and-migration-routing.md).
**Still live from it — the durable finding:** migrations were applied to the database named
by the Actions secret `NEON_DATABASE_URL`, which is **NOT** the database Render's `DATABASE_URL`
points at (disjoint shops/users/products), so every "production schema verified" claim resting on
that ledger is suspect. The owner action is to set `NEON_PRODUCTION_DATABASE_URL` and dispatch
`production-db-migrate.yml`; **do not** hand-apply 054 elsewhere and do not remove
`checkout_groups` usage. Verdict stays **BLOCKED**, never PASS, until a real logged-in checkout is
observed there. The general rule this produced is in [`context/database.md`](context/database.md):
the `42703` error text can never prove which database, or which build, you are on.

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

## Canonical production DB + GitHub Actions alignment (2026-10-04) — ARCHIVED

**Moved verbatim on 2026-10-06** (edit-ceiling housekeeping; made room for §70) →
[`history/archive/AI_Handoff-2026-10-04-canonical-production-db-and-actions.md`](history/archive/AI_Handoff-2026-10-04-canonical-production-db-and-actions.md).
**Still live from it:** `NEON_PRODUCTION_DATABASE_URL` is the ONE secret name GitHub Actions uses
to reach production; `production-db-verify.yml` is read-only and checks 11 objects (both group
columns **with their type**, both `ON DELETE SET NULL` group FKs, the group indexes, the payment
parent CHECKs, the ledger), `production-db-migrate.yml` is the only writer and prints the database
identity **before** applying; `test.yml` references no secret. **Verification never repairs, and a
missing secret is BLOCKED, never substituted.** Two durable CI lessons are in the archive: a
DB-backed assertion inside a *static* `describe` must be gated on `hasTestDatabase()`, and
`db/verify-reconciler.sh` must derive its connection from `TEST_DATABASE_URL`.

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

**Record moved verbatim** → [`history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md`](history/archive/AI_Handoff-2026-10-05-section-68-checkout-group-session-open.md).
**Still live from it (the fix is SHIPPED):** `paymentsCheckoutGroupColumnExists()` — a cached `pg_attribute`
probe with a `__resetPaymentsGroupColumnCache()` seam — answers **503 `CHECKOUT_GROUP_UNAVAILABLE` BEFORE
`sessions.create`**, so no orphan payable URL is ever opened when the column is missing; the async
`logCheckoutSessionFailure()` emits one JSON line (`failure_stage`/`order_id`/`checkout_group_id`/
`payment_attempt_id`/`stripe_session_id`/…) while the client sees only generic text; a failed group INSERT
**expires** the session it just created; and the request key is claimed on the group path too, after ownership
is verified. Owner action restated by **§69**.

---

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05) — ARCHIVED

**Record moved verbatim** (2026-10-26, edit-headroom housekeeping) →
[`history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md`](history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md).

**Still live from it:** production `payments.checkout_group_id` remains **BLOCKED** and owner-executed —
create `NEON_PRODUCTION_DATABASE_URL` for the SAME Neon branch Render's `DATABASE_URL` uses, confirm the boot
`[db]` identity, run `db/run-sqleditor.sql`, then `Production DB Verify` must go BLOCKED → PASS. The
`db/migrations/054_*.sql` path named in the record is historical: there is no `db/migrations/` directory since
§76. No agent may connect to production (`.ai/AI_RULES.md` §17).

---

## §70–§72 + §74. Commerce rebuild · order-state projection · shipment lifecycle — **ARCHIVED** (moved 2026-10-23)

The completed-pass records for 2026-10-06 → 2026-10-08 — §70 (payment + checkout + order +
inventory + webhook rebuilt as ONE system), §71 (e-commerce rebuild phases 0-4), §72
(`orders.status` as a derived projection) and §74 (Phase 3 shipment lifecycle) — moved
**verbatim** to
[`history/archive/AI_Handoff-2026-10-06-to-2026-10-08-commerce-rebuild-passes.md`](history/archive/AI_Handoff-2026-10-06-to-2026-10-08-commerce-rebuild-passes.md)
(index row added) so this file stays under the ~55 KB edit ceiling. Their results still stand
(full suite 2103 pass / 2 skip / 0 fail at the time · `db/verify-reconciler.sh` ALL SCENARIOS
PASSED · all typechecks and builds green). What is still open lives in §6.

---

## §75. MVP repositioned: buy & sell — VelRepeat + Customer Memory PARKED (2026-10-14) — ARCHIVED

Superseded in part by §76: **VelRepeat is removed, not parked** (restoring it would be a rebuild).
**Customer Memory parking still stands** (`CUSTOMER_MEMORY_ENABLED` is the only feature flag left),
and the Phase-1 caption / corporate-site work shipped as recorded. **The wholesale buyer track was
never built** — pack pricing, shop accounts, MOQ and restock lists do not exist; a shop orders the
same retail lines as anyone else. Verbatim text:
[`.ai/history/archive/AI_Handoff-2026-10-14-section-75-mvp-reposition.md`](./history/archive/AI_Handoff-2026-10-14-section-75-mvp-reposition.md);
brief and Phase-2 model: [`.ai/tasks/active/mvp-marketplace-restructure-2026-10-14.md`](tasks/active/mvp-marketplace-restructure-2026-10-14.md).

---

---

## §76. VelRepeat REMOVED + repository cleanup + SQL consolidation to two canonical files (2026-10-23)

**Base SHA:** `af9841b0daa0b2b29feba890a7c36dfdd229e8d2` (= `origin/main` at task start; local HEAD
== remote at fetch time, working tree changes only, no branch divergence).
**Resulting commit SHA:** `cc3e9eacff063585d35b22428cf81723c795ad86` (the cleanup commit — this
file cannot carry its own commit hash, so the SHA is recorded here in the follow-up `docs(ai)`
commit that touches only this line).

**What went — VelRepeat at every layer:** the 6 backend route modules + both schedulers +
`lib/velrepeat-{cycles,pricing}.ts`; velShop `VelRepeatPage` / `VelRepeatV2Page` /
`VelRepeatPlanDialog` / `SubscriptionDialog` and every nav/menu/help/checkout entry point; the
`VELREPEAT_ENABLED` switches (only `CUSTOMER_MEMORY_ENABLED` remains in the two `features.ts`);
VelRepeat i18n keys, `api-routes.ts` entries and tests; `.ai/context/velrepeat-contract.md` + the
VelRepeat audit/task briefs; and from the schema: **12 tables** (`velrepeat_*`, `vrepeat_*`,
`subscriptions`), **12 columns** (nine `vrepeat_*` on `products`, `velrepeat_run_id`/`velrepeat_cycle_id`
on `orders`, `plan_id` on `payments` and `payment_incidents`), **62 indexes**, **78 constraints**.
Shared payment, order, shipment, inventory, refund and billing logic and ALL Stripe infrastructure
were preserved — only VelRepeat-specific behavior was removed.

**SQL consolidation.** Exactly **two `.sql` files** remain: `db/schema.sql` (canonical snapshot for
a fresh DB) and `db/run-sqleditor.sql` (rerunnable additive reconciler for an existing DB), plus
`db/verify-reconciler.sh`. `db/migrations/` deleted; `db:migrate`, both production workflows,
`INSTALLATION.md`, `README.md`, `docs/*`, `.ai/context/*` and `.ai/AI_RULES.md §6` re-pointed at the
two files (the old `migrate-neon.yml` / `NEON_DATABASE_URL` instructions are gone).
`db/verify-reconciler.sh` `CANON` re-measured on a real fresh PG14: **`63|234|261|653`**.
Schema-integrity restorations this pass: `payments_single_domain_check` kept as a plan-free
invariant (order XOR group) with a guarded reconciler pass; `payment_incidents_order_parent_check`
(data-guarded) replaces the legacy order-XOR-plan check; the stale `idx_payments_plan` /
`idx_payments_one_active_stripe_plan` / `idx_payment_incidents_plan` CREATE INDEX statements were
removed from the reconciler (they referenced a column no table declares — a fresh bootstrap would
have failed).

**New guard:** `backend/tests/sql-reference-coverage.test.ts` — every table, index and function the
backend's SQL names must be declared by `db/schema.sql`, and every declared function must be used.

**Verification (executed this pass, real output):**

| Check | Result |
|---|---|
| `bun run typecheck` (velshop · velseller · velcenter · velnox) | exit 0 |
| `bun --filter @velnox/backend typecheck` | exit 0 |
| `bun run i18n:check` | th=1249 en=1249 my=1249 — parity (was 1496; the delta is the removed VelRepeat keys) |
| `bun test backend/tests` (no DB) | 987 pass / 303 skip / 0 fail |
| `bun test backend/tests` + local PostgreSQL 14 (`TEST_DATABASE_URL`) | **1284 pass / 2 skip / 0 fail**, exit 0 |
| fresh `psql -v ON_ERROR_STOP=1 -f db/run-sqleditor.sql` on empty PG14, then again | exit 0 · exit 0 (idempotent) |
| `bash db/verify-reconciler.sh` | **52 PASS — ALL SCENARIOS PASSED**, exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| `git diff --check` | clean |
| `.sql` files in repo | exactly 2 |
| final tracked-file velrepeat sweep | only dated records (`.ai/history/`, `.ai/audit/`, `.ai/rebuild/`, `.ai/tasks/completed/`), the §75/§76 pointers in this file, the active brief's supersession note, `docs/VELREPEAT_REMOVAL_PLAN.md`, and two explanatory comments (one in `db/run-sqleditor.sql`, one in `db/verify-reconciler.sh`) — **zero executable VelRepeat code, routes, jobs, tests or SQL objects** |

**Legacy database objects were NOT touched** — the cleanup never connected to any database.
Reviewable plan for an existing database (inventory → archive → constraint swap → drop columns →
drop tables → verify): **`docs/VELREPEAT_REMOVAL_PLAN.md`**. The reconciler itself carries no
VelRepeat statement, so running it after that plan stays a no-op.

**Remaining gaps / blockers (unchanged unless noted):** production reconcile + verify **BLOCKED**
(no `NEON_PRODUCTION_DATABASE_URL` reachable from this workspace) · real Stripe TEST E2E
**BLOCKED** (no keys, no browser) · `bun run lint` not configured · the legacy plan above is owner-
executed later · ~30 explanatory comments in `backend/**` and the dated records still name old
migration numbers as historical anchors (they reference no file and are documented exceptions).

## §77. Independent audit of the VelRepeat removal + repository cleanup (2026-10-24) — ARCHIVED

Audited `bfa416e` read-only. Verdict **CLEAN WITH MINOR FINDINGS**: 0 VelRepeat hits in
`apps/`, `backend/`, `packages/`; 2 `.sql` files only; the boot self-heal removal in
`backend/server.ts` documented for the first time. Full text moved verbatim to
[`.ai/history/archive/AI_Handoff-2026-10-24-section-77-audit.md`](./history/archive/AI_Handoff-2026-10-24-section-77-audit.md)
on 2026-10-25; report: [`.ai/audit/FINAL_AUDIT_2026-10-24_VELREPEAT_REMOVAL.md`](./audit/FINAL_AUDIT_2026-10-24_VELREPEAT_REMOVAL.md).

## §78. Production Neon READ-ONLY audit + permanent change-audit-trail rules (2026-10-25)

**Base SHA:** `964156db6241704d61954a52799485d345c6d013` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `9d3a6418c27cb385c1b8912328cceb8bebc68613` (pushed; 7 files, `.ai/*.md` only).
**Report:** [`.ai/history/2026-10-25-production-neon-audit.md`](./history/2026-10-25-production-neon-audit.md).
**Nothing was connected to, executed against, or changed in any database. No code, schema or SQL
file was modified — this pass wrote only `.ai/` Markdown.**

**Repo-side audit (executed): PASS.** `velrepeat`/`vrepeat` = 0 files in `apps/`, `backend/`,
`packages/`; `CREATE TABLE … velrepeat` = 0 in both SQL files; `run-update` = 0 in executable
files; both `db/*.sql` declare **63** tables and every table the audit checklist names
(`users` stands in for customers — `users.role='customer'`, there is no `customers` table);
`git ls-files '*.sql'` = 2; `bun test backend/tests/sql-reference-coverage.test.ts` = **5 pass /
0 fail**. Remaining `velrepeat` strings: 2 comments (`db/run-sqleditor.sql:3757-3758`), 38 files
under `.ai/` (dated records) and `docs/VELREPEAT_REMOVAL_PLAN.md`.

**Production Neon: NOT RUN / BLOCKED.** No `NEON_PRODUCTION_DATABASE_URL` exists in this
workspace (`freebuff-env list` is empty) **and** rule §17 forbids an AI from connecting to the
production database in the owner's place. Real production state is **UNKNOWN** until the owner
runs the read-only query set in the report (§11). Do not report it as PASS.

**WARNING — the sanctioned verifier does not answer the checklist.**
`.github/workflows/production-db-verify.yml` is genuinely read-only and owner-runnable, but it
probes only `checkout_groups`, the two `checkout_group_id` columns, provider idempotency columns,
the FK delete rules, the group indexes, the payments CHECKs and `schema_migrations`. It does **not**
probe the 19 required Marketplace tables, VelRepeat leftovers, or the `run-update` ledger. Treat a
green run as partial evidence only; the report's query set covers the gap. (Not fixed on purpose:
this pass was audit-only.)

**Rules are now permanent (again docs-only):** `.ai/AI_RULES.md` **§17** (production DB is
read-only for agents; never connect on the owner's behalf; report `NOT RUN`/`BLOCKED`) and
**§18** (every repo-changing task must leave a Change Report in `.ai/history/` with the 20
required fields, update this handoff, and never claim an unrun check passed). `.ai/README.md`
points at both.

**Open / next:** owner runs the read-only queries and confirms the production identity ·
production reconcile + verify **BLOCKED** · real Stripe TEST E2E **BLOCKED** (no keys/browser) ·
`bun run lint` not configured · legacy VelRepeat objects in a real database are still removed only
by the owner via `docs/VELREPEAT_REMOVAL_PLAN.md` (backup + approval first).

## §79. Phase 1 — UI/UX + Realtime Professional Audit (2026-10-26) — **AUDIT ONLY**

**Base SHA:** `f71dcfd2fe26c7c92d94eb2ef7d7418f1c82d4d1` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `903501f4594e4d30d3918e579fe39b65c540ef9a` (the audit commit; its SHA is recorded here in the follow-up `docs(ai)` commit).
**Report:** [`.ai/history/2026-10-26-ui-realtime-professional-audit.md`](history/2026-10-26-ui-realtime-professional-audit.md).
**Nothing was modified except `.ai/` Markdown.** SOURCE CODE MODIFIED: **NO** · DATABASE MODIFIED: **NO** ·
SQL MODIFIED: **NO** · PRODUCTION DB CONNECTED: **NO**.

**Verdict:** the systems exist and the payment/order core is sound, but production-grade interaction
quality is not reached. 1 P0, 18 P1, 14 P2, 4 P3. VelShop is the most mature surface; VelSeller
mobile navigation and VelCenter realtime are broken; support is a shop account, not a support desk.

**Highest-impact findings (full evidence in the report):**
- **P0** VelSeller mobile has **no chat entry**: `SELLER_TABS` has no chat item and the header nav is
  `lg:` only. A chat notification can route to the thread, but a phone-only seller has no reliable way
  to open the inbox.
- **P1** VelCenter's socket connects to `ws(s)://<origin>` with **no `/ws`**; the server accepts only
  `/ws`, so every “live” queue badge is manual-refresh. Reproduced locally: 400 / close 1006.
- **P1** `ShopChat` / `SellerChat` call `disconnectChatSocket()` on unmount, killing the shared
  header-bell socket with no reconnect — notifications stop until a reload.
- **P1** `order:updated` has **no customer or seller consumer**, `shipment:updated` has **no consumer**,
  and no order/payment/shipment **notification rows** are ever inserted.
- **P1** errors render as **empty states** (MyOrders, notifications, seller orders, cart) or an infinite
  spinner (Income); order history is truncated at 50/50/100 with no pagination.
- **P1** Buy Now ignores `buyNowQty` (charges the cart quantity) and cart quantity PUTs race.
- **P1** support staff cannot use VelCenter (`CENTER_ROLES` excludes `support`) and seller→support has
  no UI. A real staffed desk needs a **SCHEMA CHANGE** (`chat_messages.sender_role`, assignment/priority).

**Realtime:** transport is hardened (cookie auth, 30 s revocation sweep, per-user channel, frame and
send-rate limits) but its **browser lifecycle** is not; there is no heartbeat and no resync after
reconnect; `notification:created` is a public channel carrying employee events.

**Responsive:** **static analysis only** — no browser/screenshot capability here. The 320/375/430
notification panel is clipped off-screen, VelSeller loses all page navigation at 768–1023 px, and the
chat `min-h` floors push the composer below the keyboard on short screens. The visual matrix is
**NOT RUN**, not passed.

**Chat:** customer↔seller and customer↔support exist; seller↔support is missing; support↔VelCenter is
missing. Full relationship/authorization/UX matrix in report §6.

**Checks run:** git in sync + clean · `bun run i18n:check` **PASS** (`th=1249 en=1249 my=1249`) · local
`ws` path probe **CONFIRMED** · source sweeps · docs-only diff check. No app test/build was run because
no code changed.

**Open / next:** implementation order in report §8 — stability → broken UX → realtime correctness →
chat fundamentals → responsive → polish. The support model decision gates Phase D. Do **not** add a
second socket, chat API, conversation table or notification system.

**Housekeeping:** §69 moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md`](history/archive/AI_Handoff-2026-10-05-section-69-production-payments-checkout-group.md)
with an index row.

## §80. Phase 2A — Stability + Realtime Foundation (2026-10-27) — **COMPLETE**

**Base SHA:** `4908d7d34eb7052fcedc6d98fa49f4aee0eb0204` (`main` == `origin/main`, 0/0, clean).
**Resulting commit:** `af302883984d695a52dd697d15875ade2652581e` (`fix(realtime): stabilize ui and
realtime foundation`; its SHA is recorded here in the follow-up `docs(ai)` commit).
**Report:** [`.ai/history/2026-10-27-ui-realtime-phase-2a.md`](history/2026-10-27-ui-realtime-phase-2a.md).

**What changed (no schema / SQL / DB / Stripe changes):**
- **ONE realtime client + ONE owner.** `chat-socket` rewritten: explicit state
  (`idle/connecting/open/reconnecting/closed`), ref-counted public channels, re-subscribe on every
  open, 1 s→30 s exponential backoff **with jitter**, `onChatReconnect`, guarded sends. New
  `<RealtimeProvider>` at the VelShop/VelSeller/VelCenter roots owns connect/disconnect.
- **VelCenter socket FIXED.** The inline client (wrong URL, no `/ws`, fixed 5 s retry) is gone; the
  page uses the shared client, subscribes the six channels, and re-reads every queue on reconnect.
- **Chat no longer kills notifications.** `disconnectChatSocket()` removed from ShopChat/SellerChat/
  bell cleanup; both chat pages and both bells refetch after a reconnect.
- **Backend transport:** presence cleared when a user's last socket closes/terminates; 30 s ping with
  missed-pong terminate; per-client guarded fan-out.
- **Seller navigation:** header Chat action below `lg` (P0 mobile entry); tab bar now stays through
  tablet (768–1023 px) via `until="lg"` + `.site-app--tabbar-lg`.
- **Notification panels:** fixed viewport-gutter sheet below `sm`, anchored popover at `sm+`; failure
  renders error + retry, never "all caught up".
- **Error ≠ empty:** MyOrders, SellerOrders, Income, ShopNotifications, ShopChat and the cart now have
  real error states with retry; last good data is kept where it exists.
- Three architecture tests updated to assert the new one-socket invariant.

**Verified:** 4 app typechecks PASS · backend typecheck PASS · `bun run build:apps` PASS (4/4) ·
`bun run i18n:check` PASS `1251/1251/1251` · `bun test backend/tests` **987 pass / 303 skip / 0 fail** ·
`git diff --check` clean. **NOT RUN:** browser/viewport pass, live WebSocket handshake, production DB
(not connected).

**Still open (Phase 2B/2C):** Buy Now quantity, order-history pagination, bootstrap-claim `res.ok`,
VelCenter destructive-action guards, footer/marketing links; `order:created` publisher,
`order:updated`/`shipment:updated` consumers, transactional notification rows, private admin channels.
Seller chat icon has no unread badge (no seller unread-count endpoint).

---

**Note on this file's size:** the ~55 KB edit-tool ceiling is real. §69 was archived on 2026-10-26
(verbatim + index row), leaving this file at ~49 KB; §80 brings it to ~53 KB. Before appending again,
archive the Actions-alignment block (or the 2026-10-04 payment-integrity narrative) to
`history/archive/` **with** an index row. Archiving is not deletion: the text is preserved verbatim.
