/**
 * VelCenter company control plane — staff/customer segmentation, the staff
 * audit trail, and the company/system settings contract.
 *
 * These guard four regressions that were live in production:
 *
 *   1. The staff tab listed EVERY account (staff and customers mixed together)
 *      and the browser had to guess which was which.
 *   2. `GET /api/admin/audit-logs` returned only a role + raw JSON, had no
 *      filters, and several staff decisions (settings changes, seller
 *      verification decisions) were never written to `audit_logs` at all.
 *   3. `GET /api/admin/settings` returned a flat key→value map while VelCenter
 *      read `res.settings`, so the settings form silently loaded empty.
 *   4. VelCenter's product inspection showed "V ✓" while the platform's single
 *      verification mark is the letter V.
 *
 * They also fail if a SECOND audit / settings / role system is introduced.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const serverSrc = read("backend/server.ts");
const centerSrc = read("backend/routes/center.ts");
const adminSrc = read("backend/routes/admin.ts");
const verificationSrc = read("backend/routes/verification.ts");
const uploadSrc = read("backend/routes/upload.ts");
const auditLibSrc = read("backend/lib/audit-log.ts");
const mediaConfigSrc = read("backend/lib/media-config.ts");
const schemaSql = read("db/schema.sql");
const sqlEditor = read("db/run-sqleditor.sql");

const centerPage = read("apps/velcenter/src/pages/Center.tsx");
const auditTab = read("apps/velcenter/src/components/AuditLogTab.tsx");
const moderationQueue = read("apps/velcenter/src/components/ProductModerationQueue.tsx");
const vBadge = read("packages/shared/src/components/VBadge.tsx");
const apiRoutes = read("packages/shared/src/lib/api-routes.ts");

/** Comments describe intent; only executable statements are asserted on. */
const statements = (src: string) =>
  src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
    .join("\n");

describe("staff vs customer directory", () => {
  test("segments are resolved from explicit role sets, never by elimination", () => {
    // A customer is a customer because users.role says so — NOT because the
    // account is "not staff". A NULL/unknown role must not be filed as one.
    expect(centerSrc).toContain("u.role = 'customer'");
    expect(centerSrc).toContain("u.role = 'seller'");
    expect(centerSrc).toContain("u.role IN ('owner', 'admin', 'staff')");
    // unknown roles are reported as null instead of being defaulted to customer
    expect(centerSrc).not.toContain('r.role ?? "customer"');
  });

  test("the query is validated and still requires center membership", () => {
    const route = centerSrc.slice(centerSrc.indexOf('"/api/admin/users"'));
    expect(route).toContain("requireAuth");
    expect(route).toContain("canReadCenter");
    expect(route).toContain('["all", "staff", "customer", "seller"]');
  });

  test("per-segment counts come from the same table as the rows", () => {
    const route = centerSrc.slice(centerSrc.indexOf('"/api/admin/users"'));
    expect(route).toContain("COUNT(*) FILTER (WHERE role IN ('owner', 'admin', 'staff')) AS staff");
    expect(route).toContain("COUNT(*) FILTER (WHERE role = 'customer') AS customer");
    expect(route).toContain("counts:");
    expect(route).toContain("isStaff:");
  });

  test("VelCenter renders two separate lists and no longer maps every user", () => {
    expect(centerPage).toContain('segment: "staff"');
    expect(centerPage).toContain('segment: "customer"');
    // the old single mixed list is gone
    expect(centerPage).not.toContain("useQuery(api.users.listUsers)");
    expect(statements(centerPage)).not.toContain("(users ?? [])");
  });

  test("employee management stays owner-only and the directory is owner/admin", () => {
    expect(centerPage).toContain('case "staff":\n      return role === "owner" || role === "admin";');
    expect(centerPage).toContain("{isOwner ? (");
    expect(centerSrc).toContain("isOwner(req.user!.userId)");
  });
});

