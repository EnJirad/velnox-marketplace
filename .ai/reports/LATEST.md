# AI Office Task Report — velseller-my-shop-part-1

**Timestamp:** 2026-11-04
**Classification:** T2 (UI feature, no schema/payment/auth change)
**Objective:** Part 1 of the seller roadmap — redesign and complete My Shop.
**Status:** COMPLETED (browser/responsive verification BLOCKED — see §7)
**Starting branch / SHA:** `main` @ `11360a6299cc608b68df3fdfae7bfe0b6496ac95`

## 1. Summary of changes

- `MyShop.tsx` (1139 → 809 lines) reduced to composition + data loading + product
  moderation. The three state branches (loading / failed / no shop / not approved)
  are explicit; previously a failed profile request was indistinguishable from
  "you have no shop" and fell through to the onboarding form.
- **Hardcoded Thai removed from the UI.** The onboarding form and the verification
  wizard were Thai-only (`grep -P "[\x{0E00}-\x{0E7F}]"` = 39 lines). All four
  seller-shop files now report **0** Thai characters; copy lives under
  `sellerDash.shop.*` in th / en / my.
- New `components/shop/ShopOnboarding.tsx` — open-shop form, inline validation,
  44px controls, i18n.
- New `components/shop/ShopIdentityCard.tsx` — storefront identity (banner, logo,
  name, description, slug, phone) with `View shop` (velshop `/shop/{slug}`) and
  the **first UI for `PATCH /api/seller/shop`**, previously an unused endpoint.
- New `components/shop/ShopVerificationDialog.tsx` — two-step wizard. The old
  step 1 collected first/last name, phone and address that **were never sent to
  any endpoint**; that PII collection is gone and the step is now a requirements
  checklist. Evidence upload/confirm/hydrate/submit behaviour is unchanged.
- Product list: loading skeleton, failure state with retry, distinct empty states
  ("no products" vs "no products with this filter"), server-shaped status filter
  chips, desktop table + mobile cards, 44px touch targets throughout.

## 2. Files changed

| File | Change |
|---|---|
| `apps/velseller/src/pages/MyShop.tsx` | rewritten (composition) |
| `apps/velseller/src/components/shop/ShopOnboarding.tsx` | new |
| `apps/velseller/src/components/shop/ShopIdentityCard.tsx` | new |
| `apps/velseller/src/components/shop/ShopVerificationDialog.tsx` | new |
| `packages/shared/src/lib/api-routes.ts` | `api.seller.updateShop` binding |
| `packages/shared/src/lib/i18n/locales/index.ts` | 48 keys × 3 locales (patch objects) |
| `backend/tests/verification-badge-visual.test.ts` | assertion widened to the split surface |

## 3. API and database changes

- **No backend change.** No schema change, no migration, no new endpoint.
- New client binding calls the existing `PATCH /api/seller/shop`, which resolves
  the shop from the session (`sellers.user_id`) — the client never sends a shop id.

## 4. Authorization and ownership

- Shop edit: backend ownership (`shops JOIN sellers WHERE s.user_id = $1`), 404 if
  no shop. Client sends only name/description/phone.
- Verification submit: unchanged endpoint; it rejects empty evidence and verifies
  every object key belongs to the caller (`media.uploaded_by`).
- Products: unchanged `GET/PATCH/DELETE /api/seller/products*`, shop-scoped.

## 5. Tests actually executed

| Command | Result |
|---|---|
| `bun run typecheck` (4 apps) | exit 0 |
| `bun run i18n:check` | exit 0 — `th=1650 en=1650 my=1650` |
| `bun run build:velseller` | exit 0 — `✓ built in 7.30s` |
| `bun test backend/tests` | 1224 pass / 389 skip / **8 fail** |
| `git diff --check` | exit 0 |

The 8 failures are the pre-existing `test-database-isolation` probes
(`process.execPath` = linker on Android), identical before and after this change.

Two static source-contract tests failed on the first run because the code they
assert on moved into `components/shop/*`:
`notification-flow` (expects `setVerifyTarget({ kind: "seller" })` in the page)
and `verification-badge-visual` (expects the seller-shop surface to render
`VerificationStatusLabel`, never a bare `V`). The notification assertion is now
satisfied by real code (the page owns `verifyTarget`); the badge assertion was
widened to the whole `pages/MyShop.tsx + components/shop/*` surface. Both are
green and the underlying invariants still hold.

## 6. Browser / responsive verification

**BLOCKED.** `/seller/shop` redirects to `/auth?returnTo=%2Fseller%2Fshop`; no
seller session and no test database are available in this environment, so the
authenticated dashboard cannot be rendered. The dev server did boot cleanly with
**zero console errors** on the auth route (shared i18n chunk loads).

Not verified by a rendered page: 360 / 390 / 430 / 768 / 1024 / 1280 / 1440
breakpoints. Layout is composed mobile-first (single column → `sm:grid-cols-3` →
`md:` table / card switch) and every control is ≥44px, but that is static
evidence, not a render.

## 7. Remaining limitations

1. Responsive/browser verification requires an owner-authenticated seller session.
2. `POST /api/seller/verification` requires ≥1 evidence file; the wizard enforces
   that client-side too, but the two required document *types*
   (`id_card`, `id_card_back`, `selfie_id`) are only enforced by
   `POST /api/seller/apply` — the verification submit accepts any single file.
   Aligning those two contracts is a backend decision, out of Part 1 scope.
3. Shop identity editing covers name / description / phone. Category, address,
   logo and cover are accepted by the endpoint but still have no UI.
4. Part 2 (Orders) not started, as instructed.

## 8. AI 02 status

**BLOCKED — three attempts this session**, none produced output:
`context_length_exceeded` (272000) on the first, then twice
`Subagent failed: Tenixe-Api is outside this chat's allowed fallback routes`.
All investigation, planning and review in this task were performed by AI 01 and
are **not** independent QA.

## 9. Final commit

- Feature commit: `d3d33fb2777e55b3b1165b0829c49a3f90b632bc`
  (`feat(velseller): split My Shop into identity, onboarding and verification`)
- This report and the handoff note are committed immediately after it; the branch
  tip is that documentation commit on `main`.
