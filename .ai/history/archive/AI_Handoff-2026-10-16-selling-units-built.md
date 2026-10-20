# Handoff §76–§77 — selling units (sets / packs) BUILT (2026-10-16)

**Provenance.** Moved here **verbatim** on 2026-10-19 from `.ai/AI_HANDOFF.md` (edit-headroom
housekeeping: the current-state file was ~53 KB, past the ~40 KB guidance and close to the ~55 KB
edit-tool ceiling). Index row: [`../AI_Handoff_Archive.md`](../AI_Handoff_Archive.md). The live
invariant stays in the handoff as a compact §76–77 block; this file is the full narrative.

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
