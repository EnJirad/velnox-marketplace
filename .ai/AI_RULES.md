# AI_RULES.md — Velnox Marketplace Core Rulebook

> **For AI agents.** Canonical location: `.ai/AI_RULES.md`. Authority: `AGENTS.md` → this file → `.ai/context/project-map.md` → `.ai/context/<subsystem>.md` → actual source code. When docs conflict with source, source wins — then update the docs.
>
> The agent workspace, startup protocol, and context-loading policy are defined in `.ai/README.md`.

---

## 0. Startup Synchronization — GitHub Remote Is the Source of Truth

> **The AI sandbox / local checkout is temporary and may be stale. The GitHub
> remote is authoritative.** Files already existing locally is not proof they are
> current, and not proof the same commit exists remotely.

Before **any** repository-changing task, establish the real remote state:

```bash
git remote -v
git fetch origin
git status
git branch --show-current
git rev-parse HEAD                     # local SHA
git rev-parse origin/<current-branch>  # remote SHA — authoritative
```

Compare, and name which case holds:

| Case | Condition | Action |
|---|---|---|
| in sync | local SHA == remote SHA | proceed |
| behind | `git log HEAD..origin/<branch>` is non-empty | synchronize **before** editing (`git pull --ff-only`) |
| ahead | `git log origin/<branch>..HEAD` is non-empty | proceed; push per §14 |
| diverged | both are non-empty | **STOP** |

```
GitHub remote  →  AUTHORITATIVE SOURCE OF TRUTH
AI sandbox     →  TEMPORARY WORKSPACE
```

- **Behind** → synchronize with the latest remote state before reading or editing.
- **Diverged** → **STOP**: inspect the divergence
  (`git log --oneline --left-right HEAD...origin/<branch>`). Do **not** force-push,
  do **not** automatically discard local work, do **not** overwrite remote history.
- Confirm the latest remote commit SHA before beginning implementation work.
- If `git fetch` cannot run, report that blocker. Never treat the sandbox as the
  source of truth merely because the files already exist there.

---

## 1. Non-Negotiable Rules

1. **Repo is truth.** Inspect current repo/source before editing. Stale memory, handoff, or conversation is never proof the code still exists.
2. **Inspect before mutate.** Verify files, routes, tables, and dependencies exist before changing them.
3. **Minimal correct change.** Fix root causes, preserve unrelated behavior, reuse existing systems. No rewrites without a clear requirement.
4. **No guessing.** If uncertain, search the repo (symbol → files → imports → relevant sections) before reading everything.
5. **Verify before claiming done.** Never report PASS without running the check. Follow `.ai/context/testing.md`.

## 2. Scope Control

- Default scope is exactly what was asked. Do not refactor unrelated code, rename broadly, or change architecture as a side effect.
- If a larger change is truly required, explain why before expanding scope.
- Prefer editing existing files over creating duplicates.

## 3. Architecture Preservation

- Structure: `apps/velshop|velseller|velcenter|velnox` (Vercel), `backend` (Render Express + WebSocket), `packages/shared` (single shared package), `db/` (Neon).
- Do not replace Neon, R2, Express, auth, build, or deployment architecture without explicit owner instruction.
- Frontend never connects to Neon, never holds `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`, or `R2_SECRET_ACCESS_KEY`.

Further detail: `.ai/context/architecture.md` and `.ai/context/project-map.md`.

## 4. Security

Maintain and never weaken:

- **Auth:** Google OAuth with state validation, JWT in `httpOnly` + `Secure` (prod) + `SameSite` cookie, DB-backed revocation (`revoked_tokens`).
- **Authz:** Backend enforces ownership, seller approval (`pending|approved|rejected|suspended`), and admin/owner roles. Frontend checks are UX only.
- **Transport:** CORS via `CORS_ORIGINS`, Helmet headers, `sslmode=verify-full` for Neon.
- **Input:** Validate on the backend (Zod where present), parameterized queries only, no SQL concatenation.
- **Secrets:** Never put server secrets in `VITE_*` frontend env or in git. See `.ai/context/security.md` and `docs/SECURITY.md`.

