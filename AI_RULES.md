# AI_RULES.md — Velnox Marketplace

**MANDATORY READING BEFORE ANY TASK**

Before starting ANY task on this repository, the AI developer MUST:

1. Read this file (AI_RULES.md)
2. Read AI_Handoff.md (current project state)
3. Read VELNOX_DESIGN_THEME.md when working on UI/UX
4. Read db/schema.sql and db/run-sqleditor.sql when working with the database
5. Inspect the existing architecture and implementation before modifying code
6. Never guess database schemas, API contracts, or existing behavior

---

## 🔴 THE FOUR NON-NEGOTIABLE RULES

### RULE 1 — DATABASE
**"If you change the Neon database or any database table, you MUST update BOTH `db/schema.sql` AND `db/run-sqleditor.sql`."**

If these files are not updated after a database change:
**THE DATABASE TASK IS NOT COMPLETE.**

### RULE 2 — AI HANDOFF
**"If you complete significant work, you MUST update `AI_Handoff.md`."**

If AI_Handoff.md is not updated after significant work:
**THE TASK IS NOT COMPLETE.**

### RULE 3 — GIT
**"If you complete the task and verification passes, you MUST commit and push the changes to Git."**

If the completed work is not pushed:
**THE TASK IS NOT COMPLETE.**

### RULE 4 — DESIGN
**"If you modify the UI, you MUST follow `VELNOX_DESIGN_THEME.md`."**

UI work that ignores the design system is **NOT COMPLETE**.

---

## 📁 IMPORTANT PROJECT FILES

| File | Purpose |
|------|---------|
| `AI_RULES.md` | Mandatory development rules (this file) |
| `AI_Handoff.md` | Current project state, recent work, known issues, next tasks |
| `INSTALLATION.md` | Complete installation, configuration, development, deployment instructions |
| `VELNOX_DESIGN_THEME.md` | Velnox UI/UX and design system source of truth |
| `db/schema.sql` | Latest complete database schema (canonical reference) |
| `db/run-sqleditor.sql` | SQL bootstrap script (must be synchronized with schema.sql) |

---

## 🗄️ DATABASE RULES — CRITICAL

### When Database Changes Are Made

Whenever an AI creates, deletes, modifies, adds, removes, renames, or changes any database structure:

**STEP 1** — Inspect the current database structure (read `db/schema.sql` and `db/run-sqleditor.sql`). Do not assume.

**STEP 2** — Apply the database change correctly using the project's migration workflow.

**STEP 3** — Update `db/schema.sql` to represent the latest complete database structure.

**STEP 4** — Update `db/run-sqleditor.sql` to also represent the latest database structure.

**STEP 5** — Verify consistency: `schema.sql` and `run-sqleditor.sql` must represent the same intended structure.

**STEP 6** — Verify application compatibility: queries, API layer, and schema must be consistent.

### Database Source of Truth

`db/schema.sql` and `db/run-sqleditor.sql` are critical build artifacts. If Velnox enters production and we need to create a completely new Neon PostgreSQL database from scratch, these files must provide everything necessary to recreate the latest database structure.

They must contain or document all required:
- Tables, columns, primary keys, foreign keys
- Indexes, unique constraints, check constraints
- Enums, extensions, default values, relationships

### Database Change Checklist

After every database change:
- [ ] Database change implemented correctly
- [ ] `db/schema.sql` updated
- [ ] `db/run-sqleditor.sql` updated
- [ ] SQL syntax verified
- [ ] Tables, columns, indexes, constraints, foreign keys verified
- [ ] Application queries match the schema
- [ ] No unintended schema drift

If any item is incomplete: **THE DATABASE TASK IS NOT FINISHED.**

### Migration Rules

1. Every schema change → create migration file in `db/migrations/`
2. Update `db/schema.sql`
3. Update `db/run-sqleditor.sql`
4. NEVER use `DROP TABLE` or `TRUNCATE` in migrations
5. All migrations must be idempotent (`IF NOT EXISTS`)

---

## 📋 AI HANDOFF — MANDATORY

`AI_Handoff.md` MUST be updated after every significant task. Especially after:
- New features, architecture changes
- Database changes, API changes
- Authentication, storage, deployment changes
- Important bug fixes, performance fixes, security fixes

