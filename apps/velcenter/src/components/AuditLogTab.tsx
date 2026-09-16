import { api, useAction } from "@velnox/shared/lib/api-routes";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { TabsContent } from "@velnox/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface AuditRow {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  targetLabel: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: number;
}

interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  rows: AuditRow[];
}

/**
 * Human labels for the audit action codes actually written by the backend.
 * Unknown codes fall back to a prettified version of the code itself — the UI
 * never invents an event that was not recorded.
 */
const ACTION_LABELS: Record<string, string> = {
  SETTINGS_UPDATE: "แก้ไขการตั้งค่าระบบ",
  USER_ACCESS_UPDATE: "เปลี่ยนบทบาท / สิทธิ์ผู้ใช้",
  EMPLOYEE_CREATE: "สร้างบัญชีพนักงาน",
  EMPLOYEE_ACTIVE_UPDATE: "เปิด / ปิดการใช้งานพนักงาน",
  STAFF_PROFILE_UPDATE: "แก้ไขฝ่าย / สิทธิ์พนักงาน",
  ORDER_STATUS_UPDATE: "เปลี่ยนสถานะออเดอร์",
  SELLER_APPROVED: "อนุมัติผู้ขาย",
  SELLER_REJECTED: "ปฏิเสธผู้ขาย",
  SELLER_SUSPENDED: "ระงับผู้ขาย",
  SELLER_VERIFICATION_APPROVED: "อนุมัติการยืนยันร้านค้า",
  SELLER_VERIFICATION_REJECTED: "ปฏิเสธการยืนยันร้านค้า",
  SELLER_VERIFICATION_SUSPENDED: "ระงับการยืนยันร้านค้า",
  SELLER_VERIFICATION_NEEDS_CORRECTION: "ขอให้แก้ไขข้อมูลยืนยัน",
  product_moderation: "ตรวจสอบสินค้า (อนุมัติ / ปฏิเสธ)",
  product_status_change: "เปลี่ยนสถานะสินค้า",
  shop_revoked: "เพิกถอนร้านค้า",
};

const ENTITY_LABELS: Record<string, string> = {
  product: "สินค้า",
  seller: "ผู้ขาย",
  shop: "ร้านค้า",
  employee: "พนักงาน",
  user: "ผู้ใช้",
  order: "ออเดอร์",
  setting: "การตั้งค่า",
  category: "หมวดหมู่",
};

function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // e.g. SELLER_UNDER_REVIEW → "seller under review"
  return action.replace(/_/g, " ").toLowerCase();
}

function entityLabel(type: string | null): string {
  if (!type) return "—";
  return ENTITY_LABELS[type] ?? type;
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString("th-TH")} ${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`;
}

function ValueChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px]">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-medium text-slate-700">{value}</span>
    </span>
  );
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** `from → to` rendering for change events; plain details otherwise. */
function ChangeSummary({ row }: { row: AuditRow }) {
  if (row.before || row.after) {
    const keys = Array.from(
      new Set([...Object.keys(row.before ?? {}), ...Object.keys(row.after ?? {})]),
    );
    return (
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key) => {
          const from = renderValue((row.before ?? {})[key]);
          const to = renderValue((row.after ?? {})[key]);
          if (from === to) return <ValueChip key={key} label={key} value={to} />;
          return (
            <span key={key} className="inline-flex min-w-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px]">
              <span className="text-slate-400">{key}</span>
              <span className="max-w-40 truncate text-slate-400 line-through">{from}</span>
              <span className="text-slate-300">→</span>
              <span className="max-w-40 truncate font-medium text-slate-700">{to}</span>
            </span>
          );
        })}
      </div>
    );
  }
  if (row.details) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(row.details).map(([key, value]) => (
          <ValueChip key={key} label={key} value={renderValue(value)} />
        ))}
      </div>
    );
  }
  return <span className="text-xs text-slate-400">—</span>;
}

function ActorCell({ row }: { row: AuditRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-slate-900">
        {row.actorName ?? row.actorEmail ?? "ระบบ"}
      </p>
      <p className="truncate text-xs text-slate-400">
        {row.actorEmail ?? "—"}
        {row.actorRole ? ` · ${row.actorRole}` : ""}
      </p>
    </div>
  );
}

function TargetCell({ row }: { row: AuditRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm text-slate-700">{row.targetLabel ?? entityLabel(row.entityType)}</p>
      <p className="truncate text-xs text-slate-400">
        {entityLabel(row.entityType)}
        {row.entityId ? ` · #${row.entityId.slice(0, 8)}` : ""}
      </p>
    </div>
  );
}