describe("staff audit trail", () => {
  test("one audit table, one shared writer", () => {
    // No second audit table anywhere in the canonical schema.
    const auditTables = (schemaSql.match(/CREATE TABLE IF NOT EXISTS (\w*audit\w*)/g) ?? []).join(",");
    expect(auditTables).toBe("CREATE TABLE IF NOT EXISTS audit_logs");
    const sqlEditorTables = (sqlEditor.match(/CREATE TABLE IF NOT EXISTS (\w*audit\w*)/g) ?? []).join(",");
    expect(sqlEditorTables).toBe("CREATE TABLE IF NOT EXISTS audit_logs");
    // The rich writer lives in ONE place and is used by the routes.
    expect(auditLibSrc).toContain("export async function writeAuditLog");
    expect(centerSrc).toContain('import { auditClientIp, writeAuditLog } from "../lib/audit-log.js"');
    expect(adminSrc).toContain('import { auditClientIp, writeAuditLog } from "../lib/audit-log.js"');
    expect(verificationSrc).toContain('import { auditClientIp, writeAuditLog } from "../lib/audit-log.js"');
  });

  test("sensitive values can never reach the trail", () => {
    expect(auditLibSrc).toContain("sanitizeAuditDetails");
    expect(auditLibSrc).toContain("password|passwd|secret|token|hash|api[_-]?key|credential|authorization|cookie");
  });

  test("settings changes are audited with previous and new value", () => {
    expect(adminSrc).toContain('"SETTINGS_UPDATE"');
    expect(adminSrc).toContain("{ key, from: previousValue, to: value }");
  });

  test("every seller-verification decision is audited", () => {
    expect(verificationSrc).toContain("`SELLER_VERIFICATION_${historyAction.toUpperCase()}`");
    for (const action of ["approve", "reject", "suspend", "needs_correction"]) {
      expect(verificationSrc).toContain(`action === "${action}"`);
    }
  });

  test("the audit endpoint is owner/admin only and filters server-side", () => {
    const route = centerSrc.slice(centerSrc.indexOf('"/api/admin/audit-logs"'));
    expect(route).toContain("requireAuth");
    expect(route).toContain("canWriteCenter(req.user!.userId)");
    for (const filter of ["req.query.action", "req.query.entityType", "req.query.actorId", "req.query.from", "req.query.to", "req.query.q"]) {
      expect(route).toContain(filter);
    }
  });

  test("the audit endpoint answers who / what / before / after", () => {
    const route = centerSrc.slice(centerSrc.indexOf('"/api/admin/audit-logs"'));
    expect(route).toContain("auditLogsListSql(whereSql, limitParam, offsetParam)");
    expect(route).toContain("before");
    expect(route).toContain("after");
    expect(route).toContain("total:");

    const sql = centerSrc.slice(centerSrc.indexOf("export function auditLogsListSql"));
    expect(sql).toContain("u.name AS actor_name");
    expect(sql).toContain("u.email AS actor_email");
    expect(sql).toContain("target_label");
    expect(sql).toContain("al.ip_address");
  });

  test("the audit list statement only reads columns that exist", () => {
    // The seller label used to be `COALESCE(..., s.name, ...)` with s = sellers.
    // `sellers` has NO `name` column, so PostgreSQL answered 42703 ("column
    // s.name does not exist") for EVERY request and the Audit Logs tab rendered
    // empty — the endpoint 500'd before it returned a single row.
    const sql = centerSrc.slice(centerSrc.indexOf("export function auditLogsListSql"));
    expect(sql).not.toContain("s.name");
    expect(sql).toContain("LEFT JOIN users seller_user ON seller_user.id = s.user_id");
    expect(sql).toContain("seller_shop.name");

    // The canonical schema really has no sellers.name; the seller's identity
    // lives on users.name via sellers.user_id, and the shop label on shops.name.
    const sellersTable = schemaSql.slice(schemaSql.indexOf("CREATE TABLE IF NOT EXISTS sellers"));
    const sellersBody = sellersTable.slice(0, sellersTable.indexOf("\n);"));
    expect(sellersBody).not.toContain("name TEXT");
    expect(sellersBody).toContain("user_id UUID NOT NULL REFERENCES users(id)");
  });

  test("the endpoint and the production probe run the same statement", () => {
    // A probe with its own copy of the SQL could pass while the endpoint still
    // failed, so both call the single exported builder.
    expect(centerSrc).toContain("await query(auditLogsListSql(whereSql, limitParam, offsetParam), params)");
    expect(serverSrc).toContain('const { auditLogsListSql } = await import("./routes/center.js")');
    expect(serverSrc).toContain("auditLogsListSql(\"\", \"$1\", \"$2\")");
    // the probe stays aggregate-only: counts, never rows/names/IPs
    expect(serverSrc).toContain("SELECT COUNT(*)::int AS n FROM (");
    expect(serverSrc).toContain("SELECT COUNT(*)::int AS n FROM audit_logs");
  });

  test("VelCenter renders the trail with filters and shows failures honestly", () => {
    expect(auditTab).toContain("setError(");
    expect(auditTab).toContain("ลองใหม่");
    expect(auditTab).toContain("ACTION_LABELS");
    // no horizontal-scroll-only table on phones
    expect(auditTab).toContain("lg:hidden");
  });

  test("the audit action passes its filters through to the API", () => {
    expect(apiRoutes).toContain("/api/admin/audit-logs${buildQuery({");
    expect(apiRoutes).toContain("entityType: a?.entityType");
    expect(apiRoutes).toContain("actorId: a?.actorId");
  });
});

