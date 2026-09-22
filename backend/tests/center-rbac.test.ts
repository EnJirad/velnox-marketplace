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
const employeeManagerSrc = read("apps/velcenter/src/components/EmployeeManager.tsx");
const centerEventsSrc = read("apps/velcenter/src/lib/center-events.ts");
const apiRoutesSrc = read("packages/shared/src/lib/api-routes.ts");
const cartSrc = read("backend/routes/cart.ts");
const sellerOrdersSrc = read("backend/routes/seller-orders.ts");
const stripeSrc = read("backend/routes/stripe.ts");
const serverSrc = read("backend/server.ts");
const realtimeSrc = read("backend/realtime/index.ts");
const categoriesMgmtSrc = read("apps/velcenter/src/components/CategoriesManagement.tsx");

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
    for (const code of ["orders.view", "products.moderate", "sellers.manage", "audit.view"]) {
      expect(centerPage).toContain(`return holds("${code}");`);
    }
    // The people tab merges two independently-granted reads: the directory
    // (users.manage) and the employee roster (staff.manage).
    expect(centerPage).toContain('return holds("users.manage") || holds("staff.manage");');
    expect(centerPage).toContain('const canSeeDirectory = holds("users.manage");');
    expect(centerPage).toContain('const canReadEmployees = holds("staff.manage");');
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

describe("the staff read grant is reachable end to end", () => {
  test("the roster endpoint is the catalog code, mutations stay owner-only", () => {
    const list = centerSrc.indexOf('app.get("/api/admin/employees"');
    const route = centerSrc.slice(list, list + 800);
    // Membership to open VelCenter, then the grant to read the roster — the
    // same two checks a direct API call goes through when the UI is bypassed.
    expect(route).toContain("canReadCenter(req.user!.userId)");
    expect(route).toContain('userHasPermission(req.user!.userId, "staff.manage")');
  });

  test("a non-owner holder sees the roster, never the owner-only controls", () => {
    // Without this the grant was decorative: the endpoint served the roster but
    // the UI only ever rendered the manager for the owner.
    expect(employeeManagerSrc).toContain("export default function EmployeeManager({ readOnly = false }");
    expect(centerPage).toContain("<EmployeeManager readOnly />");
    expect(centerPage).toContain("<EmployeeManager readOnly={!isOwner} />");
    for (const control of ["setShowCreate", "handleReset", "openPermEditor", "handleToggleActive"]) {
      expect(employeeManagerSrc).toContain(`${control}`);
    }
    expect(employeeManagerSrc).toContain("{!readOnly && (");
    // The catalog it edits from is owner-only too — a read-only view must not call it.
    expect(employeeManagerSrc).toContain("if (readOnly) return;");
  });

  test("a failed roster read is an error state, not an empty list", () => {
    expect(employeeManagerSrc).not.toContain("setEmployees([])");
    expect(employeeManagerSrc).toContain("setError(err instanceof Error ? err.message");
    expect(employeeManagerSrc).toContain("ลองใหม่");
  });

  test("every employee broadcast reaches the UI", () => {
    // `employee:created` / `employee:updated` were broadcast while the client
    // ignored them, so another session's change needed a browser refresh.
    expect(centerSrc).toContain('"employee:created"');
    expect(centerSrc).toContain('"employee:updated"');
    expect(centerPage).toContain('msg.type === "employee:created" || msg.type === "employee:updated"');
    expect(centerPage).toContain('emitCenterEvent("staff")');
    expect(centerEventsSrc).toContain('"staff"');
    // both owners of the data re-read from the API
    expect(employeeManagerSrc).toContain('onCenterEvent("staff"');
    expect(centerPage).toContain('onCenterEvent("staff"');
  });
})

describe("client API mappings point at real endpoints", () => {
  test("the removed payout system leaves no client route behind", () => {
    // The catalog dropped `payouts.process` (no endpoint ever enforced it);
    // the client mappings promised the same missing API.
    for (const dead of [
      "/api/admin/payouts",
      "/api/admin/revenue",
      "/api/admin/recompute-balances",
      "/api/admin/rules",
      "/api/seller/payouts",
    ]) {
      expect(apiRoutesSrc).not.toContain(dead);
    }
    expect(apiRoutesSrc).not.toContain("processPayoutAction");
    expect(apiRoutesSrc).not.toContain("requestPayoutAction");
  });
})