Never trust `userId/sellerId/shopId/orderId/productId` from the client without server verification.

## 5. Data Ownership & Source of Truth

```
Neon PostgreSQL = source of truth for commerce/financial/critical data
R2              = binary storage (images, documents); Neon stores metadata/URLs
WebSocket       = delivery only; never permanent state
Convex          = not in current architecture
```

Do not create a second competing source of truth. Frontend is never the source of truth. See `.ai/context/architecture.md`.

## 6. Database Rules

- **Canonical files:** `db/schema.sql` = complete current schema snapshot. `db/run-sqleditor.sql` = complete idempotent fresh-database bootstrap. They MUST stay byte-identical in structure.
- **Deprecated:** `db/run-update.sql` is deprecated — never recreate, update, or depend on it.
- **Whenever schema changes**, update **both** canonical files (tables, columns, types, constraints, indexes, functions, triggers, views). No SQL comments inside them.
- **Fresh DB contract:** an empty Postgres must become the complete current Velnox DB by running `db/run-sqleditor.sql` once — no prior migrations required.
- **Dependency order:** respect PG dependency order; use deferred `ALTER TABLE ADD CONSTRAINT` for circular FKs. Histor
  migrations in `db/migrations/` remain history — do not rewrite them to clean the bootstrap.

Full rules: `.ai/context/database.md`.

## 7. API Rules

- `/api/*` returns JSON only, correct HTTP status codes, validated auth/authz/ownership, and consistent error shapes. No HTML, no silent redirects.
- Do not create duplicate endpoints when a canonical one exists. Reuse `packages/shared/src/lib/api-routes.ts` and `backend/routes/`.

See `.ai/context/architecture.md` and `docs/API.md`.

## 8. Frontend Rules

- Follow `VELNOX_DESIGN_THEME.md` (summarized in `.ai/context/frontend.md`). Reuse `packages/shared/src/components/ui/` and shared hooks/libs. No ad-hoc design tokens.
- Every UI change considers mobile + desktop + i18n (`th/en/my`). No raw translation keys in rendered UI.
- Shared imports via `@velnox/shared/*` Vite alias. See `.ai/context/frontend.md`.

## 9. Product / Category / Seller Boundaries

- **Products:** authoritative in Neon; respect variant/option architecture. See `.ai/context/products.md`.
- **Categories:** platform-owned taxonomy (`categories` table, slug is canonical app identifier, `products.category_id TEXT` stores slug), hierarchical via `parent_id`. Sellers read/select only; mutations are admin/owner-only. See `.ai/context/categories.md`.
- **Seller vs customer vs admin:** preserve role boundaries; never expose admin mutations to sellers. See `.ai/context/seller.md`, `.ai/context/customer.md`, `.ai/context/checkout.md`.

## 10. Media / Realtime

- **Media:** presign → PUT to R2 → confirm → persist `media` record → update reference. Fixed key `profile/avatar/{userId}.webp`. Never delete old object before new one is confirmed. See `.ai/context/media.md`.
- **Realtime:** WebSocket channels are delivery; Neon is truth. See `.ai/context/realtime.md`.

## 11. Change Hygiene — Prohibited

Never, unless explicitly requested:

- Create fake APIs, mock production data, or sample sellers/shops/products (master categories are allowed — they are platform config).
- Create duplicate DB tables, columns, or systems (`products_v2`, etc.).
- Use `DROP DATABASE/SCHEMA/TABLE` or `TRUNCATE` against production; reset prod to fix dev.
- Hallucinate schema, routes, or components.
- Weaken auth, CORS, cookies, or validation to make something pass.

## 12. Task Workflow (Progressive Loading)

