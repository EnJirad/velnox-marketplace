# Velnox AI Handoff

**Last updated:** 2026-09-14
**Branch:** `main`
**Commit:** `348562c` — feat(categories): production category system — full audit + admin API + VelCenter management

## Current Project State

Velnox Marketplace — 4 Vercel frontends (velshop, velseller, velcenter, velnox) + Render backend (Express + WebSocket) + Neon PostgreSQL + Cloudflare R2. Auth: Google OAuth + JWT `velnox_session`.

All P0/P1 closed; safe for MVP deploy. i18n th/en/my (1161+ keys, parity checked). Design v2.0 (`VELNOX_DESIGN_THEME.md`).

## Active Work

**AI Context Architecture V2 migration** (this task) — restructuring `AGENTS.md` / `AI_RULES.md` / `docs/ai/*` into progressive-loading context. No app behavior changes intended.

## Recently Completed

- **2026-09-14 — Production category system** (`348562c`): fixed 4 `c.id::text = p.category_id` to `c.slug` JOIN bugs, 5 admin category routes (`POST/PATCH/DELETE/GET` under `/api/admin/categories`, owner/admin), `prevent_circular_category_parent()` trigger, VelCenter `CategoriesManagement` tab, hierarchical tree in `ProductFormDialog` via `/api/categories/tree`. Typecheck PASS all 5 targets.
- **2026-09-14 — Fresh DB bootstrap + Master Categories** (`6b26e13`): `db/schema.sql` and `db/run-sqleditor.sql` rebuilt byte-identical, dependency-ordered, 96 master categories (15 roots + 81 children) idempotent via `ON CONFLICT (slug)`.
- Prior: seller 4-step onboarding + store profile + shop media, verification/evidence E2E (presign to R2 PUT to `POST /api/seller/evidence/confirm` to `GET /api/seller/evidence`), product lifecycle moderation, VelCenter verification queues.

## Known Issues

- Live Neon fresh-DB and live browser E2E not performed in sandbox (no `DATABASE_URL`/headless browser); verified via static analysis + typecheck.
- `PRODUCT_CATEGORY_META` fallback labels remain in `packages/shared/src/lib/commerce.ts` for display compat.

## Important Decisions

- `products.category_id TEXT` stores **slug**, not UUID FK (migrations 015/029) — joins must use `c.slug = p.category_id`.
- Categories are platform-owned; sellers read/select active only; admin mutations are `owner`/`admin` server-enforced.
- `db/run-update.sql` is **deprecated** — never recreate/use; canonical files are `db/schema.sql` + `db/run-sqleditor.sql` (must stay synchronized).
- Progressive loading: `AGENTS.md` to `AI_RULES.md` (if code change) to `docs/ai/PROJECT_MAP.md` to relevant `docs/ai/<SUBSYSTEM>.md` to source. History in `docs/ai/history/` is reference only.

## Things That Must Not Break

Auth (OAuth/JWT/cookies/CORS), ownership checks, seller approval states (`pending|approved|rejected|suspended`), `Neon -> API -> frontend` truth chain, R2 presign flow, variant/option identity by ID, category slug contract, DB sync invariant.

## Recommended Next Steps

- Category image upload + drag reorder + localization editing in VelCenter (still TODO).
- Remove hardcoded `PRODUCT_CATEGORY_META` once all display paths use API data.
- No mandatory DB or auth changes pending.

## References

- Context map: `docs/ai/README.md` · Project map: `docs/ai/PROJECT_MAP.md` · Rules: `AI_RULES.md`
- History archive: `docs/ai/history/archive/AI_Handoff-2026-09-14.md`