describe("company / system settings", () => {
  test("the settings payload matches what VelCenter reads", () => {
    // The screen iterates `res.settings`; the endpoint must return `settings`.
    expect(adminSrc).toContain("settings,");
    expect(adminSrc).toContain("meta: {");
    expect(centerPage).toContain("res?.settings ?? []");
    // and it must no longer return a bare key→value map
    expect(adminSrc).not.toContain("const settings: Record<string, string> = {};");
  });

  test("JSONB-encoded values are normalised on read", () => {
    expect(adminSrc).toContain("function unwrapSettingValue");
    expect(adminSrc).toContain("unwrapSettingValue(row.value)");
  });

  test("its value is the real one — commission, locales and upload limits are not invented", () => {
    expect(adminSrc).toContain("SELLER_COMMISSION_RATE");
    expect(adminSrc).toContain("SELLER_RETURN_COVERAGE");
    expect(mediaConfigSrc).toContain("export const MAX_UPLOAD_BYTES");
    // the enforced limit is imported from the shared module, not re-declared
    expect(uploadSrc).toContain('from "../lib/media-config.js"');
    expect(uploadSrc).not.toContain("10 * 1024 * 1024");
  });

  test("VelCenter calls it Company/System Settings, not Shop Settings", () => {
    expect(centerPage).toContain("ตั้งค่าระบบ");
    expect(centerPage).not.toContain("ตั้งค่าร้าน");
    // every section is backed by a real source
    for (const id of ["company", "marketplace", "commission", "localization", "media", "access"]) {
      expect(centerPage).toContain(`id: "${id}"`);
    }
  });

  test("only changed settings are written, so the trail has no noise", () => {
    expect(centerPage).toContain("const changed = entries.filter(");
    expect(centerPage).toContain("if (changed.length === 0)");
  });
});

describe("V mark", () => {
  test("the verified mark is the letter V and nothing else", () => {
    expect(moderationQueue).not.toContain("V ✓");
    expect(centerPage).not.toContain("V ✓");
    expect(auditTab).not.toContain("V ✓");
    // the shared component renders bare "V" inside its badge markup
    const badge = vBadge.slice(vBadge.indexOf("const badge = ("), vBadge.indexOf("// Mobile: use Sheet"));
    expect(badge).toContain("\n      V\n    </button>");
    expect(badge).not.toContain("BadgeCheck");
    expect(badge).not.toContain("<Check");
  });

  test("VelCenter uses the shared badge instead of its own markup", () => {
    expect(moderationQueue).toContain("SellerVMark");
    expect(moderationQueue).toContain("sellerOnly");
  });
});

