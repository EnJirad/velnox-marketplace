# AI_RULES.md — Velnox Marketplace

**Last updated: 2026-09-02**

---

## 1. Mandatory Reading

Before ANY task, read:

- `AI_RULES.md` (this file)
- `AI_Handoff.md` (current state)
- `INSTALLATION.md` (setup/dev/deploy)
- `VELNOX_DESIGN_THEME.md` (UI/UX)
- `db/schema.sql` and `db/run-sqleditor.sql` (when touching DB)

Then inspect the actual source code. Never guess.

---

## 2. Core Rules

- **Inspect before modifying** — read the file, understand the code, then change it
- **Fix root cause** — not symptoms, not workarounds
- **Never invent** — no fake data, no mock APIs, no hallucinated database schemas
- **Never create duplicate systems** — reuse existing tables, routes, components
- **Preserve existing architecture** — don't rewrite working systems
- **Don't weaken security** — keep auth, authz, ownership checks, CORS, cookie settings
- **Don't remove working functionality** — unless explicitly told to

---

## 3. Database Rules

Source of truth: **Neon PostgreSQL**. Frontend NEVER connects directly.

### Schema Files (all three must stay in sync)

| File | Purpose |
|------|---------|
| `db/schema.sql` | Complete schema reference |
| `db/run-sqleditor.sql` | Full bootstrap for new databases |
| `db/run-update.sql` | Append-only migration history |

Every database change requires ALL THREE files to be updated.

### Database Change = ANY of:

New table/column/index/constraint/enum/function/trigger, changed column type, data migration, or any Neon PostgreSQL structural change.

### Never:

- `DROP DATABASE`, `TRUNCATE`, or reset production data (unless explicitly approved)
- Hand-edit `db/run-update.sql` history — only append new migrations
- Run startup DDL (`ALTER TABLE` in server boot) — use the migration system

### Migration System

- `db/migrations/*.sql` — individual files
- `.github/workflows/migrate-neon.yml` — auto-applies on push to main
- `schema_migrations` table — tracks applied migrations
- New migration: create file → update all 3 SQL files → verify sync

---

## 4. Security Rules

Always maintain:

- HTTP-only cookies, Secure, SameSite for sessions
- Google OAuth state validation
- Server-side ownership checks (never trust frontend userId/shopId/sellerId)
- Seller approval checks before product operations
- VelCenter admin authorization
- CORS via `CORS_ORIGINS` env var
- JWT signature verification

Never expose in frontend code or `VITE_*` variables:

- `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_SECRET`
- `R2_SECRET_ACCESS_KEY`, `BOOTSTRAP_OWNER_SECRET`
- Any server-side secret or token

---

## 5. API Rules

- Return predictable JSON with correct HTTP status codes
- Never return HTML from API endpoints (`/api/*`)
- Validate input, enforce authorization server-side
- Never redirect from API requests without reason
- One canonical seller status set (`pending`, `approved`, `rejected`, `suspended`)

---

## 6. Performance Rules

Before fixing performance:

1. **Measure** — add timing logs, identify slow queries
2. **Identify bottleneck** — cold start, N+1, missing index, redundant query
3. **Fix root cause** — parallelize independent queries, remove waste
4. **Verify improvement** — confirm with timing logs

Never blindly add indexes, cache everything, or rewrite unrelated systems.

---

## 7. Frontend Rules

- Use existing shadcn/ui components from `packages/shared/src/components/ui/`
- Follow `VELNOX_DESIGN_THEME.md` for all UI work
- Don't introduce random colors or break the Velnox design language
- Don't replace working UI without explicit requirement
- Prefer editing existing files over creating new ones

---

## 8. Architecture Rules

```
apps/velshop/       → Customer marketplace
apps/velseller/     → Seller management
apps/velcenter/     → Admin management
apps/velnox/        → Corporate website
backend/            → Express API server
packages/shared/    → ALL shared code
db/                 → Schema, migrations, SQL
```

Key invariants:

1. Neon PostgreSQL = only source of truth
2. Frontend NEVER connects to database directly
3. Frontend NEVER contains server secrets
4. User identity resolution prevents duplicate accounts
5. R2 stores binaries, Neon stores metadata
6. Backend is the only server-side gateway

---

## 9. Documentation Rules

When architecture, database, API, or workflow changes:

- Update `AI_Handoff.md` (always)
- Update `INSTALLATION.md` (if install/deploy changes)
- Update `db/schema.sql`, `db/run-sqleditor.sql`, `db/run-update.sql` (if DB changes)

---

## 10. File Upload Rules (R2)

- Profile images: fixed key strategy (`profile/avatar/{userId}.webp`)
- Upload flow: presign → PUT to R2 → confirm → save media record → update user
- Replace old image on new upload, delete old from R2 after successful replace
- Convert to WebP before upload

---

## 11. GIT RULE — MANDATORY

**EVERY completed task MUST be committed and pushed.**

After work is done and verified:

```
git status
git diff
git diff --check
git add .
git commit -m "<meaningful message>"
git push
git status   # verify clean tree
```

### Commit Message Format

```
feat: add seller verification
fix: repair google authentication
fix(db): update seller status constraint
feat(db): add seller documents
chore: update project documentation
refactor: improve address service
docs: update AI handoff
```

**NEVER** use meaningless messages like `update`, `test`, `aaa`, `fix stuff`.

**NEVER** finish without push. If `git push` fails, the task is NOT complete.

**NEVER** force push (`git push --force`, `git push -f`) unless explicitly instructed.

---

## 12. Final Verification Checklist

Before declaring ANY task complete:

- [ ] Code implemented correctly
- [ ] Existing functionality preserved
- [ ] UI follows design theme (if UI changed)
- [ ] Backend queries checked (if DB changed)
- [ ] Authentication verified (if auth changed)
- [ ] TypeScript typecheck passes
- [ ] No new TypeScript errors introduced
- [ ] `AI_Handoff.md` updated
- [ ] `AI_RULES.md` updated (if new permanent rule)
- [ ] `db/run-update.sql` updated (if DB changed)
- [ ] `db/run-sqleditor.sql` updated (if DB changed)
- [ ] `db/schema.sql` updated (if DB changed)
- [ ] `git status` reviewed
- [ ] `git diff` reviewed
- [ ] Commit created
- [ ] **Git push completed**
- [ ] Working tree clean

**Do NOT say "Done" until implementation, verification, and git push are complete.**

If something cannot be verified, state **NOT VERIFIED** — never claim it works.

---

## 13. Final Report Format

After every significant task:

```
## TASK RESULT

What changed: ...
Root cause: ...
Files changed: ...
Database changed: YES / NO

Typecheck: PASS / FAIL
Build: PASS / FAIL
Git commit: <hash>
Git push: SUCCESS / FAIL
Working tree: CLEAN / NOT CLEAN

Remaining issues: ...
```
