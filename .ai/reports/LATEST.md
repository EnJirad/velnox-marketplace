# AI Report — Part 1.1: Shop completion, QA and contract alignment

**Date:** 2026-11-04 · **Branch:** `main` · **Classification:** T2 (no schema change)
**Starting SHA:** `cdbad7ad322c9e10b78478a0613ad07034fe00e1`
**Status:** COMPLETE except browser/visual QA (BLOCKED — see §6)

## 1. Headline finding

The shop application could never succeed. `POST /api/seller/apply` requires
`firstName`, `lastName`, `phone`, `shopName` **and** exactly three identity
document purposes (`id_card`, `id_card_back`, `selfie_id` — `backend/routes/seller.ts:40,121-137`), but the
Phase-1 form sent only the shop fields. Every submission returned 400. This
release aligns the form with the endpoint instead of weakening the endpoint.

## 2. What was completed

| Area | Before | Now |
|---|---|---|
| Application | 4 fields, guaranteed 400 | 2-step wizard: shop (name, slug, description, category, phone, address) → identity (first/last name, phone, 3 documents) |
| Shop edit | name, description, phone | + category, structured address (line 1, subdistrict, district, province, postal code, validated 5 digits) |
| Logo / cover | no UI (backend existed) | upload, replace, remove via `POST /api/upload/presign` (`shop-logo`/`shop-cover`) → R2 PUT → `POST /api/upload/confirm` |
| Verification | 2 documents, 1 required | same three purposes as the application; submit needs all three |
| Failed saves | dialog state discarded | dialog stays open with typed values; media upload failure keeps the previous URL |
| Contrast | `#10B981` / `slate-400` on white ≈ 2.5:1 | hints/labels on `slate-500` and `#047857` |

## 3. Files changed

- `apps/velseller/src/components/shop/ShopOnboarding.tsx` — application wizard
- `apps/velseller/src/components/shop/ShopIdentityCard.tsx` — category, address, media
- `apps/velseller/src/components/shop/ShopMediaField.tsx` — **new**, R2 logo/cover
- `apps/velseller/src/components/shop/ShopVerificationDialog.tsx` — three documents
- `apps/velseller/src/pages/MyShop.tsx` — contrast + wiring only
- `packages/shared/src/lib/api-routes.ts` — `uploadPresign`, `uploadConfirm`, wider `updateShop` args
- `packages/shared/src/lib/commerce.ts` — `StoreShop` gains `logo`, `cover`, `category`, `rating`, `productCount`, typed address
- `packages/shared/src/lib/i18n/locales/index.ts` — 31 keys × 3 locales (1681 total)
- `backend/tests/seller-shop-surface.test.ts` — **new**, 11 source contracts
- `backend/tests/test-database-isolation.test.ts` — probe binary + loader env

## 4. API and database

**No schema change, no migration, no new endpoint.** Every call existed already:
`POST /api/seller/apply`, `PATCH /api/seller/shop`, `POST /api/upload/presign`,
`POST /api/upload/confirm`, `POST /api/seller/verification`,
`GET /api/seller/profile`.

Ownership: `PATCH /api/seller/shop` resolves the shop from `sellers.user_id`
(client sends no id); presign proves `shops JOIN sellers WHERE s.user_id = $1`
before minting `shop/{shopId}/logo.webp`; confirm re-derives the purpose from the
key, re-checks ownership and inspects the stored object.

## 5. Tests actually executed

| Command | Result |
|---|---|
| `bun run typecheck` (4 apps) | exit 0 |
| `bun run i18n:check` | exit 0 — `th=1681 en=1681 my=1681` |
| `bun run build:velseller` | exit 0 — `✓ built in 11.39s` |
| `bun test backend/tests` | **1243 pass / 389 skip / 0 fail** |
| `bun test backend/tests/seller-shop-surface.test.ts` | 11 pass |
| `bun test backend/tests/test-database-isolation.test.ts` | 39 pass |
| `git diff --check` | exit 0 |

Skips are DB-gated suites without `TEST_DATABASE_URL`.

## 6. Browser and responsive QA — BLOCKED

`http://127.0.0.1:5184/seller/shop` → `302 /auth?returnTo=%2Fseller%2Fshop`.
No seller session exists: login is Google OAuth against the production backend
and the only database available is production, which agents must never write.
Console: zero errors on the auth route.

**Not verified by a rendered page:** authenticated load, edit, upload, refresh
persistence, and the 360 / 390 / 768 / 1024 / 1440 breakpoints. No screenshots
exist for this change and none are claimed.

Static evidence only: single column → `sm:grid-cols-2` → `md:` table/card switch,
`min-h-11`/`size-11` on every control, dialogs clamped to `max-h-[90vh]` with
internal scroll, `overflow-x-auto` on the filter row.

## 7. Impeccable skill — usage and review evidence

- Skill loaded and followed; **its `context` launcher cannot run here**:
  `impeccable context` → `has unexpected e_type: 2` (arm64 launcher unavailable).
  Reported as a blocker instead of silently substituting an unreviewed design.
- Directed reading instead: `VELNOX_DESIGN_THEME.md` (white surfaces, slate text,
  `#10B981` accent, dark primary), `references/craft-floor.md`.
- Applied from the craft floor: contrast on real tokens (two failures found and
  fixed), one authored states model (loading skeleton → error+retry → empty →
  content), no decorative gradients beyond the existing brand band, 44px targets,
  focus-visible rings, `aria-current="step"` on the wizard, `role="alert"` on
  validation messages, no emoji-as-icon.
- Banned patterns avoided: no gradient text, no coloured left-border cards, no
  hard offset shadows, no section numbers as decoration.

## 8. The eight previous backend failures — classified

**ENVIRONMENT (two layers), not a regression.** Reproduced first, then fixed in
the test helper only:

1. `process.execPath` = `/apex/com.android.runtime/bin/linker64`; the probe spawned
   the dynamic linker instead of Bun (`process.argv0` is the real binary).
2. The probe env was stripped to `PATH/HOME/NODE_ENV`, so Bun aborted with
   `CANNOT LINK EXECUTABLE … library "libicui18n.so.78" not found`.

`runBunProbe` now prefers `argv0` and forwards `LD_LIBRARY_PATH`, `PREFIX`,
`TMPDIR` (paths, not credentials; DB URLs still come only from `databaseEnv`).
Result: 8 fail → **0 fail**, and the production-DB refusal guard now really runs
instead of failing for the wrong reason. No assertion was relaxed.

## 9. Remaining blockers and limits

1. Browser/responsive verification needs an owner-authenticated seller session.
2. Shop `category` is free text (≤100 chars) because `shops.category` has no
   taxonomy table; a select needs an owner-approved vocabulary first.
3. Address country is fixed to `TH`; no multi-country rule exists.
4. Logo/cover removal writes `NULL` through `PATCH /api/seller/shop`; the R2
   object is left in place (no delete endpoint) — documented, not silently hidden.
5. Part 2 not started.

## 10. AI 02 verdict

**BLOCKED — no independent review.** Four delegations this session, all failed
before producing output: one `context_length_exceeded` (272000) and three
`Subagent failed: Tenixe-Api is outside this chat's allowed fallback routes`.
Planning, implementation and review are AI 01's own and are **not** independent QA.

## 11. Commits

- `ed74ae47431027d56f56028b5d794a52f8670235` — feature + tests
- this report — documentation commit immediately after
