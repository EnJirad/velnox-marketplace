# MVP Restructure — buy & sell: retail + community-store wholesale

**Status:** **Phase 1 COMPLETE (shipped 2026-10-14)** · Phases 2–4 **DESIGNED, NOT BUILT**
**Assigned:** 2026-10-14 · **Branch:** `main` · **Owner brief:** in-session (Thai), summarised in §2
**Authority:** `AGENTS.md` → `.ai/AI_RULES.md` → `.ai/context/<subsystem>.md` → source. The **repository always wins** over this document.

> **SUPERSEDED UPDATE (2026-10-23) — VelRepeat is REMOVED, not parked.** The repository-cleanup
> task deleted every VelRepeat surface: the 6 route modules, both schedulers, the lib modules,
> the pages/components, the i18n keys, the tests, the `VELREPEAT_ENABLED` switches and all
> VelRepeat database objects from `db/schema.sql` / `db/run-sqleditor.sql`. The §4 parking
> contract for **VelRepeat** ("kept, restorable by a flag") is obsolete — restoring it would be
> a rebuild, not a flag flip. **Customer Memory parking (§4 right column) still stands.** Legacy
> objects still present in an EXISTING database are handled later by
> `docs/VELREPEAT_REMOVAL_PLAN.md` (never executed by the cleanup).

> This brief holds two things that must not be confused:
> **§5 is what SHIPPED** (with real command output), **§6–§9 are PROPOSED DESIGN** that no code
> implements yet. Nothing in §6–§9 may be described to the owner as working.

---

## 1. Objective

Re-scope Velnox from a "recurring commerce / customer memory" story to a marketplace that first
does the ordinary thing — **buy and sell** — and then adds the differentiator the owner actually
wants: **community / village shops ordering wholesale by the piece or by the pack**, so Velnox does
not have to build its own branch network.

When this brief is fully done, all of the following must be true:

1. A normal customer can browse, add to cart, pay, and receive an order — the standard retail path.
2. A shop owner can order **by line item**, choose **piece or pack**, and pay **less per unit** when
   buying a pack, so a weekly restock of *only the items that ran out* is a normal order.
3. VelRepeat and Customer Memory are **out of the storefront and out of the API**, still in the
   repository, restorable by a flag.
4. Every caption that promised "จำแทนคุณ / Commerce that remembers you" is replaced by the
   buy-and-sell positioning, in **th / en / my**.

---

## 2. Owner brief (as given, 2026-10-14)

- Make the site a **normal marketplace** — ordinary customers buy and pay normally.
- Add a **second buying style for shops**: shops order **by line item**, **per piece** or
  **per pack / per box**, and **a pack is cheaper per unit**.
- The scenario that defines the feature: *this week the shop ran out of only two things — coconut
  water and snacks. It should be able to order just those two and top up the shelf.*
- Velnox cannot open branches like a convenience-store chain, so the goal is a **connection to
  community shops**, not company-owned branches.
- **Customer memory and VelRepeat are not wanted now.** Keep them — do not delete — and bring them
  back later.
- **Change the captions** to a buy-and-sell style; drop the "remembers you" caption for now
  (it may return later).
- Priority: **the fastest possible working MVP that can actually trade and take money.**

---

## 3. Positioning before → after

| | Before (as shipped) | After (target) |
|---|---|---|
| Headline promise | "Commerce that remembers you · จำแทนคุณ" | "ซื้อขายของจริง ทั้งปลีกและส่ง" |
| Primary feature story | VelRepeat (prepaid repeat commerce) + Customer Memory | Ordinary buy-and-sell + wholesale restock for shops |
| Buyer tracks | one (retail), with a recurring layer on top | **two explicit tracks: retail customer · community shop** |
| Growth model implied | platform-owned convenience chain | **marketplace that connects community shops to real suppliers** |
| VelRepeat | headline feature, 6 route modules mounted, 2 background workers | **PARKED** (routes unmounted, workers off, UI hidden) |
| Customer Memory | behavioural events + personalisation rails live | **PARKED** (no event collection at all) |

