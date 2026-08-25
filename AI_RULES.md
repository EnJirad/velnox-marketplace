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
**"If you change the Neon database or any database table, you MUST update BOTH `db/schema.sql` AND `db/run-sqleditor.sql` AND append to `db/run-update.sql`."**

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
| `db/schema.sql` | Complete database schema (canonical reference) |
| `db/run-sqleditor.sql` | SQL bootstrap script (must be synchronized with schema.sql) |
| `db/run-update.sql` | Permanent incremental migration history |

---

## 1. FIRST: READ THE PROJECT DOCUMENTATION

Before modifying anything, always read:

- AI_RULES.md
- AI_Handoff.md
- INSTALLATION.md
- VELNOX_DESIGN_THEME.md

Then inspect the relevant source code.

Do not guess the existing architecture.
Always understand the current implementation before changing it.

---

## 2. DESIGN SYSTEM — MANDATORY

The Velnox design system is defined by:

`VELNOX_DESIGN_THEME.md`

This file is the source of truth for:

- Colors
- Theme
- Typography
- Spacing
- Components
- UI style
- Visual hierarchy
- UX patterns

Whenever creating or modifying UI:

**READ VELNOX_DESIGN_THEME.md FIRST.**

- Do not introduce random colors.
- Do not create a completely different visual style.
- Do not replace the Velnox design language.
- Keep the existing UI consistent unless the task explicitly requires a redesign.

### Component Reuse

Before creating a new UI component, search for existing ones first:
- `packages/shared/src/components/ui/` — 70+ shadcn/ui components
- `packages/shared/src/components/` — Logo, AppHeader, MobileTabBar, RequireAuth, etc.

Reuse existing components and design tokens. Do NOT create duplicate components.

---

## 3. DATABASE — THREE REQUIRED SQL FILES

Velnox MUST maintain these three files:

- `db/run-update.sql`
- `db/run-sqleditor.sql`
- `db/schema.sql`

Each file has a different purpose.

### 3.1 db/run-sqleditor.sql

This is the **COMPLETE DATABASE BOOTSTRAP**.

It must represent the entire current Velnox database.

A brand-new empty PostgreSQL database must be able to use this file
to create the COMPLETE latest database.

It must contain the latest:

- Extensions
- Enums
- Tables
- Columns
- Primary keys
- Foreign keys
- Unique constraints
- CHECK constraints
- Indexes
- Functions
- Triggers
- Other required database objects

Whenever the database changes:

**UPDATE THIS FILE.**

It must ALWAYS represent the latest complete database.

### 3.2 db/schema.sql

This is the **COMPLETE DATABASE SCHEMA REFERENCE**.

It must represent the exact latest database structure.

Whenever the database changes:

**UPDATE THIS FILE.**

The final schema represented by `db/run-sqleditor.sql` and `db/schema.sql`
must remain synchronized. They must describe the same final database.

### 3.3 db/run-update.sql

This is the **PERMANENT INCREMENTAL MIGRATION HISTORY**.

It is used to update an EXISTING database.

It must NOT recreate the entire database.

It must contain migrations such as:

- CREATE TABLE for new tables
- ALTER TABLE ADD COLUMN
- ALTER TABLE ALTER COLUMN
- CREATE INDEX
- DROP/ADD constraints
- Enum changes
- Functions
- Triggers
- Data migrations
- Other incremental database changes

---

## 4. RUN-UPDATE.SQL MUST NEVER LOSE HISTORY

- NEVER overwrite run-update.sql.
- NEVER delete old migrations.
- NEVER replace it with only the latest migration.
- Every new migration MUST be appended.

Example:

```
V0001
V0002
V0003
V0004
V0005
...
V0043
V0044
V0045
```

Old migrations remain permanently.

---

## 5. MIGRATION FORMAT

Every migration must have:

- Migration version
- Date
- Description
- Reason
- Affected tables
- SQL

Example:

```sql
------------------------------------------------------------
-- Migration: V0043
-- Date: 2026-08-25
-- Description:
-- Add seller verification documents
--
-- Reason:
-- Seller onboarding requires document verification.
--
-- Affected:
-- seller_documents
------------------------------------------------------------

CREATE TABLE IF NOT EXISTS seller_documents (
    ...
);
```

