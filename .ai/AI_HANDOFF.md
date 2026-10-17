# Velnox AI Handoff — current state

**Last updated:** 2026-10-17 · **Branch:** `freebuff/d4296b7210b943b805a8cf6d` (from `main`) · **Latest pass:** **wholesale is DISCOVERABLE** (**§79**) — a public pack COUNT plus the per-status application CTA on the product page; pack names and prices still reach an approved store only; full suite **2154 pass / 2 skip / 0 fail** against a real PostgreSQL 16.15; no browser E2E exists here; production DB + real Stripe TEST E2E remain BLOCKED (owner action)
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

Full record: [`.ai/audit/PHASE_3_SHIPMENT_LIFECYCLE.md`](audit/PHASE_3_SHIPMENT_LIFECYCLE.md).
**Starting HEAD `6e24bd546e37e4db65a578cf90bdc9f407c0cd24`** (= `origin/main`, Phase 2).
**Final HEAD (implementation commit):** `b9824fec170926af6cbc7e03890b61d361a58adc`
— `feat(shipping): implement shipment lifecycle transitions`. The `docs(ai)` commit
that carries this section is the tip after it (`git log -1 --format=%H` on `main`);
both are pushed in the same pass and `origin/main` was re-read to confirm.

`shipments.status` had a nine-value CHECK constraint and exactly ONE writer that
ever wrote it (`created`). Phase 3 adds the missing transition: the canonical
vocabulary is read off the database (`pending, created, picked_up, in_transit,
 out_for_delivery, delivered, returned, lost, cancelled` — an invented
`packed/ready_to_ship/shipped` draft was withdrawn because those values would be
refused by `23514`), the machine is forward-only and terminal-protected, repeats
are write-free idempotent successes, and the two timestamps the schema already
had (`shipped_at` on handoff, `delivered_at` on arrival) are stamped once.

- **Atomicity:** the order row lock FIRST (`lib/order-lock.ts`), then a
  CONDITIONAL `UPDATE … WHERE id = $n AND status = $current` — proven with 8 real
  concurrent transactions on a local PostgreSQL 14: exactly one move, one
  timestamp, one order-axis advance.
- **No duplicate machine:** the order's own fulfilment axis is advanced only
  through `canTransitionFulfillment` + `projectOrderStatus`
  (`advanceOrderFulfillmentAxis` in `lib/order-state.ts`), so a parcel move the
  order's machine has no edge for is refused `409 ORDER_NOT_READY` instead of
  letting the two lifecycles diverge; `orders.status` stays a projection.
- **Surfaces:** `PATCH /api/seller/orders/:id/shipment` (approved seller +
  ownership under the lock) and `PATCH /api/admin/orders/:orderId/shipment`
  (center member + `orders.manage`, audited). `CHANNELS.SHIPMENT_UPDATED`.
- **Schema:** NO migration needed — every column, the CHECK and the Phase-2
  unique index already existed in 056/057, `db/schema.sql` and
  `db/run-sqleditor.sql`; nothing additive was outstanding.
- **Tests:** `backend/tests/shipment-lifecycle.test.ts` (27 cases; 13 run without
  a database, 14 are DB-gated) plus the whole existing suite green.
- **Verified this pass:** backend typecheck 0 · all four frontend typechecks 0 ·
  targeted suite 27 pass / 0 fail · full suite **2103 pass / 2 skip / 0 fail** ·
  `bash db/verify-reconciler.sh` ALL SCENARIOS PASSED · `git diff --check` clean.
- **Protected (unchanged):** payment, checkout, inventory, the Phase-1 order-state
  authority and the Phase-2 `UNIQUE(order_id)` invariant.
- **BLOCKED (unchanged, owner action):** production database verification and
  real Stripe TEST E2E; and the endpoints have no frontend consumer yet
  (deliberately backend-scoped).
- **Not started (out of scope):** P1-4 returns/RMA, P1-5 `fulfillment_orders`
  (Phase 4), settlement, commission, ledger, reconciliation.

---

## §75. MVP repositioned: buy & sell — VelRepeat + Customer Memory PARKED (2026-10-14) — **ARCHIVED**