**Where the "after" state stands today:** §5 (positioning/captions/parking) is **shipped**; the
wholesale buyer track itself (§6–§9) is **not built**.

---

## 4. Parked modules — the parking contract

Two modules are parked, **not removed**. The contract, so nobody re-derives it later:

| | VelRepeat | Customer Memory |
|---|---|---|
| Switch | `packages/shared/src/lib/features.ts` → `VELREPEAT_ENABLED` (**false**) · `backend/lib/features.ts` → `VELREPEAT_ENABLED` (`process.env.VELREPEAT_ENABLED === "true"`) | `CUSTOMER_MEMORY_ENABLED` in the same two files (**false** / env `CUSTOMER_MEMORY_ENABLED === "true"`) |
| Backend | the **6 route modules are not mounted** → 404 for every `/api/velrepeat*`, `/api/subscriptions`, `/api/velrepeat-packages` · both schedulers do not start · `ensureVelRepeatV2Tables()` does not run | `/api/events/track`, `/api/events/merge`, `/api/memory/insights` answer **404** via `parkedModule()` |
| Storefront | routes `/velrepeat`, `/velrepeat/v2` not registered (→ NotFound); promo, profile row, footer link, help category, product-page button, sheet action, checkout offer, order "repeat" button, seller authoring section, VelCenter KPI card all hidden | `IdentityMerge` not mounted; `useTracking()` is a **no-op** (nothing is sent, no anonymous id is created); the three personalised rails issue no request; the "we remember your interests" note is not rendered |
| **Kept** | every table, migration, route module, job, page, component, test and i18n key | `behavioral_events`, the event handlers, the tracking client, the pure core |
| Re-enable | set **both** flags | set **both** flags |
| **Forbidden** | delete a table, a route, a scheduler or a test; drop a column; weaken a VelRepeat test to make the suite green | — |

**Why the backend fails closed.** The frontend flag decides what renders; the backend flag decides
what the API will accept. Only the exact string `"true"` enables a module, so an unset or misspelled
variable can never expose a parked surface. Flipping only the frontend flag is a **supported
mistake**: the UI appears and its calls 404 — never the reverse (an open API with no UI).

**Why the schedulers are off, not just the routes.** A parked feature must not keep writing orders,
payments, inventory or `sold_count` in the background. Leaving the workers running would mean the
platform still mints recurring orders for a feature the storefront no longer offers.

---

## 5. Phase 1 — SHIPPED (2026-10-14)

### 5.1 What changed

| Area | Files |
|---|---|
| Park switches | `packages/shared/src/lib/features.ts` (new) · `backend/lib/features.ts` (new) |
| Backend parking | `backend/server.ts` (route mounting, both schedulers, boot table creation) · `backend/routes/center.ts` (3 Customer Memory endpoints + `parkedModule()`) |
| Tracking | `packages/shared/src/lib/track.ts` (`useTracking` no-op while parked) |
| velShop | `src/main.tsx`, `pages/ShopHome.tsx`, `pages/ShopProductDetail.tsx`, `pages/ShopDetail.tsx`, `pages/ShopCheckout.tsx`, `pages/MyOrders.tsx`, `pages/ShopProfile.tsx`, `pages/ShopHelp.tsx`, `components/shop/ShopFooter.tsx`, `components/shop/ProductSelectionSheet.tsx`, `components/shop/ProductDetailModal.tsx` |
| velSeller / velCenter | `components/seller/ProductFormDialog.tsx` (VelRepeat authoring section) · `apps/velcenter/src/pages/Center.tsx` (KPIs + tagline placeholder) · `apps/velseller/src/pages/SellerGoals.tsx` (copy) |
| Captions (th/en/my) | `footer.tagline`, `footer.shopDesc`, `cartDrawer.tagline`, `home.seoDesc` — **values only, no key added or removed** (i18n parity preserved) |
| Corporate site | `apps/velnox/src/pages/corporate/CorporateHome.tsx` (rewritten), `corporate/content.ts` (about/vision/business/ecosystem/technology/careers/news/privacy), `corporate/CorporateLayout.tsx` (title, footer, meta) |

