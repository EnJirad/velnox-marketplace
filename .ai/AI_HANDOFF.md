# Velnox AI Handoff — current state

**Last updated:** 2026-10-21 · **Branch:** `main` · **Latest pass:** **PHASE 2 — clean MVP database** (**§85**) — `db/mvp/schema.sql` is the canonical 19-table MVP model with a fail-closed reset and **81/81 real-PostgreSQL checks**; the pre-MVP pair + 62 migrations are FROZEN; cutover designed, not executed. Full suite **2166 pass / 16 skip / 0 fail** against PostgreSQL 14. No production DB or real Stripe TEST E2E was touched (owner action).
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

## Payment integrity — a captured Stripe charge could never settle in production (2026-10-04) — **ARCHIVED**

Moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-16-payment-integrity-capture.md`](history/archive/AI_Handoff-2026-10-16-payment-integrity-capture.md)
on 2026-10-16 (added §77; edit-headroom housekeeping). **Superseded by §70**: the failure class it
documents — a captured charge resolved through `payments.order_id` alone, i.e. against no order —
is what the covering-set resolver (`lib/payment-attempt.ts`) and `terminateCheckoutGroup()` remove.

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

## §69. Production `payments.checkout_group_id` — the gap is real, applying it is **BLOCKED** (2026-10-05) — **ARCHIVED**

Moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-16-section-69-production-group-column.md`](history/archive/AI_Handoff-2026-10-16-section-69-production-group-column.md)
on 2026-10-16 (added §78; edit-headroom housekeeping). Still-live claim, do not re-derive it:
production Neon never received migration 054 §3, so `payments.checkout_group_id` is missing there —
the fix is applying `db/run-sqleditor.sql` to the SAME Neon Render serves, and it stays **BLOCKED**
until `NEON_PRODUCTION_DATABASE_URL` exists (see §71). `db/verify-reconciler.sh` scenario H still
reproduces that exact shape and proves the fix.

---

## §70. Payment + Checkout + Order + Inventory + Webhook — rebuilt as ONE system (2026-10-06) — **ARCHIVED**

Moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-16-section-70-payment-rebuilt.md`](history/archive/AI_Handoff-2026-10-16-section-70-payment-rebuilt.md)
on 2026-10-16 (added §77; edit-headroom housekeeping). Still-live rules it established, do not
re-derive them: **ONE** covering-set resolver (`lib/payment-attempt.ts` — no blind
`payments.order_id` subquery), `terminateCheckoutGroup()` (`lib/checkout-group-lifecycle.ts`) as
the only group teardown, migration 055 (group-scoped refunds) mirrored in both canonical SQL
files, `db/verify-reconciler.sh` counts `66|244|258|653`, and the four long-form documents under
`docs/PAYMENT_*.md`. Its BLOCKED list (real Stripe TEST E2E, production Neon) is restated in §71.

---


## §71. Production e-commerce full-system rebuild — phases 0-4 DONE, 5-17 not started (2026-10-06) — **ARCHIVED**

Moved **verbatim** to
[`history/archive/AI_Handoff-2026-10-16-section-71-production-rebuild.md`](history/archive/AI_Handoff-2026-10-16-section-71-production-rebuild.md)
on 2026-10-17 (added §79; edit-headroom housekeeping). Still-live claim, do not re-derive it:
Phase 4 (DB invariants, migration 056) is DONE; phases 5-17 have not started and the plan lives in
`.ai/rebuild/MIGRATION_PLAN.md`. Real Stripe TEST E2E and the production Neon migration stay
**BLOCKED** on owner credentials (§78 note 4).

---

## §72. P0-1 CLOSED — `orders.status` is a DERIVED projection of three axes (2026-10-07) — **ARCHIVED**

Full record: [`history/archive/AI_Handoff-2026-10-07-orders-status-derived-projection.md`](history/archive/AI_Handoff-2026-10-07-orders-status-derived-projection.md).
The rule is unchanged and still in force: `orders.status` is DERIVED from the three lifecycle axes,
never written independently.

---

## §74. Phase 3 — shipment lifecycle (`P1-3`) (2026-10-08) — **DONE**

Full record moved to [`.ai/audit/PHASE_3_SHIPMENT_LIFECYCLE.md`](audit/PHASE_3_SHIPMENT_LIFECYCLE.md)
(2026-10-19, edit-ceiling housekeeping). Still live: shipments are advanced only through
`canTransitionFulfillment` + `projectOrderStatus`, under the order row lock, and `orders.status`
stays a derived projection. No migration was needed.

---

## §75. MVP repositioned: buy & sell — VelRepeat + Customer Memory PARKED (2026-10-14) — **ARCHIVED**

Full record: [`history/archive/AI_Handoff-2026-10-14-mvp-parking-and-phase2-design.md`](history/archive/AI_Handoff-2026-10-14-mvp-parking-and-phase2-design.md).
The **parking contract** it defines is still the live rule (both flags fail closed; parked
modules are not mounted, not scheduled, not re-enabled by deleting anything). Its Phase-2
"designed, not built" block is superseded by §76 below.

---## §76–77. Selling units (sets / packs) — BUILT (2026-10-16) — **ARCHIVED**

Full record (both sections verbatim):
[`history/archive/AI_Handoff-2026-10-16-selling-units-built.md`](history/archive/AI_Handoff-2026-10-16-selling-units-built.md).

**Live rule, unchanged:** `quantity` counts SELLING units; **base units =
`quantity * selling_unit_pieces`** is the ONLY quantity inventory, variant stock and `sold_count` ever
see. One authority (`lib/selling-units.ts` + `orderItemBaseQuantitySql()`), one LIVE definition per
`(product, variant, pieces)`, retirement instead of deletion, and the definition's price is
server-authoritative. `product_selling_units` + the three snapshot columns on `cart_items` and
`order_items` (migrations 058/059) are canonical and **required** — their absence is the §82
incident. The seller form (`SellingUnitsManager.tsx`) and the set name in every order view shipped
in §77.

---


## §78–79. Store accounts + gated wholesale — BUILT, then **PARKED** (2026-10-19) — **ARCHIVED**

Full record: [`history/archive/AI_Handoff-2026-10-17-wholesale-store-accounts.md`](history/archive/AI_Handoff-2026-10-17-wholesale-store-accounts.md)
(both sections verbatim). Migration 059's schema is untouched and still declared in both canonical
SQL files.

**Live rule:** wholesale is **PARKED, not deleted**. `WHOLESALE_ENABLED` is `false` in
`packages/shared/src/lib/features.ts` and in `backend/lib/features.ts` (env `WHOLESALE_ENABLED=true`
is the only way to open it; both halves must be flipped together). While off: the store-account
routes are not mounted (404), `getWholesaleAccess()` answers not-approved for everyone,
`loadSellingUnits()` only ever reads `is_wholesale = FALSE`, `resolveSellingUnit()` refuses a
wholesale row even when the caller passes `wholesaleAllowed: true`, `countWholesaleUnits()` does not
query at all, `stores.manage` leaves the permission catalog, a seller cannot author a new wholesale
mark, and velShop / velCenter / velSeller hide the callout, the queue and the toggle.

---

## §80. Scope correction: MVP = BUY + SELL + CONTROL — wholesale PARKED (2026-10-19)

**Owner re-scope (in-session, 2026-10-19):** the MVP is BUY + SELL + CONTROL only. Wholesale / B2B,
Store Accounts, VelRepeat, Customer Memory, behavioural tracking, recommendations, loyalty,
subscriptions, AI commerce and CRM are all **out of scope**. `Selling Unit / Set / Pack` is **CORE**
and stays on.

**What was parked (no deletion, no schema change):**

| Surface | Parked state |
|---|---|
| `backend/server.ts` | `setupStoreAccountRoutes(app)` runs only `if (WHOLESALE_ENABLED)` → `/api/customer/store-account` and `/api/admin/store-accounts*` are 404 |
| `backend/lib/store-accounts.ts` | `getWholesaleAccess()` returns not-approved while parked, so `isApprovedStore()` — and every cart/checkout/reorder gate that delegates to it — is false without touching those call sites |
| `backend/lib/selling-units.ts` | `loadSellingUnits()` = `WHOLESALE_ENABLED && includeWholesale`; `resolveSellingUnit()` requires the flag too; `countWholesaleUnits()` returns an empty map without querying |
| `backend/routes/product-selling-units.ts` | `isWholesale: true` is refused while parked (`false` is still accepted, so a mark can be cleared) |
| `backend/lib/permissions.ts` | `stores.manage` is omitted from the catalog (a code that guards nothing is not offered) |
| velShop | `/profile/store` not registered; the profile row and the product-page callout / `ขายส่ง` badges are hidden |
| velCenter | the "ร้านค้าส่ง" tab and queue are never offered (`canSee("stores")` is false) |
| velSeller | the wholesale checkbox / badge in `SellingUnitsManager` is hidden; set & pack authoring is untouched |

**Preserved (verified unchanged):** migrations 058/059 and every selling-unit column (`pieces`,
`selling_unit_id`, `selling_unit_pieces`, `selling_unit_name`), the base-unit invariant
(`quantity * selling_unit_pieces` is the only quantity inventory / variant stock / `sold_count` see),
the cart → checkout → Stripe → webhook → order path, auth/authz, order snapshots and the VelCenter
seller / product / order / payment surfaces. **No migration was written; `db/schema.sql` and
`db/run-sqleditor.sql` were not modified** (the parked objects were already canonical there).

**Verified this pass:** `bun run typecheck` 4/4 + `tsc -p backend` exit 0 · `bun run build:apps` 4/4 ·
`bun run i18n:check` `th=1535 en=1535 my=1535` · `bun test backend/tests` **1741 pass / 413 skip /
1 fail**, the failure being the **pre-existing** ungated DB describe in
`checkout-group-payment-visibility.test.ts` (`ECONNREFUSED 127.0.0.1:5432` — no PostgreSQL here).
`git diff --check` clean. Six parked-contract tests run in `backend/tests/store-accounts.test.ts`;
the 14 DB-gated wholesale tests skip (not deleted, not weakened).

**NOT verified — do not read as PASS:** no PostgreSQL in this workspace, so every DB-gated test
skipped (including the retail set/pack reserve/settle proofs that passed in §77/§78 with a disposable
DB) · no browser E2E · real Stripe TEST E2E and production Neon remain BLOCKED (owner credentials).

**Remaining decision:** `apps/velnox` corporate marketing copy still says "ปลีกและส่ง" / "ซื้อส่ง —
ร้านค้าชุมชน" (`pages/corporate/content.ts`). It is marketing, not a storefront flow, and rewriting
positioning is an owner decision — flagged, not changed.

---

## §81. MVP verification pass — BUY + SELL + CONTROL on a real database (2026-10-19)

**Scope:** audit + proof only, no new features. A disposable PostgreSQL 14 was started in this
workspace, bootstrapped from `db/run-sqleditor.sql`, and the whole suite was run against it.

| Check | Result |
|---|---|
| Fresh-DB bootstrap ×3 (idempotency) | 77 tables / 837 columns / 305 indexes, unchanged |
| `bash db/verify-reconciler.sh` | **ALL SCENARIOS PASSED** |
| `bun test backend/tests` (real DB) | **2147 pass / 16 skip / 0 fail** — 2163 tests, 75 files |
| `bun run typecheck` 4/4 + `tsc -p backend` | exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| Browser E2E | **none exists** in the repository |
| Real Stripe TEST round trip | **BLOCKED** — no keys, no provider access in this workspace |

The 16 skips are by design: 14 parked-wholesale tests (`WHOLESALE_ENABLED=false`) and 2 R2 upload
tests that need R2 credentials.

**ONE REAL BUG FOUND AND FIXED.** `backend/routes/products.ts#getSellerForUser`
resolved the seller row **without its status** — the only seller module that did (`chat.ts`,
`product-options.ts`, `product-selling-units.ts` all filter `status = 'approved'`). Because most of
its 19 handlers only test that a seller row exists, a **suspended / pending seller could still
re-price, restock, re-image or edit a product** with a raw request; the velseller UI hid the screens,
which made it a frontend-only guard — exactly what `.ai/context/seller.md` forbids. Fix: the lookup
now filters `status = 'approved'` (one query, no handler change). Regression test:
`seller-access-authorization.test.ts` → "a suspended seller cannot edit a product or its stock"
(approved seller = 200 control; suspended = 403, and neither `products.price` nor `inventory` was
written). Proven failing before the fix (200) and passing after.

