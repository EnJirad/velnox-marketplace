# Shipping default 35 THB + production reconciler repair

Date: 2026-11-05 13:50 +07 (Asia/Bangkok) · Branch `main` · AI 01 (AndroidHarness)
**Starting SHA:** `5aeafb1b4de4605c9ff64ad1c50d030a796fcab3` (= `origin/main`, clean tree)
**Final SHA:** the commit that carries this report (`git log -1`); the code fix itself is `e9ff182`.

## 1. Purpose

Symptom reported from the VelShop checkout screen: **“Could not calculate shipping
for this cart.”** — the shipping row never resolved, so the payable total and the
submit button stayed at `—` and no order could be placed.

Two independent causes, both fixed here:

1. **Schema drift in production.** The quote endpoint selects
   `shops.shipping_fee` / `shops.free_shipping_threshold`, inserts into
   `shipping_quotes` and sets `orders.shipping_quote_id`. None of those objects
   existed in the production Neon database, so `POST /api/customer/shipping/quote`
   threw `42703 column "shipping_fee" ... does not exist` and the route's catch-all
   returned the reported 500 message.
2. **Wrong platform default.** The business default was 50.00 THB. The owner
   decision for this phase is a **flat 35.00 THB** default per shop shipment
   until a carrier integration exists; sellers can still override per shop.

## 2. What was inspected before changing

- `backend/routes/shipping.ts` (the 500 is the route's `catch` branch)
- `backend/lib/shipping.ts` (`PLATFORM_DEFAULT_FLAT_FEE`, `platformDefaultFee()`)
- `backend/lib/shipping-quote-store.ts` (the exact `shops` query)
- `db/schema.sql` (canonical snapshot: `shops.shipping_fee`,
  `shops.free_shipping_threshold`, `orders.shipping_quote_id`, `shipping_quotes`)
- `db/run-sqleditor.sql` (rerunnable reconciler + the guarded `ADD CONSTRAINT` blocks)
- `.github/workflows/production-db-migrate.yml` (the only sanctioned production writer)
- Production Neon (project `wandering-glitter-94857012`) — read-only probes showed
  `to_regclass('public.shipping_quotes') = null`, `shop_cols = 0`, `order_quote_col = 0`
- Production API `/api/health` → 200 and `POST /api/customer/shipping/quote` → 401
  (route exists; auth runs before the query)

## 3. Files touched

| File | Change |
|---|---|
| `backend/lib/shipping.ts` | `PLATFORM_DEFAULT_FLAT_FEE` 50.00 → **35.00**; comment states the carrier-integration rationale |
| `backend/tests/shipping-quote.test.ts` | the assertion that pinned `"50.00"` now pins `"35.00"` |
| `db/run-sqleditor.sql` | 5 guarded `ADD CONSTRAINT` blocks used `pg_constraint.constraint_schema` (a column that does not exist); replaced with `connamespace = 'public'::regnamespace` |
| `.ai/AI_HANDOFF.md` | shipping default + production-schema status |
| `.ai/reports/LATEST.md` | this report (overwrites the previous task report) |

Nothing was removed. No new table, endpoint, component or mock was introduced.

## 4. Why the reconciler fix was mandatory

The production reconcile run failed at `db/run-sqleditor.sql:3856`:

```
ERROR:  column "constraint_schema" does not exist
QUERY:  NOT EXISTS (SELECT 1 FROM pg_constraint WHERE constraint_schema = current_schema() ...)
```

`psql --single-transaction` therefore rolled the whole reconcile back — including
the earlier, correct `ALTER TABLE shops ADD COLUMN shipping_fee` statements. That
is why `shipping_quotes` was still absent after a "successful" past run.
`pg_constraint` has `conname` + `connamespace`; the schema predicate now uses
`connamespace = 'public'::regnamespace`.

## 5. Production action (executed, verified)

1. `gh workflow run production-db-migrate.yml -f confirm="reconcile production"`
   → run `41981905749` — **completed success**.
2. Read-back against production Neon after the run:

| Object | Result |
|---|---|
| `to_regclass('public.shipping_quotes')` | `shipping_quotes` |
| `shops` shipping columns present | 2 of 2 |
| `orders.shipping_quote_id` | present |
| `shipping_quotes_total_adds_up`, `orders_shipping_quote_id_fkey` | both present |
| the store's exact query (`SELECT id, name, shipping_fee, free_shipping_threshold FROM shops WHERE id = ANY($1::uuid[])`) | executes, no `42703` |
| `shops` rows | 2 shops, both `shipping_fee IS NULL` → priced at the platform default 35.00 |

The first dispatch (`41981322276`) failed on the guard bug above and committed
nothing (single transaction).

## 6. Tests / checks actually run

| Command | Result |
|---|---|
| `bun test ./backend/tests/shipping-quote.test.ts` | **PASS** — 33 pass, 0 fail, 73 assertions |
| `bun test ./backend/tests/db-run-sqleditor-reconciler.test.ts` | PASS — 21 pass, 0 fail |
| `bun --filter @velnox/backend typecheck` | PASS (exit 0) |
| `git diff --check` | clean |
| `gh run view 41981905749` | success |
| Production Neon read-back (§5) | PASS |

## 7. Systems confirmed unaffected

- No frontend file changed: the checkout page already renders
  `quote.shippingTotal` and every shop-level reason; it never holds a fee.
- No auth, payment, inventory, order-state or realtime code was touched; the diff
  is one constant, one assertion and five SQL predicates.
- `db/schema.sql` already declared every object, so snapshot and reconciler stay
  at parity (the reconciler test proves the file remains additive and guarded).

## 8. Limitations / not verified

- **No authenticated end-to-end quote/cart/checkout run** was executed. The route
  returns 401 without a session and no production credentials are available to
  this agent, so the UI confirmation (shipping row showing ฿35.00 and the submit
  button enabling) is **NOT VERIFIED** here.
- Render deploy of `e9ff182` was not inspected (no Render workspace selected in
  this session); Render auto-deploys `main`, and the constant only affects the
  quote's fee value, not its ability to run.
- `TEST_DATABASE_URL` is still unset on this device, so the DB-gated suites
  (`checkout-shipping-integrity.test.ts` etc.) still skip.
- `SHIPPING_FLAT_FEE_THB` on Render is unset; if it is ever set, it overrides the
  35.00 default by design.

## 9. Work still open

1. Confirm the checkout screen end-to-end with a real session (expect `ค่าจัดส่ง ฿35.00`
   for both current shops, total = item subtotal + 35.00, and an enabled submit button).
2. Seller-side UI to set `shops.shipping_fee` / `free_shipping_threshold` — still absent.
3. Carrier/zone/weight rates — deliberately out of scope; the flat default is the placeholder.

## 10. What the next agent must know first

- Production schema is now **in sync** for shipping; the reconcile workflow is the
  only sanctioned writer and it is **manual** (`workflow_dispatch` + confirm phrase).
- The 35.00 default lives in exactly one place: `backend/lib/shipping.ts`
  (`PLATFORM_DEFAULT_FLAT_FEE`); tests pin it, so changing it needs both edits.
- Never reintroduce `pg_constraint.constraint_schema`; the reconciler test suite
  and a real reconcile run are the only proofs.
