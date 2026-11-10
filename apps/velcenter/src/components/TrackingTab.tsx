/**
 * VelCenter — Multi-carrier Tracking management tab.
 *
 * Owner/admin/staff-with-orders.view (the tab gate in Center.tsx and the
 * endpoint re-checks). Surfaces:
 *   • per-carrier integration health (VERIFIED / PARTIAL / BLOCKED / UNSUPPORTED),
 *   • global shipment search (tracking number / order id / order number),
 *   • carrier + status filters,
 *   • a detail dialog with the full timeline and a refresh action.
 */
import { useCallback, useState } from "react";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { EmptyState } from "@velnox/shared/components/ui/empty-state";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { formatIsoDateTime } from "@velnox/shared/lib/commerce";
import { Loader2, PackageSearch, RefreshCw, Search, Truck } from "lucide-react";

export const CARRIER_FILTERS = ["JT", "FLASH", "SPX", "TNT"] as const;

const STATUS_OPTIONS = [
  "pending",
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "returned",
  "lost",
  "cancelled",
] as const;

interface HealthEntry {
  code: string;
  name: string;
  status: "VERIFIED" | "PARTIAL" | "BLOCKED" | "UNSUPPORTED";
  note: string;
}

interface ShipmentRow {
  id: string;
  orderId: string;
  orderNumber: string | null;
  shopName: string | null;
  carrier: string;
  carrierCode: string | null;
  trackingNumber: string | null;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  trackingConfirmed: boolean;
}

interface TrackingDetail {
  shipment: ShipmentRow;
  events: Array<{
    status: string;
    description: string | null;
    location: string | null;
    occurredAt: string | null;
    originalStatus: string | null;
  }>;
}

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "delivered" || status === "cancelled" || status === "returned") return "success";
  if (status === "lost" || status === "failed") return "warning";
  return "neutral";
}

