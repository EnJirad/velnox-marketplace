/**
 * VelCenter permissions — the single source of truth.
 *
 * VelCenter authorization is `ROLE + PERMISSION + RESOURCE`:
 *   * `owner` / `admin` implicitly hold every code in the catalog,
 *   * `staff` hold exactly the codes in `employees.permissions`, which the owner
 *     writes from this same catalog (`PATCH /api/admin/staff`).
 *
 * Both the API guards (`backend/routes/center.ts`, `admin.ts`, `products.ts`,
 * `seller.ts`, `verification.ts`) and the client-visible profile
 * (`GET /api/auth/me`) resolve through here, so the tab a user is offered and
 * the endpoint that backs it can never disagree.
 *
 * Frontend hiding is UX only — every guarded endpoint re-checks server-side.
 *
 * Deny by default: a missing employee row, malformed JSON or a database error
 * all resolve to "holds nothing" instead of throwing. An authorization lookup
 * must never fail open, and must never turn into a 500 a caller could mistake
 * for a pass.
 */
import { query } from "../db/index.js";

/**
 * The catalog VelCenter offers when granting permissions.
 *
 * A code belongs here only while at least one endpoint enforces it — a code
 * that guards nothing is a checkbox that lies to the owner who ticks it.
 * `payouts.process` was removed for exactly that reason: this repository has no
 * payout endpoint, table or screen, so the grant could never have done anything.
 */
export const PERMISSION_CATALOG: { code: string; label: string; description: string }[] = [
  { code: "orders.view", label: "ดูออเดอร์", description: "ดูรายการออเดอร์ทั้งหมด" },
  { code: "orders.manage", label: "จัดการออเดอร์", description: "เปลี่ยนสถานะออเดอร์" },
  { code: "products.moderate", label: "ตรวจสอบสินค้า", description: "อนุมัติ/ปฏิเสธสินค้าที่รอตรวจสอบ" },
  { code: "sellers.manage", label: "จัดการผู้ขาย", description: "อนุมัติ/ระงับผู้ขาย" },
  { code: "users.manage", label: "ดูบัญชีผู้ใช้", description: "ดูบัญชีผู้ใช้และลูกค้า (เปลี่ยนบทบาทเป็นสิทธิ์ของเจ้าของเท่านั้น)" },
  { code: "staff.manage", label: "จัดการพนักงาน", description: "ดูบัญชีพนักงาน" },
  { code: "audit.view", label: "ดู Audit Logs", description: "ดูบันทึกการดำเนินการสำคัญ" },
  { code: "settings.manage", label: "จัดการตั้งค่าระบบ", description: "แก้ไขการตั้งค่าแพลตฟอร์ม" },
];

/** Every code in the catalog — what owner/admin implicitly hold. */
export const ALL_PERMISSION_CODES: string[] = PERMISSION_CATALOG.map((p) => p.code);

/** The roles that may open VelCenter at all. */
export const CENTER_ROLES: string[] = ["owner", "admin", "staff"];

/** The role stored on `users.role`, or null when the account does not exist. */
export async function roleOf(userId: string): Promise<string | null> {
  const result = await query("SELECT role FROM users WHERE id = $1", [userId]);
  return (result.rows[0]?.role as string | undefined) ?? null;
}

/** May this account reach VelCenter data at all? Deny by default. */
export async function isCenterMember(userId: string): Promise<boolean> {
  const role = await roleOf(userId);
  return role !== null && CENTER_ROLES.includes(role);
}

/** Parse `employees.permissions`, which is JSONB in Neon but may arrive as a string. */
function parsePermissionList(raw: unknown): string[] {
  try {
    const list = Array.isArray(raw) ? raw : JSON.parse(typeof raw === "string" ? raw : "[]");
    return Array.isArray(list) ? list.filter((code): code is string => typeof code === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Every permission effective for this user.
 *
 * Pass `role` when the caller already selected it (avoids a second round trip).
 * A user who is neither owner/admin/staff — a customer or seller — holds none.
 */
export async function resolvePermissions(userId: string, role?: string | null): Promise<string[]> {
  try {
    const effectiveRole = role ?? (await roleOf(userId));
    if (effectiveRole === "owner" || effectiveRole === "admin") return [...ALL_PERMISSION_CODES];
    if (effectiveRole !== "staff") return [];

    const result = await query("SELECT permissions FROM employees WHERE user_id = $1 LIMIT 1", [userId]);
    if (result.rows.length === 0) return [];
    return parsePermissionList(result.rows[0].permissions);
  } catch {
    return [];
  }
}

/** Does this user hold `code`? The check every guarded endpoint runs. */
export async function userHasPermission(
  userId: string,
  code: string,
  role?: string | null,
): Promise<boolean> {
  return (await resolvePermissions(userId, role)).includes(code);
}