**Still open:** the seller-status rule is now enforced in five modules by convention, not by one
shared helper; consolidating them into `requireApprovedSeller` would remove the class of bug, but
that is a refactor outside this task's "fix only real problems" scope.

---

## §82. Production schema mismatch — `product_selling_units` + `orders.order_state` (2026-10-19)

**Reported from Render logs:** `42P01 relation "product_selling_units" does not exist` and
`42703 column "order_state" of relation "orders" does not exist` (thrown by
`routes/cart.ts#insertOrderWithUniqueNumber`, whose INSERT names `order_state`).

**ROOT CAUSE — Case A/D (migration exists, production is behind).** Both objects are declared in
both canonical files and by migrations `056` (the order axes, with the 9b backfill) and `058`/`059`
(selling units, `is_wholesale`). Nothing in the code or schema was missing. Production simply never
received them. `production-db-migrate.yml` hard-stops when `NEON_PRODUCTION_DATABASE_URL` is absent,
and this workspace has **no database env at all** (`freebuff-env list` → `{}`), so the ledger could
not be read either. The database identity must be confirmed before applying anything (§66: the two
Neons).

**REPO-SIDE DEFECT FOUND while proving the repair — and fixed.** `db/run-sqleditor.sql` (the
documented production repair path) added `orders.order_state` / `fulfillment_status`, set their
defaults, then guarded `SET NOT NULL` on "no NULL remains" — but the **9b backfill was missing**, even
though the comment above it said "Section 9b backfills". Consequence on a database with history:
the run exits 0, the two columns stay **nullable and NULL for every pre-056 order**, and the
projection reads a shipped order back as `pending`. `db/schema.sql` carried the same omission, so the
snapshot and the reconciler agreed with each other and disagreed with migration 056. Both now carry
`056`'s exact `CASE status …` backfill (statement-identical, `WHERE … IS NULL`, rerunnable).

