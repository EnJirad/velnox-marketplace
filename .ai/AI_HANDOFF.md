# Velnox AI Handoff — current state

**Last updated:** 2026-10-22 · **Branch:** `main` · **Latest pass:** **§90 CLEAN MVP DATABASE AUDIT (2026-10-22)** — the canonical MVP schema was re-proven on a real PostgreSQL (schema 93/93, API 113/113) and holds no VelRepeat and no `order_state`; cutover still blocked on database identity. **Prior pass:** **PHASE 3d — retail sets/packs** (**§89**) — the MVP now sells seller-defined packs (`product_selling_units`, own price, `base_units = qty × base_quantity`) against the one `inventory` table, with cart/order snapshots, seller UI, storefront selector, admin review and a **real Chromium pack-purchase E2E**. Staging is **NOT deployed** (no provider access); Stripe TEST still keyless. Production untouched; cutover **not executed**.
**Canonical location:** `.ai/AI_HANDOFF.md` — the root `AI_Handoff.md` is a pointer. **Workspace:** `.ai/README.md`

> ⚠️ **OPEN PRODUCTION INCIDENT (2026-10-21, unchanged since §82):** Render checkout fails with
> `42703 column "order_state" of relation "orders" does not exist` (plus `product_selling_units`
> missing). The database is behind migrations 056/058/059; the repository is correct. Repair is
> **proven and blocked** — `Production DB Migrate`/`Verify` both hard-stop because the secret
> `NEON_PRODUCTION_DATABASE_URL` does not exist, so no migration has ever reached production.
> Diagnosis, proof and the owner runbook: `.ai/tasks/active/production-schema-drift-repair-2026-10-21.md`.

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

**READ-ONLY, and its headline conclusion is WRONG — superseded by §66.** Full record:
[`history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md`](history/archive/AI_Handoff-2026-09-23-neon-readonly-verification.md).
It reported the ledger matching `db/migrations/*.sql` exactly (49/49), but the secret it
read pointed at a DIFFERENT Neon than Render serves. **Never draw a production conclusion
from a ledger read without proving the database identity first.** Live items below only.

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
Findings all fixed in §11 except #7 (production *data* cleanup, owner action).

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