```
Understand request → identify subsystem → AGENTS.md → .ai/AI_RULES.md (if code change)
→ .ai/README.md (startup + context policy, if the task brief is missing)
→ .ai/context/project-map.md → .ai/context/<subsystem>.md (only relevant ones)
→ search symbol → read smallest useful files → trace deps as needed
→ minimal change → verify (.ai/context/testing.md) → update .ai/AI_HANDOFF.md
```

Do NOT bulk-read the whole repo or every doc file. Expand context only when dependency tracing requires it.

## 13. Verification

Verify the relevant tier (see `.ai/context/testing.md`):

- Frontend: typecheck + build + affected page + responsive/i18n
- Backend: typecheck + affected API + auth/authz + error handling
- Database: SQL validity + fresh-bootstrap completeness (`db/schema.sql` ↔ `db/run-sqleditor.sql` sync) + dep order + app compatibility
- Always: `git diff --check`, no new type errors, no secrets committed

## 14. Git / Version Control — Automatic Commit and Push

**This rule is mandatory for every repository-changing task unless the user explicitly says otherwise.**

### Normal completion flow

1. `git status` + `git diff` + `git diff --check` — review staged/unstaged changes; confirm no secrets, no `db/run-update.sql` resurrection, no unsynced DB files, no unrelated changes.
2. Validate the affected subsystem (typecheck, tests, build, lint as appropriate).
3. Stage only files belonging to the current task. Prefer `git add <files>` over `git add .`.
4. `git commit -m "<conventional-style message>"` — meaning only what was changed and why.
5. `git push origin <branch>` — the push happens immediately after commit, not after a separate user instruction.
6. Verify remote: `git fetch origin && git rev-parse HEAD && git rev-parse origin/<branch>` — SHAs must match. Report `PUSH VERIFIED` only after this check.
7. Update `.ai/AI_HANDOFF.md` if the task warrants it, then commit + push the handoff update if needed.
8. Final state: working tree clean, local HEAD == remote HEAD.

### When the agent must NOT commit/push

Skip commit/push and report the exact reason (`NOT PUSHED — <reason>`) when:
- The user explicitly says *do not commit* / *do not push* / *keep changes local*.
- The task is analysis-only with no repository changes.
- Required validation (typecheck, tests, `diff --check`) fails and the issue is unresolved.
- A serious security or data-loss risk is discovered.
- The branch is protected and the repository policy requires a PR.

### Push failures

If `git push` fails (authentication, non-fast-forward, protected branch):
1. Diagnose the exact Git error.
2. For authentication failure: report `NOT PUSHED — AUTHENTICATION UNAVAILABLE` with the exact error. Do not attempt GitHub REST API / Git Data API as a push mechanism.
3. For non-fast-forward: stop, inspect divergence, reconcile safely — never force-push without owner instruction.
4. Never hardcode, echo, or expose credentials.
5. Report `NOT PUSHED — <reason>` with exact repo state.

### Commit message style

Conventional-ish: `fix(velshop): …`, `feat(db): …`, `docs(ai): …`. No vague messages like `update`, `fix stuff`, `changes`.

**Detail:** `.ai/context/workflow.md`.

## 15. Handoff & Documentation

- After significant work, update `.ai/AI_HANDOFF.md` (current state + remaining gaps only — see `.ai/history/README.md`) and, when needed, `.ai/context/<subsystem>.md`, `INSTALLATION.md`, or this file.
- `.ai/AI_HANDOFF.md` **must stay small**: this environment's file-edit tools stop matching past roughly 55 KB, after which the file can no longer be edited in place. Do not grow it past ~40 KB — move superseded sections to `.ai/history/AI_Handoff_Archive.md` (dated index) and, when long, to `.ai/history/archive/`.
- `.ai/AI_HANDOFF.md` is never more authoritative than source.
- Every completed task must be committed, pushed, and verified (see §14).
- If the handoff update changes files after the code commit, commit the handoff change and push it too — do not leave the working tree dirty.

## 16. When Ambiguous

Prefer the smallest reasonable interpretation that preserves security and data. If ambiguity risks data loss, security, or breaking changes, stop and ask before proceeding.