New captions:

| Key | th | en | my |
|---|---|---|---|
| `footer.tagline` | ซื้อขายของจริง · ปลีกและส่ง ในที่เดียว | Real buying and selling · retail and wholesale in one place | အစစ်အမှန်ဝယ်ရောင်း · လက်လီနှင့်လက်ကား တစ်နေရာတည်း |
| `cartDrawer.tagline` | ซื้อปลีกหรือสั่งส่ง — เลือกจำนวนได้ตามต้องการ | Buy retail or order wholesale — choose the quantity you need | လက်လီဝယ်ပါ သို့မဟုတ် လက်ကားမှာယူပါ — လိုသလောက်ရွေးချယ်ပါ |
| `home.seoDesc` | {tagline} ค้นหาและสั่งซื้อสินค้าจากร้านค้าจริงทั่วประเทศ | {tagline} Browse and order real products from real sellers | {tagline} အစစ်အမှန်ဆိုင်များမှ ကုန်ပစ္စည်းများကို ရှာဖွေဝယ်ယူပါ |

The corporate page's wholesale illustration is labelled **ตัวอย่าง (example)** on purpose: it is
marketing, and nothing on that page may read as live storefront data.

### 5.2 Phase 1 verification (real output)

| Check | Command | Result |
|---|---|---|
| Frontend types | `bun run typecheck` | **exit 0** — velShop · velSeller · velCenter · velNox all `Exited with code 0` |
| Backend types | `bunx tsc --noEmit -p backend/tsconfig.json` | **exit 0** |
| i18n parity | `bun run i18n:check` | `i18n:check OK — th=1496 en=1496 my=1496 keys, all locales at parity.` |
| Builds | `bun run build:apps` | **exit 0**, 4/4 |
| Backend suite | `bun test backend/tests` (no DB in this workspace) | **1715 pass / 382 skip / 1 fail** — the single failure is `ECONNREFUSED 127.0.0.1:5432` in `checkout-group-payment-visibility.test.ts`'s DB-backed `describe`, which is **not** gated on `hasTestDatabase()` and imports only `lib/payment-attempt.js` + `db/index.js` (untouched by this pass). Nothing listens on 5432 in this sandbox → **environmental, not a regression**; it must be re-run against a disposable Postgres. |

**Phase 1 is NOT claimed as "verified in a browser".** No browser E2E exists in this workspace, and
`bun run lint` is not configured in this repository.

### 5.3 Phase 1 explicitly does NOT do

- It does **not** give shops a cheaper price, a pack option, a minimum order, or any B2B account
  concept. Those are Phase 2–3. **Today a shop can only order the same retail lines as anyone.**
- It does **not** delete VelRepeat or Customer Memory, and does not touch their tables, migrations,
  tests or i18n keys.

---

## 6. Phase 2 (THE MVP CORE) — wholesale pack pricing — **DESIGNED, NOT BUILT**

### 6.1 The model in one line

**A pack is a SELLING UNIT with its own price; inventory is only ever counted in base pieces.**

Why this shape and not "quantity discounts": the owner's ask is a *choice on the product page*
("สั่งเป็นชิ้น หรือยกแพ็ค"), and a pack has a name a shop recognises (แพ็ค 12 / ลัง 24). A quantity
tier table can be added later as a second mechanism; it is not needed for the MVP and would double
the price-resolution matrix.

### 6.2 Data model (proposed)

```sql
CREATE TABLE product_pack_sizes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,  -- NULL = whole product
  name        TEXT NOT NULL,                       -- 'แพ็ค 12', 'ลัง 24'
  pieces      INTEGER NOT NULL CHECK (pieces > 1), -- base units per pack
  price       NUMERIC(12,2) NOT NULL CHECK (price > 0),  -- price per PACK
  min_packs   INTEGER NOT NULL DEFAULT 1 CHECK (min_packs >= 1),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- one live definition per (product, variant, pieces)
```