Full record: [`history/archive/AI_Handoff-2026-10-14-mvp-parking-and-phase2-design.md`](history/archive/AI_Handoff-2026-10-14-mvp-parking-and-phase2-design.md).
The **parking contract** it defines is still the live rule (both flags fail closed; parked
modules are not mounted, not scheduled, not re-enabled by deleting anything). Its Phase-2
"designed, not built" block is superseded by §76 below.

---

## §76. Selling units (sets / packs) — BUILT, with real-PostgreSQL proof (2026-10-16)

**Model:** `product_selling_units` (product, optional variant, `name`, `pieces > 0`, `price >= 0`,
`status active/inactive`, one LIVE row per `(product, variant, pieces)`). `cart_items` and
`order_items` gained `selling_unit_id` / `selling_unit_pieces` / `selling_unit_name`.

**The one rule:** `quantity` counts SELLING units; **base units = `quantity * selling_unit_pieces`**
is the ONLY quantity inventory, variant stock and `sold_count` ever see. One authority
(`lib/selling-units.ts` + `orderItemBaseQuantitySql()` in `lib/inventory.ts`), no per-pack stock
column, legacy rows bit-identical at `pieces = 1`.

**Server authority:** the definition's price is authoritative (a crafted body cannot set price,
pieces or another product's pack); checkout re-resolves every line, refuses a retired/mismatched
pack, and applies the `MAX_ORDER_QUANTITY` cap to BASE units. `idx_cart_items_unique` was widened
to include the selling unit, so a set and a piece of one product are two lines.

