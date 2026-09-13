AI_RULES.md — Velnox Marketplace

Last updated: 2026-09-13

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

"Always inspect the current GitHub repository and actual source code before making changes."

If previous AI context conflicts with the current repository:

"THE CURRENT REPOSITORY WINS."

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

The AI MUST verify information against the current repository before acting.

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

1. Read "AI_RULES.md"
2. Read "AI_Handoff.md"
3. Read "INSTALLATION.md"
4. Read "VELNOX_DESIGN_THEME.md" when working on UI/UX
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

"Inspect the current repository instead of guessing."

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
- Follow existing naming conventions
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

7. DATABASE ARCHITECTURE

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

Neon stores the corresponding metadata and critical commerce state.

AI agents MUST NOT introduce a second competing source of truth.

---

8. DATABASE CANONICAL FILES

Velnox Marketplace uses TWO canonical SQL files:

db/schema.sql
db/run-sqleditor.sql

These are the ONLY current database snapshot/bootstrap files that must be maintained.

The previous:

db/run-update.sql

is NO LONGER USED.

"db/run-update.sql" MUST NOT be treated as a current database source.

If "db/run-update.sql" still exists in the repository, it should be removed as part of the database-file cleanup, provided the current repository and deployment workflow confirm that nothing actively depends on it.

AI agents MUST NOT recreate "db/run-update.sql".

AI agents MUST NOT add new functionality to "db/run-update.sql".

---

9. "db/schema.sql" MUST ALWAYS BE COMPLETE AND CURRENT

This is a MANDATORY RULE.

"db/schema.sql" is the authoritative representation of the CURRENT COMPLETE DATABASE SCHEMA.

It MUST contain everything that belongs to the current Velnox Marketplace database architecture.

It MUST NOT contain only:

- Newly added tables
- Recently changed tables
- Important tables
- A partial schema
- An old schema
- Only the original schema

It must represent the complete current state.

Whenever the project gains a database object, "db/schema.sql" MUST be updated.

This includes, where applicable:

- Tables
- Columns
- Data types
- Defaults
- Primary keys
- Foreign keys
- Unique constraints
- Check constraints
- Indexes
- PostgreSQL extensions
- PostgreSQL types/enums
- Functions
- Triggers
- Views
- Relationships
- Other database objects required by the application

If something was added to the database months ago and is still part of the current architecture, it MUST still exist in "db/schema.sql".

AI agents MUST NOT allow later additions to disappear from the current schema.

---

10. "db/run-sqleditor.sql" MUST ALWAYS BE A COMPLETE BOOTSTRAP

"db/run-sqleditor.sql" is the COMPLETE DATABASE BOOTSTRAP.

Its purpose is to allow Velnox Marketplace to create a NEW DATABASE from an empty PostgreSQL/Neon database and reach the CURRENT database schema in one run.

Therefore:

Empty Database
      ↓
db/run-sqleditor.sql
      ↓
CURRENT COMPLETE VELNOX DATABASE

The file MUST contain everything required to create the current database.

It MUST include all current database objects that belong in the production schema, including where applicable:

- All tables
- All columns
- All types
- All constraints
- All indexes
- All functions
- All triggers
- All views
- All required extensions
- All required relationships
- All other required PostgreSQL objects

A new database MUST NOT require an AI or developer to remember old database changes manually.

The goal is:

"Create a completely new Neon database and run "db/run-sqleditor.sql" once."

The resulting database MUST contain the complete current Velnox Marketplace schema.

---

11. FUTURE DATABASE CHANGES MUST UPDATE BOTH FILES

Whenever a database change is made, the AI MUST update BOTH:

db/schema.sql
db/run-sqleditor.sql

No exceptions.

Database changes include:

- New table
- New column
- Removed table
- Removed column
- Changed column
- Changed data type
- Default value
- Primary key
- Foreign key
- Unique constraint
- Check constraint
- Index
- Enum
- PostgreSQL type
- Function
- Trigger
- View
- Relationship
- Database behavior
- Structural change
- Any PostgreSQL schema change