**Verification workflow was blind to the incident.** `production-db-verify.yml` probed only the
checkout-group objects, so it would have gone green on this exact database. It now has three
read-only probes: `product_selling_units` (11 columns, `is_wholesale` NOT NULL DEFAULT false —
wholesale stays fail-closed), both order axes NOT NULL with the canonical defaults, and the six
`cart_items`/`order_items` snapshot columns. Proved non-vacuous: 3 FAILs on the reported shape,
PASS after repair.

**Proof (disposable PostgreSQL 14, real databases):**

| Check | Result |
|---|---|
| Reported 42P01 + 42703 reproduced on a production-shaped DB | **reproduced**, then gone after one reconciler run |
| `bash db/verify-reconciler.sh` (now scenarios A-J) | **ALL SCENARIOS PASSED** — new **J** seeds 6 legacy orders, strips both objects, asserts the exact errors, then asserts backfill `processing/shipped, completed/delivered, pending/unfulfilled, cancelled/cancelled, processing/delivered, processing/packing`, NOT NULL, CHECK, index, 11 columns, 4 indexes, 4 FKs, 6 snapshot columns, and that no order id/status changed |
| Repaired-DB checkout surface (`selling-units`, `checkout-payment-flow`, `multi-shop-checkout`, `cart-selection`, `order-state-projection`, `customer-order-cancel`, `order-fulfillment-state-machine`, `payment-reservation-expiry`) | **272 pass / 0 fail** |
| `bun test backend/tests` (fresh canonical DB) | **2147 pass / 16 skip / 0 fail** — 2163 tests, 75 files |
| `bun run typecheck` 4/4 + `tsc -p backend` | exit 0 |
| `bun run build:apps` | 4/4 exit 0 |
| `git diff --check` | clean |

**NOT applied to production — BLOCKED.** No production credential exists here, and the hard-stop rule
forbids inventing one. Owner action, **in this order**:

1. Set `NEON_PRODUCTION_DATABASE_URL` to the SAME Neon Render's `DATABASE_URL` uses, and confirm the
   identity (`[db]` boot line vs `current_database()`).
