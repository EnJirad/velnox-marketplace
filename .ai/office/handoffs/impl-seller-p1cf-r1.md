# Implementation + verification record — Seller (order-address fix, V-badge visual removal)

Round r1 · base commit `7b5126f` · branch `main`

> AI 02 (planner/QA subagent) **BLOCKED**: two delegations failed with
> `context_length_exceeded` (272k cap) before any output. Phase A and the
> independent verification pass were executed by AI 01. This is recorded as a
> delegation failure, not presented as independent QA.

## Objective

1. Fix the seller/customer order detail losing the shipping address and phone.
2. Remove the visible V badge from seller and shop surfaces without touching
   verification or approval security.

## Root cause (order address)

`orders.shipping_address` is JSONB; the `pg` driver returns it **already parsed
as an object**. Both readers (`routes/cart.ts`, `routes/seller-orders.ts`) did:

```ts
if (!raw || typeof raw !== "string") return null;
```

so every order produced `addressSnapshot: null`. The recipient/phone then fell
back to the account row, which is why the phone sometimes appeared and the
address never did.

## Changes

| File | Change |
|---|---|
| `backend/lib/order-address.ts` | **new** — one reader for every order surface: accepts object *and* JSON text, maps legacy snake_case keys onto the canonical shape, keeps `orderContact()` snapshot-over-account rule, never invents fields |
| `backend/routes/seller-orders.ts` | local string-only reader/`text()`/`orderContact()` deleted; imports the shared helper (re-exports `orderContact` for the fulfilment tests); both list and detail now use `normalizeAddressSnapshot` |
| `backend/routes/cart.ts` | same local reader deleted; customer order detail uses the shared normalizer |
| `apps/velshop/src/pages/ShopDetail.tsx` | V badge element + import removed |
| `apps/velshop/src/pages/ShopProductDetail.tsx` | three badge overlays + import removed |
| `apps/velseller/src/pages/MyShop.tsx` | decorative "V" glyph replaced with a neutral ShieldCheck icon; `VerificationStatusLabel` (business status text) kept |
| `backend/tests/order-address-snapshot.test.ts` | new — 13 tests |
| `backend/tests/verification-badge-visual.test.ts` | new — 8 tests |

Not changed: `sellers.verification_status`, approval gates, `requireApprovedSeller`,
verification review endpoints, `isProductVerified` business helper. The shared
`VBadge` module stays for the velcenter admin review screens.

## Verification (real output, this file state)

```
bun --filter @velnox/backend typecheck                  → exit 0
bun test ./backend/tests/order-address-snapshot.test.ts → 13 pass / 0 fail
bun test ./backend/tests/order-fulfillment-state-machine.test.ts → 24 pass / 5 skip / 0 fail
bun test ./backend/tests/verification-badge-visual.test.ts → 8 pass / 0 fail
bun run i18n:check                                      → exit 0 (th=en=my=1602)
bun run typecheck (4 apps)                              → exit 0 (velshop, velseller, velcenter, velnox)
bun run build:velseller                                 → exit 0
bun run build:velshop                                   → exit 0
git diff --check                                        → clean
```

Pre-existing, unrelated: 8 failures in `test-database-guard` (Android
`process.execPath` is the linker, not bun) — documented in
`.ai/automation-reports/daily-health-report.md`.

## Remaining limitations

- Shipping engine, carrier adapters, quote snapshots, return-rate analytics,
  income breakdown and the My Shop / Orders / Profile page redesigns are **not
  implemented** — see `plan-seller-remaining.md`. They require schema work and a
  disposable `TEST_DATABASE_URL` for their DB-gated tests.
- `GoalFormDialog` / `ProgressDialog` still hold Thai literals.
- Verification badge copy (`verification.vInfo*`) is now unreferenced by seller
  and shop UI; cleanup belongs to P1-F follow-up once velcenter stops using it.