/**
 * VelCenter Audit Logs (spec §44, §49).
 *
 * Reads the append-only `audit_logs` table in Neon: who did what, to what,
 * from which value to which value, and when. Secrets are stripped at write
 * time (backend/lib/audit-log.ts), so nothing sensitive can appear here.
 *
 * Owner/admin only — enforced by the backend endpoint, not just by hiding
 * this tab. A failed request shows a real error state with retry; it is never
 * rendered as "no records".
 */
export default function AuditLogTab() {
  const auditLogsAction = useAction(api.centerAdmin.auditLogs);

  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const PAGE_SIZE = 100;

  const load = useCallback(
    async (offset = 0) => {
      if (offset === 0) {
        setLoading(true);
        setError(null);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = (await auditLogsAction({
          limit: PAGE_SIZE,
          offset,
          q: search.trim() || undefined,
          action: actionFilter === "all" ? undefined : actionFilter,
          entityType: entityFilter === "all" ? undefined : entityFilter,
          from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
          to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        })) as AuditResponse;
        const page = Array.isArray(res?.rows) ? res.rows : [];
        setRows((prev) => (offset === 0 ? page : [...(prev ?? []), ...page]));
        setTotal(typeof res?.total === "number" ? res.total : page.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : "โหลดบันทึกการดำเนินการไม่สำเร็จ");
        if (offset === 0) setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [auditLogsAction, search, actionFilter, entityFilter, from, to],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const actionOptions = useMemo(() => {
    const observed = new Set((rows ?? []).map((r) => r.action));
    for (const code of Object.keys(ACTION_LABELS)) observed.add(code);
    return Array.from(observed).sort();
  }, [rows]);

  const hasFilters = search.trim() !== "" || actionFilter !== "all" || entityFilter !== "all" || from !== "" || to !== "";

  return (
    <TabsContent value="audit" className="mt-6 space-y-4">
      <Card className="gap-0 border-slate-200 shadow-none">
        <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-[#10B981]" />
              Audit Logs
            </CardTitle>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              บันทึกการดำเนินการสำคัญของพนักงาน (append-only จาก Neon) — ใคร ทำอะไร กับอะไร จากค่าใดเป็นค่าใด เมื่อไหร่
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 rounded-[10px] border-slate-200 text-slate-600"
            onClick={() => void load(0)}
            disabled={loading}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            รีเฟรช
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filters — only options the backend actually supports */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา action, ผู้ดำเนินการ, รายละเอียด..."
                className="rounded-[10px] pl-9"
              />
            </div>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              aria-label="กรองตาม action"
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
            >
              <option value="all">ทุก action</option>
              {actionOptions.map((code) => (
                <option key={code} value={code}>
                  {actionLabel(code)}
                </option>
              ))}
            </select>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              aria-label="กรองตามประเภทเป้าหมาย"
              className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
            >
              <option value="all">ทุกประเภท</option>
              {Object.entries(ENTITY_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2 lg:col-span-1">
              <div className="grid gap-1">
                <Label htmlFor="audit-from" className="text-[11px] text-slate-400">จากวันที่</Label>
                <Input id="audit-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-[10px] text-xs" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="audit-to" className="text-[11px] text-slate-400">ถึงวันที่</Label>
                <Input id="audit-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-[10px] text-xs" />
              </div>
            </div>
          </div>
          {hasFilters && (
            <div className="flex items-center gap-2">
              <Badge className="rounded-full bg-slate-100 text-[11px] text-slate-600 ring-1 ring-inset ring-slate-600/10">
                พบ {total.toLocaleString()} รายการ
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-[8px] text-xs text-slate-500"
                onClick={() => {
                  setSearch("");
                  setActionFilter("all");
                  setEntityFilter("all");
                  setFrom("");
                  setTo("");
                }}
              >
                ล้างตัวกรอง
              </Button>
            </div>
          )}

          {/* States */}
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
              <Loader2 className="size-4 animate-spin" />
              กำลังโหลด audit logs...
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-red-300 bg-red-50/50 px-6 py-12 text-center">
              <AlertCircle className="size-6 text-red-500" />
              <p className="text-sm font-medium text-slate-900">โหลดบันทึกไม่สำเร็จ</p>
              <p className="max-w-sm text-xs text-slate-500">{error}</p>
              <Button variant="outline" size="sm" className="mt-1 rounded-[10px]" onClick={() => void load(0)}>
                ลองใหม่
              </Button>
            </div>
          ) : (rows ?? []).length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              {hasFilters ? "ไม่พบบันทึกตามเงื่อนไขที่เลือก" : "ยังไม่มีบันทึกการดำเนินการ"}
            </p>
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block">
                <Table className="min-w-[880px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-4 text-slate-400">เวลา</TableHead>
                      <TableHead className="text-slate-400">ผู้ดำเนินการ</TableHead>
                      <TableHead className="text-slate-400">Action</TableHead>
                      <TableHead className="text-slate-400">เป้าหมาย</TableHead>
                      <TableHead className="pr-4 text-slate-400">รายละเอียด</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rows ?? []).map((row) => (
                      <TableRow key={row.id} className="hover:bg-slate-50/60">
                        <TableCell className="pl-4 align-top">
                          <p className="whitespace-nowrap text-xs tabular-nums text-slate-500">{formatWhen(row.createdAt)}</p>
                          {row.ipAddress && <p className="text-[10px] text-slate-300">{row.ipAddress}</p>}
                        </TableCell>
                        <TableCell className="align-top"><ActorCell row={row} /></TableCell>
                        <TableCell className="align-top">
                          <Badge className="rounded-full bg-slate-900 text-[10px] text-white">{actionLabel(row.action)}</Badge>
                        </TableCell>
                        <TableCell className="align-top"><TargetCell row={row} /></TableCell>
                        <TableCell className="pr-4 align-top">
                          <ChangeSummary row={row} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile / tablet: cards — no horizontal scrolling */}
              <div className="space-y-2 lg:hidden">
                {(rows ?? []).map((row) => {
                  const open = expanded === row.id;
                  return (
                    <div key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs tabular-nums text-slate-400">{formatWhen(row.createdAt)}</p>
                          <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
                            {row.actorName ?? row.actorEmail ?? "ระบบ"}
                          </p>
                        </div>
                        <Badge className="shrink-0 rounded-full bg-slate-900 text-[10px] text-white">{actionLabel(row.action)}</Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{entityLabel(row.entityType)}</span>
                        <span className="min-w-0 truncate">{row.targetLabel ?? "—"}</span>
                      </div>
                      <div className="mt-2">
                        <ChangeSummary row={row} />
                      </div>
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : row.id)}
                        className="mt-2 flex items-center gap-1 text-xs font-medium text-[#10B981]"
                      >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                        {open ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}
                      </button>
                      {open && (
                        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">Action code</span>
                            <span className="font-mono">{row.action}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">ผู้ดำเนินการ</span>
                            <span className="min-w-0 truncate text-right">{row.actorEmail ?? "—"}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">บทบาท</span>
                            <span>{row.actorRole ?? "—"}</span>
                          </div>
                          <div className="flex justify-between gap-3">
                            <span className="text-slate-400">รหัสเป้าหมาย</span>
                            <span className="font-mono">{row.entityId ? row.entityId.slice(0, 8) : "—"}</span>
                          </div>
                          {row.ipAddress && (
                            <div className="flex justify-between gap-3">
                              <span className="text-slate-400">IP</span>
                              <span className="font-mono">{row.ipAddress}</span>
                            </div>
                          )}
                          {row.details && (
                            <pre className="max-h-40 overflow-auto rounded-md bg-white px-2 py-1.5 text-[10px] leading-relaxed text-slate-500">
                              {JSON.stringify(row.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {(rows ?? []).length < total && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-[10px]"
                    onClick={() => void load((rows ?? []).length)}
                    disabled={loadingMore}
                  >
                    {loadingMore && <Loader2 className="size-3.5 animate-spin" />}
                    โหลดเพิ่ม ({(rows ?? []).length}/{total})
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
