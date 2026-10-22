# AI Handoff archive — Phase 3c staging readiness (2026-10-21)

Moved out of `.ai/AI_HANDOFF.md` on 2026-10-22 (edit-headroom housekeeping, made room for
§91). The phase is complete; its product-scope blocker was resolved by §89, and the runbook
it points at is `docs/MVP_STAGING.md`. Verbatim.

---

## §88. Phase 3c — STAGING READINESS (2026-10-21) — condensed

**Status: staging CONFIGURATION ready; staging NOT deployed; product scope BLOCKED on retail sets/packs.**
Baseline `9083127070d81c482ecfacb0604d330d0f79f07b` = `origin/main` = GitHub. Report:
[`tasks/active/mvp-clean-rewrite-phase3c-2026-10-21.md`](../../tasks/active/mvp-clean-rewrite-phase3c-2026-10-21.md)
· runbook: [`docs/MVP_STAGING.md`](../../../docs/MVP_STAGING.md).

**BLOCKING GAP — sets/packs are absent from the MVP** — **RESOLVED in §89 (Phase 3d).**
Kept for history: `db/mvp/schema.sql` had **zero**
`selling_unit`/`pieces` references; `backend/mvp` mentions the pre-MVP table only in a comment
forbidding it; no MVP client/UI field exists. The legacy schema, `backend/lib/inventory.ts`
(`quantity × selling_unit_pieces`) and the archived §76–77 record still have the feature. The MVP
therefore sells a product/variant at one price and cannot offer "Set 6 at ฿1,200" against base-unit
stock. **Do not sign off retail scope or cut over until Phase 3d restores it.** Nothing was deleted
to cause this; it was never carried into the clean schema.

**Shipped this pass:** the shared auth panel now hard-navigates after sign-in and shells reload after
sign-out (the MVP session is read once per mount — a client-side redirect left every guard and header
on the pre-login snapshot); `MVP_COOKIE_SECURE=true` in `backend/mvp/session.ts` (one-way: can only
ADD `Secure`, production always secure) so Chromium accepts `SameSite=None` over the E2E's HTTPS;
`db/mvp/browser-e2e.sh` + `scripts/mvp-browser-e2e.ts` (Playwright devDependency) build all three
apps in MVP mode, serve each over local HTTPS against the real API, and drive Chromium through the
whole flow; `docs/MVP_STAGING.md` carries the Render/Vercel/Neon matrix, verification order,
scheduling, blockers and rollback. CI needed nothing: `test.yml` already runs `db/mvp/verify.sh`,
`bun run test:mvp`, the legacy suite and `git diff --check`.

**Verified:** browser E2E **exit 0** (admin sign-in via UI · seller signup+apply · admin approve ·
draft+variant(10)+submit · admin approve · publish · buyer signup → catalogue → variant → cart →
checkout → **฿600.00 server total** → reservation 10→8 · cancel → 8→10 · admin expiry sweep →
Cancelled → 10 · seller order list) · MVP suite **90 pass / 0 fail** (12 files) · legacy **2166 /
16 skip / 0 fail** · typecheck **4/4** + backend tsc 0 · builds 4/4 (three in MVP mode) · i18n
`1535×3` · `git diff --check` clean. **NOT verified:** any provider deployment (no Render/Vercel/
Neon access here) and the Stripe TEST round trip (no `STRIPE_SECRET_KEY`; contract-only proof).
Image upload is still not MVP-compatible (legacy writes `media.key`, the MVP table is
`media.object_key`) — sellers paste URLs.

**Owner actions:** Neon DB from `db/mvp/schema.sql` → Render staging service with
`MVP_API_ENABLED=true`, staging `DATABASE_URL`/`JWT_SECRET`, `MVP_COOKIE_SECURE=true`, staging
origins → three Vercel projects with `VITE_API_MODE=mvp`, `VITE_DEPLOY_ENV=staging`,
`VITE_API_URL` → run the runbook's checklist (+ Stripe TEST if keys supplied). Production env,
database, Stripe mode and deployments were NOT touched.

**Next = Phase 3d** was retail sets/packs — **done, see §89.** After it, next is deploying the
staging stack (`docs/MVP_STAGING.md`) and running the browser + Stripe TEST passes on it.
