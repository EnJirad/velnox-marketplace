# AI_RULES.md — Velnox Marketplace Core Rulebook

> **For AI agents.** Authority: `AGENTS.md` → this file → `docs/ai/PROJECT_MAP.md` → `docs/ai/<SUBSYSTEM>.md` → actual source code. When docs conflict with source, source wins — then update the docs.

---

## 1. Non-Negotiable Rules

1. **Repo is truth.** Inspect current repo/source before editing. Stale memory, handoff, or conversation is never proof the code still exists.
2. **Inspect before mutate.** Verify files, routes, tables, and dependencies exist before changing them.
3. **Minimal correct change.** Fix root causes, preserve unrelated behavior, reuse existing systems. No rewrites without a clear requirement.
4. **No guessing.** If uncertain, search the repo (symbol → files → imports → relevant sections) before reading everything.
5. **Verify before claiming done.** Never report PASS without running the check. Follow `docs/ai/TESTING.md`.

## 2. Scope Control

- Default scope is exactly what was asked. Do not refactor unrelated code, rename broadly, or change architecture as a side effect.
- If a larger change is truly required, explain why before expanding scope.
- Prefer editing existing files over creating duplicates.

## 3. Architecture Preservation

- Structure: `apps/velshop|velseller|velcenter|velnox` (Vercel), `backend` (Render Express + WebSocket), `packages/shared` (single shared package), `db/` (Neon).
- Do not replace Neon, R2, Express, auth, build, or deployment architecture without explicit owner instruction.
- Frontend never connects to Neon, never holds `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, or `R2_SECRET_ACCESS_KEY`.

Further detail: `docs/ai/ARCHITECTURE.md` and `docs/ai/PROJECT_MAP.md`.

## 4. Security

Maintain and never weaken:

- **Auth:** Google OAuth with state validation, JWT in `httpOnly` + `Secure` (prod) + `SameSite` cookie, DB-backed revocation (`revoked_tokens`).
- **Authz:** Backend enforces ownership, seller approval (`pending|approved|rejected|suspended`), and admin/owner roles. Frontend checks are UX only.
- **Transport:** CORS via `CORS_ORIGINS`, Helmet headers, `sslmode=verify-full` for Neon.
- **Input:** Validate on the backend (Zod where present), parameterized queries only, no SQL concatenation.
- **Secrets:** Never put server secrets in `VITE_*` frontend env or in git. See `docs/ai/AUTH.md` and `docs/SECURITY.md`.

Never trust `userId/sellerId/shopId/orderId/productId` from the client without server verification.

## 5. Data Ownership & Source of Truth

```
Neon PostgreSQL = source of truth for commerce/financial/critical data
R2              = binary storage (images, documents); Neon stores metadata/URLs
WebSocket       = delivery only; never permanent state
Convex          = not in current architecture
```

Do not create a second competing source of truth. Frontend is never the source of truth. See `docs/ai/ARCHITECTURE.md`.

## 6. Database Rules

- **Canonical files:** `db/schema.sql` = complete current schema snapshot. `db/run-sqleditor.sql` = complete idempotent fresh-database bootstrap. They MUST stay byte-identical in structure.
- **Deprecated:** `db/run-update.sql` is deprecated — never recreate, update, or depend on it.
- **Whenever schema changes**, update **both** canonical files (tables, columns, types, constraints, indexes, functions, triggers, views). No SQL comments inside them.
- **Fresh DB contract:** an empty Postgres must become the complete current Velnox DB by running `db/run-sqleditor.sql` once — no prior migrations required.
- **Dependency order:** respect PG dependency order; use deferred `ALTER TABLE ADD CONSTRAINT` for circular FKs. Histor
  migrations in `db/migrations/` remain history — do not rewrite them to clean the bootstrap.

Full rules: `docs/ai/DATABASE.md`.

## 7. API Rules

- `/api/*` returns JSON only, correct HTTP status codes, validated auth/authz/ownership, and consistent error shapes. No HTML, no silent redirects.
- Do not create duplicate endpoints when a canonical one exists. Reuse `packages/shared/src/lib/api-routes.ts` and `backend/routes/`.

See `docs/ai/ARCHITECTURE.md` and `docs/API.md`.

## 8. Frontend Rules

- Follow `VELNOX_DESIGN_THEME.md` (summarized in `docs/ai/DESIGN.md`). Reuse `packages/shared/src/components/ui/` and shared hooks/libs. No ad-hoc design tokens.
- Every UI change considers mobile + desktop + i18n (`th/en/my`). No raw translation keys in rendered UI.
- Shared imports via `@velnox/shared/*` Vite alias. See `docs/ai/DESIGN.md`.

## 9. Product / Category / Seller Boundaries

- **Products:** authoritative in Neon; respect variant/option architecture. See `docs/ai/PRODUCTS.md`.
- **Categories:** platform-owned taxonomy (`categories` table, slug is canonical app identifier, `products.category_id TEXT` stores slug), hierarchical via `parent_id`. Sellers read/select only; mutations are admin/owner-only. See `docs/ai/CATEGORIES.md`.
- **Seller vs customer vs admin:** preserve role boundaries; never expose admin mutations to sellers. See `docs/ai/SELLER.md`, `docs/ai/CUSTOMER.md`, `docs/ai/CHECKOUT.md`.

## 10. Media / Realtime

- **Media:** presign → PUT to R2 → confirm → persist `media` record → update reference. Fixed key `profile/avatar/{userId}.webp`. Never delete old object before new one is confirmed. See `docs/ai/MEDIA.md`.
- **Realtime:** WebSocket channels are delivery; Neon is truth. See `docs/ai/REALTIME.md`.

## 11. Change Hygiene — Prohibited

Never, unless explicitly requested:

- Create fake APIs, mock production data, or sample sellers/shops/products (master categories are allowed — they are platform config).
- Create duplicate DB tables, columns, or systems (`products_v2`, etc.).
- Use `DROP DATABASE/SCHEMA/TABLE` or `TRUNCATE` against production; reset prod to fix dev.
- Hallucinate schema, routes, or components.
- Weaken auth, CORS, cookies, or validation to make something pass.

## 12. Task Workflow (Progressive Loading)

```
Understand request → identify subsystem → AGENTS.md → AI_RULES.md (if code change)
→ PROJECT_MAP.md → docs/ai/<SUBSYSTEM>.md (only relevant ones)
→ search symbol → read smallest useful files → trace deps as needed
→ minimal change → verify (TESTING.md) → update AI_Handoff.md
```

Do NOT bulk-read the whole repo or every doc file. Expand context only when dependency tracing requires it.

## 13. Verification

Verify the relevant tier (see `docs/ai/TESTING.md`):

- Frontend: typecheck + build + affected page + responsive/i18n
- Backend: typecheck + affected API + auth/authz + error handling
- Database: SQL validity + fresh-bootstrap completeness (`db/schema.sql` ↔ `db/run-sqleditor.sql` sync) + dep order + app compatibility
- Always: `git diff --check`, no new type errors, no secrets committed

## 14. Git / Version Control

- `git status` → `git diff` → `git diff --check` before commit. Review for secrets, debug code, `db/run-update.sql` resurrection, or unsynced DB files.
- Commit with meaningful message, then `git push`, then verify `git status` is clean. Never `git push --force` without owner instruction.
- Resolve conflicts by understanding both sides; preserve newer functionality; do not blindly pick `ours/theirs`.

Detail: `docs/ai/WORKFLOW.md`.

## 15. Handoff & Documentation

- After significant work, update `AI_Handoff.md` (current state only, not history — see `docs/ai/history/README.md`) and, when needed, `docs/ai/<SUBSYSTEM>.md`, `INSTALLATION.md`, or this file.
- `AI_Handoff.md` is never more authoritative than source.
- Every completed task must be committed and pushed.

## 16. When Ambiguous

Prefer the smallest reasonable interpretation that preserves security and data. If ambiguity risks data loss, security, or breaking changes, stop and ask before proceeding.
