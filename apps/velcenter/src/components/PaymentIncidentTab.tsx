import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { userHasPermission } from "@velnox/shared/lib/api-client";
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
import { AlertTriangle, Check, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * LATE / UNRECORDABLE PAYMENTS — the operator queue (audit HIGH #5).
 *
 * A Stripe capture can arrive for money this system cannot settle through the
 * normal order lifecycle: the attempt was already recorded `failed`, or the
 * order was cancelled / expired and its stock already released. `.ai/context/
 * payment.md` fixes what happens then — the order is NOT resurrected and an
 * OPERATOR decides. This screen is the "decides" half: it lists the durable
 * incidents `backend/lib/payment-incidents.ts` records, and lets an operator
 * acknowledge one.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT DO
 * It has no refund button and no "reopen order" button. There is no documented
 * policy for automatically refunding a late capture or reviving a dead order,
 * and inventing one here would be the agent making a business decision the
 * platform has not made. Money still moves only through the existing operator
 * route, `POST /api/admin/orders/:orderId/refund`, with its own guards — and
 * that route still refuses a payment row that is not `paid`, which is exactly
 * why an operator may need to act outside the screen.
 *
 * "Resolved" here is a bookkeeping acknowledgement, nothing more.
 *
 * The tab is hidden without `orders.view`, and the endpoint re-checks it: a
 * hidden tab is UX, never the authorization.
 */
interface IncidentRow {
  id: string;
  orderId: string;
  orderNumber: string | null;
  orderStatus: string | null;
  currentOrderStatus: string | null;
  reason: string;
  status: string;
  providerPaymentIntentId: string | null;
  providerCheckoutSessionId: string | null;
  eventId: string | null;
  amount: number | null;
  currency: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: number | null;
  createdAt: number | null;
}

/** Human labels for the reason codes the backend writes. */
const REASON_LABELS: Record<string, string> = {
  ORDER_NOT_SETTLEABLE: "ออเดอร์ปิดแล้ว (ยกเลิก / หมดเวลา) — เงินเข้ามาทีหลัง",
  ATTEMPT_NOT_RECORDED: "รายการชำระเงินถูกทำเครื่องหมายว่าล้มเหลวก่อนหน้านี้",
};

export default function PaymentIncidentTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);

  // The backend enforces this; not fetching avoids a guaranteed 403 for an
  // account that cannot see the tab at all.
  const canView = userHasPermission(user, "orders.view");
  const canResolve = userHasPermission(user, "orders.manage");

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (onlyOpen) params.set("status", "open");
      if (search.trim()) params.set("q", search.trim());
      const res = await api(`/api/admin/payment-incidents?${params.toString()}`);
      const body = res as {
        success?: boolean;
        data?: {
          total?: number;
          rows?: IncidentRow[];
          schemaMissing?: boolean;
        };
      };
      setSchemaMissing(Boolean(body?.data?.schemaMissing));
      setRows(body?.data?.rows ?? []);
      setTotal(body?.data?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment incidents");
    } finally {
      setLoading(false);
    }
  }, [canView, onlyOpen, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await api(`/api/admin/payment-incidents/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: "ตรวจสอบแล้ว (บันทึกเท่านั้น — การคืนเงินทำผ่านเมนูคืนเงินของ Center)" }),
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to resolve the incident");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  if (!canView) return null;

  return (
    <TabsContent value="incidents" className="mt-4 space-y-4">
      <Card className="rounded-[14px] border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-[15px] text-slate-900">
            <AlertTriangle className="size-4 text-amber-600" />
            รายการที่ต้องให้ผู้ดำเนินการตรวจสอบ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[13px] leading-relaxed text-slate-700">
          <p>
            กรณีเหล่านี้คือ <strong>Stripe แจ้งว่าเงินเข้าแล้ว</strong> แตการชำระเงินนั้นไม่สามารถ
            ดำเนินต่อตามขั้นตอนปกติของออเดอร์ได้ (เช่น รายการชำระเงินถูกทำเครื่องหมายว่าล้มเหลวมาก่อน
            หรือออเดอร์ถูกยกเลิก/หมดเวลาแล้ว) — ระบบจะ
            <strong>ไม่ย้อนสถานะออเดอร์กลับ</strong> และไม่แตะจำนวนสินค้าซ้ำ
          </p>
          <p>
            หน้านี้เป็นเพียง<strong>การบันทึกว่าพบปัญหาและตรวจสอบแล้ว</strong> เท่านั้น — ไม่มีการคืนเงิน
            หรือเปิดออเดอร์ใหม่อัตโนมัติ การคืนเงินยังคงทำผ่านเมนูคืนเงินของ Center ตามเงื่อนไขเดิม
            (ต้องเป็นรายการที่สถานะเป็น <code className="rounded bg-slate-100 px-1">paid</code>
            เท่านั้น) หากสถานะไม่ใช่ <code className="rounded bg-slate-100 px-1">paid</code>{" "}
            ให้พิจารณาดำเนินการผ่านช่องทางอื่นตามนโยบายของบริษัท
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1 space-y-1.5">
          <Label htmlFor="incident-search" className="text-xs text-slate-600">
            ค้นหา (เลขออเดอร์ / PaymentIntent / event)
          </Label>
          <Input
            id="incident-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหา…"
            className="h-10 rounded-[10px] border-slate-200"
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
            className="size-4"
          />
          เฉพาะรายการที่ยังไม่ตรวจ
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="h-10 gap-1.5 rounded-[10px]"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          รีเฟรช
        </Button>
      </div>

      {schemaMissing && (
        <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          ยังไม่ได้ติดตั้ง migration 049 — ระบบยังบันทึกเหตุการณ์นี้ไว้ใน log
          เท่านั้น กรุณาติดตั้ง <code>db/migrations/049_payment_incidents.sql</code>
        </p>
      )}

      {error && (
        <p className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          {error}
        </p>
      )}

      <div className="rounded-[14px] border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
          <Search className="size-4 text-slate-400" />
          <span className="text-[13px] font-medium text-slate-700">
            ทั้งหมด {total} รายการ
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เวลา</TableHead>
              <TableHead>ออเดอร์</TableHead>
              <TableHead>เหตุผล</TableHead>
              <TableHead>จำนวนเงิน</TableHead>
              <TableHead>PaymentIntent</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead className="text-right">ดำเนินการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-[13px] text-slate-400">
                  {loading ? "กำลังโหลด…" : "ไม่พบรายการที่ต้องตรวจสอบ"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-[12px] text-slate-500">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString("th-TH") : "—"}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <div className="font-medium text-slate-800">
                      {row.orderNumber ?? row.orderId.slice(0, 8)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      ออเดอร์ตอนบันทึก: {row.orderStatus ?? "—"}
                      {row.currentOrderStatus ? ` · ปัจจุบัน: ${row.currentOrderStatus}` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px] text-[12px] text-slate-600">
                    {REASON_LABELS[row.reason] ?? row.reason}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[13px] font-medium text-slate-800">
                    {row.amount != null ? `${row.amount.toFixed(2)} ${row.currency ?? ""}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-slate-500">
                    {row.providerPaymentIntentId ?? "—"}
                  </TableCell>
                  <TableCell>
                    {row.status === "open" ? (
                      <Badge className="bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50">
                        รอตรวจสอบ
                      </Badge>
                    ) : (
                      <Badge className="bg-slate-100 text-slate-600 ring-slate-600/15 hover:bg-slate-100">
                        ตรวจสอบแล้ว
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.status === "open" && canResolve ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => void resolve(row.id)}
                        className="h-8 gap-1.5 rounded-[8px]"
                      >
                        {busyId === row.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        ตรวจสอบแล้ว
                      </Button>
                    ) : (
                      <span className="text-[12px] text-slate-400">
                        {row.resolvedByName ? `โดย ${row.resolvedByName}` : "—"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </TabsContent>
  );
}