---

## 6. EVERY DATABASE CHANGE MUST UPDATE ALL THREE FILES

This is MANDATORY.

If ANY database change occurs:

1. Add migration to `db/run-update.sql`
2. Update `db/run-sqleditor.sql`
3. Update `db/schema.sql`

ALL THREE MUST BE UPDATED.

**Invalid:**
- run-update.sql updated
- schema.sql unchanged
- run-sqleditor.sql unchanged

**Valid:**
- run-update.sql → new incremental migration
- run-sqleditor.sql → complete latest schema
- schema.sql → complete latest schema

---

## 7. DATABASE CHANGE DEFINITION

A database change includes ANY of the following:

- New table
- New column
- Deleted column
- Changed column type
- New enum
- Changed enum
- New index
- Deleted index
- Foreign key
- Unique constraint
- CHECK constraint
- Trigger
- Function
- Relationship
- Data migration
- Database configuration
- Any Neon PostgreSQL structural change

If you touch Neon PostgreSQL:
**THE DATABASE RULES APPLY.**

---

## 8. NEVER DESTROY PRODUCTION DATA FOR NORMAL MIGRATIONS

Never solve a normal migration by:

- DROP DATABASE
- DROP TABLE
- TRUNCATE
- Recreating the entire database

Unless explicitly instructed by the project owner.

Existing production data must be preserved.
Migrations must safely move: CURRENT DATABASE → NEW DATABASE VERSION.

---

## 9. PRODUCTION DATABASE WORKFLOW

Whenever a database change is required:

| Step | Action |
|------|--------|
| STEP 1 | Inspect the current production Neon database |
| STEP 2 | Determine the required schema change |
| STEP 3 | Create a new migration in `db/run-update.sql` |
| STEP 4 | Apply the migration to the appropriate database |
| STEP 5 | Verify the migration succeeded |
| STEP 6 | Verify existing data remains intact |
| STEP 7 | Update `db/run-sqleditor.sql` |
| STEP 8 | Update `db/schema.sql` |
| STEP 9 | Verify all three represent the correct state |
| STEP 10 | Update `AI_Handoff.md` |
| STEP 11 | Run tests |
| STEP 12 | Commit |
| STEP 13 | Push |

---

## 10. DATABASE CONSISTENCY CHECK

Before declaring any database task complete:

- [ ] Neon database is correct
- [ ] `db/run-update.sql` contains the migration
- [ ] `db/run-update.sql` preserved all previous migrations
- [ ] `db/run-sqleditor.sql` contains the latest complete schema
- [ ] `db/schema.sql` contains the latest complete schema
- [ ] `db/run-sqleditor.sql` and `db/schema.sql` are synchronized
- [ ] Existing production data is preserved
- [ ] AI_Handoff.md updated
- [ ] Tests passed
- [ ] Git commit created
- [ ] Git push completed

---

## 11. AI_HANDOFF.md — ALWAYS UPDATE

AI_Handoff.md must ALWAYS be kept current.

After completing ANY meaningful task, update it.

It must help the next AI agent immediately understand:

- Current project state
- What has been completed
- What is currently being worked on
- What remains
- Known bugs
- Architecture decisions
- Database changes
- API changes
- Authentication changes
- Deployment information
- Environment variables
- Important constraints
- Known technical debt
- Next recommended tasks

The next AI should NOT need to guess what happened.

---

## 12. AI_RULES.md — PERMANENT RULES

Maintain AI_RULES.md (this file).

This file contains permanent development rules.

If a new permanent development rule is discovered:

**UPDATE AI_RULES.md.**

---

## 13. INSTALLATION.md

Maintain `INSTALLATION.md`.

This file must explain how to recreate and run the project from a clean environment.

Document:

- Requirements
- Node/Bun version
- Package manager
- Installation
- Environment variables
- Database setup
- Neon setup
- Backend setup
- Frontend setup
- Vercel setup
- Render setup
- Google OAuth setup
- R2 setup
- Build commands
- Development commands
- Production deployment
- Database initialization
- Database migrations

