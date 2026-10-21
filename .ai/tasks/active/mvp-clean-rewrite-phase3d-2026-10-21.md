# Phase 3d — retail selling units / sets & packs (2026-10-21)

**Status: DONE — the Phase 3c product-scope blocker is removed.**
The MVP can now sell a product/variant at its base unit **and** in seller-defined
retail packs that consume the same base-unit stock, at the seller's own pack
price. Production was not touched; staging was not touched (no access anyway).

## 1. Repository verification

| Item | Value |
|---|---|
| Branch | `main` |
| Starting SHA | `245a41d5ecee0e1418cf168ad8f3ebf536ff3edc` |
| `origin/main` at start | identical (`HEAD` == `origin/main`) |
| Working tree at start | clean |
| Final SHA (code) | `87f5a07` — the report-SHA commit follows it |

Read before editing: `AGENTS.md`, `.ai/AI_RULES.md`, `.ai/AI_HANDOFF.md`,
`.ai/context/{products,database,checkout,testing}.md`, the Phase 3c report,
`docs/MVP_STAGING.md`, then the actual `db/mvp/schema.sql`,
`backend/mvp/*.ts`, `packages/shared/src/mvp/*` and the three `src/mvp` trees.

**STOP conditions checked — none applied.** The MVP had no selling-unit design to
conflict with (zero references in `db/mvp/schema.sql`), stock semantics were not
ambiguous (one `inventory` row per `(product, variant)`), history could be
preserved with a snapshot, no destructive migration was needed (the MVP schema is
`CREATE … IF NOT EXISTS`), no production credential exists in this workspace, and
no part of the architecture needed rewriting.

## 2. Schema design (the smallest compatible model)

`db/mvp/schema.sql` gains **one** table (20 total) and three `order_items`
columns. Nothing else changes: `inventory` is still the ONE stock authority.

```sql
CREATE TABLE product_selling_units (
  id            uuid PRIMARY KEY,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id    uuid,                       -- NULL = base product, like inventory
  label         text NOT NULL,              -- "Pack 6" / "1 ชิ้น"
  base_quantity integer NOT NULL CHECK (base_quantity > 0),
  price         numeric(12,2) NOT NULL CHECK (price >= 0),  -- THIS unit's price
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  CONSTRAINT product_selling_units_variant_fk
    FOREIGN KEY (product_id, variant_id)
    REFERENCES product_variants (product_id, id) ON DELETE RESTRICT
);
```

- **No stock column, no stock row.** A pack owns nothing; it is a conversion.
- **The base unit is implicit**: a cart/order line with `selling_unit_id IS NULL`
  buys one base unit at the product/variant price. Sellers add packs on top. If a
  seller defines an explicit `base_quantity = 1` unit, the catalogue shows that
  instead of the implicit one, so the buyer never sees two options for the same
  single unit.
- **Cart line identity includes the unit**
  (`cart_id, product_id, variant, selling_unit_id` unique). “2 × single” and
  “1 × Pack 6” are two legitimate lines and can never merge; the same pack added
  twice still increments one line.
- **`cart_items.selling_unit_id` is `ON DELETE RESTRICT`** — turning a 6-pack line
  into a single unit because the pack was deleted would silently change the order.
- **`order_items` snapshot**: `selling_unit_id` (`ON DELETE SET NULL`, reference
  only), `selling_unit_label` (immutable, `''` = base), 
  `selling_unit_base_quantity`, and `base_quantity_total INTEGER GENERATED ALWAYS
  AS (quantity * selling_unit_base_quantity) STORED`. Quantity stays “number of
  selling units bought”; the derived column is what reserve/settle/release use, so
  a release can never credit back “2” for a pack of 6.
- **Database guards**: the `order_items` trigger now also refuses a line whose unit
  is not active for that exact product/variant; a new `trg_cart_items_selling_unit`
  refuses a cart line naming an inactive or foreign unit (7 triggers total). Two
  units with the same label on one scope are refused by a unique index on
  `(product_id, COALESCE(variant_id, zero), lower(label))`.
- Money is `NUMERIC(12,2)`; pack price is **never** derived from the base price.

## 3. Inventory semantics (the invariant)

```
required_base_units = purchased_quantity × selling_unit.base_quantity
```

