/**
 * VelCenter RBAC guards.
 *
 * The permission catalog (`employees.permissions`) was written by the staff
 * editor but not enforced everywhere: role-only checks meant a staff account
 * either had blanket access (seller verification — any staff could approve a
 * real identity) or none at all, and granting a permission changed nothing.
 * `products.moderate` and `payouts.process` were offered in the catalog with no
 * endpoint behind them at all.
 *
 * These tests state the contract that makes the catalog real:
 *
 *   - ONE permission module; no second grant source, no second catalog
 *   - deny-by-default resolution (unknown role / malformed JSON / DB error)
 *   - every business surface is gated by its catalog code at the BACKEND
 *   - every catalog code is gated by at least one endpoint (no decorative
 *     checkbox), and identity/role/permission operations stay owner-only
 *   - `GET /api/auth/me` exposes the effective grants so the UI can hide what
 *     the account cannot use (UX only — the endpoint still enforces)
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const permissionsSrc = read("backend/lib/permissions.ts");
const centerSrc = read("backend/routes/center.ts");
const adminSrc = read("backend/routes/admin.ts");
const verificationSrc = read("backend/routes/verification.ts");
const sellerSrc = read("backend/routes/seller.ts");
const productsSrc = read("backend/routes/products.ts");
const authSrc = read("backend/routes/auth.ts");
const apiClientSrc = read("packages/shared/src/lib/api-client.ts");
const centerPage = read("apps/velcenter/src/pages/Center.tsx");

/** Every backend file that must not re-implement authorization itself. */
const routeSources = {
  center: centerSrc,
  admin: adminSrc,
  verification: verificationSrc,
  seller: sellerSrc,
  products: productsSrc,
};

describe("one permission system", () => {
  test("the catalog is declared exactly once, in lib/permissions.ts", () => {
    expect(permissionsSrc).toContain("export const PERMISSION_CATALOG");
    for (const src of Object.values(routeSources)) {
      expect(src).not.toContain("export const PERMISSION_CATALOG");
    }
  });

  test("the permission resolution lives in one module and nothing re-declares it", () => {
    expect(permissionsSrc).toContain("export async function userHasPermission");
    expect(permissionsSrc).toContain("export async function resolvePermissions");
    for (const src of Object.values(routeSources)) {
      expect(src).not.toContain("async function userHasPermission");
      expect(src).not.toContain("async function resolvePermissions");
    }
  });

  test("every guarded route imports the shared resolver", () => {
    for (const src of Object.values(routeSources)) {
      expect(src).toContain('from "../lib/permissions.js"');
    }
  });

  test("a staff grant comes from employees.permissions and nothing else", () => {
    expect(permissionsSrc).toContain("SELECT permissions FROM employees WHERE user_id = $1");
    expect(permissionsSrc).toContain("JSON.parse");
  });
});

describe("deny by default", () => {
  test("unknown / non-staff roles get nothing", () => {
    // A customer, seller or missing row must never read the center.
    expect(permissionsSrc).toContain('if (effectiveRole !== "staff") return [];');
    expect(permissionsSrc).toContain("export async function isCenterMember");
  });

  test("only owner/admin bypass the catalog", () => {
    expect(permissionsSrc).toContain("export const CENTER_ROLES");
    expect(permissionsSrc).toContain(
      'if (effectiveRole === "owner" || effectiveRole === "admin") return [...ALL_PERMISSION_CODES];',
    );
  });

  test("a parse or database failure denies instead of granting", () => {
    const resolver = permissionsSrc.slice(permissionsSrc.indexOf("export async function resolvePermissions"));
    const body = resolver.slice(0, resolver.indexOf("\n}"));
    expect(body).toContain("} catch {");
    expect(body).toContain("return [];");
    // the failure path must not fall through to the implicit full grant
    expect(body).not.toContain("return [...ALL_PERMISSION_CODES];\n  } catch");
  });
});