A new developer or AI should be able to follow this file and rebuild the project without guessing.

Whenever installation/deployment architecture changes: **UPDATE INSTALLATION.md.**

---

## 14. GIT — ALWAYS PUSH AFTER COMPLETION

After completing a task:

1. `git status`
2. `git diff`
3. Review the changes
4. `git add .`
5. Create an appropriate commit
6. `git push`

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

**NEVER** use meaningless messages like: `update`, `test`, `aaa`, `fix stuff`

**NEVER** leave completed work only in the local workspace.
**DO NOT** force push unless explicitly instructed by the project owner.

---

## 15. AUTHENTICATION — SOURCE OF TRUTH

Authentication must have ONE authoritative source.

The backend session is the source of truth.

Do NOT treat any of the following as independent proof of authentication:

- localStorage
- sessionStorage
- React state
- URL parameters

Frontend auth state must reflect backend session state.

---

## 16. GOOGLE OAUTH

Google OAuth must support:

- New Google account
- Existing Google account
- Multiple Google accounts
- Different browsers
- Secure OAuth state
- Secure callback
- Session creation
- Session persistence
- Logout

Do NOT use browser-specific hacks.
Do NOT disable OAuth state validation.
OAuth state must be securely generated and validated.
The callback must NOT blindly trust an incoming state value.

---

## 17. SESSION CREATION

After successful Google OAuth:

```
Google
↓
Verify identity
↓
Find/create Velnox user
↓
Create authenticated session
↓
Store session
↓
Set secure cookie
↓
Redirect to application
```

Verify:

- Session ID
- Session expiration
- Cookie name
- Cookie path
- Cookie domain
- Secure
- HttpOnly
- SameSite

---

## 18. /api/auth/me

There must be a reliable current-user endpoint.

Expected:

```
GET /api/auth/me
```

Valid session → HTTP 200 → authenticated user
Invalid/no session → HTTP 401 → JSON error

**NEVER return HTML to an API request.**

---

## 19. LOGOUT — CRITICAL

Logout must be a REAL logout.

It must:

1. Call backend logout
2. Revoke/destroy the server session
3. Clear authentication cookie
4. Clear frontend authentication state
5. Clear/invalidate user cache
6. Remove stale user-specific data
7. Redirect to an unauthenticated page

DO NOT implement logout as only:

- `setUser(null)`
- `localStorage.removeItem(...)`

The backend session MUST become invalid.

---

## 20. LOGOUT VERIFICATION

After logout:

```
GET /api/auth/me
→ MUST return HTTP 401
```

Then login with another Google account. The second account must appear.

Example:

```
Account A
↓ Login
↓ Account A
↓ Logout
↓ /api/auth/me = 401
↓ Account B
↓ Login
↓ Account B
```

Account A data must NOT leak into Account B.

---

## 21. AUTH CACHE

After logout, invalidate:

- Current user cache
- Profile cache
- Seller cache
- Shop cache
- User-specific React Query/SWR/cache data

The old user's avatar, name, email, seller status, shop information, and profile must disappear.

---

## 22. CROSS-BROWSER AUTH

Test authentication using:

- Chrome
- Firefox
- Edge
- Android browsers where available

Test: Login → Refresh → Logout → Login with another account.
No account data may leak between browsers.

---

## 23. CROSS-DOMAIN AUTH

Current architecture:

| App | URL |
|-----|-----|
| VelShop | `https://velshop.velnox.com` |
| VelSeller | `https://velseller.velnox.com` |
| VelCenter | `https://velcenter.velnox.com` |
| Backend | `https://velnox-api.onrender.com` |

Verify: CORS, Cookies, Credentials, SameSite, Secure, API requests, Session persistence.
Do not assume cross-origin cookies work. Verify the actual browser behavior.

---

## 24. CORS

Credentialed requests must use proper CORS.

Never use `Access-Control-Allow-Origin: *` when credentials are required.
Explicitly configure allowed production origins.

---

## 25. API URL

Frontend environment: `VITE_API_URL=https://velnox-api.onrender.com`