`checkout` maps each priced line to a `StockLine` whose `quantity` is that
product, and `reserveStock` keeps its guarded atomic
`WHERE quantity - reserved >= n`. Reserve, commit (payment settled) and release
(cancel/expiry) all read `order_items.base_quantity_total`.

| Example | Stock | Order | Result |
|---|---|---|---|
| A | 10 | 1 × Pack 6 | reserved 6, 4 sellable |
| B | 10 | 2 × Pack 6 (12 needed) | **409 `OUT_OF_STOCK`**, nothing reserved |
| C | 10 | 2 × single | reserved 2, 8 sellable |
| D | 10 | 1 × Pack 6 + 2 × single | reserved 8, 2 sellable |
| E | 10 | two concurrent 1 × Pack 6 checkouts | one 201, one 409, reserved 6 |

## 4. API changes (all under `/api/mvp`, all server-authoritative)

| Endpoint | Change |
|---|---|
| `POST /seller/products/:id/selling-units` | new — approved seller, own product only, editable states only (`draft`/`rejected`/`published`); `label`, `baseQuantity` (positive integer), `price`, optional `variantId` (must belong to the product), `isActive` |
| `PATCH /seller/products/:id/selling-units/:unitId` | new — partial edit + activate/deactivate. **No DELETE**: a sold unit is retired, never removed |
| `GET /seller/products/:id` | payload gains `sellingUnits[]` |
| `POST /cart/items` | accepts `sellingUnitId`; validates it is ACTIVE and belongs to the chosen product/variant; stores the unit's own price |
| `GET /cart` | each line gains `sellingUnitId`, `sellingUnitLabel`, `sellingUnitBaseQuantity`, `sellingUnitActive`, `baseQuantityTotal`, `availableBase`; `available` is now “how many of THIS unit” |
| `POST /checkout` | re-reads the unit inside the transaction; 409 `SELLING_UNIT_NOT_AVAILABLE` if it was deactivated/renamed away; snapshots label + base quantity; reserves `quantity × base_quantity` |
| `GET /orders/:id`, `GET /seller/orders` | order items expose the snapshot columns |
| `POST /orders/:id/cancel`, expiry sweep, payment settlement | release/commit `base_quantity_total` |
| `GET /admin/products` | rows gain `selling_units[]` (label, base quantity, price, active) for review; approve/reject never touch the table |
| `GET /products/:slug` | product and each variant gain `sellingUnits[]` (`id|null`, `label`, `baseQuantity`, `price`, `available`, `isBase`) |

