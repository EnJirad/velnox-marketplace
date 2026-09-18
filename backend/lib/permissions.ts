/**
 * VelCenter permissions — the single source of truth.
 *
 * VelCenter authorization is `ROLE + PERMISSION + RESOURCE`:
 *   * `owner` / `admin` implicitly hold every code in the catalog,
 *   * `staff` hold exactly the codes in `employees.permissions`, which the owner
 *     writes from this same catalog (`PATCH /api/admin/staff`).
 *
 * Both the API guards (`backend/routes/center.ts`) and the client-visible
 * profile (`GET /api/auth/me`) resolve through here, so the tab a user is
 * offered and the endpoint that backs it can never disagree.
 *
 * Frontend hiding is UX only — every guarded endpoint re-checks server-side.
 */
import { query } from "../db/index.js";

/** The catalog VelCenter offers when granting permissions. */
export const PERMISSION_CATALOG: { code: string; label: string; description: string }[] = [
  { code: "orders.view", label: "ดูออเดอร์", description: "ดูรายการออเดอร์ทั้งหมด" },
  { code: "orders.manage", label: "จัดการออเดอร์", description: "เปลี่ยนสถานะออเดอร์" },
  { code: "products.moderate", label: "ตรวจสอบสินค้า", description: "อนุมัติ/ปฏิเสธสินค้าที่รอตรวจสอบ" },
  { code: "sellers.manage", label: "จัดการผู้ขาย", description: "อนุมัติ/ระงับผู้ขาย" },
  { code: "users.manage", label: "จัดการบัญชีผู้ใช้", description: "เปลี่ยนบทบาท/สิทธิ์ผู้ใช้" },
  { code: "staff.manage", label: "จัดการพนักงาน", description: "สร้าง/แก้ไขบัญชีพนักงาน" },
  { code: "audit.view", label: "ดู Audit Logs", description: "ดูบันทึกการดำเนินการสำคัญ" },
  { code: "settings.manage", label: "จัดการตั้งค่าระบบ", description: "แก้ไขการตั้งค่าแพลตฟอร์ม" },
  { code: "payouts.process", label: "จัดการการจ่ายเงิน", description: "อนุมัติรอบการจ่ายเงิน" },
];

/** Every code in the catalog — what owner/admin implicitly hold. */
export const ALL_PERMISSION_CODES: string[] = PERMISSION_CATALOG.map((p) => p.code);

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
  const effectiveRole =
    role ?? ((await query("SELECT role FROM users WHERE id = $1", [userId])).rows[0]?.role ?? null);

  if (effectiveRole === "owner" || effectiveRole === "admin") return [...ALL_PERMISSION_CODES];
  if (effectiveRole !== "staff") return [];

  const result = await query("SELECT permissions FROM employees WHERE user_id = $1 LIMIT 1", [userId]);
  if (result.rows.length === 0) return [];
  return parsePermissionList(result.rows[0].permissions);
}

/** Does this user hold `code`? The check every guarded endpoint runs. */
export async function userHasPermission(
  userId: string,
  code: string,
  role?: string | null,
): Promise<boolean> {
  return (await resolvePermissions(userId, role)).includes(code);
}
