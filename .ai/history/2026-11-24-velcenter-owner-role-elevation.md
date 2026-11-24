# VelCenter Owner Role Elevation & RBAC Constraint Alignment

**Execution Timestamp:** 2026-11-24
**Task:** Elevate Google account to `owner` role for initial VelCenter access and align RBAC constraints
**Status:** COMPLETED & VERIFIED
**Initiative:** Velnox Clean Rebuild Initiative

---

## 1. Summary of Work Completed
- **Neon PostgreSQL User Role Elevation:** Elevated Google OAuth account `ma0979354966.js91934@gmail.com` to `role = 'owner'` in Neon PostgreSQL. Maintained LINE account `u247143560c11a1ad878325803b19b8ad@line.velnox.live` as `customer` as instructed by the project owner.
- **Database CHECK Constraint Modernization:** Dropped obsolete constraint and added expanded `users_role_check` allowing `'customer', 'seller', 'center_staff', 'center_admin', 'center_superadmin', 'owner', 'admin', 'staff'` in both live Neon PostgreSQL, `db/run-sqleditor.sql`, `db/schema.sql`, and `workers/api/migrations/0001_identity.sql`.
- **Workers API Role Types & Guard Hardening:**
  - Updated `UserRecord['role']` in `workers/api/src/modules/identity/types.ts` to include `'owner'`, `'admin'`, `'staff'`.
  - Updated `requireRole` middleware in `workers/api/src/middleware/auth.ts` to include `'owner'` and `'staff'` in allowed types, and explicitly grant full access when `userRole === "owner"`.

---

## 2. Verification Summary
- Live Neon DB: `SELECT id, email, role FROM users` confirmed `ma0979354966.js91934@gmail.com` is `owner`.
- `bun --filter @velnox/api test`: 94/94 PASS
- `bun run typecheck:all`: ALL workspaces passed (0 errors)
- `bun run worker:build`: PASS (dist bundle generated via wrangler dry-run)
- `git diff --check`: PASS (clean)
