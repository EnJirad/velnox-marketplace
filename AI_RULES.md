AI_RULES.md — Velnox Marketplace

Last updated: 2026-09-12

---

0. MANDATORY RULES FOR EVERY AI AGENT

This document is the mandatory project rulebook for every AI agent working on Velnox Marketplace.

These rules apply to:

- AI coding agents
- AI assistants
- Autonomous AI agents
- Code-generation agents
- AI agents operating through GitHub
- AI agents operating through IDEs or terminals
- Any AI that reads, modifies, tests, commits, pushes, or deploys this project

NO AI AGENT IS EXEMPT FROM THESE RULES.

Every AI agent MUST follow this document before making changes to the project.

---

1. PROJECT SOURCE OF TRUTH

The current GitHub repository is the primary shared source of truth for Velnox Marketplace.

Repository:

https://github.com/EnJirad/velnox-marketplace.git

AI agents MUST NOT assume that their:

- Previous conversation
- Memory
- Cached context
- Previous task
- Previous implementation
- Previous AI handoff
- Generated plan

represents the current state of the project.

Another AI may have modified the repository after the current AI's context was created.

Therefore:

«Always inspect the current GitHub repository and actual source code before making changes.»

If previous AI context conflicts with the current repository:

«THE CURRENT REPOSITORY WINS.»

---

2. AUTHORITY ORDER

When information conflicts, AI agents MUST use the following order of authority:

1. CURRENT GITHUB REPOSITORY
2. CURRENT SOURCE CODE
3. CURRENT DATABASE / DATABASE SCHEMA
4. CURRENT PROJECT CONFIGURATION
5. CURRENT PROJECT DOCUMENTATION
6. AI_Handoff.md
7. PREVIOUS AI CONVERSATIONS
8. AI MEMORY / CACHED CONTEXT
9. AI ASSUMPTIONS

Lower-level information MUST NEVER override higher-level information.

For example:

If an old AI conversation says:

ProductCard.tsx is located at:
apps/velshop/src/components/ProductCard.tsx

but the current repository contains:

apps/velshop/src/features/products/ProductCard.tsx

the AI MUST follow the current repository.

---

3. STALE AI CONTEXT IS NOT PROJECT STATE

AI memory and previous conversations may be outdated.

They are references only.

They MUST NOT be treated as proof that the current implementation still exists.

Before modifying anything, verify:

- The file still exists
- The function still exists
- The route still exists
- The component still exists
- The database schema still matches
- The architecture is still current
- Another AI has not already modified the implementation

Never overwrite another AI's work simply because previous context says otherwise.

---

4. MANDATORY PRE-WORK PROCEDURE

Before starting ANY task, every AI agent MUST:

1. Read AI_RULES.md
2. Read AI_Handoff.md
3. Read INSTALLATION.md
4. Read VELNOX_DESIGN_THEME.md when working on UI/UX
5. Read relevant database documentation when touching DB
6. Inspect the CURRENT GitHub repository
7. Inspect the ACTUAL source files involved
8. Identify the existing implementation
9. Identify dependencies and affected systems
10. Only then plan the change

The AI MUST NOT modify files before understanding the existing implementation.

---

5. NEVER GUESS

AI agents MUST inspect before modifying.

Never assume:

- A file exists
- A function exists
- An API exists
- A database table exists
- A column exists
- A route exists
- A component works in a particular way
- A previous AI completed a task
- A deployment matches the current source
- Documentation is newer than the source
- A bug has a particular cause

When uncertain:

«Inspect the current repository instead of guessing.»

---

6. CORE DEVELOPMENT RULES

Every AI agent MUST:

- Inspect before modifying
- Understand before rewriting
- Fix root causes rather than symptoms
- Make the smallest correct change
- Preserve existing functionality
- Reuse existing systems
- Reuse existing components where possible
- Follow the existing architecture
- Follow the existing naming conventions
- Follow existing security rules
- Follow existing database conventions
- Verify changes before declaring completion

AI agents MUST NOT:

- Rewrite the entire project unnecessarily
- Create duplicate systems
- Create duplicate APIs
- Create duplicate database tables
- Create fake APIs
- Create fake database schemas
- Introduce mock production data
- Remove working functionality without permission
- Change architecture without a clear requirement
- Replace working systems simply because another implementation looks better