2. Run **`db/run-sqleditor.sql` once** against that Neon (SQL Editor is fine). This is the proven
   path for the reported shape: scenario J starts from "table missing + column missing + real
   orders" and converges additively, but scenarios **C** and **H** already prove the older
   shapes too.
3. Run **Actions → Production DB Verify**; it now fails loudly if either object (or the backfilled
   NOT NULL axes) is still missing.
4. Use **Production DB Migrate** for *future* migrations, not as the first repair. Measured this
   pass: `db/migrations/056_commerce_core_invariants.sql:178` declares
   `purchase_id UUID REFERENCES checkout_groups(id)` and 056 **exits 3** when `checkout_groups` is
   absent (`relation "checkout_groups" does not exist`) — while the workflow skips any migration
   the ledger already records. On a database whose ledger claims 054 but lacks the table (§66), the
   migration path alone would fail exactly there.

No destructive statement, no data deletion, no payment/inventory/checkout change, and
wholesale/VelRepeat stay parked in this work.

**PERF-1 — separate issue, recorded only, deliberately NOT optimised in this fix.** From the same
Render log as the 42703: statement latencies of **~198-215 ms** on `product_images`,
`product_variant_images`, `cart`, `addresses`, `revoked_tokens`, `orders`; intermittent **pool
acquisition ~1203 ms** (checkout waits behind the scheduler); and the payment-reservation worker
re-scanning every ~30 s with
`SELECT id FROM orders WHERE payment_expires_at IS NOT NULL AND payment_expires_at <= NOW() AND status = ANY($2::text[]) AND inventory_released = FALSE`.
P0 stayed "checkout cannot create an order"; changing indexes/queries/pool size in the same pass would
have made the schema repair unverifiable. Needs its own task, measured before/after.

---

## §83. Phase 0 audit for the CLEAN MVP REWRITE (2026-10-21)

**Status: Phase 0 complete — WAITING FOR OWNER DECISIONS. No code changed.**
Full report: [`.ai/tasks/active/mvp-clean-rewrite-phase0-audit-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase0-audit-2026-10-21.md).

Audited at `d653a37` (local == `origin/main`, tree clean). Current system: **77 tables**,
**≥165 API paths**, **22 route modules**, **~127k TS lines**, **62 migrations**, 4 apps,
WebSocket, 3 workers. The rewrite is deletion-led: ~10–12k backend lines, 15–18 tables,
~120 endpoints, 2 apps, all migrations. Proven parts to preserve (do not rewrite blindly):
server-authoritative checkout pricing/stock, guarded stock reservation, `checkout_requests`
idempotency, Stripe raw-body signature + event claim + refund recomputation, seller
`status='approved'` gate, JWT revocation/origin/rate-limit, R2 presign, test-DB fail-closed.

**Phase 0 found no mock/fake production data and no TODO/FIXME.** It did find 16 dead
schema tables (12 LEGACY + 4 UNUSED), boot-time DDL in `server.ts`, and an unsigned OAuth
`state` (returnTo carrier, not CSRF protection) to fix in the auth rewrite.

**Blocking decisions (report §13):** D1 reset target (recommend new empty DB, never wipe
production first) · D2 product approval · D3 sets/packs · D4 multi-shop checkout ·
D5 Stripe-only · D6 Google-only · D7 owner/admin only · D8 drop reviews/wishlist/chat/goals ·
D9 delete `apps/velnox` · D10 one schema + reset script, delete migrations · D11 keep 3
languages · D12 simple seller approval. **Still unanswered — they block Phase 2, not the
zero-decision part of Phase 1 that §84 delivered.**

---

## §84. Phase 1 — CLEAN MVP FOUNDATION (2026-10-21)

**Status: Phase 1 complete — `84b3767` → `54c10ae56b5060049faa87a845786cfe4659d35e`
(local == `origin/main` == `ls-remote`). No schema, endpoint, payment, auth or app change.**
Full report: [`.ai/tasks/active/mvp-clean-rewrite-phase1-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase1-2026-10-21.md).

Baseline verified against GitHub (`ls-remote`), not local state: `84b3767` == `origin/main`.
Phase 1 delivered the three maps the rewrite needs — dependency map (VelRepeat, Customer
Memory, wholesale, chat, reviews/wishlist, seller intelligence, WebSocket, 3 workers, Convex
= **absent**, `apps/velnox`, boot DDL), core domain map (9 domains: table authority → API →
frontend → tests), and the REMOVE/PARK/KEEP/REWRITE plan with the blocking decision named
per item.