export default function TrackingTab() {
  const { t } = useLanguage();
  const searchAction = useAction(api.tracking.adminSearch);
  const detailAction = useAction(api.tracking.adminDetail);
  const healthAction = useAction(api.tracking.adminHealth);
  const refreshAction = useAction(api.tracking.adminRefresh);

  const [q, setQ] = useState("");
  const [carrier, setCarrier] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<TrackingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [health, setHealth] = useState<HealthEntry[]>([]);

  const label = useCallback(
    (value: string) => {
      const key = `trackingLabels.${value.toLowerCase()}`;
      const v = t(key);
      return v === key ? value : v;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await searchAction({
        q: q.trim() || undefined,
        carrier: carrier === "all" ? undefined : carrier,
        status: status === "all" ? undefined : status,
        limit: 50,
      })) as unknown as { shipments: ShipmentRow[]; total: number };
      setShipments(res.shipments ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      console.error("[tracking] search error:", err);
    } finally {
      setLoading(false);
    }
  }, [searchAction, q, carrier, status]);

  const loadHealth = useCallback(async () => {
    try {
      const res = (await healthAction()) as unknown as { carriers: HealthEntry[] };
      setHealth(res.carriers ?? []);
    } catch {
      /* non-fatal */
    }
  }, [healthAction]);

  const openDetail = useCallback(
    async (shipmentId: string) => {
      setDetailLoading(true);
      try {
        const res = (await detailAction({ shipmentId })) as unknown as TrackingDetail;
        setSelected(res);
      } catch (err) {
        console.error("[tracking] detail error:", err);
      } finally {
        setDetailLoading(false);
      }
    },
    [detailAction],
  );

  const doRefresh = useCallback(async () => {
    if (!selected) return;
    try {
      await refreshAction({ orderId: selected.shipment.orderId });
      await openDetail(selected.shipment.id);
      await load();
    } catch (err) {
      console.error("[tracking] admin refresh error:", err);
    }
  }, [selected, refreshAction, openDetail, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">การติดตามพัสดุ (Multi-Carrier Tracking)</h2>
          <p className="text-sm text-slate-500">ค้นหาและจัดการ Shipment ทั้งระบบ · สถานะการเชื่อมต่อแต่ละขนส่ง</p>
        </div>
        <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void loadHealth()}>
          <RefreshCw className="size-4" />
          ตรวจสอบ Carrier Health
        </Button>
      </div>

      {/* Carrier integration health */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {health.map((h) => (
          <Card key={h.code} className="border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">{h.name}</CardTitle>
              <Badge
                className={`rounded-full ${
                  h.status === "VERIFIED"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
                    : h.status === "PARTIAL"
                      ? "bg-amber-50 text-amber-700 ring-amber-600/15"
                      : h.status === "BLOCKED"
                        ? "bg-rose-50 text-rose-700 ring-rose-600/15"
                        : "bg-slate-100 text-slate-600 ring-slate-500/15"
                } ring-1 ring-inset`}
              >
                {h.status}
              </Badge>
            </CardHeader>
            <CardContent>
              <p className="text-xs leading-5 text-slate-500">{h.note}</p>
            </CardContent>
          </Card>
        ))}
        {health.length === 0 && (
          <p className="text-sm text-slate-400 sm:col-span-2 lg:col-span-4">
            คลิก "ตรวจสอบ Carrier Health" เพื่อดูสถานะการเชื่อมต่อแต่ละขนส่ง
          </p>
        )}
      </div>

      {/* Filters */}
      <Card className="border-slate-200">
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">ค้นหา</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void load();
                  }}
                  placeholder="เลขพัสดุ / Order ID / Order Number"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <div className="w-40">
              <label className="mb-1 block text-xs font-medium text-slate-500">ขนส่ง</label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 bg-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  {CARRIER_FILTERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <label className="mb-1 block text-xs font-medium text-slate-500">สถานะ</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10 w-full rounded-md border-slate-200 bg-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="h-10 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
              <Search className="size-4" />
              ค้นหา
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Shipments table */}
      <Card className="border-slate-200">
        <CardContent className="pt-5">
          <div className="mb-3 text-xs text-slate-400">พบทั้งหมด {total} Shipment</div>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : shipments.length === 0 ? (
            <EmptyState
              icon={Truck}
              title={q || carrier !== "all" || status !== "all" ? "ไม่พบ Shipment ที่ตรงเงื่อนไข" : "ยังไม่มีข้อมูล Shipment"}
              description="ลองปรับเงื่อนไขการค้นหา หรือรอจนมีคำสั่งซื้อที่ผู้ขายสร้างพัสดุแล้ว"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Order</TableHead>
                    <TableHead>ขนส่ง</TableHead>
                    <TableHead>เลขพัสดุ</TableHead>
                    <TableHead>สถานะ</TableHead>
                    <TableHead>ตรวจสอบล่าสุด</TableHead>
                    <TableHead>ข้อผิดพลาด</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shipments.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => void openDetail(s.id)}
                    >
                      <TableCell className="font-mono text-xs">
                        {s.orderNumber ?? s.orderId.slice(0, 8)}
                        {s.shopName ? <span className="ml-1 block text-2xs text-slate-400">{s.shopName}</span> : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.carrier}
                        {s.carrierCode ? (
                          <Badge className="ml-1.5 rounded-full bg-slate-100 font-mono text-2xs text-slate-500">
                            {s.carrierCode}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="break-all font-mono text-xs">{s.trackingNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Badge data-tone={statusTone(s.status)} className="rounded-full">
                          {label(s.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {s.lastCheckedAt ? formatIsoDateTime(s.lastCheckedAt) : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {s.lastError ? <span className="text-amber-600">{s.lastError}</span> : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <Dialog open={detailLoading ? false : selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto bg-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="size-5 text-slate-500" />
              Timeline · {selected?.shipment.trackingNumber ?? ""}
            </DialogTitle>
            <DialogDescription>
              {selected?.shipment.orderNumber ?? ""}
              {selected?.shipment.lastError ? ` · ข้อผิดพลาด: ${selected.shipment.lastError}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-900">{selected.shipment.carrier}</p>
                  <p className="text-xs text-slate-500">
                    {label(selected.shipment.status)}
                    {selected.shipment.lastCheckedAt
                      ? ` · ${formatIsoDateTime(selected.shipment.lastCheckedAt)}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-slate-200 text-slate-600"
                  onClick={() => void doRefresh()}
                >
                  <RefreshCw className="size-3.5" />
                  Refresh
                </Button>
              </div>

              {selected.events.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีเหตุการณ์ (Event) — แตะ Refresh เพื่อดึงจากขนส่ง</p>
              ) : (
                <div>
                  {[...selected.events].reverse().map((e, i, all) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span
                          className={`mt-1 size-2.5 shrink-0 rounded-full ${
                            i === 0 ? "bg-brand" : "bg-slate-300"
                          }`}
                        />
                        {i < all.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium text-slate-900">{label(e.status)}</p>
                        {e.description && <p className="mt-0.5 text-xs text-slate-500">{e.description}</p>}
                        <p className="mt-0.5 text-2xs text-slate-400">
                          {e.location ? `${e.location} · ` : ""}
                          {e.occurredAt ? formatIsoDateTime(e.occurredAt) : ""}
                          {e.originalStatus ? ` · ดั้งเดิม: ${e.originalStatus}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