Authorization is unchanged and re-checked: `requireApprovedSeller` + own-product
scoping (`404` for another seller's product), `requireActiveUser` for cart/order,
`requireAdmin` for review. A client-sent price or base quantity is never read.
Editing a pack on a published listing is a MATERIAL change → the product returns
to `draft` (the existing rule for name/price/images); merely deactivating a pack is
operational and leaves the listing published.

## 5. Client changes

- **VelShop** `Product.tsx`: option selector (single / packs) showing the server's
  price, “N units”, and remaining packs; “One Pack 6 contains 6 units. Each unit
  ordered takes 6 from the seller's stock.” Quantity is bounded by the selected
  option.
- **VelShop** `CartPage.tsx` / `CheckoutPage.tsx` / `OrderDetailPage.tsx`: the pack
  label, its base quantity and the line's base-unit total are displayed; the
  checkout summary repeats “6 units each”.
- **VelSeller** `ProductEditor.tsx`: “Packs & sets” panel — add a pack (variant
  scoped when the product has variants), edit label/units/price, activate or
  deactivate; explains that stock is shared.
- **VelCenter** `Admin.tsx`: product review rows list each pack's label, units,
  price and active state (read-only).

## 6. Tests actually executed

| Check | Command | Result |
|---|---|---|
| MVP API suite | `TEST_DATABASE_URL=… bun run test:mvp` | **113 pass / 0 fail**, 13 files (was 90; +23 new) |
| MVP schema proof | `bun run db:verify:mvp` | **93/93 checks passed** (incl. new §F3) |
| MVP schema contract | `bun test backend/tests/mvp-schema-contract.test.ts` | **20 pass / 0 fail** |
| Legacy backend suite | `TEST_DATABASE_URL=… bun test backend/tests` | **2167 pass / 16 skip / 0 fail**, 76 files |
| Typecheck | `bun run typecheck` + `cd backend && bun tsc --noEmit` | 4/4 apps + backend, exit 0 |
| Builds | `bun run build:apps` | 4/4 apps, exit 0 |
| i18n | `bun run i18n:check` | `th=1535 en=1535 my=1535` parity |
| Whitespace | `git diff --check` | clean |
| Browser E2E | `bun run test:mvp:browser` | **PASS** (see §7) |

New `backend/mvp/tests/selling-units.test.ts` proves: seller create/edit/toggle on
their own product; pending seller 403, customer 403, other seller 404; invalid
base quantity (0, negative, fractional), price (negative, text) and blank label
rejected; duplicate label 409; inactive unit cannot be carted or checked out;
different packs stay separate cart lines while the same pack merges; server pack
price wins over a tampered cart snapshot; Examples A–E; cancel releases exactly
`quantity × base_quantity` once; the expiry sweep releases it once; rename /
deactivate / hard-delete never rewrite a placed order; the DB refuses a foreign or
inactive unit in `cart_items`/`order_items` and a variant delete that still has
packs; a pack adds no inventory row.

## 7. Browser E2E — real Chromium against the real API

`db/mvp/browser-e2e.sh` → `scripts/mvp-browser-e2e.ts` (disposable
`velnox_mvp_browser_test`, built apps served over local HTTPS). Re-run on the
final tree: **exit 0, `ALL STEPS PASSED`**.

`seller signup → apply → admin approve → draft + variant(Large, 10) + **Pack 6
(6 units, ฿500)** → submit → admin approve → publish → buyer signup → catalogue →
variant → Pack 6 (page states “6 units per pack”) → cart → checkout →
**฿500.00** server total → order page shows “Pack 6 · 6 units” → DB check:
`order_items = label “Pack 6” / base 6 / base_quantity_total 6 / qty 1 / ฿500.00`
and `inventory = 10 on hand / 6 reserved` → cancel → reserved 0 → second pack order →
admin expiry sweep → Cancelled → reserved 0 → seller order list`.

Verified in that run: `selling_unit_label`, `selling_unit_base_quantity`,
`base_quantity_total`, `quantity`, `unit_price`, `subtotal` of the placed order
and `inventory.quantity/reserved` before and after cancel/expiry.

## 8. Git

Commits (all pushed to `origin/main`, no force-push):

| SHA | Change |
|---|---|
| `33e7683` | `feat(mvp): add retail selling units to the MVP schema` |
| `1b1043b` | `feat(mvp): price and reserve packs by base quantity` |
| `345d309` | `feat(mvp): expose packs in seller, storefront and admin clients` |
| `f854be7` | `test(mvp): prove pack inventory, release and history` |
| `0eb7b63` | `test(mvp): buy a retail pack in the browser flow` |
| `87f5a07` | `docs(ai): Phase 3d report and handoff` |

Pushed with `git push origin main` (`245a41d..87f5a07`, fast-forward). The
report-SHA commit follows; `origin/main` is verified against local `HEAD` after
that push and recorded in the handoff §89 commit list.

## 9. Environment / limitations

- The local Postgres used for the runs is a disposable sandbox cluster. Its test
  databases are `velnox_mvp_app_test` / `velnox_mvp_browser_test` (created and
  dropped by the wrappers), `velnox_local_test` (scratch), and a legacy-schema
  `velnox_test` bootstrapped from the frozen `db/run-sqleditor.sql` for the legacy
  suite. `DATABASE_URL` was never read by a test; no Neon/production host was
  contacted.
- Stripe TEST round trip is still unverified (no `STRIPE_SECRET_KEY` here). Pack
  settlement is proven by the API suite's webhook fixtures, which settle
  `base_quantity_total` units through the real settlement transaction.
- Image upload remains legacy-shaped (`media.key` vs `media.object_key`);
  unchanged by this phase.
- Staging was **not** deployed (`docs/MVP_STAGING.md` now lists sets/packs as
  resolved). Production env vars, Neon, Stripe mode and deployments were **not**
  touched, and no legacy file was edited (the pre-MVP pair and migrations are
  byte-identical).

## 10. Next

Deploy the staging stack described in `docs/MVP_STAGING.md` and run the browser +
Stripe TEST passes against it. No MVP product-scope blocker remains.