Line columns (additive, `NOT NULL DEFAULT 1` so **every existing row keeps today's meaning**):

| Table | New columns |
|---|---|
| `cart_items` | `pack_size_id UUID NULL` (FK `ON DELETE SET NULL`) · `pack_pieces INTEGER NOT NULL DEFAULT 1` |
| `order_items` | the same two, plus `pack_name TEXT NULL` (invoice snapshot) |

**Semantics (the whole contract):**

| Field | Meaning |
|---|---|
| `quantity` | number of **selling units** — pieces, or packs |
| `price` / `unit_price` | price per **selling unit** (per pack when it is a pack line) |
| `pack_pieces` | base pieces per selling unit — **1** for a plain line |
| **base units** | `quantity * pack_pieces` — **the only quantity inventory ever sees** |

### 6.3 The inventory invariant (the risky part, stated up front)

`order_items.quantity` is currently read **directly** as base units by the three canonical
inventory authorities — `commitOrderInventory`, `releaseOrderInventory`
(`backend/lib/inventory.ts`) and the reservation path — and by `products.sold_count`.

So Phase 2 changes **exactly one expression in each of those reads**:

```sql
SELECT product_id, variant_id, quantity * pack_pieces AS base_quantity FROM order_items WHERE order_id = $1
```

- **Legacy rows are bit-identical** (`pack_pieces = 1`).
- **One authority is preserved**: no second stock counter, no per-pack stock column, no second
  `sold_count` writer. A pack of 12 consumes 12 and counts 12 sold.
- **Non-variants and variants keep behaving as they do today** (hold → commit/release; variant stock
  decremented at reserve) — only the number becomes base units.

Anything that reads `quantity` as *pieces* for reporting (seller analytics, dashboards, returns)
must use the **same shared SQL fragment**, not its own arithmetic — one authority, mirrored by a
helper, exactly like `lib/payment-attempt.ts` and `projectOrderStatusSql()` do for their domains.

### 6.4 Price authority

- The **pack price is authoritative for the line**: `line total = quantity × price`.
- The **per-unit price is DERIVED for display only** (`price / pieces`) and is **never stored** —
  storing it would immediately drift on rounding (12 pcs at ฿100 → ฿8.33 → ฿99.96 ≠ ฿100).
- Server-side validation additions: `pack_pieces > 1`, `min_packs ≤ quantity`, and a **base-unit
  cap** (`quantity × pack_pieces ≤ MAX_ORDER_QUANTITY`) so a pack line cannot smuggle 999 packs × 24
  units past the existing `validateCheckoutQuantity()` clamp.
- `cart_items` uniqueness must gain `pack_size_id`, or a "1 piece" line and a "1 pack" line of the
  same product collide on the existing unique index. (Requires dropping the old index and updating
  `db/verify-reconciler.sh`'s expected index/table counts — see `.ai/context/database.md`.)

### 6.5 Surface (proposed)

| Layer | Work |
|---|---|
| DB | migration `057` + mirror into **both** `db/schema.sql` and `db/run-sqleditor.sql`; reconciler counts; `backend/tests/helpers/canonical-schema.ts` parity |
| Backend | **new** `backend/routes/product-packs.ts` (seller CRUD) — deliberately **not** appended to `backend/routes/products.ts`, which is >55 KB and effectively uneditable here (`.ai/AI_HANDOFF.md` §6); pack list included in the product/detail payload; cart/checkout read the pack row server-side and **never trust a client price** |
| velShop | product page: "ชิ้น / แพ็ค" selector with the derived per-unit price and the saving; cart line shows pack name + pieces; checkout summary and order detail render pack lines; order-history "order these again" becomes the **restock list** (Phase 4 polish) |
| velSeller | pack authoring (name, pieces, pack price, min packs) on the product form; pack lines visible on the order |
| velCenter | no new permission needed for authoring (it is the seller's own product); pack lines must render in order views |
| i18n | new keys in **all three** locales (parity enforced by `bun run i18n:check`) |

### 6.6 Phase 2 acceptance criteria

1. A product with `pack_sizes = [{pieces:12, price:540}]` shows retail ฿55/ขวด and pack ฿540/แพ็ค
   (derived ฿45/ขวด) — and the **displayed** saving equals the **stored** pack price.
2. Adding 2 packs reserves **24** base units, and checkout totals exactly `2 × 540`.
3. Payment settlement consumes 24 units and increments `sold_count` by **24 — exactly once**.
4. Cancellation / failure / expiry returns **24** units, exactly once.
5. A legacy cart and a legacy order (no pack) behave **identically** to today.
6. A crafted request (client-sent price, `pack_size_id` of another product, `quantity` over the
   base-unit cap) is **refused server-side** and writes nothing.
7. `bun test backend/tests` against a disposable Postgres, `bun run db:verify`, `bun run typecheck`,
   `bun run build:apps` and `bun run i18n:check` all pass.

---

## 7. Phase 3 — shop accounts & wholesale access — **DESIGNED, NOT BUILT**

- A **store account** marker on the user (store name, contact, later tax id) and an optional
  "wholesale visible" gate on the product/pack.
- Store-only prices, MOQ per line, and store-specific pricing if the owner wants it.
- Decision needed: is wholesale **public** at MVP (recommended: yes — fastest path to trading, packs
  visible to everyone) or gated to approved store accounts (adds a review queue to the MVP)?

## 8. Phase 4 — restock workflow — **DESIGNED, NOT BUILT**

- **Restock list**: the shop's own list of items it carries, with "ran out / running low" marks, and
  one-press conversion of the remaining lines into a cart.
- Wholesale delivery/fulfilment reality (own truck, pickup, minimum order) and document needs
  (invoice / tax id) — both need owner input before any schema is written.

## 9. Owner decisions REQUIRED before Phase 2/3 code (do not guess)

1. **Pack vs tier** — packs only (recommended, matches "ยกแพ็ค"), or also automatic quantity tiers?
2. **Who sees wholesale prices** — everyone at MVP (recommended) or approved store accounts only?
3. **MOQ** — is `min_packs` enforced per line, per order, or both? (Default proposed: per line, `1`.)
4. **Round/display rule** for the derived per-unit price (show rounded ฿45/ขวด, or the exact
   fraction, or "ประหยัด 18%")?
5. **Can a seller's pack price exceed the retail price × pieces?** (Proposed: allowed but flagged —
   it is the seller's pricing choice, and the platform never silently corrects money.)
6. **Do wholesale orders need their own shipping rule** (pickup / own delivery / no COD)?
7. **Store verification requirements** (tax id, store licence) — needed before any invoice feature.

## 10. Verification status & limitations of this workspace

- `bun install --frozen-lockfile` works; **no Postgres** is available (no root, nothing on 5432), so
  every DB-gated test is **skipped or unverifiable** here, and `bun run db:verify` cannot run.
- **No browser E2E has ever run from this environment** — the parking and the captions are verified
  by types, build and i18n parity, **not** by a rendered page.
- `bun run lint` is **not configured** in this repository.
- Known pre-existing gap (not introduced here): `checkout-group-payment-visibility.test.ts`'s
  DB-backed `describe` is not gated on `hasTestDatabase()`, so it fails with a connection error
  wherever no database exists. It should be gated, not deleted.

## 11. Stop conditions

- The source contradicts this brief → the repository wins; correct this file.
- Phase 2 needs a **second** inventory or `sold_count` authority, or a pack stock column → **stop**:
  that breaks the invariants in `.ai/context/` (one release, one commit, one `sold_count`).
- A change would weaken auth/authz, or delete a parked module to make a check pass → **stop**.
- Verification fails for a reason outside the phase's scope → report, do not paper over.