describe("a failed read is never rendered as an empty state", () => {
  // The dangerous pattern is `catch { setRows([]) }`: a 500 or a DB error turns
  // into "there is no data", which reads as a fact instead of a failure.
  test("the overview queue counters keep the failure visible", () => {
    expect(centerPage).not.toContain("setSellerRows([])");
    expect(centerPage).not.toContain("setModProducts([])");
    expect(centerPage).not.toContain("setVerificationRows({ sellers: [], products: [] })");
    expect(centerPage).toContain("const [queueError, setQueueError] = useState<string | null>(null);");
    expect(centerPage).toContain("โหลดตัวเลขคิวงานไม่สำเร็จ");
  });

  test("the employee roster does the same", () => {
    expect(employeeManagerSrc).not.toContain("setEmployees([])");
  });
});

describe("realtime wiring has no dead end", () => {
  test("the orders channel is published to, not only subscribed to", () => {
    // The client subscribed to `order:updated` and wired the fan-out, but no
    // route ever published it — the subscription could never fire.
    expect(centerSrc).toContain('broadcast(CHANNELS.ORDER_UPDATED, "order:updated"');
    expect(centerPage).toContain('channel: "order:updated"');
    expect(centerPage).toContain('msg.type === "order:updated" || msg.type === "order:created"');
  });

  test("every writer that moves an order publishes on that channel", () => {
    // These three wrote `orders.status` silently: a transition reached other
    // sessions only through its audit event, so the orders tab could sit on a
    // stale status. center.ts already published; these are the rest.
    expect(cartSrc).toContain('broadcast(CHANNELS.ORDER_UPDATED, "order:updated"');
    expect(sellerOrdersSrc).toContain('broadcast(CHANNELS.ORDER_UPDATED, "order:updated"');
    expect(stripeSrc).toContain('broadcast(CHANNELS.ORDER_UPDATED, "order:updated"');
  });

  test("the config channel is registered, subscribable and published to", () => {
    // Categories and platform settings had no channel of their own, so another
    // open VelCenter session kept a stale tree/settings form until a refresh.
    expect(realtimeSrc).toContain('CONFIG_UPDATED: "config:updated"');
    // A channel the socket refuses to subscribe to can never be received.
    expect(realtimeSrc).toContain('msg.channel === "config:updated"');
    // Both config surfaces publish through the one choke point in server.ts.
    expect(serverSrc).toContain('broadcast(CHANNELS.CONFIG_UPDATED, "config:updated"');
    expect(serverSrc).toContain('"/api/admin/categories"');
    expect(serverSrc).toContain('"/api/admin/settings"');
    // A read or a rejected mutation must never announce a change.
    expect(serverSrc).toContain('res.statusCode >= 200 && res.statusCode < 300');
  });

  test("VelCenter consumes the config event instead of ignoring it", () => {
    expect(centerPage).toContain('channel: "config:updated"');
    expect(centerPage).toContain('msg.type === "config:updated"');
    expect(centerEventsSrc).toContain('"config"');
    expect(categoriesMgmtSrc).toContain('onCenterEvent("config"');
  });
});

describe("no client route mapping without a backend route", () => {
  test("the never-implemented mappings are gone", () => {
    // Each of these declared a path no backend route serves and no screen ever
    // called — dead entries that made the mapping table lie about the API.
    for (const dead of [
      '"api.commerce.customerRegulars"',
      '"api.memory.recommendForCustomer"',
      '"api.memory.dueReorderReminders"',
      '"api.memory.myMemory"',
      '"api.memory.flushToNeon"',
      '"api.sellerOps.myShipments"',
      '"api.sellerOps.createShipmentAction"',
      '"api.sellerOps.addTrackingEventAction"',
      '"api.sellerOps.sellerFinancialReportAction"',
      '"api.sellerOps.updateShopLocation"',
    ]) {
      expect(apiRoutesSrc).not.toContain(dead);
    }
    // The one memory endpoint the backend actually implements stays.
    expect(apiRoutesSrc).toContain('"api.memory.marketInsights"');
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