describe("product inspection workspace", () => {
  test("every moderation-detail section the reviewer needs is rendered", () => {
    for (const section of [
      "รูปภาพสินค้า",
      "ร้านค้า / ผู้ขาย",
      "ประวัติการตรวจสอบ",
      "ข้อมูลสินค้า",
      "สต็อก",
      "ตัวเลือกสินค้า (Option groups)",
      "ความหลากหลายสินค้า (Variants)",
      "คุณสมบัติ (Attributes)",
    ]) {
      expect(moderationQueue).toContain(section);
    }
    // option groups used to be typed but never shown
    expect(moderationQueue).toContain("<OptionGroupsList groups={detailProduct.optionGroups} />");
  });

  test("the gallery is height-bounded on phones and unchanged on desktop", () => {
    // compact image stage on phones — a tall photo must never decide the height
    // of the whole inspection sheet
    expect(moderationQueue).toContain("h-[30dvh]");
    expect(moderationQueue).toContain("max-h-60");
    expect(moderationQueue).toContain("min-h-36");
    // desktop stage is untouched
    expect(moderationQueue).toContain("sm:h-[420px]");
    expect(moderationQueue).toContain("sm:max-h-none");
    // thumbnails scroll horizontally with snap
    expect(moderationQueue).toContain("snap-x");
    // full-screen sheet on phones, large dialog on desktop
    expect(moderationQueue).toContain("h-[100dvh]");
    expect(moderationQueue).toContain("sm:max-w-6xl");
    // stacked variants on mobile instead of a wide table
    expect(moderationQueue).toContain("md:hidden");
  });

  test("the phone layout is a purpose-built order, not a squeezed desktop", () => {
    // identity (name / V / shop / status / price / category) is first-class
    expect(moderationQueue).toContain("function ProductSummaryCard");
    expect(moderationQueue).toContain("ราคา");
    expect(moderationQueue).toContain("ไม่ระบุหมวดหมู่");
    // explicit mobile order …
    for (const order of ["order-1", "order-2", "order-3", "order-9", "order-10"]) {
      expect(moderationQueue).toContain(order);
    }
    // … and explicit desktop placement for the same nodes
    expect(moderationQueue).toContain("lg:col-start-1 lg:row-start-1");
    expect(moderationQueue).toContain("lg:col-start-2 lg:row-start-1");
    expect(moderationQueue).toContain("lg:items-start");
    // long sections collapse on phones only; desktop forces them open
    expect(moderationQueue).toContain("collapsible");
    expect(moderationQueue).toContain('cn(collapsible && !open && "hidden", "lg:block")');
    expect(moderationQueue).toContain("lg:pointer-events-none");
  });

  test("the inspection sheet has thumb-sized close controls", () => {
    // the dialog's built-in close button is 16px — replaced with a 40px one in
    // the pinned header so it is reachable one-handed
    expect(moderationQueue).toContain("showCloseButton={false}");
    expect(moderationQueue).toContain('aria-label="ปิดหน้าตรวจสอบสินค้า"');
    expect(moderationQueue).toContain('-mr-1 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full');
    // action buttons fill the width on phones so they cannot be mis-tapped
    expect(moderationQueue).toContain("env(safe-area-inset-bottom)");
  });

  test("approve/reject stay reachable in a pinned action bar", () => {
    expect(moderationQueue).toContain("Pinned action bar");
    expect(moderationQueue).toContain("DialogFooter className=\"shrink-0");
    expect(moderationQueue).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  test("a failed detail load shows an error with retry, never an empty dialog", () => {
    expect(moderationQueue).toContain("const [detailError, setDetailError] = useState<string | null>(null)");
    expect(moderationQueue).toContain('setDetailError(err instanceof Error ? err.message : "ไม่สามารถโหลดรายละเอียดสินค้าได้")');
    // and the dialog renders that error with a retry, not an empty body
    expect(moderationQueue).toContain("onClick={() => void loadDetail(detailProductId)}");
  });
});