`AI_Handoff.md` must allow the next AI developer to immediately understand:
1. Current project status
2. What was recently completed and why
3. Which files were changed
4. Database/API/UI changes made
5. Issues remaining and next steps
6. How to test the latest feature
7. Important warnings or constraints

Do NOT destroy useful historical context. Maintain a concise recent history.

---

## 🔀 GIT RULES — MANDATORY

### Every completed task MUST be committed and pushed.

Before finishing a task:
1. `git status` — inspect changes
2. `git diff` — review all changes
3. Run relevant typecheck and build
4. Update required documentation
5. Commit with a descriptive message
6. Push the commit

### Commit Message Format

```
feat: add address management
fix: resolve address schema mismatch
fix: update profile image cache invalidation
chore: synchronize database schema documentation
docs: update AI handoff
refactor: improve address service
```

**NEVER** use meaningless messages like: `update`, `test`, `aaa`, `fix stuff`

### NEVER Force Push

Never use `git push --force` or `git push -f` unless explicitly requested by the user.

---

## 🌐 CENTRALIZED URL CONFIGURATION

Deployment-specific frontend URLs must NOT be hardcoded in source code.
All public frontend URLs are centralized in `packages/shared/src/lib/sites.ts` and read from `VITE_*` environment variables.

### Supported Environment Variables

| Variable | Purpose | Example |
|----------|---------|--------|
| `VITE_API_URL` | Backend API base URL | `https://velnx-api.onrender.com` |
| `VITE_SITE_BASENAME` | Sub-path basename for gateway deploys | `/center` or empty |
| `VITE_VELSHOP_URL` | VelShop full URL | `https://shop.velnox.com` |
| `VITE_VELSELLER_URL` | VelSeller full URL | `https://seller.velnx.com` |
| `VITE_VELCENTER_URL` | VelCenter full URL | `https://center.velnx.com` |
| `VITE_CORPORATE_URL` | Corporate site URL | `https://velnx.com` |

### Key Rules

1. **`VITE_*` variables are PUBLIC** — they are intentionally exposed to the browser by Vite.
2. **Never store secrets in `VITE_*` variables.**
3. Use `apiBaseUrl` from `@velnox/shared/lib/sites` for API requests — it automatically includes `/api`.
4. Use `apiUrl` from `@velnox/shared/lib/sites` for non-API backend endpoints (e.g., OAuth redirects).
5. **`VITE_API_URL` contains ONLY the backend origin** — never include `/api` here.
6. The `/api` prefix is appended ONCE by `apiBaseUrl` — never duplicate it in fetch calls.
7. Use `SITE_URLS` from `@velnox/shared/lib/sites` for cross-application navigation.
8. Use `joinUrl(base, path)` from `@velnox/shared/lib/sites` to safely join base URLs and paths.
9. If a domain changes: update the Vercel environment variable and redeploy. Do NOT modify source code.
10. In Vercel, set `VITE_*` as type **Config** (NOT Secret).

---

## 🏗️ ARCHITECTURE RULES

### Project Structure

```
velnox-marketplace/
├── apps/velshop/       # Customer marketplace (Vite + React)
├── apps/velseller/     # Seller management
├── apps/velcenter/     # Admin management
├── apps/velnox/        # Corporate website
├── backend/            # Express API server
│   ├── routes/         # API route handlers
│   ├── middleware/      # Auth, error handling
│   ├── db/             # PostgreSQL pool
│   └── realtime/       # WebSocket server
├── packages/shared/    # ALL shared code (components, hooks, lib, pages)
├── db/                 # Database schema, migrations, SQL
└── docs/               # Documentation
```

### Key Invariants

1. Neon PostgreSQL is the ONLY source of truth
2. Frontend NEVER connects directly to Neon
3. Frontend NEVER contains DATABASE_URL or server secrets
4. User identity resolution prevents duplicate accounts
5. WebSocket state is NOT permanent database state
6. R2 stores binaries, Neon stores metadata
7. All four frontend apps must build independently
8. Backend is the ONLY server-side gateway

### Things AI Agents MUST NOT Change

