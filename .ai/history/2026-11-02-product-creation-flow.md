# 2026-11-02 — Product creation flow E2E validation via AI Office (§162)

**Branch:** `main` · **Baseline:** `8e1b415` · **Type:** test(velseller)+i18n+guard

## What was done

Real E2E validation of the velseller product creation flow through the two-agent
loop. Three QA rounds; the loop caught two genuine defects AI 01 did not know
about.

## Changes

1. **i18n** — ProductFormDialog (create/edit dialog + VariantManager) migrated
   from hard-coded Thai to a new additive `productForm` namespace (109 keys ×
   th/en/my, 1563×3 parity). Create-mode unit default localized. ฿ glyphs and
   formatting helpers untouched.
2. **Backend guard** — `create-full` now enforces MAX_VARIANTS=100 with a 400
   (the generate endpoint already capped; create-full bypassed it).
3. **AC-02** — explicit negative-stock validation client-side; server clamps
   kept as defense in depth.
4. **AC-08** — new `backend/tests/seller-product-ownership.test.ts`: 7 DB-gated
   HTTP probes over the real product + option routes (cross-seller 403/404,
   unauthenticated 401, list shop-scoping). Skips locally; executes in CI.

## QA loop evidence

- R1 PASS (2 low defects) → R2 **FAIL** (new test's seed missing `price` —
  would red-fail CI; invisible locally because DB-gated tests skip) → R3 PASS
  after seed fix + honest list-scoping comment.
- The R2 catch is the loop working exactly as designed: a defect invisible in
  the local environment, found by trace-reading the real handler gates.

## Verification

i18n 1563×3 · typecheck 4/4 + backend exit 0 · ownership probes 0 fail/7 skip
locally · full suite 1155/389 skip/8 fail (8 = pre-existing execPath baseline,
byte-identical) · both consumer builds exit 0 · diff --check clean.

## Limits

- R2 PUT to R2, real DB mutation matrix, browser E2E, EN/MY visual rendering:
  NOT VERIFIED in this harness (no TEST_DATABASE_URL, no browser DB/R2 stack,
  production Neon read-only per §17).
- CI must be observed green on test.yml for the 7 ownership probes' first live
  execution (push follow-up).