describe("business surfaces are gated by their catalog code", () => {
  test("orders read/write", () => {
    expect(centerSrc).toContain('userHasPermission(req.user!.userId, "orders.view")');
    expect(centerSrc).toContain('userHasPermission(req.user!.userId, "orders.manage")');
    // the old owner/admin-only guard made an `orders.manage` grant unusable
    expect(centerSrc).not.toContain("canWriteCenter");
  });

  test("customer directory", () => {
    expect(centerSrc).toContain('userHasPermission(req.user!.userId, "users.manage")');
  });

  test("audit trail", () => {
    expect(centerSrc).toContain('userHasPermission(req.user!.userId, "audit.view")');
  });

  test("staff directory", () => {
    expect(centerSrc).toContain('userHasPermission(req.user!.userId, "staff.manage")');
  });

  test("product moderation (list, detail, decision)", () => {
    // Must run the IDENTICAL guard at all three entry points.
    const guards = productsSrc.split("if (!(await requireModerator(req, res))) return;").length - 1;
    expect(guards).toBe(3);
    const gate = productsSrc.slice(productsSrc.indexOf("async function requireModerator"));
    const body = gate.slice(0, gate.indexOf("\n  }"));
    expect(body).toContain("isCenterMember(userId)");
    expect(body).toContain('userHasPermission(userId, "products.moderate")');
    // The old role-only check would leave the grant decorative.
    expect(productsSrc).not.toContain('["owner", "admin"].includes');
  });

  test("company / system settings", () => {
    // both the read and the write path
    expect(adminSrc.split('userHasPermission(userId, "settings.manage")').length - 1).toBeGreaterThanOrEqual(2);
  });

  test("seller verification decisions", () => {
    // Reviewer identity alone used to be enough — every staff account could
    // approve a real-world identity document.
    const reviewer = verificationSrc.slice(verificationSrc.indexOf("async function assertReviewer"));
    expect(reviewer.slice(0, reviewer.indexOf("\n  }"))).toContain('userHasPermission(userId, "sellers.manage")');
  });

  test("seller administration", () => {
    expect(sellerSrc.split('userHasPermission(userId, "sellers.manage")').length - 1).toBeGreaterThanOrEqual(3);
  });

  test("role / permission management stays owner-only", () => {
    // Loosening these would let staff escalate themselves or edit their own
    // grants, which is exactly what §9 forbids.
    expect(centerSrc).toContain("async function isOwner(userId: string)");
    for (const route of [
      'app.patch("/api/admin/users/:userId/access"',
      'app.post("/api/admin/employees"',
      'app.patch("/api/admin/staff"',
      'app.post("/api/admin/employees/:userId/reset-password"',
      'app.patch("/api/admin/employees/:userId/active"',
    ]) {
      const start = centerSrc.indexOf(route);
      expect(start).toBeGreaterThan(-1);
      expect(centerSrc.slice(start, start + 400)).toContain("isOwner(req.user!.userId)");
    }
  });

  test("no route decides authorization from the request body", () => {
    for (const src of Object.values(routeSources)) {
      expect(src).not.toContain("req.body.role ===");
      expect(src).not.toContain("req.body.permissions ===");
      expect(src).not.toContain("req.body.userId === req.user");
    }
  });
});

describe("the session profile carries what the UI needs", () => {
  test("/api/auth/me returns department (VelCenter scopes tabs by it)", () => {
    // Without this the browser saw department=null for everyone and a
    // department admin could never open Company/System Settings.
    expect(authSrc).toContain("role, status, department");
    expect(authSrc).toContain("department: u.department ?? null,");
  });

  test("/api/auth/me returns the effective grant list", () => {
    expect(authSrc).toContain("permissions: await resolvePermissions(payload.userId, u.role)");
    expect(permissionsSrc).toContain("export async function resolvePermissions");
  });

  test("the shared auth client maps the grant list", () => {
    expect(apiClientSrc).toContain("permissions: Array.isArray(raw.permissions)");
    expect(apiClientSrc).toContain("permissions?: string[];");
  });

  test("VelCenter offers a tab only for a grant it can actually use", () => {
    // One grant rule for the whole screen, shared with the session helper.
    expect(centerPage).toContain("const holds = (code: string) => roleHoldsPermission(role, permissions, code);");
    expect(apiClientSrc).toContain("export function roleHoldsPermission");
    for (const code of ["orders.view", "products.moderate", "sellers.manage", "users.manage", "audit.view"]) {
      expect(centerPage).toContain(`return holds("${code}");`);
    }
    // a granted write permission must also unlock the control it writes with
    expect(centerPage).toContain('holds("settings.manage")');
    expect(centerPage).toContain('const canManageOrders = holds("orders.manage");');
    // exactly one: the `canSee` helper that binds the policy to this session
    const pageBody = centerPage.slice(centerPage.indexOf("export default function Center()"));
    expect(pageBody.match(/canSeeTab\(/g)?.length ?? 0).toBe(1);
  });

  test("every catalog code is enforced by an endpoint", () => {
    const codes = [...permissionsSrc.matchAll(/\{ code: "([^"]+)"/g)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(0);
    const guarded = Object.values(routeSources).join("\n");
    // A code no guard ever checks is a checkbox that lies to the owner, so the
    // catalog and the enforcement must cover exactly the same set.
    const unenforced = codes.filter((code) => !guarded.includes(`"${code}"`));
    expect(unenforced).toEqual([]);
    expect(codes).not.toContain("payouts.process");
    expect(codes).toContain("products.moderate");
  });
});

describe("no resurrected duplicates", () => {
  test("the untracked product-status duplicate is gone", () => {
    // backend/lib/product-lifecycle.ts owns the product state machine; a second
    // copy of PRODUCT_STATUSES/transition tables is drift waiting to happen.
    expect(existsSync(join(root, "backend/lib/product-status.ts"))).toBe(false);
    expect(existsSync(join(root, "backend/lib/product-lifecycle.ts"))).toBe(true);
  });

  test("db/run-update.sql is never reintroduced", () => {
    expect(existsSync(join(root, "db/run-update.sql"))).toBe(false);
  });
});
