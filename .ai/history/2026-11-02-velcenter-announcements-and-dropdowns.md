# 2026-11-02 — VelCenter-managed announcement banner + VelCenter dropdown fixes

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 10:30–11:40 +07 (03:30–04:40Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `89616b2eb08214bd962896c2e8e40e1419ae86e3` |
| 5 | Commit SHA after | see `git log -1` (handoff §147 repeats it) |
| 6 | Purpose | Let the owner publish the VelShop home announcements from VelCenter (text + optional image + link + order + visibility) and remove the long native `<select>` lists that opened outside the viewport in VelCenter |
| 7 | Inspected before changing | `db/schema.sql` (no announcement table; `platform_settings` exists), `backend/routes/admin.ts` (settings.manage), `backend/routes/upload.ts` (purpose allowlist, key ownership), `packages/shared/src/lib/api-routes.ts`, `Center.tsx` settings tab, five native `<select>` call sites, `AnnouncementCarousel`, `ShopHome` |
| 8 | Files touched | `backend/routes/announcements.ts` (new), `backend/server.ts`, `backend/routes/upload.ts`, `backend/tests/upload-security.test.ts`, `packages/shared/src/lib/api-routes.ts`, `apps/velcenter/src/components/AnnouncementSettings.tsx` (new), `apps/velcenter/src/components/{CategoriesManagement,AuditLogTab,ProductModerationQueue,SellerVerificationQueue}.tsx`, `apps/velcenter/src/pages/Center.tsx`, `apps/velshop/src/components/shop/AnnouncementCarousel.tsx`, `apps/velshop/src/pages/ShopHome.tsx`, three locale files, AI docs |
| 9 | Added | `GET /api/announcements`, `GET/PUT /api/admin/announcements`; upload purpose `announcement`; VelCenter editor card; carousel image column; i18n `announceAdmin.*` (17 keys) |
| 10 | Removed | Five native `<select>` controls in VelCenter (converted to the shared Radix Select) |
| 11 | What changed | Announcements are stored as a JSON array in `platform_settings` key `shop_announcements` (no schema change). VelCenter → Settings now shows a banner editor (title, short text, optional link, optional image upload to R2, visibility toggle, reorder). VelShop fetches them and renders them in the carousel, falling back to the honest platform facts when the list is empty |
| 12 | Why it changed | The owner asked to publish Velnox announcements (not products) from the dashboard with images, and reported VelCenter dropdowns that grew upward and could not be clicked |
| 13 | Systems affected | Backend (new read/write route, upload namespace), VelCenter settings UI, VelShop home carousel, shared Select/DropdownMenu defaults |
| 14 | Confirmed unaffected, how | No table/schema change, no auth/payment/order/cart/product logic touched; `git diff --stat` limited to the files above; all four apps typecheck; product catalog, filters, sort, pagination untouched |
| 15 | Checks run (real commands) | `bun run typecheck` · `bun run build:velshop` · `bun run build:velcenter` · `bunx tsc --noEmit -p backend/tsconfig.json` · `bun packages/shared/scripts/i18n-check.ts` · `timeout 200 bun test backend/tests` · `git diff --check` |
| 16 | Result of each check | typecheck 4/4 **PASS** · builds **PASS** (8.41 s / 7.10 s) · backend tsc **PASS** (no output) · i18n **PASS** (1339 ×3) · tests **1139 pass / 382 skip / 8 fail** (all eight are the known `test-database-isolation` subprocess probes; the upload-security allowlist test was updated for the new purpose and passes) · `diff --check` **PASS** |
| 17 | Problems found | The upload allowlist test asserted the old literal list and failed until updated; Radix `Select` needed a non-empty sentinel for the "no parent" option; nothing else broke |
| 18 | Limitations / not checked | **VelCenter editor and the new API were NOT verified at runtime** — the backend needs `DATABASE_URL`/R2 credentials and VelCenter needs an authorized account; the harness also failed to render authenticated pages. **Mobile/desktop renders of the new banner editor: NOT VERIFIED.** R2 upload path was reasoned through the existing presign/confirm contract but not executed |
| 19 | Work still open | Run the feature against a staging database with real credentials; confirm the announcement image upload end-to-end; screenshot the VelCenter editor at 390/1440 |
| 20 | Next agent must know | Announcements live in `platform_settings.shop_announcements` as a JSON array (`id, title, description, imageUrl, linkUrl, active, sortOrder`, max 10 × 240 chars). Public read is unauthenticated by design and never 500s; writes need `settings.manage`. Images must use `purpose: "announcement"` so the key lands in `announcements/{userId}/…` |

## Native `<select>` → shared Radix Select

VelCenter had five native selects (category parent tree, audit action/entity filters, moderation
status/sort, verification status). A native picker with a long list can open outside the viewport and
become unclickable — the reported bug. They now use the shared `Select`, which since §146 renders with
`position="popper"`, `collisionPadding=8`, `max-h: min(320px, available-height)` and internal scrolling,
flipping above the trigger when space is short.