Both **archived** → [`…-postgres-53000.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000.md) and
[`…-classified.md`](history/archive/AI_Handoff-2026-09-27-postgres-53000-classified.md). Live: `53000` was a
provider consumption quota (connect AND query), production is reachable again; the VelRepeat 60 s poll is
still an owner cadence decision. `POST /api/admin/sellers/:id/revoke` now releases its pool connection in
`finally` (`db-client-release.test.ts`). One `pg.Pool` (`max: 20`) serves HTTP + WS + scheduler, and failed
queries log `operation` + PG `code`/`severity`/`message` only.

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
**Still live from it:** migrations were applied to the database named by `NEON_DATABASE_URL`,
which is **NOT** Render's `DATABASE_URL` — so every "production schema verified" claim resting on
that ledger is suspect. Rule: the `42703` error text can never prove which database or build you are
on ([`context/database.md`](context/database.md)).

---

## `42703 checkout_group_id` — the retracted "stale build" verdict (2026-10-04) — **ARCHIVED**

**Archived 2026-10-05** → [`history/archive/AI_Handoff-2026-10-04-42703-correction.md`](history/archive/AI_Handoff-2026-10-04-42703-correction.md).
The durable rule is in [`context/database.md`](context/database.md) and applies to §66/§67/§68:
`ERROR: column "x" does not exist` is emitted both when no relation in scope owns `x` AND when the
relation in scope simply lacks `x` — byte-identically. **The error text can never prove a query is
unqualified or that a build is stale.** Ask the catalog, or ask which database you are on.

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
**Still live from it:** the column probe answers **503 `CHECKOUT_GROUP_UNAVAILABLE` BEFORE
`sessions.create`**, so no orphan payable URL is opened when the column is missing; failures log one
structured line while the client sees generic text; a failed group INSERT
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

## §80–§81. MVP scope lock (wholesale PARKED) + the 2026-10-19 verification pass — **ARCHIVED**

**Moved verbatim on 2026-10-22** (edit-headroom housekeeping; made room for §90) →
[`history/archive/AI_Handoff-2026-10-19-mvp-scope-and-verification.md`](history/archive/AI_Handoff-2026-10-19-mvp-scope-and-verification.md).
**Still live from them:** wholesale / B2B / store accounts stay **parked, not deleted** (both
feature flags fail closed) · `Selling Unit / Set / Pack` is **core** and stays on · the parked-contract
tests still run and the 14 wholesale DB tests still skip rather than being weakened · the
`requireApprovedSeller` consolidation remains an open refactor (the per-module convention is the
current guard). The MVP model proper is §85–§90; the pre-MVP suite result there is superseded by
§90's 2167/0.

---

## §82. Production schema mismatch — `product_selling_units` + `orders.order_state` (2026-10-19) — **ARCHIVED**

**Record moved verbatim** on 2026-10-21 → [`history/archive/AI_Handoff-2026-10-19-production-schema-mismatch.md`](history/archive/AI_Handoff-2026-10-19-production-schema-mismatch.md).
Pre-MVP production history; the MVP schema and cutover supersede the object-level repair. The durable
rules stay in [`context/database.md`](context/database.md): a `42703` never proves which database or
build you are on, and verification never repairs.

## §83–§84. Phase 0 audit + Phase 1 foundation (2026-10-21) — **ARCHIVED**

**Moved verbatim on 2026-10-22** (edit-headroom housekeeping; made room for §90) →
[`history/archive/AI_Handoff-2026-10-21-phase0-phase1.md`](history/archive/AI_Handoff-2026-10-21-phase0-phase1.md).
**Still live from them:** the baseline was proven against GitHub (`ls-remote`), not local state ·
the rewrite is deletion-led and its removal plan stands · decisions D1–D12 were answered by
Phases 2–3 · 62 migrations / boot-time DDL / parked routes are deliberately still present until the
cutover, because the deployed pre-MVP service reads them.

---

## §85. Phase 2 — CLEAN MVP DATABASE (2026-10-21) — condensed

**Phase 2 complete** — baseline `dd8c567`; no destructive production action. Full report:
[`tasks/active/mvp-clean-rewrite-phase2-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase2-2026-10-21.md) · cutover: [`db/mvp/cutover.md`](../db/mvp/cutover.md).

**`db/mvp/schema.sql` is canonical** — 20 tables, 7 lifecycle triggers, one order axis, one stock
authority (`inventory`; variants carry no stock), one seller per cart/order (composite FKs),
`NUMERIC(12,2)` money, Stripe-only payments with the `payment_events.event_id` claim and one live
session per order. Reset is fail-closed (`db/mvp/reset.{sql,sh}`); seed is categories only.
Proved by `db/mvp/verify.sh` (81/81) + `backend/tests/mvp-schema-contract.test.ts` (19/19).

**Frozen, not deleted:** `db/schema.sql`, `db/run-sqleditor.sql`, `db/verify-reconciler.sh`, all
62 migrations and the four boot-time `ensure*` functions — they serve the deployed pre-MVP backend.
Do not edit them and do not add migrations. Open flags unchanged: `my`=Burmese vs D11 Malay ·
refunds out of scope · data carry-over a separate project · production DB identity unproven.

---

## §86. Phase 3 — CORE BACKEND REWRITE against `db/mvp/schema.sql` (2026-10-21)