1. Remove Convex from the system (it's already gone)
2. Add direct database access from frontend apps
3. Store auth tokens in localStorage
4. Create duplicate user records on login
5. Use `DROP TABLE` or `TRUNCATE` in migrations
6. Expose server secrets via `VITE_` variables
7. Mix application-specific code between apps
8. Change the package naming convention (`@velnox/shared`, `@velnox/velshop`, etc.)
9. Replace the `@velnox/shared` wildcard export pattern

---

## 🎨 UI/UX RULES

### Design System

`VELNOX_DESIGN_THEME.md` is the source of truth for visual design. It governs:
Colors, typography, spacing, border radius, shadows, buttons, cards, inputs, navigation, modals, loading/error states, responsive behavior, UI patterns.

Whenever working on UI/UX: **MUST read `VELNOX_DESIGN_THEME.md` first**.

### Component Reuse

Before creating a new UI component, search for existing ones first:
- `packages/shared/src/components/ui/` — 70+ shadcn/ui components
- `packages/shared/src/components/` — Logo, AppHeader, MobileTabBar, RequireAuth, etc.

Reuse existing components and design tokens. Do NOT create duplicate components. Do NOT introduce random colors or styles.

### Shared Package Imports

All apps import from `@velnox/shared` via Vite aliases:
```typescript
import { Button } from "@velnox/shared/components/ui/button"
import { Logo } from "@velnox/shared/components/Logo"
import { useAuth } from "@velnox/shared/hooks/use-auth"
import { api } from "@velnox/shared/lib/api-routes"
```

---

## ⚡ PERFORMANCE RULES

When modifying the application, avoid:
- Unnecessary API requests or database queries
- Duplicate fetches or re-renders
- Expensive operations without caching

Consider: cache, memoization, request deduplication, database indexes, query efficiency, image optimization.

### Database Performance

When a query is slow, investigate:
- Neon cold starts, missing indexes, query plans
- Connection pooling, duplicate requests, N+1 queries

Do NOT solve database performance by simply increasing timeouts. Find the underlying cause.

---

## 🔒 SECURITY RULES

### NEVER Commit

- `.env`, `.env.production`
- API keys, database passwords, JWT secrets
- R2 secrets, OAuth secrets

### NEVER Log

- Passwords, tokens, authorization headers
- API secrets, database credentials

### API Security

- Authentication via httpOnly session cookies (NOT localStorage)
- Authorization: derive userId from session, never trust user-provided userId
- Input validation on all endpoints
- Proper error handling without leaking sensitive data

---

## 🐛 BUG FIX RULE

When a bug is found:
1. Reproduce the bug
2. Inspect logs
3. Identify the root cause (not just the symptom)
4. Fix the root cause
5. Test the fix
6. Test regression
7. Update documentation when necessary
8. Update AI_Handoff.md
9. Commit and push

**NEVER only hide the symptom.**

---

## 🚫 NEVER GUESS

AI developers must NEVER guess:
- Database schema, API response format
- Environment variables, file locations
- Component behavior, business logic
- Existing architecture

**Inspect the repository first.**

---

## 📝 DOCUMENTATION CONSISTENCY

If implementation and documentation disagree, investigate which is correct, then update the documentation to match. Do not leave known contradictions between source code, database, schema.sql, run-sqleditor.sql, AI_Handoff.md, or INSTALLATION.md.

---

## ✅ END-OF-TASK CHECKLIST

Before saying "Task completed":
- [ ] Code completed
- [ ] Root cause verified (if bug fix)
- [ ] No obvious errors
- [ ] Typecheck passed
- [ ] Build passed
- [ ] Database verified (if changed)
- [ ] `db/schema.sql` updated (if database changed)
- [ ] `db/run-sqleditor.sql` updated (if database changed)
- [ ] `AI_Handoff.md` updated
- [ ] `INSTALLATION.md` updated (if setup changed)
- [ ] `VELNOX_DESIGN_THEME.md` followed (if UI changed)
- [ ] Git diff reviewed
- [ ] Commit created
- [ ] Git push completed successfully

If any applicable item is incomplete: **DO NOT report the task as fully completed.**

---

## 📊 FINAL REPORT FORMAT

At the end of every completed task:

```markdown
## Completed
[What was implemented]

## Root Cause
[If bug fix, the actual root cause]

## Files Changed
[List of files]

## Database Changes
[Description of database changes, if any]

## Documentation Updated
[List of applicable files]

## Tests
- Typecheck: PASS/FAIL
- Build: PASS/FAIL
- Manual verification: PASS/FAIL

## Git
Commit: <SHA>
Push: SUCCESS / FAILED

## Next Tasks
[Remaining work]
```
