# Archive — handoff §78 + §79 (store accounts + gated wholesale)

Moved **verbatim** from `.ai/AI_HANDOFF.md` on 2026-10-19, while adding §80 (the owner's
MVP re-scope that parked wholesale). Reference only — the live rule is the parking contract
in the handoff's §78–79 pointer.

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