The AI MUST NOT update only one file.

The AI MUST NOT leave either file outdated.

Required state:

db/schema.sql
        +
db/run-sqleditor.sql
        =
CURRENT COMPLETE DATABASE STATE

---

12. NEW TABLES AND LATER DATABASE FEATURES MUST NEVER BE LOST

This rule is especially important.

If a table is added later during development:

Initial schema
    ↓
New table added
    ↓
More columns added
    ↓
More indexes added
    ↓
More relationships added

then the final:

db/schema.sql

and:

db/run-sqleditor.sql

MUST contain the latest complete version.

They must not remain frozen at the original database structure.

For example, if the project originally had:

users
products
orders

and later added:

shops
sellers
product_variants
product_images
cart_items
payments
seller_verifications

then the current canonical schema/bootstrap MUST contain all of those objects if they still belong to the current architecture.

The AI MUST inspect the entire repository to determine the actual current state.

Never assume that a later-added feature is optional or can be omitted from the bootstrap.

---

13. FUTURE NEW DATABASE CREATION REQUIREMENT

The purpose of maintaining these two files is to make future database recreation simple and reliable.

A future developer or AI should be able to:

1. Create a new empty Neon PostgreSQL database
2. Open the SQL editor
3. Run "db/run-sqleditor.sql"
4. Obtain the complete current Velnox Marketplace database

There MUST NOT be a hidden requirement such as:

"Run the original schema first."

"Then find migration V0034."

"Then run V0035."

"Then remember another table added later."

"Then manually add another index."

The current bootstrap MUST contain the complete current schema.

---

14. NO COMMENTS IN THE TWO CANONICAL SQL FILES

The following files MUST NOT contain SQL comments:

db/schema.sql
db/run-sqleditor.sql

Do not add comments such as:

-- create users
-- migration
-- fix
-- important
-- temporary
-- V0034

Do not add explanatory comments.

Do not add AI-generated notes.

Do not add TODO comments.

Do not add historical explanations.

The files should contain clean executable SQL.

If explanation is necessary, put it in:

- AI_Handoff.md
- AI_RULES.md
- Final AI report

NOT inside the two canonical SQL files.

---

15. DATABASE FILES MUST NOT BECOME HISTORICAL PATCH FILES

"db/schema.sql" and "db/run-sqleditor.sql" are current-state files.

They are NOT a chronological list of every change ever made.

Do not append old migrations to them simply because those migrations once existed.

Instead:

- Resolve the final current schema
- Represent the current schema directly
- Preserve current functionality
- Preserve required relationships
- Preserve required constraints
- Preserve required indexes
- Preserve required functions/triggers/views
- Remove obsolete historical implementation details when they are no longer part of the current schema

The goal is a clean current-state database definition.

---

16. MIGRATION HISTORY

Existing migration history may exist under:

db/migrations/*.sql

Migration files represent historical database changes and MUST NOT be rewritten merely to make the current schema look cleaner.

Historical migrations MUST NOT be modified to hide previous database history.

Do not delete historical migrations merely because the current bootstrap contains their final result.

However, historical migrations are NOT a substitute for maintaining:

db/schema.sql
db/run-sqleditor.sql

The current canonical schema/bootstrap MUST always contain the final current state.

AI agents MUST inspect the current repository before deciding whether an existing migration workflow is still actively used.

Do not create a new migration framework.

Do not create a second migration system.

---

17. "db/run-update.sql" IS DEPRECATED AND MUST NOT BE USED

The project no longer uses:

db/run-update.sql

AI agents MUST NOT:

- Recreate it
- Update it
- Add new SQL to it
- Treat it as a current source of truth
- Require it for creating a new database
- Reference it as a required database file

The two canonical database files are:

db/schema.sql
db/run-sqleditor.sql

If the file exists, inspect the current repository and dependency references before removing it.

If no active system depends on it, remove it.

Do not replace it with another file of the same purpose.

---

18. DATABASE DEPENDENCY ORDER

"db/run-sqleditor.sql" MUST use valid PostgreSQL dependency ordering.

Before modifying it, inspect dependencies between:

- Extensions
- Types
- Tables
- Foreign keys
- Indexes
- Functions
- Triggers
- Views
- Other database objects

A referenced table MUST exist before a foreign key depends on it, unless PostgreSQL's valid deferred creation strategy is intentionally used.

For example:

If:

product_verifications

references:

products

then the bootstrap MUST ensure that "products" exists before creating the dependency.

If:

product_images

references:

product_variants

then the bootstrap MUST ensure that "product_variants" exists before the dependency is created.

The AI MUST inspect ALL such dependencies rather than fixing only the first error encountered.

---

19. POSTGRESQL SYNTAX MUST BE VALID

The AI MUST verify that all SQL is valid PostgreSQL syntax.

Pay special attention to:

- UNIQUE constraints
- Expression indexes
- CHECK constraints
- Foreign keys
- Default expressions
- PostgreSQL types
- Functions
- Triggers
- Views
- Extensions
- Dependency ordering

For example, PostgreSQL table-level "UNIQUE" constraints cannot simply contain arbitrary expressions such as:

UNIQUE (
    cart_id,
    product_id,
    COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
)

If the actual root cause is an expression being used where PostgreSQL requires an index, use the correct PostgreSQL mechanism, such as an expression-based unique index, while preserving the intended behavior.

Do not change business logic merely to bypass SQL syntax errors.

---

20. ROOT CAUSE DATABASE RULE

When a database problem occurs:

SQL Error
    ↓
Trace dependency
    ↓
Inspect actual schema
    ↓
Inspect application usage
    ↓
Identify root cause
    ↓
Apply smallest correct fix
    ↓
Synchronize schema.sql
    ↓
Synchronize run-sqleditor.sql
    ↓
Verify

Do not fix database problems with:

- Random retries
- Arbitrary delays
- Fake success
- Dropping tables
- Resetting the database
- Creating duplicate tables
- Creating duplicate columns
- Creating duplicate APIs
- Hiding SQL errors

---

21. DATABASE SOURCE CODE COMPATIBILITY

Before changing a database object, inspect the application source code that uses it.

Search for:

- Table names
- Column names
- SQL queries
- Joins
- Inserts
- Updates
- Deletes
- Foreign keys
- API endpoints
- Backend services
- Transactions
- Commerce logic

The database definition MUST remain compatible with the actual application.

Never change a table or column based only on the SQL file.

---

22. NO DUPLICATE DATABASE SYSTEMS

Before creating a:

- Table
- Column
- Index
- Function
- Trigger
- View
- Relationship
- API
- Service

search the repository first.

If an existing canonical system already handles the requirement:

"Reuse or extend it."

Do not create:

products_v2
orders_v2
users_new
new_products
alternative_orders

or equivalent duplicate systems unless explicitly authorized.

---

23. DATABASE ARCHITECTURE MUST NOT CHANGE

AI agents MUST NOT independently decide to:

- Replace Neon
- Add another database
- Move critical commerce data to Convex
- Make R2 the source of truth
- Store critical commerce state only in object storage
- Introduce another competing database
- Replace the backend database architecture
- Introduce an ORM solely to solve a SQL issue

Current architecture remains:

Frontend
    ↓
Backend API
    ↓
Neon PostgreSQL

and:

R2
=
Binary Storage

Neon
=
Metadata + Critical Commerce Data

---

24. DATABASE SAFETY

Never execute destructive database operations without explicit authorization.

Never:

DROP DATABASE
DROP SCHEMA
DROP TABLE
TRUNCATE

against production data without explicit authorization.

Never reset the production database to solve a development problem.

Never delete production data to make tests pass.

Never treat production data as disposable test data.

---

25. SECURITY RULES

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

26. SECRET MANAGEMENT

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

27. API RULES

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

28. CANONICAL SELLER STATUS

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

29. APPLICATION ARCHITECTURE

Current application structure:

apps/velshop/       → Customer marketplace
apps/velseller/     → Seller management
apps/velcenter/     → Admin management
apps/velnox/        → Corporate website

backend/            → Express API server

packages/shared/    → Shared code

db/                 → Database schema and database history

Key invariants:

Neon PostgreSQL = source of truth
Frontend = never directly connects to DB
Frontend = never contains server secrets
Backend = server-side gateway
R2 = binary storage
Neon = metadata and critical commerce data

AI agents MUST preserve these invariants.

Do not change architecture without explicit authorization.

---

30. FRONTEND RULES

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

---

31. UI/UX CHANGE RULE

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

32. PERFORMANCE RULES

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

33. FILE UPLOAD RULES

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

34. DOCUMENTATION RULES

When architecture changes:

Update:

AI_Handoff.md

When installation/deployment changes:

Update:

INSTALLATION.md

When database changes:

Update:

db/schema.sql
db/run-sqleditor.sql

When a permanent AI rule changes:

Update:

AI_RULES.md

Documentation MUST reflect the current implementation.

Do not document features that do not actually exist.

Do not claim an implementation is complete if the source code does not support the documentation.

---

35. AI_HANDOFF RULES

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

"AI_Handoff.md is NOT more authoritative than the current source code."

If the handoff document conflicts with the actual repository:

"The repository wins."

---

36. MULTI-AI COLLABORATION

Multiple AI agents may work on the same project.

GitHub is the shared synchronization point.

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

"Nobody changed this because I did not see it in my previous context."

---

37. GIT RULE — MANDATORY

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

38. COMMIT MESSAGE RULES

Commit messages MUST describe the actual change.

Valid examples:

feat: add seller verification
fix: repair google authentication
fix(db): repair database schema
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

39. NEVER FORCE PUSH

Never use:

git push --force
git push -f

unless explicitly instructed by the project owner.

A force push can destroy another AI's work.

---

40. GIT CONFLICT RULE

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

41. ROOT CAUSE RULE

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

unless the workaround is explicitly part of the intended architecture.

---

42. NO FAKE IMPLEMENTATION

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

43. PRESERVE EXISTING FUNCTIONALITY

When implementing a requested change:

"Change what is necessary. Preserve everything else."

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

44. TESTING RULES

Testing requirements depend on the change.

At minimum, the AI MUST verify relevant areas.

For frontend changes:

- TypeScript
- Build
- Affected page
- Responsive behavior
- Existing interaction

For backend changes:

- TypeScript
- Build
- Affected API
- Authentication
- Authorization
- Error handling

For database changes:

- SQL syntax
- Schema consistency
- Bootstrap consistency
- Queries
- Constraints
- Affected API
- Application compatibility

For authentication changes:

- Login
- Logout
- Session
- OAuth
- Authorization
- Redirect behavior

Never claim tests passed if they were not actually run.

If something cannot be verified:

NOT VERIFIED

must be reported.

---

45. BUILD AND TYPECHECK

Before declaring completion when applicable:

TypeScript typecheck = PASS
Build = PASS

The AI MUST NOT knowingly introduce new TypeScript errors.

If an existing unrelated error prevents verification, report it explicitly.

Do not hide or suppress errors simply to make the build appear successful.

---

46. DEPLOYMENT RULES

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

47. ENVIRONMENT RULES

Before changing environment variables:

1. Identify where the variable is used
2. Identify whether it is client-side or server-side
3. Check deployment requirements
4. Check local development requirements
5. Update documentation if necessary

Do not rename environment variables arbitrarily.

Do not create duplicate environment variables for the same purpose.

---

48. API AND DATABASE OWNERSHIP

The frontend MUST NOT decide whether a user is allowed to perform an operation.

The backend MUST enforce:

- Authentication
- Authorization
- Ownership
- Seller status
- Admin permissions
- Resource access

Frontend checks are for UX only.

They are NOT security boundaries.

---

49. PRODUCT AND COMMERCE DATA

Critical commerce data MUST remain authoritative in Neon.

This includes, where applicable:

- Users
- Sellers
- Shops
- Products
- Product variants
- Orders
- Order items
- Payments
- Financial records
- Commerce relationships

Do not create a second database containing competing versions of critical commerce data.

---

50. R2 DATA RULE

R2 stores binary objects.

Neon stores metadata and references.

Do not store critical commerce state only inside R2.

Do not treat an object-storage URL as the database source of truth.

---

51. ERROR HANDLING

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

52. LOGGING RULES

Logs MUST help diagnose real problems.

Useful logs may include:

- Request ID
- Operation
- Duration
- Status
- Relevant non-sensitive identifiers
- Database timing
- External service timing

Never log:

- Passwords
- JWT secrets
- OAuth client secrets
- Database URLs containing credentials
- R2 secrets
- Session secrets
- Private tokens
- Sensitive personal information

---

53. CHANGE SCOPE RULE

If the user asks:

"Fix X"

the default scope is:

"Fix X"

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

54. NO DUPLICATE SYSTEMS

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

"Reuse or extend it."

Do not create parallel implementations.

---

55. DESIGN SYSTEM RULE

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

56. RESPONSIVE DESIGN RULE

Every UI change MUST consider:

- Mobile
- Tablet
- Desktop

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

57. ACCESSIBILITY RULE

Do not intentionally remove:

- Keyboard navigation
- Focus states
- Labels
- Accessible names
- Semantic elements
- Useful error messages

Interactive elements MUST remain usable.

---

58. DOCUMENTATION VS SOURCE CODE

Documentation describes the project.

The actual implementation defines the project.

If documentation says:

"Feature A exists"

but the current source does not contain Feature A:

"Do not pretend it exists."

Inspect the source and update documentation when appropriate.

---

59. NO UNAUTHORIZED ARCHITECTURE CHANGE

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

60. WHEN REQUIREMENTS ARE AMBIGUOUS

If a request is ambiguous but can safely be implemented using the existing architecture:

"Prefer the smallest reasonable interpretation."

If ambiguity could cause:

- Data loss
- Security problems
- Architecture changes
- Breaking changes
- Major UX changes
- Production damage

the AI MUST stop and clarify before proceeding.

---

61. BEFORE COMMITTING

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
- Accidental recreation of "db/run-update.sql"

---

62. DATABASE FINAL CHECK

If the task touched the database, verify:

[ ] db/schema.sql updated
[ ] db/run-sqleditor.sql updated
[ ] db/run-update.sql is NOT used
[ ] Current schema is complete
[ ] Bootstrap is complete
[ ] All later-added database objects are included
[ ] Schema and bootstrap are synchronized
[ ] SQL syntax verified
[ ] Dependencies verified
[ ] Affected queries verified
[ ] Application compatibility verified

If "db/run-update.sql" is recreated or used as a required current database file:

"The database task is NOT complete."

---

63. COMPLETE DATABASE SNAPSHOT RULE

At every database change, the AI MUST ask:

"ถ้าพรุ่งนี้ต้องสร้าง Neon Database ใหม่จากศูนย์ เราสามารถรัน "db/run-sqleditor.sql" เพียงครั้งเดียวแล้วได้ Database ปัจจุบันครบทุกอย่างหรือไม่?"

If the answer is NO:

"The database task is NOT complete."

The AI MUST update the canonical files until the current schema can be recreated completely.

This includes database features added months earlier.

Nothing that is still part of the current architecture may be omitted merely because it was added later.

---

64. FINAL VERIFICATION CHECKLIST

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
[ ] db/run-update.sql NOT used
[ ] Database schema is complete
[ ] Bootstrap is complete
[ ] Later-added tables and objects are included
[ ] No SQL comments exist in schema.sql
[ ] No SQL comments exist in run-sqleditor.sql
[ ] git status reviewed
[ ] git diff reviewed
[ ] git diff --check passed
[ ] Commit created
[ ] Git push completed
[ ] Working tree verified

---

65. DO NOT SAY "DONE" PREMATURELY

The AI MUST NOT say:

- Done
- Completed
- Finished
- Fixed
- Successfully implemented

until the required verification has been performed.

If something could not be verified, explicitly say:

NOT VERIFIED

If Git push failed:

Git push: FAIL
Task status: NOT COMPLETE

---

66. FINAL REPORT FORMAT

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

Database schema:
COMPLETE / INCOMPLETE / NOT VERIFIED

Database bootstrap:
COMPLETE / INCOMPLETE / NOT VERIFIED

Schema synchronization:
PASS / FAIL / NOT VERIFIED

db/run-update.sql:
NOT USED

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

67. GOLDEN RULE

The following rules are absolute:

"NEVER GUESS."

"ALWAYS INSPECT THE CURRENT GITHUB REPOSITORY BEFORE MODIFYING THE PROJECT."

"CURRENT GITHUB STATE HAS PRIORITY OVER STALE AI MEMORY OR PREVIOUS CONVERSATIONS."

"NEVER OVERWRITE ANOTHER AI'S WORK BLINDLY."

"FIX ROOT CAUSES, NOT SYMPTOMS."

"PRESERVE EXISTING FUNCTIONALITY."

"DO NOT CREATE DUPLICATE SYSTEMS."

"NEVER EXPOSE SECRETS."

"NEVER LET THE FRONTEND BYPASS BACKEND AUTHORIZATION."

"NEVER LET THE FRONTEND BECOME THE DATABASE SOURCE OF TRUTH."

"NEON POSTGRESQL IS THE SOURCE OF TRUTH FOR CRITICAL COMMERCE DATA."

"R2 STORES BINARIES; NEON STORES METADATA AND CRITICAL COMMERCE DATA."

""db/schema.sql" MUST ALWAYS REPRESENT THE COMPLETE CURRENT DATABASE SCHEMA."

""db/run-sqleditor.sql" MUST ALWAYS REPRESENT THE COMPLETE CURRENT DATABASE BOOTSTRAP."

"EVERY DATABASE CHANGE MUST UPDATE BOTH CANONICAL SQL FILES."

"NO DATABASE CHANGE IS COMPLETE IF "db/schema.sql" OR "db/run-sqleditor.sql" IS OUTDATED."

"ALL TABLES, COLUMNS, INDEXES, CONSTRAINTS, FUNCTIONS, TRIGGERS, VIEWS, TYPES, AND OTHER CURRENT DATABASE OBJECTS MUST BE REPRESENTED IN THE CURRENT SCHEMA."

"LATER-ADDED DATABASE OBJECTS MUST ALWAYS BE INCORPORATED INTO THE CURRENT COMPLETE SCHEMA."

"A NEW EMPTY NEON DATABASE MUST BE ABLE TO REACH THE CURRENT VELNOX DATABASE STATE BY RUNNING "db/run-sqleditor.sql"."

""db/run-update.sql" IS NO LONGER USED."

"DO NOT RECREATE "db/run-update.sql"."

""db/schema.sql" AND "db/run-sqleditor.sql" MUST NOT CONTAIN SQL COMMENTS."

"DO NOT USE HISTORICAL MIGRATIONS AS A SUBSTITUTE FOR THE CURRENT COMPLETE BOOTSTRAP."

"DO NOT CREATE A NEW MIGRATION SYSTEM."

"DO NOT CHANGE ARCHITECTURE WITHOUT EXPLICIT AUTHORIZATION."

"ALWAYS VERIFY BEFORE DECLARING COMPLETION."

"EVERY COMPLETED TASK MUST BE COMMITTED AND PUSHED."

"NEVER FORCE PUSH WITHOUT EXPLICIT AUTHORIZATION."

"IF GIT PUSH FAILS, THE TASK IS NOT COMPLETE."

"IF SOMETHING CANNOT BE VERIFIED, REPORT NOT VERIFIED."

"GITHUB IS THE SHARED PROJECT STATE BETWEEN AI AGENTS."

---

END OF AI_RULES.md