**Shipped this pass:** migration `058`, both canonical SQL files (+ column/index/FK passes),
`CANON` re-measured **76|302|347|823**, seller CRUD `routes/product-selling-units.ts`
(create/patch/**retire**, never delete), catalog + detail expose `sellingUnits`, cart add/update/
remove/reorder carry the unit, `StoreSellingUnit` type, velShop product-page selector + cart
display, 3 i18n keys (th/en/my at 1499).

**Verified:** `bun test backend/tests` with a real PostgreSQL 16 → **2123 pass / 2 skip / 0 fail**
(includes the new `selling-units.test.ts`, 19 tests: 2 sets of 12 reserve/settle 24 exactly once,
release returns 24, legacy unchanged, cap, immutability, reorder, crafted requests) ·
`bun run db:verify` → **ALL SCENARIOS PASSED** · `bun run typecheck` 4/4 + backend 0 ·
velShop build 0 · `bun run i18n:check` 1499/1499/1499.

**VERIFIED (same pass, VelRepeat/Memory closure):** the parked module was still reachable —
`GET /api/seller/subscriptions`, `POST /api/subscriptions/process-due` (which called
`processPlan()` and MINTED recurring orders), the four legacy `/api/subscriptions*` endpoints and
the velSeller recurring panel were live. All are now parked (proof: flag OFF → 6/6 paths 404,
buy/sell paths still mounted; flag ON → all restored), `getAnonymousId()` no longer mints an id
while parked, and `IdentityMerge` is no longer mounted in velSeller/velCenter.

**REMAINING — items 1–3 are CLOSED by §77 (2026-10-16); the historical list stays here on
purpose:**
1. **Seller authoring UI** for sets/packs in velSeller (`ProductFormDialog` / MyShop). The API is
   built and tested; only the form is missing, so the seller acceptance path is **API-only = FAIL**.
2. **Set name not yet rendered** in velCheckout summary, seller/center order views, or the Stripe
   line-item label.
3. `MyOrders`/checkout "order these again" reuses `/api/customer/reorder`, which now preserves the
   set (tested), but the storefront does not yet label the pack line.
4. Not verified in a browser (no browser E2E in this environment) — the selector's rendering is
   proven by types + build only.

---

**Note on this file's size:** §75 was archived on 2026-10-16 to get back under the ~55 KB edit-tool
ceiling. When it approaches ~40 KB again, move the oldest still-live block to
`history/archive/` and leave a pointer, BEFORE appending.

## §77. Selling units, second pass — seller authoring UI + the set name in every view (2026-10-16)

**§76's open items 1–3 are closed.** A seller can now author sets/packs from the product form, and
the set's name reaches every surface that renders an order line. §76 remains the record of the model
and the BASE-PIECES invariant; nothing below changes that invariant.

**Seller authoring UI (the acceptance gap).** New
`packages/shared/src/components/seller/SellingUnitsManager.tsx` — create / edit / retire /
re-activate, the DERIVED per-piece price shown beside the set price, optional per-variant scoping —
mounted in `ProductFormDialog` as §9b in edit mode (a definition references a saved product, and
optionally one of its variants, by id). It talks only to the existing seller CRUD endpoints:
validation, ownership and "one live definition per size" stay server-side, and the server's own
error message is surfaced verbatim. Retire is a two-step confirm because it is not a delete.

**The set name now reaches the receipt and every order view.**
`buildCheckoutLineItems` labels a set line `"<product> · <set>"`; the amount charged is unchanged
(`quantity` counts sets, `unit_amount` is the set price). The readers project the snapshot:
`lib/order-read.ts` (customer), `routes/seller-orders.ts` (seller) and `routes/center.ts` (company)
now return `sellingUnitName` + `sellingUnitPieces`; both Stripe line-item SELECTs and `StoreOrderItem`
carry them. velShop (cart, checkout summary, MyOrders, ShopOrderDetail), velSeller
(SellerOrderDetail, Income) and velCenter (order table + cards) render the set name where the base
unit word used to sit, so "× 2" beside "เซ็ต 12" can never be read as 2 bottles.

**One correction, from the same contract.** The company console's `itemCount` — captioned "ชิ้น" —
summed `quantity`, i.e. SETS. It now sums `quantity * selling_unit_pieces`, so ops pick and pack the
24 bottles a 2-set line needs. A plain line is `quantity * 1`: legacy values are unchanged.

**Verified (real PostgreSQL 16.15, disposable DB rebuilt from `db/run-sqleditor.sql`):**

| Check | Result |
|---|---|
| `bun test backend/tests` | **2131 pass / 2 skip / 0 fail** — 74 files, 18,270 expect() calls |
| New tests (`backend/tests/selling-units.test.ts`, +8) | the Stripe label (set price, plain line unchanged, blank name); the three readers select the snapshot; the base-piece `itemCount`; end-to-end the customer order read AND the seller order read returning `sellingUnitName` / `sellingUnitPieces` |
| `bun run typecheck` (4 apps) + `bunx tsc --noEmit -p backend/tsconfig.json` | exit 0 |
| `bun run build:apps` | exit 0 — 4/4 |
| `bun run i18n:check` | `th=1499 en=1499 my=1499` — no new keys this pass |

**NOT verified / still open — do not read as PASS:**
1. **No browser E2E exists** in this environment, and the storefront dev server cannot reach a backend
   from the owner's browser here: the authoring form is proven by types + build + the API tests, **not**
   by a rendered page or a click.
2. Real **Stripe TEST-mode E2E** and **production Neon** verification stay BLOCKED — owner credentials
   (see §70/§71).
3. The PostgreSQL used for this proof was installed inside the workspace (`/tmp/pgroot`, 16.15). It does
   not survive an archive: reinstall it to re-run the DB suite.

---

## §78. Store accounts + gated wholesale — Phase 3 BUILT, with real-PostgreSQL proof (2026-10-16)

**Phase 3 of the MVP brief is built, and it took the brief's decision 2 as GATED:** a wholesale pack
and its price are visible to APPROVED store accounts only. The retail path is untouched — provably,
because every pre-existing selling unit is `is_wholesale = false`.

**Model (migration 059 + both canonical SQL files).**
* `store_accounts` — ONE row per user (`idx_store_accounts_user` UNIQUE, so a re-application after a
  rejection UPDATES the same row): `store_name` / `contact_name` / `contact_phone` required,
  `address` / `note` optional, `status` in `pending | approved | rejected`, plus `review_note`,
  `reviewed_by`, `reviewed_at`. `tax_id` is deliberately absent — invoicing is an owner decision not
  yet made, and a column nothing reads lies about the product.
* `product_selling_units.is_wholesale BOOLEAN NOT NULL DEFAULT FALSE`.
* `idx_product_selling_units_unique` is keyed on `(product, variant, pieces, is_wholesale)` — replaced
  under the SAME name — so ONE size can be sold retail AND wholesale at different prices. Without it a
  seller who marked a pack wholesale could not also offer a retail pack of that size.

**The one rule:** `status = 'approved'` and NOTHING else grants wholesale visibility. It is not a role
and rewrites no session — a wholesale buyer is still an ordinary customer of the storefront.

**One authority, total by construction.** `backend/lib/store-accounts.ts` answers `isApprovedStore()`;
`backend/lib/selling-units.ts` is the ONLY place it is applied — the loader adds
`AND is_wholesale = FALSE` for everyone else, and `resolveSellingUnit()` refuses a wholesale unit with
`SELLING_UNIT_WHOLESALE_ONLY`. The gate is TOTAL: an id that is not a `users.id` answers false instead
of raising 22P02, so a stale or crafted session can never turn "no access" into a 500 — and can never
be granted access either.

**Enforced server-side end to end.** Catalog + detail are `optionalAuth` and pass the VIEWER's access
(`includeWholesale`); cart ADD refuses a wholesale pack (403, nothing written); cart UPDATE cannot
ENLARGE a line whose approval is gone; CHECKOUT re-resolves every line and refuses; REORDER skips it
with `selling_unit_restricted`. The lookup runs AFTER the cheap refusals, so a malformed or empty
request costs no query and the COD boundary stays first.

**VelCenter decides.** New permission `stores.manage` (in the catalog, so a staff account needs the
grant), `GET/PATCH /api/admin/store-accounts`, and a "ร้านค้าส่ง" tab. A rejection NEEDS a reason, a
re-approval is a 409, and `isSelfApproval()` refuses a reviewer's own application. Every decision
writes an audit row (`STORE_ACCOUNT_APPROVED` / `STORE_ACCOUNT_REJECTED`).

**Seller + storefront.** `SellingUnitsManager` carries a "ขายส่ง" toggle (create + edit) and a badge;
`isWholesale` must be a real boolean (the STRING "false" is refused rather than quietly hiding a
product). velShop gains `/profile/store` (`ShopStoreAccount`: apply, re-apply, see the outcome and the
reviewer's note) plus a wholesale badge on the product page.

**Verified (PostgreSQL 16.15, disposable DB rebuilt from `db/run-sqleditor.sql`):**

| Check | Result |
|---|---|
| `bun test backend/tests` | **2152 pass / 2 skip / 0 fail** — 75 files |
| New `backend/tests/store-accounts.test.ts` (19) | one row per user + re-apply clears the old review; an approved account keeps approval while editing; catalog/detail show the pack to an approved store ONLY while the retail fields stay identical for every viewer; the cart refuses without access and writes nothing; approval withdrawn → UPDATE 403, checkout 403, ZERO orders; reorder skips; queue 403 without the grant, audited approve, 409 on re-approve, reason required, 404, self-approval refused; authoring boolean + both audiences |
| `bun run db:verify` | **ALL SCENARIOS PASSED** — CANON re-measured **77\|305\|352\|837** |
| `bun run typecheck` 4/4 + backend 0 · `bun run build:apps` 4/4 | exit 0 |
| `bun run i18n:check` | `th=1526 en=1526 my=1526` (+27: the `storeAccount` group + the profile row) |

**Two durable lessons.** (1) A route may not query the database BEFORE its cheap refusals: the COD
refusal tests sign a session for a NON-uuid user id, and an early `store_accounts` lookup turned a 400
into a 500 — fixed by a total gate AND by moving the lookup after validation. (2) A new permission
code must be enforced in a file the RBAC test's `routeSources` map covers;
`backend/routes/store-accounts.ts` joined it, and `center-rbac.test.ts` now holds it to the same
one-permission-system invariants.

**REMAINING (NOT DONE — do not describe as working):**
1. No browser E2E; the storefront dev server here cannot reach a backend from the owner's browser, so
   the apply page, the toggle and the queue are proven by types + build + API tests, not by a click.
2. The applicant is NOT notified of a decision (no notification helper exists in this backend) — they
   learn it by reopening `/profile/store`.
3. MOQ / tiered pricing, store-specific price lists, and invoice / tax-id are NOT built: the brief's
   Phase 3 later items and its decisions 3-7 are still owner input.
4. Real Stripe TEST E2E + production Neon stay BLOCKED (owner credentials — §70/§71).
5. The PostgreSQL used here is disposable and does not survive an archive: server binaries from the
   zonky `embedded-postgres-binaries-linux-amd64:16.15.0` jar, client tools from
   `apt-get download postgresql-client-16 libpq5` extracted under `/tmp/psqlroot`, data dir
   `/tmp/pgdata` on port 5433, schema loaded from `db/run-sqleditor.sql` (§77 note 3 still applies).

## §79. Wholesale is discoverable — the tier is public, its packs are not (2026-10-17)

**§78 hid the whole tier, so nobody could ever find the application.** A product page showed nothing at
all to a signed-out or pending visitor, and `/profile/store` was reachable only from the profile menu.
Now every product payload carries `wholesale: { available, unitCount, access }`, and the page renders
one callout with the single action that viewer can take.

**The public half is a COUNT.** `lib/selling-units.ts#countWholesaleUnits` is a separate read:
`COUNT(*) … WHERE is_wholesale = TRUE AND status = 'active'` grouped by product. It selects no name, no
price and no sort order, so a viewer who cannot see a pack cannot infer its contents. Catalog and detail
call it once per request; a database without migration 059 (42703 / 42P01) gets an empty map — "no
wholesale tier", never an error.

**Access is explainable now, not just a boolean.** `lib/store-accounts.ts#getWholesaleAccess` reads the
viewer's ONE row and answers `status` (`anonymous` / `none` / `pending` / `approved` / `rejected`) plus
`approved`; `isApprovedStore()` is a thin read of it, so there is still ONE rule and ONE query per
request. Catalog + detail resolve it once and pass `storeAccess.approved` to `loadSellingUnits`, so the
count and the rows cannot disagree about who the viewer is.

**Storefront.** `ShopProductDetail` shows the amber callout only when `available && access !==
'approved'`: anonymous → `/auth?returnTo=/profile/store`, `none` → apply, `pending` → view status,
`rejected` → see the reason and re-apply. An approved store already receives the real packs and sees no
callout. Copy added under `storeAccount.*` in th / en / my.

**Verified (PostgreSQL 16.15, disposable DB rebuilt from `db/run-sqleditor.sql`):**

| Check | Result |
|---|---|
| `bun test backend/tests` | **2154 pass / 2 skip / 0 fail** — 75 files, 18,470 assertions |
| `store-accounts.test.ts` (21) | every access state observed through the real detail endpoint; no pack id or name in a non-approved payload; a product with no pack reports `available: false`; the boolean helper equals `getWholesaleAccess().approved` |
| `bun run typecheck` 4/4 + `tsc -p backend` · `bun run build:apps` 4/4 | exit 0 |
| `bun run i18n:check` | `th=1535 en=1535 my=1535` (+9 keys) |
| `git diff --check` | clean |

**NOT verified / still open — do not read as PASS:**
1. No browser E2E here: the callout is proven by payload tests + types + build, **not** by a rendered
   click. The storefront dev server still cannot reach a backend from the owner's browser.
2. The applicant is still NOT notified of a decision (no notification helper exists); they learn it by
   reopening `/profile/store` or the product page.
3. MOQ / tiered prices, store-specific price lists and invoice / tax-id remain unbuilt.
4. Real Stripe TEST E2E + production Neon stay **BLOCKED** (owner credentials — §70/§71).
5. This proof's PostgreSQL is disposable: micromamba `postgresql=16` under `/tmp/pgroot`, data dir
   `/tmp/pgdata`, port 55432. It does not survive an archive.