The API client should automatically append `/api`.

Final: `https://velnox-api.onrender.com/api`

**NEVER produce `/api/api`.**

All Velnox applications should use the same API architecture.

---

## 26. ENVIRONMENT VARIABLES

### Frontend (ALL PUBLIC — type Config in Vercel)

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend API base URL |
| `VITE_SITE_BASENAME` | Sub-path basename (empty = root) |
| `VITE_VELSHOP_URL` | VelShop full URL |
| `VITE_VELSELLER_URL` | VelSeller full URL |
| `VITE_VELCENTER_URL` | VelCenter full URL |
| `VITE_CORPORATE_URL` | Corporate website URL |

### Secrets MUST NOT use `VITE_*`

Examples of secrets that must remain server-side:

- BOOTSTRAP_OWNER_SECRET
- OAuth client secrets
- Database passwords
- R2 secret keys
- API secrets
- JWT_SECRET

---

## 27. VELCENTER

VelCenter is a protected company administration area.

Only authorized users may access it.
Owner/admin authorization must always be checked server-side.
Never trust frontend role values.
Seller approval/rejection must be performed by authorized admins.
Users must NOT approve/reject themselves.

---

## 28. SELLER STATUS

Seller status must have ONE canonical set of values.

Backend, Neon, VelCenter, and VelSeller must all use the same values.

Do not use inconsistent values such as `approved`, `active`, `accepted` for the same state.

Before changing seller statuses: inspect the existing database constraint `sellers_status_check` and the entire seller state machine.

Any status change must update: `db/run-update.sql`, `db/run-sqleditor.sql`, `db/schema.sql`.

---

## 29. SELLER APPROVAL

Expected flow:

```
Seller applies → pending → VelCenter admin → Approve → approved → VelSeller recognizes approved seller → Seller dashboard

Reject: pending → rejected
```

Self approval must remain prohibited.
Unauthorized approval must remain prohibited.

---

## 30. API ERROR FORMAT

API endpoints must return JSON.

**NEVER return `<!DOCTYPE html>` for an API request.**

Especially:

- `/api/auth/*`
- `/api/seller/*`
- `/api/admin/*`
- `/api/shop/*`

Frontend must never receive an HTML Vercel error page when expecting JSON.

---

## 31. PERFORMANCE

When logs show "Slow query":

1. Inspect the query
2. Determine whether it is: Neon cold start, missing index, inefficient query, excessive repeated requests, N+1 query, connection issue
3. Measure before changing

Do NOT blindly add indexes.
Do NOT rewrite unrelated systems.

---

## 32. FILE UPLOADS

Profile and cover image uploads must:

- Convert images to WebP before upload
- Use efficient filenames/object keys
- Replace old profile image when a new one is uploaded
- Replace old cover image when a new one is uploaded
- Delete old R2 object after successful replacement
- Avoid accumulating unused R2 files
- Update database references correctly
- Update UI immediately after successful upload
- Avoid requiring a hard refresh

The same replacement strategy should be used consistently for Profile and Cover.

---

## 33. IMAGE STORAGE

Cloudflare R2 is the object storage. Database stores the appropriate object key/URL reference.

When replacing an image:

```
OLD IMAGE
↓
upload NEW IMAGE
↓
verify NEW IMAGE
↓
update database
↓
delete OLD IMAGE
↓
invalidate frontend cache
↓
display NEW IMAGE
```

Do not delete the old image before the new upload is safely verified.

---

## 34. FRONTEND DATA REFRESH

After profile/cover changes: the new image must appear immediately.
Do not require a browser refresh if the application can update the UI directly.
Update/invalidate the appropriate profile cache.

---

## 35. ADDRESSES

Address APIs must use the actual Neon schema.
Never assume columns exist.
Before modifying address queries: inspect `addresses` and the actual production schema.
Backend SQL must match Neon.
If database schema changes: apply the full database rules.

---

## 36. DATABASE ERROR DEBUGGING

When PostgreSQL reports any error:

- column does not exist
- constraint violation
- invalid enum
- foreign key violation
- duplicate key
- type mismatch

