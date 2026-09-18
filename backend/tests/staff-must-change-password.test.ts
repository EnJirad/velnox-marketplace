/**
 * VelCenter staff force-password-change + audit permission enforcement.
 *
 * These cover two things that silently break because the UI looks finished
 * while the backend cannot support it:
 *
 *   1. The "set a new password on first sign-in" gate. `ChangePasswordScreen`
 *      and the gate in `Center.tsx` already existed, and
 *      `POST /api/admin/employees` already answered `mustChangePassword: true`,
 *      but `users.must_change_password` did not exist — so the flag could never
 *      be stored, `/api/auth/me` could never report it, and the change-password
 *      endpoint demanded a `currentPassword` the first-login screen does not
 *      have. The feature was unreachable in every direction.
 *   2. `GET /api/admin/audit-logs` guarded by role instead of the `audit.view`
 *      permission from the catalog.
 *
 * Unit + static assertions only — no database required.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { hashPassword, isPasswordHashFormat, verifyPassword } from "../lib/password.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

const schema = read("db/schema.sql");
const bootstrap = read("db/run-sqleditor.sql");
const migration = read("db/migrations/046_staff_must_change_password.sql");
const authRoute = read("backend/routes/auth.ts");
const centerRoute = read("backend/routes/center.ts");
const auditLog = read("backend/lib/audit-log.ts");
const permissionsLib = read("backend/lib/permissions.ts");
const realtime = read("backend/realtime/index.ts");
const apiClient = read("packages/shared/src/lib/api-client.ts");
const changeScreen = read("apps/velcenter/src/components/ChangePasswordScreen.tsx");
const auditTab = read("apps/velcenter/src/components/AuditLogTab.tsx");
const centerPage = read("apps/velcenter/src/pages/Center.tsx");

// ─── Credential handling (pure) ────────────────────────────────────────────

describe("password hashing", () => {
  test("a correct password verifies and a wrong one does not", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("CORRECT HORSE BATTERY STAPLE", hash)).toBe(false);
  });

  test("the stored hash never contains the plaintext", async () => {
    const password = "Sup3rSecret!";
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    expect(hash.startsWith("$scrypt$")).toBe(true);
  });

  test("the same password hashes differently each time (random salt)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  test("malformed stored hashes are rejected instead of throwing", async () => {
    for (const bad of ["", "no-separator", "$scrypt$", "$scrypt$1$2$3", "$bcrypt$whatever", "$scrypt$16384$8$1$salt"]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  test("isPasswordHashFormat distinguishes password accounts from OAuth-only", () => {
    expect(isPasswordHashFormat("$scrypt$16384$8$1$aa$bb")).toBe(true);
    expect(isPasswordHashFormat(null)).toBe(false);
    expect(isPasswordHashFormat("")).toBe(false);
    expect(isPasswordHashFormat("a1b2c3")).toBe(false);
  });
});

// ─── Schema availability (the repo's database rule) ────────────────────────

describe("must_change_password column", () => {
  test("db/schema.sql and db/run-sqleditor.sql stay identical", () => {
    expect(schema).toBe(bootstrap);
  });

  test("both bootstrap files declare the column on users", () => {
    for (const file of [schema, bootstrap]) {
      expect(file).toContain("must_change_password BOOLEAN NOT NULL DEFAULT FALSE");
    }
  });

  test("both bootstrap files self-heal a database created before the column", () => {
    for (const file of [schema, bootstrap]) {
      expect(file).toContain(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE",
      );
    }
  });

  test("migration 046 is idempotent and non-destructive", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS must_change_password");
    expect(migration).not.toMatch(/DROP COLUMN|SET NOT NULL|DELETE FROM|UPDATE users/i);
  });

  test("migration 046 does not reuse an existing number", () => {
    // 045 is `045_media_column_naming.sql`; a collision makes the runner
    // apply only one of them (see the V0035 incident).
    expect(migration).toContain("-- Migration: V0046");
    expect(migration).not.toContain("V0045");
  });
});

// ─── The flag is actually produced and consumed ────────────────────────────

describe("force-change wiring", () => {
  test("creating an employee stores the flag alongside the temp password", () => {
    expect(centerRoute).toContain("status, password_hash, must_change_password");
    expect(centerRoute).toContain("'active', $5, TRUE)");
  });

  test("a password reset re-arms the flag", () => {
    expect(centerRoute).toContain("password_hash = $1, must_change_password = TRUE");
  });

  test("the employee list reports the real flag, not a placeholder", () => {
    expect(centerRoute).toContain("u.must_change_password");
    expect(centerRoute).toContain("mustChangePassword: r.must_change_password === true");
    expect(centerRoute).not.toContain("mustChangePassword: false");
  });

  test("/api/auth/me returns the flag and the department the tab gate needs", () => {
    expect(authRoute).toContain("department, must_change_password, created_at, updated_at");
    expect(authRoute).toContain("mustChangePassword: u.must_change_password === true");
    expect(authRoute).toContain("department: u.department ?? null");
  });

  test("the frontend maps the flag onto the shared auth state", () => {
    expect(apiClient).toContain("mustChangePassword: raw.mustChangePassword === true");
  });

  test("the first-login screen refetches auth so the gate can unmount", () => {
    // Without this the employee is trapped on the change-password screen: the
    // auth state is a cached singleton and never notices the cleared flag.
    expect(changeScreen).toContain("refetchCurrentUser()");
  });
});

describe("change-password endpoint", () => {
  test("does not demand currentPassword while a forced change is pending", () => {
    expect(authRoute).toContain("const forcedChange = user.must_change_password === true");
    expect(authRoute).toContain("if (!forcedChange)");
  });

  test("still requires currentPassword for a voluntary change", () => {
    expect(authRoute).toContain('message: "Current password is required"');
    expect(authRoute).toContain('message: "Current password is incorrect"');
  });

  test("clears the flag and invalidates the cached profile on success", () => {
    expect(authRoute).toContain("must_change_password = FALSE");
    expect(authRoute).toContain("invalidateCachedProfile(payload.userId)");
  });

  test("audits the change without recording any credential", () => {
    expect(authRoute).toContain('"PASSWORD_CHANGE"');
    expect(authRoute).toContain("forced: forcedChange");
    // The audit payload must not include the password fields.
    expect(authRoute).not.toMatch(/writeAuditLog\([^)]*newPassword/);
    expect(authRoute).not.toMatch(/writeAuditLog\([^)]*currentPassword/);
  });
});

// ─── Audit log access + realtime ───────────────────────────────────────────

describe("audit log access control", () => {
  test("audit-logs is permission-checked, not role-checked", () => {
    const route = centerRoute.slice(
      centerRoute.indexOf('app.get("/api/admin/audit-logs"'),
      centerRoute.indexOf('app.get("/api/admin/permissions"'),
    );
    expect(route).toContain('userHasPermission(req.user!.userId, "audit.view")');
    expect(route).not.toContain("canWriteCenter");
  });

  test("owner and admin hold every permission; staff come from the catalog", () => {
    expect(permissionsLib).toContain('if (effectiveRole === "owner" || effectiveRole === "admin") return [...ALL_PERMISSION_CODES];');
    expect(permissionsLib).toContain("SELECT permissions FROM employees WHERE user_id = $1");
    // ONE resolver. A second copy in a route would drift from the catalog the
    // owner grants through, which is exactly how a grant stops working.
    expect(centerRoute).not.toContain("JSON.parse(raw || \"[]\")");
  });

  test("a permission grant is visible immediately, not after the profile cache TTL", () => {
    // `/api/auth/me` publishes the resolved permissions, so a grant/revoke that
    // left the cached payload in place would keep offering the old tabs for up
    // to 30 seconds.
    expect(centerRoute).toContain("invalidateCachedProfile(userId);");
    expect(centerRoute).toContain("invalidateCachedProfile(targetUserId);");
    expect(authRoute).toContain("permissions: await resolvePermissions(payload.userId, u.role)");
  });

  test("the client receives the permissions and gates on them", () => {
    expect(apiClient).toContain("export function userHasPermission");
    expect(apiClient).toContain("permissions: Array.isArray(raw.permissions)");
    // The audit tab is offered on the same code the endpoint checks.
    expect(auditTab).toContain('userHasPermission(user, "audit.view")');
    expect(centerPage).toContain('(permissions ?? []).includes("audit.view")');
  });

  test("the audit tab returns null AFTER its hooks, never before", () => {
    // `user` is null until the auth state resolves, so an early return placed
    // above the hooks changes the hook count on the next render and React throws
    // "Rendered more hooks than during the previous render" — the tab dies for
    // exactly the users allowed to see it.
    const guard = auditTab.indexOf("if (!canViewAudit) return null;");
    const lastHook = auditTab.lastIndexOf("useMemo(");
    expect(guard).toBeGreaterThan(-1);
    expect(lastHook).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(lastHook);
  });
});

describe("audit realtime", () => {
  test("the audit:created channel is defined and subscribable", () => {
    expect(realtime).toContain('AUDIT_CREATED: "audit:created"');
    expect(realtime).toContain('msg.channel === "audit:created"');
  });

  test("every audit write broadcasts — from the single choke point", () => {
    expect(auditLog).toContain('broadcast(CHANNELS.AUDIT_CREATED, "audit:created"');
    // The payload is a signal only: no details, no credentials.
    expect(auditLog).toContain("{ action, entityType }");
  });
});