---

7. DATABASE RULES

7.1 Database Source of Truth

The database source of truth is:

Neon PostgreSQL

Frontend applications MUST NEVER connect directly to Neon.

Architecture:

Frontend
    ↓
Backend API
    ↓
Neon PostgreSQL

Critical commerce and financial data MUST remain authoritative in Neon.

R2 is for binary storage.

Neon stores the corresponding metadata.

AI agents MUST NOT introduce a second competing source of truth.

---

8. DATABASE FILES MUST ALWAYS STAY SYNCHRONIZED

This is a MANDATORY RULE.

Whenever an AI agent touches or changes the database, it MUST update ALL THREE files:

db/schema.sql
db/run-sqleditor.sql
db/run-update.sql

These files MUST always represent the latest intended database state.

This rule applies EVERY TIME.

No exceptions.

Database changes include:

- New table
- Removed table
- New column
- Removed column
- Changed column
- Changed data type
- Default value
- Index
- Foreign key
- Unique constraint
- Check constraint
- Enum
- Function
- Trigger
- View
- Relationship
- Data migration
- Structural migration
- Database behavior
- Any PostgreSQL schema change
- Any other modification to the database

The AI MUST NOT update only one or two of these files.

The AI MUST NOT leave any of them outdated.

Required state after every database change:

db/schema.sql
        +
db/run-sqleditor.sql
        +
db/run-update.sql
        =
CURRENT DATABASE STATE

Before declaring the task complete, the AI MUST verify that all three files are synchronized.

---

9. DATABASE MIGRATION RULES

Database migrations are append-only.

Migration files:

db/migrations/*.sql

Migration tracking:

schema_migrations

Automatic migration workflow:

.github/workflows/migrate-neon.yml

When creating a database migration:

1. Create migration file
2. Update db/schema.sql
3. Update db/run-sqleditor.sql
4. Update db/run-update.sql
5. Verify consistency
6. Test the migration
7. Commit
8. Push

Never modify historical migrations to hide or rewrite previous database history.

Never create startup DDL such as:

ALTER TABLE ...

inside server boot code as a replacement for the migration system.

---

10. DATABASE SAFETY

Never execute destructive database operations without explicit approval.

Never:

DROP DATABASE
TRUNCATE production data
RESET production database
DELETE production data

unless explicitly authorized.

Never silently change production data to make a test pass.

Never use production data as disposable test data.

---

11. SECURITY RULES

Always maintain:

- HTTP-only cookies
- Secure cookies in production
- Correct SameSite configuration
- Google OAuth state validation
- Server-side authorization
- Server-side ownership checks
- Seller approval checks
- VelCenter admin authorization
- CORS restrictions
- JWT signature verification
- Input validation
- Authentication checks
- Authorization checks

Never trust:

userId
sellerId
shopId
orderId
productId

from the frontend without server-side verification.

The backend MUST verify ownership and authorization.

---

12. SECRET MANAGEMENT

Never expose server secrets to frontend code.

Never put secrets inside:

VITE_*

Frontend code.

Never expose:

DATABASE_URL
JWT_SECRET
GOOGLE_CLIENT_SECRET
R2_SECRET_ACCESS_KEY
BOOTSTRAP_OWNER_SECRET

or equivalent server-side secrets.

Secrets MUST remain server-side.

Never commit secrets to Git.

---

13. API RULES

API endpoints MUST:

- Return predictable JSON
- Use correct HTTP status codes
- Validate input
- Validate authentication
- Validate authorization
- Enforce ownership
- Return useful error messages
- Keep API behavior consistent

Never return HTML from:

/api/*

API endpoints MUST NOT unexpectedly redirect users.

Never create duplicate endpoints when an existing canonical endpoint already provides the required functionality.

---

14. CANONICAL SELLER STATUS

Seller status MUST use the canonical values:

pending
approved
rejected
suspended

Do not introduce alternate status names such as:

active
verified
waiting
blocked

unless the architecture explicitly requires them and the canonical model is intentionally changed.

---

15. ARCHITECTURE RULES

Current application structure:

apps/velshop/       → Customer marketplace
apps/velseller/     → Seller management
apps/velcenter/     → Admin management
apps/velnox/        → Corporate website

backend/            → Express API server

packages/shared/    → Shared code

db/                 → Database schema, migrations and SQL

Key invariants:

Neon PostgreSQL = source of truth
Frontend = never directly connects to DB
Frontend = never contains server secrets
Backend = server-side gateway
R2 = binary storage
Neon = metadata and critical commerce data

AI agents MUST preserve these invariants.

Do not change the architecture without explicit authorization.

---

16. FRONTEND RULES

For UI work:

- Follow "VELNOX_DESIGN_THEME.md"
- Reuse existing components
- Use existing shadcn/ui components
- Preserve the Velnox design language
- Preserve responsive behavior
- Preserve accessibility
- Preserve existing functionality
- Prefer modifying existing files over creating duplicates

Shared UI components are located under:

packages/shared/src/components/ui/

Do not introduce random colors, styles, spacing systems, or component libraries without a clear reason.

Do not replace an existing working UI system simply because another implementation is easier.

---

17. UI/UX CHANGE RULE

Before changing UI:

1. Inspect the current page
2. Inspect existing components
3. Understand current interaction flow
4. Identify the exact requested change
5. Preserve unrelated behavior
6. Implement the smallest required change
7. Test desktop
8. Test mobile

Do not modify unrelated pages simply because they use similar components.

---

18. PERFORMANCE RULES

Before fixing performance:

1. Measure
2. Identify the bottleneck
3. Determine the root cause
4. Fix the root cause
5. Verify the improvement

Check for:

- Slow database queries
- N+1 queries
- Missing indexes
- Redundant queries
- Sequential independent requests
- Cold starts
- Excessive network requests
- Large payloads
- Unnecessary re-renders
- Duplicate API calls

Never blindly:

- Add indexes
- Cache everything
- Rewrite the backend
- Rewrite the frontend
- Add complicated optimization layers

---

19. FILE UPLOAD RULES

R2 is the binary storage system.

Profile image strategy:

profile/avatar/{userId}.webp

Upload flow:

Presign
    ↓
PUT to R2
    ↓
Confirm upload
    ↓
Save media record
    ↓
Update user record

When replacing an existing image:

Upload new image
    ↓
Confirm successful upload
    ↓
Save new metadata
    ↓
Update reference
    ↓
Delete old R2 object

Never delete the old image before the replacement has been successfully stored.

Images should be converted to WebP when required by the current upload architecture.

---

20. DOCUMENTATION RULES

When architecture changes:

Update AI_Handoff.md

When installation/deployment changes:

Update INSTALLATION.md

When database changes:

Update:
db/schema.sql
db/run-sqleditor.sql
db/run-update.sql

When a permanent AI rule changes:

Update AI_RULES.md

Documentation MUST reflect the current implementation.

Do not document features that do not actually exist.

Do not claim an implementation is complete if the source code does not support the documentation.

---

21. AI_HANDOFF RULES

"AI_Handoff.md" is the handoff document between AI agents.

After every significant task, update it with:

- What changed
- Why it changed
- Files changed
- Important implementation details
- Database changes
- API changes
- Remaining issues
- Testing performed
- Deployment status when relevant

However:

«AI_Handoff.md is NOT more authoritative than the current source code.»

If the handoff document conflicts with the actual repository:

«The repository wins.»

---

22. MULTI-AI COLLABORATION

Multiple AI agents may work on the same project.

Therefore:

GitHub = shared synchronization point

Every AI MUST:

- Inspect the latest repository state
- Respect newer commits
- Avoid reverting newer work
- Avoid overwriting another AI's changes
- Avoid duplicate implementations
- Review current Git status
- Review current diff
- Commit meaningful changes
- Push completed work

Never assume:

«"Nobody changed this because I did not see it in my previous context."»

---

23. GIT RULE — MANDATORY

EVERY COMPLETED TASK MUST BE COMMITTED AND PUSHED.

After work is complete:

git status
git diff
git diff --check
git add .
git commit -m "<meaningful message>"
git push
git status

The final "git status" MUST be checked.

The working tree should be clean unless there is a documented reason otherwise.

---

24. COMMIT MESSAGE RULES

Commit messages MUST describe the actual change.

Valid examples:

feat: add seller verification
fix: repair google authentication
fix(db): update seller status constraint
feat(db): add seller documents
chore: update project documentation
refactor: improve address service
docs: update AI handoff

Never use meaningless commit messages:

update
test
aaa
fix
changes
stuff
work

---

25. NEVER FORCE PUSH

Never use:

git push --force
git push -f

unless explicitly instructed by the project owner.

A force push can destroy another AI's work.

---

26. GIT CONFLICT RULE

If a merge conflict occurs:

1. Stop
2. Inspect both versions
3. Understand why each change exists
4. Preserve required functionality from both sides
5. Resolve intentionally
6. Run verification
7. Review the final diff
8. Commit
9. Push

Never blindly choose:

ours

or:

theirs

without understanding the changes.

---

27. ROOT CAUSE RULE

When fixing a bug:

Symptom
   ↓
Trace execution
   ↓
Find root cause
   ↓
Fix root cause
   ↓
Verify

Do not hide problems with:

- Random retries
- Arbitrary delays
- Fake success responses
- Hardcoded values
- UI-only workarounds
- Duplicate requests
- Silent error suppression

Unless the workaround is explicitly part of the intended architecture.

---

28. NO FAKE IMPLEMENTATION

Never claim a feature works if it is only:

- Mocked
- Hardcoded
- Simulated
- Frontend-only
- Using fake API responses
- Using fake database data
- Using placeholder logic

If a feature is intentionally a mock, clearly identify it as:

MOCK

Do not present a mock implementation as production-ready functionality.

---

29. PRESERVE EXISTING FUNCTIONALITY

When implementing a requested change:

«Change what is necessary. Preserve everything else.»

Before completing the task, check whether the change affects:

- Authentication
- Authorization
- Navigation
- API calls
- Database queries
- Product functionality
- Seller functionality
- Admin functionality
- Responsive layout
- Existing user flows

Do not remove existing behavior unless explicitly requested.

---

30. TESTING RULES

Testing requirements depend on the change.

At minimum, the AI MUST verify relevant areas.

For frontend changes:

TypeScript
Build
Affected page
Responsive behavior
Existing interaction

For backend changes:

TypeScript
Build
Affected API
Authentication
Authorization
Error handling

For database changes:

Migration
Schema consistency
Queries
Constraints
Affected API

For authentication changes:

Login
Logout
Session
OAuth
Authorization
Redirect behavior

Never claim tests passed if they were not actually run.

If something cannot be verified:

NOT VERIFIED

must be reported.

---

31. BUILD AND TYPECHECK

Before declaring completion when applicable:

TypeScript typecheck = PASS
Build = PASS

The AI MUST NOT knowingly introduce new TypeScript errors.

If an existing unrelated error prevents verification, report it explicitly.

Do not hide or suppress errors simply to make the build appear successful.

---

32. DEPLOYMENT RULES

Deployment configuration MUST remain consistent with the current architecture.

Never change production environment variables, deployment configuration, domains, authentication configuration, or database configuration without understanding the existing deployment architecture.

Never expose secrets in:

- Git
- frontend bundles
- logs
- screenshots
- API responses
- client-side environment variables

---

33. ENVIRONMENT RULES

Before changing environment variables:

1. Identify where the variable is used
2. Identify whether it is client-side or server-side
3. Check deployment requirements
4. Check local development requirements
5. Update documentation if necessary

Do not rename environment variables arbitrarily.

Do not create duplicate environment variables for the same purpose.

---

34. API AND DATABASE OWNERSHIP

The frontend MUST NOT decide whether a user is allowed to perform an operation.

The backend MUST enforce:

Authentication
Authorization
Ownership
Seller status
Admin permissions
Resource access

Frontend checks are for UX only.

They are NOT security boundaries.

---

35. PRODUCT AND COMMERCE DATA

Critical commerce data MUST remain authoritative in Neon.

This includes, where applicable:

Users
Sellers
Shops
Products
Product variants
Orders
Order items
Payments
Financial records
Commerce relationships

Do not create a second database containing competing versions of critical commerce data.

---

36. R2 DATA RULE

R2 stores binary objects.

Neon stores metadata and references.

Do not store critical commerce state only inside R2.

Do not treat an object-storage URL as the database source of truth.

---

37. ERROR HANDLING

Errors MUST be handled explicitly.

Never:

- Swallow errors silently
- Return fake success
- Hide backend errors from developers
- Log secrets
- Expose internal stack traces to users
- Convert every error into HTTP 200

Use meaningful status codes and messages.

---

38. LOGGING RULES

Logs MUST help diagnose real problems.

Useful logs may include:

Request ID
Operation
Duration
Status
Relevant non-sensitive identifiers
Database timing
External service timing

Never log:

Passwords
JWT secrets
OAuth client secrets
Database URLs containing credentials
R2 secrets
Session secrets
Private tokens
Sensitive personal information

---

39. CHANGE SCOPE RULE

If the user asks:

Fix X

the default scope is:

Fix X

Do not use the request as permission to:

- Rewrite unrelated components
- Change architecture
- Refactor unrelated code
- Rename large parts of the project
- Change database structure unnecessarily
- Change design system
- Remove features

If a larger change is genuinely required, explain why before expanding scope.

---

40. NO DUPLICATE SYSTEMS

Before creating a new:

- API
- Component
- Hook
- Service
- Database table
- Database column
- Utility
- Authentication flow
- Upload flow

search the existing project first.

If an existing system already solves the problem:

«Reuse or extend it.»

Do not create parallel implementations.

---

41. DESIGN SYSTEM RULE

All UI changes MUST follow:

VELNOX_DESIGN_THEME.md

Do not introduce arbitrary:

- Colors
- Typography
- Border styles
- Shadows
- Spacing systems
- Buttons
- Form styles
- Modal styles

when an existing Velnox component/style already exists.

Consistency is more important than individual-page experimentation.

---

42. RESPONSIVE DESIGN RULE

Every UI change MUST consider:

Mobile
Tablet
Desktop

A desktop fix MUST NOT break mobile.

A mobile fix MUST NOT unnecessarily break desktop.

When relevant, verify:

- Touch targets
- Scrolling
- Modal behavior
- Navigation
- Images
- Product grids
- Forms
- Buttons
- Text wrapping

---

43. ACCESSIBILITY RULE

Do not intentionally remove:

- Keyboard navigation
- Focus states
- Labels
- Accessible names
- Semantic elements
- Useful error messages

Interactive elements MUST remain usable.

---

44. DOCUMENTATION VS SOURCE CODE

Documentation describes the project.

The actual implementation defines the project.

If documentation says:

Feature A exists

but the current source does not contain Feature A:

«Do not pretend it exists.»

Inspect the source and update documentation when appropriate.

---

45. NO UNAUTHORIZED ARCHITECTURE CHANGE

AI agents MUST NOT independently decide to:

- Replace Neon
- Replace R2
- Replace Express
- Replace the frontend architecture
- Replace the authentication system
- Introduce another database
- Move applications between directories
- Rename major applications
- Replace the build system
- Replace the deployment platform

unless explicitly instructed.

---

46. WHEN REQUIREMENTS ARE AMBIGUOUS

If a request is ambiguous but can safely be implemented using the existing architecture:

«Prefer the smallest reasonable interpretation.»

If ambiguity could cause:

- Data loss
- Security problems
- Architecture changes
- Breaking changes
- Major UX changes
- Production damage

the AI MUST stop and clarify before proceeding.

---

47. BEFORE COMMITTING

Every AI agent MUST review:

git status
git diff
git diff --check

Look specifically for:

- Unexpected files
- Debug code
- Temporary files
- Secrets
- Accidental deletions
- Unrelated changes
- Database files not updated
- Documentation not updated
- Generated files that should not be committed

---

48. DATABASE FINAL CHECK

If the task touched the database, verify:

[ ] db/schema.sql updated
[ ] db/run-sqleditor.sql updated
[ ] db/run-update.sql updated
[ ] Migration created when required
[ ] Migration history preserved
[ ] Schema synchronized
[ ] SQL syntax verified
[ ] Affected queries verified

If any of these are missing:

«The database task is NOT complete.»

---

49. FINAL VERIFICATION CHECKLIST

Before declaring ANY task complete:

[ ] Code implemented correctly
[ ] Root cause addressed
[ ] Existing functionality preserved
[ ] UI follows design theme when applicable
[ ] Mobile behavior checked when applicable
[ ] Backend behavior checked when applicable
[ ] Database behavior checked when applicable
[ ] Security checked when applicable
[ ] Authentication checked when applicable
[ ] TypeScript typecheck passes
[ ] Build passes
[ ] No new TypeScript errors introduced
[ ] AI_Handoff.md updated when required
[ ] AI_RULES.md updated when a permanent rule changed
[ ] db/schema.sql updated when DB was touched
[ ] db/run-sqleditor.sql updated when DB was touched
[ ] db/run-update.sql updated when DB was touched
[ ] git status reviewed
[ ] git diff reviewed
[ ] git diff --check passed
[ ] Commit created
[ ] Git push completed
[ ] Working tree verified

---

50. DO NOT SAY "DONE" PREMATURELY

The AI MUST NOT say:

Done
Completed
Finished
Fixed
Successfully implemented

until the required verification has been performed.

If something could not be verified, explicitly say:

NOT VERIFIED

If Git push failed:

Git push: FAIL
Task status: NOT COMPLETE

---

51. FINAL REPORT FORMAT

After every significant task, provide:

## TASK RESULT

What changed:
...

Root cause:
...

Files changed:
...

Database changed:
YES / NO

Database SQL synchronization:
PASS / FAIL / NOT APPLICABLE

Typecheck:
PASS / FAIL / NOT VERIFIED

Build:
PASS / FAIL / NOT VERIFIED

Tests:
PASS / FAIL / NOT VERIFIED

Git commit:
<commit hash>

Git push:
SUCCESS / FAIL

Working tree:
CLEAN / NOT CLEAN

Remaining issues:
...

Never hide failures.

Never report PASS when something was not actually verified.

---

52. GOLDEN RULE

The following rules are absolute:

«NEVER GUESS.»

«ALWAYS INSPECT THE CURRENT GITHUB REPOSITORY BEFORE MODIFYING THE PROJECT.»

«CURRENT GITHUB STATE HAS PRIORITY OVER STALE AI MEMORY OR PREVIOUS CONVERSATIONS.»

«EVERY AI AGENT WORKING ON VELNOX MARKETPLACE MUST FOLLOW AI_RULES.md.»

«NEVER OVERWRITE ANOTHER AI'S WORK BLINDLY.»

«FIX ROOT CAUSES, NOT SYMPTOMS.»

«PRESERVE EXISTING FUNCTIONALITY.»

«DO NOT CREATE DUPLICATE SYSTEMS.»

«NEVER EXPOSE SECRETS.»

«NEVER LET THE FRONTEND BYPASS BACKEND AUTHORIZATION.»

«NEVER TREAT THE FRONTEND AS THE DATABASE SOURCE OF TRUTH.»

«NEON POSTGRESQL IS THE SOURCE OF TRUTH FOR CRITICAL COMMERCE DATA.»

«R2 STORES BINARIES; NEON STORES METADATA.»

«EVERY DATABASE CHANGE REQUIRES ALL THREE SQL FILES TO BE UPDATED:

"db/schema.sql"

"db/run-sqleditor.sql"

"db/run-update.sql"»

«THE THREE DATABASE FILES MUST ALWAYS REPRESENT THE LATEST DATABASE STATE.»

«ALWAYS VERIFY BEFORE DECLARING COMPLETION.»

«EVERY COMPLETED TASK MUST BE COMMITTED AND PUSHED.»

«NEVER FORCE PUSH WITHOUT EXPLICIT AUTHORIZATION.»

«IF GIT PUSH FAILS, THE TASK IS NOT COMPLETE.»

«IF SOMETHING CANNOT BE VERIFIED, REPORT NOT VERIFIED.»

«GITHUB IS THE SHARED PROJECT STATE BETWEEN AI AGENTS.»

---

END OF AI_RULES.md