**DO NOT** blindly modify the backend.

First compare:

1. Production Neon
2. `db/run-update.sql`
3. `db/run-sqleditor.sql`
4. `db/schema.sql`
5. Backend SQL
6. Frontend expectations

Find which layer is inconsistent. Then fix the root cause.

---

## 37. NO QUICK HACKS

Do not solve problems with:

- Hardcoded fake data
- Fake authentication
- Fake seller approval
- Frontend-only permissions
- Disabling security checks
- Removing database constraints without analysis
- Hiding errors
- Swallowing database errors
- Returning success when the operation failed

**Fix the actual architecture.**

---

## 38. DOCUMENT EVERY IMPORTANT ARCHITECTURE CHANGE

Whenever architecture changes:

1. Update `AI_Handoff.md`
2. If it becomes a permanent development rule: update `AI_RULES.md`
3. If installation/deployment changes: update `INSTALLATION.md`
4. If database changes: update all three SQL files

---

## 39. BUILD AND TYPECHECK

Before declaring work complete, run the appropriate project checks.

At minimum where applicable:

```bash
bun run typecheck
bun run build
```

Fix relevant errors introduced by the task.
Do not ignore TypeScript/build errors caused by your changes.

---

## 40. FINAL VERIFICATION

Before declaring ANY task complete:

- [ ] Code implemented
- [ ] Existing functionality preserved
- [ ] UI follows VELNOX_DESIGN_THEME.md
- [ ] Backend tested
- [ ] Frontend tested
- [ ] API responses verified
- [ ] Database verified if applicable
- [ ] Authentication verified if applicable
- [ ] Security verified
- [ ] Typecheck passed
- [ ] Build passed
- [ ] AI_Handoff.md updated
- [ ] AI_RULES.md updated if necessary
- [ ] INSTALLATION.md updated if necessary
- [ ] `db/run-update.sql` updated if database changed
- [ ] `db/run-sqleditor.sql` updated if database changed
- [ ] `db/schema.sql` updated if database changed
- [ ] Git status reviewed
- [ ] Git diff reviewed
- [ ] Commit created
- [ ] Git push completed

---

## 41. NEVER DECLARE COMPLETE PREMATURELY

Do not say "Done" until the required implementation, testing, documentation, database synchronization, and Git push are actually completed.

If something cannot be tested, explicitly state: **NOT VERIFIED** instead of claiming it works.

---

## 42. FINAL REPORT FORMAT

After every significant task, provide:

```
## TASK RESULT

What changed: ...

Root cause: ...

Files changed: ...

Database changed: YES / NO

If YES:
  Migration: VXXXX
  db/run-update.sql: UPDATED
  db/run-sqleditor.sql: UPDATED
  db/schema.sql: UPDATED

AI_Handoff.md: UPDATED
AI_RULES.md: UPDATED / NOT REQUIRED
INSTALLATION.md: UPDATED / NOT REQUIRED

Tests:
  Typecheck: PASS / FAIL
  Build: PASS / FAIL
  Manual verification: PASS / FAIL / NOT VERIFIED

Git:
  Commit: <commit SHA>
  Push: SUCCESS / FAILED

Remaining issues: ...
```

---

## 43. CENTRALIZED URL CONFIGURATION

Deployment-specific frontend URLs must NOT be hardcoded in source code.
All public frontend URLs are centralized in `packages/shared/src/lib/sites.ts` and read from `VITE_*` environment variables.

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

## 44. ARCHITECTURE RULES

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
│   ├── schema.sql
│   ├── run-sqleditor.sql
│   ├── run-update.sql
│   └── migrations/
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

## 45. BUG FIX RULE

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

## 46. NEVER GUESS

AI developers must NEVER guess:

- Database schema
- API response format
- Environment variables
- File locations
- Component behavior
- Business logic
- Existing architecture

**Inspect the repository first.**

---

## 47. DOCUMENTATION CONSISTENCY

If implementation and documentation disagree, investigate which is correct, then update the documentation to match. Do not leave known contradictions between source code, database, schema.sql, run-sqleditor.sql, AI_Handoff.md, or INSTALLATION.md.