**Removed (zero-reference only):** `zod` (backend), `framer-motion` (velshop + shared), dead
`chart.tsx`/`form.tsx` (they imported `recharts`/`react-hook-form`, which no package.json
declares), and the barrel re-exports. **Moved:** `leaflet` + `@types/leaflet` from root/shared
to `apps/velshop`, the only consumer. `bun.lock` regenerated; −559 lines total.

**Deliberately NOT deleted** — every one is load-bearing or decision-bound: 62 migrations
(`production-db-migrate.yml` applies them on push; `production-db-verify.yml` asserts the
ledger; `server.ts` reads **028/034/035/036** at boot; CI pins the numbering), 16 dead tables
(needs D1+D10), all parked routes (already 404 behind fail-closed flags), `apps/velnox` (D9,
external Vercel project + OAuth URLs), boot DDL (creating tables a fresh DB still needs).

Verification: `bun install` ok · `bun run typecheck` **4/4** · backend typecheck **0** ·
`i18n:check` **1535×3 parity** · `build:apps` **4/4** · suite **1741 pass / 414 skip /
1 fail**. That failure is pre-existing and environmental: `checkout-group-payment-visibility`
has an ungated `beforeAll` that hits `127.0.0.1:5432` without a database (CI provisions one).
No test was skipped or weakened to make the run green; no `DATABASE_URL` exists in this
workspace.

**Next = Phase 2 (database), blocked on D1/D3/D4/D10.** Do not start route deletion before it.

---

## §85. Phase 2 — CLEAN MVP DATABASE (2026-10-21)

**Status: Phase 2 complete — baseline `dd8c567` (local == `origin/main` == GitHub); no destructive production action.**
Full report: [`.ai/tasks/active/mvp-clean-rewrite-phase2-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase2-2026-10-21.md). Cutover: [`db/mvp/cutover.md`](../db/mvp/cutover.md).

**Canonical MVP schema: `db/mvp/schema.sql`** — 19 tables, zero extensions, 6 lifecycle
triggers. One order axis (`pending_payment|paid|processing|shipped|delivered|cancelled`),
one stock authority (`inventory`, `product_variants` has no stock), one seller per cart/order
(composite FKs), product lifecycle `draft→submitted→approved→published` + `rejected` with
`approval_status` GENERATED, Stripe-only payments with `payment_events.event_id` claim and one
live session per order, NUMERIC(12,2) money everywhere.

**Reset:** `db/mvp/reset.sql` + `db/mvp/reset.sh` — destructive, requires a `_dev`/`_test`
database name AND `velnox.allow_reset=yes`; never reads `DATABASE_URL`; reuses
`backend/db/test-database.ts`. **Seed:** categories only. **Proof:** `db/mvp/verify.sh`
(**81/81**) + `backend/tests/mvp-schema-contract.test.ts` (**19/19**).

**Frozen, not deleted:** `db/schema.sql`, `db/run-sqleditor.sql`, `db/verify-reconciler.sh`,
all 62 migrations, and the four boot-time `ensure*` functions. They serve the deployed
pre-MVP backend and are removed only at cutover, after Phase 3 rewrites the code. Do not edit
them and do not add migrations.

**Verified:** typecheck 4/4 + backend 0 · i18n `1535×3` · full suite **2147→2166 pass /
16 skip / 0 fail** (the +19 are the new contract tests) · `db/mvp/verify.sh` **81/81** ·
`git diff --check` clean. **Not verified:** browser E2E, real Stripe TEST round trip, any
production DB read/write. PostgreSQL 14 locally vs 16 in CI/Neon.

**Open flags:** the repo's third locale is `my` = Burmese while D11 says Malay (no language
change made) · editing a published product does not force re-approval (Phase 3 policy) ·
refunds are outside the MVP · data carry-over is a separate project · production identity must
be proven before cutover.

**Next = Phase 3 (core backend rewrite against `db/mvp/schema.sql`). Do not start it here,
and do not execute the cutover from this phase.**