**Status: Phase 3 scope COMPLETE (9/9 domains).** Baseline `1275a11` == `origin/main` == GitHub;
implementation commit **`b775cb46112ba2099570886550d54fd9f1c7c042`** (this docs record is the next
commit). Full report:
[`tasks/active/mvp-clean-rewrite-phase3-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase3-2026-10-21.md).

**Architecture — two trees, one database each.** `backend/mvp/*` serves **`/api/mvp/*`** and reads
ONLY `db/mvp/schema.sql`; mounted only when `MVP_API_ENABLED=true`, so the deployed pre-MVP service
was byte-identical until the cutover. `isolation.test.ts` fails the MVP suite if an MVP module names
a pre-MVP table, mounts a route outside `/api/mvp`, or converts money to a float. Implemented: auth
(scrypt + `revoked_tokens`, OAuth 501) · seller apply/review · product lifecycle + material-change
re-review · published-only catalogue · one cart per seller · checkout (server pricing, snapshots,
idempotency, guarded reserve, rollback) · Stripe TEST-only session + signed webhook · order
reads/cancel + seller fulfilment · admin queues, categories, metrics, expiry sweep.

**Verified at the time:** backend `tsc` 0 · typecheck 4/4 · builds 4/4 · i18n `1535×3` · MVP suite
81/81 · `db/mvp/verify.sh` 81/81 · schema contract 19/19 · legacy 2162/0. Two real money defects
(100× Stripe minor units, same bug in `amountMatches`) were caught by the new tests.
**Open then:** no Stripe round trip · OAuth parked · R2 not in the MVP API · no consumer of
`/api/mvp`. All four are addressed or re-stated in §87.

---

---

## §87. Phase 3b — MVP CLIENT INTEGRATION (2026-10-21) — condensed

**Client work DONE and verified locally; staging deployment + Stripe TEST round trip NOT performed**
(no infrastructure or credentials here). Baseline `11aa59c` == `origin/main` == GitHub before edits.
Full report: [`tasks/active/mvp-clean-rewrite-phase3b-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase3b-2026-10-21.md).

**NEW `packages/shared/src/mvp/`** — `config.ts` (the ONE switch), `routes.ts` (`/api/mvp` table,
separate from `lib/api-routes.ts`), `client.ts` (envelope, cookie credentials, 15 s timeout, typed
`MvpApiError`, injectable fetch), `api.ts` (one typed fn per route), `types.ts`, `ui.tsx` (query
hook, loading/error/empty states, money formatting, auth panel, session provider/guard). The only
edit to an existing shared module is `lib/api-client.ts`: `me`/`logout` follow the resolved mode, so
`RequireAuth` works in both trees. Legacy stays the default; `lib/api-routes.ts` is unchanged.

**MODE SWITCH, fail-closed.** Only the literal `VITE_API_MODE=mvp` opts in. A build that sets it
without `VITE_DEPLOY_ENV=staging` resolves to LEGACY (`MVP_FORBIDDEN_IN_PRODUCTION`) — a `vite
build` always reports `PROD=true`, so staging must declare itself. `VITE_API_URL` must be a bare
http(s) origin or MVP is refused (`INVALID_API_URL`). These are public `VITE_*` values; the
credential stays the httpOnly cookie.

**FRONTENDS.** Each `main.tsx` branches ONCE on `isMvpMode()`; flag off = the legacy providers,
routes and tab bars exactly as before. velShop MVP mounts its own storefront and `MvpCartProvider`
(the legacy `CartProvider` is NOT mounted in MVP mode). velSeller mounts workspace/apply/product
editor/variants/absolute inventory/submit/publish/fulfilment; velCenter mounts metrics, seller and
product review, categories and the expiry sweep. **No client-side authorisation decision exists** —
the API answers 403 to a customer or a pending seller.

**EXPIRY (Phase F).** `backend/jobs/mvp-order-expiry-scheduler.ts` follows the existing
`backend/jobs/*` pattern, refuses to start unless `MVP_API_ENABLED=true`, is disabled by
`MVP_ORDER_EXPIRY_SCHEDULER=off`, and inherits idempotency from `expireStaleOrders`. **R2 upload is
NOT reusable** — legacy presign inserts `media (url, key, …)` while the MVP table is
`media.object_key`; MVP images are URLs only.

**Verified:** MVP suite **86 pass / 0 fail** (11 files, incl. `client-e2e.test.ts` driving the
SHARED client through a cookie jar: signup → apply → 403 while pending → admin approve → draft →
variant → inventory → submit → 404 publicly → approve → publish → cart → checkout → duplicate key
returns the SAME order → `settled:false` → foreign order 404 → customer admin 403 → seller
`pending_payment → processing` 409 → metrics → anonymous cart 401) · legacy **2166 / 16 skip / 0
fail** · shared **29 pass** · typecheck 4/4 · backend tsc 0 · builds 4/4 (+ an MVP-mode staging build)
· i18n `1535×3` · `git diff --check` clean.

**NOT verified:** deployed staging stack, a real browser pass, the Stripe round trip (no
`STRIPE_SECRET_KEY` here — only the contract: live keys refused, 503 unconfigured, signature/
duplicate/amount checks, never paid by redirect), R2 upload (proven incompatible).

**Owner actions:** staging MVP DB from `db/mvp/schema.sql` → staging backend with
`MVP_API_ENABLED=true` + staging-only secrets → staging frontends with `VITE_API_MODE=mvp`,
`VITE_DEPLOY_ENV=staging`, `VITE_API_URL` → one browser pass → decide Google OAuth + media upload.
Production env, database, Stripe mode and deployments were NOT touched.

**Next = Phase 3c:** deploy that staging stack, run the checklist, then settle OAuth + media.

---

## §88. Phase 3c — STAGING READINESS (2026-10-21) — **ARCHIVED**

**Moved verbatim on 2026-10-22** (edit-headroom housekeeping; made room for §91) →
[`history/archive/AI_Handoff-2026-10-21-phase3c-staging-readiness.md`](history/archive/AI_Handoff-2026-10-21-phase3c-staging-readiness.md).
**Still live from it:** the Render/Vercel/Neon staging matrix and checklist live in
[`docs/MVP_STAGING.md`](../docs/MVP_STAGING.md) · the shared auth panel hard-navigates after
sign-in (the MVP session is read once per mount) · `MVP_COOKIE_SECURE=true` in
`backend/mvp/session.ts` is one-way (can only ADD `Secure`) · `db/mvp/browser-e2e.sh` +
`scripts/mvp-browser-e2e.ts` are the Chromium proof · image upload is still not MVP-compatible
(legacy `media.key` vs the MVP `media.object_key`), so sellers paste URLs · its sets/packs blocker
was closed by §89.

---

## §89. Phase 3d — RETAIL SETS / PACKS (2026-10-21)

**Status: DONE.** The §88 product-scope blocker is removed. Baseline
`245a41d5ecee0e1418cf168ad8f3ebf536ff3edc` = `origin/main` = GitHub. Report:
[`tasks/active/mvp-clean-rewrite-phase3d-2026-10-21.md`](tasks/active/mvp-clean-rewrite-phase3d-2026-10-21.md).

**Schema (20 tables now).** `product_selling_units` = `(product_id, variant_id?, label,
base_quantity>0, price NUMERIC(12,2), is_active, sort_order)`. It owns **no stock**: `inventory` stays
the ONE stock authority and a purchase reserves `quantity × base_quantity`. The base unit is implicit
(`selling_unit_id IS NULL`); an explicit `base_quantity = 1` unit replaces it in the catalogue so the
buyer never sees duplicates. Cart-line identity now includes the unit (2 singles + 1 pack = 2 lines).
`order_items` snapshots `selling_unit_id` (SET NULL), `selling_unit_label`, 
`selling_unit_base_quantity` and a generated `base_quantity_total` used by reserve/commit/release.
Triggers: the order-item guard refuses inactive/foreign units; `trg_cart_items_selling_unit` refuses
an inactive/foreign unit on a cart line (7 triggers). No delete endpoint — a sold unit is deactivated.

**API.** `POST|PATCH /seller/products/:id/selling-units` (approved seller, own product, editable
states; no DELETE), `sellingUnits[]` in the seller payload, `sellingUnitId` on `POST /cart/items`,
pack fields on cart lines, checkout re-reads the unit and 409s `SELLING_UNIT_NOT_AVAILABLE` if it was
retired, cancel/expiry/settlement release or commit `base_quantity_total`, admin product rows expose
`selling_units[]`, and `GET /products/:slug` publishes `sellingUnits[]` per scope. Clients: VelShop
option selector + cart/checkout/order snapshots, VelSeller “Packs & sets” panel, VelCenter read-only
review chips. Editing a pack on a published listing is material → back to `draft`; deactivating is
operational and does not demote.

**Verified on this tree:** MVP suite **113 pass / 0 fail** (13 files) · `db:verify:mvp` **93/93** ·
schema contract **20 pass** · legacy **2167 pass / 16 skip / 0 fail** · typecheck 4/4 + backend 0 ·
builds 4/4 · i18n `1535×3` · `git diff --check` clean · **browser E2E PASS** (seller adds a 6-unit
Pack 6 at ฿500 on the variant → buyer sees “6 units per pack” → cart → checkout **฿500.00** → order
snapshot `Pack 6 | 6 | total 6 | qty 1` → inventory 10 on hand / 6 reserved → cancel → 0 reserved →
second pack order expires → 0 reserved). Inventory examples A–E, concurrent last-stock, exact
12-unit release for 2 packs, double-release protection and history-after-rename/delete are in
`backend/mvp/tests/selling-units.test.ts`.

**Commits (pushed to `origin/main`, fast-forward, no force-push):** `33e7683` schema · `1b1043b`
API/inventory · `345d309` clients · `f854be7` pack tests · `0eb7b63` browser pack flow · `87f5a07`
Phase 3d docs (baseline `245a41d`, code tip `87f5a07`; this handoff/record commit follows it and
`origin/main` is verified equal to local `HEAD`).

**NOT verified / outstanding:** no provider deployment (no Render/Vercel/Neon access), Stripe TEST
round trip still keyless (pack settlement proven through webhook fixtures), image upload still
legacy-shaped. Staging untouched. Production env, Neon, Stripe mode and deployments untouched; the
pre-MVP pair and `db/migrations/*.sql` were not edited.


---

## §90. Clean MVP database audit — canonical model re-proven, cutover NOT executed (2026-10-22)

**Status: audit + proof complete; no code, schema, migration, endpoint, payment or auth change.**
Baseline `563cf85c1f5543766e0548a83dcb5acd3929418e` = local `HEAD` = `origin/main` = `ls-remote`.
Full report with the required table/column/enum/API inventories:
[`.ai/tasks/active/mvp-database-audit-2026-10-22.md`](tasks/active/mvp-database-audit-2026-10-22.md).

**Verdict.** `db/mvp/schema.sql` already IS the requested clean rebuild: **20 tables**, one order
axis, one stock authority, `NUMERIC(12,2)` money, **no VelRepeat, no `order_state`, no
`fulfillment_status`, no wholesale, no intelligence tables**. Nothing was added to it. What is left
is the **cutover**, which the workspace cannot perform (no database/provider credential).

**Pre-MVP → MVP inventory:** 77 pre-MVP tables audited → **24 kept/merged into the 20 MVP tables,
53 removed** (11 VelRepeat, 4 behaviour/memory, 6 option/attribute, groups/refunds/settlements/
ledger/commissions, staff/settings/goals/chat/reviews/wishlist, 16 with zero code references).

**Root cause of `42703 orders.order_state` (and the cart errors).** `order_state` +
`fulfillment_status` are declared by `db/migrations/056_commerce_core_invariants.sql`;
`cart_items.selling_unit_*`, `order_items.selling_unit_*` and `product_selling_units` by `058`. The
pre-MVP code reads them; the Render database never received 056/058/059. The MVP model therefore
**deletes** the concept rather than adding a column: `orders.status` is the single axis
(`pending_payment → paid → processing → shipped → delivered`, plus `cancelled`, trigger-enforced).
Repair is either applying the missing migrations to that database or cutting over to a fresh MVP
database — both owner actions; neither was performed and neither may be guessed.

**Verified this pass (PostgreSQL 14.24, disposable):** fresh bootstrap 20 tables / 206 columns /
75 indexes / 32 FKs / 78 CHECKs / 7 triggers / 0 enum types · `db/mvp/verify.sh` **93/93** ·
`mvp-schema-contract.test.ts` **20/20** · `bun run test:mvp` **113 pass / 0 fail** · pre-MVP suite
**2167 pass / 16 skip / 0 fail** · typecheck **4/4** · builds **4/4** · i18n `1535×3` · integrity:
0 forbidden tables/columns, 10 money columns all `NUMERIC(12,2)`, 0 float, 0 orphan FKs, 0 invalid
indexes, 0 unvalidated constraints.

**VelRepeat: 0 references in the MVP tree** (schema, API, clients). The 11 tables, 6 route modules
and 2 schedulers that remain in the **frozen** pre-MVP tree are deleted in the cutover commit, not
before: the deployed Render build still serves them and no new database exists to point at.

**NOT verified / BLOCKED:** production database identity (no credential; `freebuff-env` holds no
keys), staging deployment, real Stripe TEST round trip. **No production DROP/TRUNCATE/DELETE/reset,
no force-push, no Stripe Live change.** Docs corrected with this pass: `docs/DATABASE.md` now lists
20 MVP tables (it was stale at 19, missing `product_selling_units`) and 93 schema checks.

**Next:** owner creates an empty Neon database → `psql -f db/mvp/schema.sql` (+`seed.sql`) →
staging deploy with `MVP_API_ENABLED=true` → browser + Stripe TEST pass → `db/mvp/cutover.md` §3.

---

## §91. Full-repo cleanup — inventory, proven removals, `db/` collapse gated (2026-10-22)

**Status: cleanup PASS 1 complete; no route, schema, payment, auth or deployment change.**
Baseline `321d028` = `origin/main`. Inventory + evidence:
[`.ai/tasks/active/repo-cleanup-inventory-2026-10-22.md`](tasks/active/repo-cleanup-inventory-2026-10-22.md).

**Removed (8 files, each proven zero-consumer):** `ProductDetailModal.tsx` + `ImageUpload.tsx`
(velshop), `LogoDropdown.tsx` + `components/reorder/*` (shared), `customer-memory-core.ts`,
root `public/logo.svg`, and the `db:smoke` / `db:consistency` placeholder scripts.

**Added:** `backend/tests/parked-modules-parking.test.ts` (15 tests, no DB) — pins that with
the default flags every VelRepeat setup is mounted exactly once and only inside
`if (VELREPEAT_ENABLED)`, the customer/seller subscription surfaces return before registering,
both schedulers and the boot DDL are gated, `/api/events/track` refuses, the tracking client is
a no-op, and the MVP trees name no parked table, endpoint or import. Parking is now tested,
not assumed.

**`db/` collapse (2 SQL files) = the cutover, not tidying** — it would leave the deployed
Render build (which reads the pre-MVP pair) and the CI bootstrap (`test.yml` runs
`db/run-sqleditor.sql`) broken, which the brief itself forbids. Gate: a new empty Neon
database. What WAS proved: `db/mvp/schema.sql` alone is a complete, rerunnable bootstrap
(`verify.sh` 93/93, reruns change nothing), so no second MVP SQL file is needed.

**Verified:** typecheck 4/4 · backend `tsc` 0 · builds 4/4 · i18n `1535×3` · legacy suite
**2182 pass / 16 skip / 0 fail** (77 files, +15 new) · MVP suite **113/0** · `db/mvp/verify.sh`
**93/93** · `git diff --check` clean. **NOT verified:** any deployment, the Stripe TEST round
trip, the R2 upload round trip, a browser pass, production (no credential).

**Open findings:** the Stripe webhook still runs `handleVelRepeatV2PaymentEvent` unconditionally
(a parked module on the live payment path — left untouched: payment semantics are out of
scope); production 056/058/059 drift unchanged (§90); VelCenter MVP has no Orders/Users tab;
image upload is not MVP-compatible (`media.key` vs `media.object_key`).
